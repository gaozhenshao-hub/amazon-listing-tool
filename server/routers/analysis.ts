import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import { COMPETITOR_ANALYSIS_PROMPT, REVIEW_ANALYSIS_PROMPT } from "../prompts";
import { scrapeAmazonProduct, type AmazonProductData } from "../scraper";

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

  // Delete an analysis
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return db.deleteCompetitorAnalysis(input.id);
    }),
});
