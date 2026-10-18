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

const controls = vi.hoisted(() => ({
  auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null },
  permissions: { isLoading: false, canRead: vi.fn() }, query: vi.fn(),
}));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { profitBoardRead: { get: { query: controls.query } } } }) } }));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
const METRICS: MonthlyFinancialMetrics = { financialProfit: 0, salesQty: 0, salesAmount: 0, otherIncome: 0, discount: 0, purchaseCost: 0, freight: 0, fbaFee: 0, commission: 0, advertising: 0, promotion: 0, storage: 0, otherFees: 0, refundAmount: 0, refundQty: 0, returnQty: 0, ld: 0, coupon: 0, vine: 0 };
function input(values: Partial<ProfitBoardReadInput> = {}) { return ProfitBoardReadInputSchema.parse({ expectedWorkspaceId: 11, month: "2026-10", storeName: "合成店铺", country: "US", search: "", groupOffset: 0, groupLimit: 12, ...values }); }
type FixtureOptions = { groups?: number; children?: number; userId?: number; sourceIdOffset?: number; currency?: string | null; missingMonth?: string; missingParentMonth?: string; scoped?: boolean; label?: string; kinds?: boolean; zeroPrevious?: boolean; unknownMetric?: boolean };
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
        rows.push({ ...METRICS, financialProfit: options.unknownMetric ? null : previous ? 0 : direction * (monthIndex + 1) * (group + 1), salesQty: previous ? 0 : 2, salesAmount: previous ? 0 : 100,
          yearMonth: month, parentAsin: `P${String(group).padStart(2, "0")}`, asin: `C${group}-${child}`, sku: `SKU${group}-${child}`, title: options.label ?? `合成产品 ${group}`, storeName: request.storeName, site: request.country, operator: "来源备注非授权",
          raw: { ...(options.currency === null ? {} : { currency: options.currency ?? "USD" }), untouched: ["<img src=x onerror=alert(1)>", "https://example.test/not-download"], "5:订单支出/销售佣金": -12.5 } });
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
  return buildProfitBoardReadResult({ identity: { userId: options.userId ?? 7, workspaceId: request.expectedWorkspaceId }, input: request, selections });
}
const readButton = () => screen.getByRole("button", { name: "读取已有利润看板" });
function fillScope(values = { month: "2026-10", storeName: "合成店铺", country: "美国" }) {
  for (const [key, label] of [["month", "基准月份（YYYY-MM）"], ["storeName", "店铺"], ["country", "站点 / 国家代码"]] as const) fireEvent.change(screen.getByLabelText(`利润看板${label}`), { target: { value: values[key] } });
}
async function readReady() { fireEvent.click(readButton()); await screen.findByRole("region", { name: "完整父体列表" }); }
beforeEach(() => { controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }; controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true); controls.query.mockReset(); });
afterEach(cleanup);

describe("profit board readonly identity gates", () => {
  it("re-reads an opened scope from page zero after commit without expanding an unopened scope", async () => {
    controls.query.mockImplementation(async value => result(value)); render(<ProfitBoardReadOnly />);
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "confirm", batchId: 80 }));
    expect(controls.query).not.toHaveBeenCalled(); fillScope(); await readReady();
    act(() => publishMonthlyFinancialChange({ userId: 8, workspaceId: 11, action: "confirm", batchId: 80 }));
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "upload", batchId: 80 }));
    expect(controls.query).toHaveBeenCalledTimes(1);
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "revoke", batchId: 80 }));
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
