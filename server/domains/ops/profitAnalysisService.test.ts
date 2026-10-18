import { TRPCError } from "@trpc/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const external = vi.hoisted(() => ({ forbidden: vi.fn(() => { throw new Error("NO_REAL_DATABASE_OR_PROVIDER"); }) }));
vi.mock("../../repositories/dbClient", () => ({ getDb: external.forbidden, requireDb: external.forbidden }));
vi.mock("../../services/securityGovernance", () => ({ assertResourceAction: external.forbidden }));
vi.mock("../ai_os/services/assistantConversations", () => ({ loadSavedConfiguration: external.forbidden }));
vi.mock("./profitAnalysisSnapshotRepository", () => ({ authorizeProfitAnalysisSnapshot: external.forbidden, loadProfitAnalysisSnapshot: external.forbidden }));
vi.mock("./profitAnalysisRuntime", () => ({ profitAnalysisRuntime: { prepare: external.forbidden },
  ProfitAnalysisRuntimeError: class extends Error { constructor(readonly code: string) { super(code); } } }));

import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { buildProfitAnalysisEvidence, finishProfitAnalysis, type ProfitAnalysisSource } from "../../../shared/profitAnalysis";
import type { ProfitAnalysisStartInput, ProfitAnalysisSaveInput } from "../../../shared/profitAnalysisWorkflow";
import type { TrpcContext } from "../../_core/context";
import type { AssistantConversationSavedConfiguration } from "../ai_os/services/assistantConversationContext";
import { configurationHash } from "../ai_os/services/assistantConversationSourcePrimitives";
import { profitAnalysisJobHash, profitAnalysisJobRequestHash, profitAnalysisSaveRequestHash, ProfitAnalysisJobStorageError,
  type ProfitAnalysisJobSession, type ProfitAnalysisJobRun, type ProfitAnalysisReport, type ProfitAnalysisSaveOperation,
  type ProfitAnalysisJobEnqueueInput, type ProfitAnalysisJobSaveInput, type ProfitAnalysisJobTarget } from "./profitAnalysisJobRepository";
import { ProfitAnalysisRuntimeError } from "./profitAnalysisRuntime";
import { createProfitAnalysisService } from "./profitAnalysisService";

