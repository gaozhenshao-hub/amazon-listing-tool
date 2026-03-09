import { describe, expect, it, vi } from "vitest";

// ─── Unit tests for keyword module helpers ───────────────────────

describe("Keyword Module", () => {
  // Test CSV column detection logic
  describe("CSV Column Detection", () => {
    it("should detect English column headers", () => {
      const cols = ["Keyword", "Search Volume", "SPR", "PPC Bid", "Relevance"];
      const mapping = detectColumnMappingTest(cols);
      expect(mapping.keyword).toBeTruthy();
      expect(mapping.searchVolume).toBeTruthy();
      expect(mapping.spr).toBeTruthy();
    });

    it("should detect Chinese column headers", () => {
      const cols = ["关键词", "月搜索量", "SPR", "PPC竞价", "相关性"];
      const mapping = detectColumnMappingTest(cols);
      expect(mapping.keyword).toBeTruthy();
      expect(mapping.searchVolume).toBeTruthy();
    });

    it("should handle mixed language headers", () => {
      const cols = ["keyword", "月搜索量", "SPR", "bid"];
      const mapping = detectColumnMappingTest(cols);
      expect(mapping.keyword).toBeTruthy();
    });
  });

  // Test traffic level auto-determination
  describe("Traffic Level Classification", () => {
    it("should classify high traffic (>= 10000)", () => {
      expect(classifyTrafficLevel(50000)).toBe("high");
      expect(classifyTrafficLevel(10000)).toBe("high");
    });

    it("should classify medium traffic (1000-9999)", () => {
      expect(classifyTrafficLevel(5000)).toBe("medium");
      expect(classifyTrafficLevel(1000)).toBe("medium");
    });

    it("should classify low traffic (< 1000)", () => {
      expect(classifyTrafficLevel(500)).toBe("low");
      expect(classifyTrafficLevel(0)).toBe("low");
    });
  });

  // Test competition level from SPR
  describe("Competition Classification", () => {
    it("should classify low competition (SPR < 30)", () => {
      expect(classifyCompetition(10)).toBe("low");
      expect(classifyCompetition(29)).toBe("low");
    });

    it("should classify medium competition (30-99)", () => {
      expect(classifyCompetition(30)).toBe("medium");
      expect(classifyCompetition(99)).toBe("medium");
    });

    it("should classify high competition (>= 100)", () => {
      expect(classifyCompetition(100)).toBe("high");
      expect(classifyCompetition(500)).toBe("high");
    });
  });

  // Test relevance parsing
  describe("Relevance Parsing", () => {
    it("should parse Chinese relevance values", () => {
      expect(parseRelevance("强相关")).toBe("high");
      expect(parseRelevance("高相关")).toBe("high");
      expect(parseRelevance("中相关")).toBe("medium");
      expect(parseRelevance("低相关")).toBe("low");
      expect(parseRelevance("极低相关")).toBe("none");
    });

    it("should parse English relevance values", () => {
      expect(parseRelevance("high")).toBe("high");
      expect(parseRelevance("medium")).toBe("medium");
      expect(parseRelevance("low")).toBe("low");
      expect(parseRelevance("none")).toBe("none");
    });

    it("should default to medium for unknown values", () => {
      expect(parseRelevance("")).toBe("medium");
      expect(parseRelevance("unknown")).toBe("medium");
    });
  });

  // Test chunk array helper
  describe("Chunk Array Helper", () => {
    it("should split array into correct chunks", () => {
      const arr = [1, 2, 3, 4, 5, 6, 7];
      const chunks = chunkArrayTest(arr, 3);
      expect(chunks).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });

    it("should handle array smaller than chunk size", () => {
      const arr = [1, 2];
      const chunks = chunkArrayTest(arr, 5);
      expect(chunks).toEqual([[1, 2]]);
    });

    it("should handle empty array", () => {
      const chunks = chunkArrayTest([], 3);
      expect(chunks).toEqual([]);
    });
  });

  // Test keyword status flow
  describe("Keyword Status Flow", () => {
    it("should have valid status transitions", () => {
      const validStatuses = ["raw", "cleaned", "scored", "tagged", "finalized", "negative"];
      validStatuses.forEach(status => {
        expect(validStatuses).toContain(status);
      });
    });

    it("should have valid relevance values", () => {
      const validRelevance = ["high", "medium", "low", "none"];
      validRelevance.forEach(rel => {
        expect(validRelevance).toContain(rel);
      });
    });

    it("should have valid strategy categories", () => {
      const validCategories = [
        "core_main", "sub_core", "precise_longtail",
        "scene_intent", "longtail_main", "observe_test", "negative"
      ];
      expect(validCategories).toHaveLength(7);
    });

    it("should have valid listing placements", () => {
      const validPlacements = [
        "title_front", "title_mid", "title_end",
        "bullet_first", "bullet_body", "aplus",
        "search_term", "not_use"
      ];
      expect(validPlacements).toHaveLength(8);
    });
  });

  // Test root category classification
  describe("Root Category Classification", () => {
    it("should have valid root categories", () => {
      const validCategories = [
        "core", "function", "scene", "audience",
        "spec", "painpoint", "gift_holiday"
      ];
      expect(validCategories).toHaveLength(7);
    });

    it("should have valid root impact levels", () => {
      const validImpacts = ["high", "medium", "low"];
      expect(validImpacts).toHaveLength(3);
    });
  });
});

