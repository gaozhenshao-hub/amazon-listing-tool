import { z } from "zod";
import { analyzeCollectedListing, confirmCollectedAnalysis } from '../domains/listing/collectedListing';
import { ensureCompetitorWorkflow, syncCompetitorWorkflow } from '../domains/listing/competitorWorkflow';
import { hydrateCompetitorEvidence, startCompetitorPresentation, needsCompetitorPresentation } from '../domains/listing/competitorPresentation';
import { readJson } from '../../shared/competitorPresentation';
import { getAiJobRun } from '../services/aiJobRunner';
import { router } from "../_core/trpc";
import { protectedProcedure } from "../domains/listing/listingProcedure";
import { TRPCError } from "@trpc/server";
import type { TrpcContext } from "../_core/context";
import { competitorRevision } from "../repositories/project/competitorWritePolicy";
import * as db from "../repositories";
import { COMPARISON_SUMMARY_PROMPT } from "../prompts";
import { startAmazonAcquisitionJob } from "../domains/acquisition/acquisitionJobs";
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
  normalizeSellingPointRows,
  serializeComparisonReport,
} from "../domains/listing/competitorHumanReview";
import {
  runEmperorSkill,
  safeParseSkillJSON,
} from "../domains/ai_os/services/skillRunner";
type AnalysisSkillSlug = "analysis.competitor.multi";

async function runAnalysisSkill<T>(input: {
  skillSlug: AnalysisSkillSlug;
  userId: number;
  workspaceId?: number | null;
  context: string;
  legacySystemPrompt: string;
}): Promise<T> {
  const result = await runEmperorSkill<T>({
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
  return result.parsed;
}


async function scopedProject(ctx: TrpcContext & { user: NonNullable<TrpcContext["user"]> }, projectId: number) {
  const workspaceId = ctx.workspaceId ?? null;
  const project = await db.getProjectById(projectId, ctx.user.id, workspaceId);
  if (!project || project.id !== projectId || project.userId !== ctx.user.id
    || (project.workspaceId !== null && project.workspaceId !== workspaceId)) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
  }
  return project;
}

async function startProjectCompetitorAcquisition(input: {
  projectId: number;
  workspaceId: number;
  userId: number;
  asin: string;
  refresh?: boolean;
}) {
  const asin = input.asin.trim().toUpperCase();
  const job = await startAmazonAcquisitionJob({
    workspaceId: input.workspaceId,
    requestedBy: input.userId,
    consumerType: "project_competitor",
    consumerRef: projectCompetitorConsumerRef(input.projectId, asin, true),
    marketplace: "US",
    asin,
    capabilities: [...PROJECT_COMPETITOR_ACQUISITION_CAPABILITIES],
    cachePolicy: input.refresh ? 'refresh' : 'prefer_cache',
  });
  if (["failed", "canceled"].includes(job.status)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "采集未成功，请查看采集记录后重试" });
  }
  return {
    asin,
    status: job.status === "confirmed" ? "captured" as const : "review_required" as const,
    jobId: job.jobId,
    cacheHitSnapshotId: job.cacheHitSnapshotId,
    analysisJobRunId: "analysisJobRunId" in job ? job.analysisJobRunId : null,
    reviewRequired: job.status !== "confirmed",
  };
}

async function resolveCompetitorImagesForDelivery<T extends { imageUrls?: string | null; rawData?:string|null }>(analysis: T) {
  try {
    const refs = JSON.parse(analysis.imageUrls||'[]');
    if (!Array.isArray(refs)) return analysis;
    const urls = await Promise.all(refs.map((ref: unknown) => typeof ref === "string" ? resolveStoredObjectUrl(ref) : Promise.resolve("")));
    const raw=readJson(analysis.rawData)||{};
    const imageAssets=await Promise.all((raw.imageAssets||[]).map(async(a:any)=>({...a,url:await resolveStoredObjectUrl(a.storageKey).catch(()=>'' )})));
    return { ...analysis, rawData:JSON.stringify({...raw,imageAssets}), imageUrls: JSON.stringify(urls.filter(Boolean)) };
  } catch {
    return analysis;
  }
}

