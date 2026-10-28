import { describe, expect, it } from "vitest";
import { buildProductFinancialTrend, defaultProductFinancialMonth } from "./productFinancialTrend";
import { buildNorthAmericaBoard } from "@shared/northAmericaBoard";
import { MONTHLY_FINANCIAL_METRICS, parseMonthlyFinancialBatch, type MonthlyFinancialBatchRecord } from "@shared/monthlyFinancialRead";

const scope = { parentAsin: "B000000009", storeName: "Store US", marketplace: "US" };
const date = new Date("2026-10-20T00:00:00Z");
function payload() {
  const raw = ["US", "CA", "MX"].map((country, index) => ({
    ...Object.fromEntries(MONTHLY_FINANCIAL_METRICS.map(key => [key, key === "financialProfit" ? (index + 1) * 10 : 0])),
    yearMonth: "2026-09", asin: "B000000001", sku: "sku", operator: "Alice",
    parentAsin: index ? "B000000001" : scope.parentAsin, storeName: `Store ${country}`, site: country,
    title: "Product", raw: { currency: "USD" },
  }));
  const text = JSON.stringify(raw), months = JSON.stringify(["2026-09"]);
  const rows = parseMonthlyFinancialBatch({ id: 1, workspaceId: 1, userId: 2, fileName: "report.json", fileHash: "a".repeat(64), status: "completed", totalRows: 3, skippedRows: 0, unallocatedRows: 0, months, payload: text, payloadBytes: Buffer.byteLength(text), monthsBytes: Buffer.byteLength(months), createdAt: "2026-10-15 00:00:00.000000", confirmedAt: "2026-10-15 00:00:00.000000", fileReferenceKind: "saihu_sync_run", sourceRunId: 1 } as MonthlyFinancialBatchRecord).rows;
  return buildNorthAmericaBoard(rows, [{ asin: "B000000001", parentAsin: scope.parentAsin, storeName: scope.storeName, country: "US", source: { table: "saihu_product_weekly", rowId: 1 } }], [])!;
}
describe("financial report trend", () => {
  it("switches only at Shanghai October 16, including year rollover", () => {
    expect(defaultProductFinancialMonth(new Date("2026-10-15T15:59:59Z"))).toBe("2026-08");
    expect(defaultProductFinancialMonth(new Date("2026-10-15T16:00:00Z"))).toBe("2026-09");
    expect(defaultProductFinancialMonth(new Date("2026-01-15T00:00:00Z"))).toBe("2025-11");
    expect(defaultProductFinancialMonth(new Date("2026-01-16T00:00:00Z"))).toBe("2025-12");
    expect(() => defaultProductFinancialMonth(new Date(NaN))).toThrow("INVALID_CALENDAR");
  });
  it("reads consolidated USD financial profit for the current parent, with six explicit months", () => {
    const points = buildProductFinancialTrend(payload(), scope, date);
    expect(points.map(point => point.yearMonth)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(points.map(point => point.financialProfit)).toEqual([null, null, null, null, null, 60]);
    expect(buildProductFinancialTrend(payload(), scope, new Date("2026-10-15T00:00:00Z")).map(point => point.yearMonth)).toEqual(["2026-03", "2026-04", "2026-05", "2026-06", "2026-07", "2026-08"]);
  });
  it("does not borrow another store, parent or site, or invent unavailable reports", () => {
    for (const input of [{ ...scope, storeName: "Other US" }, { ...scope, parentAsin: "B000000008" }, { ...scope, marketplace: "CA" }])
      expect(buildProductFinancialTrend(payload(), input, date).every(point => point.financialProfit === null)).toBe(true);
    expect(buildProductFinancialTrend(null, scope, date).every(point => point.financialProfit === null)).toBe(true);
  });
  it("preserves zero and losses while missing or non-finite values stay unknown", () => {
    const data = payload();
    for (const value of [0, -120, null, NaN]) {
      data.products[0].months["2026-09"].metrics.financialProfit = value;
      expect(buildProductFinancialTrend(data, scope, date).at(-1)?.financialProfit).toBe(Number.isFinite(value) ? value : null);
    }
  });
});
