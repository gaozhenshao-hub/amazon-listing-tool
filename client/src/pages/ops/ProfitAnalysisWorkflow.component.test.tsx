// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { createHash, webcrypto } from "node:crypto";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfitAnalysisWorkflow from "./ProfitAnalysisWorkflow";
import { publishMonthlyFinancialChange } from "./monthlyFinancialWriteEvents";
import { profitAnalysisPendingKey, readProfitAnalysisPending, type ProfitAnalysisPending } from "./profitAnalysisPending";
import { buildProfitAnalysisEvidence, finishProfitAnalysis, priorProfitAnalysisMonth, type ProfitAnalysisPreviewInput, type ProfitAnalysisSource } from "@shared/profitAnalysis";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "@shared/monthlyFinancialRead";
import type { ProfitAnalysisPublicRun, ProfitAnalysisWorkflowViewResult } from "@shared/profitAnalysisWorkflowRead";
import type { ProfitAnalysisSaveInput } from "@shared/profitAnalysisWorkflow";

const controls = vi.hoisted(() => ({ auth: { loading: false, error: null as Error | null, user: { id: 3, defaultWorkspaceId: 7, role: "ops_manager" } as { id: number; defaultWorkspaceId: number | null; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn() }, options: vi.fn(), start: vi.fn(), check: vi.fn(), cancel: vi.fn(), history: vi.fn(), save: vi.fn(), checkSave: vi.fn(), cancelSave: vi.fn(), preview: vi.fn(), report: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { profitAnalysis: {
  options: { query: controls.options }, start: { mutate: controls.start }, check: { query: controls.check }, cancel: { mutate: controls.cancel }, history: { query: controls.history },
  save: { mutate: controls.save }, checkSave: { query: controls.checkSave }, cancelSave: { mutate: controls.cancelSave }, preview: { query: controls.preview },
} } }) } }));
vi.mock("./ProfitAnalysisReportView", () => ({ default: (props: { run: ProfitAnalysisPublicRun; label?: string }) => { controls.report(props); return <pre data-testid="complete-result">{JSON.stringify(props.run)}</pre>; } }));
const identity = { userId: 3, workspaceId: 7 }, scope = { storeName: "SYNTHETIC_STORE", country: "US", parentAsin: "SYNTHETIC_PARENT", currency: "USD", basis: "child_rows" as const };
const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"], props = { identity, scope, months };
const operationId = "b7d29fe8-2c53-4c34-bfe7-cbe34c102125", oldId = "c7d29fe8-2c53-4c34-bfe7-cbe34c102125", anotherId = "d7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const hash = "a".repeat(64), resultHash = "d".repeat(64), time = "2026-10-18 12:00:00.000000";
const input = (month = "2026-09"): ProfitAnalysisPreviewInput => ({ expectedWorkspaceId: 7, scope, month });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const canonical = (value: unknown): string => Array.isArray(value) ? `[${value.map(canonical).join(",")}]` : value && typeof value === "object" ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(",")}}` : JSON.stringify(value);
function result(request = input()) {
  const previousMonth = priorProfitAnalysisMonth(request.month);
  const source: ProfitAnalysisSource = { version: 1, identity, scope: request.scope, month: request.month, previousMonth, sourceHash: hash, selectionHash: "b".repeat(64), authorizationHash: "c".repeat(64),
    periods: [previousMonth, request.month].map((month, index) => {
      const payload = [{ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), financialProfit: 20 + index * 10, salesAmount: 100, salesQty: 10, yearMonth: month,
        parentAsin: request.scope.parentAsin, asin: "SYNTHETIC_CHILD", sku: "SYNTHETIC_SKU", title: "SYNTHETIC_PRIVATE_TITLE", storeName: request.scope.storeName, site: request.scope.country, operator: null, raw: { currency: "USD" } }];
      const record: MonthlyFinancialBatchRecord = { id: index + 100, ...identity, fileName: "synthetic.xlsx", fileHash: hash, status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: 0,
        months: [month], createdAt: time, confirmedAt: time, fileReferenceKind: "storage", sourceRunId: null, payload };
      return { month, rows: parseMonthlyFinancialBatch(record).rows, selection: { complete: true as const, rule: "latest_completed_batch_per_month_store_site" as const, selectedBatchId: record.id, recordHash: hash, scopeRowCount: 1, authorizedRowCount: 1 } };
    }) };
  const evidence = buildProfitAnalysisEvidence(source);
  return finishProfitAnalysis(evidence, { severity: "需关注", reasons: [{ evidenceId: evidence.evidence[0].id, explanation: "SYNTHETIC 完整理由 <script>不执行</script>" }] });
}
function run(state: ProfitAnalysisPublicRun["state"] = "succeeded", id = operationId, request = input()): ProfitAnalysisPublicRun {
  return { operationId: id, state, errorCode: state === "failed" ? "SOURCE_CHANGED" : state === "unknown" ? "MODEL_RESULT_UNKNOWN" : state === "canceled" ? "USER_CANCELED" : null,
    sourceHash: hash, resultHash: ["succeeded", "result_ready"].includes(state) ? resultHash : null, result: state === "succeeded" ? result(request) : null, stale: false,
    createdAt: time, updatedAt: time, completedAt: ["succeeded", "failed", "unknown", "canceled"].includes(state) ? time : null };
}
function view(state: ProfitAnalysisPublicRun["state"] | null = null, request = input(), id = operationId, withSaved = false): ProfitAnalysisWorkflowViewResult {
  const current = state === null ? null : run(state, id, request), saved = withSaved ? run("succeeded", oldId, request) : null;
  return { version: 1, identity, request: clone(request), sourceStatus: "ready", currentSourceHash: hash,
    generation: { available: true, reasonCode: null, modelRequired: true, configuration: { revision: 1, hash } },
    report: current ? { version: 3, activeOperationId: ["queued", "dispatched", "result_ready"].includes(state!) ? id : null, latestOperationId: id, savedOperationId: saved?.operationId ?? null, updatedAt: time, savedAt: saved ? time : null } : null,
    run: current, draft: state === "succeeded" ? current : null, saved };
}
function generatePending(id = operationId, request = input()): ProfitAnalysisPending { return { version: 1, identity, kind: "generate", request: { ...request, operationId: id, expectedReportVersion: 0, expectedSourceHash: hash, regenerateConfirmed: false } }; }
function savedReceipt(request: ProfitAnalysisSaveInput, status: "committed" | "canceled" | "absent" = "committed") {
  return { version: 1, identity, request: { expectedWorkspaceId: request.expectedWorkspaceId, scope: request.scope, month: request.month, saveOperationId: request.saveOperationId }, status,
    receipt: status !== "committed" ? null : { saveId: request.saveOperationId, operationId: request.runOperationId,
      requestHash: createHash("sha256").update(canonical({ identity, target: { scope: request.scope, month: request.month }, saveOperationId: request.saveOperationId, request })).digest("hex"),
      resultHash: request.expectedResultHash, sourceHash: request.expectedSourceHash, reportVersion: request.expectedReportVersion + 1, savedAt: time } };
}
function store(value: ProfitAnalysisPending, dispatch = false) { const key = profitAnalysisPendingKey(identity, { expectedWorkspaceId: value.request.expectedWorkspaceId, scope: value.request.scope, month: value.request.month }); localStorage.setItem(key, canonical(value)); if (dispatch) window.dispatchEvent(new StorageEvent("storage", { key, storageArea: localStorage })); }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
async function read() { fireEvent.click(screen.getByRole("button", { name: "读取本月分析状态" })); await waitFor(() => expect(screen.getByRole("button", { name: "读取本月分析状态" })).toBeEnabled()); }
async function generate() { fireEvent.click(screen.getByRole("button", { name: "生成本月分析草稿" })); await waitFor(() => expect(controls.start).toHaveBeenCalledTimes(1)); await waitFor(() => expect(screen.getByRole("button", { name: "读取本月分析状态" })).toBeEnabled()); }
async function manualSave() { fireEvent.click(screen.getByLabelText("我已阅读完整草稿，确认人工保存为本月报告")); fireEvent.click(screen.getByRole("button", { name: "人工保存本月报告" })); await waitFor(() => expect(screen.getByRole("button", { name: "读取本月分析状态" })).toBeEnabled()); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); controls.auth = { loading: false, error: null, user: { id: 3, defaultWorkspaceId: 7, role: "ops_manager" } }; controls.permissions.isLoading = false; controls.permissions.canRead.mockReturnValue(true);
  let id = 0; vi.stubGlobal("crypto", { subtle: webcrypto.subtle, randomUUID: vi.fn(() => id++ === 0 ? operationId : anotherId) });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_name, options, work) => { if (options.signal.aborted) throw new Error("ABORTED"); return work(); }) } });
  controls.options.mockImplementation(async request => view(null, request)); controls.start.mockImplementation(async request => view("queued", { expectedWorkspaceId: request.expectedWorkspaceId, scope: request.scope, month: request.month }, request.operationId));
  controls.check.mockImplementation(async request => view("succeeded", { expectedWorkspaceId: request.expectedWorkspaceId, scope: request.scope, month: request.month }, request.operationId));
  controls.cancel.mockImplementation(async request => ({ version: 1, identity, request, operationId: request.operationId, state: "canceled", errorCode: "USER_CANCELED" }));
  controls.history.mockImplementation(async request => ({ version: 1, identity, request: { expectedWorkspaceId: request.expectedWorkspaceId, scope: request.scope, month: request.month }, items: [], nextBeforeId: null }));
  controls.save.mockImplementation(async request => savedReceipt(request)); controls.checkSave.mockReset(); controls.cancelSave.mockReset(); controls.preview.mockRejectedValue(new Error("SYNTHETIC_ONLY"));
});
afterEach(() => { cleanup(); vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("private complete profit workflow", () => {
  it("has six quick months, older-month input and explicit evidence/status reads with no auto paid request", () => {
    render(<ProfitAnalysisWorkflow {...props} />); expect(within(screen.getByRole("navigation", { name: "利润分析月份快捷选择" })).getAllByRole("button")).toHaveLength(6);
    for (const fn of [controls.options, controls.preview, controls.start, controls.save, controls.history, controls.check]) expect(fn).not.toHaveBeenCalled();
    expect(screen.getByText("查看双月分析依据")).toBeInTheDocument(); expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_dashboard"); expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_profit");
  });
  it("reads an earlier month outside the six cards without uploading data", async () => { render(<ProfitAnalysisWorkflow {...props} />); fireEvent.change(screen.getByLabelText("利润报告月份"), { target: { value: "2024-01" } }); await read(); expect(controls.options).toHaveBeenCalledWith(input("2024-01"), { signal: expect.any(AbortSignal) }); expect(controls.start).not.toHaveBeenCalled(); });
  it.each(["authLoading", "permissionLoading", "authError", "logout", "actor", "workspace", "dashboard", "profit"])("denies private UI without requests for %s", kind => {
    if (kind === "authLoading") controls.auth.loading = true; if (kind === "permissionLoading") controls.permissions.isLoading = true; if (kind === "authError") controls.auth.error = new Error("PRIVATE_AUTH"); if (kind === "logout") controls.auth.user = null;
    if (kind === "actor") controls.auth.user!.id++; if (kind === "workspace") controls.auth.user!.defaultWorkspaceId = 9;
    if (["dashboard", "profit"].includes(kind)) controls.permissions.canRead.mockImplementation((_module, section) => section !== `ops_${kind}`);
    render(<ProfitAnalysisWorkflow {...props} />); expect(screen.queryByRole("button", { name: "读取本月分析状态" })).not.toBeInTheDocument(); expect(controls.options).not.toHaveBeenCalled();
  });
  it("default-off capability is explained and does not remove original-operation recovery", async () => {
    store(generatePending()); controls.options.mockImplementation(async request => ({ ...view(null, request), generation: { available: false, reasonCode: "EXECUTION_DISABLED", modelRequired: true, configuration: null } }));
    render(<ProfitAnalysisWorkflow {...props} />); await read(); expect(screen.getByText(/利润生成开关或专属 worker 尚未启用/)).toBeInTheDocument(); expect(screen.getByRole("button", { name: "生成本月分析草稿" })).toBeDisabled(); expect(screen.getByRole("button", { name: "检查原操作" })).toBeEnabled();
  });
  it("stores exact metadata before start and does not include financial bodies or keys", async () => {
    controls.start.mockImplementation(async request => { expect(readProfitAnalysisPending(identity, input())).toMatchObject({ kind: "generate", request }); return view("queued", input(), request.operationId); });
    render(<ProfitAnalysisWorkflow {...props} />); await read(); await generate();
    expect(controls.start.mock.calls[0][0]).toEqual({ ...input(), operationId, expectedReportVersion: 0, expectedSourceHash: hash, regenerateConfirmed: false });
    const stored = localStorage.getItem(profitAnalysisPendingKey(identity, input()))!; for (const forbidden of ["financialProfit", "SYNTHETIC_PRIVATE_TITLE", "reasons", "prompt", "apiKey"]) expect(stored).not.toContain(forbidden);
  });
  it("double-click never submits two UUIDs", async () => { const response = deferred<ReturnType<typeof view>>(); controls.start.mockReturnValue(response.promise); render(<ProfitAnalysisWorkflow {...props} />); await read(); const button = screen.getByRole("button", { name: "生成本月分析草稿" }); fireEvent.click(button); fireEvent.click(button); await waitFor(() => expect(controls.start).toHaveBeenCalledTimes(1)); await act(async () => response.resolve(view("queued"))); expect(controls.start).toHaveBeenCalledTimes(1); });
  it("polls only original UUID after accepted submission and releases only verified terminal", async () => {
    render(<ProfitAnalysisWorkflow {...props} />); await read(); await generate(); vi.useFakeTimers();
    // Restart the already scheduled native timer by making an explicit check.
    controls.check.mockImplementationOnce(async () => view("queued")); fireEvent.click(screen.getByRole("button", { name: "检查原操作" })); await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(controls.start).toHaveBeenCalledTimes(1); expect(controls.check).toHaveBeenCalledWith({ ...input(), operationId }, { signal: expect.any(AbortSignal) });
    expect(readProfitAnalysisPending(identity, input())).toBeNull(); expect(screen.getByRole("region", { name: "生成草稿" })).toBeInTheDocument();
  });
  it.each(["timeout", "null", "unknown"])("%s preserves original UUID and forbids resubmission", async kind => {
    if (kind === "timeout") controls.start.mockRejectedValue(new Error("PRIVATE_PROVIDER_SECRET")); else controls.start.mockResolvedValue(view(kind === "null" ? null : "unknown"));
    render(<ProfitAnalysisWorkflow {...props} />); await read(); await generate(); expect(readProfitAnalysisPending(identity, input())).not.toBeNull();
    expect(screen.queryByText("PRIVATE_PROVIDER_SECRET")).not.toBeInTheDocument(); expect(screen.getByRole("button", { name: "检查原操作" })).toBeEnabled();
    if (screen.queryByRole("button", { name: "生成本月分析草稿" })) expect(screen.getByRole("button", { name: "生成本月分析草稿" })).toBeDisabled(); expect(controls.start).toHaveBeenCalledTimes(1);
  });
  it("unknown must be explicitly canceled, even with writes disabled", async () => {
    store(generatePending()); controls.check.mockResolvedValue(view("unknown")); render(<ProfitAnalysisWorkflow {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "检查原操作" })); await screen.findByText(/原执行结果未知/);
    expect(screen.getByRole("button", { name: "明确取消原操作" })).toBeDisabled(); fireEvent.click(screen.getByLabelText(/我确认取消此原操作/)); fireEvent.click(screen.getByRole("button", { name: "明确取消原操作" }));
    await waitFor(() => expect(readProfitAnalysisPending(identity, input())).toBeNull()); expect(controls.cancel.mock.calls[0][0]).toEqual({ ...input(), operationId }); expect(controls.start).not.toHaveBeenCalled();
  });
  it("a cancel response that is still unknown retains metadata", async () => { store(generatePending()); controls.cancel.mockImplementation(async request => ({ version: 1, identity, request, operationId, state: "unknown", errorCode: "MODEL_RESULT_UNKNOWN" })); render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByLabelText(/我确认取消此原操作/)); fireEvent.click(screen.getByRole("button", { name: "明确取消原操作" })); await screen.findByText(/取消尚未取得可核验终态/); expect(readProfitAnalysisPending(identity, input())).not.toBeNull(); });
  it("server-discovered unknown run can be canceled without fabricating local request metadata", async () => { controls.options.mockResolvedValue(view("unknown")); render(<ProfitAnalysisWorkflow {...props} />); await read(); expect(readProfitAnalysisPending(identity, input())).toBeNull(); fireEvent.click(screen.getByLabelText(/我确认取消此原操作/)); fireEvent.click(screen.getByRole("button", { name: "明确取消原操作" })); await screen.findByText(/原生成任务已明确取消/); expect(controls.cancel.mock.calls[0][0]).toEqual({ ...input(), operationId }); expect(controls.start).not.toHaveBeenCalled(); });
  it("server-discovered UUID remains recoverable after a lost cancel ACK without inventing request metadata", async () => { controls.options.mockResolvedValue(view("unknown")); controls.cancel.mockRejectedValue(new Error("LOST_ACK")); render(<ProfitAnalysisWorkflow {...props} />); await read(); fireEvent.click(screen.getByLabelText(/我确认取消此原操作/)); fireEvent.click(screen.getByRole("button", { name: "明确取消原操作" })); await screen.findByText(/操作返回未能安全核验/); expect(screen.getByRole("button", { name: "检查原操作" })).toBeEnabled(); expect(readProfitAnalysisPending(identity, input())).toBeNull(); controls.check.mockResolvedValue(view("canceled")); fireEvent.click(screen.getByRole("button", { name: "检查原操作" })); await waitFor(() => expect(screen.queryByRole("button", { name: "检查原操作" })).not.toBeInTheDocument()); expect(controls.check.mock.calls[0][0]).toEqual({ ...input(), operationId }); expect(controls.start).not.toHaveBeenCalled(); });
  it.each(["absent", "different-terminal"])("a %s status read cannot forget an unresolved server-discovered UUID or enable new writes", async kind => { controls.options.mockResolvedValueOnce(view("unknown")); render(<ProfitAnalysisWorkflow {...props} />); await read(); controls.options.mockResolvedValue(kind === "absent" ? view(null) : view("succeeded", input(), oldId)); await read(); if (kind !== "absent") fireEvent.click(screen.getByLabelText(/我确认重新生成/)); expect(screen.getByRole("button", { name: kind === "absent" ? "生成本月分析草稿" : "确认重新生成本月草稿" })).toBeDisabled(); expect(screen.getByRole("button", { name: "人工保存本月报告" })).toBeDisabled(); expect(screen.getByText(new RegExp(operationId))).toBeInTheDocument(); expect(screen.getByRole("button", { name: "检查原操作" })).toBeEnabled(); expect(controls.start).not.toHaveBeenCalled(); expect(controls.save).not.toHaveBeenCalled(); });
  it("a verified failed generation releases only its own metadata and preserves the old saved report", async () => { store(generatePending()); controls.check.mockResolvedValue(view("failed", input(), operationId, true)); render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByRole("button", { name: "检查原操作" })); await waitFor(() => expect(readProfitAnalysisPending(identity, input())).toBeNull()); expect(screen.getByRole("button", { name: "查看已保存报告完整结果" })).toBeEnabled(); expect(screen.queryByRole("button", { name: "查看生成草稿完整结果" })).not.toBeInTheDocument(); });
  it("shows separate full draft and old saved report while requiring an explicit regeneration acknowledgement", async () => {
    controls.options.mockResolvedValue(view("succeeded", input(), operationId, true)); render(<ProfitAnalysisWorkflow {...props} />); await read();
    expect(screen.getByRole("button", { name: "确认重新生成本月草稿" })).toBeDisabled(); fireEvent.click(screen.getByRole("button", { name: "查看已保存报告完整结果" }));
    expect(await screen.findByRole("dialog")).toBeInTheDocument(); expect(controls.report.mock.calls.at(-1)![0].run.operationId).toBe(oldId);
    fireEvent.click(screen.getByRole("button", { name: "Close" })); fireEvent.click(screen.getByLabelText(/我确认重新生成/)); fireEvent.click(screen.getByRole("button", { name: "确认重新生成本月草稿" })); await waitFor(() => expect(controls.start).toHaveBeenCalledTimes(1)); expect(controls.start.mock.calls[0][0].regenerateConfirmed).toBe(true);
  });
  it("generation unavailable does not pretend saving is forbidden; save uses fresh manual server authorization", async () => {
    const reply = view("succeeded"); reply.generation = { available: false, reasonCode: "EXECUTION_DISABLED", modelRequired: true, configuration: null }; controls.options.mockResolvedValue(reply);
    vi.mocked(crypto.randomUUID).mockReturnValue(anotherId); render(<ProfitAnalysisWorkflow {...props} />); await read(); expect(screen.getByRole("button", { name: "人工保存本月报告" })).toBeDisabled(); await manualSave();
    expect(controls.save).toHaveBeenCalledTimes(1); expect(controls.start).not.toHaveBeenCalled(); expect(readProfitAnalysisPending(identity, input())).toBeNull(); expect(screen.getByText(/人工保存已确认/)).toBeInTheDocument();
  });
  it("stale draft cannot be saved and old saved result stays inspectable", async () => { const reply = view("succeeded", input(), operationId, true); reply.currentSourceHash = "e".repeat(64); reply.run!.stale = true; reply.draft!.stale = true; reply.saved!.stale = true; controls.options.mockResolvedValue(reply); render(<ProfitAnalysisWorkflow {...props} />); await read(); expect(screen.getByRole("button", { name: "人工保存本月报告" })).toBeDisabled(); expect(screen.getByRole("button", { name: "查看已保存报告完整结果" })).toBeEnabled(); expect(controls.save).not.toHaveBeenCalled(); });
  it("lost save ACK preserves its independent UUID; absent lookup never repeats the save", async () => {
    controls.options.mockResolvedValue(view("succeeded")); vi.mocked(crypto.randomUUID).mockReturnValue(anotherId); controls.save.mockRejectedValue(new Error("LOST_ACK"));
    render(<ProfitAnalysisWorkflow {...props} />); await read(); await manualSave(); const pending = readProfitAnalysisPending(identity, input())!; expect(pending.kind).toBe("save");
    controls.checkSave.mockResolvedValue(savedReceipt(pending.request as ProfitAnalysisSaveInput, "absent")); fireEvent.click(screen.getByRole("button", { name: "检查原操作" })); await screen.findByText(/尚未找到原保存回执/);
    expect(readProfitAnalysisPending(identity, input())).toEqual(pending); expect(controls.save).toHaveBeenCalledTimes(1); expect(controls.checkSave.mock.calls[0][0]).toEqual({ ...input(), saveOperationId: anotherId });
  });
  it.each(["check", "cancel"])("%s recovers a committed save without sending the save again", async action => {
    controls.options.mockResolvedValue(view("succeeded")); vi.mocked(crypto.randomUUID).mockReturnValue(anotherId); controls.save.mockRejectedValue(new Error("LOST_ACK")); render(<ProfitAnalysisWorkflow {...props} />); await read(); await manualSave();
    const original = readProfitAnalysisPending(identity, input())!; expect(original.kind).toBe("save"); const reply = savedReceipt(original.request as ProfitAnalysisSaveInput);
    if (action === "check") { controls.checkSave.mockResolvedValue(reply); fireEvent.click(screen.getByRole("button", { name: "检查原操作" })); }
    else { controls.cancelSave.mockResolvedValue(reply); fireEvent.click(screen.getByLabelText(/我确认取消此原操作/)); fireEvent.click(screen.getByRole("button", { name: "明确取消原操作" })); }
    await screen.findByText(/人工保存已确认/); expect(readProfitAnalysisPending(identity, input())).toBeNull(); expect(controls.save).toHaveBeenCalledTimes(1); expect(controls.start).not.toHaveBeenCalled();
  });
  it("explicit save cancellation releases only after canceled acknowledgement and never cancels generation", async () => {
    controls.options.mockResolvedValue(view("succeeded")); vi.mocked(crypto.randomUUID).mockReturnValue(anotherId); controls.save.mockRejectedValue(new Error("LOST_ACK")); render(<ProfitAnalysisWorkflow {...props} />); await read(); await manualSave();
    const original = readProfitAnalysisPending(identity, input())!; controls.cancelSave.mockResolvedValue(savedReceipt(original.request as ProfitAnalysisSaveInput, "canceled"));
    fireEvent.click(screen.getByLabelText(/我确认取消此原操作/)); fireEvent.click(screen.getByRole("button", { name: "明确取消原操作" })); await screen.findByText(/原保存操作已明确取消/);
    expect(readProfitAnalysisPending(identity, input())).toBeNull(); expect(controls.cancelSave.mock.calls[0][0]).toEqual({ ...input(), saveOperationId: anotherId }); expect(controls.cancel).not.toHaveBeenCalled();
  });
  it.each(["requestHash", "sourceHash", "resultHash", "operationId", "reportVersion"])("a mismatched save receipt %s cannot release pending", async field => {
    controls.options.mockResolvedValue(view("succeeded")); vi.mocked(crypto.randomUUID).mockReturnValue(anotherId); controls.save.mockImplementation(async request => { const response = savedReceipt(request); Object.assign(response.receipt!, { [field]: field === "reportVersion" ? 99 : field === "operationId" ? oldId : "f".repeat(64) }); return response; });
    render(<ProfitAnalysisWorkflow {...props} />); await read(); await manualSave(); expect(readProfitAnalysisPending(identity, input())?.kind).toBe("save"); expect(screen.queryByText(/人工保存已确认/)).not.toBeInTheDocument();
  });
  it("save hash capability failure prevents network submission", async () => { controls.options.mockResolvedValue(view("succeeded")); vi.mocked(crypto.randomUUID).mockReturnValue(anotherId); vi.stubGlobal("crypto", { randomUUID: () => anotherId, subtle: { digest: async () => { throw new Error("HASH_UNAVAILABLE"); } } }); render(<ProfitAnalysisWorkflow {...props} />); await read(); await manualSave(); expect(controls.save).not.toHaveBeenCalled(); expect(readProfitAnalysisPending(identity, input())).toBeNull(); });
  it.each(["scope", "role", "permission"])("%s change clears private results and aborts late reads", async kind => { const waiting = deferred<ReturnType<typeof view>>(); controls.options.mockReturnValue(waiting.promise); const mounted = render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByRole("button", { name: "读取本月分析状态" })); const signal = controls.options.mock.calls[0][1].signal;
    if (kind === "role") controls.auth.user!.role = "admin"; if (kind === "permission") controls.permissions.canRead.mockReturnValue(false);
    mounted.rerender(<ProfitAnalysisWorkflow {...props} {...(kind === "scope" ? { scope: { ...scope, parentAsin: "OTHER" } } : {})} />); expect(signal.aborted).toBe(true); await act(async () => waiting.resolve(view("succeeded"))); expect(screen.queryByRole("button", { name: "查看生成草稿完整结果" })).not.toBeInTheDocument(); });
  it("month switch and explicit clear discard late financial responses, never pending UUIDs", async () => { store(generatePending()); const waiting = deferred<ReturnType<typeof view>>(); controls.options.mockReturnValue(waiting.promise); render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByRole("button", { name: "读取本月分析状态" })); fireEvent.click(screen.getByRole("button", { name: "2026-08" })); await act(async () => waiting.resolve(view("succeeded"))); expect(screen.queryByRole("button", { name: "查看生成草稿完整结果" })).not.toBeInTheDocument(); expect(readProfitAnalysisPending(identity, input())).not.toBeNull(); });
  it("monthly source event clears view, history and save eligibility but retains pending", async () => { store(generatePending()); controls.options.mockResolvedValue(view("succeeded")); render(<ProfitAnalysisWorkflow {...props} />); await read(); act(() => publishMonthlyFinancialChange({ userId: 8, workspaceId: 7, action: "confirm", batchId: 99 })); expect(screen.queryByRole("button", { name: "人工保存本月报告" })).not.toBeInTheDocument(); expect(readProfitAnalysisPending(identity, input())).not.toBeNull(); expect(screen.getByText(/月报来源已变化/)).toBeInTheDocument(); expect(controls.options).toHaveBeenCalledTimes(1); });
  it("explicit clear aborts a pending check and preserves its UUID after a late success", async () => { store(generatePending()); const waiting = deferred<ReturnType<typeof view>>(); controls.check.mockReturnValue(waiting.promise); render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByRole("button", { name: "检查原操作" })); const signal = controls.check.mock.calls[0][1].signal; fireEvent.click(screen.getByRole("button", { name: "清除分析展示" })); expect(signal.aborted).toBe(true); await act(async () => waiting.resolve(view("succeeded"))); expect(readProfitAnalysisPending(identity, input())).not.toBeNull(); expect(screen.queryByRole("button", { name: "查看生成草稿完整结果" })).not.toBeInTheDocument(); });
  it.each(["identity", "scope", "operation"])("rejects %s-mismatched check without releasing local metadata", async kind => { store(generatePending()); const reply = view("queued", input(), kind === "operation" ? oldId : operationId); if (kind === "identity") reply.identity = { ...identity, userId: 4 }; if (kind === "scope") reply.request.scope = { ...scope, parentAsin: "OTHER" }; controls.check.mockResolvedValue(reply); render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByRole("button", { name: "检查原操作" })); await screen.findByText(/操作返回未能安全核验/); expect(readProfitAnalysisPending(identity, input())).not.toBeNull(); });
  it("cross-tab operation change clears old cancel acknowledgement and cannot cancel the new UUID", async () => { store(generatePending()); render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByLabelText(/我确认取消此原操作/)); act(() => store(generatePending(oldId), true)); expect(screen.getByRole("button", { name: "明确取消原操作" })).toBeDisabled(); expect(screen.getByText(new RegExp(oldId))).toBeInTheDocument(); expect(controls.cancel).not.toHaveBeenCalled(); });
  it("action-time storage check rejects replacement even before the storage event", async () => { store(generatePending()); render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByLabelText(/我确认取消此原操作/)); store(generatePending(oldId)); fireEvent.click(screen.getByRole("button", { name: "明确取消原操作" })); await waitFor(() => expect(screen.getByRole("button", { name: "明确取消原操作" })).toBeDisabled()); expect(controls.cancel).not.toHaveBeenCalled(); expect(readProfitAnalysisPending(identity, input())).toEqual(generatePending(oldId)); });
  it("late terminal for A cannot remove another tab's pending B", async () => { store(generatePending()); const waiting = deferred<ReturnType<typeof view>>(); controls.check.mockReturnValue(waiting.promise); render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByRole("button", { name: "检查原操作" })); store(generatePending(oldId)); await act(async () => waiting.resolve(view("succeeded"))); expect(readProfitAnalysisPending(identity, input())).toEqual(generatePending(oldId)); expect(screen.queryByRole("button", { name: "查看生成草稿完整结果" })).not.toBeInTheDocument(); });
  it.each(["locks", "corrupt"])("%s failure never falls back to unsafe new writes", async kind => { if (kind === "locks") Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); else localStorage.setItem(profitAnalysisPendingKey(identity, input()), "bad-json"); render(<ProfitAnalysisWorkflow {...props} />); await read(); fireEvent.click(screen.getByRole("button", { name: "生成本月分析草稿" })); await waitFor(() => expect(screen.getByRole("button", { name: "读取本月分析状态" })).toBeEnabled()); expect(controls.start).not.toHaveBeenCalled(); if (kind === "corrupt") expect(localStorage.getItem(profitAnalysisPendingKey(identity, input()))).toBe("bad-json"); });
  it("paginates all monthly history and passes the full result to the dialog", async () => {
    controls.history.mockImplementation(async request => ({ version: 1, identity, request: input(), items: [run("succeeded", request.beforeId ? oldId : operationId)], nextBeforeId: request.beforeId ? null : 50 }));
    render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByRole("button", { name: "读取本月全部历史" })); await screen.findByText(/第 1 页/); fireEvent.click(screen.getByRole("button", { name: "历史下一页" })); await screen.findByText(/第 2 页/);
    expect(controls.history.mock.calls[1][0]).toEqual({ ...input(), limit: 10, beforeId: 50 }); fireEvent.click(screen.getByRole("button", { name: "查看历史完整结果" })); await screen.findByRole("dialog"); expect(controls.report.mock.calls.at(-1)![0].run).toEqual(run("succeeded", oldId)); expect(document.querySelector("script")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Close" })); fireEvent.click(screen.getByRole("button", { name: "历史上一页" })); expect(controls.history).toHaveBeenCalledTimes(2); expect(screen.getByText(/第 1 页/)).toBeInTheDocument();
  });
  it.each(["duplicate", "cursor"])("rejects %s history page mixing", async kind => { controls.history.mockImplementation(async request => ({ version: 1, identity, request: input(), items: [run("succeeded", request.beforeId && kind !== "duplicate" ? oldId : operationId)], nextBeforeId: request.beforeId ? kind === "cursor" ? 60 : null : 50 })); render(<ProfitAnalysisWorkflow {...props} />); fireEvent.click(screen.getByRole("button", { name: "读取本月全部历史" })); await screen.findByText(/第 1 页/); fireEvent.click(screen.getByRole("button", { name: "历史下一页" })); await screen.findByText(/操作返回未能安全核验/); expect(screen.queryByRole("region", { name: "本月生成历史" })).not.toBeInTheDocument(); });
});
