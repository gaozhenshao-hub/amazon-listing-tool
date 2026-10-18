import { describe, expect, it } from "vitest";
import { buildProductBoardReadFailure, buildProductBoardReadResult, productBoardCalendarMonths, ProductBoardReadError, ProductBoardReadInputSchema, ProductBoardReadResultSchema, PRODUCT_BOARD_SECTIONS, PRODUCT_BOARD_READ_LIMITS, type ProductBoardMonthSelection, type ProductBoardReadInput, type ProductBoardReadResult } from "./productBoardRead";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, findMonthlyFinancialSnapshot, monthlyFinancialJsonBytes, type MonthlyFinancialBatchRecord, type MonthlyFinancialMetrics } from "./monthlyFinancialRead";

const identity = { userId: 7, workspaceId: 11 };
const input: ProductBoardReadInput = { expectedWorkspaceId: 11, month: "2026-10", storeName: "Store", country: "US", search: "", highReturnsOffset: 0, highProfitOffset: 0, losingOffset: 0, allOffset: 0, pageSize: 20 };
function row(values: Record<string, unknown> = {}) { return { yearMonth: "2026-10", storeName: "Store", site: "US", parentAsin: "P", asin: "A", sku: "SKU", title: "Historical title", operator: "Source Owner", ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])) as MonthlyFinancialMetrics, financialProfit: 20, salesAmount: 100, salesQty: 10, raw: { currency: "USD", original: { costs: [-9, null, { value: true }] } }, ...values }; }
function record(rows = [row()], patch: Partial<MonthlyFinancialBatchRecord> = {}): MonthlyFinancialBatchRecord { return { id: 90, workspaceId: 11, userId: 7, status: "completed", fileName: "source.xlsx", fileHash: "a".repeat(64), totalRows: rows.length, skippedRows: 0, unallocatedRows: rows.filter(row => !row.parentAsin).length, months: [...new Set(rows.map(row => row.yearMonth))], createdAt: "2026-10-10 10:00:00.123000", confirmedAt: "2026-10-10 11:00:00.000000", fileReferenceKind: "storage", payload: rows, ...patch }; }
function selections(rows = [row()], scoped = false): ProductBoardMonthSelection[] {
  if (!rows.length) return [];
  const parsed = parseMonthlyFinancialBatch(record(rows));
  return [...new Set(rows.filter(row => row.storeName === input.storeName && ["US", "美国"].includes(row.site)).map(row => row.yearMonth))].sort().map(month => ({ month, selection: { selected: parsed, scannedBatchIds: [90], complete: true }, metadataVisibility: scoped ? "scoped" : "full", ...(scoped ? { authorizedRowRefs: parsed.rows.filter(row => row.yearMonth === month && row.storeName === input.storeName && row.country === "US").map(({ batchId, rowIndex }) => ({ batchId, rowIndex })) } : {}) }));
}
function fromSelections(values: ProductBoardMonthSelection[], patch: Partial<ProductBoardReadInput> = {}, scoped = false, scannedCount = 1) { return buildProductBoardReadResult({ identity, input: { ...input, ...patch }, selections: values, history: { complete: true, scannedCount, visibility: scoped ? "scoped" : "full" } }); }
const build = (rows = [row()], patch: Partial<ProductBoardReadInput> = {}) => fromSelections(selections(rows), patch);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
const parent = (result: ProductBoardReadResult, value = "P") => result.products.find(product => product.parentAsin === value)!;
const entries = (result: ProductBoardReadResult, key: typeof PRODUCT_BOARD_SECTIONS[number]) => result.sections[key].entries.map(entry => result.products.find(product => product.id === entry.productId)!);

