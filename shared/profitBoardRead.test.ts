import { describe, expect, it } from "vitest";
import { buildUnavailableOperationsBoardOwnership, type OperationsBoardOwnership } from "./operationsBoardOwnership";
import { buildProfitBoardReadResult, buildProfitBoardReadFailure, buildProfitBoardBodyProjection, profitBoardMonths, ProfitBoardReadInputSchema, ProfitBoardReadResultSchema, ProfitBoardReadError, type ProfitBoardMonthSelection, type ProfitBoardReadInput } from "./profitBoardRead";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, findMonthlyFinancialSnapshot, type MonthlyFinancialBatchRecord, type MonthlyFinancialMetrics } from "./monthlyFinancialRead";

const identity = { userId: 7, workspaceId: 11 };
const input: ProfitBoardReadInput = { expectedWorkspaceId: 11, month: "2026-10", storeName: "Store", country: "US", search: "", groupOffset: 0, groupLimit: 20 };
function row(values: Record<string, unknown> = {}) { return { yearMonth: "2026-10", storeName: "Store", site: "US", parentAsin: "P", asin: "A", sku: "SKU", title: "Historical title", operator: "Source Owner", ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])) as MonthlyFinancialMetrics, financialProfit: 20, salesAmount: 100, salesQty: 10, raw: { currency: "USD", original: { costs: [-9, null, { value: true }] } }, ...values }; }
function record(rows = [row()], patch: Partial<MonthlyFinancialBatchRecord> = {}): MonthlyFinancialBatchRecord { return { id: 90, workspaceId: 11, userId: 7, status: "completed", fileName: "source.xlsx", fileHash: "a".repeat(64), totalRows: rows.length, skippedRows: 0, unallocatedRows: rows.filter(row => !row.parentAsin).length, months: [...new Set(rows.map(row => row.yearMonth))], createdAt: "2026-10-10 10:00:00.123000", confirmedAt: "2026-10-10 11:00:00.000000", fileReferenceKind: "storage", payload: rows, ...patch }; }
function selections(rows = [row()], scoped = false): ProfitBoardMonthSelection[] {
  const parsed = parseMonthlyFinancialBatch(record(rows));
  return profitBoardMonths(input.month).map(month => ({ month, selection: { selected: rows.some(row => row.yearMonth === month) ? parsed : null, scannedBatchIds: [90], complete: true }, metadataVisibility: scoped ? "scoped" : "full", ...(scoped ? { authorizedRowRefs: parsed.rows.filter(row => row.yearMonth === month && row.storeName === "Store" && row.country === "US").map(({ batchId, rowIndex }) => ({ batchId, rowIndex })) } : {}) }));
}
const build = (rows = [row()], patch: Partial<ProfitBoardReadInput> = {}) => buildProfitBoardReadResult({ identity, input: { ...input, ...patch }, selections: selections(rows) });
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe("metadata-free profit body extraction", () => {
  function bodySource(rows = [row()]) {
    const original = parseMonthlyFinancialBatch(record(rows)).rows;
    return { input, rows: original, sources: profitBoardMonths(input.month).map(month => ({ month, status: original.some(row => row.yearMonth === month) ? "selected" as const : "not_found" as const,
      selectedBatchId: original.some(row => row.yearMonth === month) ? 90 : null, visibleRows: original.filter(row => row.yearMonth === month).length })) };
  }
  it("preserves full trends, top-five, ratios and detail pages exactly without requiring batch metadata", () => {
    const rows = [row({ yearMonth: "2026-09", financialProfit: -10 }), row({ financialProfit: 20 }), row({ parentAsin: "OTHER", asin: "OTHER", financialProfit: 0 })], live = build(rows), body = buildProfitBoardBodyProjection(bodySource(rows));
    for (const key of ["months", "previousMonth", "analysisBasis", "partitions", "products", "pageRows", "page"] as const) expect(body[key]).toEqual(live[key]);
    expect(body).not.toHaveProperty("sources"); expect(live.sources.at(-1)?.batch).toHaveProperty("fileName", "source.xlsx");
  });
  it.each(["calendar", "batch", "count", "duplicate"])("rejects a broken %s proof before presentation", kind => {
    const source = bodySource();
    if (kind === "calendar") source.sources[0].month = "2020-01";
    if (kind === "batch") source.sources[5].selectedBatchId = 91;
    if (kind === "count") source.sources[5].visibleRows = 0;
    if (kind === "duplicate") source.rows.push(source.rows[0]);
    expect(() => buildProfitBoardBodyProjection(source)).toThrow(ProfitBoardReadError);
  });
  it("keeps the live full-source admission rather than making incomplete source selection acceptable", () => {
    const source = selections(); source[5].selection.complete = false;
    expect(buildProfitBoardReadResult({ identity, input, selections: source })).toMatchObject({ status: "invalid", reasonCode: "scan_incomplete", products: [] });
  });
});

