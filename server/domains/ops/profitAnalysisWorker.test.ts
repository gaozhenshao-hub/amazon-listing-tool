import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const external = vi.hoisted(() => ({ db: vi.fn(() => { throw new Error("NO_REAL_DATABASE"); }), provider: vi.fn(() => { throw new Error("NO_REAL_PROVIDER"); }) }));
vi.mock("../../repositories/dbClient", () => ({ getDb: external.db, requireDb: external.db }));
vi.mock("../../_core/llm", () => ({ invokeLLM: external.provider }));
vi.mock("../../infrastructure/http/safeHttpClient", () => ({ SafeHttpError: class extends Error {}, safeHttpRequest: external.provider }));
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";
import { buildProfitAnalysisEvidence, finishProfitAnalysis, type ProfitAnalysisSource } from "../../../shared/profitAnalysis";
import { createProfitAnalysisProcessor, createProfitAnalysisWorker, shouldProcessProfitAnalysis, startProfitAnalysisWorker } from "./profitAnalysisWorker";
import { ProfitAnalysisJobStorageError, type ProfitAnalysisJobLease, type ProfitAnalysisJobRun, type ProfitAnalysisJobSession } from "./profitAnalysisJobRepository";
import type { ProfitAnalysisPreparedStage, ProfitAnalysisRuntime } from "./profitAnalysisRuntime";
import type { AssistantConversationSavedConfiguration } from "../ai_os/services/assistantConversationContext";
import type { StrictSkillDispatchReceipt } from "../ai_os/services/skillRunner";
import type { ProfitAnalysisSnapshotSession } from "./profitAnalysisSnapshotRepository";

