// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ProductMonthlyFinancialDialog, { defaultProductFinancialMonth, type ProductMonthlyFinancialTarget } from "./ProductMonthlyFinancialDialog";
import { ProductFinancialHistory } from "./ProductFinancialHistory";
import { publishMonthlyFinancialChange } from "./monthlyFinancialWriteEvents";
import { ProductBoardReadInputSchema, buildProductBoardReadResult, type ProductBoardReadInput, type ProductBoardReadResult } from "@shared/productBoardRead";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "@shared/monthlyFinancialRead";
import { profitBoardMonths } from "@shared/profitBoardRead";

const controls = vi.hoisted(() => ({ auth: { loading: false, error: null as Error | null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } as { id: number; defaultWorkspaceId: number | null; role: string } | null }, permissions: { isLoading: false, canRead: vi.fn() }, query: vi.fn() }));
vi.mock("@/_core/hooks/useAuth", () => ({ useAuth: () => controls.auth }));
vi.mock("@/hooks/usePermissions", () => ({ usePermissions: () => controls.permissions }));
vi.mock("@/lib/trpc", () => ({ trpc: { useUtils: () => ({ client: { productBoardRead: { get: { query: controls.query } } } }) } }));
vi.mock("./ProfitAnalysisWorkflow", () => ({ default: (props: unknown) => <section aria-label="独立利润分析流程">{JSON.stringify(props)}</section> }));
const target: ProductMonthlyFinancialTarget = { identity: { userId: 7, workspaceId: 11 }, storeName: "合成店铺", country: "US", parentAsin: "SYNTHETIC-P" };
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function input(patch: Partial<ProductBoardReadInput> = {}) { return ProductBoardReadInputSchema.parse({ expectedWorkspaceId: 11, month: "2026-10", storeName: target.storeName, country: "US", parentAsin: target.parentAsin, search: "", highReturnsOffset: 0, highProfitOffset: 0, losingOffset: 0, allOffset: 0, pageSize: 10, ...patch }); }
function fixture(request = input(), options: { months?: string[]; children?: number; currencies?: string[]; scoped?: boolean; sourceOffset?: number; parentOnly?: boolean } = {}): ProductBoardReadResult {
  const months = options.months ?? ["2025-01", "2026-09", "2026-10"].filter(month => month <= request.month);
  const selections = months.map((month, index) => {
    const rows = (options.currencies ?? ["CAD"]).flatMap(currency => Array.from({ length: options.children ?? 2 }, (_, child) => ({ ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])),
      yearMonth: month, parentAsin: request.parentAsin, asin: options.parentOnly ? "" : `C${child}`, sku: `SKU${currency}${child}`, title: `合成子体${child}`, storeName: request.storeName, site: request.country, operator: "合成名称不授权", financialProfit: child ? -10 : 123, salesQty: 10, salesAmount: 400, purchaseCost: -20, raw: { currency, sourceText: "<img src=x onerror=alert(1)>" },
    })));
    const record: MonthlyFinancialBatchRecord = { id: 100 + index + (options.sourceOffset ?? 0), workspaceId: request.expectedWorkspaceId, userId: 7, status: "completed", fileName: "synthetic.xlsx", fileHash: "a".repeat(64), totalRows: rows.length, skippedRows: 0, unallocatedRows: 0, months: [month], createdAt: "2026-10-17 01:02:03.000000", confirmedAt: "2026-10-17 02:03:04.000000", fileReferenceKind: "storage", payload: rows };
    const selected = parseMonthlyFinancialBatch(record);
    return { month, metadataVisibility: options.scoped ? "scoped" as const : "full" as const, selection: { selected, complete: true, scannedBatchIds: [record.id] }, ...(options.scoped ? { authorizedRowRefs: selected.rows.map(({ batchId, rowIndex }) => ({ batchId, rowIndex })) } : {}) };
  });
  return buildProductBoardReadResult({ identity: { userId: 7, workspaceId: request.expectedWorkspaceId }, input: request, selections, history: { complete: true, scannedCount: selections.length, visibility: options.scoped ? "scoped" : "full" } });
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function mount(value: ProductMonthlyFinancialTarget | null = target) { return render(<ProductMonthlyFinancialDialog target={value} onClose={vi.fn()} />); }
async function read() { fireEvent.change(screen.getByLabelText("产品月报截至月份"), { target: { value: "2026-10" } }); fireEvent.click(screen.getByRole("button", { name: "读取完整历史月报" })); await screen.findByRole("region", { name: "产品完整历史月报" }); }
beforeEach(() => { controls.auth = { loading: false, error: null, user: { id: 7, defaultWorkspaceId: 11, role: "admin" } }; controls.permissions.isLoading = false; controls.permissions.canRead.mockReset().mockReturnValue(true); controls.query.mockReset().mockImplementation(async request => fixture(request)); });
afterEach(cleanup);

