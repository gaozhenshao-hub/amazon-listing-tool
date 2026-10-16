import { TRPCError } from "@trpc/server";
import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import { COMPETITOR_RESEARCH_JOB_KIND, type CompetitorResearchJobView } from "../../../../shared/competitorResearchJob";
import type { TrpcContext } from "../../../_core/context";
import {
  competitorResearchJobRepository, competitorResearchRunId, decodeCompetitorResearchInput, researchError, researchHash,
  type CompetitorResearchBinding, type CompetitorResearchStoredInput, type CompetitorResearchJobRow, type CompetitorResearchSession, type CompetitorResearchLease,
} from "../../../repositories/listing/competitorResearchJobRepository";
import { assertResourceAction } from "../../../services/securityGovernance";
import { getEmperorSkillRuntimeSnapshot, runEmperorSkill } from "../../ai_os/services/skillRunner";
import { registerAiJobHandler, scheduleAiJobRun, type AiJobSnapshot } from "../../ai_os/services/jobRunner";
import { ensureListingAgentRun } from "../listingAgentBridge";
import { buildCompetitorResearchSource, normalizeCompetitorResearchResult } from "./competitorResearchSource";

const id = z.number().int().positive().safe();
export const competitorResearchScopeSchema = z.object({ projectId: id, expectedWorkspaceId: id.nullable() }).strict();
export const startCompetitorResearchJobSchema = competitorResearchScopeSchema.extend({ analysisId: id, expectedRevision: z.string().regex(/^[a-f0-9]{64}$/u) }).strict();
export const competitorResearchOperationSchema = competitorResearchScopeSchema.extend({ runId: z.string().regex(/^competitor_[a-f0-9]{64}$/u) }).strict();
type Scope = { userId: number; workspaceId: number | null; projectId: number };
type Request = z.infer<typeof competitorResearchOperationSchema>;
const defaults = { repository: competitorResearchJobRepository, permission: assertResourceAction, ensureAgent: ensureListingAgentRun,
  schedule: scheduleAiJobRun, snapshot: getEmperorSkillRuntimeSnapshot, skill: runEmperorSkill };
function safeError(error: unknown): never {
  // Only our fixed public codes cross the scheduler's logging boundary.
  if (error instanceof TRPCError && /^COMPETITOR_RESEARCH_[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "COMPETITOR_RESEARCH_INPUT_INVALID" });
  if (error instanceof TRPCError && ["FORBIDDEN", "NOT_FOUND", "UNAUTHORIZED"].includes(error.code)) throw new TRPCError({ code: error.code, message: "COMPETITOR_RESEARCH_ACCESS_DENIED" });
  return researchError("INTERNAL_SERVER_ERROR", "COMPETITOR_RESEARCH_FAILED_REVIEW_REQUIRED");
}
function scopeFor(ctx: TrpcContext, request: z.infer<typeof competitorResearchScopeSchema>): Scope {
  const workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user?.defaultWorkspaceId;
  if (!ctx.user || !Number.isSafeInteger(ctx.user.id) || ctx.user.id <= 0
    || (workspaceId !== null && (!Number.isSafeInteger(workspaceId) || Number(workspaceId) <= 0))) researchError("FORBIDDEN", "COMPETITOR_RESEARCH_ACTOR_INVALID");
  if (request.expectedWorkspaceId !== workspaceId) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_WORKSPACE_CHANGED");
  return { userId: ctx.user.id, workspaceId: workspaceId as number | null, projectId: request.projectId };
}
function assertScope(row: CompetitorResearchJobRow | null, scope: Scope): asserts row is CompetitorResearchJobRow {
  if (!row || row.userId !== scope.userId || row.workspaceId !== scope.workspaceId || row.projectId !== scope.projectId) researchError("NOT_FOUND", "COMPETITOR_RESEARCH_JOB_UNAVAILABLE");
}
function view(row: CompetitorResearchJobRow, changed = false, agentCanceled = false, unavailable = false): CompetitorResearchJobView {
  const { binding: b, checkpoint: cp } = row.input;
  const unknown = cp.stage === "model_dispatched" && row.status !== "running";
  const canResume = !changed && !agentCanceled && ["failed", "canceled"].includes(row.status) && ["reserved", "analysis_ready"].includes(cp.stage);
  return { runId: row.runId, userId: b.userId, workspaceId: b.workspaceId, projectId: b.projectId, analysisId: b.analysisId, asin: b.asin,
    sourceHash: b.sourceHash, status: row.status, stage: unknown ? "model_result_unknown" : cp.stage, progress: row.progress, canResume,
    canCancel: ["queued", "running", "failed"].includes(row.status), sourceChanged: changed, createdAt: row.createdAt,
    message: unavailable ? "来源或所属 Agent 当前无法核验，不能恢复；历史回执保留" : agentCanceled ? "所属 Agent 已取消" : changed ? "竞品来源或审核内容已变化，请刷新核对" : cp.stage === "analysis_committed" ? "单条竞品分析已保存，仍需人工审核" : unknown ? "模型结果未可靠保存，不能重复调用" : row.status === "canceled" ? "任务已取消；已派发模型不保证停止或退费" : "单条竞品分析任务" };
}

