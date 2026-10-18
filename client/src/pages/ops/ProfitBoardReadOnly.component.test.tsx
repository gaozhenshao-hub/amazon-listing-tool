// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProfitBoardReadOnly, { ProfitBoardReadOnlyContent } from "./ProfitBoardReadOnly";
import { publishMonthlyFinancialChange } from "./monthlyFinancialWriteEvents";
import {
  ProfitBoardReadInputSchema, buildProfitBoardReadResult, buildProfitBoardReadFailure, profitBoardMonths,
  type ProfitBoardReadInput, type ProfitBoardReadResult, type ProfitBoardMonthSelection,
} from "@shared/profitBoardRead";
import { parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord, type MonthlyFinancialMetrics } from "@shared/monthlyFinancialRead";
import type { ProfitAnalysisWorkflowProps } from "./ProfitAnalysisWorkflow";
import type { OperationsBoardOwnership } from "@shared/operationsBoardOwnership";

const controls = vi.hoisted(() => ({
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn() }, query: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { profitBoardRead: { get: { query: controls.query } } } }) } }));
vi.mock("./ProfitAnalysisWorkflow", () => ({ default: (props: ProfitAnalysisWorkflowProps) => <section aria-label="已核来源利润流程">{JSON.stringify(props)}</section> }));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const METRICS: MonthlyFinancialMetrics = { financialProfit: 0, salesQty: 0, salesAmount: 0, otherIncome: 0, discount: 0, purchaseCost: 0, freight: 0, fbaFee: 0, commission: 0, advertising: 0, promotion: 0, storage: 0, otherFees: 0, refundAmount: 0, refundQty: 0, returnQty: 0, ld: 0, coupon: 0, vine: 0 };
function input(values: Partial<ProfitBoardReadInput> = {}) { return ProfitBoardReadInputSchema.parse({ expectedWorkspaceId: 11, month: "2026-10", storeName: "合成店铺", country: "US", search: "", groupOffset: 0, groupLimit: 12, ...values }); }
type FixtureOptions = { ownership?: OperationsBoardOwnership; groups?: number; children?: number; userId?: number; sourceIdOffset?: number; currency?: string | null; missingMonth?: string; missingParentMonth?: string; scoped?: boolean; label?: string; kinds?: boolean; zeroPrevious?: boolean; unknownMetric?: boolean; detailRows?: Array<{ metrics?: Partial<MonthlyFinancialMetrics>; raw?: Record<string, unknown> }> };
/** Real source parser and shared six-month selection/financial builder. No UI
 * fixture synthesizes a ranking or calculates its own financial result. */
