import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import { COMPETITOR_ANALYSIS_PROMPT, REVIEW_ANALYSIS_PROMPT, COMPARISON_SUMMARY_PROMPT } from "../prompts";
import { scrapeAmazonProduct, type AmazonProductData } from "../scraper";
import { parseReviewFile, reviewsToText, type ParseResult } from "../reviewParser";

// Helper: run a single ASIN analysis (scrape + LLM)
async function analyzeSingleAsin(
  projectId: number,
  asin: string,
): Promise<{
  asin: string;
  status: "success" | "partial" | "failed";
  analysisId?: number;
  title?: string;
  error?: string;
}> {
  // Step 1: Auto-scrape Amazon product data
  let scrapedData: AmazonProductData | null = null;
  try {
    scrapedData = await scrapeAmazonProduct(asin);
  } catch (error: any) {
    console.warn(`[Analysis] Scraping failed for ${asin}: ${error.message}`);
  }

  // Step 2: Build context for LLM analysis
  const contextParts: string[] = [];
  contextParts.push(`ASIN: ${asin}`);

  if (scrapedData) {
    if (scrapedData.title) contextParts.push(`Title: ${scrapedData.title}`);
    if (scrapedData.brand) contextParts.push(`Brand: ${scrapedData.brand}`);
    if (scrapedData.bulletPoints.length > 0) {
      contextParts.push(`Bullet Points:\n${scrapedData.bulletPoints.map((bp, i) => `${i + 1}. ${bp}`).join("\n")}`);
    }
    if (scrapedData.price) contextParts.push(`Price: ${scrapedData.price}`);
    if (scrapedData.rating) contextParts.push(`Rating: ${scrapedData.rating}/5`);
    if (scrapedData.reviewCount) contextParts.push(`Review Count: ${scrapedData.reviewCount}`);
    if (scrapedData.description) contextParts.push(`Description: ${scrapedData.description}`);
    if (scrapedData.category) contextParts.push(`Category: ${scrapedData.category}`);
  }

  // Step 3: Analyze competitor data with LLM
  const analysisResponse = await invokeLLM({
    messages: [
      { role: "system", content: COMPETITOR_ANALYSIS_PROMPT },
      { role: "user", content: `Analyze this competitor product:\n\n${contextParts.join("\n\n")}` },
    ],
    response_format: { type: "json_object" },
  });

  const analysisContent = typeof analysisResponse.choices[0].message.content === "string"
    ? analysisResponse.choices[0].message.content
    : JSON.stringify(analysisResponse.choices[0].message.content);

  let analysisData: any = {};
  try {
    analysisData = JSON.parse(analysisContent);
  } catch {
    analysisData = { raw: analysisContent };
  }

  // Step 4: Analyze reviews if available
  let reviewAnalysis: any = null;
  const reviewTexts = scrapedData?.reviews || [];
  if (reviewTexts.length > 0) {
    const reviewResponse = await invokeLLM({
      messages: [
        { role: "system", content: REVIEW_ANALYSIS_PROMPT },
        { role: "user", content: `Analyze these customer reviews:\n\n${reviewTexts.join("\n\n---\n\n")}` },
      ],
      response_format: { type: "json_object" },
    });

    const reviewContent = typeof reviewResponse.choices[0].message.content === "string"
      ? reviewResponse.choices[0].message.content
      : JSON.stringify(reviewResponse.choices[0].message.content);

    try {
      reviewAnalysis = JSON.parse(reviewContent);
    } catch {
      reviewAnalysis = { raw: reviewContent };
    }
  }

  // Step 5: Save analysis to database
  const saved = await db.createCompetitorAnalysis({
    projectId,
    asin,
    title: scrapedData?.title ?? null,
    bulletPoints: scrapedData?.bulletPoints ? JSON.stringify(scrapedData.bulletPoints) : null,
    price: scrapedData?.price ?? null,
    rating: scrapedData?.rating ?? null,
    reviewCount: scrapedData?.reviewCount ?? null,
    reviewAnalysis: reviewAnalysis ? JSON.stringify(reviewAnalysis) : null,
    keywords: analysisData.keywords ? JSON.stringify(analysisData.keywords) : null,
    imageUrls: scrapedData?.imageUrls ? JSON.stringify(scrapedData.imageUrls) : null,
    rawData: JSON.stringify({
      ...analysisData,
      scrapedData: scrapedData ? {
        title: scrapedData.title,
        brand: scrapedData.brand,
        price: scrapedData.price,
        rating: scrapedData.rating,
        reviewCount: scrapedData.reviewCount,
        bulletPointsCount: scrapedData.bulletPoints.length,
        reviewsCount: scrapedData.reviews.length,
        category: scrapedData.category,
      } : null,
    }),
  });

  return {
    asin,
    status: scrapedData?.title ? "success" : "partial",
    analysisId: saved.id,
    title: scrapedData?.title ?? undefined,
  };
}