describe("complete product board calendar and source contract", () => {
  it("uses three calendar months, including year and leap-year boundaries", () => {
    expect(build([row({ yearMonth: "2026-01" })], { month: "2026-01" }).periods?.quarter.months).toEqual(["2025-11", "2025-12", "2026-01"]);
    expect(build([row({ yearMonth: "2024-03" })], { month: "2024-03" }).periods?.quarter.months).toEqual(["2024-01", "2024-02", "2024-03"]);
  });
  it("keeps all 34 saved calendar months, not just the last six", () => {
    const months = productBoardCalendarMonths("2024-01", "2026-10"), result = build(months.map(yearMonth => row({ yearMonth, salesQty: 1, returnQty: 1, financialProfit: 1 })));
    expect(months).toHaveLength(34); expect(result.sources).toHaveLength(34); expect(result.periods?.total.months).toEqual(months);
    expect(parent(result).rates.total).toMatchObject({ salesQty: 34, returns: 34, profit: 34, coverage: { complete: true, expectedMonths: 34, observedMonths: months } });
    expect(parent(result).rates.quarter.salesQty).toBe(3); expect(result.pageRows).toHaveLength(34);
  });
  it("does not skip gaps between first saved month and current month", () => {
    const result = build([row({ yearMonth: "2024-01", salesQty: 20 }), row({ salesQty: 10 })]);
    expect(parent(result).rates.total).toMatchObject({ status: "partial", salesQty: 30, coverage: { expectedMonths: 34, complete: false, observedMonths: ["2024-01", "2026-10"] } });
    expect(parent(result).rates.total.coverage.missingMonths).toHaveLength(32); expect(parent(result).rates.total.coverage.unavailableMonths).toHaveLength(32);
  });
  it("rejects over-bound all-history spans rather than truncating to recent months", () => {
    expect(productBoardCalendarMonths("1927-01", "2026-12")).toHaveLength(1200);
    expect(() => productBoardCalendarMonths("1926-12", "2026-12")).toThrow(ProductBoardReadError);
    expect(() => build([row({ yearMonth: "1900-01" }), row()])).toThrow(ProductBoardReadError);
  });
  it.each(["2026-00", "2026-13", "0000-01", "2026-1", "1000-01", "1000-02"])("rejects invalid calendar input %s", month => expect(ProductBoardReadInputSchema.safeParse({ ...input, month }).success).toBe(false));
  it.each([{ pageSize: 0 }, { pageSize: 21 }, { allOffset: -1 }, { highReturnsOffset: 60001 }, { ownerIds: [7] }, { operator: "admin" }, { expectedWorkspaceId: null }, { storeName: " " }])("rejects invalid paging and caller ownership claims", patch => expect(ProductBoardReadInputSchema.safeParse({ ...input, ...patch }).success).toBe(false));
  it("canonicalizes country without inventing currency", () => {
    expect(ProductBoardReadInputSchema.parse({ ...input, country: "美国" }).country).toBe("US"); expect(parent(build([row({ raw: {} })])).currency).toBeNull();
  });
  it("returns a complete empty read without claiming zero sales", () => {
    const result = fromSelections([], {}, false, 0);
    expect(result.status).toBe("ready"); expect(result.products).toEqual([]); expect(result.pageRows).toEqual([]); expect(result.history?.firstVisibleMonth).toBeNull();
    expect(result.sources.every(source => source.status === "not_found")).toBe(true); expect(Object.values(result.sections).every(section => section.page.totalProducts === 0)).toBe(true);
  });
  it("retains all normalized metrics, original signs, nested raw details and exact source refs", () => {
    const source = row({ commission: 9, raw: { currency: "USD", api: { cpcCost: -40, cpcSpCost: -25, cpcSdCost: -15 }, original: [-9, null, { text: "<script>source</script>" }] } }), result = build([source]);
    expect(result.pageRows[0].raw).toEqual(source.raw); expect(Object.keys(result.pageRows[0].metrics)).toEqual([...MONTHLY_FINANCIAL_METRICS]);
    expect(result.pageRows[0].details).toBeDefined(); expect(parent(result).sourceRows).toEqual([{ batchId: 90, rowIndex: 0 }]);
    expect(result.sources.at(-1)).toMatchObject({ selectedBatchId: 90, batch: { fileName: "source.xlsx", timestampBasis: "database_datetime_without_timezone" } });
  });
  it("never emits partial rankings when full history scan was not completed", () => {
    const result = buildProductBoardReadResult({ identity, input, selections: selections(), history: { complete: false, scannedCount: 200, visibility: "full" } });
    expect(result).toMatchObject({ status: "invalid", reasonCode: "history_incomplete", history: null, products: [], sources: [], pageRows: [], matchedRows: 0 });
  });
  it.each(["missing", "not_found", "invalid"] as const)("keeps explicit %s failure free of partial data", status => {
    const result = buildProductBoardReadFailure({ identity, input, status, reasonCode: "explicit", missingReason: "来源不可核验" }); expect(result.status).toBe(status); expect(result.periods).toBeNull(); expect(Object.values(result.sections).every(section => section.page.totalProducts === 0)).toBe(true);
  });
});