export const analysisRouter = router({
  analyzeCollected: protectedProcedure.input(z.object({projectId:z.number().int().positive(),analysisId:z.number().int().positive()})).mutation(({ctx,input})=>{
    if(!ctx.workspaceId)throw new Error('当前工作空间不可用');
    return analyzeCollectedListing({...input,workspaceId:ctx.workspaceId,userId:ctx.user.id});
  }),
  preparePresentation: protectedProcedure.input(z.object({ projectId: z.number().int().positive(), analysisId: z.number().int().positive(), retry: z.boolean().optional() }))
    .mutation(({ ctx, input }) => {
      if (!ctx.workspaceId) throw new Error('当前工作空间不可用');
      return startCompetitorPresentation({ ...input, workspaceId: ctx.workspaceId, userId: ctx.user.id });
    }),
  // Get all analyses for a project
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(),
      expectedUserId: z.number().int().positive().safe().optional(),
      expectedWorkspaceId: z.number().int().positive().safe().nullable().optional() }))
    .query(async ({ ctx, input }) => {
      if (input.expectedUserId !== undefined && input.expectedUserId !== ctx.user.id
        || input.expectedWorkspaceId !== undefined && input.expectedWorkspaceId !== (ctx.workspaceId ?? null)) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前身份或工作区已变化，请刷新后重试" });
      }
      await scopedProject(ctx, input.projectId);
      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      return Promise.all(analyses.map(async record => {
        const revision = competitorRevision(record);
        const hydrated = ctx.workspaceId ? await hydrateCompetitorEvidence(record, ctx.workspaceId) : record;
        const raw = readJson(hydrated.rawData) || {};
        const job = raw.presentationJobRunId ? await getAiJobRun(raw.presentationJobRunId) : null;
        return { ...await resolveCompetitorImagesForDelivery(hydrated), revision, presentationNeedsUpdate: needsCompetitorPresentation(record), presentationJob: job ? { status: job.status, progress: job.progress, errorMessage: job.error } : null };
      }));
    }),

  updateSummary: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      analysisId: z.number(),
      summary: z.string().trim().min(1).max(20000),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await scopedProject(ctx, input.projectId);
      const analysis = await db.getPersistedCompetitorAnalysisById(input.analysisId);
      if (!analysis || analysis.projectId !== input.projectId) throw new Error("Competitor analysis not found");
      if (analysis.summaryStatus === "confirmed") throw new Error("已确认的竞品分析需要先解锁才能编辑");
      const updated = await db.updateCompetitorAnalysisSummary(input.analysisId, {
        summary: input.summary,
        incrementVersion: true,
      }, { projectId: input.projectId, expectedRevision: competitorRevision(analysis), userId: ctx.user.id, workspaceId: ctx.workspaceId ?? null });
      await registerCompetitorAnalysisArtifact(input.analysisId, "user_edit").catch(error => {
        console.warn("[Analysis] Failed to register analysis draft artifact", error);
      });
      await ensureCompetitorWorkflow({ businessId: input.projectId, workspaceId: ctx.workspaceId ?? project.workspaceId, userId: ctx.user.id })
        .then(agent => syncCompetitorWorkflow({ agentRunId: agent.agentRunId }))
        .catch(error => console.warn('[Analysis] Workflow snapshot sync failed', error));
      return updated;
    }),

  confirmSummary: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      analysisId: z.number(),
      summary: z.string().trim().min(1).max(20000),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await scopedProject(ctx, input.projectId);
      const analysis = await db.getPersistedCompetitorAnalysisById(input.analysisId);
      if (!analysis || analysis.projectId !== input.projectId) throw new Error("Competitor analysis not found");
      if (analysis.summaryStatus === "confirmed" && analysis.summary !== input.summary) {
        throw new Error("已确认的竞品分析需要先解锁才能修改");
      }
      const updated = await confirmCollectedAnalysis({...input,userId:ctx.user.id,workspaceId:ctx.workspaceId ?? null});
      await registerCompetitorAnalysisArtifact(input.analysisId, analysis.summary === input.summary ? "system" : "user_edit").catch(error => {
        console.warn("[Analysis] Failed to register confirmed analysis artifact", error);
      });
      await ensureCompetitorWorkflow({ businessId: input.projectId, workspaceId: ctx.workspaceId ?? project.workspaceId, userId: ctx.user.id })
        .then(agent => syncCompetitorWorkflow({ agentRunId: agent.agentRunId }))
        .catch(error => console.warn('[Analysis] Workflow snapshot sync failed', error));
      return updated;
    }),

  unlockSummary: protectedProcedure
    .input(z.object({ projectId: z.number(), analysisId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await scopedProject(ctx, input.projectId);
      const analysis = await db.getPersistedCompetitorAnalysisById(input.analysisId);
      if (!analysis || analysis.projectId !== input.projectId) throw new Error("Competitor analysis not found");
      const updated = await db.updateCompetitorAnalysisSummary(input.analysisId, {
        summaryStatus: "draft",
        summaryConfirmedBy: null,
        summaryConfirmedAt: null,
      }, { projectId: input.projectId, expectedRevision: competitorRevision(analysis), userId: ctx.user.id, workspaceId: ctx.workspaceId ?? null });
      await registerCompetitorAnalysisArtifact(input.analysisId, "user_edit").catch(error => {
        console.warn("[Analysis] Failed to register unlocked analysis artifact", error);
      });
      await ensureCompetitorWorkflow({ businessId: input.projectId, workspaceId: ctx.workspaceId ?? project.workspaceId, userId: ctx.user.id })
        .then(agent => syncCompetitorWorkflow({ agentRunId: agent.agentRunId }))
        .catch(error => console.warn('[Analysis] Workflow snapshot sync failed', error));
      return updated;
    }),

  getComparisonReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      analysisIds: z.array(z.number()).min(2).max(8),
    }))
    .query(async ({ ctx, input }) => {
      const project = await scopedProject(ctx, input.projectId);
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
      const project = await scopedProject(ctx, input.projectId);
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
      const project = await scopedProject(ctx, input.projectId);
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
      const project = await scopedProject(ctx, input.projectId);
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
  collectAsin: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      asin: z.string().min(10).max(10),
      refresh: z.boolean().optional(),
      expectedWorkspaceId: z.number().int().positive().safe().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.workspaceId || input.expectedWorkspaceId !== undefined && input.expectedWorkspaceId !== ctx.workspaceId) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前工作区已变化，请刷新后重试" });
      }
      const project = await scopedProject(ctx, input.projectId);

      if (!project.workspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "项目尚未绑定工作空间" });
      return startProjectCompetitorAcquisition({
        projectId: input.projectId,
        workspaceId: project.workspaceId,
        userId: ctx.user.id,
        asin: input.asin,
        refresh: input.refresh,
      });
    }),

  // Batch analyze multiple ASINs - process sequentially
  comparisonSummary: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      analysisIds: z.array(z.number()).min(2).max(8),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await scopedProject(ctx, input.projectId);

      // Fetch all selected analyses
      const allAnalyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const requestedAnalysisIds = [...new Set(input.analysisIds)].sort((a, b) => a - b);
      const selectedAnalyses = allAnalyses.filter(a => requestedAnalysisIds.includes(a.id));

      if (selectedAnalyses.length !== requestedAnalysisIds.length) {
        throw new Error("部分竞品分析不存在或不属于当前项目");
      }
      if (selectedAnalyses.some(a => { const raw=readJson(a.rawData)||{}; return raw.captureOnly || raw.analysisStale || (!a.aiSummary && !a.summary); })) {
        throw new Error('请先完成所选 Listing 的分析，再生成结构化对比');
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
        parts.push(`- Long description: ${rawData?.description || rawData?.scrapedData?.description || 'N/A'}`);
        parts.push(`- Listing analysis: ${a.summary || a.aiSummary || 'N/A'}`);
        parts.push(`- Review evidence and analysis: ${JSON.stringify(rawData?.presentation?.reviewReport || reviewAnalysis || null)}`);
        parts.push(`- Sales and variants: ${JSON.stringify(rawData?.research || null)}`);

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

  // Delete a project record.
  delete: protectedProcedure
    .input(z.object({ id: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const analysis = await db.getPersistedCompetitorAnalysisById(input.id);
      if (!analysis) throw new TRPCError({ code: "NOT_FOUND", message: "竞品不存在" });
      await scopedProject(ctx, analysis.projectId);
      return db.deleteCompetitorAnalysis(input.id, { projectId: analysis.projectId,
        userId: ctx.user.id, workspaceId: ctx.workspaceId ?? null, expectedRevision: competitorRevision(analysis) });
    }),


});
