import { createHash } from "node:crypto";
import * as db from "../repositories";
import { COMPETITOR_ANALYSIS_PROMPT, REVIEW_ANALYSIS_PROMPT } from "../prompts";
import { parseReviewFile, reviewsToText, type ParseResult } from "../reviewParser";
import { registerCompetitorAnalysisArtifact } from "../domains/ai_os/services/businessArtifactRegistry";
import { formatCompetitorAnalysisSummary } from "../domains/listing/competitorHumanReview";
import { runEmperorSkill, safeParseSkillJSON } from "../domains/ai_os/services/skillRunner";
import { classifySellerSpriteBatchFailure, type SellerSpriteBatchFailure } from "../routers/sellerSpriteBatchFailure";

export type ImportItemResult = { asin: string; status: "matched" | "new" | "success" | "failed"; analysisId?: number; importId?: number; reviewCount?: number; title?: string; error?: string; failure?: SellerSpriteBatchFailure };
export type ImportExecutionOptions = {
  signal?: AbortSignal;
  assertActive?: () => Promise<void>;
  completedResults?: ImportItemResult[];
  onProgress?: (results: ImportItemResult[], total: number) => Promise<void>;
};
export type ImportFileInput = { projectId: number; fileBase64: string; filename: string; asin?: string; selectedAsins?: string[] };

export function retainSavedImportResults(
  results: ImportItemResult[],
  analyses: Array<{ id: number; asin: string; rawData: string | null }>,
  sourceHash: string,
  kind: "reviews" | "sellersprite",
) {
  return results.filter(row => row.status !== "failed" && analyses.some(analysis => {
    if (analysis.id !== row.analysisId || analysis.asin.toUpperCase() !== row.asin.toUpperCase()) return false;
    try {
      const raw = JSON.parse(analysis.rawData || "{}");
      return kind === "reviews" ? raw.reviewImport?.sourceHash === sourceHash : raw.sellerSpriteSourceHash === sourceHash;
    } catch { return false; }
  }));
}

type AnalysisSkillSlug =
  | "listing.competitor.analyze"
  | "analysis.competitor.multi"
  | "analysis.review.extract";

export async function runAnalysisSkill<T>(input: {
  skillSlug: AnalysisSkillSlug;
  userId: number;
  workspaceId?: number | null;
  context: string;
  legacySystemPrompt: string;
  signal?: AbortSignal;
  assertActive?: () => Promise<void>;
}): Promise<T> {
  input.signal?.throwIfAborted();
  await input.assertActive?.();
  const result = await runEmperorSkill<T>({
    signal: input.signal,
    skillSlug: input.skillSlug,
    userId: input.userId,
    workspaceId: input.workspaceId,
    context: input.context,
    variables: { context: input.context },
    legacySystemPrompt: input.legacySystemPrompt,
    migrationSource: "server/routers/analysis.ts",
    validate: (content) => {
      const parsed = safeParseSkillJSON<T>(content);
      if (
        parsed
        && typeof parsed === "object"
        && !Array.isArray(parsed)
        && Object.keys(parsed).length === 1
        && "raw" in parsed
      ) {
        throw new Error("皇帝 Skill 返回内容不是有效 JSON");
      }
      return parsed as T;
    },
  });
  input.signal?.throwIfAborted();
  await input.assertActive?.();
  return result.parsed;
}