describe("six reproduced friend product board regressions", () => {
  it("never merges other stores/sites and partitions currencies inside the selected store/site", () => {
    const result = build([row({ financialProfit: 100 }), row({ storeName: "Other", asin: "CAD-OTHER", financialProfit: 200, raw: { currency: "CAD" } }), row({ site: "CA", asin: "CA", financialProfit: 300 }), row({ asin: "CAD", financialProfit: 400, raw: { currency: "CAD" } })]);
    expect(result.products.map(product => [product.currency, product.financial.profit])).toEqual([["CAD", 400], ["USD", 100]]); expect(result.pageRows).toHaveLength(2);
  });
  it("does not turn unknown profit/return/refund values into false zeros", () => {
    const value = parent(build([row({ financialProfit: null, returnQty: null, refundQty: null })]));
    expect(value.financial.profit).toBeNull(); expect(value.rates.month.returns).toBeNull(); expect(value.rates.month.refunds).toBeNull();
    expect(value.rates.month.returnRate).toMatchObject({ value: null, numerator: null, denominator: 10 }); expect(value.rates.month.refundRate.value).toBeNull();
    expect(parent(build([row({ financialProfit: 0, returnQty: 0, refundQty: 0 })])).rates.month.returnRate.value).toBe(0);
  });
  it("computes quarter coverage per parent and child, not from other products in the workspace", () => {
    const result = build([row({ parentAsin: "A" }), row({ yearMonth: "2026-08", parentAsin: "B", asin: "B" }), row({ yearMonth: "2026-09", parentAsin: "B", asin: "B" })]);
    expect(parent(result, "A").rates.quarter.coverage).toMatchObject({ complete: false, observedMonths: ["2026-10"], missingMonths: ["2026-08", "2026-09"], unavailableMonths: [] });
    expect(parent(result, "A").children[0].rates.quarter.coverage.complete).toBe(false);
  });
  it("preserves old parent relationships over the full history instead of remapping to current metadata", () => {
    const result = build([row({ yearMonth: "2024-01", parentAsin: "OLD", financialProfit: 100, title: "Old product" }), row({ parentAsin: "NEW", financialProfit: 100, title: "New product" })]);
    expect(result.products.map(product => product.parentAsin).sort()).toEqual(["NEW", "OLD"]);
    expect(parent(result, "OLD").rates.total.profit).toBe(100); expect(parent(result, "NEW").rates.total.profit).toBe(100); expect(parent(result, "OLD").financial.profit).toBeNull();
    expect(result.pageRows.map(row => row.parentAsin)).toEqual(["OLD", "NEW"]);
  });
  it("does not apply the USD 1000 threshold to CAD or unknown currency", () => {
    const result = build([row({ parentAsin: "CAD", asin: "CAD", financialProfit: 2000, raw: { currency: "CAD" } }), row({ parentAsin: "UNKNOWN", asin: "UNKNOWN", financialProfit: 3000, raw: {} }), row({ parentAsin: "USD", asin: "USD", financialProfit: 1001 })]);
    expect(entries(result, "highProfit").map(product => product.parentAsin)).toEqual(["USD"]); expect(result.sections.all.page.totalProducts).toBe(3);
  });
  it("keeps reported-parent and unallocated originals without double-counting or ranking them", () => {
    const result = build([row({ asin: "", financialProfit: 400, salesQty: 100, returnQty: 20 }), row({ parentAsin: "", asin: "", financialProfit: -20 }), row({ financialProfit: 50 })]);
    expect(result.products.map(product => [product.basis, product.financial.profit])).toEqual([["child_rows", 50], ["reported_parent_row", 400], ["unallocated_rows", -20]]);
    expect(result.sections.highReturns.page.totalProducts).toBe(0); expect(result.sections.losing.page.totalProducts).toBe(0); expect(result.pageRows).toHaveLength(3);
  });
});

