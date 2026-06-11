import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the database module
vi.mock("../drizzle/schema", () => ({
  competitorAnalyses: {
    id: "id",
    projectId: "projectId",
    asin: "asin",
  },
  users: {},
  projects: {},
  listings: {},
  reviewImports: {},
  projectFiles: {},
  analysisVersions: {},
  keywords: {},
  negativeKeywords: {},
  adStructures: {},
  listingVersions: {},
  reviewAggregations: {},
  loginLogs: {},
  rolePermissions: {},
  notifications: {},
}));

// Mock drizzle-orm
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((a, b) => ({ field: a, value: b, op: "eq" })),
  desc: vi.fn((a) => ({ field: a, op: "desc" })),
  and: vi.fn((...args) => ({ conditions: args, op: "and" })),
  or: vi.fn((...args) => ({ conditions: args, op: "or" })),
  inArray: vi.fn((a, b) => ({ field: a, values: b, op: "inArray" })),
  sql: vi.fn(),
}));

vi.mock("drizzle-orm/mysql2", () => ({
  drizzle: vi.fn(() => null),
}));

// Test the SellerSprite parser dedup logic directly
describe("SellerSprite Product Dedup", () => {
  it("should deduplicate products with same ASIN in parseSellerSpriteData", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");

    // Create CSV with duplicate ASINs
    const csvContent = [
      '"#","ASIN","商品标题","品牌","价格($)","月销量","评分"',
      '"1","B0DKS39YTL","Product A","BrandA","29.99","500","4.5"',
      '"2","B0DKS39YTL","Product A Variant","BrandA","31.99","300","4.3"',
      '"3","B0GG9MJJS1","Product B","BrandB","19.99","800","4.7"',
      '"4","B0GG9MJJS1","Product B Variant","BrandB","21.99","600","4.6"',
      '"5","B0GXFBZ9TW","Product C","BrandC","39.99","200","4.2"',
    ].join("\n");

    const result = parseSellerSpriteData(csvContent, undefined);

    expect(result.success).toBe(true);
    expect(result.products.length).toBe(3); // Only 3 unique ASINs
    expect(result.products[0].asin).toBe("B0DKS39YTL");
    expect(result.products[1].asin).toBe("B0GG9MJJS1");
    expect(result.products[2].asin).toBe("B0GXFBZ9TW");
    // Should keep first occurrence
    expect(result.products[0].title).toBe("Product A");
    expect(result.products[1].title).toBe("Product B");
  });

  it("should not deduplicate different ASINs", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");

    const csvContent = [
      '"#","ASIN","商品标题","品牌","价格($)","月销量"',
      '"1","B0AAAAAAA1","Product 1","Brand1","10.99","100"',
      '"2","B0AAAAAAA2","Product 2","Brand2","20.99","200"',
      '"3","B0AAAAAAA3","Product 3","Brand3","30.99","300"',
      '"4","B0AAAAAAA4","Product 4","Brand4","40.99","400"',
    ].join("\n");

    const result = parseSellerSpriteData(csvContent, undefined);

    expect(result.success).toBe(true);
    expect(result.products.length).toBe(4); // All unique
  });

  it("should handle ASIN case insensitivity in dedup", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");

    // Note: parseProductRow converts ASIN to uppercase
    const csvContent = [
      '"#","ASIN","商品标题","品牌","价格($)"',
      '"1","B0DKS39YTL","Product A","BrandA","29.99"',
      '"2","b0dks39ytl","Product A lower","BrandA","31.99"',
    ].join("\n");

    const result = parseSellerSpriteData(csvContent, undefined);

    expect(result.success).toBe(true);
    expect(result.products.length).toBe(1); // Same ASIN after uppercase
    expect(result.products[0].asin).toBe("B0DKS39YTL");
  });

  it("should report correct parsedRows count with dedup", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");

    const csvContent = [
      '"#","ASIN","商品标题","品牌","价格($)","月销量"',
      '"1","B0DKS39YTL","Product A","BrandA","29.99","500"',
      '"2","B0DKS39YTL","Product A Dup","BrandA","31.99","300"',
      '"3","B0GG9MJJS1","Product B","BrandB","19.99","800"',
    ].join("\n");

    const result = parseSellerSpriteData(csvContent, undefined);

    expect(result.success).toBe(true);
    expect(result.products.length).toBe(2);
    expect(result.parsedRows).toBe(2); // Only counts unique products
    expect(result.totalRows).toBe(3); // Total rows in file
  });
});

describe("upsertCompetitorAnalysis logic", () => {
  it("should export upsertCompetitorAnalysis function from db module", async () => {
    // This test verifies the function exists and is properly exported
    const dbModule = await import("./db");
    expect(typeof dbModule.upsertCompetitorAnalysis).toBe("function");
  });

  it("should export createCompetitorAnalysis function from db module (backward compat)", async () => {
    const dbModule = await import("./db");
    expect(typeof dbModule.createCompetitorAnalysis).toBe("function");
  });
});