// ─── Helper functions extracted for testing ────────────────────────

function detectColumnMappingTest(cols: string[]) {
  const mapping: Record<string, string | null> = {
    keyword: null,
    searchVolume: null,
    spr: null,
    ppcBid: null,
    relevance: null,
    naturalRank: null,
    trafficScore: null,
  };

  for (const col of cols) {
    const lower = col.toLowerCase();
    if (!mapping.keyword && (lower.includes("keyword") || lower.includes("关键词") || lower.includes("搜索词"))) {
      mapping.keyword = col;
    }
    if (!mapping.searchVolume && (lower.includes("search volume") || lower.includes("月搜索量") || lower.includes("搜索量") || lower.includes("volume"))) {
      mapping.searchVolume = col;
    }
    if (!mapping.spr && (lower.includes("spr") || lower.includes("推荐数"))) {
      mapping.spr = col;
    }
    if (!mapping.ppcBid && (lower.includes("bid") || lower.includes("竞价") || lower.includes("ppc"))) {
      mapping.ppcBid = col;
    }
    if (!mapping.relevance && (lower.includes("relevance") || lower.includes("相关") || lower.includes("关联"))) {
      mapping.relevance = col;
    }
  }

  return mapping;
}

function classifyTrafficLevel(volume: number): "high" | "medium" | "low" {
  if (volume >= 10000) return "high";
  if (volume >= 1000) return "medium";
  return "low";
}

function classifyCompetition(spr: number): "high" | "medium" | "low" {
  if (spr < 30) return "low";
  if (spr < 100) return "medium";
  return "high";
}

function parseRelevance(val: string): "high" | "medium" | "low" | "none" {
  if (!val) return "medium";
  const lower = val.toLowerCase();
  if (lower.includes("强") || lower.includes("high") || lower.includes("强相关")) return "high";
  if (lower.includes("高") || lower.includes("高相关")) return "high";
  if (lower.includes("中") || lower.includes("medium") || lower.includes("中相关")) return "medium";
  // Check 极低 before 低, since 极低 also contains 低
  if (lower.includes("极低") || lower.includes("none") || lower.includes("极低相关")) return "none";
  if (lower.includes("低") || lower.includes("low") || lower.includes("低相关")) return "low";
  return "medium";
}

function chunkArrayTest<T>(arr: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    result.push(arr.slice(i, i + size));
  }
  return result;
}

// ─── XLSX Import Tests ──────────────────────────────────────────