const identity = { workspaceId: 3, userId: 7 };
const hint = { ...identity, id: 13, operationId: "b7d29fe8-2c53-4c34-bfe7-cbe34c102125" };
const digest = "a".repeat(64), time = "2026-10-18 12:00:00.000000";
const scope = { storeName: "SYNTHETIC_STORE", country: "US", parentAsin: "SYNTHETIC_PARENT", currency: "USD", basis: "child_rows" as const };
const clone = <T>(value: T): T => structuredClone(value);
function source(unchanged = false): ProfitAnalysisSource {
  const periods = ["2026-08", "2026-09"].map((month, index) => {
    const payload = [{ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), salesQty: 10, salesAmount: 100,
      financialProfit: unchanged ? 20 : 20 + index * 10, yearMonth: month, parentAsin: scope.parentAsin, asin: "SYNTHETIC_CHILD", sku: "SYNTHETIC_SKU", title: "Synthetic only",
      storeName: scope.storeName, site: "US", operator: null, raw: { currency: "USD", privateField: "SYNTHETIC_PRIVATE_ORIGINAL" } }];
    const batch = { id: index + 8, workspaceId: 3, userId: 7, fileName: "synthetic.xlsx", fileHash: "f".repeat(64), status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: 0,
      months: [month], payload, createdAt: time, confirmedAt: time, fileReferenceKind: "storage", sourceRunId: null } as MonthlyFinancialBatchRecord;
    return { month, rows: parseMonthlyFinancialBatch(batch).rows, selection: { complete: true as const, rule: "latest_completed_batch_per_month_store_site" as const,
      selectedBatchId: batch.id, recordHash: String(index + 8).repeat(64), scopeRowCount: 1, authorizedRowCount: 1 } };
  });
  return { version: 1, identity, scope, month: "2026-09", previousMonth: "2026-08", periods, sourceHash: digest, selectionHash: "b".repeat(64), authorizationHash: "c".repeat(64) };
}
function fixture(state: ProfitAnalysisJobRun["state"] = "queued", unchanged = false) {
  let enabled = true, inTransaction = false, epochLost = false, duplicateFence = false;
  const events: string[] = [], controller = new AbortController(), original = source(unchanged), current = clone(original);
  const evidence = buildProfitAnalysisEvidence(original);
  const result = finishProfitAnalysis(evidence, unchanged ? null : { severity: "需关注", reasons: [{ evidenceId: evidence.evidence[0].id, explanation: "Synthetic evidence only" }] });
  const configuration: AssistantConversationSavedConfiguration = { workspaceId: 3, agentKey: "finance", revision: 1, hash: digest,
    config: { name: "Synthetic finance", description: "", enabled: true, modelSlug: "synthetic-only", instructions: "", rules: [], skills: [] } };
  const target = { scope, month: "2026-09" };
  const lease: ProfitAnalysisJobLease = { target, operationId: hint.operationId, workerId: "synthetic-worker", leaseToken: "b7d29fe8-2c53-4c34-bfe7-cbe34c102126", attempt: 1 };
  const run: ProfitAnalysisJobRun = { ...hint, target, scopeHash: digest, requestHash: digest, snapshotHash: digest,
    request: { expectedWorkspaceId: 3, ...target, operationId: hint.operationId, expectedReportVersion: 0, expectedSourceHash: digest, regenerateConfirmed: false },
    snapshot: { source: clone(original), evidence, configuration: unchanged ? null : clone(configuration), runtime: unchanged ? null : { synthetic: true } },
    state, attempt: 1, leaseToken: lease.leaseToken, leaseOwner: lease.workerId, leaseExpiresAt: time, heartbeatAt: time,
    dispatchReceipt: null, result: state === "result_ready" ? clone(result) : null, resultHash: state === "result_ready" ? digest : null,
    errorCode: null, createdAt: time, updatedAt: time, completedAt: null };
  const assertLease = () => { if (epochLost || ["canceled", "succeeded", "failed", "unknown"].includes(run.state)) throw new ProfitAnalysisJobStorageError("LEASE_LOST", true); };
  const authorize = vi.fn(async (_session: ProfitAnalysisJobSession, _action: string) => { events.push("authorize"); return _session as unknown as ProfitAnalysisSnapshotSession; });
  const capture = vi.fn(async (_session: ProfitAnalysisJobSession, _target: unknown, _action = "read") => { events.push("capture"); return clone(current); });
  const loadConfiguration = vi.fn(async () => configuration as AssistantConversationSavedConfiguration | null);
  const runById = vi.fn(async () => clone(run) as ProfitAnalysisJobRun | null);
  const claim = vi.fn(async () => {
    events.push("claim");
    if (run.state === "dispatched") { run.state = "unknown"; run.errorCode = "MODEL_RESULT_UNKNOWN"; return { run: clone(run), lease: null }; }
    if (["canceled", "succeeded", "failed", "unknown"].includes(run.state)) return { run: clone(run), lease: null };
    return { run: clone(run), lease };
  });
  const heartbeat = vi.fn(async () => { assertLease(); events.push("heartbeat"); });
  const dispatch = vi.fn(async (_lease: ProfitAnalysisJobLease, receipt: unknown) => {
    assertLease(); if (run.state !== "queued") throw new ProfitAnalysisJobStorageError("CHECKPOINT_CONFLICT");
    run.state = "dispatched"; run.dispatchReceipt = receipt; events.push("durable-dispatch"); return clone(run);
  });
  const resultReady = vi.fn(async (_lease: ProfitAnalysisJobLease, value: typeof result) => {
    assertLease(); if (!["queued", "dispatched"].includes(run.state)) throw new ProfitAnalysisJobStorageError("CHECKPOINT_CONFLICT");
    run.result = clone(value); run.resultHash = digest; run.state = "result_ready"; events.push("durable-result"); return clone(run);
  });
  const finish = vi.fn(async () => { assertLease(); if (run.state !== "result_ready") throw new ProfitAnalysisJobStorageError("CHECKPOINT_CONFLICT"); run.state = "succeeded"; events.push("succeeded"); return clone(run); });
  const fail = vi.fn(async (_lease: ProfitAnalysisJobLease, code: string) => {
    assertLease(); if (run.state === "result_ready") throw new Error("must preserve paid result");
    run.state = run.state === "dispatched" ? "unknown" : "failed"; run.errorCode = code; events.push(run.state); return clone(run);
  });
  const session = { executor: { execute: vi.fn() }, identity, actor: { id: 7, role: "admin" }, runById, claim, heartbeat, dispatch, resultReady, finish, fail } as unknown as ProfitAnalysisJobSession;
  const transaction = vi.fn();
  async function transact<T>(owner: unknown, body: (value: ProfitAnalysisJobSession) => Promise<T>): Promise<T> {
    transaction(owner); expect(owner).toEqual(identity); inTransaction = true;
    try { return await body(session); } finally { inTransaction = false; }
  }
  const stage: ProfitAnalysisPreparedStage = { stage: "profit_analysis", bindingHash: digest, contextHash: digest, snapshotHash: digest };
  const receipt: StrictSkillDispatchReceipt = { runId: "synthetic-paid-run", stage: "profit_analysis", requestHash: "b".repeat(64), modelConfigurationHash: digest, bindingHash: digest,
    budget: { textBytes: 1, imageCount: 0, imageBytes: 0, contextAdmissionUnits: 1025, outputTokens: 100, contextLimit: 10000, tokenEstimateIsExact: false } };
  const prepareStage = vi.fn(async () => { expect(inTransaction).toBe(true); events.push("prepare"); return stage; });
  const verifyFresh = vi.fn(async (_executor: unknown, config: AssistantConversationSavedConfiguration, fresh: ProfitAnalysisSource) => {
    expect(inTransaction).toBe(true); events.push("verify-fresh");
    if (config.hash !== run.snapshot?.configuration?.hash || config.revision !== run.snapshot.configuration.revision) throw new ProfitAnalysisJobStorageError("CONFIGURATION_CHANGED");
    if (fresh.sourceHash !== original.sourceHash || fresh.authorizationHash !== original.authorizationHash || fresh.selectionHash !== original.selectionHash) throw new ProfitAnalysisJobStorageError("SOURCE_CHANGED");
  });
  const provider = vi.fn(async () => { expect(inTransaction).toBe(false); events.push("provider"); });
  const paid = { stage: "profit_analysis" as const, result, runId: receipt.runId, bindingHash: digest, contextHash: digest, snapshotHash: digest, auditWarnings: [] };
  const executeStage = vi.fn(async (_stage: ProfitAnalysisPreparedStage, options: Parameters<ProfitAnalysisRuntime["executeStage"]>[1]) => {
    expect(inTransaction).toBe(false); await options.beforeDispatch(receipt, verifyFresh);
    if (duplicateFence) await options.beforeDispatch(receipt, verifyFresh);
    options.signal?.throwIfAborted(); await provider(); return paid;
  });
  const deterministic = vi.fn((input: Parameters<ProfitAnalysisRuntime["deterministic"]>[0]) => finishProfitAnalysis(input.evidence, null));
  const runtime = { prepareStage, executeStage, deterministic } as unknown as ProfitAnalysisRuntime;
  const report = vi.fn();
  const process = createProfitAnalysisProcessor({ repository: { transaction: transact }, hooks: { authorize, capture, configuration: loadConfiguration }, runtime, enabled: () => enabled, report });
  return { run, session, lease, current, configuration, controller, events, authorize, capture, loadConfiguration, runById, claim, heartbeat, dispatch, resultReady, finish, fail, transaction,
    stage, receipt, paid, prepareStage, verifyFresh, provider, executeStage, deterministic, report,
    setEnabled: (value: boolean) => { enabled = value; }, loseEpoch: () => { epochLost = true; }, duplicateFence: () => { duplicateFence = true; },
    process: (signal = controller.signal) => process({ ...hint, workerId: lease.workerId, signal }) };
}
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); });
afterEach(() => { expect(external.db).not.toHaveBeenCalled(); expect(external.provider).not.toHaveBeenCalled(); vi.useRealTimers(); vi.unstubAllEnvs(); });