function owners(rows: ReturnType<typeof row>[], assignment: Record<string, number[]> = {}): OperationsBoardOwnership {
  const parsed = parseMonthlyFinancialBatch(record(rows)).rows.filter(row => row.storeName === "Store" && row.country === "US" && ["child", "parent_only"].includes(row.allocation));
  return { version: 1, meaning: "current_manual_else_latest_visible_financial_mapping_not_archive", status: "ready", reasonCode: null, visibility: "full", operators: [{ userId: 7, displayName: "Synthetic A" }, { userId: 8, displayName: "Synthetic B" }, { userId: 9, displayName: "Synthetic C" }], parents: [...new Set(parsed.map(row => row.parentAsin))].map(parentAsin => ({ parentAsin, operatorIds: assignment[parentAsin] ?? [7], status: "resolved", basis: "confirmed_source_mapping", sourceMonth: parsed.filter(row => row.parentAsin === parentAsin).map(row => row.yearMonth).sort().at(-1)!, reasonCode: null })), partners: { status: "not_configured", reasonCode: "trusted_partner_relationship_not_configured" } };
}
const owned = (rows: ReturnType<typeof row>[], patch: Partial<ProfitBoardReadInput> = {}, ownership = owners(rows)) => buildProfitBoardReadResult({ identity, input: { ...input, ...patch }, selections: selections(rows), ownership });