export async function executeReviewImport(input: ImportFileInput, userId: number, options: ImportExecutionOptions = {}) {
  const project = await db.getProjectById(input.projectId, userId);
  if (!project) throw new Error("Project not found");

  // Decode base64 file
  const buffer = Buffer.from(input.fileBase64, "base64");
  const sourceHash = createHash("sha256").update(buffer).digest("hex");

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
  }> = retainSavedImportResults(options.completedResults || [], existingAnalyses, sourceHash, "reviews") as any;

  for (const [asin, reviews] of Array.from(reviewsByAsin.entries())) {
    options.signal?.throwIfAborted();
    await options.assertActive?.();
    if (results.some(r => r.asin === asin && r.status !== "failed")) continue;
    try {
      const reviewText = reviewsToText(reviews);
      const existingAnalysis = existingAsinMap.get(asin);
      const existingRawData = existingAnalysis?.rawData ? JSON.parse(existingAnalysis.rawData) : {};
      // The domain record is a second durable checkpoint if a worker stops after
      // saving the analysis but before persisting the batch's progress.
      if (existingAnalysis?.reviewAnalysis && existingRawData.reviewImport?.sourceHash === sourceHash) {
        results.push({ asin, status: "matched", reviewCount: reviews.length, analysisId: existingAnalysis.id });
        continue;
      }

      const reviewAnalysis = await runAnalysisSkill<any>({
        skillSlug: "analysis.review.extract",
        userId: userId,
        workspaceId: project.workspaceId,
        signal: options.signal,
        assertActive: options.assertActive,
        context: `Analyze these ${reviews.length} customer reviews for ASIN ${asin} imported from a seller tool (\u5356\u5bb6\u7cbe\u7075/SellerSprite):\n\n${reviewText.substring(0, 12000)}`,
        legacySystemPrompt: REVIEW_ANALYSIS_PROMPT,
      });

      options.signal?.throwIfAborted();
      let analysisId: number;

      if (existingAnalysis) {
        // ASIN matches existing competitor analysis -> update review data
        await db.updateCompetitorAnalysisReviews(existingAnalysis.id, {
          reviewCount: String(reviews.length),
          reviewAnalysis: reviewAnalysis ? JSON.stringify(reviewAnalysis) : (existingAnalysis.reviewAnalysis ?? undefined),
          rawData: JSON.stringify({
            ...existingRawData,
            importedReviews: true,
            reviewImport: {
              sourceHash,
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
        const analysisData = await runAnalysisSkill<any>({
          skillSlug: "listing.competitor.analyze",
          userId: userId,
          workspaceId: project.workspaceId,
          signal: options.signal,
          assertActive: options.assertActive,
          context: `Analyze this competitor product:\n\nASIN: ${asin}\n\nCustomer Reviews Summary (${reviews.length} reviews imported from file):\n${reviewText.substring(0, 8000)}`,
          legacySystemPrompt: COMPETITOR_ANALYSIS_PROMPT,
        });
        options.signal?.throwIfAborted();
        const structuredSummary = formatCompetitorAnalysisSummary(analysisData);

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
              sourceHash,
              filename: input.filename,
              totalRows: parseResult.totalRows,
              parsedRows: reviews.length,
              skippedRows: 0,
              detectedFormat: parseResult.detectedFormat,
              columns: parseResult.columns,
            },
          }),
          aiSummary: structuredSummary,
          summary: structuredSummary,
          summaryStatus: "draft",
        });
        await registerCompetitorAnalysisArtifact(saved.id, "ai_output").catch(error => {
          console.warn("[Analysis] Failed to register imported competitor artifact", error);
        });
        analysisId = saved.id;

        results.push({ asin, status: "new", reviewCount: reviews.length, analysisId });
      }

      // Save import record
      const importRecord = await db.createReviewImport({
        projectId: input.projectId,
        userId: userId,
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
      options.signal?.throwIfAborted();
      await options.assertActive?.();
      const alreadySaved = results.find(row => row.asin === asin && row.status !== "failed");
      if (alreadySaved) {
        // The analysis is durable; a history-row failure must not rerun paid AI.
        alreadySaved.error = "分析已保存，导入历史记录暂未保存";
      } else {
        const failure = classifySellerSpriteBatchFailure(error);
        results.push({ asin, status: "failed", reviewCount: reviews.length, error: failure.message, failure } as any);
      }
    } finally {
      await options.onProgress?.(results, reviewsByAsin.size);
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
}

export async function executeSellerSpriteImport(input: ImportFileInput, userId: number, options: ImportExecutionOptions = {}) {
  const project = await db.getProjectById(input.projectId, userId);
  if (!project) throw new Error("Project not found");

  // Decode base64 and convert Excel → CSV text for SellerSprite parser
  const buffer = Buffer.from(input.fileBase64, "base64");
  const sourceHash = createHash("sha256").update(buffer).digest("hex");
  const existingAnalyses = await db.getCompetitorAnalysesByProject(input.projectId);
  const existingAsinMap = new Map(existingAnalyses.map(row => [row.asin.toUpperCase(), row]));
  const { parseSellerSpriteData } = await import("../routers/sellerSpriteImporter");
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
    failure?: SellerSpriteBatchFailure;
  }> = retainSavedImportResults(options.completedResults || [], existingAnalyses, sourceHash, "sellersprite") as any;

  for (const product of productsToProcess) {
    options.signal?.throwIfAborted();
    await options.assertActive?.();
    if (results.some(r => r.asin === product.asin && r.status !== "failed")) continue;
    try {
      const existing = existingAsinMap.get(product.asin);
      const existingRaw = existing?.rawData ? JSON.parse(existing.rawData) : {};
      if (existing && existingRaw.sellerSpriteSourceHash === sourceHash) {
        results.push({ asin: product.asin, status: "success", analysisId: existing.id, title: product.title });
        continue;
      }
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

      const analysisData = await runAnalysisSkill<any>({
        skillSlug: "listing.competitor.analyze",
        userId: userId,
        workspaceId: project.workspaceId,
        signal: options.signal,
        assertActive: options.assertActive,
        context: `Analyze this competitor product from SellerSprite data:\n\n${contextParts.join("\n\n")}`,
        legacySystemPrompt: COMPETITOR_ANALYSIS_PROMPT,
      });
      options.signal?.throwIfAborted();
      const structuredSummary = formatCompetitorAnalysisSummary(analysisData);

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
          sellerSpriteSourceHash: sourceHash,
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
        aiSummary: structuredSummary,
        summary: structuredSummary,
        summaryStatus: "draft",
      });
      await registerCompetitorAnalysisArtifact(saved.id, "ai_output").catch(error => {
        console.warn("[Analysis] Failed to register SellerSprite competitor artifact", error);
      });

      results.push({ asin: product.asin, status: "success", analysisId: saved.id, title: product.title });
    } catch (err: unknown) {
      options.signal?.throwIfAborted();
      await options.assertActive?.();
      const failure = classifySellerSpriteBatchFailure(err);
      console.warn("[SellerSpriteBatch] Competitor analysis failed", {
        asin: product.asin,
        failureCode: failure.code,
        retryable: failure.retryable,
      });
      results.push({
        asin: product.asin,
        status: "failed",
        error: failure.message,
        failure,
      });
    } finally {
      await options.onProgress?.(results, productsToProcess.length);
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
}