function result(request = input(), options: FixtureOptions = {}): ProfitBoardReadResult {
  const months = profitBoardMonths(request.month);
  const selections: ProfitBoardMonthSelection[] = months.map((month, monthIndex) => {
    if (month === options.missingMonth) return { month, selection: { selected: null, complete: true, scannedBatchIds: [] }, metadataVisibility: options.scoped ? "scoped" : "full" };
    const id = 100 + monthIndex + (options.sourceIdOffset ?? 0), rows: Array<Record<string, unknown>> = [];
    for (let group = 0; group < (options.groups ?? 2); group++) {
      if (group === 0 && month === options.missingParentMonth) continue;
      for (let child = 0; child < (group === 0 ? options.children ?? 2 : 1); child++) {
        const direction = group === 1 ? -1 : 1;
        const previous = options.zeroPrevious && monthIndex === 4;
        for (const [detailIndex, detail] of (options.detailRows ?? [{}]).entries()) rows.push({ ...METRICS, financialProfit: options.unknownMetric ? null : previous ? 0 : direction * (monthIndex + 1) * (group + 1), salesQty: previous ? 0 : 2, salesAmount: previous ? 0 : 100, ...detail.metrics,
          yearMonth: month, parentAsin: `P${String(group).padStart(2, "0")}`, asin: `C${group}-${child}`, sku: `SKU${group}-${child}${detailIndex ? `-${detailIndex}` : ""}`, title: options.label ?? `合成产品 ${group}`, storeName: request.storeName, site: request.country, operator: "来源备注非授权",
          raw: { ...(options.currency === null ? {} : { currency: options.currency ?? "USD" }), untouched: ["<img src=x onerror=alert(1)>", "https://example.test/not-download"], "5:订单支出/销售佣金": -12.5, ...detail.raw } });
      }
    }
    if (options.kinds) rows.push(
      { ...METRICS, financialProfit: 20, salesAmount: 100, yearMonth: month, parentAsin: "ORIGINAL-P", asin: "", sku: "", title: "原报表父体合计", storeName: request.storeName, site: request.country, operator: null, raw: { currency: "USD" } },
      { ...METRICS, financialProfit: -4, yearMonth: month, parentAsin: "", asin: "", sku: "UNASSIGNED", title: "未分配费用", storeName: request.storeName, site: request.country, operator: null, raw: { currency: "USD" } },
      { ...METRICS, financialProfit: 8, yearMonth: month, parentAsin: "EUR-P", asin: "EUR-C", sku: "EUR", title: "欧元独立", storeName: request.storeName, site: request.country, operator: null, raw: { currency: "EUR" } },
    );
    const record: MonthlyFinancialBatchRecord = { id, workspaceId: request.expectedWorkspaceId, userId: options.userId ?? 7, fileName: options.label ?? "合成月报.xlsx", fileHash: "a".repeat(64), status: "completed", createdAt: "2026-10-17 01:02:03.000000", confirmedAt: "2026-10-17 02:03:04.000000", totalRows: rows.length, skippedRows: 0, unallocatedRows: rows.filter(row => !row.parentAsin).length, months: [month], fileReferenceKind: "storage", sourceRunId: null, payload: rows };
    const selected = parseMonthlyFinancialBatch(record);
    return { month, selection: { selected, complete: true, scannedBatchIds: [id] }, metadataVisibility: options.scoped ? "scoped" : "full", ...(options.scoped ? { authorizedRowRefs: selected.rows.map(({ batchId, rowIndex }) => ({ batchId, rowIndex })) } : {}) };
  });
  return buildProfitBoardReadResult({ identity: { userId: options.userId ?? 7, workspaceId: request.expectedWorkspaceId }, input: request, selections, ...(options.ownership ? { ownership: options.ownership } : {}) });
}
const readButton = () => screen.getByRole("button", { name: "读取已有利润看板" });
function fillScope(values = { month: "2026-10", storeName: "合成店铺", country: "美国" }) {
  for (const [key, label] of [["month", "基准月份（YYYY-MM）"], ["storeName", "店铺"], ["country", "站点 / 国家代码"]] as const) fireEvent.change(screen.getByLabelText(`利润看板${label}`), { target: { value: values[key] } });
}
async function readReady() { fireEvent.click(readButton()); await screen.findByRole("region", { name: "完整父体列表" }); }
beforeEach(() => { controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }; controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true); controls.query.mockReset(); });
afterEach(cleanup);
function ownership(groups = 2, scoped = false, unavailable = false): OperationsBoardOwnership {
  return { version: 1, status: unavailable ? "unavailable" : "ready", reasonCode: unavailable ? "registry_unavailable" : null,
    meaning: "current_manual_else_latest_visible_financial_mapping_not_archive", visibility: scoped ? "scoped" : "full",
    operators: unavailable ? [] : (scoped ? [7] : [7, 8]).map(userId => ({ userId, displayName: "SYNTHETIC 同名运营" })),
    parents: Array.from({ length: groups }, (_, index) => ({ parentAsin: `P${String(index).padStart(2, "0")}`, operatorIds: unavailable ? [] : [scoped ? 7 : index % 2 ? 8 : 7],
      status: unavailable ? "unresolved" : "resolved", basis: unavailable ? "none" : "manual", sourceMonth: null, reasonCode: unavailable ? "registry_unavailable" : null })),
    partners: { status: "not_configured", reasonCode: "trusted_partner_relationship_not_configured" } };
}
const ownerSelect = () => screen.getByRole("combobox", { name: "利润看板运营" });
describe("利润看板数字负责人范围", () => {
  it("requires an explicit directory read; legacy unscreened fixtures cannot authorize a selection", async () => {
    controls.query.mockResolvedValue(result()); render(<ProfitBoardReadOnly />); expect(ownerSelect()).toBeDisabled(); expect(controls.query).not.toHaveBeenCalled();
    fillScope(); await readReady(); expect(ownerSelect()).toBeDisabled(); expect(screen.getByText(/请先读取当前范围以核验数字负责人目录/)).toBeInTheDocument();
  });
  it("distinguishes duplicate display names by numeric ID and filters on the server from page zero", async () => {
    controls.query.mockImplementation(async request => result(request, { ownership: ownership() })); render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    expect(within(ownerSelect()).getByRole("option", { name: "SYNTHETIC 同名运营 · ID 7" })).toBeInTheDocument();
    expect(within(ownerSelect()).getByRole("option", { name: "SYNTHETIC 同名运营 · ID 8" })).toBeInTheDocument();
    fireEvent.click(within(screen.getByRole("region", { name: "完整父体列表" })).getByRole("button", { name: "展开 P00 全部子体与原行" }));
    expect(screen.getByLabelText("已核来源利润流程")).toBeInTheDocument();
    fireEvent.change(ownerSelect(), { target: { value: "8" } });
    expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument(); expect(screen.queryByLabelText("已核来源利润流程")).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1); expect(ownerSelect()).toBeEnabled();
    await readReady(); expect(controls.query.mock.calls[1][0]).toEqual(input({ operatorId: 8 }));
    expect(within(screen.getByRole("region", { name: "完整父体列表" })).queryByRole("button", { name: "展开 P00 全部子体与原行" })).not.toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "完整父体列表" })).getByRole("button", { name: "展开 P01 全部子体与原行" })).toBeInTheDocument();
    fireEvent.change(ownerSelect(), { target: { value: "all" } }); await readReady(); expect(controls.query.mock.calls[2][0]).toEqual(input());
  });
  it("ordinary users have only their own verified numeric entry and no invented partner grant", async () => {
    controls.auth.user!.role = "ops_specialist"; controls.query.mockImplementation(async request => result(request, { scoped: true, ownership: ownership(2, true) }));
    render(<ProfitBoardReadOnly />); fillScope(); await readReady(); expect(within(ownerSelect()).getByRole("option", { name: "自己" })).toBeInTheDocument();
    expect(within(ownerSelect()).queryByRole("option", { name: "全部运营" })).not.toBeInTheDocument(); expect(within(ownerSelect()).getAllByRole("option")).toHaveLength(2);
    expect(screen.getAllByText(/搭档关系尚未配置/).length).toBeGreaterThan(0); fireEvent.change(ownerSelect(), { target: { value: "7" } }); await readReady();
    expect(controls.query.mock.calls[1][0]).toEqual(input({ operatorId: 7 }));
  });
  it("manager registry-unavailable fallback remains unfiltered finance, not unassigned products", async () => {
    controls.query.mockResolvedValue(result(input(), { ownership: ownership(2, false, true) })); render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    expect(ownerSelect()).toBeDisabled(); expect(screen.getByText(/运营目录不可用；仅保留管理员无运营筛选的授权财务/)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "完整父体列表" })).toBeInTheDocument(); expect(controls.query.mock.calls[0][0]).toEqual(input());
  });
  it.each(["missing", "request", "directory", "parent", "unavailable"])("rejects %s selected-owner evidence without falling back to all", async kind => {
    controls.query.mockResolvedValueOnce(result(input(), { ownership: ownership() })); render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    fireEvent.change(ownerSelect(), { target: { value: "8" } });
    const bad = clone(result(input({ operatorId: 8 }), { ownership: ownership() }));
    if (kind === "missing") delete bad.ownership;
    if (kind === "request") delete bad.request.operatorId;
    if (kind === "directory") bad.ownership!.operators = bad.ownership!.operators.filter(value => value.userId !== 8);
    if (kind === "parent") bad.ownership!.parents.forEach(value => { value.operatorIds = [7]; });
    if (kind === "unavailable") bad.ownership = ownership(2, false, true);
    controls.query.mockResolvedValue(bad); fireEvent.click(readButton()); await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument(); expect(ownerSelect()).toHaveValue("8"); expect(ownerSelect()).toBeDisabled();
    fireEvent.click(readButton()); await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(3));
    expect(controls.query.mock.calls[2][0].operatorId).toBe(8);
  });
  it.each(["invalid response", "service error"])("explicitly clears an invalid selected operator after %s without automatically reading all", async kind => {
    controls.query.mockResolvedValueOnce(result(input(), { ownership: ownership() })); render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    expect(screen.queryByRole("button", { name: "清除运营筛选" })).not.toBeInTheDocument(); fireEvent.change(ownerSelect(), { target: { value: "8" } });
    if (kind === "service error") controls.query.mockRejectedValueOnce(new Error("SYNTHETIC denied"));
    else { const bad = result(input({ operatorId: 8 }), { ownership: ownership() }); delete bad.ownership; controls.query.mockResolvedValueOnce(bad); }
    fireEvent.click(readButton()); await screen.findByRole("alert"); expect(ownerSelect()).toBeDisabled(); expect(ownerSelect()).toHaveValue("8");
    fireEvent.click(screen.getByRole("button", { name: "清除运营筛选" }));
    expect(ownerSelect()).toHaveValue("all"); expect(ownerSelect()).toBeDisabled(); expect(screen.queryByRole("button", { name: "清除运营筛选" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument(); expect(screen.queryByLabelText("已核来源利润流程")).not.toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(2); expect(screen.getByLabelText("利润看板店铺")).toHaveValue("合成店铺");
    controls.query.mockImplementationOnce(async request => result(request, { ownership: ownership() })); await readReady();
    expect(controls.query.mock.calls[2][0]).toEqual(input()); expect(ownerSelect()).toBeEnabled();
  });
  it.each(["full", "foreign", "unavailable"])("ordinary user rejects %s ownership directory even with scoped financial metadata", async kind => {
    controls.auth.user!.role = "ops_specialist"; const bad = result(input(), { scoped: true, ownership: ownership(2, true) });
    if (kind === "full") bad.ownership!.visibility = "full";
    if (kind === "foreign") bad.ownership!.operators.push({ userId: 8, displayName: "SYNTHETIC other" });
    if (kind === "unavailable") bad.ownership = ownership(2, true, true);
    controls.query.mockResolvedValue(bad); render(<ProfitBoardReadOnly />); fillScope(); fireEvent.click(readButton()); await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument(); expect(ownerSelect()).toBeDisabled(); expect(screen.queryByRole("option", { name: /SYNTHETIC other/ })).not.toBeInTheDocument();
  });
  it.each(["基准月份（YYYY-MM）", "店铺", "站点 / 国家代码", "父 ASIN（可选）", "产品搜索（保留完整父组）"])("scope edit %s clears its entire directory and old selection immediately", async field => {
    controls.query.mockResolvedValue(result(input(), { ownership: ownership() })); render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    fireEvent.change(ownerSelect(), { target: { value: "8" } }); fireEvent.change(screen.getByLabelText("利润看板" + field), { target: { value: "changed" } });
    expect(ownerSelect()).toBeDisabled(); expect(ownerSelect()).toHaveValue("all"); expect(within(ownerSelect()).queryByRole("option", { name: /ID 8/ })).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it.each(["actor", "workspace", "role", "permission"])("%s change clears the private directory", async kind => {
    controls.query.mockResolvedValue(result(input(), { ownership: ownership() })); const ui = render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    if (kind === "actor") controls.auth.user!.id = 8; if (kind === "workspace") controls.auth.user!.defaultWorkspaceId = 12; if (kind === "role") controls.auth.user!.role = "ops_specialist"; if (kind === "permission") controls.permissions.canRead.mockReturnValue(false);
    ui.rerender(<ProfitBoardReadOnly />); expect(screen.queryByRole("option", { name: "SYNTHETIC 同名运营 · ID 8" })).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("another actor's same-workspace commit clears old ownership and finance, then rereads exactly once with the selected ID", async () => {
    controls.query.mockImplementation(async request => result(request, { ownership: ownership() })); render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    fireEvent.change(ownerSelect(), { target: { value: "8" } }); await readReady(); const response = deferred<ProfitBoardReadResult>(); controls.query.mockReturnValueOnce(response.promise);
    act(() => publishMonthlyFinancialChange({ userId: 88, workspaceId: 11, action: "confirm", batchId: 800 }));
    expect(controls.query).toHaveBeenCalledTimes(3); expect(controls.query.mock.calls[2][0]).toEqual(input({ operatorId: 8 }));
    expect(ownerSelect()).toBeDisabled(); expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument(); expect(within(ownerSelect()).queryByRole("option", { name: "SYNTHETIC 同名运营 · ID 8" })).not.toBeInTheDocument();
    await act(async () => response.resolve(result(input({ operatorId: 8 }), { ownership: ownership() })));
    expect(ownerSelect()).toHaveValue("8"); expect(ownerSelect()).toBeEnabled(); expect(controls.query).toHaveBeenCalledTimes(3);
    act(() => publishMonthlyFinancialChange({ userId: 88, workspaceId: 12, action: "confirm", batchId: 800 })); act(() => publishMonthlyFinancialChange({ userId: 88, workspaceId: 11, action: "upload", batchId: 800 }));
    expect(ownerSelect()).toBeEnabled(); expect(controls.query).toHaveBeenCalledTimes(3);
  });
  it("a source change while the selection is unsubmitted clears the retained directory without starting a read", async () => {
    controls.query.mockResolvedValue(result(input(), { ownership: ownership() })); render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    fireEvent.change(ownerSelect(), { target: { value: "8" } }); act(() => publishMonthlyFinancialChange({ userId: 88, workspaceId: 11, action: "revoke", batchId: 800 }));
    expect(ownerSelect()).toBeDisabled(); expect(ownerSelect()).toHaveValue("8"); expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("rejects ownership changes during pagination rather than mixing owner scopes", async () => {
    const original = ownership(30); controls.query.mockImplementationOnce(async request => result(request, { groups: 30, ownership: original }));
    render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    const changed = clone(original); changed.operators[1].displayName = "SYNTHETIC changed";
    controls.query.mockImplementationOnce(async request => result(request, { groups: 30, ownership: changed }));
    fireEvent.click(screen.getByRole("button", { name: "父体下一页" })); await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument(); expect(ownerSelect()).toBeDisabled();
  });
});

describe("profit board workflow integration", () => {
  it.each([
    ["P00", "CAD", "child_rows"], ["EUR-P", "EUR", "child_rows"],
    ["ORIGINAL-P", "USD", "reported_parent_row"],
  ] as const)("passes exact verified identity, six months and %s scope to the selected workflow", async (parentAsin, currency, basis) => {
    controls.query.mockImplementation(async request => result(request, { currency: "CAD", kinds: true }));
    render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    expect(screen.queryByLabelText("已核来源利润流程")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: `展开 ${parentAsin} 全部子体与原行` }));
    expect(JSON.parse(screen.getByLabelText("已核来源利润流程").textContent!)).toEqual({
      identity: { userId: 7, workspaceId: 11 }, scope: { storeName: "合成店铺", country: "US", parentAsin, currency, basis }, months: profitBoardMonths("2026-10"),
    });
    fireEvent.click(screen.getByRole("button", { name: "收起产品明细" }));
    expect(screen.queryByLabelText("已核来源利润流程")).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("preserves unknown currency instead of guessing USD for a selected original row", async () => {
    controls.query.mockImplementation(async request => result(request, { groups: 1, children: 1, currency: null }));
    render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    fireEvent.click(screen.getAllByRole("button", { name: "展开 P00 全部子体与原行" })[0]);
    expect(JSON.parse(screen.getByLabelText("已核来源利润流程").textContent!)).toEqual({
      identity: { userId: 7, workspaceId: 11 }, scope: { storeName: "合成店铺", country: "US", parentAsin: "P00", currency: null, basis: "child_rows" }, months: profitBoardMonths("2026-10"),
    });
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("switches the selected exact parent and removes the workflow for unallocated originals", async () => {
    controls.query.mockImplementation(async request => result(request, { kinds: true }));
    render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    expect(JSON.parse(screen.getByLabelText("已核来源利润流程").textContent!).scope.parentAsin).toBe("P00");
    fireEvent.click(screen.getByRole("button", { name: "展开 P01 全部子体与原行" }));
    expect(JSON.parse(screen.getByLabelText("已核来源利润流程").textContent!).scope.parentAsin).toBe("P01");
    fireEvent.click(screen.getAllByRole("button", { name: "展开 未分配费用 全部子体与原行" })[0]);
    expect(screen.getByRole("region", { name: "选中产品完整钻取" })).toHaveTextContent("未分配原行");
    expect(screen.queryByLabelText("已核来源利润流程")).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("clears the integrated workflow on permission loss without retaining the selected private scope", async () => {
    controls.query.mockResolvedValue(result()); const ui = render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    expect(screen.getByLabelText("已核来源利润流程")).toBeInTheDocument();
    controls.permissions.canRead.mockReturnValue(false); ui.rerender(<ProfitBoardReadOnly />);
    expect(screen.queryByLabelText("已核来源利润流程")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "选中产品完整钻取" })).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
});

describe("profit board readonly identity gates", () => {
  it("re-reads an opened scope from page zero after commit without expanding an unopened scope", async () => {
    controls.query.mockImplementation(async value => result(value)); render(<ProfitBoardReadOnly />);
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "confirm", batchId: 80 }));
    expect(controls.query).not.toHaveBeenCalled(); fillScope(); await readReady();
    act(() => publishMonthlyFinancialChange({ userId: 8, workspaceId: 12, action: "confirm", batchId: 80 }));
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "upload", batchId: 80 }));
    expect(controls.query).toHaveBeenCalledTimes(1);
    act(() => publishMonthlyFinancialChange({ userId: 8, workspaceId: 11, action: "revoke", batchId: 80 }));
    await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(2));
    expect(controls.query.mock.calls[1][0]).toEqual(input()); expect(screen.getByLabelText("利润看板店铺")).toHaveValue("合成店铺");
    fireEvent.click(screen.getByRole("button", { name: "取消并清除利润看板" }));
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "confirm", batchId: 80 }));
    expect(controls.query).toHaveBeenCalledTimes(2);
  });
  it("has an explicit action only, privacy exclusion and no write, AI or archive control", () => {
    const view = render(<ProfitBoardReadOnly />);
    expect(controls.query).not.toHaveBeenCalled(); expect(view.container.firstElementChild).toHaveClass("manus-no-record");
    expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_data_import");
    expect(screen.queryByRole("button", { name: /保存|上传|同步|生成|归档/ })).not.toBeInTheDocument();
  });
  it.each([
    ["auth pending", () => { controls.auth.loading = true; }], ["auth failed", () => { controls.auth.error = new Error("private-cookie"); }],
    ["logout", () => { controls.auth.user = null; }], ["invalid user", () => { controls.auth.user!.id = 0; }],
    ["NULL workspace", () => { controls.auth.user!.defaultWorkspaceId = null; }], ["missing workspace", () => { controls.auth.user!.defaultWorkspaceId = undefined; }],
    ["invalid workspace", () => { controls.auth.user!.defaultWorkspaceId = -1; }], ["missing role", () => { controls.auth.user!.role = ""; }],
    ["permission pending", () => { controls.permissions.isLoading = true; }], ["denied", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("does not mount the reader when %s", (_label, arrange) => {
    arrange(); render(<ProfitBoardReadOnly />); expect(controls.query).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "读取已有利润看板" })).not.toBeInTheDocument(); expect(screen.queryByText("private-cookie")).not.toBeInTheDocument();
  });
  it("does not dispatch an incomplete scope", () => { render(<ProfitBoardReadOnly />); fireEvent.click(readButton()); expect(controls.query).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("未发送请求"); });
  it.each(["admin", "ops_manager", "ordinary"])("permits only a scoped explicit server read for role %s, with parent optional", async role => {
    controls.auth.user!.role = role; controls.query.mockImplementation(async (request: ProfitBoardReadInput) => result(request, { scoped: role === "ordinary" }));
    render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    expect(controls.query.mock.calls[0][0]).toEqual(input()); expect(controls.query.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
  });
});

describe("complete friend-style readonly presentation", () => {
  it("renders all twenty monthly columns with nine income/expense disclosures, fixed headers and six-month limits", () => {
    render(<ProfitBoardReadOnlyContent result={result()} />); fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    const table = screen.getByRole("region", { name: "C0-0 子体六期明细" }), query = within(table);
    expect(query.getAllByRole("columnheader")).toHaveLength(20);
    for (const title of ["月份 / 来源", "财务毛利润", "利润率", "销量", "销售额", "其他收入", "促销折扣", "采购成本", "头程费用", "FBA 配送费", "销售佣金", "广告费", "推广费", "仓储费", "其他费用", "退款金额", "退款量", "退款率", "退货量", "退货率"]) expect(query.getByRole("columnheader", { name: title })).toBeInTheDocument();
    for (const title of ["销售额", "其他收入", "促销折扣", "采购成本", "头程费用", "FBA 配送费", "销售佣金", "广告费", "推广费"]) expect(query.getByRole("button", { name: `C0-0 子体六期明细 2026-10 ${title}明细` })).toBeInTheDocument();
    expect(query.getAllByRole("row")).toHaveLength(7);
    expect(table).toHaveClass("overflow-auto", "max-h-[70vh]"); expect(table).toHaveAttribute("tabindex", "0");
    expect(table.querySelector("thead")).toHaveClass("sticky", "top-0"); expect(query.getByRole("columnheader", { name: "月份 / 来源" })).toHaveClass("sticky", "left-0");
    expect(screen.getAllByText(/当前接口仅含以上六个月，非全部历史月份/)).toHaveLength(3);
    expect(controls.query).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: /分析利润|重新分析/ })).not.toBeInTheDocument();
  });
  it("uses the existing financial derivation for weighted costs and all denominators while exposing original signs and references", () => {
    const data = result(input(), { groups: 1, children: 1, detailRows: [
      { metrics: { salesQty: 2, salesAmount: 100, purchaseCost: 10, advertising: 4 }, raw: { "9:平均费用/平均采购成本": 4, "1:广告订单量/SP": 1, "2:广告销售额/SP": 20 } },
      { metrics: { salesQty: 6, salesAmount: 300, purchaseCost: 60, advertising: 12 }, raw: { "1:广告订单量/SP": 3, "2:广告销售额/SP": 60 } },
    ] });
    render(<ProfitBoardReadOnlyContent result={data} />); fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    const button = screen.getByRole("button", { name: "C0-0 子体六期明细 2026-10 采购成本明细" }); fireEvent.click(button);
    expect(button).toHaveAttribute("aria-expanded", "true");
    const panel = within(screen.getByRole("region", { name: "C0-0 子体六期明细 2026-10 采购成本完整明细" }));
    expect(panel.getByText(/采购成本：8.5 · 分子 68 \/ 分母 8 · 原表报告 1 行 \/ 计算 1 行/)).toBeInTheDocument();
    for (const title of ["ACOS", "广告订单成本", "广告费 / 销售额", "单件广告成本", "广告销售占比", "退款率", "退货率"]) expect(panel.getByRole("columnheader", { name: title })).toBeInTheDocument();
    expect(panel.getAllByText(/原值 -12.5 × -1 ＝ 12.5/)).toHaveLength(2);
    expect(panel.getByText("本月全部来源原行（2 行）")).toBeInTheDocument();
    expect(panel.getByText(/批次 105 \/ 原行索引 1/)).toBeInTheDocument();
    expect(panel.getAllByText(/"5:订单支出\/销售佣金": -12.5/)).toHaveLength(2);
    fireEvent.click(button); expect(screen.queryByRole("region", { name: "C0-0 子体六期明细 2026-10 采购成本完整明细" })).not.toBeInTheDocument();
  });
  it("retains unknown metrics, real zero and negative values without making missing month rows zero", () => {
    render(<ProfitBoardReadOnlyContent result={result(input(), { groups: 1, children: 1, missingMonth: "2026-07", detailRows: [{ metrics: { financialProfit: -2, advertising: null, purchaseCost: 0, salesQty: 0, salesAmount: 0 } }] })} />);
    fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    const table = within(screen.getByRole("region", { name: "C0-0 子体六期明细" }));
    const current = table.getAllByRole("row")[1], missing = table.getAllByRole("row")[4];
    expect(within(current).getByText("-2.00")).toHaveClass("text-red-600");
    expect(within(current).getByRole("button", { name: /采购成本明细/ })).toHaveTextContent("0.00");
    expect(within(current).getByRole("button", { name: /广告费明细/ })).toHaveTextContent("未知 / 未提供");
    expect(missing).toHaveTextContent("2026-07"); expect(within(missing).getAllByText("未知 / 未提供")).toHaveLength(19); expect(within(missing).queryByText("0.00")).not.toBeInTheDocument();
    fireEvent.click(within(current).getByRole("button", { name: /广告费明细/ }));
    expect(screen.getAllByText(/分子或分母未知、分母非正/).length).toBeGreaterThan(0);
  });
  it("keeps unknown-currency monthly records separate and does not calculate money ratios", () => {
    const data = result(input(), { groups: 1, children: 1, currency: null, detailRows: [{ metrics: { purchaseCost: 3 } }, { metrics: { purchaseCost: 7 } }] });
    render(<ProfitBoardReadOnlyContent result={data} initialProductId={data.products[0].id} />);
    const table = within(screen.getByRole("region", { name: "C0-0 子体六期明细" }));
    const row = table.getAllByRole("row").find(item => within(item).queryByRole("button", { name: /采购成本明细/ }))!;
    expect(row).toHaveTextContent("币种未知（原值） · 1 条原行"); expect(row).toHaveTextContent("未知 / 未提供");
    fireEvent.click(within(row).getByRole("button", { name: /采购成本明细/ }));
    expect(screen.getAllByText(/来源币种未知或冲突；保留原分子分母，不计算单件费用/).length).toBeGreaterThan(0);
    expect(screen.queryByText("本月全部来源原行（2 行）")).not.toBeInTheDocument();
  });
  it("keeps every original monthly source reachable, including the second source page", () => {
    const data = result(input(), { groups: 1, children: 1, detailRows: Array.from({ length: 22 }, (_, index) => ({ raw: { marker: `source-${index}` } })) });
    render(<ProfitBoardReadOnlyContent result={data} />); fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    fireEvent.click(screen.getByRole("button", { name: "C0-0 子体六期明细 2026-10 销售额明细" }));
    const panel = within(screen.getByRole("region", { name: "C0-0 子体六期明细 2026-10 销售额完整明细" }));
    expect(panel.getByText("本月全部来源原行（22 行）")).toBeInTheDocument();
    expect(panel.queryByText(/批次 105 \/ 原行索引 21/)).not.toBeInTheDocument();
    fireEvent.click(panel.getByRole("button", { name: "月表来源下一页" }));
    expect(panel.getByText(/批次 105 \/ 原行索引 21/)).toBeInTheDocument(); expect(panel.getByRole("button", { name: "月表来源下一页" })).toBeDisabled();
    fireEvent.click(panel.getByRole("button", { name: "月表来源上一页" })); expect(panel.getByText(/批次 105 \/ 原行索引 0/)).toBeInTheDocument();
    expect(document.querySelector("img[src=x]")).toBeNull(); expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("keeps reported parent totals and unallocated fees in independent full monthly tables", () => {
    const data = result(input(), { kinds: true });
    const parent = data.products.find(product => product.basis === "reported_parent_row")!;
    const view = render(<ProfitBoardReadOnlyContent result={data} initialProductId={parent.id} />);
    let details = within(screen.getByRole("region", { name: "选中产品完整钻取" }));
    expect(details.getByText(/此组没有可核验的子体明细/)).toBeInTheDocument();
    expect(within(details.getByRole("region", { name: "选中父体六期完整月报" })).getAllByText("20.00")).toHaveLength(6);
    expect(details.queryByText("来源备注非授权")).not.toBeInTheDocument();
    view.unmount();
    const unallocated = data.products.find(product => product.basis === "unallocated_rows")!;
    render(<ProfitBoardReadOnlyContent result={data} initialProductId={unallocated.id} />);
    details = within(screen.getByRole("region", { name: "选中产品完整钻取" }));
    expect(within(details.getByRole("region", { name: "选中父体六期完整月报" })).getAllByText("-4.00")).toHaveLength(1);
    expect(details.queryByRole("region", { name: "C0-0 子体六期明细" })).not.toBeInTheDocument();
  });
  it("does not present a partial source set as a complete monthly table", () => {
    const data = result(); data.pageRows = data.pageRows.slice(1);
    render(<ProfitBoardReadOnlyContent result={data} initialProductId={data.products[0].id} />);
    expect(screen.getByRole("alert")).toHaveTextContent("来源引用未完整返回");
    expect(screen.queryByRole("region", { name: "选中父体六期完整月报" })).not.toBeInTheDocument();
  });
  it("mounts the optional evidence preview slot only for the explicitly selected product", () => {
    const data = result(), preview = vi.fn(product => <p>合成双月依据 {product.parentAsin}</p>);
    render(<ProfitBoardReadOnlyContent result={data} renderProfitAnalysis={preview} />);
    expect(preview).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    expect(preview).toHaveBeenLastCalledWith(data.products[0]); expect(screen.getByText("合成双月依据 P00")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "收起产品明细" })); expect(screen.queryByText("合成双月依据 P00")).not.toBeInTheDocument();
    expect(controls.query).not.toHaveBeenCalled();
  });
  it("renders six-month chart and values, full-source top fives, four metrics and monthly data entries without RPC", () => {
    const data = result(input({ groupLimit: 1 }), { groups: 8 }); render(<ProfitBoardReadOnlyContent result={data} />);
    expect(controls.query).not.toHaveBeenCalled(); expect(screen.getAllByRole("img")).toHaveLength(1);
    for (const month of data.months) expect(screen.getByRole("button", { name: new RegExp(`^${month}`) })).toBeInTheDocument();
    expect(screen.getByText(/共 1 个独立分区、8 个完整父组/)).toBeInTheDocument(); expect(screen.getByText(/本页 1 \/ 全筛选 8 组/)).toBeInTheDocument();
    const table = within(screen.getByRole("region", { name: "父体当月上月四指标横向表" }));
    for (const metric of ["财务利润", "销量", "销售额", "利润率"]) expect(table.getByRole("columnheader", { name: `${metric} 2026-10` })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "查看 P07 完整父子明细" })).toBeInTheDocument();
    expect(screen.getByText(/不是已冻结归档版本/)).toBeInTheDocument();
  });
  it("drills through all children and full source raw with denominator, not just top-five rows", () => {
    render(<ProfitBoardReadOnlyContent result={result()} />); fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    const details = within(screen.getByRole("region", { name: "选中产品完整钻取" }));
    expect(details.getByRole("heading", { name: "全部子体（2 个）" })).toBeInTheDocument();
    expect(details.getByRole("region", { name: "C0-1 子体六期明细" })).toBeInTheDocument();
    expect(details.getByText(/全部来源原行 \/ 费用与分母（12 行）/)).toBeInTheDocument();
    expect(details.getAllByText(/"5:订单支出\/销售佣金": -12.5/).length).toBeGreaterThan(0);
    expect(details.getAllByText(/"numerator"/).length).toBeGreaterThan(0);
    expect(screen.queryByRole("link")).not.toBeInTheDocument(); expect(document.querySelector("img[src=x]")).toBeNull();
  });
  it("keeps every child/source row reachable with bounded local DOM paging", () => {
    render(<ProfitBoardReadOnlyContent result={result(input(), { children: 22 })} />); fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    expect(screen.queryByRole("region", { name: "C0-8 子体六期明细" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "子体下一页" })); expect(screen.getByRole("region", { name: "C0-8 子体六期明细" })).toBeInTheDocument();
    expect(screen.queryByText("批次 105 原行 0 全部费用 / 分子分母 / 原文")).not.toBeInTheDocument();
    for (let page = 0; page < 6; page++) fireEvent.click(screen.getByRole("button", { name: "来源原行下一页" }));
    expect(screen.getByText("批次 105 原行 21 全部费用 / 分子分母 / 原文")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "来源原行下一页" })).toBeDisabled();
  });
  it("does not join SVG lines across a missing month or turn it into zero", () => {
    const view = render(<ProfitBoardReadOnlyContent result={result(input(), { missingMonth: "2026-07" })} />);
    expect(view.container.querySelectorAll("[data-profit-point]")).toHaveLength(5); expect(view.container.querySelectorAll("[data-profit-segment]")).toHaveLength(3);
    fireEvent.click(screen.getByRole("button", { name: /^2026-07/ })); expect(within(screen.getByRole("region", { name: "选中月份来源" })).getByText(/不补零/)).toBeInTheDocument();
  });
  it("keeps zero and negative results while showing zero-denominator percentage as unavailable", () => {
    render(<ProfitBoardReadOnlyContent result={result(input(), { zeroPrevious: true })} />);
    expect(screen.getAllByText("0.00 USD").length).toBeGreaterThan(0); expect(screen.getAllByText(/上期为零，不计算变化百分比/).length).toBeGreaterThan(0);
    expect(screen.getAllByText("-12.00 USD").length).toBeGreaterThan(0); expect(screen.getAllByText(/未知 \/ 不可比较/).length).toBeGreaterThan(0);
  });
  it("does not silently sum unknown currency or blend parent/child/unallocated bases", () => {
    render(<ProfitBoardReadOnlyContent result={result(input(), { kinds: true })} />);
    expect(screen.getByRole("heading", { name: /EUR · 子体原行汇总/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /USD · 原报表父体合计/ })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /USD · 未分配 \/ 父体歧义/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "查看 未分配费用 完整父子明细" })).not.toBeInTheDocument();
  });
  it("unknown-currency partitions remain individually reachable and never draw a money line", () => {
    const data = result(input(), { currency: null }); const view = render(<ProfitBoardReadOnlyContent result={data} />);
    expect(view.container.querySelectorAll("[data-profit-point]")).toHaveLength(0);
    expect(screen.getByRole("button", { name: "利润分区下一页" })).toBeEnabled(); fireEvent.click(screen.getByRole("button", { name: "利润分区下一页" }));
    expect(screen.getByText(`5–8 / ${data.partitions.length}，全部可逐页查看`)).toBeInTheDocument();
    expect(screen.getAllByText(/不绘制金额趋势/)).toHaveLength(4);
  });
  it("missing product in an otherwise available month stays missing and is excluded from ranking", () => {
    const data = result(input(), { missingParentMonth: "2026-09" }); render(<ProfitBoardReadOnlyContent result={data} />);
    expect(screen.queryByRole("button", { name: "查看 P00 完整父子明细" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" })); expect(screen.getAllByText(/有效快照中该父体\/子体无可见原行/).length).toBeGreaterThan(0);
  });
  it("an observed source with an unknown metric is not shown as zero", () => {
    const view = render(<ProfitBoardReadOnlyContent result={result(input(), { unknownMetric: true })} />);
    const table = within(screen.getByRole("region", { name: "父体当月上月四指标横向表" }));
    expect(table.getAllByText("未知 / 不可比较").length).toBeGreaterThan(0);
    expect(table.queryByText("0.00 USD")).not.toBeInTheDocument(); expect(view.container.querySelectorAll("[data-profit-point]")).toHaveLength(0);
  });
  it("a matching child search still exposes the full parent and all its sibling sources", () => {
    render(<ProfitBoardReadOnlyContent result={result(input({ search: "SKU0-1" }))} />);
    expect(screen.getByText(/本页 1 \/ 全筛选 1 组/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    expect(screen.getByRole("heading", { name: "全部子体（2 个）" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "C0-0 子体六期明细" })).toBeInTheDocument();
  });
  it("shows scoped provenance without other uploader file names/hashes or assumed UTC", () => {
    render(<ProfitBoardReadOnlyContent result={result(input(), { scoped: true })} />);
    const source = within(screen.getByRole("region", { name: "选中月份来源" })); expect(source.getByText(/不返回整批名称、哈希/)).toBeInTheDocument();
    expect(source.queryByText(/来源名称/)).not.toBeInTheDocument(); expect(source.getByText(/2026-10-17 01:02:03.000000/)).toHaveTextContent("时区未声明");
  });
  it("month selection is local and only the explicit reread button changes the base month", () => {
    const onMonth = vi.fn(); render(<ProfitBoardReadOnlyContent result={result()} onMonth={onMonth} />);
    fireEvent.click(screen.getByRole("button", { name: /^2026-08/ })); expect(onMonth).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "以 2026-08 为基准重新读取六个月" })); expect(onMonth).toHaveBeenCalledWith("2026-08");
  });
  it("ranking offset requests the complete correct parent page rather than treating refs as raw data", () => {
    const onPage = vi.fn(); const data = result(input({ groupLimit: 3 }), { groups: 15 }); render(<ProfitBoardReadOnlyContent result={data} onPage={onPage} />);
    const rank = data.partitions[0].rising.find(item => item.parentAsin === "P14")!;
    fireEvent.click(screen.getByRole("button", { name: "查看 P14 完整父子明细" })); expect(onPage).toHaveBeenCalledWith(12, rank.productId);
    expect(screen.queryByRole("region", { name: "选中产品完整钻取" })).not.toBeInTheDocument();
  });
  it("each table scrolls locally and source strings stay text, not links/HTML", () => {
    render(<ProfitBoardReadOnlyContent result={result(input(), { label: "<script>private()</script> https://invalid.test/file" })} />);
    const table = screen.getByRole("region", { name: "父体当月上月四指标横向表" }); expect(table).toHaveClass("overflow-x-auto"); expect(table).toHaveAttribute("tabindex", "0");
    expect(screen.queryByRole("link")).not.toBeInTheDocument(); expect(document.querySelector("script")).toBeNull();
    expect(screen.getAllByText(/<script>private\(\)<\/script>/).length).toBeGreaterThan(0);
  });
  it.each(["missing", "not_found", "invalid"] as const)("distinguishes %s from a zero-valued board", status => {
    render(<ProfitBoardReadOnlyContent result={buildProfitBoardReadFailure({ identity: { userId: 7, workspaceId: 11 }, input: input(), status, reasonCode: status, missingReason: "安全状态原因" })} />);
    expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument(); expect(screen.queryByRole("img")).not.toBeInTheDocument(); expect(screen.getByText("安全状态原因")).toBeInTheDocument();
  });
});