/** Each handler performs real repository transactions; injectable edges are for offline tests only. */
export function createCompetitorResearchJobService(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  async function authorize(session: CompetitorResearchSession, scope: Scope, action: "read" | "run" | "cancel") {
    const user = await session.user(scope.userId);
    if (!user || user.id !== scope.userId || user.status !== "active" || user.defaultWorkspaceId !== scope.workspaceId || typeof user.role !== "string") researchError("FORBIDDEN", "COMPETITOR_RESEARCH_ACTOR_CHANGED");
    // Global lock order: job -> actor/policy -> parent -> competitor -> Agent.
    await deps.permission({ actor: { id: scope.userId, role: user.role, defaultWorkspaceId: scope.workspaceId }, resource: "project", action,
      workspaceId: scope.workspaceId, projectId: scope.projectId, resourceId: scope.projectId, ownerUserId: scope.userId,
      authorizationRead: { executor: session.executor, strict: true, lock: true } });
    const parent = await session.target(scope.projectId);
    if (!parent || parent.id !== scope.projectId || parent.userId !== scope.userId || (parent.workspaceId !== null && parent.workspaceId !== scope.workspaceId)) researchError("NOT_FOUND", "COMPETITOR_RESEARCH_PROJECT_UNAVAILABLE");
    return user.role;
  }
  async function source(session: CompetitorResearchSession, scope: Scope, analysisId: number) {
    const row = await session.analysis(scope.projectId, analysisId);
    if (!row || row.id !== analysisId || row.projectId !== scope.projectId) researchError("NOT_FOUND", "COMPETITOR_RESEARCH_SOURCE_UNAVAILABLE");
    return { row, source: buildCompetitorResearchSource(row) };
  }
  async function bound(session: CompetitorResearchSession, row: CompetitorResearchJobRow, action: "read" | "run" | "cancel", strict: boolean) {
    const b = row.input.binding, actorRole = await authorize(session, b, action), current = await source(session, b, b.analysisId);
    const agent = await session.agent(row.input, !strict);
    const sourceChanged = current.source.sourceHash !== b.sourceHash || current.row.asin !== b.asin;
    const revisionChanged = current.source.revision !== row.input.expectedRevision || current.row.summaryStatus === "confirmed";
    if (strict && (sourceChanged || revisionChanged)) researchError("CONFLICT", "COMPETITOR_RESEARCH_SOURCE_CHANGED");
    return { ...current, actorRole, changed: sourceChanged || (row.status !== "succeeded" && revisionChanged), agentCanceled: agent.canceled };
  }
  async function readStatus(session: CompetitorResearchSession, row: CompetitorResearchJobRow) {
    const b = row.input.binding;
    // DB/schema failures remain fatal. Only pure source unavailability becomes
    // a content-free historical DTO; one broken source cannot hide other jobs.
    const current = await session.analysis(b.projectId, b.analysisId);
    let changed = true, unavailable = !current;
    if (current) {
      try {
        const source = buildCompetitorResearchSource(current);
        changed = source.sourceHash !== b.sourceHash || (row.status !== "succeeded" && (source.revision !== row.input.expectedRevision || current.summaryStatus === "confirmed"));
      } catch (error) {
        if (!(error instanceof TRPCError) || error.code !== "PRECONDITION_FAILED") throw error;
        unavailable = true;
      }
    }
    let agentCanceled = false;
    try { agentCanceled = (await session.agent(row.input, true)).canceled; }
    catch (error) {
      if (!(error instanceof TRPCError) || error.message !== "COMPETITOR_RESEARCH_AGENT_INVALID") throw error;
      unavailable = true; agentCanceled = true;
    }
    return { changed: changed || unavailable, agentCanceled, unavailable };
  }
  async function start(ctx: TrpcContext, raw: z.infer<typeof startCompetitorResearchJobSchema>): Promise<CompetitorResearchJobView> {
    try {
      const input = startCompetitorResearchJobSchema.parse(raw), scope = scopeFor(ctx, input);
      // No job locks in this preliminary transaction; never invert the shared lock order.
      const prepared = await deps.repository.transaction(async session => {
        await authorize(session, scope, "run");
        const current = await source(session, scope, input.analysisId);
        if (current.source.revision !== input.expectedRevision) researchError("CONFLICT", "COMPETITOR_RESEARCH_REVISION_CHANGED");
        const binding: CompetitorResearchBinding = { version: 1, ...scope, analysisId: input.analysisId, asin: current.row.asin, sourceHash: current.source.sourceHash };
        return { binding, runId: competitorResearchRunId(binding), confirmed: current.row.summaryStatus === "confirmed" };
      });
      const previous = await deps.repository.transaction(async session => {
        const row = await session.job(prepared.runId);
        if (!row) return null;
        assertScope(row, scope);
        const current = await bound(session, row, "run", row.status !== "succeeded");
        if (current.source.sourceHash !== prepared.binding.sourceHash || (row.status !== "succeeded" && current.source.revision !== input.expectedRevision)) researchError("CONFLICT", "COMPETITOR_RESEARCH_REVISION_CHANGED");
        return { row, current };
      });
      if (previous) {
        if (previous.row.status === "queued" && !previous.current.changed && !previous.current.agentCanceled) await deps.schedule(previous.row.runId);
        return view(previous.row, previous.current.changed, previous.current.agentCanceled);
      }
      if (prepared.confirmed) researchError("CONFLICT", "COMPETITOR_RESEARCH_RECORD_CONFIRMED");
      const agentRunId = await deps.ensureAgent(scope);
      if (!agentRunId) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_AGENT_UNAVAILABLE");
      let saved: CompetitorResearchJobRow;
      try {
        saved = await deps.repository.transaction(async session => {
          const existing = await session.job(prepared.runId);
          if (existing) {
            assertScope(existing, scope); const current = await bound(session, existing, "run", existing.status !== "succeeded");
            if (current.source.sourceHash !== prepared.binding.sourceHash || (existing.status !== "succeeded" && current.source.revision !== input.expectedRevision)) researchError("CONFLICT", "COMPETITOR_RESEARCH_REVISION_CHANGED");
            return existing;
          }
          await authorize(session, scope, "run");
          const current = await source(session, scope, input.analysisId);
          if (current.source.sourceHash !== prepared.binding.sourceHash || current.source.revision !== input.expectedRevision || current.row.summaryStatus === "confirmed") researchError("CONFLICT", "COMPETITOR_RESEARCH_SOURCE_CHANGED");
          const stored: CompetitorResearchStoredInput = { version: 1, binding: prepared.binding, expectedRevision: input.expectedRevision, agentRunId, agentNodeId: "N1",
            checkpoint: { stage: "reserved", analysisJson: null, analysisHash: null, summary: null, keywordsJson: null, skillRunId: null, skillSnapshot: null, committedVersion: null } };
          await session.agent(stored);
          return session.reserve(stored);
        });
      } catch (error) {
        if (!(error instanceof TRPCError) || error.message !== "COMPETITOR_RESEARCH_STORAGE_CONFLICT") throw error;
        saved = await deps.repository.transaction(async session => {
          const existing = await session.job(prepared.runId); assertScope(existing, scope);
          const current = await bound(session, existing, "run", existing.status !== "succeeded");
          if (current.source.sourceHash !== prepared.binding.sourceHash || (existing.status !== "succeeded" && current.source.revision !== input.expectedRevision)) researchError("CONFLICT", "COMPETITOR_RESEARCH_REVISION_CHANGED");
          return existing;
        });
      }
      // Never overwrite a shared N1 checkpoint with an individual job's progress or completion.
      if (saved.status === "queued") await deps.schedule(saved.runId);
      return view(saved);
    } catch (error) { return safeError(error); }
  }
  async function get(ctx: TrpcContext, raw: Request) {
    try {
      const input = competitorResearchOperationSchema.parse(raw), scope = scopeFor(ctx, input);
      return await deps.repository.transaction(async session => {
        const row = await session.job(input.runId); assertScope(row, scope);
        await authorize(session, scope, "read");
        const current = await readStatus(session, row);
        return view(row, current.changed, current.agentCanceled, current.unavailable);
      });
    } catch (error) { return safeError(error); }
  }
  async function list(ctx: TrpcContext, raw: z.infer<typeof competitorResearchScopeSchema>) {
    try {
      const input = competitorResearchScopeSchema.parse(raw), scope = scopeFor(ctx, input);
      return await deps.repository.transaction(async session => {
        const rows = await session.list(scope.userId, scope.workspaceId, scope.projectId);
        await authorize(session, scope, "read");
        const result: CompetitorResearchJobView[] = [];
        for (const row of rows) {
          assertScope(row, scope);
          const current = await readStatus(session, row);
          result.push(view(row, current.changed, current.agentCanceled, current.unavailable));
        }
        return result;
      });
    } catch (error) { return safeError(error); }
  }
  async function resume(ctx: TrpcContext, raw: Request) {
    try {
      const input = competitorResearchOperationSchema.parse(raw), scope = scopeFor(ctx, input);
      const row = await deps.repository.transaction(async session => {
        const row = await session.job(input.runId); assertScope(row, scope);
        const current = await bound(session, row, "run", row.status !== "succeeded");
        if (row.status === "succeeded") return { row, current };
        if (row.status === "queued" || row.status === "running") return { row, current };
        return { row: await session.resume(row), current };
      });
      if (row.row.status === "queued") await deps.schedule(row.row.runId);
      return view(row.row, row.current.changed, row.current.agentCanceled);
    } catch (error) { return safeError(error); }
  }
  async function cancel(ctx: TrpcContext, raw: Request) {
    try {
      const input = competitorResearchOperationSchema.parse(raw), scope = scopeFor(ctx, input);
      return await deps.repository.transaction(async session => {
        const row = await session.job(input.runId); assertScope(row, scope);
        // Cancellation is still available when the source is stale/deleted. It only
        // invalidates this job's future writes, not a provider's in-flight request.
        await authorize(session, scope, "cancel");
        const canceled = await session.cancel(row), current = await readStatus(session, canceled);
        return view(canceled, current.changed, current.agentCanceled, current.unavailable);
      });
    } catch (error) { return safeError(error); }
  }
  async function run(job: AiJobSnapshot, { signal }: { signal: AbortSignal }) {
    try {
      const stored = decodeCompetitorResearchInput(job.input), b = stored.binding;
      if (job.kind !== COMPETITOR_RESEARCH_JOB_KIND || job.module !== "listing" || job.skillSlug !== "listing.competitor.analyze" || job.maxAttempts !== 1 || !job.lockedBy || job.runId !== competitorResearchRunId(b) || job.userId !== b.userId || job.workspaceId !== b.workspaceId || job.projectId !== b.projectId) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_BINDING_INVALID");
      const lease: CompetitorResearchLease = { runId: job.runId, lockedBy: job.lockedBy, attempt: job.attempt, signal };
      const before = await deps.repository.transaction(async session => {
        const row = await session.job(job.runId); assertScope(row, b); session.assertLease(row, lease);
        await bound(session, row, "run", true); session.assertLease(row, lease);
        if (row.input.checkpoint.stage === "model_dispatched") researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_MODEL_RESULT_UNKNOWN");
        return row;
      });
      if (before.input.checkpoint.stage === "reserved") {
        const snapshot = await deps.snapshot("listing.competitor.analyze", b.workspaceId);
        if (snapshot.status !== "Released" || !snapshot.version || !snapshot.systemPromptLength || !snapshot.systemPromptHash || !snapshot.userPromptHash || !snapshot.manifestHash) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_SKILL_NOT_RELEASED");
        const context = await deps.repository.transaction(async session => {
          const row = await session.job(job.runId); assertScope(row, b); session.assertLease(row, lease);
          const current = await bound(session, row, "run", true);
          if (row.input.checkpoint.stage !== "reserved") researchError("CONFLICT", "COMPETITOR_RESEARCH_ALREADY_DISPATCHED");
          const skillSnapshot = { version: snapshot.version, status: "Released" as const, systemPromptHash: snapshot.systemPromptHash, userPromptHash: snapshot.userPromptHash, manifestHash: snapshot.manifestHash };
          await session.checkpoint(row, { ...row.input, checkpoint: { ...row.input.checkpoint, stage: "model_dispatched", skillSnapshot } }, lease);
          return current.source.context;
        });
        if (signal.aborted) researchError("CONFLICT", "COMPETITOR_RESEARCH_CANCELED");
        const result = await deps.skill({ skillSlug: "listing.competitor.analyze", userId: b.userId, workspaceId: b.workspaceId, projectId: b.projectId,
          variables: { context }, context, migrationSource: "competitor_research.saved_source", skillVersionPolicy: "pinned",
          expectedSkillVersion: snapshot.version, expectedSkillPromptHash: snapshot.systemPromptHash, maxModelAttempts: 1, fallbackModels: [], signal,
          validate: (content: string) => { let value: unknown; try { value = JSON.parse(content); } catch { return researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_ANALYSIS_INVALID"); } return normalizeCompetitorResearchResult(value); },
        }).catch(() => researchError("INTERNAL_SERVER_ERROR", "COMPETITOR_RESEARCH_MODEL_FAILED_REVIEW_REQUIRED"));
        if (result.skillSlug !== "listing.competitor.analyze" || result.skillVersion !== snapshot.version || result.skillPromptHash !== snapshot.systemPromptHash
          || result.skillManifestHash !== snapshot.manifestHash) researchError("CONFLICT", "COMPETITOR_RESEARCH_SKILL_RESULT_CHANGED");
        // Validate the actual resolved result again; do not trust an adapter to have called validate.
        const normalized = normalizeCompetitorResearchResult(JSON.parse(result.parsed.analysisJson));
        await deps.repository.transaction(async session => {
          const row = await session.job(job.runId); assertScope(row, b); session.assertLease(row, lease); await bound(session, row, "run", true);
          if (row.input.checkpoint.stage !== "model_dispatched") researchError("CONFLICT", "COMPETITOR_RESEARCH_STAGE_CHANGED");
          await session.checkpoint(row, { ...row.input, checkpoint: { ...row.input.checkpoint, stage: "analysis_ready", ...normalized, analysisHash: researchHash(normalized.analysisJson), skillRunId: result.runId } }, lease);
        });
      }
      const complete = await deps.repository.transaction(async session => {
        const row = await session.job(job.runId); assertScope(row, b); session.assertLease(row, lease);
        const current = await bound(session, row, "run", true);
        const cp = row.input.checkpoint;
        if (!cp.analysisJson || !isDeepStrictEqual(normalizeCompetitorResearchResult(JSON.parse(cp.analysisJson)), { analysisJson: cp.analysisJson, summary: cp.summary, keywordsJson: cp.keywordsJson })) researchError("PRECONDITION_FAILED", "COMPETITOR_RESEARCH_CHECKPOINT_INVALID");
        return session.commit(row, current.row, lease, current.actorRole);
      });
      return view(complete);
    } catch (error) { return safeError(error); }
  }
  return { start, get, list, resume, cancel, run };
}
export const competitorResearchJob = createCompetitorResearchJobService();
export const runCompetitorResearchJob = competitorResearchJob.run;
registerAiJobHandler({ id: COMPETITOR_RESEARCH_JOB_KIND, match: job => job.kind === COMPETITOR_RESEARCH_JOB_KIND && job.module === "listing", handler: runCompetitorResearchJob });