const identity = { workspaceId: 3, userId: 7 };
const scope = { storeName: "SYNTHETIC_STORE", country: "US", parentAsin: "SYNTHETIC_PARENT", currency: "USD", basis: "child_rows" as const };
const target = { scope, month: "2026-09" };
const preview = { expectedWorkspaceId: 3, ...target };
const op = "b7d29fe8-2c53-4c34-bfe7-cbe34c102125", oldOp = "c7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const saveId = "d7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const now = "2026-10-18 12:00:00.000000";
const clone = <T>(value: T): T => structuredClone(value);
type Deps = NonNullable<Parameters<typeof createProfitAnalysisService>[0]>;
const context = (patch: Record<string, unknown> = {}): TrpcContext => ({
  user: { id: 7, role: "ops_manager", defaultWorkspaceId: 3 }, workspaceId: 3, ...patch,
} as TrpcContext);
function source(unchanged = false): ProfitAnalysisSource {
  const periods = ["2026-08", "2026-09"].map((month, index) => {
    const payload = [{ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), salesQty: 10, salesAmount: 100,
      financialProfit: unchanged ? 20 : 20 + index * 10, yearMonth: month, parentAsin: scope.parentAsin, asin: "SYNTHETIC_CHILD", sku: "SYNTHETIC_SKU", title: "Synthetic only",
      storeName: scope.storeName, site: "US", operator: null, raw: { currency: "USD", privateOriginal: "SYNTHETIC_SOURCE_BODY" } }];
    const record = { id: index + 8, workspaceId: 3, userId: 7, fileName: "synthetic.xlsx", fileHash: "f".repeat(64), status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: 0,
      months: [month], payload, createdAt: now, confirmedAt: now, fileReferenceKind: "storage", sourceRunId: null } as MonthlyFinancialBatchRecord;
    return { month, rows: parseMonthlyFinancialBatch(record).rows, selection: { complete: true as const, rule: "latest_completed_batch_per_month_store_site" as const,
      selectedBatchId: record.id, recordHash: String(index + 8).repeat(64), scopeRowCount: 1, authorizedRowCount: 1 } };
  });
  return { version: 1, identity, scope, month: "2026-09", previousMonth: "2026-08", periods, sourceHash: "a".repeat(64), selectionHash: "b".repeat(64), authorizationHash: "c".repeat(64) };
}
function harness(unchanged = false) {
  let current = source(unchanged), sourceFailure: unknown = null, sourceAuthorizationFailure: unknown = null;
  let role = "ops_manager", writes = true, worker = true, deniedAction: string | null = null;
  let head: ProfitAnalysisReport | null = null;
  const runs = new Map<string, ProfitAnalysisJobRun>(), saves = new Map<string, ProfitAnalysisSaveOperation>();
  const config = { name: "Synthetic finance", description: "Synthetic", enabled: true, modelSlug: "synthetic-finance-model", instructions: "SYNTHETIC_CONFIGURATION_BODY", rules: [], skills: [] };
  const savedConfiguration: AssistantConversationSavedConfiguration = { workspaceId: 3, agentKey: "finance", revision: 2, hash: configurationHash(config), config };
  const request: ProfitAnalysisStartInput = { ...preview, operationId: op, expectedReportVersion: 0, expectedSourceHash: current.sourceHash, regenerateConfirmed: false };
  const executor = { execute: external.forbidden };
  function makeRun(state: ProfitAnalysisJobRun["state"] = "queued", operationId = op, raw = request): ProfitAnalysisJobRun {
    const evidence = buildProfitAnalysisEvidence(current);
    const result = ["result_ready", "succeeded"].includes(state) ? finishProfitAnalysis(evidence, evidence.evidence.length ? {
      severity: "需关注", reasons: [{ evidenceId: evidence.evidence[0].id, explanation: "合成指标变化，须核对覆盖范围。" }],
    } : null) : null;
    return { id: runs.size + 1, ...identity, target: clone(target), scopeHash: profitAnalysisJobHash(target), operationId,
      requestHash: profitAnalysisJobRequestHash(identity, target, operationId, { ...raw, operationId }), snapshotHash: "e".repeat(64), request: { ...clone(raw), operationId },
      snapshot: { source: clone(current), evidence, configuration: evidence.evidence.length ? clone(savedConfiguration) : null, runtime: evidence.evidence.length ? { fixture: true } : null },
      state, attempt: 0, leaseToken: null, leaseOwner: null, leaseExpiresAt: null, heartbeatAt: null,
      dispatchReceipt: result?.modelCalled ? { fixture: true } : null, result, resultHash: result ? profitAnalysisJobHash(result) : null,
      errorCode: state === "canceled" ? "USER_CANCELED" : state === "failed" ? "SYNTHETIC_FAILED" : state === "unknown" ? "OUTCOME_UNKNOWN" : null,
      createdAt: now, updatedAt: now, completedAt: ["succeeded", "failed", "canceled", "unknown"].includes(state) ? now : null };
  }
  function makeHead(patch: Partial<ProfitAnalysisReport> = {}): ProfitAnalysisReport {
    return { id: 1, ...identity, target: clone(target), scopeHash: profitAnalysisJobHash(target), version: 3, activeOperationId: null,
      latestOperationId: op, savedOperationId: null, createdAt: now, updatedAt: now, savedAt: null, ...patch };
  }
  function saveInput(): ProfitAnalysisSaveInput {
    return { ...preview, saveOperationId: saveId, runOperationId: op, expectedReportVersion: head?.version ?? 0,
      expectedResultHash: runs.get(op)?.resultHash ?? "f".repeat(64), expectedSourceHash: current.sourceHash };
  }
  function saveRecord(input: ProfitAnalysisSaveInput, status: "committed" | "canceled"): ProfitAnalysisSaveOperation {
    const committed = status === "committed", requestHash = committed ? profitAnalysisSaveRequestHash(identity, target, input.saveOperationId, input) : null;
    return { id: saves.size + 1, ...identity, scopeHash: profitAnalysisJobHash(target), target: clone(target), status, saveOperationId: input.saveOperationId,
      runOperationId: committed ? input.runOperationId : null, requestHash, request: committed ? clone(input) : null,
      resultHash: committed ? input.expectedResultHash : null, reportVersion: committed ? input.expectedReportVersion + 1 : null,
      savedAt: committed ? now : null, createdAt: now,
      receipt: committed ? { saveId: input.saveOperationId, operationId: input.runOperationId, requestHash: requestHash!, resultHash: input.expectedResultHash,
        sourceHash: input.expectedSourceHash, reportVersion: input.expectedReportVersion + 1, savedAt: now } : null };
  }
  const methods = {
    report: vi.fn(async (_target: ProfitAnalysisJobTarget) => clone(head)),
    run: vi.fn(async (_target: ProfitAnalysisJobTarget, operationId: string) => clone(runs.get(operationId) ?? null)),
    enqueue: vi.fn(async (input: ProfitAnalysisJobEnqueueInput) => {
      const run = makeRun("queued", input.operationId, input.request); run.snapshot = clone(input.snapshot); run.requestHash = input.requestHash;
      runs.set(run.operationId, run); head = makeHead({ version: input.expectedReportVersion + 1, activeOperationId: run.operationId, latestOperationId: run.operationId,
        savedOperationId: head?.savedOperationId ?? null, savedAt: head?.savedAt ?? null }); return clone(run);
    }),
    cancel: vi.fn(async (input: { target: ProfitAnalysisJobTarget; operationId: string }) => {
      const previous = runs.get(input.operationId);
      if (previous && ["succeeded", "failed", "canceled"].includes(previous.state)) return clone(previous);
      const value = previous ?? makeRun("canceled", input.operationId);
      if (!previous) Object.assign(value, { request: null, requestHash: null, snapshot: null, snapshotHash: null });
      Object.assign(value, { state: "canceled", errorCode: "USER_CANCELED", completedAt: now }); runs.set(value.operationId, value); return clone(value);
    }),
    history: vi.fn(async (_target: ProfitAnalysisJobTarget, page: { limit: number; beforeId?: number }) => {
      const found = [...runs.values()].filter(row => page.beforeId === undefined || row.id < page.beforeId).sort((a, b) => b.id - a.id), items = found.slice(0, page.limit);
      return { items: clone(items), nextBeforeId: found.length > page.limit ? items.at(-1)!.id : null };
    }),
    saveOperation: vi.fn(async (_target: ProfitAnalysisJobTarget, id: string) => clone(saves.get(id) ?? null)),
    save: vi.fn(async (input: ProfitAnalysisJobSaveInput) => {
      if (saves.get(input.saveOperationId)?.status === "canceled") throw new ProfitAnalysisJobStorageError("SAVE_CANCELED", true);
      if (!head || head.version !== input.expectedReportVersion || head.activeOperationId || head.latestOperationId !== input.runOperationId) throw new ProfitAnalysisJobStorageError("SAVE_CONFLICT", true);
      const value = saveRecord(input.request, "committed"); saves.set(input.saveOperationId, value);
      head = { ...head, version: head.version + 1, savedOperationId: input.runOperationId, savedAt: now }; return clone(value);
    }),
    cancelSave: vi.fn(async (input: { target: ProfitAnalysisJobTarget; saveOperationId: string }) => {
      const value = saves.get(input.saveOperationId) ?? saveRecord({ ...saveInput(), saveOperationId: input.saveOperationId }, "canceled"); saves.set(input.saveOperationId, value); return clone(value);
    }),
  };
  const session = { identity, actor: { id: 7, role }, executor, ...methods } as unknown as ProfitAnalysisJobSession;
  const repository = { read: vi.fn((_identity: typeof identity) => {}), transaction: vi.fn((_identity: typeof identity) => {}) };
  const repositoryAdapter: NonNullable<Deps["repository"]> = {
    read: async <T>(owner: typeof identity, body: (value: ProfitAnalysisJobSession) => Promise<T>) => { repository.read(owner); return body(session); },
    transaction: async <T>(owner: typeof identity, body: (value: ProfitAnalysisJobSession) => Promise<T>) => { repository.transaction(owner); return body(session); },
  };
  const permission: NonNullable<Deps["permission"]> = vi.fn(async input => {
    if (input.action === deniedAction || `${input.resource}:${input.action}` === deniedAction) throw new TRPCError({ code: "FORBIDDEN", message: "SYNTHETIC_PRIVATE_PERMISSION_DETAIL" });
  });
  const authorizeSource = vi.fn(async (_executor: unknown, input: { identity: typeof identity; expectedRole?: string }, check: typeof permission) => {
    if (sourceAuthorizationFailure) throw sourceAuthorizationFailure;
    if (input.expectedRole !== undefined && input.expectedRole !== role) throw new TRPCError({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_ACTOR_CHANGED" });
    const actor = { id: 7, role, defaultWorkspaceId: 3 };
    await check({ actor, workspaceId: 3, resource: "ops_data", action: "read", authorizationRead: { executor: executor as never, strict: true, lock: true } });
    return { tx: executor, identity, actor, manager: ["super_admin", "admin", "ops_manager"].includes(role), authorizationEvidence: { synthetic: true } };
  });
  const loadSource = vi.fn(async () => { if (sourceFailure) throw sourceFailure; return clone(current); });
  const loadConfiguration = vi.fn(async (): Promise<AssistantConversationSavedConfiguration | null> => clone(savedConfiguration));
  const prepare = vi.fn(async () => ({ runtimeSnapshot: { fixture: true } }));
  const writesEnabled = vi.fn(() => writes), workerEnabled = vi.fn(() => worker);
  const service = createProfitAnalysisService({ repository: repositoryAdapter, permission, authorizeSource: authorizeSource as unknown as Deps["authorizeSource"],
    loadSource: loadSource as Deps["loadSource"], loadConfiguration, runtime: { prepare } as unknown as Deps["runtime"], writesEnabled, workerEnabled });
  return { service, request, session, repository, methods, runs, saves, executor, permission, authorizeSource, loadSource, loadConfiguration, prepare, writesEnabled, workerEnabled,
    makeRun, makeHead, saveRecord, saveInput, current: () => current, head: () => head, setHead: (value: ProfitAnalysisReport | null) => { head = value; },
    setSource: (value: ProfitAnalysisSource) => { current = value; }, failSource: (value: unknown) => { sourceFailure = value; }, failAuthorization: (value: unknown) => { sourceAuthorizationFailure = value; },
    setRole: (value: string) => { role = value; }, gates: (write: boolean, work = write) => { writes = write; worker = work; }, deny: (value: string | null) => { deniedAction = value; } };
}
function successful(h: ReturnType<typeof harness>, oldSaved = false) {
  h.runs.set(op, h.makeRun("succeeded"));
  if (oldSaved) h.runs.set(oldOp, h.makeRun("succeeded", oldOp));
  h.setHead(h.makeHead({ savedOperationId: oldSaved ? oldOp : null, savedAt: oldSaved ? now : null }));
}
function assertNoPrivateProjection(value: unknown) {
  const text = JSON.stringify(value);
  for (const secret of ["SYNTHETIC_SOURCE_BODY", "SYNTHETIC_CONFIGURATION_BODY", '"snapshot"', '"raw"', '"runtime"', '"dispatchReceipt"', '"authorizationEvidence"', '"requestHash":null']) expect(text).not.toContain(secret);
}
afterEach(() => { expect(external.forbidden).not.toHaveBeenCalled(); vi.clearAllMocks(); });

describe("profit service fresh authorization and disabled defaults", () => {
  it("rejects unauthenticated and switched workspace before opening a repository session", async () => {
    const h = harness();
    await expect(h.service.options(context({ user: null }), preview)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(h.service.options(context({ workspaceId: 4 }), preview)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(h.repository.read).not.toHaveBeenCalled(); expect(h.authorizeSource).not.toHaveBeenCalled();
  });
  it("checks current role even on recovery and forwards strict same-executor ops plus finance authority", async () => {
    const h = harness(); h.gates(false); await h.service.check(context(), { ...preview, operationId: op });
    expect(h.authorizeSource).toHaveBeenCalledWith(h.executor, { identity, expectedRole: "ops_manager" }, h.permission);
    expect(h.permission).toHaveBeenCalledWith(expect.objectContaining({ resource: "ops_data", action: "read", workspaceId: 3, authorizationRead: { executor: h.executor, strict: true, lock: true } }));
    expect(h.permission).toHaveBeenCalledWith(expect.objectContaining({ resource: "agent", resourceId: "finance", action: "read", authorizationRead: { executor: h.executor, strict: true, lock: true } }));
    h.setRole("specialist"); await expect(h.service.check(context(), { ...preview, operationId: op })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it.each(["ops_data:read", "agent:read"])("%s revocation forbids old report reads", async denied => {
    const h = harness(); successful(h, true); h.deny(denied);
    await expect(h.service.check(context(), { ...preview, operationId: op })).rejects.toMatchObject({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_ACCESS_OR_SOURCE_UNAVAILABLE" });
    expect(h.methods.report).not.toHaveBeenCalled(); expect(h.loadSource).not.toHaveBeenCalled();
  });
  it.each(["MEMBERSHIP_UNAVAILABLE", "DIRECTORY_DENIED", "WORKSPACE_UNAVAILABLE"])("propagates same-TX source authorization %s", async code => {
    const h = harness(); h.failAuthorization(new TRPCError({ code: "FORBIDDEN", message: `PROFIT_ANALYSIS_${code}` }));
    await expect(h.service.options(context(), preview)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.methods.report).not.toHaveBeenCalled();
  });
  it.each([[false, false], [true, false], [false, true]])("writes=%s worker=%s disables generation without registry reads", async (writes, worker) => {
    const h = harness(); h.gates(writes, worker); const view = await h.service.options(context(), preview);
    expect(view.generation).toMatchObject({ available: false, reasonCode: "EXECUTION_DISABLED" });
    expect(h.prepare).not.toHaveBeenCalled(); expect(h.loadConfiguration).not.toHaveBeenCalled();
    await expect(h.service.start(context(), h.request)).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_EXECUTION_DISABLED" }); expect(h.methods.enqueue).not.toHaveBeenCalled();
  });
  it.each(["run", "cancel"])("options refuses unavailable %s capability but preserves authorized read", async denied => {
    const h = harness(); h.deny(denied); const view = await h.service.options(context(), preview);
    expect(view.generation).toMatchObject({ available: false, reasonCode: "PERMISSION_DENIED" }); expect(h.prepare).not.toHaveBeenCalled();
  });
  it("options returns only approved configuration metadata, not a fake completed analysis", async () => {
    const h = harness(); const view = await h.service.options(context(), preview);
    expect(view.generation).toMatchObject({ available: true, reasonCode: null, modelRequired: true, configuration: { revision: 2 } });
    expect(h.prepare).toHaveBeenCalledTimes(1); expect(h.methods.enqueue).not.toHaveBeenCalled(); assertNoPrivateProjection(view);
  });
  it("unapproved runtime makes generation unavailable and cannot enqueue", async () => {
    const h = harness(); h.prepare.mockRejectedValue(new ProfitAnalysisRuntimeError("SOURCE_UNAVAILABLE"));
    expect((await h.service.options(context(), preview)).generation).toMatchObject({ available: false, reasonCode: "SOURCE_UNAVAILABLE" });
    await expect(h.service.start(context(), h.request)).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_SOURCE_UNAVAILABLE" }); expect(h.methods.enqueue).not.toHaveBeenCalled();
  });
});

describe("profit service start, deterministic capture and durable replay", () => {
  it("captures complete source/evidence/config only inside the private enqueue, without running provider", async () => {
    const h = harness(); const view = await h.service.start(context(), h.request);
    expect(view.run).toMatchObject({ operationId: op, state: "queued", result: null });
    const call = h.methods.enqueue.mock.calls[0][0];
    expect(call.snapshot.source).toEqual(h.current()); expect(call.snapshot.evidence).toEqual(buildProfitAnalysisEvidence(h.current()));
    expect(call.requestHash).toBe(profitAnalysisJobRequestHash(identity, target, op, h.request));
    expect(call.snapshot.configuration?.agentKey).toBe("finance"); expect(h.prepare).toHaveBeenCalledTimes(1); assertNoPrivateProjection(view);
  });
  it("deterministic no-change options/start do not load config, registry or runtime", async () => {
    const h = harness(true); h.loadConfiguration.mockRejectedValue(new Error("MUST_NOT_READ_CONFIGURATION")); h.prepare.mockRejectedValue(new Error("MUST_NOT_RESOLVE_REGISTRY"));
    const view = await h.service.options(context(), preview); expect(view.generation).toEqual({ available: true, reasonCode: null, modelRequired: false, configuration: null });
    await h.service.start(context(), h.request); expect(h.methods.enqueue.mock.calls[0][0].snapshot).toMatchObject({ configuration: null, runtime: null });
    expect(h.loadConfiguration).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled();
  });
  it.each(["queued", "dispatched", "result_ready", "succeeded", "failed", "canceled", "unknown"] as const)("same UUID %s replay ignores new gates/config and never enqueues", async state => {
    const h = harness(); h.runs.set(op, h.makeRun(state)); h.gates(false); h.loadConfiguration.mockRejectedValue(new Error("MUST_NOT_READ_NEW_CONFIGURATION"));
    const view = await h.service.start(context(), h.request); expect(view.run?.state).toBe(state);
    expect(h.writesEnabled).not.toHaveBeenCalled(); expect(h.workerEnabled).not.toHaveBeenCalled(); expect(h.loadConfiguration).not.toHaveBeenCalled();
    expect(h.methods.enqueue).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled(); assertNoPrivateProjection(view);
  });
  it.each(["expectedSourceHash", "expectedReportVersion", "regenerateConfirmed"])("same UUID changed %s is rejected before current source lookup", async field => {
    const h = harness(); h.runs.set(op, h.makeRun()); const input = { ...h.request, [field]: field === "expectedSourceHash" ? "d".repeat(64) : field === "expectedReportVersion" ? 1 : true };
    await expect(h.service.start(context(), input)).rejects.toMatchObject({ code: "CONFLICT", message: "PROFIT_ANALYSIS_OPERATION_CONTENT_CONFLICT" });
    expect(h.loadSource).not.toHaveBeenCalled(); expect(h.loadConfiguration).not.toHaveBeenCalled(); expect(h.methods.enqueue).not.toHaveBeenCalled();
  });
  it("unknown ACK after enqueue is resolved by the same UUID, not a second runtime preparation", async () => {
    const h = harness(), implementation = h.methods.enqueue.getMockImplementation()!;
    h.methods.enqueue.mockImplementationOnce(async input => { await implementation(input); throw new Error("SYNTHETIC_LOST_ACK"); });
    await expect(h.service.start(context(), h.request)).rejects.toMatchObject({ code: "INTERNAL_SERVER_ERROR", message: "PROFIT_ANALYSIS_OUTCOME_UNVERIFIED" });
    h.gates(false); expect((await h.service.start(context(), h.request)).run?.state).toBe("queued");
    expect(h.methods.enqueue).toHaveBeenCalledTimes(1); expect(h.prepare).toHaveBeenCalledTimes(1);
  });
  it("regeneration requires explicit acknowledgement, report version and unchanged source", async () => {
    const h = harness(); successful(h, true);
    await expect(h.service.start(context(), { ...h.request, operationId: saveId, expectedReportVersion: 3 })).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_REGENERATION_CONFIRMATION_REQUIRED" });
    await expect(h.service.start(context(), { ...h.request, operationId: saveId, regenerateConfirmed: true, expectedReportVersion: 2 })).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_REPORT_CONFLICT" });
    await expect(h.service.start(context(), { ...h.request, operationId: saveId, regenerateConfirmed: true, expectedReportVersion: 3, expectedSourceHash: "d".repeat(64) })).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_SOURCE_CHANGED" });
    expect(h.methods.enqueue).not.toHaveBeenCalled();
    await h.service.start(context(), { ...h.request, operationId: saveId, regenerateConfirmed: true, expectedReportVersion: 3 });
    expect(h.head()?.savedOperationId).toBe(oldOp); expect(h.methods.enqueue).toHaveBeenCalledTimes(1);
  });
  it("an active run cannot be bypassed by regenerate acknowledgement", async () => {
    const h = harness(); h.setHead(h.makeHead({ activeOperationId: oldOp, latestOperationId: oldOp }));
    await expect(h.service.start(context(), { ...h.request, expectedReportVersion: 3, regenerateConfirmed: true })).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_REPORT_CONFLICT" }); expect(h.prepare).not.toHaveBeenCalled();
  });
  it("latest unknown outcome disables new generation until the original UUID is canceled", async () => {
    const h = harness(); h.runs.set(op, h.makeRun("unknown")); h.setHead(h.makeHead());
    const view = await h.service.options(context(), preview);
    expect(view.generation).toMatchObject({ available: false, reasonCode: "UNKNOWN_REQUIRES_CANCEL" });
    expect(view.run?.state).toBe("unknown"); expect(h.prepare).not.toHaveBeenCalled(); expect(h.loadConfiguration).not.toHaveBeenCalled();
  });
  it.each(["active", "latest", "saved"] as const)("a nonempty %s report pointer without its run is corruption, not an empty view", async pointer => {
    const h = harness();
    h.setHead(h.makeHead({ activeOperationId: pointer === "active" ? op : null,
      latestOperationId: pointer === "saved" ? null : op, savedOperationId: pointer === "saved" ? op : null, savedAt: pointer === "saved" ? now : null }));
    await expect(h.service.options(context(), preview)).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_REPORT_INVALID" });
    expect(h.prepare).not.toHaveBeenCalled(); expect(h.loadConfiguration).not.toHaveBeenCalled();
  });
  it("blocked complete source cannot enqueue or use finance configuration", async () => {
    const h = harness(), current = clone(h.current()); current.scope.currency = null; current.periods.forEach(period => period.rows.forEach(row => { row.currency = null; })); h.setSource(current);
    await expect(h.service.start(context(), h.request)).rejects.toThrow(); expect(h.methods.enqueue).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled();
  });
  it("missing finance configuration cannot use a borrowed/default model", async () => {
    const h = harness(); h.loadConfiguration.mockResolvedValue(null);
    await expect(h.service.start(context(), h.request)).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_CONFIGURATION_UNAVAILABLE" }); expect(h.prepare).not.toHaveBeenCalled(); expect(h.methods.enqueue).not.toHaveBeenCalled();
  });
});

describe("profit service cancellation fences and source authorization", () => {
  it("cancel creates a metadata-only permanent fence with gates off and source/config unavailable", async () => {
    const h = harness(); h.gates(false); h.failSource(new Error("UNAVAILABLE")); h.loadConfiguration.mockRejectedValue(new Error("UNAVAILABLE"));
    const value = await h.service.cancel(context(), { ...preview, operationId: op }); expect(value).toMatchObject({ operationId: op, state: "canceled" });
    expect(h.loadSource).not.toHaveBeenCalled(); expect(h.loadConfiguration).not.toHaveBeenCalled(); expect(h.prepare).not.toHaveBeenCalled();
    expect(h.runs.get(op)).toMatchObject({ request: null, requestHash: null, snapshot: null }); assertNoPrivateProjection(value);
    h.gates(true); expect((await h.service.start(context(), h.request)).run?.state).toBe("canceled"); expect(h.methods.enqueue).not.toHaveBeenCalled();
  });
  it("cancel after success returns the existing terminal outcome and keeps saved report", async () => {
    const h = harness(); successful(h, true); const before = clone(h.head());
    expect((await h.service.cancel(context(), { ...preview, operationId: op })).state).toBe("succeeded"); expect(h.head()).toEqual(before); expect(h.loadSource).not.toHaveBeenCalled();
  });
  it("cancel requires current cancel permission even when gates are off", async () => {
    const h = harness(); h.gates(false); h.deny("cancel");
    await expect(h.service.cancel(context(), { ...preview, operationId: op })).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.methods.cancel).not.toHaveBeenCalled();
  });
  it.each(["check", "history", "options"] as const)("%s never downgrades revoked exact financial source to stale readable results", async method => {
    const h = harness(); successful(h, true); h.failSource(new TRPCError({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_SCOPE_DENIED" }));
    const input = method === "check" ? { ...preview, operationId: op } : preview;
    await expect(h.service[method](context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.methods.report).not.toHaveBeenCalled(); expect(h.methods.history).not.toHaveBeenCalled();
  });
  it("same UUID replay still refuses revoked source read without preparing again", async () => {
    const h = harness(); h.runs.set(op, h.makeRun("succeeded")); h.failSource(new TRPCError({ code: "UNAUTHORIZED", message: "SYNTHETIC_PRIVATE_DETAIL" }));
    await expect(h.service.start(context(), h.request)).rejects.toMatchObject({ code: "UNAUTHORIZED" }); expect(h.prepare).not.toHaveBeenCalled();
  });
  it("non-authorization source failure allows explicitly stale saved results but no generation", async () => {
    const h = harness(); successful(h, true); h.failSource(new Error("SYNTHETIC_PRIVATE_DATABASE_DETAIL"));
    const view = await h.service.options(context(), preview); expect(view).toMatchObject({ sourceStatus: "unavailable", currentSourceHash: null, saved: { stale: true }, generation: { available: false, reasonCode: "SOURCE_BLOCKED" } });
    expect(JSON.stringify(view)).not.toContain("DATABASE_DETAIL"); assertNoPrivateProjection(view);
  });
  it.each(["check", "history", "options"] as const)("ordinary user's %s fails closed when exact current-scope ownership cannot be established", async method => {
    const h = harness(); successful(h, true); h.setRole("specialist"); h.failSource(new Error("SYNTHETIC_OWNERSHIP_SOURCE_UNAVAILABLE"));
    const ordinary = context({ user: { id: 7, role: "specialist", defaultWorkspaceId: 3 } });
    const input = method === "check" ? { ...preview, operationId: op } : preview;
    await expect(h.service[method](ordinary, input)).rejects.toThrow();
    expect(h.methods.report).not.toHaveBeenCalled(); expect(h.methods.history).not.toHaveBeenCalled(); expect(h.methods.run).not.toHaveBeenCalled();
  });
});

describe("profit service separate save UUID and result retention", () => {
  it("saves only an already-validated successful draft without another model call", async () => {
    const h = harness(); successful(h, true); const input = h.saveInput(), result = await h.service.save(context(), input);
    expect(result).toMatchObject({ status: "committed", receipt: { saveId, operationId: op, reportVersion: 4, resultHash: input.expectedResultHash, sourceHash: input.expectedSourceHash } });
    expect(h.head()?.savedOperationId).toBe(op); expect(h.prepare).not.toHaveBeenCalled(); expect(h.loadConfiguration).not.toHaveBeenCalled(); assertNoPrivateProjection(result);
    expect(h.methods.save.mock.calls[0][0].requestHash).toBe(profitAnalysisSaveRequestHash(identity, target, saveId, input));
  });
  it("committed same save UUID recovers before new source/config/gates", async () => {
    const h = harness(); successful(h); const input = h.saveInput(); const saved = h.saveRecord(input, "committed"); h.saves.set(saveId, saved);
    h.gates(false); h.failSource(new TRPCError({ code: "FORBIDDEN", message: "PROFIT_ANALYSIS_SCOPE_DENIED" }));
    const result = await h.service.save(context(), input); expect(result.receipt).toEqual(saved.receipt); expect(h.writesEnabled).not.toHaveBeenCalled(); expect(h.loadSource).not.toHaveBeenCalled(); expect(h.methods.save).not.toHaveBeenCalled();
  });
  it("save replay still requires fresh confirm authority", async () => {
    const h = harness(); successful(h); const input = h.saveInput(); h.saves.set(saveId, h.saveRecord(input, "committed")); h.deny("confirm");
    await expect(h.service.save(context(), input)).rejects.toMatchObject({ code: "FORBIDDEN" }); expect(h.methods.saveOperation).not.toHaveBeenCalled();
  });
  it.each(["expectedReportVersion", "expectedResultHash", "expectedSourceHash", "runOperationId"])("same saved UUID different %s is refused without touching source", async field => {
    const h = harness(); successful(h); const input = h.saveInput(); h.saves.set(saveId, h.saveRecord(input, "committed"));
    const changed = { ...input, [field]: field === "expectedReportVersion" ? 2 : field === "runOperationId" ? oldOp : "d".repeat(64) };
    await expect(h.service.save(context(), changed)).rejects.toMatchObject({ code: "CONFLICT", message: "PROFIT_ANALYSIS_SAVE_CONTENT_CONFLICT" }); expect(h.loadSource).not.toHaveBeenCalled(); expect(h.methods.save).not.toHaveBeenCalled();
  });
  it("lost save ACK is metadata-only checkable with original independent UUID", async () => {
    const h = harness(); successful(h, true); const input = h.saveInput(), original = h.methods.save.getMockImplementation()!;
    h.methods.save.mockImplementationOnce(async value => { await original(value); throw new Error("SYNTHETIC_LOST_SAVE_ACK"); });
    await expect(h.service.save(context(), input)).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_OUTCOME_UNVERIFIED" });
    h.failSource(new Error("UNAVAILABLE")); h.gates(false); h.loadSource.mockClear();
    const result = await h.service.checkSave(context(), { ...preview, saveOperationId: saveId }); expect(result.status).toBe("committed");
    expect(h.loadSource).not.toHaveBeenCalled(); expect(h.methods.save).toHaveBeenCalledTimes(1); expect(h.prepare).not.toHaveBeenCalled();
  });
  it.each(["queued", "dispatched", "result_ready", "failed", "canceled", "unknown"] as const)("cannot save %s and cannot erase previously saved result", async state => {
    const h = harness(); successful(h, true); h.runs.set(op, h.makeRun(state)); const before = clone(h.head());
    await expect(h.service.save(context(), h.saveInput())).rejects.toMatchObject({ code: "CONFLICT", message: "PROFIT_ANALYSIS_DRAFT_UNAVAILABLE" });
    expect(h.methods.save).not.toHaveBeenCalled(); expect(h.head()).toEqual(before);
  });
  it.each(["current", "expected", "snapshot"])("changed %s source hash fails before mutating the old saved report", async kind => {
    const h = harness(); successful(h, true); const input = h.saveInput(), before = clone(h.head());
    if (kind === "current") h.setSource({ ...h.current(), sourceHash: "d".repeat(64) });
    if (kind === "expected") input.expectedSourceHash = "d".repeat(64);
    if (kind === "snapshot") h.runs.get(op)!.snapshot!.source.sourceHash = "d".repeat(64);
    await expect(h.service.save(context(), input)).rejects.toMatchObject({ code: "CONFLICT", message: "PROFIT_ANALYSIS_SOURCE_CHANGED" });
    expect(h.methods.save).not.toHaveBeenCalled(); expect(h.head()).toEqual(before);
  });
  it("save report CAS refusal is delegated atomically and old saved pointer remains", async () => {
    const h = harness(); successful(h, true); const before = clone(h.head());
    await expect(h.service.save(context(), { ...h.saveInput(), expectedReportVersion: 2 })).rejects.toMatchObject({ code: "CONFLICT", message: "PROFIT_ANALYSIS_SAVE_CONFLICT" }); expect(h.head()).toEqual(before);
  });
  it("invalid successful result cannot be written to saved report", async () => {
    const h = harness(); successful(h, true); const before = clone(h.head()); h.runs.get(op)!.result!.delta = 999;
    await expect(h.service.save(context(), h.saveInput())).rejects.toThrow(); expect(h.methods.save).not.toHaveBeenCalled(); expect(h.head()).toEqual(before);
  });
  it("disabled writes refuse a new save but do not call model/config", async () => {
    const h = harness(); successful(h, true); h.gates(false);
    await expect(h.service.save(context(), h.saveInput())).rejects.toMatchObject({ message: "PROFIT_ANALYSIS_WRITES_DISABLED" }); expect(h.methods.save).not.toHaveBeenCalled(); expect(h.loadSource).not.toHaveBeenCalled();
  });
  it("cancel before save creates an independent tombstone, without reading source or altering generation", async () => {
    const h = harness(); successful(h, true); const input = h.saveInput(), before = clone(h.head()); h.gates(false); h.failSource(new Error("UNAVAILABLE"));
    expect((await h.service.cancelSave(context(), { ...preview, saveOperationId: saveId })).status).toBe("canceled");
    expect(h.loadSource).not.toHaveBeenCalled(); expect(h.methods.cancel).not.toHaveBeenCalled(); expect(h.runs.get(op)?.state).toBe("succeeded");
    h.gates(true); expect((await h.service.save(context(), input)).status).toBe("canceled"); expect(h.methods.save).not.toHaveBeenCalled(); expect(h.head()).toEqual(before);
  });
  it("save before cancel preserves committed receipt and saved report", async () => {
    const h = harness(); successful(h, true); const result = await h.service.save(context(), h.saveInput()); const before = clone(h.head());
    h.gates(false); const canceled = await h.service.cancelSave(context(), { ...preview, saveOperationId: saveId });
    expect(canceled).toEqual(result); expect(h.head()).toEqual(before); expect(h.methods.cancel).not.toHaveBeenCalled();
  });
  it("a cancellation fence discovered at the final save boundary cannot be overwritten", async () => {
    const h = harness(); successful(h, true); const input = h.saveInput(), before = clone(h.head()), original = h.methods.save.getMockImplementation()!;
    h.methods.save.mockImplementationOnce(async value => { h.saves.set(saveId, h.saveRecord(input, "canceled")); return original(value); });
    await expect(h.service.save(context(), input)).rejects.toMatchObject({ code: "CONFLICT", message: "PROFIT_ANALYSIS_SAVE_CANCELED" }); expect(h.head()).toEqual(before);
    expect((await h.service.checkSave(context(), { ...preview, saveOperationId: saveId })).status).toBe("canceled");
  });
  it("absent save check is metadata-only and does not claim a durable canceled/committed receipt", async () => {
    const h = harness(); h.gates(false); h.failSource(new Error("UNAVAILABLE"));
    expect(await h.service.checkSave(context(), { ...preview, saveOperationId: saveId })).toMatchObject({ status: "absent", receipt: null }); expect(h.loadSource).not.toHaveBeenCalled(); expect(h.methods.save).not.toHaveBeenCalled();
  });
});

describe("profit service full cursor history and public projections", () => {
  it("pages all 23 runs rather than silently keeping one screen or six months", async () => {
    const h = harness(true);
    for (let index = 1; index <= 23; index++) {
      const operationId = `${index.toString(16).padStart(8, "0")}-2c53-4c34-bfe7-cbe34c102125`, run = h.makeRun("succeeded", operationId); run.id = index; h.runs.set(operationId, run);
    }
    const first = await h.service.history(context(), { ...preview, limit: 10 });
    const second = await h.service.history(context(), { ...preview, limit: 10, beforeId: first.nextBeforeId });
    const third = await h.service.history(context(), { ...preview, limit: 10, beforeId: second.nextBeforeId });
    expect([first.items.length, second.items.length, third.items.length]).toEqual([10, 10, 3]); expect([first.nextBeforeId, second.nextBeforeId, third.nextBeforeId]).toEqual([14, 4, null]);
    expect(new Set([...first.items, ...second.items, ...third.items].map(row => row.operationId)).size).toBe(23);
    expect(h.methods.history).toHaveBeenNthCalledWith(2, target, { limit: 10, beforeId: 14 }); for (const page of [first, second, third]) assertNoPrivateProjection(page);
  });
  it("paid result_ready content remains private until succeeded", async () => {
    const h = harness(); h.runs.set(op, h.makeRun("result_ready"));
    const view = await h.service.check(context(), { ...preview, operationId: op }), history = await h.service.history(context(), preview);
    expect(view.run?.result).toBeNull(); expect(view.draft).toBeNull(); expect(history.items[0].result).toBeNull(); assertNoPrivateProjection(history);
  });
  it("explicit stale comparison and complete evidence are retained for successful history", async () => {
    const h = harness(); successful(h); h.setSource({ ...h.current(), sourceHash: "d".repeat(64) });
    const history = await h.service.history(context(), preview); expect(history.items[0].stale).toBe(true);
    expect(history.items[0].result?.aggregates).toEqual(h.runs.get(op)?.result?.aggregates); assertNoPrivateProjection(history);
  });
  it("history never forwards private errors, config snapshots or original monthly rows", async () => {
    const h = harness(); successful(h); h.failSource(new Error("SYNTHETIC_PRIVATE_SOURCE_ERROR")); const history = await h.service.history(context(), preview);
    assertNoPrivateProjection(history); expect(JSON.stringify(history)).not.toContain("SYNTHETIC_PRIVATE_SOURCE_ERROR"); expect(history.items[0].stale).toBe(true);
  });
  it("bad inputs fail before any DB session or enqueue", async () => {
    const h = harness();
    for (const value of [{ ...h.request, expectedWorkspaceId: 4.5 }, { ...h.request, operationId: op.toUpperCase() }, { ...h.request, injectedSource: source() }, { ...h.request, month: "2026-13" }]) {
      await expect(async () => h.service.start(context(), value)).rejects.toThrow();
    }
    expect(h.repository.transaction).not.toHaveBeenCalled(); expect(h.methods.enqueue).not.toHaveBeenCalled();
  });
});
