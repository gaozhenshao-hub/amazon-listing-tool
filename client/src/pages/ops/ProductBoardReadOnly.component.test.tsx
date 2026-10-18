// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductBoardReadOnly, { ProductBoardReadOnlyContent } from "./ProductBoardReadOnly";
import { publishMonthlyFinancialChange } from "./monthlyFinancialWriteEvents";
import { ProductBoardReadInputSchema, buildProductBoardReadResult, buildProductBoardReadFailure, type ProductBoardReadInput, type ProductBoardReadResult, type ProductBoardMonthSelection } from "@shared/productBoardRead";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "@shared/monthlyFinancialRead";
import { profitBoardMonths } from "@shared/profitBoardRead";
import type { ProfitAnalysisWorkflowProps } from "./ProfitAnalysisWorkflow";

const controls = vi.hoisted(() => ({ auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null | undefined; role: string } | null }, permissions: { isLoading: false, canRead: vi.fn() }, query: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { productBoardRead: { get: { query: controls.query } } } }) } }));
vi.mock("./ProductTasksReadOnly", () => ({ ProductTasksEmbeddedReadOnly: ({ product }: { product: unknown }) => <section aria-label="精确产品任务入口">{JSON.stringify(product)}</section> }));
vi.mock("./ProfitAnalysisWorkflow", () => ({ default: (props: ProfitAnalysisWorkflowProps) => <section aria-label="已核来源利润流程">{JSON.stringify(props)}</section> }));
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function input(patch: Partial<ProductBoardReadInput> = {}): ProductBoardReadInput { return ProductBoardReadInputSchema.parse({ expectedWorkspaceId: 11, month: "2026-10", storeName: "合成店铺", country: "US", search: "", highReturnsOffset: 0, highProfitOffset: 0, losingOffset: 0, allOffset: 0, pageSize: 10, ...patch }); }
type Options = { groups?: number; children?: number; scoped?: boolean; userId?: number; sourceOffset?: number; label?: string; missingMonth?: string; empty?: boolean; unknown?: boolean; zero?: boolean; kinds?: boolean; longHistory?: boolean };
/** Actual monthly source parser and product board builder; UI tests do not
 * synthesize financial/ranking output or override the shared validator. */
function result(request = input(), options: Options = {}): ProductBoardReadResult {
  const months = options.longHistory ? ["2024-01", "2026-08", "2026-09", "2026-10"] : ["2026-08", "2026-09", "2026-10"];
  const selections: ProductBoardMonthSelection[] = options.empty ? [] : months.map((month, monthIndex) => {
    if (month === options.missingMonth) return { month, selection: { selected: null, scannedBatchIds: [], complete: true }, metadataVisibility: options.scoped ? "scoped" : "full" };
    const id = 100 + monthIndex + (options.sourceOffset ?? 0), rows: Array<Record<string, unknown>> = [];
    const make = (patch: Record<string, unknown> = {}) => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])), yearMonth: month, storeName: request.storeName, site: request.country, parentAsin: "P00", asin: "C0-00", sku: "SKU0-00", title: options.label ?? "合成产品 0", operator: "原文姓名不是授权", salesQty: options.zero ? 0 : 30, salesAmount: options.zero ? 0 : 1000, financialProfit: options.unknown ? null : 1200, returnQty: 4, refundQty: 2, purchaseCost: -100, freight: -50, raw: { currency: "USD", original: ["<img src=x onerror=bad()>", "https://example.test/not-download"], "原始费用": -10 }, ...patch });
    for (let group = 0; group < (options.groups ?? 2); group++) for (let child = 0; child < (group === 0 ? options.children ?? 2 : 1); child++) rows.push(make({ parentAsin: `P${String(group).padStart(2, "0")}`, asin: `C${group}-${String(child).padStart(2, "0")}`, sku: `SKU${group}-${String(child).padStart(2, "0")}`, title: options.label ?? `合成产品 ${group}`, financialProfit: options.unknown ? null : group === 1 ? -100 : 1200 + group }));
    if (options.kinds) rows.push(make({ parentAsin: "CAD-P", asin: "CAD-C", financialProfit: -20, raw: { currency: "CAD" }, title: "加币亏损" }), make({ parentAsin: "EUR-P", asin: "EUR-C", financialProfit: 9999, raw: { currency: "EUR" }, title: "欧元高额不套美元阈值" }), make({ parentAsin: "UNKNOWN-P", asin: "UNKNOWN-C", financialProfit: -10000, raw: {}, title: "未知币种原行" }), make({ parentAsin: "REPORTED-P", asin: "", title: "报表父体原行" }), make({ parentAsin: "", asin: "", sku: "UNALLOCATED", title: "未分配原行" }));
    const record: MonthlyFinancialBatchRecord = { id, workspaceId: request.expectedWorkspaceId, userId: options.userId ?? 7, status: "completed", fileName: options.label ?? "合成原报表.xlsx", fileHash: "a".repeat(64), totalRows: rows.length, skippedRows: 0, unallocatedRows: rows.filter(row => !row.parentAsin).length, months: [month], createdAt: "2026-10-17 01:02:03.000000", confirmedAt: "2026-10-17 02:03:04.000000", fileReferenceKind: "storage", payload: rows };
    const parsed = parseMonthlyFinancialBatch(record);
    return { month, metadataVisibility: options.scoped ? "scoped" : "full", selection: { selected: parsed, scannedBatchIds: [id], complete: true }, ...(options.scoped ? { authorizedRowRefs: parsed.rows.map(({ batchId, rowIndex }) => ({ batchId, rowIndex })) } : {}) };
  });
  return buildProductBoardReadResult({ identity: { userId: options.userId ?? 7, workspaceId: request.expectedWorkspaceId }, input: request, selections, history: { complete: true, scannedCount: options.empty ? 0 : months.length, visibility: options.scoped ? "scoped" : "full" } });
}
function fillScope() { fireEvent.change(screen.getByLabelText("产品看板基准月份（YYYY-MM）"), { target: { value: "2026-10" } }); fireEvent.change(screen.getByLabelText("产品看板店铺"), { target: { value: "合成店铺" } }); fireEvent.change(screen.getByLabelText("产品看板站点 / 国家代码"), { target: { value: "美国" } }); }
const readButton = () => screen.getByRole("button", { name: "读取已有产品看板" });
async function readReady() { fireEvent.click(readButton()); await screen.findByRole("region", { name: "产品看板完整历史来源" }); }
function openProduct(parent = "P00") { fireEvent.click(within(screen.getByRole("region", { name: "全部产品" })).getByRole("button", { name: `展开 ${parent} 全部子体与原行` })); return within(screen.getByRole("region", { name: "产品完整钻取" })); }
beforeEach(() => { controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }; controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true); controls.query.mockReset(); });
afterEach(cleanup);