describe("ratios, complete drilldown, coverage and cash proxy", () => {
  it("uses the original summed numerators and denominators, never mean percentages", () => {
    const value = parent(build([row({ salesQty: 10, returnQty: 2, refundQty: 1, financialProfit: 10, salesAmount: 100 }), row({ asin: "B", salesQty: 90, returnQty: 9, refundQty: 3, financialProfit: 90, salesAmount: 300 })]));
    expect(value.rates.month.returnRate).toMatchObject({ numerator: 11, denominator: 100, value: .11 }); expect(value.rates.month.refundRate.value).toBe(.04);
    expect(value.financial.margin).toMatchObject({ numerator: 100, denominator: 400, value: .25 });
  });
  it.each([null, 0, -1])("keeps unknown/non-positive denominator %s without an invented ratio", salesQty => expect(parent(build([row({ salesQty })])).rates.month.returnRate.value).toBeNull());
  it("marks partial observed high-return periods but may rank the qualifying observations", () => {
    const result = build([row({ salesQty: 50, returnQty: 5 })]); expect(entries(result, "highReturns")).toHaveLength(1);
    expect(parent(result).rates.quarter).toMatchObject({ status: "partial", salesQty: 50, returns: 5, coverage: { complete: false, observedMonths: ["2026-10"] } });
    expect(parent(result).rates.quarter.missingReason).toContain("已观测");
  });
  it.each([{ qty: 49, returns: 10, eligible: false }, { qty: 50, returns: 4, eligible: false }, { qty: 50, returns: 5, eligible: true }, { qty: null, returns: 5, eligible: false }, { qty: 50, returns: null, eligible: false }])("applies strict return boundaries $qty/$returns", ({ qty, returns, eligible }) => expect(build([row({ salesQty: qty, returnQty: returns })]).sections.highReturns.page.totalProducts).toBe(eligible ? 1 : 0));
  it.each([{ profit: 1000, eligible: false }, { profit: 1000.01, eligible: true }, { profit: null, eligible: false }])("applies strict USD profit boundary $profit", ({ profit, eligible }) => expect(build([row({ financialProfit: profit })]).sections.highProfit.page.totalProducts).toBe(eligible ? 1 : 0));
  it("keeps true zeros distinct from no current-month row", () => {
    expect(parent(build([row({ financialProfit: 0 })])).financial.profit).toBe(0);
    const historical = parent(build([row({ yearMonth: "2026-09" })])); expect(historical.financial.status).toBe("missing"); expect(historical.financial.profit).toBeNull(); expect(historical.rates.month.returnRate.numerator).toBeNull();
  });
  it("keeps each unknown-currency original separate, allowing only its count-based return rule", () => {
    const result = build([row({ raw: {}, financialProfit: 1001, salesQty: 50, returnQty: 5 }), row({ asin: "B", raw: {}, financialProfit: -20 }), row({ yearMonth: "2026-09", raw: {}, financialProfit: 1001 })]);
    expect(result.products).toHaveLength(3); expect(result.products.every(product => product.sourceRows.length === 1 && product.currency === null)).toBe(true);
    expect(result.sections.highProfit.page.totalProducts).toBe(0); expect(result.sections.losing.page.totalProducts).toBe(0); expect(result.sections.highReturns.page.totalProducts).toBe(1);
    expect(result.products.every(product => product.financial.cashProxy.value === null)).toBe(true);
  });
  it("preserves signed cash proxy components and labels them non-receipts", () => {
    const cash = parent(build([row({ financialProfit: -10, purchaseCost: -50, freight: 5 })])).financial.cashProxy;
    expect(cash).toMatchObject({ value: -55, components: { profit: -10, purchase: -50, freight: 5 }, accountingStatus: "derived_not_actual_receipts", formula: "financialProfit + purchaseCost + freight", sourceRows: [{ batchId: 90, rowIndex: 0 }] });
    expect(cash.missingReason).toContain("不是实际回款");
    expect(parent(build([row({ freight: null })])).financial.cashProxy).toMatchObject({ value: null, components: { freight: null } });
  });
  it("retains all sibling ASINs and multiple SKU originals for one ASIN", () => {
    const result = build([row({ sku: "ONE" }), row({ sku: "TWO" }), row({ asin: "B", title: "Needle" })], { search: "needle" });
    expect(result.products).toHaveLength(1); expect(parent(result).children.map(child => child.asin)).toEqual(["A", "B"]); expect(parent(result).children[0].skus).toEqual(["ONE", "TWO"]); expect(result.pageRows).toHaveLength(3);
    expect(parent(result).financial.profit).toBe(60);
  });
  it("does not borrow the parent's temporal coverage for a newer child", () => {
    const result = build([row({ yearMonth: "2026-08" }), row({ yearMonth: "2026-09" }), row(), row({ asin: "B" })]);
    expect(parent(result).rates.quarter.coverage.complete).toBe(true); expect(parent(result).children.find(child => child.asin === "B")!.rates.quarter.coverage.complete).toBe(false);
  });
  it("preserves HTML-looking titles as source data and searches historical fields", () => {
    const result = build([row({ title: "<script>alert(1)</script>" })], { search: "SCRIPT" }); expect(parent(result).title).toBe("<script>alert(1)</script>");
  });
  it("keeps duplicate reported totals explicitly ambiguous rather than adding them", () => {
    const result = build([row({ asin: "", sku: "X", financialProfit: 100 }), row({ asin: "", sku: "Y", financialProfit: 200 })]);
    expect(parent(result).financial).toMatchObject({ status: "ambiguous", profit: null }); expect(parent(result).rates.total.status).toBe("ambiguous"); expect(result.pageRows).toHaveLength(2);
  });
  it("preserves source ambiguous allocation as independent non-ranking originals", () => {
    const result = build([row({ raw: { currency: "USD", api: { parentAsinList: ["P", "Q"] } }, financialProfit: 5000 })]);
    expect(result.products[0]).toMatchObject({ parentAsin: null, basis: "unallocated_rows" }); expect(result.pageRows[0].allocation).toBe("ambiguous"); expect(result.sections.highProfit.page.totalProducts).toBe(0);
  });
});

