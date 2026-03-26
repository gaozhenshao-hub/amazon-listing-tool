/**
 * Tests for Lingxing API data structure parsing fix.
 * 
 * Root cause: Lingxing API returns data in various structures:
 *   - Direct array: res.data = [...]
 *   - Records wrapper: res.data = { records: [...] }
 *   - List wrapper: res.data = { list: [...] }
 * 
 * The fix ensures all parsing locations handle all three formats.
 */
import { describe, it, expect } from "vitest";
import * as fs from "fs";

// Helper: simulate the unified parsing pattern used across all files
function parseApiData(rawData: any): any[] {
  const data = rawData || [];
  return Array.isArray(data) ? data : (data as any)?.records || (data as any)?.list || [];
}

describe("Lingxing API Data Structure Parsing", () => {
  it("should parse direct array format", () => {
    const rawData = [{ id: 1, name: "Item 1" }, { id: 2, name: "Item 2" }];
    const result = parseApiData(rawData);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
  });

  it("should parse records wrapper format", () => {
    const rawData = { records: [{ id: 1, name: "Item 1" }, { id: 2, name: "Item 2" }] };
    const result = parseApiData(rawData);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe(1);
  });

  it("should parse list wrapper format", () => {
    const rawData = { list: [{ id: 1, name: "Item 1" }] };
    const result = parseApiData(rawData);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it("should handle null/undefined data", () => {
    expect(parseApiData(null)).toEqual([]);
    expect(parseApiData(undefined)).toEqual([]);
  });

  it("should handle empty object", () => {
    const result = parseApiData({});
    // {} has no records or list, falls through to || [] which gives []
    expect(result).toEqual([]);
  });

  it("should handle empty array", () => {
    const result = parseApiData([]);
    expect(result).toEqual([]);
  });

  it("should handle records with empty array", () => {
    const result = parseApiData({ records: [] });
    expect(result).toEqual([]);
  });
});

describe("ProductOps Data Parsing Consistency", () => {
  it("should use records/list fallback pattern in getProductProfitSummary", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts", "utf-8");
    
    // Check profit data parsing
    expect(code).toContain("const profitRaw = profitRes.data || [];");
    expect(code).toContain("const profitList = Array.isArray(profitRaw) ? profitRaw : (profitRaw as any).records || (profitRaw as any).list || [];");
    
    // Check previous profit data parsing
    expect(code).toContain("const prevProfitRaw = prevProfitRes.data || [];");
    expect(code).toContain("const prevProfitList = Array.isArray(prevProfitRaw) ? prevProfitRaw : (prevProfitRaw as any).records || (prevProfitRaw as any).list || [];");
    
    // Check inventory data parsing
    expect(code).toContain("const invRaw = invRes.data || [];");
    expect(code).toContain("const invList = Array.isArray(invRaw) ? invRaw : (invRaw as any).records || (invRaw as any).list || [];");
    
    // Check ad data parsing
    expect(code).toContain("const adRaw = adRes.data || [];");
    expect(code).toContain("const adList = Array.isArray(adRaw) ? adRaw : (adRaw as any).records || (adRaw as any).list || [];");
  });

  it("should use records/list fallback pattern in syncPlanCurrentData", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts", "utf-8");
    
    // syncPlanCurrentData should handle both ASIN and MSKU API responses
    const syncPlanSection = code.substring(code.indexOf("syncPlanCurrentData:"), code.indexOf("syncReviewFromLingxing:"));
    expect(syncPlanSection).toContain("(rawData as any).records || (rawData as any).list");
    expect(syncPlanSection).toContain("(rawMsku as any).records || (rawMsku as any).list");
  });

  it("should use records/list fallback pattern in syncReviewFromLingxing", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts", "utf-8");
    
    const syncReviewSection = code.substring(code.indexOf("syncReviewFromLingxing:"));
    expect(syncReviewSection).toContain("(rawData as any).records || (rawData as any).list");
  });

  it("should use records/list fallback pattern in seller lists parsing", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts", "utf-8");
    
    // All seller list parsing should use records fallback
    expect(code).toContain("(sellerRaw as any)?.records || (sellerRaw as any)?.list");
    expect(code).toContain("(sellersRaw as any)?.records || (sellersRaw as any)?.list");
  });

  it("should use records/list fallback pattern in listing data parsing", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/productOps.ts", "utf-8");
    
    expect(code).toContain("(listingsRaw as any)?.records || (listingsRaw as any)?.list");
  });
});

describe("Operations Router Data Parsing Consistency", () => {
  it("should use records/list fallback in operations.ts seller parsing", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/operations.ts", "utf-8");
    
    expect(code).toContain("(rawSellers as any)?.records || (rawSellers as any)?.list");
  });

  it("should use records/list fallback in operations.ts listings parsing", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/operations.ts", "utf-8");
    
    expect(code).toContain("(listingsRaw as any)?.records || (listingsRaw as any)?.list");
  });
});

describe("ShippingBatch Router Data Parsing Consistency", () => {
  it("should use records/list fallback in shippingBatch.ts shipment parsing", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/shippingBatch.ts", "utf-8");
    
    expect(code).toContain("(shipmentRaw as any)?.records || (shipmentRaw as any)?.list");
  });
});

describe("SellerSprite Importer Column Mapping Compatibility", () => {
  it("should have simplified Chinese column name mappings in PRODUCT_COLUMN_MAP", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/sellerSpriteImporter.ts", "utf-8");
    
    // Original xlsx column names
    expect(code).toContain("'商品标题': 'title'");
    expect(code).toContain("'价格($)': 'price'");
    expect(code).toContain("'评分数': 'reviewCount'");
    
    // Simplified compatibility mappings
    expect(code).toContain("'标题': 'title'");
    expect(code).toContain("'价格': 'price'");
    expect(code).toContain("'评论数': 'reviewCount'");
    expect(code).toContain("'销量': 'monthlySales'");
    expect(code).toContain("'类目': 'category'");
  });

  it("should have English fallback column names", () => {
    const code = fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/sellerSpriteImporter.ts", "utf-8");
    
    expect(code).toContain("'Title': 'title'");
    expect(code).toContain("'Brand': 'brand'");
    expect(code).toContain("'Price': 'price'");
    expect(code).toContain("'Rating': 'rating'");
    expect(code).toContain("'Reviews': 'reviewCount'");
  });
});