describe("product board profit workflow integration", () => {
  it.each([
    ["P00", "USD", "child_rows"], ["CAD-P", "CAD", "child_rows"],
    ["REPORTED-P", "USD", "reported_parent_row"], ["UNKNOWN-P", null, "child_rows"],
  ] as const)("passes the exact verified identity, currency and basis for %s only after expansion", async (parentAsin, currency, basis) => {
    controls.query.mockImplementation(async request => result(request, { kinds: true }));
    render(<ProductBoardReadOnly />); fillScope();
    fireEvent.change(screen.getByLabelText("产品看板父 ASIN（可选）"), { target: { value: parentAsin } });
    await readReady(); expect(screen.queryByLabelText("已核来源利润流程")).not.toBeInTheDocument();
    const all = within(screen.getByRole("region", { name: "全部产品" }));
    fireEvent.click(all.getAllByRole("button", { name: `展开 ${parentAsin} 全部子体与原行` })[0]);
    expect(JSON.parse(screen.getByLabelText("已核来源利润流程").textContent!)).toEqual({
      identity: { userId: 7, workspaceId: 11 }, scope: { storeName: "合成店铺", country: "US", parentAsin, currency, basis }, months: profitBoardMonths("2026-10"),
    });
    expect(screen.getByRole("region", { name: "产品完整历史月报" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("产品看板店铺"), { target: { value: "另一店铺" } });
    expect(screen.queryByLabelText("已核来源利润流程")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "产品完整历史月报" })).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("retains every earlier month in the expanded product while the workflow gets six quick-month entries", async () => {
    controls.query.mockImplementation(async request => result(request, { longHistory: true, groups: 1, children: 1 }));
    render(<ProductBoardReadOnly />); fillScope(); await readReady(); openProduct();
    const history = within(screen.getByRole("region", { name: "产品完整历史月报" }));
    const monthly = within(history.getByRole("region", { name: "父体全部历史月报" }));
    expect(monthly.getAllByRole("columnheader")).toHaveLength(20);
    expect(monthly.queryByText("2024-01")).not.toBeInTheDocument();
    fireEvent.click(history.getAllByRole("button", { name: "月表下一页" })[0]);
    expect(monthly.getByText("2024-01")).toBeInTheDocument();
    fireEvent.click(monthly.getByRole("button", { name: "2024-01 查看本月全部来源" }));
    expect(screen.getByRole("region", { name: "父体全部历史月报 2024-01 来源完整明细" })).toHaveTextContent("批次 100 / 原行索引 0");
    expect(JSON.parse(screen.getByLabelText("已核来源利润流程").textContent!).months).toEqual(profitBoardMonths("2026-10"));
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("keeps unallocated originals inspectable without inventing a profit workflow scope", async () => {
    controls.query.mockImplementation(async request => result(request, { groups: 0, kinds: true }));
    render(<ProductBoardReadOnly />); fillScope(); await readReady();
    const all = within(screen.getByRole("region", { name: "全部产品" }));
    for (const toggle of all.getAllByRole("button", { name: "展开 未分配原行 全部子体与原行" })) fireEvent.click(toggle);
    expect(all.getAllByRole("region", { name: "产品完整钻取" })).toHaveLength(3);
    expect(screen.queryByLabelText("已核来源利润流程")).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
});

describe("explicit readonly product board gates", () => {
  it("refreshes the opened exact product scope on commit and not on upload or foreign notices", async () => {
    controls.query.mockImplementation(async value => result(value)); render(<ProductBoardReadOnly />);
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "confirm", batchId: 80 }));
    expect(controls.query).not.toHaveBeenCalled(); fillScope(); await readReady();
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 12, action: "confirm", batchId: 80 }));
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "upload", batchId: 80 }));
    expect(controls.query).toHaveBeenCalledTimes(1);
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "confirm", batchId: 80 }));
    await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(2));
    expect(controls.query.mock.calls[1][0]).toEqual(input()); expect(screen.getByLabelText("产品看板店铺")).toHaveValue("合成店铺");
    fireEvent.change(screen.getByLabelText("产品看板店铺"), { target: { value: "New draft scope" } });
    act(() => publishMonthlyFinancialChange({ userId: 7, workspaceId: 11, action: "revoke", batchId: 80 }));
    expect(controls.query).toHaveBeenCalledTimes(2);
  });
  it("mounts a separately authorized task reader only for an expanded exact product and clears it on scope edits", async () => {
    controls.query.mockResolvedValue(result()); render(<ProductBoardReadOnly />); fillScope(); await readReady();
    expect(screen.queryByLabelText("精确产品任务入口")).not.toBeInTheDocument();
    openProduct();
    expect(screen.getByLabelText("精确产品任务入口")).toHaveTextContent(JSON.stringify({ workspaceId: 11, storeName: "合成店铺", country: "US", parentAsin: "P00" }));
    fireEvent.change(screen.getByLabelText("产品看板站点 / 国家代码"), { target: { value: "CA" } });
    expect(screen.queryByLabelText("精确产品任务入口")).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it("never invents an exact task product for unallocated originals", () => {
    const tasks = vi.fn(() => <p>任务入口</p>);
    render(<ProductBoardReadOnlyContent result={result(input(), { kinds: true })} renderProductTasks={tasks} />);
    const board = within(screen.getByRole("region", { name: "全部产品" }));
    for (const toggle of board.getAllByRole("button", { name: "展开 未分配原行 全部子体与原行" })) fireEvent.click(toggle);
    expect(tasks).not.toHaveBeenCalled();
  });
  it("does no automatic read and excludes private controls from the debug collector", () => { const view = render(<ProductBoardReadOnly />); expect(controls.query).not.toHaveBeenCalled(); expect(view.container.firstElementChild).toHaveClass("manus-no-record"); expect(controls.permissions.canRead).toHaveBeenCalledWith("ops", "ops_data_import"); expect(screen.queryByRole("button", { name: /上传|保存|同步|AI|归档|下载/ })).not.toBeInTheDocument(); });
  it.each([
    ["auth pending", () => { controls.auth.loading = true; }], ["auth error", () => { controls.auth.error = new Error("private-error"); }], ["logout", () => { controls.auth.user = null; }], ["invalid id", () => { controls.auth.user!.id = 0; }], ["null workspace", () => { controls.auth.user!.defaultWorkspaceId = null; }], ["missing workspace", () => { controls.auth.user!.defaultWorkspaceId = undefined; }], ["negative workspace", () => { controls.auth.user!.defaultWorkspaceId = -1; }], ["empty role", () => { controls.auth.user!.role = ""; }], ["permission pending", () => { controls.permissions.isLoading = true; }], ["permission denied", () => { controls.permissions.canRead.mockReturnValue(false); }],
  ] as const)("does not mount private reader: %s", (_label, arrange) => { arrange(); render(<ProductBoardReadOnly />); expect(controls.query).not.toHaveBeenCalled(); expect(screen.queryByRole("button", { name: "读取已有产品看板" })).not.toBeInTheDocument(); expect(screen.queryByText("private-error")).not.toBeInTheDocument(); });
  it("rejects incomplete input without I/O", () => { render(<ProductBoardReadOnly />); fireEvent.click(readButton()); expect(controls.query).not.toHaveBeenCalled(); expect(screen.getByRole("alert")).toHaveTextContent("未发送请求"); });
  it.each(["admin", "ops_manager", "ops_specialist"])("uses canonical explicit input and scoped transport for %s", async role => { controls.auth.user!.role = role; controls.query.mockImplementation(async request => result(request, { scoped: role === "ops_specialist" })); render(<ProductBoardReadOnly />); fillScope(); await readReady(); expect(controls.query.mock.calls[0][0]).toEqual(input()); expect(controls.query.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal); });
});

