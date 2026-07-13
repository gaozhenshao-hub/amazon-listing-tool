import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import { COMPETITOR_ANALYSIS_PROMPT, REVIEW_ANALYSIS_PROMPT, COMPARISON_SUMMARY_PROMPT } from "../prompts";
import { scrapeAmazonProduct, type AmazonProductData } from "../scraper";
import { getScraperConfig } from "./systemSettings";
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
    const scraperCfg = await getScraperConfig();
    scrapedData = await scrapeAmazonProduct(asin, scraperCfg);
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

  // Step 5: Save analysis to database (upsert to prevent duplicates)
  const saved = await db.upsertCompetitorAnalysis({
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
      const scraperCfg2 = await getScraperConfig();
      const data = await scrapeAmazonProduct(input.asin, scraperCfg2);
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

      // Save analysis to database (upsert to prevent duplicates)
      const saved = await db.upsertCompetitorAnalysis({
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

      // [Emperor] 优先调用 Emperor Skill: analysis.comparison.summary

      try {

        const _emperorRes = await runSkillViaEmperor("analysis.comparison.summary", { context: JSON.stringify({}).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] analysis.ts fallback:", _e); }

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
      fileBase64: z.string(),
      filename: z.string(),
      // Legacy: optional ASIN for backward compatibility (ignored if file contains ASIN column)
      asin: z.string().optional(),
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
        throw new Error(`\u6587\u4ef6\u89e3\u6790\u5931\u8d25: ${error.message}`);
      }

      if (parseResult.reviews.length === 0) {
        throw new Error("\u6587\u4ef6\u4e2d\u672a\u627e\u5230\u6709\u6548\u7684\u8bc4\u8bba\u6570\u636e\u3002\u8bf7\u786e\u4fdd\u6587\u4ef6\u5305\u542b\u8bc4\u8bba\u5185\u5bb9\u5217\u3002");
      }

      // Get existing competitor analyses for ASIN matching
      const existingAnalyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const existingAsinMap = new Map<string, typeof existingAnalyses[0]>();
      for (const a of existingAnalyses) {
        existingAsinMap.set(a.asin.toUpperCase(), a);
      }

      // Group reviews by ASIN (from file or fallback)
      const reviewsByAsin = new Map<string, typeof parseResult.reviews>();
      let noAsinReviews: typeof parseResult.reviews = [];

      for (const review of parseResult.reviews) {
        if (review.asin) {
          const asinKey = review.asin.toUpperCase();
          if (!reviewsByAsin.has(asinKey)) reviewsByAsin.set(asinKey, []);
          reviewsByAsin.get(asinKey)!.push(review);
        } else {
          noAsinReviews.push(review);
        }
      }

      // If no ASIN column detected, treat all reviews as one group
      // Use the legacy asin input or "UNKNOWN" as fallback
      if (reviewsByAsin.size === 0) {
        const fallbackAsin = input.asin?.toUpperCase() || "UNKNOWN";
        reviewsByAsin.set(fallbackAsin, parseResult.reviews);
        noAsinReviews = [];
      } else if (noAsinReviews.length > 0) {
        // Assign reviews without ASIN to the most common ASIN in the file
        const largestAsin = Array.from(reviewsByAsin.entries()).sort((a, b) => b[1].length - a[1].length)[0][0];
        reviewsByAsin.get(largestAsin)!.push(...noAsinReviews);
        noAsinReviews = [];
      }

      // Process each ASIN group
      const results: Array<{
        asin: string;
        status: "matched" | "new" | "failed";
        reviewCount: number;
        analysisId?: number;
        importId?: number;
        error?: string;
      }> = [];

      for (const [asin, reviews] of Array.from(reviewsByAsin.entries())) {
        try {
          const reviewText = reviewsToText(reviews);
          const existingAnalysis = existingAsinMap.get(asin);

          // Run review analysis LLM
          const reviewResponse = await invokeLLM({
            messages: [
              { role: "system", content: REVIEW_ANALYSIS_PROMPT },
              { role: "user", content: `Analyze these ${reviews.length} customer reviews for ASIN ${asin} imported from a seller tool (\u5356\u5bb6\u7cbe\u7075/SellerSprite):\n\n${reviewText.substring(0, 12000)}` },
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

          let analysisId: number;

          if (existingAnalysis) {
            // ASIN matches existing competitor analysis -> update review data
            const existingRawData = existingAnalysis.rawData ? JSON.parse(existingAnalysis.rawData) : {};
            await db.updateCompetitorAnalysisReviews(existingAnalysis.id, {
              reviewCount: String(reviews.length),
              reviewAnalysis: reviewAnalysis ? JSON.stringify(reviewAnalysis) : (existingAnalysis.reviewAnalysis ?? undefined),
              rawData: JSON.stringify({
                ...existingRawData,
                importedReviews: true,
                reviewImport: {
                  filename: input.filename,
                  totalRows: parseResult.totalRows,
                  parsedRows: reviews.length,
                  skippedRows: 0,
                  detectedFormat: parseResult.detectedFormat,
                  columns: parseResult.columns,
                },
              }),
            });
            analysisId = existingAnalysis.id;

            results.push({ asin, status: "matched", reviewCount: reviews.length, analysisId });
          } else {
            // No existing analysis for this ASIN -> run full competitor analysis and create new
            const analysisResponse = await invokeLLM({
              messages: [
                { role: "system", content: COMPETITOR_ANALYSIS_PROMPT },
                { role: "user", content: `Analyze this competitor product:\n\nASIN: ${asin}\n\nCustomer Reviews Summary (${reviews.length} reviews imported from file):\n${reviewText.substring(0, 8000)}` },
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

            const saved = await db.upsertCompetitorAnalysis({
              projectId: input.projectId,
              asin,
              title: null,
              bulletPoints: null,
              price: null,
              rating: null,
              reviewCount: String(reviews.length),
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
                  parsedRows: reviews.length,
                  skippedRows: 0,
                  detectedFormat: parseResult.detectedFormat,
                  columns: parseResult.columns,
                },
              }),
            });
            analysisId = saved.id;

            results.push({ asin, status: "new", reviewCount: reviews.length, analysisId });
          }

          // Save import record
          const importRecord = await db.createReviewImport({
            projectId: input.projectId,
            userId: ctx.user.id,
            asin,
            filename: input.filename,
            fileSize: buffer.length,
            totalRows: parseResult.totalRows,
            parsedRows: reviews.length,
            skippedRows: 0,
            detectedFormat: parseResult.detectedFormat,
            columns: JSON.stringify(parseResult.columns),
            analysisId,
            status: "completed",
            metadata: JSON.stringify({ autoMatched: !!existingAnalysis }),
          });

          // Update importId in result
          const lastResult = results[results.length - 1];
          if (lastResult) lastResult.importId = importRecord.id;
        } catch (error: any) {
          results.push({ asin, status: "failed", reviewCount: reviews.length, error: error.message });
        }
      }

      return {
        status: "success" as const,
        totalReviews: parseResult.reviews.length,
        totalAsins: reviewsByAsin.size,
        detectedAsins: parseResult.detectedAsins,
        results,
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

      // Return preview with first 5 reviews and detected ASINs
      return {
        totalRows: parseResult.totalRows,
        parsedRows: parseResult.parsedRows,
        skippedRows: parseResult.skippedRows,
        detectedFormat: parseResult.detectedFormat,
        columns: parseResult.columns,
        detectedAsins: parseResult.detectedAsins,
        previewReviews: parseResult.reviews.slice(0, 5).map(r => ({
          title: r.title,
          content: r.content.substring(0, 200) + (r.content.length > 200 ? "..." : ""),
          rating: r.rating,
          date: r.date,
          author: r.author,
          asin: r.asin,
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

  // ─── Analyze from SellerSprite Excel (产品搜索结果文件) ───────────────
  analyzeFromSellerSprite: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileBase64: z.string(),
      filename: z.string(),
      // Optional: only import selected ASINs (empty = import all)
      selectedAsins: z.array(z.string()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Decode base64 and convert Excel → CSV text for SellerSprite parser
      const buffer = Buffer.from(input.fileBase64, "base64");
      const { parseSellerSpriteData } = await import("./sellerSpriteImporter");
      let csvText: string;
      const lowerName = input.filename.toLowerCase();
      if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buffer, { type: "buffer", cellText: true, raw: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        csvText = XLSX.utils.sheet_to_csv(ws, { forceQuotes: true });
      } else {
        csvText = buffer.toString("utf-8");
      }
      const parseResult = parseSellerSpriteData(csvText, undefined);

      if (!parseResult.success || parseResult.products.length === 0) {
        throw new Error(`文件解析失败: ${parseResult.errors.join("; ") || "未找到有效产品数据"}`);
      }

      // Filter by selected ASINs if provided
      const productsToProcess = input.selectedAsins && input.selectedAsins.length > 0
        ? parseResult.products.filter(p => input.selectedAsins!.includes(p.asin))
        : parseResult.products;

      if (productsToProcess.length === 0) {
        throw new Error("没有选中的产品数据可导入");
      }

      const results: Array<{
        asin: string;
        status: "success" | "failed";
        analysisId?: number;
        title?: string;
        error?: string;
      }> = [];

      for (const product of productsToProcess) {
        try {
          // Build context for LLM analysis from SellerSprite data
          const contextParts: string[] = [];
          contextParts.push(`ASIN: ${product.asin}`);
          if (product.title) contextParts.push(`Title: ${product.title}`);
          if (product.brand) contextParts.push(`Brand: ${product.brand}`);
          if (product.bulletPoints && product.bulletPoints.length > 0) {
            contextParts.push(`Bullet Points:\n${product.bulletPoints.map((bp, i) => `${i + 1}. ${bp}`).join("\n")}`);
          }
          if (product.price) contextParts.push(`Price: $${product.price}`);
          if (product.rating) contextParts.push(`Rating: ${product.rating}/5 (${product.reviewCount || 0} reviews)`);
          if (product.monthlySales) contextParts.push(`Monthly Sales: ${product.monthlySales} units`);
          if (product.monthlyRevenue) contextParts.push(`Monthly Revenue: $${product.monthlyRevenue}`);
          if (product.bsrRank) contextParts.push(`BSR: #${product.bsrRank} in ${product.category || "main category"}`);
          if (product.subCategoryRank) contextParts.push(`Sub-category BSR: #${product.subCategoryRank}`);
          if (product.launchDate) contextParts.push(`Launch Date: ${product.launchDate}`);
          if (product.variationCount) contextParts.push(`Variations: ${product.variationCount}`);
          if (product.fulfillment) contextParts.push(`Fulfillment: ${product.fulfillment}`);
          if (product.grossMargin) contextParts.push(`Gross Margin: ${(product.grossMargin * 100).toFixed(1)}%`);
          if (product.hasSPAd) contextParts.push(`SP Ads: Yes`);
          if (product.hasBrandAd) contextParts.push(`Brand Ads: Yes`);
          if (product.hasAplus) contextParts.push(`A+ Content: Yes`);
          if (product.hasBestSeller) contextParts.push(`Badge: Best Seller`);
          if (product.hasAmazonChoice) contextParts.push(`Badge: Amazon's Choice`);
          if (product.imageCount) contextParts.push(`Image Count: ${product.imageCount}`);

          const analysisResponse = await invokeLLM({
            messages: [
              { role: "system", content: COMPETITOR_ANALYSIS_PROMPT },
              { role: "user", content: `Analyze this competitor product from SellerSprite data:\n\n${contextParts.join("\n\n")}` },
            ],
            response_format: { type: "json_object" },
          });

          const analysisContent = typeof analysisResponse.choices[0].message.content === "string"
            ? analysisResponse.choices[0].message.content
            : JSON.stringify(analysisResponse.choices[0].message.content);

          let analysisData: any = {};
          try { analysisData = JSON.parse(analysisContent); } catch { analysisData = { raw: analysisContent }; }

          const bulletPointsArray = product.bulletPoints || [];

          const saved = await db.upsertCompetitorAnalysis({
            projectId: input.projectId,
            asin: product.asin,
            title: product.title ?? null,
            bulletPoints: bulletPointsArray.length > 0 ? JSON.stringify(bulletPointsArray) : null,
            price: product.price ? String(product.price) : null,
            rating: product.rating ? String(product.rating) : null,
            reviewCount: product.reviewCount ? String(product.reviewCount) : null,
            reviewAnalysis: null,
            keywords: analysisData.keywords ? JSON.stringify(analysisData.keywords) : null,
            imageUrls: null,
            rawData: JSON.stringify({
              ...analysisData,
              sellerSpriteData: {
                monthlySales: product.monthlySales,
                monthlyRevenue: product.monthlyRevenue,
                bsrRank: product.bsrRank,
                subCategoryRank: product.subCategoryRank,
                launchDate: product.launchDate,
                variationCount: product.variationCount,
                fulfillment: product.fulfillment,
                grossMargin: product.grossMargin,
                fbaFee: product.fbaFee,
                sellerCount: product.sellerCount,
                hasSPAd: product.hasSPAd,
                hasBrandAd: product.hasBrandAd,
                hasAplus: product.hasAplus,
                hasBestSeller: product.hasBestSeller,
                hasAmazonChoice: product.hasAmazonChoice,
                brand: product.brand,
                category: product.category,
                imageCount: product.imageCount,
              },
              importSource: "sellersprite_search",
            }),
          });

          results.push({ asin: product.asin, status: "success", analysisId: saved.id, title: product.title });
        } catch (err: any) {
          results.push({ asin: product.asin, status: "failed", error: err.message });
        }
      }

      return {
        success: true,
        totalParsed: parseResult.products.length,
        processed: results.length,
        succeeded: results.filter(r => r.status === "success").length,
        failed: results.filter(r => r.status === "failed").length,
        results,
        warnings: parseResult.warnings,
      };
    }),

  // Preview SellerSprite Excel file before import (no DB write)
  previewSellerSpriteFile: protectedProcedure
    .input(z.object({
      fileBase64: z.string(),
      filename: z.string(),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const { parseSellerSpriteData } = await import("./sellerSpriteImporter");
      let csvText: string;
      const lowerName = input.filename.toLowerCase();
      if (lowerName.endsWith(".xlsx") || lowerName.endsWith(".xls")) {
        const XLSX = await import("xlsx");
        const wb = XLSX.read(buffer, { type: "buffer", cellText: true, raw: false });
        const ws = wb.Sheets[wb.SheetNames[0]];
        csvText = XLSX.utils.sheet_to_csv(ws, { forceQuotes: true });
      } else {
        csvText = buffer.toString("utf-8");
      }
      const parseResult = parseSellerSpriteData(csvText, undefined);

      return {
        success: parseResult.success,
        fileType: parseResult.fileType,
        totalRows: parseResult.totalRows,
        parsedRows: parseResult.parsedRows,
        warnings: parseResult.warnings,
        errors: parseResult.errors,
        // Return preview of first 60 products with key fields only
        products: parseResult.products.slice(0, 60).map(p => ({
          asin: p.asin,
          title: p.title,
          brand: p.brand,
          price: p.price,
          rating: p.rating,
          reviewCount: p.reviewCount,
          monthlySales: p.monthlySales,
          monthlyRevenue: p.monthlyRevenue,
          bsrRank: p.bsrRank,
          subCategoryRank: p.subCategoryRank,
          launchDate: p.launchDate,
          fulfillment: p.fulfillment,
          grossMargin: p.grossMargin,
          hasSPAd: p.hasSPAd,
          hasAplus: p.hasAplus,
          hasBestSeller: p.hasBestSeller,
          hasAmazonChoice: p.hasAmazonChoice,
          category: p.category,
        })),
      };
    }),
});