describe("profit board whole-parent operator filtering", () => {
  it("keeps old requests unchanged while new operator filters require a trusted directory", () => {
    expect(ProfitBoardReadInputSchema.parse(input)).toEqual(input); expect(build()).not.toHaveProperty("ownership");
    expect(ProfitBoardReadInputSchema.parse({ ...input, operatorId: 7 }).operatorId).toBe(7); expect(() => build([row()], { operatorId: 7 })).toThrow(ProfitBoardReadError);
  });
  it("uses current owner for complete historical parent rows without duplicate SKU or co-owner counting", () => {
    const rows = [row({ yearMonth: "2026-09", operator: "Old owner", financialProfit: 5 }), row({ operator: "New owner", financialProfit: 20 }), row({ sku: "SECOND", financialProfit: 30, commission: 9 }), row({ parentAsin: "OTHER", asin: "OTHER", financialProfit: 1000 })], ownership = owners(rows, { P: [7, 8], OTHER: [8] }), result = owned(rows, { operatorId: 7 }, ownership);
    expect(result.page).toMatchObject({ totalGroups: 1, totalRows: 3 }); expect(result.products[0].children).toHaveLength(1); expect(result.products[0].children[0].skus).toEqual(["SKU", "SECOND"]);
    expect(result.products[0].comparison.profit.delta).toBe(45); expect(result.partitions[0].trend[5].profit).toBe(50); expect(result.pageRows[2].metrics.commission).toBe(9); expect(result.pageRows[2].raw).toEqual(rows[2].raw);
    expect(owned(rows, { operatorId: 8 }, ownership).page.totalRows).toBe(4);
  });
  it("filters before full trend, both rankings and page counts", () => {
    const rows = Array.from({ length: 6 }, (_, index) => [row({ yearMonth: "2026-09", parentAsin: `P${index}`, asin: `A${index}`, financialProfit: 100 }), row({ parentAsin: `P${index}`, asin: `A${index}`, financialProfit: index < 4 ? 200 + index : -200 - index })]).flat();
    const ownership = owners(rows, { P0: [8], P1: [7], P2: [8], P3: [7], P4: [8], P5: [7] }), result = owned(rows, { operatorId: 7, groupLimit: 1 }, ownership);
    expect(result.page).toMatchObject({ totalGroups: 3, totalRows: 6, hasMore: true, nextOffset: 1 }); expect(result.products[0].parentAsin).toBe("P1");
    expect(result.partitions[0].trend[5].profit).toBe(199); expect(result.partitions[0].rising.map(product => product.parentAsin)).toEqual(["P3", "P1"]); expect(result.partitions[0].falling.map(product => product.parentAsin)).toEqual(["P5"]);
    expect(owned(rows, { operatorId: 7, groupOffset: 1, groupLimit: 1 }, ownership).products[0].parentAsin).toBe("P3");
  });
  it("never mixes currency, reported parents or unknown money by operator", () => {
    const rows = [row({ financialProfit: null }), row({ asin: "CAD", raw: { currency: "CAD" }, financialProfit: 2000 }), row({ asin: "UNKNOWN", raw: {} }), row({ asin: "", financialProfit: 5000 }), row({ parentAsin: "", asin: "U" })], result = owned(rows, { operatorId: 7 });
    expect(result.partitions).toHaveLength(4); expect(result.page.totalRows).toBe(4); expect(result.products.find(product => product.currency === "USD" && product.basis === "child_rows")!.current.profit).toBeNull();
    expect(result.partitions.find(partition => partition.currency === null)?.rising).toEqual([]); expect(owned(rows).page.totalRows).toBe(5);
  });
  it("keeps unresolved originals without a filter but does not assign them", () => {
    const rows = [row(), row({ parentAsin: "Q", asin: "Q" }), row({ parentAsin: "", asin: "U" })], ownership = owners(rows);
    ownership.parents[1] = { ...ownership.parents[1], status: "unresolved", operatorIds: [], reasonCode: "mapping_missing" };
    expect(owned(rows, {}, ownership).page.totalRows).toBe(3); expect(owned(rows, { operatorId: 7 }, ownership).page.totalRows).toBe(1); expect(owned(rows, { operatorId: 9 }, ownership).page.totalGroups).toBe(0);
  });
  it("verifies full directory before search and exact parent restriction", () => {
    const rows = [row(), row({ parentAsin: "Q", asin: "Q" })], ownership = owners(rows);
    expect(owned(rows, { search: "not present" }, ownership).ownership?.parents).toHaveLength(2);
    expect(() => owned(rows, { search: "not present" }, { ...ownership, parents: [ownership.parents[0]] })).toThrow(ProfitBoardReadError);
    expect(() => owned(rows, { parentAsin: "P" }, ownership)).toThrow(ProfitBoardReadError);
    expect(owned(rows, { parentAsin: "P" }, { ...ownership, parents: [ownership.parents[0]] }).page.totalGroups).toBe(1);
  });
  it("unavailable registry does not break unfiltered financial results or pretend to filter", () => {
    const rows = [row(), row({ parentAsin: "", asin: "U" })], ownership = buildUnavailableOperationsBoardOwnership(parseMonthlyFinancialBatch(record(rows)).rows, "full");
    expect(owned(rows, {}, ownership).partitions).toEqual(build(rows).partitions); expect(() => owned(rows, { operatorId: 7 }, ownership)).toThrow(ProfitBoardReadError);
  });
  it.each(["missing", "selected", "parent", "stale", "visibility", "future"])("rejects forged %s ownership response", kind => {
    const result = clone(owned([row()], { operatorId: 7 }));
    if (kind === "missing") delete result.ownership;
    if (kind === "selected") result.ownership!.parents[0].operatorIds = [8];
    if (kind === "parent") result.ownership!.parents[0].parentAsin = "OTHER";
    if (kind === "stale") result.ownership!.parents[0].sourceMonth = "2026-09";
    if (kind === "visibility") result.ownership!.visibility = "scoped";
    if (kind === "future") result.ownership!.parents[0].sourceMonth = "2026-11";
    expect(ProfitBoardReadResultSchema.safeParse(result).success).toBe(false);
  });
  it("validates selected ownership of off-page rankings, not just page rows", () => {
    const rows = [row({ yearMonth: "2026-09", parentAsin: "A", financialProfit: 0 }), row({ parentAsin: "A", financialProfit: 20 }), row({ yearMonth: "2026-09", parentAsin: "B", asin: "B", financialProfit: 0 }), row({ parentAsin: "B", asin: "B", financialProfit: 10 })], result = clone(owned(rows, { operatorId: 7, groupLimit: 1 }));
    result.ownership!.parents.find(parent => parent.parentAsin === "B")!.operatorIds = [8]; expect(ProfitBoardReadResultSchema.safeParse(result).success).toBe(false);
  });
  it("failure echoes filter but never carries a partial directory", () => {
    const result = buildProfitBoardReadFailure({ identity, input: { ...input, operatorId: 7 }, status: "missing", reasonCode: "missing", missingReason: "不可读取" });
    expect(result.request.operatorId).toBe(7); expect(ProfitBoardReadResultSchema.safeParse({ ...result, ownership: owners([row()]) }).success).toBe(false);
  });
  it("full unfiltered response cannot invent an unseen parent or a later mapping month", () => {
    const result = clone(owned([row({ yearMonth: "2026-09" })]));
    result.ownership!.parents[0].sourceMonth = "2026-10"; expect(ProfitBoardReadResultSchema.safeParse(result).success).toBe(false);
    result.ownership!.parents[0].sourceMonth = "2026-09"; result.ownership!.parents.push({ ...result.ownership!.parents[0], parentAsin: "HIDDEN" }); expect(ProfitBoardReadResultSchema.safeParse(result).success).toBe(false);
  });
  it("accepts scoped self filtering without publishing co-owners", () => {
    const rows = [row()], ownership = owners(rows); ownership.visibility = "scoped"; ownership.operators = [ownership.operators[0]];
    const result = buildProfitBoardReadResult({ identity, input: { ...input, operatorId: 7 }, selections: selections(rows, true), ownership });
    expect(result.pageRows).toHaveLength(1); expect(result.ownership?.operators.map(operator => operator.userId)).toEqual([7]);
  });
});