describe("complete product rankings and source drilldown", () => {
  it("mounts the optional exact-product cost entry only inside the expanded product row", () => {
    const costEntry = vi.fn(product => <div>成本入口 {product.parentAsin}</div>);
    render(<ProductBoardReadOnlyContent result={result()} renderProductCosts={costEntry} />);
    expect(costEntry).not.toHaveBeenCalled(); openProduct();
    expect(screen.getByText("成本入口 P00")).toBeInTheDocument();
    expect(costEntry).toHaveBeenCalledWith(expect.objectContaining({ parentAsin: "P00" }));
    expect(controls.query).not.toHaveBeenCalled();
  });
  it.each([["高退货率产品", "P00"], ["高利润产品", "P00"], ["亏损产品", "P01"], ["全部产品", "P00"]] as const)("%s expands and collapses complete detail immediately after its own parent row", (section, parent) => {
    render(<ProductBoardReadOnlyContent result={result()} />); const board = within(screen.getByRole("region", { name: section }));
    const toggle = board.getByRole("button", { name: `展开 ${parent} 全部子体与原行` }), row = toggle.closest("tr")!;
    expect(toggle).toHaveAttribute("aria-expanded", "false"); fireEvent.click(toggle);
    const detail = board.getByRole("region", { name: "产品完整钻取" });
    expect(row.nextElementSibling).toContainElement(detail);
    expect(document.getElementById(toggle.getAttribute("aria-controls")!)).toContainElement(detail);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(within(detail).getByRole("heading", { name: /全部来源原行/ })).toBeInTheDocument();
    fireEvent.click(board.getByRole("button", { name: `收起 ${parent} 全部子体与原行` }));
    expect(board.queryByRole("region", { name: "产品完整钻取" })).not.toBeInTheDocument();
  });
  it.each([["高退货率产品", "近三个日历月 退货率"], ["全部产品", "财务利润"]] as const)("%s numeric cells toggle the same inline detail", (section, metric) => {
    render(<ProductBoardReadOnlyContent result={result()} />); const board = within(screen.getByRole("region", { name: section }));
    fireEvent.click(board.getByRole("button", { name: `P00 ${metric} 展开子体与原行` }));
    expect(board.getByRole("button", { name: "收起 P00 全部子体与原行" })).toHaveAttribute("aria-expanded", "true");
    expect(board.getByRole("region", { name: "产品完整钻取" })).toBeInTheDocument();
    fireEvent.click(board.getByRole("button", { name: `P00 ${metric} 收起子体与原行` }));
    expect(board.queryByRole("region", { name: "产品完整钻取" })).not.toBeInTheDocument();
  });
  it("keeps expansions independent across boards and resets child paging when a row is collapsed", () => {
    render(<ProductBoardReadOnlyContent result={result(input(), { children: 22 })} />);
    const profits = within(screen.getByRole("region", { name: "高利润产品" })), all = within(screen.getByRole("region", { name: "全部产品" }));
    fireEvent.click(profits.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    fireEvent.click(all.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    expect(screen.getAllByRole("region", { name: "产品完整钻取" })).toHaveLength(2);
    fireEvent.click(all.getByRole("button", { name: "产品子体下一页" }));
    expect(all.getByRole("region", { name: "C0-21 三窗口完整指标" })).toBeInTheDocument();
    fireEvent.click(all.getByRole("button", { name: "收起 P00 全部子体与原行" }));
    expect(profits.getByRole("region", { name: "产品完整钻取" })).toBeInTheDocument();
    fireEvent.click(all.getByRole("button", { name: "展开 P00 全部子体与原行" }));
    expect(all.queryByRole("region", { name: "C0-21 三窗口完整指标" })).not.toBeInTheDocument();
    expect(all.getByRole("region", { name: "C0-00 三窗口完整指标" })).toBeInTheDocument();
  });
  it("emphasizes negative parent and child profit/proxy values without changing signed amounts", () => {
    render(<ProductBoardReadOnlyContent result={result()} />); const losses = within(screen.getByRole("region", { name: "亏损产品" }));
    const profit = losses.getByRole("button", { name: "P01 财务利润 展开子体与原行" }), proxy = losses.getByRole("button", { name: "P01 派生额（非实际回款） 展开子体与原行" });
    expect(profit).toHaveTextContent("-100.00 USD"); expect(profit.closest("td")).toHaveClass("text-red-700");
    expect(proxy).toHaveTextContent("-250.00 USD"); expect(proxy.closest("td")).toHaveClass("text-red-700"); expect(proxy.closest("tr")).toHaveClass("bg-red-50");
    fireEvent.click(profit);
    const childFinancial = within(losses.getByRole("region", { name: "C1-00 当月完整财务" }));
    const childCells = childFinancial.getAllByRole("cell");
    expect(childCells[2]).toHaveTextContent("-100.00 USD"); expect(childCells[2]).toHaveClass("text-red-700");
    expect(childCells[4]).toHaveTextContent("-100.00 USD"); expect(childCells[4]).not.toHaveClass("text-red-700");
    expect(childFinancial.getByRole("cell", { name: /^-250.00 USD/ })).toHaveClass("text-red-700");
    const detailRates = within(losses.getByRole("region", { name: "C1-00 三窗口完整指标" }));
    expect(detailRates.getAllByRole("cell", { name: "-300.00 USD" }).every(cell => cell.classList.contains("text-red-700"))).toBe(true);
  });
  it("does not mark positive or unknown profit/proxy as negative", () => {
    const view = render(<ProductBoardReadOnlyContent result={result()} />);
    let all = within(screen.getByRole("region", { name: "全部产品" }));
    expect(all.getByRole("button", { name: "P00 财务利润 展开子体与原行" }).closest("td")).not.toHaveClass("text-red-700");
    expect(all.getByRole("button", { name: "P00 派生额（非实际回款） 展开子体与原行" }).closest("tr")).not.toHaveClass("bg-red-50");
    view.rerender(<ProductBoardReadOnlyContent result={result(input(), { unknown: true })} />); all = within(screen.getByRole("region", { name: "全部产品" }));
    const profit = all.getByRole("button", { name: "P00 财务利润 展开子体与原行" });
    expect(profit).toHaveTextContent("未知"); expect(profit.closest("td")).not.toHaveClass("text-red-700"); expect(profit.closest("tr")).not.toHaveClass("bg-red-50");
  });
  it("bounds each table scroll area and keeps its header sticky for inline drilldowns", () => {
    render(<ProductBoardReadOnlyContent result={result()} />); openProduct();
    for (const name of ["高退货率产品横向表", "高利润产品横向表", "亏损产品横向表", "全部产品横向表", "父体当月完整财务", "父体三窗口完整指标"]) {
      const region = screen.getByRole("region", { name }); expect(region).toHaveClass("max-h-[560px]", "overflow-x-auto", "overflow-y-auto");
      expect(region.querySelector("thead")).toHaveClass("sticky", "top-0", "bg-muted");
    }
  });
  it("shows all four sections, 3 rate windows and full-scope rules without RPC", () => { render(<ProductBoardReadOnlyContent result={result()} />); expect(controls.query).not.toHaveBeenCalled(); for (const name of ["高退货率产品", "高利润产品", "亏损产品", "全部产品"]) expect(screen.getByRole("region", { name })).toBeInTheDocument(); const returns = within(screen.getByRole("region", { name: "高退货率产品横向表" })); for (const prefix of ["当月", "近三个日历月", "全部可见已保存历史"]) for (const metric of ["退货量", "退货率", "退款量", "退款率", "销量", "销售额", "利润", "原行覆盖"]) expect(returns.getByRole("columnheader", { name: `${prefix} ${metric}` })).toBeInTheDocument(); expect(screen.getByText(/当月明确 USD 财务利润 > 1000/)).toBeInTheDocument(); expect(screen.getByText(/各明确币种独立取亏损最多前十/)).toBeInTheDocument(); });
  it("uses actual ratio-of-sums with full numerator/denominator and child detail", () => { const data = result(); render(<ProductBoardReadOnlyContent result={data} />); const detail = openProduct(); expect(detail.getByRole("heading", { name: "全部子体（2 个）" })).toBeInTheDocument(); expect(detail.getByRole("region", { name: "C0-01 三窗口完整指标" })).toBeInTheDocument(); expect(detail.getAllByText("退货率 = 24 / 180").length).toBeGreaterThan(0); expect(detail.getAllByText("退款率 = 12 / 180").length).toBeGreaterThan(0); expect(detail.getAllByText(/不是回款、到账或现金流/).length).toBeGreaterThan(0); expect(detail.getAllByText(/"原始费用": -10/).length).toBeGreaterThan(0); expect(detail.getAllByText(/"numerator"/).length).toBeGreaterThan(0); });
  it("keeps every child and raw row reachable with local 20-row paging", () => { render(<ProductBoardReadOnlyContent result={result(input(), { children: 22 })} />); const detail = openProduct(); expect(detail.queryByRole("region", { name: "C0-20 三窗口完整指标" })).not.toBeInTheDocument(); fireEvent.click(detail.getByRole("button", { name: "产品子体下一页" })); expect(detail.getByRole("region", { name: "C0-21 三窗口完整指标" })).toBeInTheDocument(); expect(detail.getByRole("button", { name: "产品子体下一页" })).toBeDisabled(); for (let i = 0; i < 3; i++) fireEvent.click(detail.getByRole("button", { name: "产品来源原行下一页" })); expect(detail.getByText("批次 102 原行 21 完整费用 / 原文")).toBeInTheDocument(); expect(detail.getByRole("button", { name: "产品来源原行下一页" })).toBeDisabled(); });
  it("retains missing month coverage instead of treating workspace months as product history", () => { render(<ProductBoardReadOnlyContent result={result(input(), { missingMonth: "2026-09" })} />); const detail = openProduct(); expect(detail.getAllByText(/有原行 2 \/ 3 个月 · 覆盖不完整/).length).toBeGreaterThan(0); expect(detail.getAllByText(/"missingMonths": \[\s*"2026-09"/).length).toBeGreaterThan(0); expect(screen.getByText("2026-09 · 缺月度来源")).toBeInTheDocument(); });
  it("all history is not shortened to 3/6 months and month sources stay reachable", () => { const data = result(input(), { longHistory: true }); render(<ProductBoardReadOnlyContent result={data} />); expect(screen.getByText(/2024-01 至 2026-10 · 34 个日历月/)).toBeInTheDocument(); expect(screen.queryByText("2026-10 · 来源批次 103")).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "历史月份来源下一页" })); expect(screen.getByText("2026-10 · 来源批次 103")).toBeInTheDocument(); });
  it("keeps zero/negative and unknown denominator distinct", () => { render(<ProductBoardReadOnlyContent result={result(input(), { zero: true })} />); const detail = openProduct(); expect(detail.getAllByText("0.00 USD").length).toBeGreaterThan(0); expect(detail.getAllByText("未知 / 分母不可用").length).toBeGreaterThan(0); expect(screen.getAllByText("-100.00 USD").length).toBeGreaterThan(0); expect(detail.getAllByText("-200.00 USD").length).toBeGreaterThan(0); });
  it("does not turn unknown profit into zero", () => { render(<ProductBoardReadOnlyContent result={result(input(), { unknown: true })} />); const detail = openProduct(); expect(detail.getAllByText("未知").length).toBeGreaterThan(0); expect(within(screen.getByRole("region", { name: "高利润产品" })).queryByRole("table")).not.toBeInTheDocument(); });
  it("separates known/unknown currencies, original parent and unallocated basis", () => { render(<ProductBoardReadOnlyContent result={result(input(), { kinds: true })} />); const profits = within(screen.getByRole("region", { name: "高利润产品" })); expect(profits.queryByText(/欧元高额不套美元阈值/)).not.toBeInTheDocument(); const losses = within(screen.getByRole("region", { name: "亏损产品" })); expect(losses.getByRole("cell", { name: /^CAD\s*子体原行汇总/ })).toBeInTheDocument(); expect(losses.queryByText(/未知币种原行/)).not.toBeInTheDocument(); const all = within(screen.getByRole("region", { name: "全部产品" })); expect(all.getByRole("cell", { name: /原报表父体合计（独立）/ })).toBeInTheDocument(); expect(all.getAllByRole("cell", { name: /未分配 \/ 歧义原行（独立）/ })).toHaveLength(3); expect(all.getAllByRole("cell", { name: /^币种未知/ }).length).toBeGreaterThan(0); });
  it("search matches one child but retains the whole parent", () => { render(<ProductBoardReadOnlyContent result={result(input({ search: "SKU0-01" }))} />); const detail = openProduct(); expect(detail.getByRole("region", { name: "C0-00 三窗口完整指标" })).toBeInTheDocument(); expect(detail.getByRole("heading", { name: "全部来源原行（6 行）" })).toBeInTheDocument(); });
  it("keeps four independent section pages and union-based complete products", () => { const data = result(input({ pageSize: 1 }), { groups: 15 }), onPage = vi.fn(); render(<ProductBoardReadOnlyContent result={data} onPage={onPage} />); for (const [name, section] of [["高退货率产品", "highReturns"], ["高利润产品", "highProfit"], ["全部产品", "all"]] as const) { fireEvent.click(screen.getByRole("button", { name: `${name}下一页` })); expect(onPage).toHaveBeenLastCalledWith(section, 1); } expect(data.products.length).toBeGreaterThan(1); expect(screen.getByText(/四页并集返回/)).toBeInTheDocument(); });
  it("shows scoped history without full file metadata or assuming UTC", () => { render(<ProductBoardReadOnlyContent result={result(input(), { scoped: true })} />); expect(screen.queryByText(/合成原报表.xlsx/)).not.toBeInTheDocument(); expect(screen.getAllByText(/未返回整批名称、哈希/)).toHaveLength(3); expect(screen.getAllByText(/时区未声明/)).toHaveLength(3); expect(screen.getByText(/不披露跨范围扫描数量/)).toBeInTheDocument(); });
  it("source strings are escaped and tables scroll inside the section", () => { render(<ProductBoardReadOnlyContent result={result(input(), { label: "<script>bad()</script> https://example.test/file" })} />); openProduct(); expect(screen.queryByRole("link")).not.toBeInTheDocument(); expect(document.querySelector("script")).toBeNull(); expect(document.querySelector("img[src=x]")).toBeNull(); expect(screen.getByRole("region", { name: "高退货率产品横向表" })).toHaveClass("overflow-x-auto"); expect(screen.getByRole("region", { name: "父体三窗口完整指标" })).toHaveAttribute("tabindex", "0"); });
  it.each(["missing", "not_found", "invalid"] as const)("distinguishes %s and never renders partial sources", status => { render(<ProductBoardReadOnlyContent result={buildProductBoardReadFailure({ identity: { userId: 7, workspaceId: 11 }, input: input(), status, reasonCode: "safe_reason", missingReason: "安全状态说明" })} />); expect(screen.queryByRole("region", { name: "全部产品" })).not.toBeInTheDocument(); expect(screen.getByText("安全状态说明")).toBeInTheDocument(); });
  it("ready empty visible history does not claim zero quantities or archived data", () => { render(<ProductBoardReadOnlyContent result={result(input(), { empty: true, scoped: true })} />); expect(screen.getByText(/没有可见原行（不能解释为零）/)).toBeInTheDocument(); expect(screen.getAllByText(/没有符合本页条件/)).toHaveLength(4); expect(screen.queryByRole("table")).not.toBeInTheDocument(); });
});