describe("all matching groups ranked before independent four-section paging", () => {
  it("keeps loss top ten per explicit currency rather than a cross-currency top ten", () => {
    const rows = ["USD", "CAD"].flatMap(currency => Array.from({ length: 12 }, (_, index) => row({ parentAsin: `${currency}${index}`, asin: `${currency}${index}`, raw: { currency }, financialProfit: -index - 1 }))), result = build(rows);
    expect(result.sections.losing.page.totalProducts).toBe(20); expect(entries(result, "losing").filter(product => product.currency === "USD")).toHaveLength(10); expect(entries(result, "losing").filter(product => product.currency === "CAD")).toHaveLength(10);
    expect(entries(result, "losing").every(product => product.financial.profit! <= -3)).toBe(true); expect(result.sections.all.page.totalProducts).toBe(24);
  });
  it("carries full details for the union of all four pages, without duplicate originals", () => {
    const result = build([row({ parentAsin: "RETURN", asin: "RETURN", salesQty: 100, returnQty: 20 }), row({ parentAsin: "PROFIT", asin: "PROFIT", financialProfit: 2000 }), row({ parentAsin: "LOSS", asin: "LOSS", financialProfit: -200 }), row({ parentAsin: "AAA", asin: "AAA", financialProfit: 10 })], { pageSize: 1 });
    expect(entries(result, "highReturns")[0].parentAsin).toBe("RETURN"); expect(entries(result, "highProfit")[0].parentAsin).toBe("PROFIT"); expect(entries(result, "losing")[0].parentAsin).toBe("LOSS"); expect(entries(result, "all")[0].parentAsin).toBe("AAA");
    expect(result.products).toHaveLength(4); expect(result.pageRows).toHaveLength(4); expect(new Set(result.pageRows.map(row => `${row.batchId}:${row.rowIndex}`)).size).toBe(4);
  });
  it("ranks the full matching set, then provides every rank with its original children on later pages", () => {
    const rows = Array.from({ length: 25 }, (_, index) => row({ parentAsin: `P${index.toString().padStart(2, "0")}`, asin: `A${index}`, financialProfit: 1001 + index }));
    const first = build(rows, { pageSize: 2 }), next = build(rows, { pageSize: 2, highProfitOffset: 2, allOffset: 2 });
    expect(first.sections.highProfit.page).toMatchObject({ totalProducts: 25, hasMore: true, nextOffset: 2 }); expect(entries(first, "highProfit")[0].parentAsin).toBe("P24"); expect(entries(next, "highProfit")[0].parentAsin).toBe("P22");
    expect(entries(next, "highProfit").every(product => product.children.length === 1)).toBe(true); expect(next.matchedRows).toBe(25);
  });
  it("search changes full ranking scope, not only displayed rows", () => {
    const result = build([row({ parentAsin: "YES", asin: "YES", title: "Needle", financialProfit: 1001 }), row({ parentAsin: "NO", asin: "NO", financialProfit: 3000 })], { search: "needle", pageSize: 1 });
    expect(result.sections.highProfit.page.totalProducts).toBe(1); expect(entries(result, "highProfit")[0].parentAsin).toBe("YES"); expect(result.matchedRows).toBe(1);
  });
  it("ranks all parents across a long history while returning only complete requested group details", () => {
    const rows = [row({ yearMonth: "1927-01", parentAsin: "OLD", asin: "OLD" }), ...Array.from({ length: 200 }, (_, index) => row({ parentAsin: `P${index}`, asin: `A${index}`, financialProfit: 1001 + index }))];
    const result = build(rows, { pageSize: 1 }); expect(result.periods!.total.months).toHaveLength(1198); expect(result.sections.highProfit.page.totalProducts).toBe(200);
    expect(result.sections.all.page.totalProducts).toBe(201); expect(entries(result, "highProfit")[0].parentAsin).toBe("P199"); expect(result.products).toHaveLength(2); expect(result.pageRows).toHaveLength(2);
  });
  it("allows past-end independent pages without losing other sections", () => {
    const result = build([row({ financialProfit: 2000 })], { allOffset: 100 }); expect(result.sections.all.entries).toEqual([]); expect(result.sections.all.page.hasMore).toBe(false); expect(result.products).toHaveLength(1);
  });
  it("distinguishes a successful zero search match from a source error", () => { const result = build(undefined, { search: "nothing" }); expect(result.status).toBe("ready"); expect(result.matchedRows).toBe(0); expect(result.sources.at(-1)?.status).toBe("selected"); });
});

