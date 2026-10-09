import { executeReviewImport, executeSellerSpriteImport, runAnalysisSkill } from "../services/analysisImportExecution";
import { analysisImportJobInputSchema, startAnalysisImportJob, getAnalysisImportJob, listAnalysisImportJobs } from "../services/analysisImportJob";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { TRPCError } from "@trpc/server";
import * as db from "../repositories";
import { COMPETITOR_ANALYSIS_PROMPT, REVIEW_ANALYSIS_PROMPT, COMPARISON_SUMMARY_PROMPT } from "../prompts";
import { parseReviewFile, type ParseResult } from "../reviewParser";
import { requireDb } from "../repositories/dbClient";
import { startAmazonAcquisitionJob } from "../domains/acquisition/acquisitionJobs";
import { findFreshConfirmedSnapshot } from "../domains/acquisition/repository";
import { loadConfirmedSnapshotForConsumer } from "../domains/acquisition/legacyConsumerProjection";
import {
  PROJECT_COMPETITOR_ACQUISITION_CAPABILITIES,
  projectCompetitorConsumerRef,
} from "../domains/acquisition/legacyConsumerContracts";
import { resolveStoredObjectUrl } from "../storage";
import {
  registerCompetitorAnalysisArtifact,
  registerCompetitorComparisonArtifact,
} from "../domains/ai_os/services/businessArtifactRegistry";
import {
  comparisonSelectionKey,
  comparisonSellingPointRowsSchema,
  formatComparisonSummary,
  formatCompetitorAnalysisSummary,
  normalizeSellingPointRows,
  serializeComparisonReport,
} from "../domains/listing/competitorHumanReview";

const PROJECT_COMPETITOR_MAX_USD = 0.1;

async function startProjectCompetitorAcquisition(input: {
  projectId: number;
  workspaceId: number;
  userId: number;
  asin: string;
}) {
  const asin = input.asin.trim().toUpperCase();
  const job = await startAmazonAcquisitionJob({
    workspaceId: input.workspaceId,
    requestedBy: input.userId,
    consumerType: "project_competitor",
    consumerRef: projectCompetitorConsumerRef(input.projectId, asin),
    marketplace: "US",
    asin,
    capabilities: [...PROJECT_COMPETITOR_ACQUISITION_CAPABILITIES],
    cachePolicy: "prefer_cache",
    maxChargeUsd: PROJECT_COMPETITOR_MAX_USD,
  });
  return {
    asin,
    status: job.status === "confirmed" ? "analysis_queued" as const : "direct_ingestion_pending" as const,
    jobId: job.jobId,
    cacheHitSnapshotId: job.cacheHitSnapshotId,
    analysisJobRunId: "analysisJobRunId" in job ? job.analysisJobRunId : null,
    directIngestion: true,
    directIngestionPending: job.status !== "confirmed",
    reviewRequired: false,
  };
}

async function resolveCompetitorImagesForDelivery<T extends { imageUrls?: string | null }>(analysis: T) {
  if (!analysis.imageUrls) return analysis;
  try {
    const refs = JSON.parse(analysis.imageUrls);
    if (!Array.isArray(refs)) return analysis;
    const urls = await Promise.all(refs.map((ref: unknown) => typeof ref === "string" ? resolveStoredObjectUrl(ref) : Promise.resolve("")));
    return { ...analysis, imageUrls: JSON.stringify(urls.filter(Boolean)) };
  } catch {
    return analysis;
  }
}