export const analysisRouter = router({
  // Get all analyses for a project
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      return db.getCompetitorAnalysesByProject(input.projectId);
    }),

  // Scrape Amazon product data by ASIN (preview only, no save)
  scrapeAsin: protectedProcedure
    .input(z.object({
      asin: z.string().min(10).max(10),
    }))
    .mutation(async ({ input }) => {
      const data = await scrapeAmazonProduct(input.asin);
      return data;
    }),

  // Analyze a single competitor ASIN - auto-scrape + LLM analysis
  analyzeAsin: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      asin: z.string().min(10).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      await db.updateProject(input.projectId, ctx.user.id, { status: "analyzing" });

      const result = await analyzeSingleAsin(input.projectId, input.asin);
      return result;
    }),

  // Batch analyze multiple ASINs - process sequentially
  batchAnalyze: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      asins: z.array(z.string().min(10).max(10)).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      await db.updateProject(input.projectId, ctx.user.id, { status: "analyzing" });

      // Deduplicate ASINs
      const uniqueAsins = Array.from(new Set(input.asins));

      const results: Array<{
        asin: string;
        status: "success" | "partial" | "failed";
        analysisId?: number;
        title?: string;
        error?: string;
      }> = [];

      // Process each ASIN sequentially to avoid rate limiting
      for (const asin of uniqueAsins) {
        try {
          const result = await analyzeSingleAsin(input.projectId, asin);
          results.push(result);
        } catch (error: any) {
          console.error(`[BatchAnalysis] Failed for ${asin}: ${error.message}`);
          results.push({
            asin,
            status: "failed",
            error: error.message || "Unknown error",
          });
        }

        // Small delay between ASINs to be polite to Amazon
        if (uniqueAsins.indexOf(asin) < uniqueAsins.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 2000));
        }
      }

      const successCount = results.filter(r => r.status === "success").length;
      const partialCount = results.filter(r => r.status === "partial").length;
      const failedCount = results.filter(r => r.status === "failed").length;

      return {
        total: uniqueAsins.length,
        successCount,
        partialCount,
        failedCount,
        results,
      };
    }),

  // Manual input analysis - fallback when auto-scrape fails
  analyzeManual: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      asin: z.string().min(10).max(10),
      title: z.string().optional(),
      bulletPoints: z.string().optional(),
      price: z.string().optional(),
      rating: z.string().optional(),
      reviews: z.string().optional(),
      description: z.string().optional(),
      brand: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      await db.updateProject(input.projectId, ctx.user.id, { status: "analyzing" });

      // Build context from manual input
      const contextParts: string[] = [];
      contextParts.push(`ASIN: ${input.asin}`);
      if (input.title) contextParts.push(`Title: ${input.title}`);
      if (input.brand) contextParts.push(`Brand: ${input.brand}`);
      if (input.bulletPoints) contextParts.push(`Bullet Points:\n${input.bulletPoints}`);
      if (input.price) contextParts.push(`Price: ${input.price}`);
      if (input.rating) contextParts.push(`Rating: ${input.rating}/5`);
      if (input.description) contextParts.push(`Description: ${input.description}`);

      // Analyze competitor data with LLM
      const analysisResponse = await invokeLLM({
        messages: [
          { role: "system", content: COMPETITOR_ANALYSIS_PROMPT },
          { role: "user", content: `Analyze this competitor product:\n\n${contextParts.join("\n\n")}` },
        ],
        response_format: { type: "json_object" },
      });

      const analysisContent = typeof analysisResponse.choices[0].message.content === "string"
        ? analysisResponse.choices[0].message.content
        : JSON.stringify(analysisResponse.choices[0].message.content);

      let analysisData: any = {};
      try {
        analysisData = JSON.parse(analysisContent);
      } catch {
        analysisData = { raw: analysisContent };
      }

      // Analyze reviews if provided
      let reviewAnalysis: any = null;
      if (input.reviews && input.reviews.trim().length > 0) {
        const reviewResponse = await invokeLLM({
          messages: [
            { role: "system", content: REVIEW_ANALYSIS_PROMPT },
            { role: "user", content: `Analyze these customer reviews:\n\n${input.reviews}` },
          ],
          response_format: { type: "json_object" },
        });

        const reviewContent = typeof reviewResponse.choices[0].message.content === "string"
          ? reviewResponse.choices[0].message.content
          : JSON.stringify(reviewResponse.choices[0].message.content);

        try {
          reviewAnalysis = JSON.parse(reviewContent);
        } catch {
          reviewAnalysis = { raw: reviewContent };
        }
      }

      // Parse bullet points into array
      const bulletPointsArray = input.bulletPoints
        ? input.bulletPoints.split("\n").filter((line: string) => line.trim().length > 0)
        : [];

      // Save analysis to database
      const saved = await db.createCompetitorAnalysis({
        projectId: input.projectId,
        asin: input.asin,
        title: input.title ?? null,
        bulletPoints: bulletPointsArray.length > 0 ? JSON.stringify(bulletPointsArray) : null,
        price: input.price ?? null,
        rating: input.rating ?? null,
        reviewCount: null,
        reviewAnalysis: reviewAnalysis ? JSON.stringify(reviewAnalysis) : null,
        keywords: analysisData.keywords ? JSON.stringify(analysisData.keywords) : null,
        imageUrls: null,
        rawData: JSON.stringify({
          ...analysisData,
          manualInput: true,
        }),
      });

      return {
        asin: input.asin,
        status: "success" as const,
        analysisId: saved.id,
        title: input.title,
        manualInput: true,
      };
    }),

  // AI comparison summary - generate diff report and optimization suggestions
  comparisonSummary: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      analysisIds: z.array(z.number()).min(2).max(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Fetch all selected analyses
      const allAnalyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const selectedAnalyses = allAnalyses.filter(a => input.analysisIds.includes(a.id));

      if (selectedAnalyses.length < 2) {
        throw new Error("At least 2 analyses are required for comparison");
      }

      // Build comprehensive context for LLM
      const competitorSummaries = selectedAnalyses.map(a => {
        const keywords = a.keywords ? JSON.parse(a.keywords) : null;
        const reviewAnalysis = a.reviewAnalysis ? JSON.parse(a.reviewAnalysis) : null;
        const rawData = a.rawData ? JSON.parse(a.rawData) : null;
        const bulletPoints = a.bulletPoints ? JSON.parse(a.bulletPoints) : [];

        const parts: string[] = [];
        parts.push(`### ASIN: ${a.asin}`);
        parts.push(`- Title: ${a.title || "N/A"}`);
        parts.push(`- Brand: ${rawData?.scrapedData?.brand || rawData?.brand || "N/A"}`);
        parts.push(`- Price: ${a.price || "N/A"}`);
        parts.push(`- Rating: ${a.rating || "N/A"}`);
        parts.push(`- Review Count: ${a.reviewCount || "N/A"}`);

        if (bulletPoints.length > 0) {
          parts.push(`- Bullet Points (${bulletPoints.length}):`);
          bulletPoints.forEach((bp: string, i: number) => {
            parts.push(`  ${i + 1}. ${bp}`);
          });
        }

        if (keywords) {
          const coreKws = (keywords.core || []).map((k: any) => typeof k === "string" ? k : k.keyword || k.term).join(", ");
          const longTailKws = (keywords.longTail || []).map((k: any) => typeof k === "string" ? k : k.keyword || k.term).join(", ");
          const trafficKws = (keywords.traffic || []).map((k: any) => typeof k === "string" ? k : k.keyword || k.term).join(", ");
          if (coreKws) parts.push(`- Core Keywords: ${coreKws}`);
          if (longTailKws) parts.push(`- Long-tail Keywords: ${longTailKws}`);
          if (trafficKws) parts.push(`- Traffic Keywords: ${trafficKws}`);
        }

        if (reviewAnalysis) {
          if (reviewAnalysis.painPoints?.length) {
            parts.push(`- Pain Points: ${reviewAnalysis.painPoints.map((p: any) => p.issue).join("; ")}`);
          }
          if (reviewAnalysis.itchPoints?.length) {
            parts.push(`- Itch Points: ${reviewAnalysis.itchPoints.map((p: any) => p.desire).join("; ")}`);
          }
          if (reviewAnalysis.delightPoints?.length) {
            parts.push(`- Delight Points: ${reviewAnalysis.delightPoints.map((p: any) => p.feature).join("; ")}`);
          }
        }

        if (rawData?.advantages?.length) {
          parts.push(`- Advantages: ${rawData.advantages.join("; ")}`);
        }
        if (rawData?.weaknesses?.length) {
          parts.push(`- Weaknesses: ${rawData.weaknesses.join("; ")}`);
        }

        return parts.join("\n");
      });

      const userMessage = `Please analyze and compare the following ${selectedAnalyses.length} competitor products and generate a comprehensive comparison report with optimization suggestions:\n\n${competitorSummaries.join("\n\n---\n\n")}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: COMPARISON_SUMMARY_PROMPT },
          { role: "user", content: userMessage },
        ],
      });

      const summaryContent = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);

      return {
        summary: summaryContent,
        analyzedAsins: selectedAnalyses.map(a => a.asin),
        analyzedCount: selectedAnalyses.length,
      };
    }),

  // Import reviews from Excel/CSV file (base64 encoded)
  importReviews: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      asin: z.string().min(10).max(10),
      fileBase64: z.string(),
      filename: z.string(),
      // Optional: existing analysis ID to update with imported reviews
      analysisId: z.number().optional(),
      // Optional: additional product info for new analysis
      title: z.string().optional(),
      bulletPoints: z.string().optional(),
      price: z.string().optional(),
      rating: z.string().optional(),
      brand: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Decode base64 file
      const buffer = Buffer.from(input.fileBase64, "base64");

      // Parse the file
      let parseResult: ParseResult;
      try {
        parseResult = parseReviewFile(buffer, input.filename);
      } catch (error: any) {
        throw new Error(`文件解析失败: ${error.message}`);
      }

      if (parseResult.reviews.length === 0) {
        throw new Error("文件中未找到有效的评论数据。请确保文件包含评论内容列。");
      }

      // Convert reviews to text for LLM analysis
      const reviewText = reviewsToText(parseResult.reviews);

      // Build context for competitor analysis
      const contextParts: string[] = [];
      contextParts.push(`ASIN: ${input.asin}`);
      if (input.title) contextParts.push(`Title: ${input.title}`);
      if (input.brand) contextParts.push(`Brand: ${input.brand}`);
      if (input.bulletPoints) contextParts.push(`Bullet Points:\n${input.bulletPoints}`);
      if (input.price) contextParts.push(`Price: ${input.price}`);
      if (input.rating) contextParts.push(`Rating: ${input.rating}/5`);

      // Run competitor analysis LLM
      const analysisResponse = await invokeLLM({
        messages: [
          { role: "system", content: COMPETITOR_ANALYSIS_PROMPT },
          { role: "user", content: `Analyze this competitor product:\n\n${contextParts.join("\n\n")}\n\nCustomer Reviews Summary (${parseResult.reviews.length} reviews imported from file):\n${reviewText.substring(0, 8000)}` },
        ],
        response_format: { type: "json_object" },
      });

      const analysisContent = typeof analysisResponse.choices[0].message.content === "string"
        ? analysisResponse.choices[0].message.content
        : JSON.stringify(analysisResponse.choices[0].message.content);

      let analysisData: any = {};
      try {
        analysisData = JSON.parse(analysisContent);
      } catch {
        analysisData = { raw: analysisContent };
      }

      // Run review analysis LLM
      const reviewResponse = await invokeLLM({
        messages: [
          { role: "system", content: REVIEW_ANALYSIS_PROMPT },
          { role: "user", content: `Analyze these ${parseResult.reviews.length} customer reviews imported from a seller tool (卖家精灵/SellerSprite):\n\n${reviewText.substring(0, 12000)}` },
        ],
        response_format: { type: "json_object" },
      });

      const reviewContent = typeof reviewResponse.choices[0].message.content === "string"
        ? reviewResponse.choices[0].message.content
        : JSON.stringify(reviewResponse.choices[0].message.content);

      let reviewAnalysis: any = null;
      try {
        reviewAnalysis = JSON.parse(reviewContent);
      } catch {
        reviewAnalysis = { raw: reviewContent };
      }

      // Parse bullet points into array
      const bulletPointsArray = input.bulletPoints
        ? input.bulletPoints.split("\n").filter((line: string) => line.trim().length > 0)
        : [];

      // If updating existing analysis, delete old one first
      if (input.analysisId) {
        try {
          await db.deleteCompetitorAnalysis(input.analysisId);
        } catch {
          // Ignore if not found
        }
      }

      // Save new analysis
      const saved = await db.createCompetitorAnalysis({
        projectId: input.projectId,
        asin: input.asin,
        title: input.title ?? null,
        bulletPoints: bulletPointsArray.length > 0 ? JSON.stringify(bulletPointsArray) : null,
        price: input.price ?? null,
        rating: input.rating ?? null,
        reviewCount: String(parseResult.reviews.length),
        reviewAnalysis: reviewAnalysis ? JSON.stringify(reviewAnalysis) : null,
        keywords: analysisData.keywords ? JSON.stringify(analysisData.keywords) : null,
        imageUrls: null,
        rawData: JSON.stringify({
          ...analysisData,
          manualInput: true,
          importedReviews: true,
          reviewImport: {
            filename: input.filename,
            totalRows: parseResult.totalRows,
            parsedRows: parseResult.parsedRows,
            skippedRows: parseResult.skippedRows,
            detectedFormat: parseResult.detectedFormat,
            columns: parseResult.columns,
          },
          scrapedData: {
            brand: input.brand || null,
            reviewsCount: parseResult.reviews.length,
          },
        }),
      });

      // Save import record to reviewImports table
      const importRecord = await db.createReviewImport({
        projectId: input.projectId,
        userId: ctx.user.id,
        asin: input.asin,
        filename: input.filename,
        fileSize: buffer.length,
        totalRows: parseResult.totalRows,
        parsedRows: parseResult.parsedRows,
        skippedRows: parseResult.skippedRows,
        detectedFormat: parseResult.detectedFormat,
        columns: JSON.stringify(parseResult.columns),
        analysisId: saved.id,
        status: "completed",
        metadata: JSON.stringify({
          brand: input.brand || null,
          title: input.title || null,
          price: input.price || null,
          rating: input.rating || null,
        }),
      });

      return {
        asin: input.asin,
        status: "success" as const,
        analysisId: saved.id,
        importId: importRecord.id,
        title: input.title,
        importedReviews: true,
        reviewStats: {
          totalRows: parseResult.totalRows,
          parsedRows: parseResult.parsedRows,
          skippedRows: parseResult.skippedRows,
          detectedFormat: parseResult.detectedFormat,
          columns: parseResult.columns,
        },
      };
    }),

  // Preview review file parsing (without running analysis)
  previewReviewFile: protectedProcedure
    .input(z.object({
      fileBase64: z.string(),
      filename: z.string(),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");

      let parseResult: ParseResult;
      try {
        parseResult = parseReviewFile(buffer, input.filename);
      } catch (error: any) {
        throw new Error(`文件解析失败: ${error.message}`);
      }

      // Return preview with first 5 reviews
      return {
        totalRows: parseResult.totalRows,
        parsedRows: parseResult.parsedRows,
        skippedRows: parseResult.skippedRows,
        detectedFormat: parseResult.detectedFormat,
        columns: parseResult.columns,
        previewReviews: parseResult.reviews.slice(0, 5).map(r => ({
          title: r.title,
          content: r.content.substring(0, 200) + (r.content.length > 200 ? "..." : ""),
          rating: r.rating,
          date: r.date,
          author: r.author,
        })),
      };
    }),

  // Delete an analysis
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return db.deleteCompetitorAnalysis(input.id);
    }),

  // ─── Review Import History ─────────────────────────────────────

  // List all review imports for a project
  listReviewImports: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      return db.getReviewImportsByProject(input.projectId);
    }),

  // Get a single review import detail
  getReviewImport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const record = await db.getReviewImportById(input.id);
      if (!record) throw new Error("Review import not found");
      return record;
    }),

  // Delete a review import record
  deleteReviewImport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return db.deleteReviewImport(input.id);
    }),

  // Re-analyze reviews from a previous import (uses stored analysisId to find reviews)
  reAnalyzeImport: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const record = await db.getReviewImportById(input.id);
      if (!record) throw new Error("Review import not found");

      const project = await db.getProjectById(record.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Get the linked analysis to access review data
      if (!record.analysisId) throw new Error("No linked analysis found for this import");

      const analysis = await db.getCompetitorAnalysesByProject(record.projectId);
      const linkedAnalysis = analysis.find(a => a.id === record.analysisId);
      if (!linkedAnalysis) throw new Error("Linked analysis not found");

      // Re-run review analysis with LLM
      const rawData = linkedAnalysis.rawData ? JSON.parse(linkedAnalysis.rawData) : {};
      const contextParts: string[] = [];
      contextParts.push(`ASIN: ${record.asin}`);
      if (linkedAnalysis.title) contextParts.push(`Title: ${linkedAnalysis.title}`);
      if (linkedAnalysis.bulletPoints) contextParts.push(`Bullet Points: ${linkedAnalysis.bulletPoints}`);
      if (linkedAnalysis.price) contextParts.push(`Price: ${linkedAnalysis.price}`);
      if (linkedAnalysis.rating) contextParts.push(`Rating: ${linkedAnalysis.rating}`);

      // Re-run the competitor analysis
      const analysisResponse = await invokeLLM({
        messages: [
          { role: "system", content: COMPETITOR_ANALYSIS_PROMPT },
          { role: "user", content: `Re-analyze this competitor product with updated insights:\n\n${contextParts.join("\n\n")}` },
        ],
        response_format: { type: "json_object" },
      });

      const analysisContent = typeof analysisResponse.choices[0].message.content === "string"
        ? analysisResponse.choices[0].message.content
        : JSON.stringify(analysisResponse.choices[0].message.content);

      let analysisData: any = {};
      try {
        analysisData = JSON.parse(analysisContent);
      } catch {
        analysisData = { raw: analysisContent };
      }

      // Update the review import status
      await db.updateReviewImport(input.id, { status: "completed" });

      return {
        success: true,
        importId: input.id,
        analysisId: record.analysisId,
        asin: record.asin,
      };
    }),
});