describe("durable private profit processor", () => {
  it("calls one provider only after fresh authorization and durable dispatch, then preserves a complete result", async () => {
    const t = fixture(); await t.process(); expect(t.run.state).toBe("succeeded"); expect(t.provider).toHaveBeenCalledTimes(1);
    expect(t.events.indexOf("verify-fresh")).toBeLessThan(t.events.indexOf("durable-dispatch"));
    expect(t.events.indexOf("durable-dispatch")).toBeLessThan(t.events.indexOf("provider"));
    expect(t.events.indexOf("durable-result")).toBeLessThan(t.events.indexOf("succeeded"));
    expect(t.dispatch).toHaveBeenCalledWith(t.lease, { strictDispatch: t.receipt, runtimeSnapshotHash: digest, contextHash: digest, bindingHash: digest });
    expect(t.run.result?.reasons).toHaveLength(1); expect(t.fail).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
  });
  it("deterministic unchanged evidence completes with no model/configuration/dispatch", async () => {
    const t = fixture("queued", true); await t.process(); expect(t.run.state).toBe("succeeded"); expect(t.deterministic).toHaveBeenCalledTimes(1);
    expect(t.run.result).toMatchObject({ modelCalled: false, severity: null, reasons: [], mode: "deterministic_no_comparable_change" });
    for (const fn of [t.provider, t.prepareStage, t.executeStage, t.loadConfiguration, t.dispatch]) expect(fn).not.toHaveBeenCalled();
  });
  it("off or already aborted has zero repository IO", async () => { const t = fixture(); t.setEnabled(false); await t.process(); t.setEnabled(true); t.controller.abort(); await t.process(); expect(t.transaction).not.toHaveBeenCalled(); });
  it("expired dispatched work becomes unknown, never a second paid attempt", async () => { const t = fixture("dispatched"); await t.process(); expect(t.run.state).toBe("unknown"); expect(t.provider).not.toHaveBeenCalled(); expect(t.prepareStage).not.toHaveBeenCalled(); expect(t.fail).not.toHaveBeenCalled(); });
  it.each(["succeeded", "failed", "canceled", "unknown"] as const)("terminal %s is not restarted", async state => { const t = fixture(state); await t.process(); expect(t.run.state).toBe(state); expect(t.prepareStage).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled(); });
  it("result_ready finishes locally without model or configuration reload", async () => { const t = fixture("result_ready"); await t.process(); expect(t.run.state).toBe("succeeded"); expect(t.finish).toHaveBeenCalledTimes(1); for (const fn of [t.provider, t.prepareStage, t.loadConfiguration, t.resultReady]) expect(fn).not.toHaveBeenCalled(); });
  it("fresh permission denial prevents claim and never leaks its error", async () => { const t = fixture(); t.authorize.mockRejectedValue(new Error("private policy SQL")); await t.process(); expect(t.claim).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled(); expect(t.report.mock.calls).toEqual([["processing_failed"]]); });
  it.each(["workspaceId", "userId", "id", "operationId"] as const)("rejects a foreign hint %s before claim", async field => {
    const t = fixture(); if (field === "operationId") t.run.operationId = "b7d29fe8-2c53-4c34-bfe7-cbe34c102127"; else t.run[field] += 1;
    await t.process(); expect(t.claim).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled();
  });
  it("missing run or lost claim acknowledgement cannot dispatch or fail an unowned lease", async () => {
    for (const missing of [true, false]) { const t = fixture(); if (missing) t.runById.mockResolvedValue(null); else t.claim.mockRejectedValue(new Error("claim commit ACK lost"));
      await t.process(); expect(t.provider).not.toHaveBeenCalled(); expect(t.fail).not.toHaveBeenCalled(); }
  });
  it.each(["sourceHash", "authorizationHash", "selectionHash"] as const)("changed %s before preparation prevents payment", async field => { const t = fixture(); t.current[field] = "d".repeat(64); await t.process(); expect(t.run.state).toBe("failed"); expect(t.run.errorCode).toBe("SOURCE_CHANGED"); expect(t.prepareStage).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled(); });
  it("configuration missing before preparation fails without provider", async () => { const t = fixture(); t.loadConfiguration.mockResolvedValue(null); await t.process(); expect(t.run.errorCode).toBe("CONFIGURATION_UNAVAILABLE"); expect(t.provider).not.toHaveBeenCalled(); });
  it.each(["source", "configuration"])("changed %s at dispatch fence cannot consume provider", async kind => {
    const t = fixture(), original = t.prepareStage.getMockImplementation()!;
    t.prepareStage.mockImplementation(async () => { const stage = await original(); if (kind === "source") t.current.sourceHash = "d".repeat(64); else t.configuration.revision++; return stage; });
    await t.process(); expect(t.run.state).toBe("failed"); expect(t.dispatch).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled();
  });
  it("epoch loss at dispatch never pays and cannot overwrite another lease", async () => { const t = fixture(); t.verifyFresh.mockImplementation(async () => { t.loseEpoch(); }); await t.process(); expect(t.provider).not.toHaveBeenCalled(); expect(t.run.state).toBe("queued"); expect(t.report).toHaveBeenCalledWith("outcome_unknown"); });
  it("duplicate provider fence does not make a second request", async () => { const t = fixture(); t.duplicateFence(); await t.process(); expect(t.dispatch).toHaveBeenCalledTimes(1); expect(t.provider).not.toHaveBeenCalled(); expect(t.run.state).toBe("unknown"); });
  it.each(["stage", "bindingHash"] as const)("invalid dispatch receipt %s never reaches provider", async field => { const t = fixture(); Object.assign(t.receipt, { [field]: "invalid" }); await t.process(); expect(t.provider).not.toHaveBeenCalled(); expect(t.run.errorCode).toBe("DISPATCH_RECEIPT_INVALID"); });
  it("lost dispatch ACK leaves unknown, with zero provider calls", async () => { const t = fixture(), original = t.dispatch.getMockImplementation()!; t.dispatch.mockImplementation(async (lease, receipt) => { await original(lease, receipt); throw new Error("ACK lost"); }); await t.process(); expect(t.run.state).toBe("unknown"); expect(t.provider).not.toHaveBeenCalled(); });
  it("provider timeout cannot be retried or reported as a certain pre-call failure", async () => { const t = fixture(); t.provider.mockRejectedValue(new Error("private provider body")); await t.process(); expect(t.run.state).toBe("unknown"); expect(t.run.errorCode).toBe("PROCESSING_FAILED"); await t.process(); expect(t.provider).toHaveBeenCalledTimes(1); });
  it.each(["runId", "stage", "bindingHash", "contextHash", "snapshotHash"] as const)("wrong paid receipt %s is not published", async field => { const t = fixture(); Object.assign(t.paid, { [field]: "invalid" }); await t.process(); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.resultReady).not.toHaveBeenCalled(); expect(t.run.state).toBe("unknown"); });
  it("invalid model numbers cannot replace system evidence", async () => { const t = fixture(); t.paid.result.after = 999; await t.process(); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.resultReady).not.toHaveBeenCalled(); expect(t.finish).not.toHaveBeenCalled(); expect(t.report).toHaveBeenCalledWith("outcome_unknown"); });
  it("changed frozen snapshot prevents stale result publication", async () => { const t = fixture(); t.provider.mockImplementation(async () => { t.run.snapshotHash = "d".repeat(64); }); await t.process(); expect(t.resultReady).not.toHaveBeenCalled(); expect(t.finish).not.toHaveBeenCalled(); expect(t.report).toHaveBeenCalledWith("outcome_unknown"); });
  it("cancellation while provider is slow fences its late response", async () => { const t = fixture(); t.provider.mockImplementation(async () => { t.run.state = "canceled"; }); await t.process(); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.resultReady).not.toHaveBeenCalled(); expect(t.finish).not.toHaveBeenCalled(); expect(t.run.state).toBe("canceled"); });
  it("lease epoch change while provider is slow cannot overwrite another claimant", async () => { const t = fixture(); t.provider.mockImplementation(async () => { t.loseEpoch(); }); await t.process(); expect(t.finish).not.toHaveBeenCalled(); expect(t.run.state).toBe("dispatched"); expect(t.report).toHaveBeenCalledWith("outcome_unknown"); });
  it("current configuration changes after paid dispatch do not discard frozen valid result", async () => { const t = fixture(); t.provider.mockImplementation(async () => { t.loadConfiguration.mockRejectedValue(new Error("changed after payment")); }); await t.process(); expect(t.run.state).toBe("succeeded"); expect(t.provider).toHaveBeenCalledTimes(1); });
  it("permission revoked during provider prevents publishing private result", async () => { const t = fixture(); t.provider.mockImplementation(async () => { t.authorize.mockRejectedValue(new Error("revoked")); }); await t.process(); expect(t.resultReady).not.toHaveBeenCalled(); expect(t.finish).not.toHaveBeenCalled(); expect(t.report).toHaveBeenCalledWith("outcome_unknown"); });
  it("lost paid-result commit ACK preserves result_ready and recovers without a second provider", async () => {
    const t = fixture(), original = t.resultReady.getMockImplementation()!;
    t.resultReady.mockImplementation(async (lease, result) => { await original(lease, result); throw new Error("ACK lost after durable result"); });
    await t.process(); expect(t.run.state).toBe("result_ready"); expect(t.fail).not.toHaveBeenCalled(); expect(t.report).toHaveBeenCalledWith("outcome_unknown");
    await t.process(); expect(t.run.state).toBe("succeeded"); expect(t.provider).toHaveBeenCalledTimes(1);
  });
  it("failed result write before commit leaves dispatched for unknown recovery, never repays", async () => { const t = fixture(); t.resultReady.mockRejectedValue(new Error("commit outcome unknown")); await t.process(); expect(t.run.state).toBe("dispatched"); expect(t.fail).not.toHaveBeenCalled(); await t.process(); expect(t.run.state).toBe("unknown"); expect(t.provider).toHaveBeenCalledTimes(1); });
  it("lost deterministic result ACK preserves local ready state with zero provider", async () => { const t = fixture("queued", true), original = t.resultReady.getMockImplementation()!; t.resultReady.mockImplementation(async (lease, result) => { await original(lease, result); throw new Error("ACK lost"); }); await t.process(); expect(t.run.state).toBe("result_ready"); await t.process(); expect(t.run.state).toBe("succeeded"); expect(t.provider).not.toHaveBeenCalled(); });
  it("lost finish ACK never converts succeeded to failed", async () => { const t = fixture("result_ready"), original = t.finish.getMockImplementation()!; t.finish.mockImplementation(async () => { await original(); throw new Error("ACK lost"); }); await t.process(); expect(t.run.state).toBe("succeeded"); expect(t.fail).not.toHaveBeenCalled(); expect(t.report).toHaveBeenCalledWith("outcome_unknown"); });
  it("local finish failure preserves already-paid result for another local recovery", async () => { const t = fixture("result_ready"); t.finish.mockRejectedValue(new Error("temporary local DB failure")); await t.process(); expect(t.run.state).toBe("result_ready"); expect(t.fail).not.toHaveBeenCalled(); expect(t.provider).not.toHaveBeenCalled(); });
  it.each(["abort", "gate"])("%s after a valid paid result still persists it under fresh authority, without another dispatch", async kind => {
    const t = fixture(); t.provider.mockImplementation(async () => { t.events.push("paid-response-ready"); if (kind === "abort") t.controller.abort(); else t.setEnabled(false); });
    await t.process(); expect(t.run.state).toBe("result_ready"); expect(t.run.result).toEqual(t.paid.result);
    expect(t.events.slice(t.events.indexOf("paid-response-ready") + 1)).toEqual(expect.arrayContaining(["authorize", "capture", "durable-result"]));
    expect(t.provider).toHaveBeenCalledTimes(1); expect(t.dispatch).toHaveBeenCalledTimes(1); expect(t.resultReady).toHaveBeenCalledTimes(1);
    expect(t.finish).not.toHaveBeenCalled(); expect(t.fail).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
    t.setEnabled(true); await t.process(new AbortController().signal);
    expect(t.run.state).toBe("succeeded"); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.dispatch).toHaveBeenCalledTimes(1); expect(t.prepareStage).toHaveBeenCalledTimes(1);
  });
  it.each(["abort", "gate"])("%s cleanup cannot persist a paid result after the user canceled", async kind => {
    const t = fixture(); t.provider.mockImplementation(async () => { t.run.state = "canceled"; if (kind === "abort") t.controller.abort(); else t.setEnabled(false); });
    await t.process(); expect(t.run.state).toBe("canceled"); expect(t.run.result).toBeNull(); expect(t.resultReady).not.toHaveBeenCalled();
    expect(t.finish).not.toHaveBeenCalled(); expect(t.fail).not.toHaveBeenCalled(); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.dispatch).toHaveBeenCalledTimes(1);
  });
  it.each(["abort", "gate"])("%s cleanup still rejects revoked permission before storing a paid result", async kind => {
    const t = fixture(); t.provider.mockImplementation(async () => { t.authorize.mockRejectedValue(new Error("fresh permission revoked")); if (kind === "abort") t.controller.abort(); else t.setEnabled(false); });
    await t.process(); expect(t.run.result).toBeNull(); expect(t.resultReady).not.toHaveBeenCalled(); expect(t.finish).not.toHaveBeenCalled();
    expect(t.fail).not.toHaveBeenCalled(); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.report).toHaveBeenCalledWith("outcome_unknown");
  });
  it("shutdown immediately after durable result keeps local recovery possible", async () => { const t = fixture(), original = t.resultReady.getMockImplementation()!; t.resultReady.mockImplementation(async (lease, result) => { const saved = await original(lease, result); t.controller.abort(); return saved; }); await t.process(); expect(t.run.state).toBe("result_ready"); expect(t.fail).not.toHaveBeenCalled(); });
  it("true heartbeat lease loss prevents a late paid result from overwriting a new epoch", async () => { const t = fixture(); t.provider.mockImplementation(async () => { t.loseEpoch(); await vi.advanceTimersByTimeAsync(30_000); }); await t.process(); expect(t.run.state).toBe("dispatched"); expect(t.run.result).toBeNull(); expect(t.finish).not.toHaveBeenCalled(); expect(t.fail).not.toHaveBeenCalled(); expect(t.provider).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0); });
  it("a transient heartbeat error does not discard an already returned result if fresh authority and lease still hold", async () => { const t = fixture(); t.provider.mockImplementation(async () => { t.heartbeat.mockRejectedValue(new Error("temporary heartbeat transport failure")); await vi.advanceTimersByTimeAsync(30_000); }); await t.process(); expect(t.run.state).toBe("result_ready"); expect(t.resultReady).toHaveBeenCalledTimes(1); expect(t.fail).not.toHaveBeenCalled(); expect(t.provider).toHaveBeenCalledTimes(1); expect(t.finish).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); });
  it("heartbeat performs a fresh scope read before extending its lease", async () => { const t = fixture(); t.provider.mockImplementation(async () => { const previous = t.capture.mock.calls.length; await vi.advanceTimersByTimeAsync(30_000); expect(t.capture.mock.calls.length).toBeGreaterThan(previous); }); await t.process(); expect(t.run.state).toBe("succeeded"); expect(t.heartbeat).toHaveBeenCalledTimes(2); });
});