describe("fresh reads, epoch and pagination isolation", () => {
  it.each(["month", "storeName", "country", "parentAsin", "search"] as const)("clears immediately on %s edit and ignores an old response", async field => {
    const request = deferred<unknown>(); controls.query.mockReturnValue(request.promise); render(<ProfitBoardReadOnly />); fillScope(); fireEvent.click(readButton());
    const labels = { month: "基准月份（YYYY-MM）", storeName: "店铺", country: "站点 / 国家代码", parentAsin: "父 ASIN（可选）", search: "产品搜索（保留完整父组）" };
    fireEvent.change(screen.getByLabelText(`利润看板${labels[field]}`), { target: { value: field === "month" ? "2026-09" : "changed" } });
    expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true); await act(async () => request.resolve(result())); expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument();
  });
  it.each(["user", "workspace", "role", "permission", "authPending"] as const)("destroys prior results/readers on %s change", async kind => {
    controls.query.mockImplementation(async (request: ProfitBoardReadInput) => result(request)); const view = render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    const slow = deferred<unknown>(); controls.query.mockReturnValue(slow.promise); fireEvent.click(readButton());
    if (kind === "user") controls.auth.user!.id = 8;
    if (kind === "workspace") controls.auth.user!.defaultWorkspaceId = 12;
    if (kind === "role") controls.auth.user!.role = "ordinary";
    if (kind === "permission") controls.permissions.canRead.mockReturnValue(false);
    if (kind === "authPending") controls.auth.loading = true;
    view.rerender(<ProfitBoardReadOnly />); expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument();
    expect(controls.query.mock.calls[1][1].signal.aborted).toBe(true); await act(async () => slow.resolve(result())); expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument();
  });
  it("keeps only the latest same-scope read when transport ignores abort", async () => {
    const first = deferred<unknown>(), second = deferred<unknown>(); controls.query.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    render(<ProfitBoardReadOnly />); fillScope(); fireEvent.click(readButton()); fireEvent.click(readButton());
    await act(async () => second.resolve(result(input(), { sourceIdOffset: 10 }))); expect(screen.getByText("批次 ID：115 · 已确认导入（completed），不等于月度覆盖已核验")).toBeInTheDocument();
    await act(async () => first.resolve(result())); expect(screen.queryByText("批次 ID：105 · 已确认导入（completed），不等于月度覆盖已核验")).not.toBeInTheDocument();
  });
  it("cancel/unmount abort and do not display a late response", async () => {
    const slow = deferred<unknown>(); controls.query.mockReturnValue(slow.promise); const view = render(<ProfitBoardReadOnly />); fillScope(); fireEvent.click(readButton());
    fireEvent.click(screen.getByRole("button", { name: "取消并清除利润看板" })); expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true);
    await act(async () => slow.resolve(result())); expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument();
    fireEvent.click(readButton()); view.unmount(); expect(controls.query.mock.calls[1][1].signal.aborted).toBe(true);
  });
  it("clears previous data on a new read failure and never exposes server error messages", async () => {
    controls.query.mockImplementationOnce(async (request: ProfitBoardReadInput) => result(request)).mockRejectedValueOnce(new Error("SECRET SQL payload"));
    render(<ProfitBoardReadOnly />); fillScope(); await readReady(); fireEvent.click(readButton()); await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument(); expect(screen.queryByText("SECRET SQL payload")).not.toBeInTheDocument();
  });
  it.each([
    ["user", (value: ProfitBoardReadResult) => { value.identity.userId = 8; }],
    ["workspace", (value: ProfitBoardReadResult) => { value.identity.workspaceId = 12; }],
    ["month", (value: ProfitBoardReadResult) => { value.request.month = "2026-09"; }],
    ["store", (value: ProfitBoardReadResult) => { value.request.storeName = "OTHER"; }],
    ["country", (value: ProfitBoardReadResult) => { value.request.country = "CA"; }],
    ["search", (value: ProfitBoardReadResult) => { value.request.search = "different"; }],
    ["offset", (value: ProfitBoardReadResult) => { value.request.groupOffset = 1; }],
    ["dishonest page count", (value: ProfitBoardReadResult) => { value.page.totalGroups = 100; }],
    ["unrequested parent", (value: ProfitBoardReadResult) => { value.request.parentAsin = "P00"; }],
    ["duplicate source", (value: ProfitBoardReadResult) => { value.sources[1] = value.sources[0]; }],
    ["source raw row", (value: ProfitBoardReadResult) => { value.pageRows[0].storeName = "OTHER"; }],
    ["forged metric", (value: ProfitBoardReadResult) => { value.products[0].current.profit = 123456; }],
  ] as const)("rejects malformed or mixed-scope %s replies", async (_label, mutate) => {
    const value = clone(result()); mutate(value); controls.query.mockResolvedValue(value); render(<ProfitBoardReadOnly />); fillScope(); fireEvent.click(readButton());
    await screen.findByRole("alert"); expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument();
  });
  it("rejects another uploader's full metadata for an ordinary role", async () => {
    controls.auth.user!.role = "ordinary"; const value = result(); value.sources.forEach(source => { if (source.batch?.visibility === "full") source.batch.userId = 8; });
    controls.query.mockResolvedValue(value); render(<ProfitBoardReadOnly />); fillScope(); fireEvent.click(readButton()); await screen.findByRole("alert");
    expect(screen.queryByText("合成月报.xlsx")).not.toBeInTheDocument();
  });
  it("reads the next whole-parent page and automatically expands the selected ranking target", async () => {
    controls.query.mockImplementation(async (request: ProfitBoardReadInput) => result(request, { groups: 15 })); render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    fireEvent.click(screen.getByRole("button", { name: "查看 P14 完整父子明细" })); await screen.findByRole("region", { name: "选中产品完整钻取" });
    expect(controls.query.mock.calls[1][0].groupOffset).toBe(12); expect(screen.getByRole("region", { name: "选中产品完整钻取" })).toHaveTextContent("P14");
    expect(screen.getByRole("button", { name: "父体下一页" })).toBeDisabled();
  });
  it("refuses pagination when any selected month source changes", async () => {
    controls.query.mockImplementationOnce(async (request: ProfitBoardReadInput) => result(request, { groups: 15 })).mockImplementationOnce(async (request: ProfitBoardReadInput) => result(request, { groups: 15, sourceIdOffset: 10 }));
    render(<ProfitBoardReadOnly />); fillScope(); await readReady(); fireEvent.click(screen.getByRole("button", { name: "父体下一页" })); await screen.findByRole("alert");
    expect(screen.queryByRole("region", { name: "完整父体列表" })).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(2);
  });
  it("month navigation issues a fresh explicit request without carrying a previous page", async () => {
    controls.query.mockImplementation(async (request: ProfitBoardReadInput) => result(request)); render(<ProfitBoardReadOnly />); fillScope(); await readReady();
    fireEvent.click(screen.getByRole("button", { name: /^2026-08/ })); expect(controls.query).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "以 2026-08 为基准重新读取六个月" })); await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(2));
    expect(controls.query.mock.calls[1][0]).toEqual(input({ month: "2026-08" }));
  });
});
