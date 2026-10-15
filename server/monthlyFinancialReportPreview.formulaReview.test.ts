import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import {
  MonthlyPreviewError,
  parseMonthlyFinancialReportPreview,
} from "../shared/monthlyFinancialReportPreview";

/** Tiny real OOXML fixtures. Repack with CFB so ZIP lengths and CRC are valid:
 * the admission decision must be about formula provenance, not a broken ZIP.
 */
function formulaWorkbook(formulaXml: string, renamedWorksheet = false): Uint8Array {
  const sheet = XLSX.utils.aoa_to_sheet([
    ["月份", "ASIN", "父ASIN", "店铺", "站点", "币种", "毛利润", "销量", "销售额", "退款量", "退货量"],
    ["2026-04", "B000000001", "B000000009", "Synthetic Store", "US", "USD", 99, 5, 100, 0, 0],
    ["2026-04", "B000000002", "B000000009", "Synthetic Store", "US", "USD", 1, 2, 10, 0, 0],
  ]);
  sheet.G2.f = "1+1";
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Synthetic");
  const zip = XLSX.CFB.read(XLSX.write(book, { type: "buffer", bookType: "xlsx" }), { type: "buffer" }) as {
    FileIndex: Array<{ name: string; content: Uint8Array; size: number }>;
    FullPaths: string[];
  };
  const worksheet = zip.FileIndex.find(entry => entry.name === "sheet1.xml")!;
  const xml = Buffer.from(worksheet.content as Uint8Array).toString("utf8");
  expect(xml.split("<f>1+1</f>")).toHaveLength(2);
  worksheet.content = Buffer.from(xml.replace("<f>1+1</f>", formulaXml));
  worksheet.size = worksheet.content.length;
  if (renamedWorksheet) {
    const index = zip.FileIndex.indexOf(worksheet);
    worksheet.name = "sheet1.data";
    zip.FullPaths[index] = zip.FullPaths[index].replace("sheet1.xml", "sheet1.data");
    for (const name of ["[Content_Types].xml", "workbook.xml.rels"]) {
      const part = zip.FileIndex.find(entry => entry.name === name)!;
      const body = Buffer.from(part.content).toString("utf8");
      expect(body).toContain("sheet1.xml");
      part.content = Buffer.from(body.replaceAll("sheet1.xml", "sheet1.data"));
      part.size = part.content.length;
    }
  }
  const bytes = new Uint8Array(XLSX.CFB.write(zip, { type: "buffer", fileType: "zip" }));
  expect(bytes.byteLength).toBeLessThan(32 * 1024);
  return bytes;
}

async function expectFormulaNotAdopted(formulaXml: string, renamedWorksheet = false) {
  let result;
  try {
    result = await parseMonthlyFinancialReportPreview({ bytes: formulaWorkbook(formulaXml, renamedWorksheet), format: "xlsx" });
  } catch (error) {
    // A deliberate unsupported-formula refusal is valid; an arbitrary parser
    // exception or malformed-container rejection does not prove this boundary.
    expect(error).toBeInstanceOf(MonthlyPreviewError);
    if (renamedWorksheet) expect((error as MonthlyPreviewError).code).toMatch(/^XLSX_/);
    else expect((error as Error).message).toMatch(/公式|formula/i);
    return;
  }
  const row = result.rows.find(candidate => candidate.rowNumber === 2)!;
  expect(row.metrics.financialProfit.value).toBeNull();
  expect(result.summaries[0].metrics.financialProfit.value).toBeNull();
  expect(row.cells[6].value).toBe(99);
  expect(row.cells[6].formula).toEqual(expect.any(String));
  expect(row.cells[6].formula).not.toBe("");
  expect(result.warnings.some(warning => warning.code === "FORMULA_NOT_EVALUATED")).toBe(true);
}

describe("independent review: OOXML formula markers survive or fail closed", () => {
  it("never treats a data-table formula's cached value as a saved profit", async () => {
    await expectFormulaNotAdopted('<f t="dataTable" ref="G2:G3" dt2D="0" r1="H2"/>');
  });

  it("does not skip formula admission when a relationship names a non-.xml worksheet part", async () => {
    await expectFormulaNotAdopted('<f t="dataTable" ref="G2:G3" dt2D="0" r1="H2"/>', true);
  });

  it.each([
    ["self-closing empty formula", "<f/>"],
    ["explicitly empty formula", "<f></f>"],
    ["shared formula without its definition", '<f t="shared" si="999"/>'],
    ["explicitly empty shared formula without its definition", '<f t="shared" si="999"></f>'],
  ])("does not silently lose %s and adopt its cache", async (_label, formula) => {
    await expectFormulaNotAdopted(formula);
  });

  it("still preserves a normal nonempty formula and its cache as evidence, not an amount", async () => {
    const result = await parseMonthlyFinancialReportPreview({ bytes: formulaWorkbook("<f>1+1</f>"), format: "xlsx" });
    expect(result.rows[0].cells[6]).toMatchObject({ value: 99, formula: "1+1" });
    expect(result.rows[0].metrics.financialProfit.value).toBeNull();
    expect(result.summaries[0].metrics.financialProfit.value).toBeNull();
  });
});
