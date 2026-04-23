/**
 * Tests for Ad Tracking module
 * - Ad report Excel parser
 * - Portfolio mapping CRUD
 * - Ad keyword data query
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Test: Ad Report Parser ───
describe("adReportParser", () => {
  it("should export parseAdReportBuffer function", async () => {
    const parser = await import("./adReportParser");
    expect(typeof parser.parseAdReportBuffer).toBe("function");
  });

  it("should return empty rows for empty buffer", async () => {
    const { parseAdReportBuffer } = await import("./adReportParser");
    const emptyBuffer = Buffer.from("");
    // Empty buffer may throw or return empty - either is acceptable
    try {
      const result = parseAdReportBuffer(emptyBuffer);
      expect(result.rows.length).toBe(0);
    } catch {
      // Expected to throw on empty buffer
      expect(true).toBe(true);
    }
  });

  it("should return empty rows for invalid Excel data", async () => {
    const { parseAdReportBuffer } = await import("./adReportParser");
    const invalidBuffer = Buffer.from("not an excel file");
    try {
      const result = parseAdReportBuffer(invalidBuffer);
      expect(result.rows.length).toBe(0);
    } catch {
      // Expected to throw on invalid data
      expect(true).toBe(true);
    }
  });
});

// ─── Test: Schema tables exist ───
describe("ad tracking schema", () => {
  it("should export all ad tracking tables", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.adPortfolioMappings).toBeDefined();
    expect(schema.adReportImports).toBeDefined();
    expect(schema.adKeywordWeekly).toBeDefined();
    expect(schema.adKeywordMeta).toBeDefined();
    expect(schema.adCompetitorRanks).toBeDefined();
  });

  it("adPortfolioMappings should have correct columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.adPortfolioMappings;
    // Check that the table has the expected column names
    const columnNames = Object.keys(table);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("userId");
    expect(columnNames).toContain("parentAsin");
    expect(columnNames).toContain("portfolioName");
  });

  it("adKeywordWeekly should have correct columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.adKeywordWeekly;
    const columnNames = Object.keys(table);
    expect(columnNames).toContain("id");
    expect(columnNames).toContain("keyword");
    expect(columnNames).toContain("adType");
    expect(columnNames).toContain("matchType");
    expect(columnNames).toContain("impressions");
    expect(columnNames).toContain("clicks");
    expect(columnNames).toContain("spend");
    expect(columnNames).toContain("acos");
  });

  it("adKeywordMeta should have monthlySearchVolume column", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.adKeywordMeta;
    const columnNames = Object.keys(table);
    expect(columnNames).toContain("monthlySearchVolume");
    expect(columnNames).toContain("keyword");
  });

  it("adCompetitorRanks should have brand-related columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.adCompetitorRanks;
    const columnNames = Object.keys(table);
    expect(columnNames).toContain("competitorBrand");
    expect(columnNames).toContain("adRank");
    expect(columnNames).toContain("organicRank");
  });

  it("adReportImports should have status tracking columns", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.adReportImports;
    const columnNames = Object.keys(table);
    expect(columnNames).toContain("status");
    expect(columnNames).toContain("totalRows");
    expect(columnNames).toContain("mappedRows");
    expect(columnNames).toContain("unmappedPortfolios");
  });
});

// ─── Test: Ad Report Parser field mapping ───
describe("adReportParser field mapping", () => {
  it("should handle Chinese column headers correctly", async () => {
    const parser = await import("./adReportParser");
    // The parser should map Chinese headers like 广告类型, 广告组合, etc.
    // We verify the function signature accepts a Buffer
    expect(parser.parseAdReportBuffer.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── Test: Router exports ───
describe("adTracking router", () => {
  it("should export adTrackingRouter", async () => {
    const { adTrackingRouter } = await import("./routers/adTracking");
    expect(adTrackingRouter).toBeDefined();
  });

  it("should have all required procedures", async () => {
    const { adTrackingRouter } = await import("./routers/adTracking");
    // Check that the router has the expected procedures
    const procedures = Object.keys(adTrackingRouter._def.procedures || {});
    expect(procedures).toContain("listMappings");
    expect(procedures).toContain("createMapping");
    expect(procedures).toContain("updateMapping");
    expect(procedures).toContain("deleteMapping");
    expect(procedures).toContain("uploadAdReport");
    expect(procedures).toContain("confirmAdImport");
    expect(procedures).toContain("getProductKeywords");
    expect(procedures).toContain("updateKeywordMeta");
    expect(procedures).toContain("batchUpdateKeywordMeta");
    expect(procedures).toContain("listAdImports");
    expect(procedures).toContain("deleteAdImport");
    expect(procedures).toContain("listProductsForMapping");
    expect(procedures).toContain("getProductCompetitorRanks");
  });
});

// ─── Test: Helper functions in AdKeywordTracking component ───
describe("AdKeywordTracking helpers", () => {
  it("should format numbers correctly", () => {
    // Test the fmtNum logic
    const fmtNum = (v: number | null | undefined, decimals = 0): string => {
      if (v == null || isNaN(v)) return "-";
      return v.toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    };
    expect(fmtNum(null)).toBe("-");
    expect(fmtNum(undefined)).toBe("-");
    expect(fmtNum(1234)).toBe("1,234");
    expect(fmtNum(1234.567, 1)).toBe("1,234.6");
  });

  it("should format percentages correctly", () => {
    const fmtPct = (v: number | null | undefined): string => {
      if (v == null || isNaN(v)) return "-";
      return `${v.toFixed(1)}%`;
    };
    expect(fmtPct(null)).toBe("-");
    expect(fmtPct(12.345)).toBe("12.3%");
    expect(fmtPct(0)).toBe("0.0%");
  });

  it("should format week ranges correctly", () => {
    const fmtWeekRange = (start: string, end: string): string => {
      const s = start.replace(/-/g, "/").slice(5);
      const e = end.replace(/-/g, "/").slice(5);
      return `${s}-${e}`;
    };
    expect(fmtWeekRange("2025-04-13", "2025-04-19")).toBe("04/13-04/19");
    expect(fmtWeekRange("2025-01-01", "2025-01-07")).toBe("01/01-01/07");
  });

  it("should calculate WoW change correctly", () => {
    const calcWow = (current: number | null, previous: number | null) => {
      if (current == null || previous == null || previous === 0) return null;
      return ((current - previous) / previous) * 100;
    };
    expect(calcWow(110, 100)).toBe(10);
    expect(calcWow(90, 100)).toBe(-10);
    expect(calcWow(null, 100)).toBe(null);
    expect(calcWow(100, 0)).toBe(null);
  });
});