describe("six-calendar-month profit board source contract", () => {
  it("uses exact calendar months across years and leap years", () => {
    expect(profitBoardMonths("2026-02")).toEqual(["2025-09", "2025-10", "2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(profitBoardMonths("2024-03")).toEqual(["2023-10", "2023-11", "2023-12", "2024-01", "2024-02", "2024-03"]);
  });
  it.each(["2026-00", "2026-13", "0000-01", "2026-1", "1000-01"])("rejects invalid or out-of-range complete window %s", month => expect(ProfitBoardReadInputSchema.safeParse({ ...input, month }).success).toBe(false));
  it.each([{ groupLimit: 0 }, { groupLimit: 51 }, { groupOffset: -1 }, { operatorId: 0 }, { userId: 1 }, { storeName: " " }, { expectedWorkspaceId: 0 }])("rejects malformed or client ownership controls", patch => expect(ProfitBoardReadInputSchema.safeParse({ ...input, ...patch }).success).toBe(false));
  it("canonicalizes marketplace without guessing currency", () => {
    expect(ProfitBoardReadInputSchema.parse({ ...input, country: "美国" }).country).toBe("US");
    expect(build([row({ raw: {} })]).products[0].currency).toBeNull();
  });
  it("retains complete original row, all normalized metrics, raw signs and month source", () => {
    const source = row({ commission: 9, raw: { currency: "USD", original: { negative: -9, nested: [0, null, { yes: true }] } } }), result = build([source]);
    expect(result.pageRows[0].raw).toEqual(source.raw); expect(Object.keys(result.pageRows[0].metrics)).toEqual([...MONTHLY_FINANCIAL_METRICS]);
    expect(result.sources[5]).toMatchObject({ month: "2026-10", status: "selected", selectedBatchId: 90, batch: { fileName: "source.xlsx", timestampBasis: "database_datetime_without_timezone" } });
    expect(result.products[0].sourceRows).toEqual([{ batchId: 90, rowIndex: 0 }]);
  });
  it("never marks incomplete six-month scan ready or returns partial source data", () => {
    const selected = selections(); selected[1].selection.complete = false; const result = buildProfitBoardReadResult({ identity, input, selections: selected });
    expect(result.status).toBe("invalid"); expect(result.sources).toEqual([]); expect(result.pageRows).toEqual([]);
  });
  it.each(["missing", "not_found", "invalid"] as const)("has explicit empty %s failure", status => {
    const result = buildProfitBoardReadFailure({ identity, input, status, reasonCode: "explicit", missingReason: "不可读取" }); expect(result.status).toBe(status); expect(result.page.totalRows).toBe(0); expect(result.partitions).toEqual([]);
  });
  it("requires all six distinct selected month receipts", () => {
    expect(() => buildProfitBoardReadResult({ identity, input, selections: selections().slice(1) })).toThrow(ProfitBoardReadError);
    const values = selections(); values[0].month = values[1].month; expect(() => buildProfitBoardReadResult({ identity, input, selections: values })).toThrow(ProfitBoardReadError);
  });
  it.each(["workspace", "completed", "lastid", "count", "source"])("rejects forged winner %s", kind => {
    const values = selections(), selected = values[5].selection;
    if (kind === "workspace") selected.selected!.batch.workspaceId = 99;
    if (kind === "completed") selected.selected!.batch.status = "deleted";
    if (kind === "lastid") selected.scannedBatchIds = [91];
    if (kind === "count") selected.selected!.batch.totalRows = 99;
    if (kind === "source") selected.selected!.rows[0].batchId = 91;
    expect(() => buildProfitBoardReadResult({ identity, input, selections: values })).toThrow(ProfitBoardReadError);
  });
});

describe("regressions against original friend profit aggregation", () => {
  it("does not turn a missing prior parent into zero or a fabricated new-profit ranking", () => {
    const result = build([row({ parentAsin: "A", financialProfit: 10 }), row({ yearMonth: "2026-09", parentAsin: "B", asin: "B", financialProfit: 20 })]);
    const product = result.products.find(product => product.parentAsin === "A")!;
    expect(product.previous.status).toBe("missing_product"); expect(product.previous.profit).toBeNull(); expect(product.comparison.profit.delta).toBeNull(); expect(result.partitions[0].rising).toEqual([]);
    expect(result.partitions[0].trend[5]).toMatchObject({ status: "partial", profit: 10, observedProducts: 1, missingProducts: 1 });
  });
  it("partitions currencies and excludes other store/site before aggregation", () => {
    const result = build([row({ financialProfit: 100 }), row({ asin: "CAD", raw: { currency: "CAD" }, financialProfit: 200 }), row({ asin: "OTHER", storeName: "Other", financialProfit: 999 }), row({ asin: "CA", site: "CA", financialProfit: 999 })]);
    expect(result.partitions).toHaveLength(2); expect(result.partitions.map(partition => partition.trend[5].profit).sort()).toEqual([100, 200]); expect(result.pageRows).toHaveLength(2);
  });
  it("never adds a reported parent total to its child-derived total", () => {
    const result = build([row({ asin: "", financialProfit: 100 }), row({ financialProfit: 50 })]);
    expect(result.partitions.map(partition => [partition.basis, partition.trend[5].profit])).toEqual([["child_rows", 50], ["reported_parent_row", 100]]);
    expect(result.products.find(product => product.basis === "reported_parent_row")?.children).toEqual([]);
  });
  it("uses each month's historical parent identity and never current metadata reassignment", () => {
    const result = build([row({ yearMonth: "2026-09", parentAsin: "OLD", financialProfit: 5 }), row({ parentAsin: "NEW", financialProfit: 9 })]);
    expect(result.products.map(product => product.parentAsin).sort()).toEqual(["NEW", "OLD"]);
    expect(result.products.find(product => product.parentAsin === "NEW")!.previous.profit).toBeNull(); expect(result.products.find(product => product.parentAsin === "OLD")!.previous.profit).toBe(5);
    expect(result.pageRows.map(row => row.parentAsin)).toEqual(["OLD", "NEW"]);
  });
  it("keeps duplicate reported totals ambiguous instead of summing or picking one", () => {
    const result = build([row({ asin: "", sku: "P1", financialProfit: 100 }), row({ asin: "", sku: "P2", financialProfit: 200 })]);
    expect(result.products[0].current.status).toBe("ambiguous"); expect(result.products[0].current.profit).toBeNull(); expect(result.partitions[0].trend[5].profit).toBeNull(); expect(result.pageRows).toHaveLength(2);
  });
  it("keeps unallocated rows and ambiguous parents separate from all products and rankings", () => {
    const result = build([row({ parentAsin: "", asin: "U", financialProfit: 30 }), row({ asin: "AMB", raw: { currency: "USD", api: { parentAsinList: ["P1", "P2"] } }, financialProfit: 40 }), row({ financialProfit: 20 })]);
    const part = result.partitions.find(partition => partition.basis === "unallocated_rows")!; expect(part.trend[5].profit).toBe(70); expect(part.rising).toEqual([]); expect(result.products.filter(product => product.basis === "unallocated_rows").every(product => product.parentAsin === null)).toBe(true);
  });
  it("keeps unknown currency per original row without any cross-period amount comparisons", () => {
    const result = build([row({ raw: {}, financialProfit: 1 }), row({ raw: {}, asin: "B", financialProfit: 2 }), row({ raw: {}, yearMonth: "2026-09", financialProfit: 3 })]);
    expect(result.partitions).toHaveLength(3); expect(result.partitions.every(partition => partition.unknownSource && !partition.rising.length && !partition.falling.length)).toBe(true);
    expect(result.products.every(product => product.comparison.profit.delta === null && product.current.margin === null)).toBe(true); expect(result.pageRows.map(row => row.metrics.financialProfit)).toEqual([3, 1, 2]);
  });
});

describe("profit math, full parent drilldown, full-filter ranking and paging", () => {
  it("uses ratio of sums with numerator and denominator rather than averaging margins", () => {
    const result = build([row({ financialProfit: 10, salesAmount: 100 }), row({ asin: "B", financialProfit: 90, salesAmount: 300 })]);
    expect(result.products[0].current.margin).toBe(0.25); expect(result.products[0].current.marginBasis).toMatchObject({ numerator: 100, denominator: 400 });
  });
  it.each([null, 0, -1])("does not fabricate margin for unknown/non-positive sales %s", salesAmount => expect(build([row({ salesAmount })]).products[0].current.margin).toBeNull());
  it("preserves unknown versus true zero and raw negative profits", () => {
    const result = build([row({ financialProfit: null }), row({ asin: "B", financialProfit: 0 })]); expect(result.products[0].current.profit).toBeNull();
    const loss = build([row({ financialProfit: -10 }), row({ yearMonth: "2026-09", financialProfit: -20 })]); expect(loss.products[0].comparison.profit).toMatchObject({ delta: 10, relativePercent: 50, direction: "up" });
  });
  it.each([{ prior: 0, now: 5, transition: "new_profit" }, { prior: 0, now: -5, transition: "new_loss" }, { prior: -5, now: 5, transition: "loss_to_profit" }, { prior: 5, now: -5, transition: "profit_to_loss" }])("preserves zero/loss change meaning $transition", ({ prior, now, transition }) => {
    const result = build([row({ financialProfit: now }), row({ yearMonth: "2026-09", financialProfit: prior })]); expect(result.products[0].comparison.profit.transition).toBe(transition);
  });
  it("searches full historical parent groups while retaining every sibling and original row", () => {
    const result = build([row({ asin: "A", title: "First" }), row({ asin: "SECOND", title: "Needle" }), row({ parentAsin: "OTHER", asin: "C" })], { search: "needle" });
    expect(result.products).toHaveLength(1); expect(result.products[0].children.map(child => child.asin)).toEqual(["A", "SECOND"]); expect(result.pageRows).toHaveLength(2); expect(result.partitions[0].trend[5].profit).toBe(40);
  });
  it("preserves HTML-looking source names as plain data", () => expect(build([row({ title: "<script>alert(1)</script>" })]).products[0].title).toBe("<script>alert(1)</script>"));
  it("ranks all matching parents before page slicing and supplies an exact reachable product offset", () => {
    const rows = Array.from({ length: 12 }, (_, index) => [row({ parentAsin: `P${index.toString().padStart(2, "0")}`, asin: `A${index}`, financialProfit: index * 10 }), row({ parentAsin: `P${index.toString().padStart(2, "0")}`, asin: `A${index}`, yearMonth: "2026-09", financialProfit: 50 })]).flat();
    const result = build(rows, { groupLimit: 2 }); expect(result.products).toHaveLength(2); expect(result.page.totalGroups).toBe(12); expect(result.partitions[0].trend[5].profit).toBe(660);
    const top = result.partitions[0].rising[0]; expect(top.parentAsin).toBe("P11"); expect(top.productOffset).toBe(11);
    const target = build(rows, { groupLimit: 2, groupOffset: 10 }); expect(target.products.some(product => product.id === top.productId)).toBe(true); expect(target.pageRows).toHaveLength(4);
    expect(result.partitions[0].rising).toHaveLength(5); expect(result.partitions[0].falling).toHaveLength(5);
  });
  it("does not split an original ASIN across its multiple SKU rows", () => {
    const result = build([row({ sku: "ONE" }), row({ sku: "TWO" })]); expect(result.products[0].children).toHaveLength(1); expect(result.products[0].children[0].skus).toEqual(["ONE", "TWO"]); expect(result.products[0].children[0].current.profit).toBe(40);
  });
  it("distinguishes no search match from storage/source failure", () => {
    const result = build(undefined, { search: "nothing" }); expect(result.status).toBe("ready"); expect(result.page.totalGroups).toBe(0); expect(result.sources).toHaveLength(6);
  });
});

describe("whole-scope replacement and per-month current authorization", () => {
  it("selects the newer whole store/month batch before filtering a requested parent", () => {
    const newest = record([row({ parentAsin: "NEW", asin: "NEW" })], { id: 91 }), older = record([row({ parentAsin: "OLD" })]);
    const values = selections(); values[5].selection = findMonthlyFinancialSnapshot([newest, older], { yearMonth: "2026-10", storeName: "Store", country: "US" }, true);
    const result = buildProfitBoardReadResult({ identity, input: { ...input, parentAsin: "OLD" }, selections: values }); expect(result.sources[5].selectedBatchId).toBe(91); expect(result.products).toEqual([]); expect(result.pageRows).toEqual([]);
  });
  it("does not authorize earlier months using a later month's owner receipt", () => {
    const values = selections([row(), row({ yearMonth: "2026-09", financialProfit: 30 })], true); values[4].authorizedRowRefs = [];
    const result = buildProfitBoardReadResult({ identity, input, selections: values });
    expect(result.products[0].previous.status).toBe("not_visible"); expect(result.products[0].previous.profit).toBeNull(); expect(result.partitions[0].rising).toEqual([]); expect(result.pageRows).toHaveLength(1);
    expect(result.sources[4]).toMatchObject({ status: "not_visible", batch: null, selectedBatchId: null, visibleRows: 0, selection: { scannedCount: null } });
  });
  it("makes missing and unauthorized scoped months indistinguishable without filenames/hashes/counts", () => {
    const values = selections([row(), row({ yearMonth: "2026-09" })], true); values[4].authorizedRowRefs = [];
    const result = buildProfitBoardReadResult({ identity, input, selections: values });
    const { month: _one, ...absent } = result.sources[0], { month: _two, ...denied } = result.sources[4]; expect(absent).toEqual(denied);
    expect(JSON.stringify(result.sources)).not.toContain("source.xlsx"); expect(JSON.stringify(result.sources)).not.toContain("fileHash"); expect(JSON.stringify(result.sources)).not.toContain("totalRows");
  });
  it.each(["missing", "outside", "duplicate"])("rejects %s authorization membership", kind => {
    const values = selections(undefined, true);
    if (kind === "missing") delete values[5].authorizedRowRefs;
    if (kind === "outside") values[5].authorizedRowRefs = [{ batchId: 90, rowIndex: 999 }];
    if (kind === "duplicate") values[5].authorizedRowRefs = [{ batchId: 90, rowIndex: 0 }, { batchId: 90, rowIndex: 0 }];
    expect(() => buildProfitBoardReadResult({ identity, input, selections: values })).toThrow(ProfitBoardReadError);
  });
  it("returns only authorized source rows and parents even if original batch contains secrets", () => {
    const values = selections([row(), row({ asin: "SECRET", parentAsin: "SECRET", title: "SECRET" })], true); values[5].authorizedRowRefs = [{ batchId: 90, rowIndex: 0 }];
    const result = buildProfitBoardReadResult({ identity, input, selections: values }); expect(JSON.stringify(result)).not.toContain("SECRET"); expect(result.page.totalRows).toBe(1);
  });
});

describe("strict response and bounded original data", () => {
  it.each(["identity", "request", "source", "metric", "margin", "rawscope", "rowref", "children", "page", "partition", "ranking", "sources_missing", "product_id", "child_id", "trend_source", "trend_ratio", "rank_offset", "raw_extra", "visible_count"])("rejects forged response %s", kind => {
    const result = clone(build([row({ financialProfit: 40 }), row({ yearMonth: "2026-09", financialProfit: 20 })]));
    if (kind === "identity") result.identity.workspaceId++;
    if (kind === "request") result.request.month = "2026-09";
    if (kind === "source") result.sources[5].selectedBatchId = 123;
    if (kind === "metric") result.products[0].current.profit = 999;
    if (kind === "margin") result.products[0].points[5].margin = 999;
    if (kind === "rawscope") result.pageRows[0].storeName = "Other";
    if (kind === "rowref") result.products[0].sourceRows[0].rowIndex = 99;
    if (kind === "children") result.products[0].children = [];
    if (kind === "page") result.page.hasMore = true;
    if (kind === "partition") result.partitions[0].currency = "CAD";
    if (kind === "ranking") result.partitions[0].rising[0].delta = 999;
    if (kind === "sources_missing") result.sources = [];
    if (kind === "product_id") result.products[0].id = "wrong";
    if (kind === "child_id") result.products[0].children[0].id = "wrong";
    if (kind === "trend_source") result.partitions[0].trend[5].sourceRows[0].batchId = 999;
    if (kind === "trend_ratio") result.partitions[0].trend[5].marginBasis.denominator = 999;
    if (kind === "rank_offset") result.partitions[0].rising[0].productOffset = 999;
    if (kind === "raw_extra") result.pageRows.push(clone(result.pageRows[0]));
    if (kind === "visible_count") result.sources[5].visibleRows = 0;
    expect(ProfitBoardReadResultSchema.safeParse(result).success).toBe(false);
  });
  it("rejects nonfinite/cyclic original raw instead of dropping it", () => {
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(() => parseMonthlyFinancialBatch(record([row({ raw: cycle })]))).toThrow(); expect(() => parseMonthlyFinancialBatch(record([row({ financialProfit: Infinity })]))).toThrow();
  });
  it("does not mutate normalized source metrics or original raw data", () => {
    const values = selections(), before = clone(values); buildProfitBoardReadResult({ identity, input, selections: values }); expect(values).toEqual(before);
  });
});