describe("friend monthly product entry and explicit confirmed sources", () => {
  it.each([["2026-10-15T15:59:59Z", "2026-08"], ["2026-10-15T16:00:00Z", "2026-09"], ["2026-01-01T00:00:00Z", "2025-11"], ["2026-01-16T00:00:00Z", "2025-12"]])("uses Shanghai 16th cutoff, %s", (date, expected) => { expect(defaultProductFinancialMonth(new Date(date))).toBe(expected); });
  it("rejects invalid dates", () => { expect(() => defaultProductFinancialMonth(new Date("bad"))).toThrow("INVALID_CALENDAR"); });
  it("does no read while closed or merely opened; never invokes model or old hand-maintained fields", () => { const ui = mount(null); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); ui.rerender(<ProductMonthlyFinancialDialog target={target} onClose={vi.fn()} />); expect(screen.getByRole("dialog")).toHaveClass("manus-no-record"); expect(controls.query).not.toHaveBeenCalled(); });
  it.each(["auth loading", "auth error", "logout", "other user", "other workspace", "permissions loading", "denied"])("hides private reader for %s", change => {
    if (change === "auth loading") controls.auth.loading = true; if (change === "auth error") controls.auth.error = new Error("PRIVATE_AUTH_BODY"); if (change === "logout") controls.auth.user = null;
    if (change === "other user") controls.auth.user!.id = 8; if (change === "other workspace") controls.auth.user!.defaultWorkspaceId = 12; if (change === "permissions loading") controls.permissions.isLoading = true; if (change === "denied") controls.permissions.canRead.mockReturnValue(false);
    mount(); expect(screen.queryByRole("button", { name: "读取完整历史月报" })).not.toBeInTheDocument(); expect(controls.query).not.toHaveBeenCalled(); expect(screen.queryByText("PRIVATE_AUTH_BODY")).not.toBeInTheDocument();
  });
  it("reads exact scoped history, not manual profit; preserves non-USD scope and six-month workflow entry", async () => {
    mount(); await read(); expect(controls.query.mock.calls[0][0]).toEqual(input()); expect(controls.query.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    expect(screen.getByRole("region", { name: "独立利润分析流程" })).toHaveTextContent(JSON.stringify({ identity: target.identity, scope: { storeName: target.storeName, country: "US", parentAsin: target.parentAsin, currency: "CAD", basis: "child_rows" }, months: profitBoardMonths("2026-10") }));
    fireEvent.click(screen.getAllByRole("button", { name: "月表下一页" })[0]);
    expect(screen.getAllByText(/2025-01/).length).toBeGreaterThan(0); expect(screen.getByText(/不是只展示最近六个月/)).toBeInTheDocument();
  });
  it("ordinary user accepts only scoped source metadata", async () => { controls.auth.user!.role = "ops_specialist"; controls.query.mockImplementation(async request => fixture(request, { scoped: true })); mount(); await read(); expect(screen.getByRole("region", { name: "独立利润分析流程" })).toBeInTheDocument(); });
  it("ordinary user rejects full cross-range source metadata", async () => { controls.auth.user!.role = "ops_specialist"; mount(); fireEvent.click(screen.getByRole("button", { name: "读取完整历史月报" })); await screen.findByText(/月报读取失败/); expect(screen.queryByRole("region", { name: "产品完整历史月报" })).not.toBeInTheDocument(); });
  it.each(["user", "workspace", "scope", "partial"])("rejects mismatched or incomplete %s response", async mode => {
    controls.query.mockImplementation(async request => { const value = clone(fixture(request)); if (mode === "user") value.identity.userId++; if (mode === "workspace") value.identity.workspaceId++; if (mode === "scope") value.request.country = "CA"; if (mode === "partial") value.pageRows.pop(); return value; });
    mount(); fireEvent.click(screen.getByRole("button", { name: "读取完整历史月报" })); await screen.findByText(/月报读取失败/); expect(screen.queryByRole("region", { name: "独立利润分析流程" })).not.toBeInTheDocument();
  });
  it("cancels old month and ignores late responses", async () => { const pending = deferred<ProductBoardReadResult>(); controls.query.mockReturnValue(pending.promise); mount(); fireEvent.click(screen.getByRole("button", { name: "读取完整历史月报" })); const request = controls.query.mock.calls[0][0]; fireEvent.change(screen.getByLabelText("产品月报截至月份"), { target: { value: "2025-01" } }); expect(controls.query.mock.calls[0][1].signal.aborted).toBe(true); await act(async () => pending.resolve(fixture(request))); expect(screen.queryByRole("region", { name: "产品完整历史月报" })).not.toBeInTheDocument(); });
  it("clears private history on scope change, close and permission revocation", async () => { const ui = mount(); await read(); ui.rerender(<ProductMonthlyFinancialDialog target={{ ...target, country: "CA" }} onClose={vi.fn()} />); expect(screen.queryByRole("region", { name: "产品完整历史月报" })).not.toBeInTheDocument(); await read(); controls.permissions.canRead.mockReturnValue(false); ui.rerender(<ProductMonthlyFinancialDialog target={target} onClose={vi.fn()} />); expect(screen.queryByRole("region", { name: "独立利润分析流程" })).not.toBeInTheDocument(); ui.rerender(<ProductMonthlyFinancialDialog target={null} onClose={vi.fn()} />); expect(screen.queryByRole("dialog")).not.toBeInTheDocument(); });
  it("source changes from any user in the workspace clear history without invoking analysis", async () => { mount(); await read(); act(() => publishMonthlyFinancialChange({ workspaceId: 12, userId: 8, batchId: 1, action: "confirm" })); expect(screen.getByRole("region", { name: "产品完整历史月报" })).toBeInTheDocument(); act(() => publishMonthlyFinancialChange({ workspaceId: 11, userId: 8, batchId: 1, action: "upload" })); expect(screen.getByRole("region", { name: "产品完整历史月报" })).toBeInTheDocument(); act(() => publishMonthlyFinancialChange({ workspaceId: 11, userId: 8, batchId: 1, action: "confirm" })); expect(screen.queryByRole("region", { name: "产品完整历史月报" })).not.toBeInTheDocument(); expect(controls.query).toHaveBeenCalledTimes(1); });
  it("supports complete currency/basis paging and rejects changing source between pages", async () => {
    const currencies = ["USD", "CAD", "GBP", "EUR", "JPY", "AUD", "MXN", "CNY", "NZD", "CHF", "SEK", "NOK"];
    expect(fixture(input(), { currencies, children: 1 }).sections.all.page.totalProducts).toBe(12);
    controls.query.mockImplementation(async request => fixture(request, { currencies, children: 1 })); mount(); fireEvent.change(screen.getByLabelText("产品月报截至月份"), { target: { value: "2026-10" } }); fireEvent.click(screen.getByRole("button", { name: "读取完整历史月报" })); await waitFor(() => expect(screen.getAllByRole("region", { name: "产品完整历史月报" })).toHaveLength(10));
    fireEvent.click(screen.getByRole("button", { name: "下一页币种及汇总分区" })); await waitFor(() => expect(screen.getAllByRole("region", { name: "产品完整历史月报" })).toHaveLength(2)); expect(controls.query.mock.calls[1][0].allOffset).toBe(10);
    controls.query.mockImplementation(async request => fixture(request, { currencies, children: 1, sourceOffset: 500 })); fireEvent.click(screen.getByRole("button", { name: "上一页币种及汇总分区" })); await screen.findByText(/月报读取失败/); expect(screen.queryByRole("region", { name: "产品完整历史月报" })).not.toBeInTheDocument();
  });
});

