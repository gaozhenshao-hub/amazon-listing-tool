import { describe, expect, it, vi } from "vitest";
import * as XLSX from "xlsx";
import { MONTHLY_PREVIEW_LIMITS, MonthlyPreviewError, parseMonthlyFinancialReportPreview as parse } from "../shared/monthlyFinancialReportPreview";

const workbookBoundary = vi.hoisted(() => ({ blocked: false, calls: 0 }));
vi.mock("xlsx", async importOriginal => {
  const actual = await importOriginal<typeof import("xlsx")>();
  return { ...actual, read: (...args: Parameters<typeof actual.read>) => {
    if (workbookBoundary.blocked) { workbookBoundary.calls++; throw new Error("independent review blocks workbook allocation"); }
    return actual.read(...args);
  } };
});

const csv = (rows: string[][]) => new TextEncoder().encode(rows.map(row => row.map(value => `"${value.replace(/"/g, '""')}"`).join(",")).join("\n"));
const flatHeaders = ["月份", "ASIN", "父ASIN", "店铺", "站点", "币种", "毛利润", "销量", "销售额", "退款量", "退货量"];
const flatRow = ["2026-04", "B000000001", "B000000009", "Store A", "US", "USD", "1", "5", "100", "0", "0"];

describe("independent review: source subtotals must not double-count", () => {
  it.each(["小计", "总销量"])("refuses a %s column mixed with FBA/FBM detail quantities", async subtotal => {
    const top = ["时间", "ASIN", "父ASIN", "店铺", "站点", "币种", "毛利润", "销量", "销量", "销量", "销售额", "退款量", "退货量"];
    const detail = ["时间", "ASIN", "父ASIN", "店铺", "站点", "币种", "毛利润", "FBA销量", "FBM销量", subtotal, "销售额", "退款量", "退货量"];
    const row = ["2026-04", "B000000001", "B000000009", "Store A", "US", "USD", "1", "2", "3", "5", "100", "0", "0"];
    await expect(parse({ bytes: csv([top, detail, row]), format: "csv" })).rejects.toMatchObject({ code: "HEADER_TOTAL_AMBIGUOUS" });
  });

  it("retains an identity-cell 小计 row as a source subtotal without adding it again", async () => {
    const subtotal = [...flatRow]; subtotal[1] = "小计"; subtotal[2] = "";
    const result = await parse({ bytes: csv([flatHeaders, flatRow, subtotal]), format: "csv" });
    expect(result.rows.map(row => row.kind)).toEqual(["data", "summary"]);
    expect(result.rows[1].cells[1].value).toBe("小计");
    expect(result.summaries[0].metrics.financialProfit.value).toBe("1");
    expect(result.summaries[0].metrics.salesQty.value).toBe("5");
    expect(result.summaries[0].sourceRows).toEqual([{ sheet: "CSV", rowNumber: 2 }]);
  });
});

describe("independent review: data text is not a second header", () => {
  it("keeps a flat report's first data row when its product title equals a known subheader", async () => {
    const first = [...flatRow, "FBA销量"], second = [...flatRow, "普通产品"];
    second[1] = "B000000002";
    const result = await parse({ bytes: csv([[...flatHeaders, "品名"], first, second]), format: "csv" });
    expect(result.rows).toHaveLength(2);
    expect(result.rows.map(row => row.title)).toEqual(["FBA销量", "普通产品"]);
    expect(result.rows.map(row => row.rowNumber)).toEqual([2, 3]);
  });
});

describe("independent review: ZIP local metadata must not bypass expansion admission", () => {
  it("rejects bit3 with an over-budget local usz before XLSX.read can allocate from it", async () => {
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([flatHeaders, flatRow]), "month");
    const bytes = new Uint8Array(XLSX.write(book, { type: "array", bookType: "xlsx", compression: true }));
    const view = new DataView(bytes.buffer), end = bytes.length - 22;
    const central = view.getUint32(end + 16, true), local = view.getUint32(central + 42, true);
    view.setUint16(central + 8, view.getUint16(central + 8, true) | 8, true);
    view.setUint16(local + 6, view.getUint16(local + 6, true) | 8, true);
    view.setUint32(local + 22, MONTHLY_PREVIEW_LIMITS.expandedEntryBytes + 1, true);
    workbookBoundary.calls = 0; workbookBoundary.blocked = true;
    let error: unknown;
    try { await parse({ bytes, format: "xlsx" }); } catch (cause) { error = cause; }
    finally { workbookBoundary.blocked = false; }
    // The read stub is intentional: never execute SheetJS's unsafe-size allocation in this regression.
    expect(workbookBoundary.calls).toBe(0);
    expect(error).toBeInstanceOf(MonthlyPreviewError);
  });
});
