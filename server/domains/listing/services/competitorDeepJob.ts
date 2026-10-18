import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { CompetitorDeepOptionsInputSchema, CompetitorDeepOptionsResultSchema, CompetitorDeepStartInputSchema, CompetitorDeepOperationInputSchema,
  CompetitorDeepJobViewSchema, type CompetitorDeepJobView, type CompetitorDeepOperationInput, type CompetitorDeepOptionsInput, type CompetitorDeepStartInput } from "../../../../shared/competitorDeepExecutionJob";
import type { TrpcContext } from "../../../_core/context";
import { competitorDeepJobRepository, deepRunId, deepJobError, deepOperationScope, type DeepIdentity, type DeepJob, type DeepScope } from "../../../repositories/listing/competitorDeepJobRepository";
import { competitorDeepPublicationReceiptSchema } from "../../../repositories/listing/competitorDeepExecutionRepository";
import { competitorResearchEvidence } from "./competitorResearchEvidence";
import { competitorDeepRuntime, CompetitorDeepRuntimeError } from "./competitorDeepRuntime";
import { deepRuntimeHash } from "./competitorDeepRuntimeContract";
import { createCompetitorDeepExecution } from "./competitorDeepExecution";
import { ensureListingAgentRun } from "../listingAgentBridge";
export const competitorDeepWritesEnabled = () => process.env.ENABLE_COMPETITOR_DEEP_WRITES === "true";
export const competitorDeepWorkerEnabled = () => competitorDeepWritesEnabled() && process.env.ENABLE_COMPETITOR_DEEP_WORKER === "true";
function identityFor(ctx: TrpcContext, input: { expectedWorkspaceId: number | null }): DeepIdentity {
  const workspaceId = ctx.workspaceId !== undefined ? ctx.workspaceId : ctx.user?.defaultWorkspaceId;
  if (!ctx.user || !Number.isSafeInteger(ctx.user.id) || ctx.user.id <= 0 || workspaceId !== null && (!Number.isSafeInteger(workspaceId) || Number(workspaceId) <= 0)) deepJobError("ACCESS_DENIED", "FORBIDDEN");
  if (workspaceId !== input.expectedWorkspaceId) deepJobError("WORKSPACE_CHANGED", "CONFLICT");
  return { userId: ctx.user.id, workspaceId: workspaceId as number | null };
}
export function deepPublicView(identity: DeepIdentity, input: CompetitorDeepOperationInput, row: DeepJob | null, currentRevision: string | null, canceled = false): CompetitorDeepJobView {
  const dispatched = row?.input.journal.steps.find(step => step.status === "dispatched");
  const unknown = !!dispatched && row?.status !== "canceled" && (row?.status !== "running" || !row.leaseUntil || new Date(row.leaseUntil).getTime() <= Date.now());
  const status = unknown ? "unknown" : row?.status ?? (canceled ? "canceled" : "not_found");
  const receipt = row?.status === "succeeded" ? competitorDeepPublicationReceiptSchema.parse(row.output) : null;
  return CompetitorDeepJobViewSchema.parse({ identity, projectId: input.projectId, analysisId: input.analysisId, operationId: input.operationId,
    runId: row?.runId ?? deepRunId(identity, input.operationId), status, stage: dispatched?.stage ?? row?.input.journal.steps.find(step => step.status === "pending")?.stage ?? null,
    progress: status === "unknown" || status === "not_found" ? null : row?.progress ?? 0,
    sourceRevision: row?.input.evidence.identity.revision ?? null, evidenceHash: row?.input.evidence.evidenceHash ?? null,
    sourceChanged: row ? currentRevision !== (receipt?.committedRevision ?? row.input.evidence.identity.revision) : false,
    canCancel: !["succeeded", "canceled"].includes(status), reviewRequired: true, deepResearchComplete: false,
    committedRevision: receipt?.committedRevision ?? null,
    reasonCode: unknown ? "MODEL_RESULT_UNKNOWN" : status === "canceled" ? "CANCELED" : status === "not_found" ? "OPERATION_NOT_OBSERVED"
      : row?.status === "failed" ? "EXECUTION_FAILED_REVIEW_REQUIRED" : null });
}
function safe(error: unknown): never {
  if (error instanceof TRPCError && /^(?:COMPETITOR_(?:DEEP|EVIDENCE|REVIEWS)_|DEEP_STORE_)[A-Z_]+$/u.test(error.message)) throw error;
  if (error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED", "NOT_FOUND"].includes(error.code)) deepJobError("ACCESS_DENIED", "FORBIDDEN");
  if (error instanceof CompetitorDeepRuntimeError) deepJobError(error.code);
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "COMPETITOR_DEEP_INPUT_INVALID" });
  deepJobError("OUTCOME_UNKNOWN", "INTERNAL_SERVER_ERROR");
}
const defaults = { repository: competitorDeepJobRepository, evidence: competitorResearchEvidence, runtime: competitorDeepRuntime,
  ensureAgent: ensureListingAgentRun, enabled: competitorDeepWritesEnabled, workerEnabled: competitorDeepWorkerEnabled };
