import { describe, expect, it } from "vitest";
import { consolidateNorthAmericaFinancialRows, resolveNorthAmericaFinancialBindings, type CurrentUsFinancialBinding } from "../../../shared/northAmericaFinancialConsolidation";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "../../../shared/monthlyFinancialRead";

const asin = "B000000001", parent = "B000000009";
const binding: CurrentUsFinancialBinding = { asin, parentAsin: parent, storeName: "1店-US", country: "US", source: { table: "saihu_product_weekly", rowId: 81 } };
function row(country: string, overrides: Record<string, unknown> = {}) {
  return { ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, 0])),
    yearMonth: "2026-09", parentAsin: country === "US" ? parent : asin, asin, sku: `${country}-SKU`, title: "Product", storeName: `1店-${country}`, site: country, operator: "Operator",
    salesQty: 10, salesAmount: 100, financialProfit: 20, raw: { currency: "USD" }, ...overrides };
}
function parsed(...rows: ReturnType<typeof row>[]) {
  return parseMonthlyFinancialBatch({ id: 1, workspaceId: 1, userId: 2, fileName: "report", fileHash: "a".repeat(64), status: "completed", totalRows: rows.length,
    skippedRows: 0, unallocatedRows: rows.filter(row => !row.parentAsin).length, months: ["2026-09"], payload: rows,
    createdAt: "2026-10-15 00:00:00.000000", confirmedAt: "2026-10-15 00:00:00.000000" } as MonthlyFinancialBatchRecord).rows;
}
describe("authorized US/CA/MX financial consolidation", () => {
  it("keeps discontinued products through the last known US identity and current identities win", () => {
    const old = parsed(row("US", { parentAsin: "B000000007" }))[0];
    const newer = { ...old, batchId: 2, parentAsin: "B000000008" };
    expect(resolveNorthAmericaFinancialBindings([], [old, newer])[0]).toMatchObject({ parentAsin: "B000000008", source: { table: "ops_monthly_profit_imports", batchId: 2, rowIndex: 0 } });
    expect(resolveNorthAmericaFinancialBindings([binding], [old, newer])).toEqual([binding]);
    expect(resolveNorthAmericaFinancialBindings([], parsed(row("CA")))).toEqual([]);
  });
  it("rejects ambiguous historical store/parent identities in the same latest batch", () => {
    expect(() => resolveNorthAmericaFinancialBindings([], parsed(row("US"), row("US", { storeName: "2店-US" })))).toThrow("IDENTITY_CONFLICT");
  });
  it("uses current US parents, merges USD once and retains every original row", () => {
    const rows = parsed(row("US"), row("CA"), row("MX"));
    const before = JSON.stringify(rows), result = consolidateNorthAmericaFinancialRows(rows, [binding]);
    expect(result.complete).toBe(true);
    expect(result.products).toHaveLength(1);
    expect(result.products[0]).toMatchObject({ parentAsin: parent, storeName: "1店-US", currency: "USD", metrics: { salesQty: 30, salesAmount: 300, financialProfit: 60 } });
    expect(result.products[0].children).toHaveLength(1);
    expect(result.products[0].members.map(member => member.original.country)).toEqual(["US", "CA", "MX"]);
    expect(result.products[0].members[1].original.parentAsin).toBe(asin);
    expect(JSON.stringify(rows)).toBe(before);
  });
  it("retains unallocated shop costs separately and excludes Brazil", () => {
    const result = consolidateNorthAmericaFinancialRows(parsed(row("US"), row("CA", { asin: "", parentAsin: "", salesQty: 0, salesAmount: 0, financialProfit: -8 }), row("BR")), [binding]);
    expect(result.unallocated).toHaveLength(1);
    expect(result.productTotals.financialProfit).toBe(20);
    expect(result.unallocatedTotals.financialProfit).toBe(-8);
    expect(result.reconciledTotals?.financialProfit).toBe(12);
    expect(result.excluded).toHaveLength(1);
  });
  it.each(["CAD", "MXN", null])("does not infer or relabel %s as USD", currency => {
    const result = consolidateNorthAmericaFinancialRows(parsed(row("CA", { raw: currency === null ? {} : { currency } })), [binding]);
    expect(result.complete).toBe(false); expect(result.reconciledTotals).toBeNull();
    expect(result.products).toHaveLength(0); expect(result.unresolved[0].reason).toBe("currency_not_usd");
  });
  it("keeps products with no current mapping visible as unresolved", () => {
    const result = consolidateNorthAmericaFinancialRows(parsed(row("MX")), []);
    expect(result.unresolved[0]).toMatchObject({ reason: "identity_missing", row: { asin } });
    expect(result.complete).toBe(false);
  });
  it("rejects conflicting current mappings and duplicate original references", () => {
    const rows = parsed(row("US"));
    expect(() => consolidateNorthAmericaFinancialRows(rows, [binding, { ...binding, parentAsin: "B000000008" }])).toThrow("IDENTITY_CONFLICT");
    expect(() => consolidateNorthAmericaFinancialRows([...rows, ...rows], [binding])).toThrow("DUPLICATE_SOURCE");
  });
  it("does not sum a reported parent total into child totals or hide missing metrics", () => {
    const result = consolidateNorthAmericaFinancialRows(parsed(row("US", { financialProfit: null }), row("CA", { asin: "" })), [binding]);
    expect(result.productTotals.financialProfit).toBeNull();
    expect(result.unresolved[0].reason).toBe("parent_total_not_additive");
  });
});
