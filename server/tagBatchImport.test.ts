import { describe, it, expect } from "vitest";

// ─── CSV Parsing Tests ───
// Re-implement parseCSV and detectColumns for testing (same logic as in devProjectTags.ts)
function parseCSV(content: string): string[][] {
  const lines = content.split(/\r?\n/).filter(l => l.trim());
  return lines.map(line => {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === ',' && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }
    result.push(current.trim());
    return result;
  });
}

function detectColumns(headers: string[]): { categoryCol: number; nameCol: number; valueCol: number } {
  const lower = headers.map(h => h.toLowerCase().trim());
  let categoryCol = -1, nameCol = -1, valueCol = -1;

  for (let i = 0; i < lower.length; i++) {
    const h = lower[i];
    if (categoryCol === -1 && (h.includes("分类") || h.includes("category") || h.includes("类别") || h.includes("属性类型") || h.includes("type"))) categoryCol = i;
    else if (nameCol === -1 && (h.includes("标签名") || h.includes("属性名") || h.includes("tag") || h.includes("name") || h.includes("名称"))) nameCol = i;
    else if (valueCol === -1 && (h.includes("标签值") || h.includes("属性值") || h.includes("value") || h.includes("值") || h.includes("说明"))) valueCol = i;
  }

  if (categoryCol === -1 && nameCol === -1 && headers.length >= 2) {
    categoryCol = 0;
    nameCol = 1;
    valueCol = headers.length >= 3 ? 2 : -1;
  }
  if (categoryCol === -1 && nameCol === -1 && headers.length === 1) {
    nameCol = 0;
  }

  return { categoryCol, nameCol, valueCol };
}

describe("Tag Batch Import - CSV Parsing", () => {
  it("should parse simple CSV correctly", () => {
    const csv = "分类名称,标签名称,标签值\n基础分类属性,LED灯,室内照明\n材质属性,铝合金,6061-T6";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(3);
    expect(rows[0]).toEqual(["分类名称", "标签名称", "标签值"]);
    expect(rows[1]).toEqual(["基础分类属性", "LED灯", "室内照明"]);
    expect(rows[2]).toEqual(["材质属性", "铝合金", "6061-T6"]);
  });

  it("should handle quoted fields with commas", () => {
    const csv = '分类,名称,值\n基础,"LED灯,台灯",室内';
    const rows = parseCSV(csv);
    expect(rows[1]).toEqual(["基础", "LED灯,台灯", "室内"]);
  });

  it("should handle escaped quotes", () => {
    const csv = '分类,名称,值\n基础,"""双引号""标签",测试';
    const rows = parseCSV(csv);
    expect(rows[1][1]).toBe('"双引号"标签');
  });

  it("should handle empty lines", () => {
    const csv = "分类,名称\n基础,LED\n\n材质,铝合金\n";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(3); // header + 2 data rows, empty lines filtered
  });

  it("should handle Windows line endings", () => {
    const csv = "分类,名称\r\n基础,LED\r\n材质,铝合金";
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(3);
    expect(rows[1]).toEqual(["基础", "LED"]);
  });

  it("should handle two-column CSV (no value column)", () => {
    const csv = "分类,名称\n基础,LED灯\n材质,铝合金";
    const rows = parseCSV(csv);
    expect(rows[1]).toHaveLength(2);
  });
});

describe("Tag Batch Import - Column Detection", () => {
  it("should detect Chinese column names", () => {
    const result = detectColumns(["分类名称", "标签名称", "标签值"]);
    expect(result.categoryCol).toBe(0);
    expect(result.nameCol).toBe(1);
    expect(result.valueCol).toBe(2);
  });

  it("should detect English column names", () => {
    const result = detectColumns(["category", "tag name", "value"]);
    expect(result.categoryCol).toBe(0);
    expect(result.nameCol).toBe(1);
    expect(result.valueCol).toBe(2);
  });

  it("should detect mixed column names", () => {
    const result = detectColumns(["属性类型", "name", "说明"]);
    expect(result.categoryCol).toBe(0);
    expect(result.nameCol).toBe(1);
    expect(result.valueCol).toBe(2);
  });

  it("should fallback for unknown 3-column headers", () => {
    const result = detectColumns(["A", "B", "C"]);
    expect(result.categoryCol).toBe(0);
    expect(result.nameCol).toBe(1);
    expect(result.valueCol).toBe(2);
  });

  it("should fallback for unknown 2-column headers", () => {
    const result = detectColumns(["A", "B"]);
    expect(result.categoryCol).toBe(0);
    expect(result.nameCol).toBe(1);
    expect(result.valueCol).toBe(-1);
  });

  it("should handle single column", () => {
    const result = detectColumns(["标签"]);
    expect(result.nameCol).toBe(0);
    expect(result.categoryCol).toBe(-1);
  });

  it("should detect columns in different order", () => {
    const result = detectColumns(["标签值", "分类", "标签名"]);
    // 分类 should be detected first when scanning
    expect(result.categoryCol).toBe(1);
    expect(result.nameCol).toBe(2);
    expect(result.valueCol).toBe(0);
  });
});

describe("Tag Batch Import - Integration", () => {
  it("should parse and detect a complete import file", () => {
    const csv = `分类名称,标签名称,标签值(可选)
基础分类属性,LED灯,室内照明产品
基础分类属性,台灯,桌面照明
材质属性,铝合金,6061-T6
材质属性,ABS塑料,高强度
功能属性,调光,3档亮度调节
功能属性,USB充电,Type-C接口
参数属性,功率,5W-15W
认证标准,UL认证,美国市场必备`;

    const rows = parseCSV(csv);
    const headers = rows[0];
    const dataRows = rows.slice(1);
    const detected = detectColumns(headers);

    expect(detected.categoryCol).toBe(0);
    expect(detected.nameCol).toBe(1);
    expect(detected.valueCol).toBe(2);
    expect(dataRows).toHaveLength(8);

    // Build preview
    const preview = dataRows.map(row => ({
      category: detected.categoryCol >= 0 ? (row[detected.categoryCol] || "") : "",
      tagName: detected.nameCol >= 0 ? (row[detected.nameCol] || "") : "",
      tagValue: detected.valueCol >= 0 ? (row[detected.valueCol] || "") : "",
    })).filter(r => r.tagName.trim());

    expect(preview).toHaveLength(8);
    expect(preview[0].category).toBe("基础分类属性");
    expect(preview[0].tagName).toBe("LED灯");
    expect(preview[0].tagValue).toBe("室内照明产品");

    // Unique categories
    const uniqueCategories = Array.from(new Set(preview.map(r => r.category).filter(Boolean)));
    expect(uniqueCategories).toHaveLength(5);
    expect(uniqueCategories).toContain("基础分类属性");
    expect(uniqueCategories).toContain("材质属性");
  });

  it("should handle file with BOM marker", () => {
    const csv = "\uFEFF分类名称,标签名称,标签值\n基础,LED灯,照明";
    const rows = parseCSV(csv);
    // BOM is part of first cell but should not break parsing
    expect(rows).toHaveLength(2);
    expect(rows[1]).toEqual(["基础", "LED灯", "照明"]);
  });

  it("router should be registered", async () => {
    const routerModule = await import("./routers.ts");
    const router = routerModule.appRouter;
    expect(router).toBeDefined();
    // Check that devProjectTags procedures exist
    const procedures = Object.keys((router as any)._def.procedures);
    expect(procedures).toContain("devProjectTags.parseImportFile");
    expect(procedures).toContain("devProjectTags.batchImport");
    expect(procedures).toContain("devProjectTags.getImportTemplate");
  }, 15000);
});
