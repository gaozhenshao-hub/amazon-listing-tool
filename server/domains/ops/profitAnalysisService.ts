import { randomUUID } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { buildProfitAnalysisEvidence, ProfitAnalysisPreviewInputSchema, type ProfitAnalysisPreviewInput,
  type ProfitAnalysisSource, validateProfitAnalysisResultAgainstEvidence } from "../../../shared/profitAnalysis";
import { ProfitAnalysisStartInputSchema, ProfitAnalysisOperationInputSchema, ProfitAnalysisSaveInputSchema,
  ProfitAnalysisSaveOperationInputSchema, ProfitAnalysisHistoryInputSchema } from "../../../shared/profitAnalysisWorkflow";
import { ProfitAnalysisWorkflowViewResultSchema, ProfitAnalysisWorkflowHistoryResultSchema, ProfitAnalysisWorkflowSaveResultSchema, ProfitAnalysisWorkflowCancelResultSchema } from "../../../shared/profitAnalysisWorkflowRead";
import type { TrpcContext } from "../../_core/context";
import { assertResourceAction } from "../../services/securityGovernance";
import { loadSavedConfiguration } from "../ai_os/services/assistantConversations";
import { authorizeProfitAnalysisSnapshot, loadProfitAnalysisSnapshot } from "./profitAnalysisSnapshotRepository";
import { profitAnalysisRuntime, ProfitAnalysisRuntimeError } from "./profitAnalysisRuntime";
import { profitAnalysisWorkerEnabled } from "./profitAnalysisQueue";
export { profitAnalysisWorkerEnabled } from "./profitAnalysisQueue";
import { profitAnalysisJobRepository, profitAnalysisJobRequestHash, profitAnalysisSaveRequestHash,
  ProfitAnalysisJobStorageError, type ProfitAnalysisJobSession, type ProfitAnalysisJobRun } from "./profitAnalysisJobRepository";

type Session = ProfitAnalysisJobSession;
type Action = "read" | "run" | "confirm" | "cancel";
const writeGate = () => process.env.ENABLE_PROFIT_ANALYSIS_WRITES === "true";
const targetOf = (input: ProfitAnalysisPreviewInput) => ({ scope: input.scope, month: input.month });
const requestOf = (session: Session, target: ProfitAnalysisJobRun["target"]): ProfitAnalysisPreviewInput => ({ expectedWorkspaceId: session.identity.workspaceId, ...target });
function fail(code: string, conflict = false): never {
  throw new TRPCError({ code: conflict ? "CONFLICT" : "PRECONDITION_FAILED", message: `PROFIT_ANALYSIS_${code}` });
}
function errorCode(error: unknown) {
  if (error instanceof ProfitAnalysisRuntimeError || error instanceof ProfitAnalysisJobStorageError) return error.code;
  return "UNAVAILABLE";
}
function safeError(error: unknown): never {
  if (error instanceof TRPCError && ["UNAUTHORIZED", "FORBIDDEN", "BAD_REQUEST", "CONFLICT", "PRECONDITION_FAILED"].includes(error.code)) {
    if (/^PROFIT_ANALYSIS_[A-Z_]+$/u.test(error.message)) throw error;
    throw new TRPCError({ code: error.code, message: "PROFIT_ANALYSIS_ACCESS_OR_SOURCE_UNAVAILABLE" });
  }
  if (error instanceof z.ZodError) throw new TRPCError({ code: "BAD_REQUEST", message: "PROFIT_ANALYSIS_INPUT_INVALID" });
  if (error instanceof ProfitAnalysisJobStorageError && error.code === "ACCESS_DENIED") throw new TRPCError({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_ACCESS_DENIED" });
  if (error instanceof ProfitAnalysisJobStorageError || error instanceof ProfitAnalysisRuntimeError) fail(errorCode(error), error instanceof ProfitAnalysisJobStorageError && error.conflict);
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "PROFIT_ANALYSIS_OUTCOME_UNVERIFIED" });
}

/** Dedicated private workflow. No client financial rows, no synchronous model
 * call in an HTTP mutation, and no write to any monthly financial fact. */