export const analysisRouter = router({
  // Get all analyses for a project
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      return Promise.all(analyses.map(resolveCompetitorImagesForDelivery));
    }),

  updateSummary: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      analysisId: z.number(),
      summary: z.string().trim().min(1).max(20000),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      const analysis = await db.getCompetitorAnalysisById(input.analysisId);
      if (!analysis || analysis.projectId !== input.projectId) throw new Error("Competitor analysis not found");
      if (analysis.summaryStatus === "confirmed") throw new Error("已确认的竞品分析需要先解锁才能编辑");
      const updated = await db.updateCompetitorAnalysisSummary(input.analysisId, {
        summary: input.summary,
        incrementVersion: true,
      });
      await registerCompetitorAnalysisArtifact(input.analysisId, "user_edit").catch(error => {
        console.warn("[Analysis] Failed to register analysis draft artifact", error);
      });
      return updated;
    }),

  confirmSummary: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      analysisId: z.number(),
      summary: z.string().trim().min(1).max(20000),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      const analysis = await db.getCompetitorAnalysisById(input.analysisId);
      if (!analysis || analysis.projectId !== input.projectId) throw new Error("Competitor analysis not found");
      if (analysis.summaryStatus === "confirmed" && analysis.summary !== input.summary) {
        throw new Error("已确认的竞品分析需要先解锁才能修改");
      }
      const updated = await db.updateCompetitorAnalysisSummary(input.analysisId, {
        summary: input.summary,
        summaryStatus: "confirmed",
        summaryConfirmedBy: ctx.user.id,
        summaryConfirmedAt: new Date(),
        incrementVersion: analysis.summaryStatus !== "confirmed" || analysis.summary !== input.summary,
      });
      await registerCompetitorAnalysisArtifact(input.analysisId, analysis.summary === input.summary ? "system" : "user_edit").catch(error => {
        console.warn("[Analysis] Failed to register confirmed analysis artifact", error);
      });
      return updated;
    }),

  unlockSummary: protectedProcedure
    .input(z.object({ projectId: z.number(), analysisId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      const analysis = await db.getCompetitorAnalysisById(input.analysisId);
      if (!analysis || analysis.projectId !== input.projectId) throw new Error("Competitor analysis not found");
      const updated = await db.updateCompetitorAnalysisSummary(input.analysisId, {
        summaryStatus: "draft",
        summaryConfirmedBy: null,
        summaryConfirmedAt: null,
      });
      await registerCompetitorAnalysisArtifact(input.analysisId, "user_edit").catch(error => {
        console.warn("[Analysis] Failed to register unlocked analysis artifact", error);
      });
      return updated;
    }),

  getComparisonReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      analysisIds: z.array(z.number()).min(2).max(8),
    }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      const report = await db.getLatestCompetitorComparisonReport(
        input.projectId,
        comparisonSelectionKey(input.analysisIds),
      );
      return serializeComparisonReport(report);
    }),

  updateComparisonReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      reportId: z.number(),
      summary: z.string().trim().min(1).max(30000),
      sellingPointRows: comparisonSellingPointRowsSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      const report = await db.getCompetitorComparisonReportById(input.reportId);
      if (!report || report.projectId !== input.projectId) throw new Error("Competitor comparison report not found");
      if (report.status === "confirmed") throw new Error("已确认的竞品对比需要先解锁才能编辑");
      const updated = await db.updateCompetitorComparisonReport(input.reportId, {
        summary: input.summary,
        sellingPointRows: JSON.stringify(input.sellingPointRows),
        incrementVersion: true,
      });
      await registerCompetitorComparisonArtifact(input.reportId, "user_edit").catch(error => {
        console.warn("[Analysis] Failed to register comparison draft artifact", error);
      });
      return serializeComparisonReport(updated);
    }),

  confirmComparisonReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      reportId: z.number(),
      summary: z.string().trim().min(1).max(30000),
      sellingPointRows: comparisonSellingPointRowsSchema,
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      const report = await db.getCompetitorComparisonReportById(input.reportId);
      if (!report || report.projectId !== input.projectId) throw new Error("Competitor comparison report not found");
      const serializedRows = JSON.stringify(input.sellingPointRows);
      if (
        report.status === "confirmed"
        && (report.summary !== input.summary || report.sellingPointRows !== serializedRows)
      ) {
        throw new Error("已确认的竞品对比需要先解锁才能修改");
      }
      const updated = await db.updateCompetitorComparisonReport(input.reportId, {
        summary: input.summary,
        sellingPointRows: serializedRows,
        status: "confirmed",
        confirmedBy: ctx.user.id,
        confirmedAt: new Date(),
        incrementVersion: report.status !== "confirmed"
          || report.summary !== input.summary
          || report.sellingPointRows !== serializedRows,
      });
      await registerCompetitorComparisonArtifact(input.reportId, "user_edit").catch(error => {
        console.warn("[Analysis] Failed to register confirmed comparison artifact", error);
      });
      return serializeComparisonReport(updated);
    }),

  unlockComparisonReport: protectedProcedure
    .input(z.object({ projectId: z.number(), reportId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      const report = await db.getCompetitorComparisonReportById(input.reportId);
      if (!report || report.projectId !== input.projectId) throw new Error("Competitor comparison report not found");
      const updated = await db.updateCompetitorComparisonReport(input.reportId, {
        status: "draft",
        confirmedBy: null,
        confirmedAt: null,
      });
      await registerCompetitorComparisonArtifact(input.reportId, "user_edit").catch(error => {
        console.warn("[Analysis] Failed to register unlocked comparison artifact", error);
      });
      return serializeComparisonReport(updated);
    }),

  // Preview only from an already confirmed controlled snapshot; never calls a provider.
  scrapeAsin: protectedProcedure
    .input(z.object({
      asin: z.string().min(10).max(10),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId) throw new TRPCError({ code: "BAD_REQUEST", message: "当前工作空间不可用" });
      const database = await requireDb("Confirmed Amazon competitor preview");
      const confirmed = await findFreshConfirmedSnapshot({
        db: database,
        workspaceId: ctx.workspaceId,
        marketplace: "US",
        asin: input.asin.toUpperCase(),
        freshAfter: new Date(0),
      });
      if (!confirmed) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该ASIN尚无已直接录入的采集快照，请先创建采集任务并等待完整安全校验完成" });
      }
      const snapshot = await loadConfirmedSnapshotForConsumer({
        db: database,
        workspaceId: ctx.workspaceId,
        confirmedSnapshotId: confirmed.id,
      });
      const imageUrls = await Promise.all(snapshot.assets
        .filter((asset: any) => asset.role === "main" || asset.role === "secondary")
        .sort((a: any, b: any) => a.positionIndex - b.positionIndex)
        .map((asset: any) => resolveStoredObjectUrl(asset.storageKey)));
      return {
        ...snapshot.data,
        price: snapshot.data.price ? `${snapshot.data.price.value} ${snapshot.data.price.currency}` : null,
        imageUrls,
        reviews: [],
        confirmedSnapshotId: confirmed.id,
        source: "unified_amazon_acquisition" as const,
      };
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

      if (!project.workspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "项目尚未绑定工作空间" });
      return startProjectCompetitorAcquisition({
        projectId: input.projectId,
        workspaceId: project.workspaceId,
        userId: ctx.user.id,
        asin: input.asin,
      });
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

      if (!project.workspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "项目尚未绑定工作空间" });
      const results: Array<{
        asin: string;
        status: "analysis_queued" | "direct_ingestion_pending" | "failed";
        jobId?: number;
        directIngestionPending?: boolean;
        error?: string;
      }> = [];

      // Process each ASIN sequentially to avoid rate limiting
      for (const asin of uniqueAsins) {
        try {
          const result = await startProjectCompetitorAcquisition({
            projectId: input.projectId,
            asin,
            userId: ctx.user.id,
            workspaceId: project.workspaceId,
          });
          results.push(result);
        } catch (error: any) {
          console.error(`[BatchAnalysis] Failed for ${asin}: ${error.message}`);
          results.push({
            asin,
            status: "failed",
            error: error.message || "Unknown error",
          });
        }

      }

      const successCount = results.filter(r => r.status === "analysis_queued").length;
      const partialCount = results.filter(r => r.status === "direct_ingestion_pending").length;
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

      const analysisData = await runAnalysisSkill<any>({
        skillSlug: "listing.competitor.analyze",
        userId: ctx.user.id,
        workspaceId: project.workspaceId,
        context: `Analyze this competitor product:\n\n${contextParts.join("\n\n")}`,
        legacySystemPrompt: COMPETITOR_ANALYSIS_PROMPT,
      });
      const structuredSummary = formatCompetitorAnalysisSummary(analysisData);

      // Analyze reviews if provided
      let reviewAnalysis: any = null;
      if (input.reviews && input.reviews.trim().length > 0) {
        reviewAnalysis = await runAnalysisSkill<any>({
          skillSlug: "analysis.review.extract",
          userId: ctx.user.id,
          workspaceId: project.workspaceId,
          context: `Analyze these customer reviews:\n\n${input.reviews}`,
          legacySystemPrompt: REVIEW_ANALYSIS_PROMPT,
        });
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
        aiSummary: structuredSummary,
        summary: structuredSummary,
        summaryStatus: "draft",
      });
      await registerCompetitorAnalysisArtifact(saved.id, "ai_output").catch(error => {
        console.warn("[Analysis] Failed to register manual competitor artifact", error);
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
      const requestedAnalysisIds = [...new Set(input.analysisIds)].sort((a, b) => a - b);
      const selectedAnalyses = allAnalyses.filter(a => requestedAnalysisIds.includes(a.id));

      if (selectedAnalyses.length !== requestedAnalysisIds.length) {
        throw new Error("部分竞品分析不存在或不属于当前项目");
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

      const comparisonData = await runAnalysisSkill<any>({
        skillSlug: "analysis.competitor.multi",
        userId: ctx.user.id,
        workspaceId: project.workspaceId,
        context: userMessage,
        legacySystemPrompt: COMPARISON_SUMMARY_PROMPT,
      });

      const summary = formatComparisonSummary(comparisonData);
      const sellingPointRows = normalizeSellingPointRows(comparisonData, selectedAnalyses);
      const selectionKey = comparisonSelectionKey(requestedAnalysisIds);
      const previousReport = await db.getLatestCompetitorComparisonReport(input.projectId, selectionKey);
      const report = await db.createCompetitorComparisonReport({
        workspaceId: project.workspaceId ?? null,
        projectId: input.projectId,
        userId: ctx.user.id,
        selectionKey,
        analysisIds: JSON.stringify(requestedAnalysisIds),
        analyzedAsins: JSON.stringify(selectedAnalyses.map(a => a.asin)),
        aiSummary: summary,
        summary,
        sellingPointRows: JSON.stringify(sellingPointRows),
        status: "draft",
        version: (previousReport?.version || 0) + 1,
      });

      if (!report) throw new Error("Failed to save competitor comparison report");
      await registerCompetitorComparisonArtifact(report.id, "ai_output").catch(error => {
        console.warn("[Analysis] Failed to register comparison artifact", error);
      });

      return {
        report: serializeComparisonReport(report),
        summary,
        sellingPointRows,
        analyzedAsins: selectedAnalyses.map(a => a.asin),
        analyzedCount: selectedAnalyses.length,
      };
    }),

  // Import reviews from Excel/CSV file (base64 encoded)
  startImportJob: protectedProcedure
    .input(analysisImportJobInputSchema)
    .mutation(({ ctx, input }) => startAnalysisImportJob(input, { userId: ctx.user.id, workspaceId: ctx.workspaceId })),

  getImportJob: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), runId: z.string().min(1).max(80) }))
    .query(({ ctx, input }) => getAnalysisImportJob(input, { userId: ctx.user.id, workspaceId: ctx.workspaceId })),

  listImportJobs: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), limit: z.number().int().min(1).max(50).optional() }))
    .query(({ ctx, input }) => listAnalysisImportJobs(input, { userId: ctx.user.id, workspaceId: ctx.workspaceId })),

  importReviews: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      fileBase64: z.string(),
      filename: z.string(),
      // Legacy: optional ASIN for backward compatibility (ignored if file contains ASIN column)
      asin: z.string().optional(),
    }))
    .mutation(({ ctx, input }) => executeReviewImport(input, ctx.user.id)),

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

      await runAnalysisSkill<any>({
        skillSlug: "listing.competitor.analyze",
        userId: ctx.user.id,
        workspaceId: project.workspaceId,
        context: `Re-analyze this competitor product with updated insights:\n\n${contextParts.join("\n\n")}`,
        legacySystemPrompt: COMPETITOR_ANALYSIS_PROMPT,
      });

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
    .mutation(({ ctx, input }) => executeSellerSpriteImport(input, ctx.user.id)),

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