export function createCompetitorDeepJobService(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  async function options(ctx: TrpcContext, raw: CompetitorDeepOptionsInput) {
    try { const input = CompetitorDeepOptionsInputSchema.parse(raw), identity = identityFor(ctx, input), scope = { ...identity, projectId: input.projectId, analysisId: input.analysisId };
      const evidence = await deps.evidence.load(ctx, input);
      return await deps.repository.transaction(async session => {
        const current = await session.authorize(scope, "read");
        if (current.revision !== input.expectedRevision) deepJobError("SOURCE_CHANGED", "CONFLICT");
        let reasonCode: string | null = !deps.enabled() ? "WRITES_DISABLED" : !deps.workerEnabled() ? "WORKER_DISABLED" : identity.workspaceId === null ? "WORKSPACE_REQUIRED" : current.analysis.summaryStatus !== "draft" ? "RECORD_CONFIRMED" : null;
        if (!reasonCode) try { await session.authorize(scope, "run"); await deps.runtime.prepare(session.executor, identity.workspaceId!); }
        catch (error) { if (error instanceof CompetitorDeepRuntimeError) reasonCode = error.code;
          else if (error instanceof TRPCError && error.code === "FORBIDDEN") reasonCode = "RUN_NOT_AUTHORIZED"; else throw error; }
        return CompetitorDeepOptionsResultSchema.parse({ identity, projectId: input.projectId, analysisId: input.analysisId, revision: input.expectedRevision,
          evidenceHash: evidence.evidenceHash, capability: { available: reasonCode === null, reasonCode }, workerEnabled: deps.workerEnabled(), reviewRequired: true });
      });
    } catch (error) { return safe(error); }
  }
  async function existing(identity: DeepIdentity, input: CompetitorDeepStartInput) {
    const scope = deepOperationScope(identity, input), requestHash = deepRuntimeHash({ identity, request: input });
    return deps.repository.transaction(async session => {
      const row = await session.job(deepRunId(identity, input.operationId)), current = await session.authorize(scope, "read");
      if (row) { session.bound(row, scope, input.operationId); if (row.input.reservation?.requestHash !== requestHash) deepJobError("OPERATION_CONTENT_CONFLICT", "CONFLICT");
        return deepPublicView(identity, input, row, current.revision); }
      return await session.fence(scope, input.operationId) ? deepPublicView(identity, input, null, current.revision, true) : null;
    });
  }
  async function start(ctx: TrpcContext, raw: CompetitorDeepStartInput) {
    try { const input = CompetitorDeepStartInputSchema.parse(raw), identity = identityFor(ctx, input), scope = deepOperationScope(identity, input);
      const replay = await existing(identity, input); if (replay) return replay;
      if (!deps.enabled()) deepJobError("WRITES_DISABLED"); if (!deps.workerEnabled()) deepJobError("WORKER_DISABLED");
      if (identity.workspaceId === null) deepJobError("WORKSPACE_REQUIRED");
      const evidence = await deps.evidence.load(ctx, { projectId: input.projectId, analysisId: input.analysisId, expectedWorkspaceId: input.expectedWorkspaceId, expectedRevision: input.expectedRevision });
      if (evidence.evidenceHash !== input.expectedEvidenceHash) deepJobError("EVIDENCE_CHANGED", "CONFLICT");
      const prepared = await deps.repository.transaction(async session => { const current = await session.authorize(scope, "run");
        if (current.revision !== input.expectedRevision || current.analysis.summaryStatus !== "draft") deepJobError("SOURCE_CHANGED", "CONFLICT");
        return deps.runtime.prepare(session.executor, identity.workspaceId!); });
      const agentRunId = await deps.ensureAgent({ ...identity, projectId: input.projectId }); if (!agentRunId) deepJobError("AGENT_UNAVAILABLE");
      return await deps.repository.transaction(async session => {
        const row = await session.job(deepRunId(identity, input.operationId)), current = await session.authorize(scope, "run");
        if (row) { session.bound(row, scope, input.operationId); if (row.input.reservation?.requestHash !== deepRuntimeHash({ identity, request: input })) deepJobError("OPERATION_CONTENT_CONFLICT", "CONFLICT");
          return deepPublicView(identity, input, row, current.revision); }
        if (await session.fence(scope, input.operationId)) return deepPublicView(identity, input, null, current.revision, true);
        if (!deps.enabled() || !deps.workerEnabled()) deepJobError("WRITES_DISABLED");
        if (current.revision !== input.expectedRevision || current.analysis.summaryStatus !== "draft" || current.sourceWorkspaceId !== evidence.identity.sourceWorkspaceId) deepJobError("SOURCE_CHANGED", "CONFLICT");
        await deps.runtime.revalidate(session.executor, prepared.runtime);
        const stored = { version: 1 as const, evidence, skills: prepared.skills, journal: createCompetitorDeepExecution(evidence, prepared.skills).initial(), agentRunId, agentNodeId: "N1" as const,
          reservation: { request: input, requestHash: deepRuntimeHash({ identity, request: input }), runtime: prepared.runtime } };
        await session.agent(stored);
        const saved = await session.reserve(stored); return deepPublicView(identity, input, saved, current.revision);
      });
    } catch (error) { return safe(error); }
  }
  async function operation(ctx: TrpcContext, raw: CompetitorDeepOperationInput, cancel: boolean) {
    try { const input = CompetitorDeepOperationInputSchema.parse(raw), identity = identityFor(ctx, input), scope: DeepScope = deepOperationScope(identity, input);
      return await deps.repository.transaction(async session => {
        const row = await session.job(deepRunId(identity, input.operationId)), current = await session.authorize(scope, cancel ? "cancel" : "read");
        if (row) session.bound(row, scope, input.operationId);
        const canceled = await session.fence(scope, input.operationId);
        const saved = cancel ? await session.cancel(scope, input.operationId, String(current.actor.role), row) : row;
        return deepPublicView(identity, input, saved, current.revision, cancel || canceled);
      });
    } catch (error) { return safe(error); }
  }
  return { options, start, check: (ctx: TrpcContext, input: CompetitorDeepOperationInput) => operation(ctx, input, false),
    cancel: (ctx: TrpcContext, input: CompetitorDeepOperationInput) => operation(ctx, input, true) };
}
export const competitorDeepJob = createCompetitorDeepJobService();
