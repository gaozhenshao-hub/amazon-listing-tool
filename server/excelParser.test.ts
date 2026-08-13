import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseExcelBuffer } from "./excelParser";

function createWorkbookBuffer(rows: unknown[][]): Buffer {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "产品表现");
  return XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("领星 ASIN 日粒度产品表现解析", () => {
  it("识别日期列并将领星 ASIN 表标记为日粒度", () => {
    const buffer = createWorkbookBuffer([
      ["日期", "ASIN", "父ASIN", "店铺", "国家", "销量", "结算毛利润", "Sessions-Browser", "SBV广告费", "FBA-可售", "FBA-在途"],
      ["2026-08-03", "B0TESTASIN", "B0PARENT", "美国店", "US", 3, "$9.5", 20, "$1", 40, 5],
    ]);

    const result = parseExcelBuffer(buffer, "产品表现ASIN（2026-08-03~2026-08-09，全部广告）.xlsx");

    expect(result.sourceType).toBe("lingxing");
    expect(result.dataGranularity).toBe("daily");
    expect(result.allRows[0]).toMatchObject({
      reportDate: "2026-08-03",
      asin: "B0TESTASIN",
      parentAsin: "B0PARENT",
      fbaAvailable: 40,
      fbaInTransit: 5,
      salesQty: 3,
    });
  });
});
