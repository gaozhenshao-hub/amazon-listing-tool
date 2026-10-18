import { describe, expect, it } from "vitest";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord, type MonthlyFinancialMetrics } from "./monthlyFinancialRead";
import { buildOperationsBoardEditionCapture, operationsBoardEditionHash, OperationsBoardEditionReadResultSchema, type OperationsBoardEditionReadResult } from "./operationsBoardEdition";
import { filterOperationsBoardEditionRowsByOperator, type OperationsBoardEditionOwnership } from "./operationsBoardEditionOwnership";
import { buildProductBoardReadResult, productBoardCalendarMonths, type ProductBoardMonthSelection } from "./productBoardRead";
import { buildProfitBoardReadResult, profitBoardMonths } from "./profitBoardRead";
import {
  buildOperationsBoardEditionProductProjection, buildOperationsBoardEditionProfitProjection,
  OperationsBoardEditionProductProjectionInputSchema, OperationsBoardEditionProfitProjectionInputSchema,
  OperationsBoardEditionProjectionError, type OperationsBoardEditionProductProjectionInput, type OperationsBoardEditionProfitProjectionInput,
} from "./operationsBoardEditionProjection";

// Synthetic protocol fixtures only. Source proofs below are generated from the
// actual monthly parser; projection never supplies invented upload metadata.
const identity = { userId: 7, workspaceId: 11 }, scope = { workspaceId: 11, storeName: "Store", country: "US" };
const stamp = "2026-10-18 10:00:00.000000", month = "2026-10";
const productInput: OperationsBoardEditionProductProjectionInput = { search: "", highReturnsOffset: 0, highProfitOffset: 0, losingOffset: 0, allOffset: 0, pageSize: 20 };
const profitInput: OperationsBoardEditionProfitProjectionInput = { search: "", groupOffset: 0, groupLimit: 20 };
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function row(patch: Record<string, unknown> = {}) {
  return { yearMonth: month, storeName: "Store", site: "US", parentAsin: "P", asin: "A", sku: "SKU", title: "Synthetic title", operator: "External display only",
    ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(metric => [metric, 0])) as MonthlyFinancialMetrics,
    financialProfit: 20, salesAmount: 100, salesQty: 10, raw: { currency: "USD", nested: { original: [-9, null, "<script>text only</script>"] } }, ...patch };
}
function fixture(rawRows = [row()], options: { archived?: boolean; empty?: boolean; scoped?: boolean; operatorId?: number; assignments?: Record<string, number[]> } = {}) {
  const record: MonthlyFinancialBatchRecord = { id: 90, workspaceId: 11, userId: 7, status: "completed", fileName: "SYNTHETIC_fixture.xlsx", fileHash: "a".repeat(64), totalRows: rawRows.length,
    skippedRows: 0, unallocatedRows: rawRows.filter(row => !row.parentAsin).length, months: [...new Set(rawRows.map(row => row.yearMonth))], createdAt: stamp, confirmedAt: stamp, fileReferenceKind: "storage", payload: rawRows };
  const parsed = parseMonthlyFinancialBatch(record), recordHash = operationsBoardEditionHash(record), rows = parsed.rows;
  const sources = [...new Set(rows.map(row => row.yearMonth))].sort().map(month => ({ month, batchId: record.id, recordHash, rowCount: rows.filter(row => row.yearMonth === month).length, origin: parsed.batch.origin }));
  const capture = buildOperationsBoardEditionCapture({ scope, month, scannedBatches: [{ id: record.id, recordHash }], sources, rows });
  const visible = rows.filter(row => ["child", "parent_only"].includes(row.allocation)), parents = [...new Set(visible.map(row => row.parentAsin))].sort();
  const ownershipParents: OperationsBoardEditionOwnership["parents"] = parents.map(parentAsin => ({ parentAsin, operatorIds: options.assignments?.[parentAsin] ?? [7], status: "resolved", basis: "confirmed_source_mapping", sourceMonth: visible.filter(row => row.parentAsin === parentAsin).map(row => row.yearMonth).sort().at(-1)! }));
  const ownership: OperationsBoardEditionOwnership = { version: 1, meaning: "current_authorization_not_historical_membership", visibility: options.scoped ? "scoped" : "full",
    operators: [...new Set(ownershipParents.flatMap(parent => parent.operatorIds))].sort((a, b) => a - b).map(userId => ({ userId, displayName: `Synthetic member ${userId}`, relation: userId === 7 ? "self" : options.scoped ? "direct_partner" : "workspace_owner" })),
    parents: ownershipParents, selectedOperatorId: null };
  const selected = filterOperationsBoardEditionRowsByOperator(rows, ownership, identity.userId, options.operatorId), archived = !!options.archived;
  const read = OperationsBoardEditionReadResultSchema.parse({ identity, scope,
    request: { expectedWorkspaceId: 11, scope: { storeName: "Store", country: "US" }, editionId: archived ? 500 : null, ...(options.operatorId === undefined ? {} : { operatorId: options.operatorId }) },
    state: { scope, version: 5, currentMonth: archived ? "2026-11" : month, currentEditionId: archived ? 900 : 500, status: options.empty ? "current_empty" : "current" },
    edition: { id: 500, scope, month, revision: 1, version: 2, kind: "original", status: archived ? "archived" : "current", originalEditionId: null, sourceHash: capture.sourceHash, createdAt: stamp, updatedAt: stamp, archivedAt: archived ? stamp : null },
    status: options.empty ? "current_empty" : "ready", reasonCode: null, visibility: options.scoped ? "scoped" : "full", authorizationHash: "b".repeat(64), rows: selected.rows,
    sources: sources.map(source => ({ ...source, rowCount: selected.rows.filter(row => row.yearMonth === source.month).length })).filter(source => source.rowCount > 0),
    coverage: { complete: true, meaning: options.operatorId === undefined ? "all_currently_authorized_edition_rows" : "all_currently_authorized_edition_rows_matching_operator", rowCount: selected.rows.length },
    ownership: selected.ownership, notes: [], viewKey: "c".repeat(64) });
  return { read, parsed, capture, record };
}
const product = (read: OperationsBoardEditionReadResult, patch: Partial<OperationsBoardEditionProductProjectionInput> = {}) => buildOperationsBoardEditionProductProjection({ read, input: { ...productInput, ...patch } });
const profit = (read: OperationsBoardEditionReadResult, patch: Partial<OperationsBoardEditionProfitProjectionInput> = {}) => buildOperationsBoardEditionProfitProjection({ read, input: { ...profitInput, ...patch } });

