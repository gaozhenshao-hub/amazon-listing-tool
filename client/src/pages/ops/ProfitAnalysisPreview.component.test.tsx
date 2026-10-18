// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfitAnalysisPreview, { ProfitAnalysisEvidenceView } from "./ProfitAnalysisPreview";
import { publishMonthlyFinancialChange } from "./monthlyFinancialWriteEvents";
import { buildProfitAnalysisPreviewResult, buildProfitAnalysisPreviewUnavailable, priorProfitAnalysisMonth,
  type ProfitAnalysisPreviewInput, type ProfitAnalysisSource } from "@shared/profitAnalysis";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "@shared/monthlyFinancialRead";

const controls = vi.hoisted(() => ({ auth: { loading: false, error: null as Error | null,
  user: { id: 3, defaultWorkspaceId: 7, role: "ops_manager" } as { id: number; defaultWorkspaceId: number | null; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn() }, query: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { profitAnalysis: { preview: { query: controls.query } } } }) } }));
const identity = { userId: 3, workspaceId: 7 }, scope = { storeName: "Synthetic Store", country: "US", parentAsin: "B0TEST0001", currency: "USD", basis: "child_rows" as const };
const months = ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"];
const props = { identity, scope, months }, request = (month = "2026-09"): ProfitAnalysisPreviewInput => ({ expectedWorkspaceId: 7, scope, month });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function result(input = request(), options: { currency?: string | null; missingPrior?: boolean; noChanges?: boolean; missingMetric?: boolean } = {}) {
  const sourceScope = { ...input.scope, ...(options.currency === undefined ? {} : { currency: options.currency }) }, previousMonth = priorProfitAnalysisMonth(input.month);
  const source: ProfitAnalysisSource = { version: 1, identity, scope: sourceScope, month: input.month, previousMonth,
    sourceHash: "a".repeat(64), selectionHash: "b".repeat(64), authorizationHash: "c".repeat(64),
    periods: [previousMonth, input.month].map((month, index) => {
      const batchId = 100 + index;
      const row = { ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map((key, keyIndex) => [key, (keyIndex + 1) * (options.noChanges ? 1 : index + 1)])),
        ...(options.missingMetric ? { advertising: null } : {}), yearMonth: month, parentAsin: sourceScope.parentAsin, asin: "B0CHILD001", sku: "SYNTHETIC-SKU", title: "SYNTHETIC_PRIVATE_TITLE", storeName: sourceScope.storeName, site: sourceScope.country, operator: "fixture-not-authorization",
        raw: sourceScope.currency === null ? {} : { currency: sourceScope.currency } };
      const record: MonthlyFinancialBatchRecord = { id: batchId, workspaceId: 7, userId: 3, fileName: "synthetic.xlsx", fileHash: "d".repeat(64),
        status: "completed", totalRows: 1, skippedRows: 0, unallocatedRows: 0, months: [month], createdAt: "2026-10-01 01:00:00.000000", confirmedAt: "2026-10-01 02:00:00.000000", fileReferenceKind: "storage", sourceRunId: null, payload: [row] };
      const rows = index === 0 && options.missingPrior ? [] : parseMonthlyFinancialBatch(record).rows;
      return { month, rows, selection: { complete: true as const, rule: "latest_completed_batch_per_month_store_site" as const,
        selectedBatchId: rows.length ? batchId : null, recordHash: rows.length ? "e".repeat(64) : null, scopeRowCount: rows.length, authorizedRowCount: rows.length } };
    }) };
  return buildProfitAnalysisPreviewResult({ identity, input: { ...input, scope: sourceScope }, source });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const read = () => fireEvent.click(screen.getByRole("button", { name: "读取双月分析依据" }));
beforeEach(() => {
  vi.clearAllMocks(); controls.auth = { loading: false, error: null, user: { id: 3, defaultWorkspaceId: 7, role: "ops_manager" } };
  controls.permissions.isLoading = false; controls.permissions.canRead.mockReturnValue(true); controls.query.mockImplementation(async input => result(input));
});
afterEach(cleanup);