describe("all historical months and children stay inspectable", () => {
  it("paginates every supplied historical month, preserving all twenty columns and details", () => {
    const months = Array.from({ length: 24 }, (_, index) => new Date(Date.UTC(2024, 10 + index, 1)).toISOString().slice(0, 7)), value = fixture(input(), { months, children: 1 });
    render(<ProductFinancialHistory product={value.products[0]} rows={value.pageRows} sources={value.sources} />);
    const table = within(screen.getByRole("region", { name: "父体全部历史月报" })); expect(table.getAllByRole("columnheader")).toHaveLength(20); expect(table.getAllByRole("row")).toHaveLength(21);
    const section = within(screen.getByRole("region", { name: "产品完整历史月报" })); fireEvent.click(section.getAllByRole("button", { name: "月表下一页" })[0]); expect(table.getAllByRole("row")).toHaveLength(5); expect(table.getByText("2024-11")).toBeInTheDocument();
    fireEvent.click(table.getByRole("button", { name: "2024-11 查看本月全部来源" })); expect(screen.getByRole("region", { name: "父体全部历史月报 2024-11 来源完整明细" })).toBeInTheDocument(); expect(document.querySelector("img[src=x]")).toBeNull();
  });
  it("paginates all children and never invents child rows for reported parent totals", () => { const value = fixture(input(), { children: 22, months: ["2026-10"] }); const last = value.products[0].children[21]; const label = `${last.asin} · ${last.title} · 完整历史月报`; const ui = render(<ProductFinancialHistory product={value.products[0]} rows={value.pageRows} sources={value.sources} />); expect(screen.queryByText(label)).not.toBeInTheDocument(); fireEvent.click(screen.getByRole("button", { name: "历史子体下一页" })); expect(screen.getByText(label)).toBeInTheDocument(); const parent = fixture(input(), { children: 1, parentOnly: true }); ui.rerender(<ProductFinancialHistory key="parent" product={parent.products[0]} rows={parent.pageRows} sources={parent.sources} />); expect(screen.getByText(/没有可核验子体原行/)).toBeInTheDocument(); });
  it("fails closed on missing historical source rows", () => { const value = fixture(); render(<ProductFinancialHistory product={value.products[0]} rows={value.pageRows.slice(1)} sources={value.sources} />); expect(screen.getByRole("alert")).toHaveTextContent("原行引用不一致"); expect(screen.queryByRole("table")).not.toBeInTheDocument(); });
});