describe("source replacement and per-month scope authorization", () => {
  it("does not resurrect a removed parent from an older batch after whole-scope replacement", () => {
    const newest = record([row({ parentAsin: "NEW", asin: "NEW" })], { id: 91 }), older = record([row({ parentAsin: "OLD" })]);
    const selection = findMonthlyFinancialSnapshot([newest, older], { yearMonth: "2026-10", storeName: "Store", country: "US" }, true);
    const result = fromSelections([{ month: "2026-10", selection, metadataVisibility: "full" }], { parentAsin: "OLD" });
    expect(result.products).toEqual([]); expect(result.pageRows).toEqual([]); expect(result.sources.at(-1)?.selectedBatchId).toBe(91);
  });
  it("does not borrow later owner permission for an earlier month", () => {
    const values = selections([row({ yearMonth: "2026-09", financialProfit: 999 }), row()], true); values[0].authorizedRowRefs = [];
    const result = fromSelections(values, {}, true);
    expect(parent(result).rates.total.profit).toBe(20); expect(result.history?.firstVisibleMonth).toBe("2026-10"); expect(result.sources[1]).toMatchObject({ month: "2026-09", status: "not_visible", batch: null, selectedBatchId: null, visibleRows: 0 });
  });
  it("hidden historical months do not reveal total start, metadata or full-scan counts", () => {
    const visible = parseMonthlyFinancialBatch(record([row()])), hidden = parseMonthlyFinancialBatch(record([row({ yearMonth: "2019-01", title: "SECRET" })], { id: 89 }));
    const active: ProductBoardMonthSelection = { month: "2026-10", selection: { selected: visible, scannedBatchIds: [90], complete: true }, authorizedRowRefs: [{ batchId: 90, rowIndex: 0 }], metadataVisibility: "scoped" };
    const denied: ProductBoardMonthSelection = { month: "2019-01", selection: { selected: hidden, scannedBatchIds: [90, 89], complete: true }, authorizedRowRefs: [], metadataVisibility: "scoped" };
    const withHidden = fromSelections([denied, active], {}, true, 2), withoutHidden = fromSelections([active], {}, true, 1);
    expect(withHidden).toEqual(withoutHidden); expect(JSON.stringify(withHidden)).not.toContain("SECRET"); expect(JSON.stringify(withHidden)).not.toContain("2019-01");
    expect(withHidden.history?.scannedCount).toBeNull(); expect(JSON.stringify(withHidden.sources)).not.toMatch(/fileName|fileHash|totalRows|userId|workspaceId/);
  });
  it("returns only authorized originals and suppresses all foreign parent titles/counts", () => {
    const values = selections([row(), row({ parentAsin: "SECRET", asin: "SECRET", title: "SECRET", financialProfit: 999999 })], true); values[0].authorizedRowRefs = [{ batchId: 90, rowIndex: 0 }];
    const result = fromSelections(values, {}, true); expect(result.pageRows).toHaveLength(1); expect(result.matchedRows).toBe(1); expect(result.sources.at(-1)?.visibleRows).toBe(1); expect(JSON.stringify(result)).not.toContain("SECRET");
  });
  it("missing and denied selected months have the same public representation", () => {
    const values = selections([row(), row({ yearMonth: "2026-09" })], true); values[0].authorizedRowRefs = [];
    const result = fromSelections(values, {}, true), { month: _a, ...missing } = result.sources[0], { month: _b, ...denied } = result.sources[1]; expect(missing).toEqual(denied);
  });
  it.each(["missing", "foreign", "duplicate"])("rejects %s authorized refs", mode => {
    const values = selections(undefined, true); if (mode === "missing") delete values[0].authorizedRowRefs; if (mode === "foreign") values[0].authorizedRowRefs = [{ batchId: 90, rowIndex: 999 }]; if (mode === "duplicate") values[0].authorizedRowRefs = [{ batchId: 90, rowIndex: 0 }, { batchId: 90, rowIndex: 0 }];
    expect(() => fromSelections(values, {}, true)).toThrow(ProductBoardReadError);
  });
  it.each(["workspace", "status", "confirmed", "lastid", "count", "source", "visibility", "incomplete", "future", "duplicateMonth", "wrongOrder"])("rejects forged source/history %s", mode => {
    const values = selections(), item = values[0], selected = item.selection.selected!;
    if (mode === "workspace") selected.batch.workspaceId = 99;
    if (mode === "status") selected.batch.status = "deleted";
    if (mode === "confirmed") selected.batch.confirmedAt = null;
    if (mode === "lastid") item.selection.scannedBatchIds = [91];
    if (mode === "count") selected.batch.totalRows = 99;
    if (mode === "source") selected.rows[0].batchId = 91;
    if (mode === "visibility") item.metadataVisibility = "scoped";
    if (mode === "incomplete") item.selection.complete = false;
    if (mode === "future") item.month = "2026-11";
    if (mode === "duplicateMonth") values.push(clone(item));
    if (mode === "wrongOrder") item.selection.scannedBatchIds = [89, 90];
    expect(() => fromSelections(values, {}, false, 2)).toThrow(ProductBoardReadError);
  });
  it.each([-1, .5, 201])("rejects invalid completed scan count %s", scannedCount => expect(() => fromSelections(selections(), {}, false, scannedCount)).toThrow(ProductBoardReadError));
  it("counts distinct scanned batches across months, not only each month separately", () => {
    const older = parseMonthlyFinancialBatch(record([row({ yearMonth: "2026-09" })], { id: 89 }));
    const values: ProductBoardMonthSelection[] = [{ month: "2026-09", selection: { selected: older, scannedBatchIds: [89], complete: true }, metadataVisibility: "full" }, ...selections()];
    expect(() => fromSelections(values, {}, false, 1)).toThrow("产品看板来源");
    expect(fromSelections(values, {}, false, 2).pageRows).toHaveLength(2);
  });
  it.each(["row", "metadata"])("rejects a same-ID snapshot whose %s changed between month selections", mode => {
    const values = selections([row({ yearMonth: "2026-09" }), row()]);
    values[1].selection.selected = clone(values[1].selection.selected);
    if (mode === "row") values[1].selection.selected!.rows[1].title = "Different source version";
    else values[1].selection.selected!.batch.fileHash = "b".repeat(64);
    // Checking only the requested product page could miss the inconsistent
    // other month. The complete selected snapshot must remain one identity.
    expect(() => fromSelections(values, { search: "not present" })).toThrow(ProductBoardReadError);
  });
  it("accepts equivalent parsed snapshots even when independent month selectors clone them", () => {
    const values = selections([row({ yearMonth: "2026-09" }), row()]);
    values[1].selection.selected = clone(values[1].selection.selected);
    expect(fromSelections(values).pageRows).toHaveLength(2);
  });
  it("rejects a workspace identity mismatch", () => expect(() => buildProductBoardReadResult({ identity: { ...identity, workspaceId: 12 }, input, selections: selections(), history: { complete: true, scannedCount: 1, visibility: "full" } })).toThrow(ProductBoardReadError));
});