describe("profit analysis preparation UI", () => {
  it("requires an explicit read and never offers a generate/save/write action", () => {
    const view = render(<ProfitAnalysisPreview {...props} />);
    expect(controls.query).not.toHaveBeenCalled(); expect(view.container.firstElementChild).toHaveClass("manus-no-record");
    expect(screen.queryByRole("button", { name: /生成|保存|重试|分析利润/ })).not.toBeInTheDocument();
    expect(screen.getByText(/不调用模型、不生成草稿/)).toBeInTheDocument();
    expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_dashboard"); expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_profit");
  });
  it("sends only exact scope/calendar and renders server computed evidence", async () => {
    render(<ProfitAnalysisPreview {...props} />); read();
    await screen.findByRole("region", { name: "完整利润变化证据" });
    expect(controls.query).toHaveBeenCalledOnce(); expect(controls.query).toHaveBeenCalledWith(request(), { signal: expect.any(AbortSignal) });
    expect(screen.getByText(/2026-08：1 → 2026-09：2 USD/)).toBeInTheDocument();
    expect(screen.getByText(/不是已证明因果/, { selector: "p" })).toBeInTheDocument();
    expect(Object.keys(controls.query.mock.calls[0][0]).sort()).toEqual(["expectedWorkspaceId", "month", "scope"]);
  });
  it("requests the earliest visible month independently, allowing its preceding seventh month", async () => {
    render(<ProfitAnalysisPreview {...props} />);
    fireEvent.change(screen.getByLabelText("利润分析月份"), { target: { value: "2026-04" } }); read();
    await screen.findByRole("region", { name: "完整利润变化证据" });
    expect(controls.query.mock.calls[0][0]).toEqual(request("2026-04")); expect(screen.getByText(/2026-03：1 → 2026-04：2 USD/)).toBeInTheDocument();
  });
  it.each(["loading", "authError", "logout", "userChanged", "workspaceChanged", "permissionLoading", "profitDenied", "dashboardDenied"])("hides private data and avoids requests when %s", kind => {
    if (kind === "loading") controls.auth.loading = true;
    if (kind === "authError") controls.auth.error = new Error("PRIVATE_AUTH_COOKIE");
    if (kind === "logout") controls.auth.user = null;
    if (kind === "userChanged") controls.auth.user!.id = 4;
    if (kind === "workspaceChanged") controls.auth.user!.defaultWorkspaceId = 8;
    if (kind === "permissionLoading") controls.permissions.isLoading = true;
    if (kind === "profitDenied" || kind === "dashboardDenied") controls.permissions.canRead.mockImplementation((_module, key) => key !== (kind === "profitDenied" ? "ops_profit" : "ops_dashboard"));
    render(<ProfitAnalysisPreview {...props} />); expect(controls.query).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "读取双月分析依据" })).not.toBeInTheDocument(); expect(screen.queryByText("PRIVATE_AUTH_COOKIE")).not.toBeInTheDocument();
  });
  it("clears the previous month immediately and rejects a late response", async () => {
    const pending = deferred<ReturnType<typeof result>>(); controls.query.mockReturnValueOnce(pending.promise);
    render(<ProfitAnalysisPreview {...props} />); read(); const signal = controls.query.mock.calls[0][1].signal;
    fireEvent.change(screen.getByLabelText("利润分析月份"), { target: { value: "2026-08" } });
    expect(signal.aborted).toBe(true);
    await act(async () => pending.resolve(result())); expect(screen.queryByRole("region", { name: "完整利润变化证据" })).not.toBeInTheDocument();
    read(); await screen.findByRole("region", { name: "完整利润变化证据" }); expect(controls.query.mock.calls[1][0]).toEqual(request("2026-08"));
  });
  it("clears and aborts on parent scope change, with no automatic query", async () => {
    const pending = deferred<ReturnType<typeof result>>(); controls.query.mockReturnValueOnce(pending.promise);
    const view = render(<ProfitAnalysisPreview {...props} />); read(); const signal = controls.query.mock.calls[0][1].signal;
    view.rerender(<ProfitAnalysisPreview {...props} scope={{ ...scope, parentAsin: "B0OTHER001" }} />);
    expect(signal.aborted).toBe(true); await act(async () => pending.resolve(result()));
    expect(controls.query).toHaveBeenCalledTimes(1); expect(screen.queryByRole("region", { name: "完整利润变化证据" })).not.toBeInTheDocument();
  });
  it("unmounts private evidence on permission revocation and cannot resurrect it with a late reply", async () => {
    const pending = deferred<ReturnType<typeof result>>(); controls.query.mockReturnValueOnce(pending.promise);
    const view = render(<ProfitAnalysisPreview {...props} />); read();
    controls.permissions.canRead.mockReturnValue(false); view.rerender(<ProfitAnalysisPreview {...props} />);
    await act(async () => pending.resolve(result())); expect(screen.queryByRole("region", { name: "完整利润变化证据" })).not.toBeInTheDocument();
    controls.permissions.canRead.mockReturnValue(true); view.rerender(<ProfitAnalysisPreview {...props} />); expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("invalidates on a workspace source change without a paid action or automatic reread", async () => {
    render(<ProfitAnalysisPreview {...props} />); read(); await screen.findByRole("region", { name: "完整利润变化证据" });
    act(() => publishMonthlyFinancialChange({ userId: 4, workspaceId: 8, action: "confirm", batchId: 200 }));
    act(() => publishMonthlyFinancialChange({ userId: 4, workspaceId: 7, action: "upload", batchId: 200 }));
    expect(screen.getByRole("region", { name: "完整利润变化证据" })).toBeInTheDocument();
    act(() => publishMonthlyFinancialChange({ userId: 4, workspaceId: 7, action: "revoke", batchId: 200 }));
    expect(screen.getByText(/月报已变化，旧依据已清除/)).toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "完整利润变化证据" })).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it.each(["wrongActor", "wrongScope", "forgedExecution", "providerError"])("refuses invalid/private response %s without retry", async kind => {
    if (kind === "providerError") controls.query.mockRejectedValue(new Error("PRIVATE_FINANCIAL_BODY"));
    else {
      const reply = clone(result());
      if (kind === "wrongActor") { reply.identity.userId = 4; reply.source!.identity.userId = 4; reply.evidence!.identity.userId = 4; }
      if (kind === "wrongScope") reply.request.scope.parentAsin = "B0OTHER001";
      if (kind === "forgedExecution") (reply as unknown as { canGenerate: boolean }).canGenerate = true;
      controls.query.mockResolvedValue(reply);
    }
    render(<ProfitAnalysisPreview {...props} />); read(); await screen.findByRole("alert");
    expect(screen.queryByText("PRIVATE_FINANCIAL_BODY")).not.toBeInTheDocument(); expect(screen.queryByRole("region", { name: "完整利润变化证据" })).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("retains blocked unknown-currency evidence without converting it to USD", async () => {
    controls.query.mockImplementation(async input => result(input, { currency: null }));
    render(<ProfitAnalysisPreview {...props} scope={{ ...scope, currency: null }} />); read();
    await screen.findByText(/币种未核验，不能进行金额分析/); expect(screen.queryByRole("region", { name: "完整利润变化证据" })).not.toBeInTheDocument();
  });
  it("shows missing prior month and no-change cases without false AI conclusions", () => {
    const view = render(<ProfitAnalysisEvidenceView result={result(request(), { missingPrior: true })} />);
    expect(screen.getByText(/上月缺少该范围的完整来源/)).toBeInTheDocument();
    view.rerender(<ProfitAnalysisEvidenceView result={result(request(), { noChanges: true, missingMetric: true })} />);
    expect(screen.getByText(/这不是 AI 结论/)).toBeInTheDocument(); expect(screen.getByText(/不将未知补成零/)).toBeInTheDocument();
  });
  it("provides every evidence item through local pages and complete provenance", async () => {
    const value = result(); render(<ProfitAnalysisEvidenceView result={value} />);
    expect(value.evidence!.evidence.length).toBeGreaterThan(24);
    const next = screen.getByRole("button", { name: "证据下一页" });
    while (!next.hasAttribute("disabled")) fireEvent.click(next);
    expect(screen.getByText(value.evidence!.evidence.at(-1)!.title)).toBeInTheDocument();
    expect(screen.getAllByText("原行引用、分母与口径").length).toBeGreaterThan(0); expect(controls.query).not.toHaveBeenCalled();
  });
  it("does not turn unavailable source into empty successful evidence", () => {
    render(<ProfitAnalysisEvidenceView result={buildProfitAnalysisPreviewUnavailable({ identity, input: request(), reasonCode: "source_table_missing" })} />);
    expect(screen.getByRole("alert")).toHaveTextContent("未返回部分分析依据"); expect(screen.queryByText(/全部可比较变化证据/)).not.toBeInTheDocument();
  });
  it("clear aborts an in-flight query and leaves no financial content in browser storage", async () => {
    const pending = deferred<ReturnType<typeof result>>(); controls.query.mockReturnValueOnce(pending.promise);
    const store = vi.spyOn(Storage.prototype, "setItem"); render(<ProfitAnalysisPreview {...props} />); read();
    fireEvent.click(screen.getByRole("button", { name: "清除分析依据" }));
    expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true); await act(async () => pending.resolve(result()));
    expect(screen.queryByRole("region", { name: "完整利润变化证据" })).not.toBeInTheDocument(); expect(store).not.toHaveBeenCalled(); store.mockRestore();
  });
});