describe("identity, request and pagination isolation", () => {
  it.each(["基准月份（YYYY-MM）", "店铺", "站点 / 国家代码", "父 ASIN（可选）", "产品搜索（保留完整父组）"])("editing displayed scope %s immediately removes all results without another read", async label => {
    controls.query.mockResolvedValue(result()); render(<ProductBoardReadOnly />); fillScope(); await readReady(); openProduct();
    fireEvent.change(screen.getByLabelText(`产品看板${label}`), { target: { value: "changed" } });
    expect(screen.queryByRole("region", { name: "全部产品" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "产品完整钻取" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "产品看板完整历史来源" })).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
  });
  it.each(["user", "workspace", "role", "logout", "invalid workspace", "auth pending", "auth error", "permission pending", "permission denied"])("displayed data disappears on %s without starting a replacement request", async kind => {
    controls.query.mockResolvedValue(result()); const view = render(<ProductBoardReadOnly />); fillScope(); await readReady(); openProduct();
    if (kind === "user") controls.auth.user!.id = 8;
    if (kind === "workspace") controls.auth.user!.defaultWorkspaceId = 12;
    if (kind === "role") controls.auth.user!.role = "ops_specialist";
    if (kind === "logout") controls.auth.user = null;
    if (kind === "invalid workspace") controls.auth.user!.defaultWorkspaceId = null;
    if (kind === "auth pending") controls.auth.loading = true;
    if (kind === "auth error") controls.auth.error = new Error("private-auth-error");
    if (kind === "permission pending") controls.permissions.isLoading = true;
    if (kind === "permission denied") controls.permissions.canRead.mockReturnValue(false);
    view.rerender(<ProductBoardReadOnly />);
    expect(screen.queryByRole("region", { name: "全部产品" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "产品完整钻取" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "产品看板完整历史来源" })).not.toBeInTheDocument();
    expect(screen.queryByText("private-auth-error")).not.toBeInTheDocument();
    expect(controls.query).toHaveBeenCalledTimes(1);
    if (["user", "workspace", "role"].includes(kind)) expect(screen.getByLabelText("产品看板店铺")).toHaveValue("");
  });
  it.each(["基准月份（YYYY-MM）", "店铺", "站点 / 国家代码", "父 ASIN（可选）", "产品搜索（保留完整父组）"])("input %s clears and ignores pending old data", async label => { const pending = deferred<ProductBoardReadResult>(); controls.query.mockReturnValue(pending.promise); render(<ProductBoardReadOnly />); fillScope(); fireEvent.click(readButton()); const signal = controls.query.mock.calls[0][1].signal; fireEvent.change(screen.getByLabelText(`产品看板${label}`), { target: { value: "changed" } }); expect(signal.aborted).toBe(true); await act(async () => pending.resolve(result())); expect(screen.queryByRole("region", { name: "全部产品" })).not.toBeInTheDocument(); });
  it.each(["user", "workspace", "role", "auth pending", "permission denied"])("%s change destroys old data and callbacks", async kind => { controls.query.mockResolvedValueOnce(result()); const pending = deferred<ProductBoardReadResult>(); const view = render(<ProductBoardReadOnly />); fillScope(); await readReady(); controls.query.mockReturnValueOnce(pending.promise); fireEvent.click(readButton()); const signal = controls.query.mock.calls[1][1].signal; if (kind === "user") controls.auth.user!.id = 8; if (kind === "workspace") controls.auth.user!.defaultWorkspaceId = 12; if (kind === "role") controls.auth.user!.role = "ops_specialist"; if (kind === "auth pending") controls.auth.loading = true; if (kind === "permission denied") controls.permissions.canRead.mockReturnValue(false); view.rerender(<ProductBoardReadOnly />); expect(signal.aborted).toBe(true); await act(async () => pending.resolve(result())); expect(screen.queryByRole("region", { name: "全部产品" })).not.toBeInTheDocument(); });
  it("only last same-owner request wins", async () => { const old = deferred<ProductBoardReadResult>(), latest = deferred<ProductBoardReadResult>(); controls.query.mockReturnValueOnce(old.promise).mockReturnValueOnce(latest.promise); render(<ProductBoardReadOnly />); fillScope(); fireEvent.click(readButton()); fireEvent.click(readButton()); await act(async () => latest.resolve(result(input(), { label: "NEW SOURCE" }))); await act(async () => old.resolve(result(input(), { label: "OLD SECRET" }))); expect(screen.getAllByText(/NEW SOURCE/).length).toBeGreaterThan(0); expect(screen.queryByText(/OLD SECRET/)).not.toBeInTheDocument(); });
  it("cancel and unmount abort pending transport and never repopulate", async () => { const pending = deferred<ProductBoardReadResult>(); controls.query.mockReturnValue(pending.promise); const view = render(<ProductBoardReadOnly />); fillScope(); fireEvent.click(readButton()); fireEvent.click(screen.getByRole("button", { name: "取消并清除产品看板" })); expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true); fireEvent.click(readButton()); view.unmount(); expect(controls.query.mock.calls[1][1].signal.aborted).toBe(true); await act(async () => pending.resolve(result())); expect(screen.queryByRole("region", { name: "全部产品" })).not.toBeInTheDocument(); });
  it("query failure clears prior data and hides raw server messages", async () => { controls.query.mockResolvedValueOnce(result()).mockRejectedValueOnce(new Error("password SELECT private")); render(<ProductBoardReadOnly />); fillScope(); await readReady(); fireEvent.click(readButton()); await screen.findByRole("alert"); expect(screen.queryByRole("region", { name: "全部产品" })).not.toBeInTheDocument(); expect(screen.queryByText(/password SELECT/)).not.toBeInTheDocument(); });
  it.each(["user", "workspace", "store", "country", "month", "offset", "history", "source", "duplicate", "raw", "metric", "missingchild"])("rejects mixed or malformed %s response", async kind => { const bad = clone(result()); if (kind === "user") bad.identity.userId = 99; if (kind === "workspace") bad.identity.workspaceId = 99; if (kind === "store") bad.request.storeName = "FOREIGN"; if (kind === "country") bad.request.country = "CA"; if (kind === "month") bad.request.month = "2026-09"; if (kind === "offset") bad.request.allOffset = 10; if (kind === "history") (bad.history as unknown as { complete: boolean }).complete = false; if (kind === "source") bad.sources[0].selectedBatchId = 999; if (kind === "duplicate") bad.products.push(bad.products[0]); if (kind === "raw") bad.pageRows[0].storeName = "OTHER"; if (kind === "metric") bad.products[0].financial.profit = 777; if (kind === "missingchild") bad.products[0].children = []; controls.query.mockResolvedValue(bad); render(<ProductBoardReadOnly />); fillScope(); fireEvent.click(readButton()); await screen.findByRole("alert"); expect(screen.queryByRole("region", { name: "全部产品" })).not.toBeInTheDocument(); });
  it("ordinary user rejects even own-uploader full metadata", async () => { controls.auth.user!.role = "ops_specialist"; controls.query.mockResolvedValue(result()); render(<ProductBoardReadOnly />); fillScope(); fireEvent.click(readButton()); await screen.findByRole("alert"); expect(screen.queryByText(/合成原报表/)).not.toBeInTheDocument(); });
  it("four offsets stay independent and paging uses a fresh read", async () => { controls.query.mockImplementation(async request => result(request, { groups: 22 })); render(<ProductBoardReadOnly />); fillScope(); await readReady(); fireEvent.click(screen.getByRole("button", { name: "全部产品下一页" })); await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(2)); await screen.findByRole("region", { name: "全部产品" }); expect(controls.query.mock.calls[1][0]).toEqual(input({ allOffset: 10 })); fireEvent.click(screen.getByRole("button", { name: "高利润产品下一页" })); await waitFor(() => expect(controls.query).toHaveBeenCalledTimes(3)); await screen.findByRole("region", { name: "全部产品" }); expect(controls.query.mock.calls[2][0]).toEqual(input({ allOffset: 10, highProfitOffset: 10 })); });
  it.each(["source", "period", "statistics"])("changed %s during pagination fails without stitching old pages", async kind => { controls.query.mockImplementationOnce(async request => result(request, { groups: 22 })).mockImplementationOnce(async request => result(request, { groups: kind === "statistics" ? 23 : 22, sourceOffset: kind === "source" ? 10 : 0, longHistory: kind === "period" })); render(<ProductBoardReadOnly />); fillScope(); await readReady(); fireEvent.click(screen.getByRole("button", { name: "全部产品下一页" })); await screen.findByRole("alert"); expect(screen.queryByRole("region", { name: "全部产品" })).not.toBeInTheDocument(); });
});