describe("strict bounded result, source links and calculation replay", () => {
  it("round trips native and JSON response forms", () => { const result = build(); expect(ProductBoardReadResultSchema.parse(result)).toEqual(result); expect(ProductBoardReadResultSchema.parse(clone(result))).toEqual(result); });
  it("keeps the complete 34-month, 22-child, four-page union below the byte limit without applying the raw payload node budget", () => {
    const months = productBoardCalendarMonths("2024-01", "2026-10");
    const values: ProductBoardMonthSelection[] = months.map((yearMonth, index) => {
      const rows = Array.from({ length: 15 }, (_, group) => Array.from({ length: group === 0 ? 22 : 1 }, (_, child) => row({
        yearMonth, parentAsin: `P${String(group).padStart(2, "0")}`, asin: `C${group}-${child}`, sku: `S${group}-${child}`,
        financialProfit: (group >= 10 ? -1 : 1) * (1100 + group * 100), salesQty: 50, salesAmount: 5000, purchaseCost: -100, freight: -20, returnQty: group + 5, refundQty: 2,
        raw: { currency: "USD", "5:订单支出/销售佣金": -12.5, untouched: ["https://example.test/not-download", "source text"] },
      }))).flat();
      const selected = parseMonthlyFinancialBatch(record(rows, { id: 100 + index }));
      return { month: yearMonth, selection: { selected, complete: true, scannedBatchIds: [100 + index] }, metadataVisibility: "full" };
    });
    const result = fromSelections(values, { pageSize: 5 }, false, months.length);
    expect(result.products).toHaveLength(14); expect(result.pageRows).toHaveLength(1190);
    expect(parent(result, "P00").children).toHaveLength(22); expect(parent(result, "P00").rates.total.coverage).toMatchObject({ expectedMonths: 34, complete: true });
    expect(Object.fromEntries(PRODUCT_BOARD_SECTIONS.map(key => [key, result.sections[key].page.totalProducts]))).toEqual({ highReturns: 15, highProfit: 10, losing: 5, all: 15 });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThan(PRODUCT_BOARD_READ_LIMITS.resultBytes);
    expect(() => monthlyFinancialJsonBytes(result)).toThrow("JSON_LIMIT");
    expect(ProductBoardReadResultSchema.safeParse(clone(result)).success).toBe(true);
  });
  it("allows the derived response envelope around a legal deeply nested raw source", () => {
    let nested: unknown = "leaf"; for (let depth = 0; depth < 13; depth++) nested = { nested };
    const result = build([row({ raw: { currency: "USD", deep: nested } })]);
    expect(result.pageRows[0].raw.deep).toEqual(nested);
    expect(() => monthlyFinancialJsonBytes(result)).toThrow("JSON_LIMIT");
    expect(ProductBoardReadResultSchema.safeParse(result).success).toBe(true);
  });
  it("still rejects illegal JSON in original raw data under the larger response envelope", () => {
    const result = build(), cycle: Record<string, unknown> = {}; cycle.self = cycle;
    for (const invalid of [cycle, { value: Infinity }, { value: undefined }, Object.assign([1], { custom: true })]) {
      result.pageRows[0].raw = invalid as never;
      expect(ProductBoardReadResultSchema.safeParse(result).success).toBe(false);
    }
  });
  it.each([
    { name: "identity", mutate: (r: ProductBoardReadResult) => { r.identity.workspaceId = 99; } },
    { name: "period", mutate: (r: ProductBoardReadResult) => { r.periods!.quarter.months = ["2026-10"]; } },
    { name: "source calendar", mutate: (r: ProductBoardReadResult) => { r.sources.shift(); } },
    { name: "source batch", mutate: (r: ProductBoardReadResult) => { r.sources.at(-1)!.selectedBatchId = 99; } },
    { name: "row scope", mutate: (r: ProductBoardReadResult) => { r.pageRows[0].country = "CA"; } },
    { name: "original site", mutate: (r: ProductBoardReadResult) => { r.pageRows[0].site = "CA"; } },
    { name: "raw reference", mutate: (r: ProductBoardReadResult) => { r.products[0].sourceRows[0].rowIndex = 9; } },
    { name: "parent total", mutate: (r: ProductBoardReadResult) => { r.products[0].financial.profit = 999; } },
    { name: "cash", mutate: (r: ProductBoardReadResult) => { r.products[0].financial.cashProxy.value = 999; } },
    { name: "ratio", mutate: (r: ProductBoardReadResult) => { r.products[0].rates.total.returnRate.value = .99; } },
    { name: "coverage", mutate: (r: ProductBoardReadResult) => { r.products[0].rates.quarter.coverage.complete = true; } },
    { name: "child", mutate: (r: ProductBoardReadResult) => { r.products[0].children = []; } },
    { name: "page", mutate: (r: ProductBoardReadResult) => { r.sections.all.page.hasMore = true; } },
    { name: "section union", mutate: (r: ProductBoardReadResult) => { r.sections.all.entries[0].productId = "OTHER"; } },
    { name: "duplicate row", mutate: (r: ProductBoardReadResult) => { r.pageRows.push(clone(r.pageRows[0])); } },
    { name: "extra product", mutate: (r: ProductBoardReadResult) => { r.products.push(clone(r.products[0])); } },
    { name: "count", mutate: (r: ProductBoardReadResult) => { r.matchedRows = 0; } },
    { name: "source count", mutate: (r: ProductBoardReadResult) => { r.sources.at(-1)!.visibleRows = 0; } },
    { name: "currency evidence", mutate: (r: ProductBoardReadResult) => { r.pageRows[0].currencyEvidence.values = ["CAD"]; } },
    { name: "rule", mutate: (r: ProductBoardReadResult) => { r.sections.highProfit.rule = "all currencies >1000"; } },
    { name: "failure partial", mutate: (r: ProductBoardReadResult) => { r.status = "invalid"; r.reasonCode = "bad"; r.missingReason = "bad"; } },
  ])("rejects mutated $name", ({ mutate }) => { const result = clone(build()); mutate(result); expect(ProductBoardReadResultSchema.safeParse(result).success).toBe(false); });
  it("never accepts an ambiguous original inside a requested parent-only scope", () => {
    const result = build([row({ raw: { currency: "USD", api: { parentAsinList: ["P", "Q"] } } })]);
    expect(result.pageRows[0].allocation).toBe("ambiguous");
    result.request.parentAsin = "P";
    expect(ProductBoardReadResultSchema.safeParse(result).success).toBe(false);
  });
  it("never relabels an unallocated original as a claimed parent", () => {
    const result = build([row({ parentAsin: "", asin: "" })]), item = result.products[0], originalId = item.id;
    item.parentAsin = "CLAIMED";
    item.id = JSON.stringify([item.partitionId, item.parentAsin, [90, 0]]);
    for (const key of PRODUCT_BOARD_SECTIONS) for (const entry of result.sections[key].entries) if (entry.productId === originalId) entry.productId = item.id;
    expect(ProductBoardReadResultSchema.safeParse(result).success).toBe(false);
  });
  it("accepts a source's alias site while retaining its canonical country scope", () => {
    const result = build([row({ site: "美国" })]);
    expect(result.pageRows[0]).toMatchObject({ site: "美国", country: "US" });
    expect(ProductBoardReadResultSchema.safeParse(result).success).toBe(true);
  });
  it("rejects nonfinite calculation values and unknown response fields", () => {
    const result = build(); expect(ProductBoardReadResultSchema.safeParse({ ...result, taskAccess: true }).success).toBe(false);
    result.products[0].financial.profit = Infinity; expect(ProductBoardReadResultSchema.safeParse(result).success).toBe(false);
  });
  it("rejects scoped history with a full metadata disclosure or scan count", () => {
    const result = fromSelections(selections(undefined, true), {}, true); result.history!.scannedCount = 1; expect(ProductBoardReadResultSchema.safeParse(result).success).toBe(false);
    const full = build(); full.history!.visibility = "scoped"; full.history!.scannedCount = null; expect(ProductBoardReadResultSchema.safeParse(full).success).toBe(false);
  });
  it("rejects whole response overflow instead of silently slicing source rows or raw fields", () => {
    const huge = "a".repeat(32768), rows = Array.from({ length: 380 }, (_, index) => row({ sku: String(index), raw: { currency: "USD", big: huge } }));
    const first = parseMonthlyFinancialBatch(record(rows.slice(0, 190), { id: 90 })), second = parseMonthlyFinancialBatch(record(rows.slice(190).map(row => ({ ...row, yearMonth: "2026-09" })), { id: 89 }));
    expect(() => fromSelections([{ month: "2026-09", selection: { selected: second, scannedBatchIds: [90, 89], complete: true }, metadataVisibility: "full" }, { month: "2026-10", selection: { selected: first, scannedBatchIds: [90], complete: true }, metadataVisibility: "full" }], {}, false, 2)).toThrow(ProductBoardReadError);
  });
});