describe("complete edition financial presentation", () => {
  it("reuses the exact product and profit bodies without fabricating a live batch header", () => {
    const values = [row({ yearMonth: "2026-05" }), row({ yearMonth: "2026-09", financialProfit: -4 }), row({ financialProfit: 2020 }), row({ parentAsin: "Q", asin: "B", financialProfit: -3 })];
    const { read, parsed } = fixture(values), projectedProduct = product(read), projectedProfit = profit(read);
    const selections: ProductBoardMonthSelection[] = read.sources.map(source => ({ month: source.month, selection: { selected: parsed, scannedBatchIds: [90], complete: true }, metadataVisibility: "full" }));
    const liveProduct = buildProductBoardReadResult({ identity, input: projectedProduct.request, selections, history: { complete: true, scannedCount: 1, visibility: "full" } });
    const liveProfit = buildProfitBoardReadResult({ identity, input: projectedProfit.request, selections: profitBoardMonths(month).map(month => ({ month,
      selection: { selected: values.some(row => row.yearMonth === month) ? parsed : null, scannedBatchIds: [90], complete: true }, metadataVisibility: "full" })) });
    for (const key of ["periods", "products", "sections", "pageRows", "matchedRows"] as const) expect(projectedProduct[key]).toEqual(liveProduct[key]);
    for (const key of ["months", "previousMonth", "partitions", "products", "pageRows", "page", "analysisBasis"] as const) expect(projectedProfit[key]).toEqual(liveProfit[key]);
    expect(projectedProduct.header.sources).toEqual(read.sources); expect(projectedProfit.header.sources).toEqual(read.sources);
    expect(projectedProduct).not.toHaveProperty("sources"); expect(projectedProduct).not.toHaveProperty("history");
    for (const source of projectedProduct.header.sources) for (const key of ["batch", "fileName", "userId", "createdAt", "confirmedAt", "totalRows", "status"]) expect(source).not.toHaveProperty(key);
    expect(JSON.stringify(projectedProfit.header)).not.toContain("SYNTHETIC_fixture.xlsx");
  });
  it.each([false, true])("binds current/archived metadata and calendar, archived=%s", archived => {
    const { read } = fixture([row()], { archived });
    const result = profit(read); expect(result.request.month).toBe(month); expect(result.months.at(-1)).toBe(month);
    expect(result.header.meaning).toBe(archived ? "immutable_edition_under_current_authorization" : "current_edition_under_current_authorization");
    expect(result.header.edition).toEqual(read.edition); expect(result.header.state).toEqual(read.state); expect(result.header.authorizationHash).toBe(read.authorizationHash);
  });
  it("keeps an empty current month empty while retaining older history, never falling back to an archived period", () => {
    const { read } = fixture([row({ yearMonth: "2026-09", financialProfit: -9 })], { empty: true });
    const products = product(read), profits = profit(read);
    expect(products.header.readStatus).toBe("current_empty"); expect(products.periods.month.start).toBe(month); expect(products.products[0].financial).toMatchObject({ status: "missing", profit: null, qty: null });
    expect(products.products[0].rates.total.profit).toBe(-9); expect(profits.products[0].current).toMatchObject({ status: "missing_month", profit: null, qty: null, sales: null, margin: null });
    expect(profits.products[0].previous.profit).toBe(-9); expect(profits.products[0].comparison.profit.delta).toBeNull(); expect(profits.partitions[0].rising).toEqual([]);
  });
  it("retains all 34 calendar months, complete children and month/quarter/total calculations", () => {
    const months = productBoardCalendarMonths("2024-01", month), { read } = fixture(months.map(yearMonth => row({ yearMonth, salesQty: 1, returnQty: 1, financialProfit: 1 })));
    const result = product(read); expect(result.periods.total.months).toEqual(months); expect(result.header.sources).toHaveLength(34); expect(result.pageRows).toHaveLength(34);
    expect(result.products[0].rates.total).toMatchObject({ salesQty: 34, returns: 34, profit: 34, coverage: { complete: true } });
    expect(result.products[0].rates.quarter.salesQty).toBe(3); expect(result.products[0].rates.month.salesQty).toBe(1); expect(result.products[0].children[0].sourceRows).toHaveLength(34);
    expect(profit(read).pageRows).toHaveLength(6); expect(profit(read).header.sources).toHaveLength(34);
  });
  it("shows missing-month coverage, unknown values and ratio-of-sums without imputing zero", () => {
    const { read } = fixture([row({ yearMonth: "2024-01", financialProfit: null }), row({ financialProfit: -4, salesAmount: 0 }), row({ asin: "B", financialProfit: 4, salesAmount: 100, salesQty: 0 })]);
    const products = product(read), profits = profit(read);
    expect(products.products[0].rates.total).toMatchObject({ profit: null, status: "partial", coverage: { complete: false, expectedMonths: 34 } });
    expect(products.products[0].rates.total.coverage.missingMonths).toHaveLength(32);
    expect(profits.partitions[0].trend[5]).toMatchObject({ profit: 0, sales: 100, qty: 10, margin: 0, marginBasis: { numerator: 0, denominator: 100 } });
    expect(profits.partitions[0].trend[4].profit).toBeNull();
  });
  it("ranks the complete selected population before paging all four product sections", () => {
    const values = Array.from({ length: 16 }, (_, index) => row({ parentAsin: `P${String(index).padStart(2, "0")}`, asin: `A${index}`, salesQty: 100, returnQty: 10, financialProfit: index < 3 ? 2000 + index : -index }));
    const { read } = fixture(values), result = product(read, { pageSize: 1 });
    expect(result.sections.all.page).toMatchObject({ totalProducts: 16, hasMore: true, nextOffset: 1 }); expect(result.sections.highReturns.page.totalProducts).toBe(16);
    expect(result.sections.highProfit.page.totalProducts).toBe(3); expect(result.sections.losing.page.totalProducts).toBe(10); expect(result.matchedRows).toBe(16);
    const profitId = result.sections.highProfit.entries[0].productId; expect(result.products.find(item => item.id === profitId)?.parentAsin).toBe("P02");
    const visited = Array.from({ length: 16 }, (_, allOffset) => product(read, { allOffset, pageSize: 1 }).sections.all.entries[0].productId); expect(new Set(visited).size).toBe(16);
  });
  it("computes all six trends and top-five increases/decreases outside the visible profit page", () => {
    const values = Array.from({ length: 14 }, (_, index) => [row({ yearMonth: "2026-09", parentAsin: `P${String(index).padStart(2, "0")}`, asin: `A${index}`, financialProfit: 100 }), row({ parentAsin: `P${String(index).padStart(2, "0")}`, asin: `A${index}`, financialProfit: index < 7 ? 200 + index : -index })]).flat();
    const { read } = fixture(values), result = profit(read, { groupLimit: 1 });
    expect(result.months).toHaveLength(6); expect(result.page).toMatchObject({ totalGroups: 14, totalRows: 28, hasMore: true, nextOffset: 1 });
    expect(result.partitions[0].rising).toHaveLength(5); expect(result.partitions[0].falling).toHaveLength(5); expect(result.partitions[0].rising[0].parentAsin).toBe("P06"); expect(result.partitions[0].falling[0].parentAsin).toBe("P13");
    expect(result.products[0].parentAsin).toBe("P00"); expect(result.partitions[0].trend[5].sourceRows).toHaveLength(14);
    expect(new Set(Array.from({ length: 14 }, (_, groupOffset) => profit(read, { groupOffset, groupLimit: 1 }).products[0].id)).size).toBe(14);
  });
  it("preserves repeated child ASINs with distinct SKUs and source refs, original signs and all metric details", () => {
    const values = [row(), row({ sku: "SECOND", commission: -7 }), row({ sku: "SKU2", asin: "B", financialProfit: 0 })], { read } = fixture(values), result = product(read);
    expect(result.pageRows).toHaveLength(3); expect(result.products[0].sourceRows).toHaveLength(3); expect(result.products[0].children).toHaveLength(2);
    expect(result.pageRows[1].metrics.commission).toBe(-7); expect(Object.keys(result.pageRows[0].metrics)).toEqual([...MONTHLY_FINANCIAL_METRICS]); expect(result.pageRows[0].raw).toEqual(values[0].raw);
    expect(result.pageRows[0].details).toBeDefined(); expect(result.products[0].financial.profit).toBe(40);
  });
  it("isolates unknown currency, ambiguous parents and duplicate reported totals rather than summing them", () => {
    const { read } = fixture([row({ raw: {} }), row({ asin: "B", raw: {} }), row({ asin: "", financialProfit: 100 }), row({ asin: "", financialProfit: 200 }), row({ parentAsin: "", asin: "U" }), row({ asin: "AMB", raw: { currency: "USD", api: { parentAsinList: ["P", "Q"] } } })]);
    const products = product(read), profits = profit(read);
    expect(products.products.filter(item => item.currency === null)).toHaveLength(2); expect(products.products.filter(item => item.basis === "unallocated_rows")).toHaveLength(2);
    expect(products.products.find(item => item.basis === "reported_parent_row")?.financial).toMatchObject({ status: "ambiguous", profit: null });
    expect(profits.products.find(item => item.basis === "reported_parent_row")?.current).toMatchObject({ status: "ambiguous", profit: null });
    expect(products.sections.highProfit.page.totalProducts).toBe(0); expect(profits.partitions.every(item => item.rising.length === 0 && item.falling.length === 0)).toBe(true);
  });
  it("uses the full server-filtered partner population without applying legacy self-only ownership", () => {
    const { read } = fixture([row({ yearMonth: "2024-01" }), row(), row({ parentAsin: "Q", asin: "Q", financialProfit: 9000 })], { scoped: true, operatorId: 8, assignments: { P: [8], Q: [7] } });
    const products = product(read), profits = profit(read);
    expect(products.request.operatorId).toBe(8); expect(products.header.ownership?.operators.map(item => item.relation)).toEqual(["self", "direct_partner"]);
    expect(products.matchedRows).toBe(2); expect(products.products.map(item => item.parentAsin)).toEqual(["P"]); expect(products.periods.total.months).toHaveLength(34);
    expect(products.header.coverage.meaning).toBe("all_currently_authorized_edition_rows_matching_operator"); expect(products.header.ownership?.parents).toHaveLength(2);
    expect(profits.page.totalRows).toBe(1); expect(profits.products[0].current.profit).toBe(20);
  });
  it("keeps full server coverage in the honest header while parent/search affect only local complete math", () => {
    const { read } = fixture([row(), row({ parentAsin: "Q", asin: "B", title: "Other visible" })]), before = clone(read);
    const scoped = product(read, { parentAsin: "P" }), searched = profit(read, { search: "Other visible" });
    expect(scoped.matchedRows).toBe(1); expect(scoped.header.coverage.rowCount).toBe(2); expect(scoped.header.sources[0].rowCount).toBe(2);
    expect(searched.page.totalGroups).toBe(1); expect(searched.products[0].parentAsin).toBe("Q"); expect(read).toEqual(before);
  });
  it("represents a known empty edition without fake products, source batches or amounts", () => {
    const { read } = fixture([], { empty: true });
    expect(product(read)).toMatchObject({ matchedRows: 0, products: [], pageRows: [], header: { readStatus: "current_empty", sources: [] } });
    expect(profit(read)).toMatchObject({ products: [], partitions: [], page: { totalGroups: 0, totalRows: 0 } });
  });
});