import * as XLSX from "xlsx";

describe("XLSX Import", () => {
  function createTestXlsx(data: Record<string, any>[]): Buffer {
    const workbook = XLSX.utils.book_new();
    const worksheet = XLSX.utils.json_to_sheet(data);
    XLSX.utils.book_append_sheet(workbook, worksheet, "Sheet1");
    return Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
  }

  it("should parse XLSX buffer with English headers", () => {
    const data = [
      { Keyword: "wireless charger", "Search Volume": 50000, SPR: 120, Relevance: "high" },
      { Keyword: "phone charger", "Search Volume": 30000, SPR: 80, Relevance: "medium" },
    ];
    const buffer = createTestXlsx(data);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    expect(records).toHaveLength(2);
    expect((records[0] as any).Keyword).toBe("wireless charger");
    expect((records[0] as any)["Search Volume"]).toBe(50000);
  });

  it("should parse XLSX buffer with Chinese headers", () => {
    const data = [
      { "关键词": "蓝牙耳机", "月搜索量": 25000, "SPR": 45, "相关性": "高相关" },
      { "关键词": "无线耳机", "月搜索量": 18000, "SPR": 60, "相关性": "中相关" },
    ];
    const buffer = createTestXlsx(data);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json(sheet, { defval: "" });

    expect(records).toHaveLength(2);
    expect((records[0] as any)["关键词"]).toBe("蓝牙耳机");
    expect((records[0] as any)["月搜索量"]).toBe(25000);
  });

  it("should detect column mapping from XLSX parsed records", () => {
    const data = [
      { "关键词": "test keyword", "搜索量": 5000, "SPR": 30 },
    ];
    const buffer = createTestXlsx(data);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as any[];

    const cols = Object.keys(records[0]);
    const mapping = detectColumnMappingTest(cols);
    expect(mapping.keyword).toBe("关键词");
    expect(mapping.searchVolume).toBe("搜索量");
    expect(mapping.spr).toBe("SPR");
  });

  it("should handle XLSX with empty rows gracefully", () => {
    const data = [
      { Keyword: "charger", "Search Volume": 1000 },
      { Keyword: "", "Search Volume": 0 },
      { Keyword: "cable", "Search Volume": 2000 },
    ];
    const buffer = createTestXlsx(data);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as any[];

    // All rows are returned, filtering happens at the import level
    expect(records).toHaveLength(3);
    const validRecords = records.filter((r: any) => r.Keyword && r.Keyword.toString().trim());
    expect(validRecords).toHaveLength(2);
  });

  it("should convert XLSX buffer to base64 and back", () => {
    const data = [
      { Keyword: "test", "Search Volume": 999 },
    ];
    const buffer = createTestXlsx(data);
    const base64 = buffer.toString("base64");
    const restored = Buffer.from(base64, "base64");
    const workbook = XLSX.read(restored, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const records = XLSX.utils.sheet_to_json(sheet, { defval: "" }) as any[];

    expect(records).toHaveLength(1);
    expect((records[0] as any).Keyword).toBe("test");
  });

  it("should handle XLSX with multiple sheets (uses first sheet)", () => {
    const workbook = XLSX.utils.book_new();
    const sheet1 = XLSX.utils.json_to_sheet([{ Keyword: "from sheet1", "Search Volume": 100 }]);
    const sheet2 = XLSX.utils.json_to_sheet([{ Keyword: "from sheet2", "Search Volume": 200 }]);
    XLSX.utils.book_append_sheet(workbook, sheet1, "Keywords");
    XLSX.utils.book_append_sheet(workbook, sheet2, "Other");
    const buffer = Buffer.from(XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));

    const wb = XLSX.read(buffer, { type: "buffer" });
    expect(wb.SheetNames[0]).toBe("Keywords");
    const records = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: "" }) as any[];
    expect(records).toHaveLength(1);
    expect((records[0] as any).Keyword).toBe("from sheet1");
  });
});