describe("bounded private profit queue worker", () => {
  it.each(["worker", "web", "scheduler", "all"] as const)("defaults off for %s", role => expect(shouldProcessProfitAnalysis(role, {})).toBe(false));
  it("requires the worker role and two exact flags", async () => {
    const env = { ENABLE_PROFIT_ANALYSIS_WRITES: "true", ENABLE_PROFIT_ANALYSIS_WORKER: "true" };
    expect(shouldProcessProfitAnalysis("worker", env)).toBe(true); for (const role of ["web", "scheduler", "all"] as const) expect(shouldProcessProfitAnalysis(role, env)).toBe(false);
    expect(shouldProcessProfitAnalysis("worker", { ...env, ENABLE_PROFIT_ANALYSIS_WRITES: "TRUE" })).toBe(false);
    vi.stubEnv("ENABLE_PROFIT_ANALYSIS_WORKER", "false"); await startProfitAnalysisWorker("worker")(); expect(vi.getTimerCount()).toBe(0);
  });
  it("coalesces overlapping ticks and advances past failures before wrapping its cursor", async () => {
    const discover = vi.fn().mockResolvedValueOnce([hint, { ...hint, id: 14 }]).mockResolvedValue([]), report = vi.fn();
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    const processRun = vi.fn().mockReturnValueOnce(blocked).mockRejectedValueOnce(new Error("private processing failure"));
    const worker = createProfitAnalysisWorker({ discover, processRun, enabled: () => true, report, workerId: "synthetic-worker" });
    const first = worker.tick(); expect(worker.tick()).toBe(first); await Promise.resolve(); release(); await first;
    expect(processRun).toHaveBeenCalledTimes(2); expect(report.mock.calls).toEqual([["processing_failed"]]);
    await worker.tick(); await worker.tick(); expect(discover.mock.calls.map(call => call[0])).toEqual([{ afterId: 0, limit: 10 }, { afterId: 14, limit: 10 }, { afterId: 0, limit: 10 }]);
    expect(processRun.mock.calls[0][0]).toMatchObject({ ...hint, workerId: "synthetic-worker" });
  });
  it("gate off has zero discoveries and reports only sanitized discovery state", async () => { let enabled = false; const discover = vi.fn().mockRejectedValue(new Error("private SQL credential")), processRun = vi.fn(), report = vi.fn(); const worker = createProfitAnalysisWorker({ discover, processRun, report, enabled: () => enabled }); await worker.tick(); expect(discover).not.toHaveBeenCalled(); enabled = true; await worker.tick(); expect(report.mock.calls).toEqual([["discovery_failed"]]); expect(processRun).not.toHaveBeenCalled(); });
  it("gate change after discovery prevents all processing", async () => { let enabled = true; const discover = vi.fn(async () => { enabled = false; return [hint]; }), processRun = vi.fn(); const worker = createProfitAnalysisWorker({ discover, processRun, enabled: () => enabled }); await worker.tick(); expect(processRun).not.toHaveBeenCalled(); });
  it("stop aborts active work, waits for it, and never discovers again", async () => {
    let release!: () => void; const blocked = new Promise<void>(resolve => { release = resolve; });
    const discover = vi.fn().mockResolvedValue([hint, { ...hint, id: 14 }]), processRun = vi.fn().mockReturnValue(blocked);
    const worker = createProfitAnalysisWorker({ discover, processRun, enabled: () => true }); const ticking = worker.tick(); await Promise.resolve();
    const stopping = worker.stop(); expect(processRun.mock.calls[0][0].signal.aborted).toBe(true); release(); await stopping; await ticking; await worker.tick();
    expect(discover).toHaveBeenCalledTimes(1); expect(processRun).toHaveBeenCalledTimes(1);
  });
  it("stop while discovery is pending discards its eventual hints", async () => { let resolve!: (value: typeof hint[]) => void; const discovered = new Promise<typeof hint[]>(done => { resolve = done; }); const discover = vi.fn(() => discovered), processRun = vi.fn(); const worker = createProfitAnalysisWorker({ discover, processRun, enabled: () => true }); const ticking = worker.tick(), stopping = worker.stop(); resolve([hint]); await ticking; await stopping; expect(processRun).not.toHaveBeenCalled(); });
});
