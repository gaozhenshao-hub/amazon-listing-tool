import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { TrpcContext } from "../../../_core/context";
import type { CompetitorAnalysis } from "../../../../drizzle/schema/project";
import { getProjectById } from "../../../repositories/project/projectRepository";
import { getCompetitorAnalysisById, updateCompetitorAnalysisSummary, deleteCompetitorAnalysis } from "../../../repositories/project/projectAssetRepository";
import { competitorRevision } from "../../../repositories/project/competitorWritePolicy";
import { registerCompetitorAnalysisArtifact } from "../../ai_os/services/businessArtifactRegistry";

const id = z.number().int().positive().safe();
export const competitorReviewScopeSchema = z.object({
  projectId: id, analysisId: id, expectedWorkspaceId: id.nullable(),
  expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u),
}).strict();
export const competitorSummaryWriteSchema = competitorReviewScopeSchema.extend({ summary: z.string().trim().min(1).max(20_000) });
const defaults = { getProjectById, getCompetitorAnalysisById, updateCompetitorAnalysisSummary, deleteCompetitorAnalysis, registerCompetitorAnalysisArtifact };

export function competitorReviewWorkspace(ctx: TrpcContext): number | null {
  if (!ctx.user || !Number.isSafeInteger(ctx.user.id) || ctx.user.id <= 0) throw new TRPCError({ code: "UNAUTHORIZED" });
  // Explicit NULL is an authenticated legacy scope, not an instruction to fall back.
  const workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user.defaultWorkspaceId;
  if (workspaceId !== null && (!Number.isSafeInteger(workspaceId) || workspaceId <= 0)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作区信息不完整，请重新登录" });
  }
  return workspaceId;
}

export function competitorWithRevision(row: CompetitorAnalysis) {
  return { ...row, revision: competitorRevision(row) };
}

function assertConfirmable(row: CompetitorAnalysis) {
  if (row.rawData === null || row.rawData.trim() === "") return;
  let raw: Record<string, unknown>;
  try {
    const value: unknown = JSON.parse(row.rawData);
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid");
    raw = value as Record<string, unknown>;
  } catch { throw new TRPCError({ code: "PRECONDITION_FAILED", message: "竞品来源状态无法核验，请刷新核对" }); }
  for (const key of ["analysisStale", "captureOnly"]) {
    if (Object.hasOwn(raw, key) && typeof raw[key] !== "boolean") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "竞品来源状态无法核验，请刷新核对" });
    if (raw[key] === true) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "竞品资料已变化或尚未分析，不能确认历史摘要" });
  }
}

/** Human review only. This does not start a model, adopt friends' Skills, or attest deep-analysis completeness. */
export function createCompetitorSummaryReviewService(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  async function owned(ctx: TrpcContext, projectId: number, analysisId: number, expectedWorkspaceId: number | null) {
    const workspaceId = competitorReviewWorkspace(ctx);
    if (expectedWorkspaceId !== workspaceId) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作区已变化，请重新读取竞品" });
    const project = await deps.getProjectById(projectId, ctx.user!.id, workspaceId);
    if (!project || project.id !== projectId || project.userId !== ctx.user!.id || (project.workspaceId !== null && project.workspaceId !== workspaceId)) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Project not found" });
    }
    const row = await deps.getCompetitorAnalysisById(analysisId);
    if (!row || row.id !== analysisId || row.projectId !== projectId) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor analysis not found" });
    return { row, workspaceId };
  }
  async function review(ctx: TrpcContext, action: "save" | "confirm" | "unlock", raw: z.infer<typeof competitorSummaryWriteSchema> | z.infer<typeof competitorReviewScopeSchema>) {
    const input = action === "unlock" ? competitorReviewScopeSchema.parse(raw) : competitorSummaryWriteSchema.parse(raw);
    const { row, workspaceId } = await owned(ctx, input.projectId, input.analysisId, input.expectedWorkspaceId);
    if (competitorRevision(row) !== input.expectedRevision) throw new TRPCError({ code: "CONFLICT", message: "竞品资料已变化，请刷新核对；本地草稿可保留" });
    const summary = "summary" in input && typeof input.summary === "string" ? input.summary : undefined;
    if (action === "confirm") assertConfirmable(row);
    const data = action === "unlock" ? { summaryStatus: "draft" as const, summaryConfirmedBy: null, summaryConfirmedAt: null, incrementVersion: true }
      : action === "confirm" ? { summary, summaryStatus: "confirmed" as const, summaryConfirmedBy: ctx.user!.id, summaryConfirmedAt: new Date(), incrementVersion: true }
        : { summary, incrementVersion: true };
    // The repository repeats ownership and the entire-row revision check under its parent/row locks.
    const saved = await deps.updateCompetitorAnalysisSummary(row.id, data, {
      projectId: input.projectId, expectedRevision: input.expectedRevision, userId: ctx.user!.id, workspaceId,
    });
    // Retain the existing best-effort artifact behavior; not an atomic artifact publication claim.
    await deps.registerCompetitorAnalysisArtifact(row.id, action === "confirm" && row.summary === summary ? "system" : "user_edit").catch(() => undefined);
    return competitorWithRevision(saved);
  }
  async function remove(ctx: TrpcContext, analysisId: number) {
    id.parse(analysisId);
    const workspaceId = competitorReviewWorkspace(ctx);
    const initial = await deps.getCompetitorAnalysisById(analysisId);
    if (!initial) throw new TRPCError({ code: "NOT_FOUND", message: "Competitor analysis not found" });
    const { row } = await owned(ctx, initial.projectId, analysisId, workspaceId);
    return deps.deleteCompetitorAnalysis(analysisId, { projectId: row.projectId, expectedRevision: competitorRevision(row), userId: ctx.user!.id, workspaceId });
  }
  return { review, remove };
}

export const competitorSummaryReview = createCompetitorSummaryReviewService();