describe("edition projection is not a source or authorization shortcut", () => {
  it.each([{ month: "2026-11" }, { expectedWorkspaceId: 99 }, { storeName: "Other" }, { country: "CA" }, { operatorId: 8 }, { ownership: {} }])("rejects caller scope/calendar/owner override %j", patch => {
    expect(OperationsBoardEditionProductProjectionInputSchema.safeParse({ ...productInput, ...patch }).success).toBe(false);
    expect(OperationsBoardEditionProfitProjectionInputSchema.safeParse({ ...profitInput, ...patch }).success).toBe(false);
  });
  it.each(["coverage", "count", "source", "duplicate", "scope", "ownership", "extra_capture"])("refuses incomplete or forged %s read", kind => {
    const { read } = fixture(); const malformed: unknown = clone(read);
    const changed = malformed as OperationsBoardEditionReadResult;
    if (kind === "coverage") changed.coverage.rowCount++;
    if (kind === "count") changed.sources[0].rowCount++;
    if (kind === "source") changed.sources = [];
    if (kind === "duplicate") changed.rows.push(changed.rows[0]);
    if (kind === "scope") changed.rows[0].storeName = "Other";
    if (kind === "ownership") changed.ownership = null;
    if (kind === "extra_capture") Object.assign(changed, { capture: { private: true } });
    expect(() => product(changed)).toThrow(OperationsBoardEditionProjectionError); expect(() => profit(changed)).toThrow(OperationsBoardEditionProjectionError);
  });
  it.each(["unavailable", "not_found", "uninitialized"] as const)("never turns %s into an empty-success financial read", status => {
    const { read } = fixture(); const absent = { ...read, status, reasonCode: status, edition: null, rows: [], sources: [], notes: [], ownership: null, coverage: { ...read.coverage, rowCount: 0 } };
    expect(OperationsBoardEditionReadResultSchema.safeParse(absent).success).toBe(true);
    expect(() => product(absent)).toThrow("edition_unavailable"); expect(() => profit(absent)).toThrow("edition_unavailable");
  });
});