export function createProfitAnalysisService(deps: {
  repository?: typeof profitAnalysisJobRepository;
  authorizeSource?: typeof authorizeProfitAnalysisSnapshot;
  loadSource?: typeof loadProfitAnalysisSnapshot;
  permission?: typeof assertResourceAction;
  loadConfiguration?: typeof loadSavedConfiguration;
  runtime?: Pick<typeof profitAnalysisRuntime, "prepare">;
  writesEnabled?: () => boolean; workerEnabled?: () => boolean;
} = {}) {
  const repository = deps.repository ?? profitAnalysisJobRepository, permission = deps.permission ?? assertResourceAction;
  const authorizeSource = deps.authorizeSource ?? authorizeProfitAnalysisSnapshot, loadSource = deps.loadSource ?? loadProfitAnalysisSnapshot;
  const loadConfiguration = deps.loadConfiguration ?? loadSavedConfiguration, runtime = deps.runtime ?? profitAnalysisRuntime;
  const writesEnabled = deps.writesEnabled ?? writeGate, workerEnabled = deps.workerEnabled ?? profitAnalysisWorkerEnabled;
  async function authorize(session: Session, action: Action, expectedRole?: string) {
    const sourceSession = await authorizeSource(session.executor, { identity: session.identity, ...(expectedRole === undefined ? {} : { expectedRole }) }, permission);
    const common = { actor: sourceSession.actor, workspaceId: session.identity.workspaceId,
      resource: "agent" as const, resourceId: "finance", authorizationRead: { executor: session.executor, strict: true as const, lock: true as const } };
    await permission({ ...common, action: "read" });
    if (action !== "read") await permission({ ...common, action });
    return sourceSession;
  }
  async function capture(session: Session, target: ProfitAnalysisJobRun["target"], action: Action = "read") {
    const authorized = await authorize(session, action);
    return loadSource(authorized, requestOf(session, target));
  }
  async function configuration(session: Session) { return loadConfiguration(session, "finance"); }
  async function invoke<T>(ctx: TrpcContext, workspaceId: number, write: boolean, body: (session: Session) => Promise<T>) {
    try {
      if (!ctx.user) throw new TRPCError({ code: "UNAUTHORIZED", message: "PROFIT_ANALYSIS_LOGIN_REQUIRED" });
      if (workspaceId !== (ctx.workspaceId ?? ctx.user.defaultWorkspaceId)) throw new TRPCError({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_WORKSPACE_CHANGED" });
      return await repository[write ? "transaction" : "read"]({ userId: ctx.user.id, workspaceId }, async session => {
        await authorize(session, "read", ctx.user!.role);
        try { return await body(session); }
        catch (error) { if (error instanceof ProfitAnalysisRuntimeError) throw new ProfitAnalysisJobStorageError(error.code); throw error; }
      });
    } catch (error) { return safeError(error); }
  }
  function publicRun(run: ProfitAnalysisJobRun | null, current: ProfitAnalysisSource | null) {
    if (!run) return null;
    const result = run.state === "succeeded" && run.result !== null && run.snapshot !== null
      ? validateProfitAnalysisResultAgainstEvidence(run.result, run.snapshot.evidence) : null;
    return { operationId: run.operationId, state: run.state, errorCode: run.errorCode,
      sourceHash: run.snapshot?.source.sourceHash ?? null, resultHash: run.resultHash, result,
      stale: run.snapshot === null ? null : current === null || run.snapshot.source.sourceHash !== current.sourceHash,
      createdAt: run.createdAt, updatedAt: run.updatedAt, completedAt: run.completedAt };
  }
  async function currentOrUnavailable(session: Session, target: ProfitAnalysisJobRun["target"]) {
    // Establish current authority before considering a source availability
    // fallback. Non-managers need the exact current source rows to prove scope
    // ownership, so an incomplete capture cannot authorize a historical report.
    const authorized = await authorize(session, "read");
    try { return await loadSource(authorized, requestOf(session, target)); }
    catch (error) {
      if (!authorized.manager || error instanceof TRPCError && ["FORBIDDEN", "UNAUTHORIZED"].includes(error.code)) throw error;
      return null;
    }
  }
  async function view(session: Session, input: ProfitAnalysisPreviewInput, operationId?: string, options = false) {
    const target = targetOf(input), current = await currentOrUnavailable(session, target), report = await session.report(target);
    const evidence = current ? buildProfitAnalysisEvidence(current) : null;
    const activeId = operationId ?? report?.activeOperationId ?? report?.latestOperationId;
    const run = activeId ? await session.run(target, activeId) : null;
    const active = report?.activeOperationId ? (report.activeOperationId === activeId ? run : await session.run(target, report.activeOperationId)) : null;
    const latest = report?.latestOperationId ? await session.run(target, report.latestOperationId) : null;
    const saved = report?.savedOperationId ? await session.run(target, report.savedOperationId) : null;
    if (report?.activeOperationId && (!active || !["queued", "dispatched", "result_ready"].includes(active.state))
      || report?.latestOperationId && !latest || report?.savedOperationId && (!saved || saved.state !== "succeeded")) fail("REPORT_INVALID");
    let generation: { available: boolean; reasonCode: string | null; modelRequired: boolean | null; configuration: { revision: number; hash: string } | null } = {
      available: false, reasonCode: "NOT_CHECKED", modelRequired: evidence ? evidence.evidence.length > 0 : null, configuration: null,
    };
    if (options) {
      try {
        if (!writesEnabled() || !workerEnabled()) fail("EXECUTION_DISABLED");
        await authorize(session, "run"); await authorize(session, "cancel");
        if (!current || !evidence || evidence.status !== "ready") fail("SOURCE_BLOCKED");
        if (report?.activeOperationId) fail("RUN_ACTIVE");
        if (latest?.state === "unknown") fail("UNKNOWN_REQUIRES_CANCEL");
        if (evidence.evidence.length) {
          const config = await configuration(session); if (!config) fail("CONFIGURATION_UNAVAILABLE");
          await runtime.prepare({ executor: session.executor, identity: session.identity, operationId: randomUUID(), configuration: config, source: current, evidence });
          generation.configuration = { revision: config.revision, hash: config.hash };
        }
        generation = { ...generation, available: true, reasonCode: null };
      } catch (error) {
        generation.reasonCode = error instanceof TRPCError && /^PROFIT_ANALYSIS_[A-Z_]+$/u.test(error.message)
          ? error.message.slice("PROFIT_ANALYSIS_".length) : error instanceof TRPCError && error.code === "FORBIDDEN" ? "PERMISSION_DENIED" : errorCode(error);
      }
    }
    return ProfitAnalysisWorkflowViewResultSchema.parse({ version: 1, identity: session.identity, request: input,
      report: report ? { version: report.version, activeOperationId: report.activeOperationId, latestOperationId: report.latestOperationId,
        savedOperationId: report.savedOperationId, updatedAt: report.updatedAt, savedAt: report.savedAt } : null,
      currentSourceHash: current?.sourceHash ?? null, sourceStatus: evidence?.status ?? "unavailable", generation,
      run: publicRun(run, current), draft: latest?.state === "succeeded" ? publicRun(latest, current) : null, saved: publicRun(saved, current) });
  }
  const preview = (input: ProfitAnalysisPreviewInput) => ProfitAnalysisPreviewInputSchema.parse({ expectedWorkspaceId: input.expectedWorkspaceId, scope: input.scope, month: input.month });
  function saveResult(session: Session, input: z.infer<typeof ProfitAnalysisSaveOperationInputSchema>, value: Awaited<ReturnType<Session["saveOperation"]>>) {
    return ProfitAnalysisWorkflowSaveResultSchema.parse({ version: 1, identity: session.identity, request: input,
      status: value === null ? "absent" : value.status, receipt: value?.status === "committed" ? value.receipt : null });
  }
  return {
    authorize, capture, configuration,
    options(ctx: TrpcContext, raw: unknown) {
      const input = ProfitAnalysisPreviewInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, false, session => view(session, input, undefined, true));
    },
    start(ctx: TrpcContext, raw: unknown) {
      const input = ProfitAnalysisStartInputSchema.parse(raw), target = targetOf(input);
      return invoke(ctx, input.expectedWorkspaceId, true, async session => {
        await authorize(session, "run");
        const requestHash = profitAnalysisJobRequestHash(session.identity, target, input.operationId, input), previous = await session.run(target, input.operationId);
        if (previous) {
          if (previous.requestHash !== null && previous.requestHash !== requestHash) fail("OPERATION_CONTENT_CONFLICT", true);
          return view(session, preview(input), input.operationId);
        }
        if (!writesEnabled() || !workerEnabled()) fail("EXECUTION_DISABLED");
        await authorize(session, "cancel");
        const report = await session.report(target);
        if ((report?.version ?? 0) !== input.expectedReportVersion || report?.activeOperationId) fail("REPORT_CONFLICT", true);
        if (report?.latestOperationId && !input.regenerateConfirmed) fail("REGENERATION_CONFIRMATION_REQUIRED", true);
        const source = await capture(session, target, "run"), evidence = buildProfitAnalysisEvidence(source);
        if (source.sourceHash !== input.expectedSourceHash) fail("SOURCE_CHANGED", true);
        if (evidence.status !== "ready") fail("SOURCE_BLOCKED");
        const config = evidence.evidence.length ? await configuration(session) : null;
        if (evidence.evidence.length && !config) fail("CONFIGURATION_UNAVAILABLE");
        const prepared = config ? await runtime.prepare({ executor: session.executor, identity: session.identity, operationId: input.operationId, configuration: config, source, evidence }) : null;
        await session.enqueue({ target, operationId: input.operationId, expectedReportVersion: input.expectedReportVersion, request: input, requestHash,
          snapshot: { source, evidence, configuration: config, runtime: prepared?.runtimeSnapshot ?? null } });
        return view(session, preview(input), input.operationId);
      });
    },
    check(ctx: TrpcContext, raw: unknown) {
      const input = ProfitAnalysisOperationInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, false, session => view(session, preview(input), input.operationId));
    },
    cancel(ctx: TrpcContext, raw: unknown) {
      const input = ProfitAnalysisOperationInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, true, async session => {
        await authorize(session, "cancel"); const run = await session.cancel({ target: targetOf(input), operationId: input.operationId });
        return ProfitAnalysisWorkflowCancelResultSchema.parse({ version: 1, identity: session.identity, request: input,
          operationId: run.operationId, state: run.state, errorCode: run.errorCode });
      });
    },
    history(ctx: TrpcContext, raw: unknown) {
      const input = ProfitAnalysisHistoryInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, false, async session => {
        const target = targetOf(input), current = await currentOrUnavailable(session, target), history = await session.history(target, { limit: input.limit, beforeId: input.beforeId });
        return ProfitAnalysisWorkflowHistoryResultSchema.parse({ version: 1, identity: session.identity, request: preview(input),
          items: history.items.map(run => ({ operationId: run.operationId, state: run.state, errorCode: run.errorCode,
            sourceHash: run.result?.sourceHash ?? null, resultHash: run.resultHash, result: run.state === "succeeded" ? run.result : null,
            stale: run.result === null ? null : current === null || run.result.sourceHash !== current.sourceHash,
            createdAt: run.createdAt, updatedAt: run.updatedAt, completedAt: run.completedAt })), nextBeforeId: history.nextBeforeId });
      });
    },
    save(ctx: TrpcContext, raw: unknown) {
      const input = ProfitAnalysisSaveInputSchema.parse(raw), target = targetOf(input);
      return invoke(ctx, input.expectedWorkspaceId, true, async session => {
        await authorize(session, "confirm");
        const requestHash = profitAnalysisSaveRequestHash(session.identity, target, input.saveOperationId, input), previous = await session.saveOperation(target, input.saveOperationId);
        const operationInput = { ...preview(input), saveOperationId: input.saveOperationId };
        if (previous) {
          if (previous.status === "committed" && previous.requestHash !== requestHash) fail("SAVE_CONTENT_CONFLICT", true);
          return saveResult(session, operationInput, previous);
        }
        if (!writesEnabled()) fail("WRITES_DISABLED");
        const source = await capture(session, target, "confirm"), run = await session.run(target, input.runOperationId);
        if (!run || run.state !== "succeeded" || !run.result || !run.snapshot || run.resultHash !== input.expectedResultHash) fail("DRAFT_UNAVAILABLE", true);
        if (source.sourceHash !== input.expectedSourceHash || source.sourceHash !== run.snapshot.source.sourceHash) fail("SOURCE_CHANGED", true);
        validateProfitAnalysisResultAgainstEvidence(run.result, run.snapshot.evidence);
        await session.save({ target, saveOperationId: input.saveOperationId, runOperationId: input.runOperationId, expectedReportVersion: input.expectedReportVersion,
          expectedResultHash: input.expectedResultHash, requestHash, request: input });
        return saveResult(session, operationInput, await session.saveOperation(target, input.saveOperationId));
      });
    },
    checkSave(ctx: TrpcContext, raw: unknown) {
      const input = ProfitAnalysisSaveOperationInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, false, async session => saveResult(session, input, await session.saveOperation(targetOf(input), input.saveOperationId)));
    },
    cancelSave(ctx: TrpcContext, raw: unknown) {
      const input = ProfitAnalysisSaveOperationInputSchema.parse(raw);
      return invoke(ctx, input.expectedWorkspaceId, true, async session => {
        await authorize(session, "cancel"); await session.cancelSave({ target: targetOf(input), saveOperationId: input.saveOperationId });
        return saveResult(session, input, await session.saveOperation(targetOf(input), input.saveOperationId));
      });
    },
  };
}
export const profitAnalysisService = createProfitAnalysisService();
