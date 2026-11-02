import { describe, it, expect } from "vitest";
import { calcPriceSegmentsEnhanced, type ProductData, type TagData } from "./devStatsEngine";

const makeProduct = (overrides: Partial<ProductData> = {}): ProductData => ({
  asin: "B000TEST01",
  title: "Test Product",
  brand: "BrandA",
  price: "19.99",
  rating: "4.5",
  reviewCount: "100",
  monthlySales: 500,
  bsr: 1000,
  monthlyRevenue: "9995",
  listingDate: "2024-01-15",
  fulfillment: "FBA",
  sellerName: "Seller",
  sellerLocation: "US",
  variantCount: 1,
  category: "Kitchen",
  monthlySalesHistory: null,
  monthlyRevenueHistory: null,
  imageUrl: null,
  searchRank: 1,
  ...overrides,
});

describe("calcPriceSegmentsEnhanced", () => {
  it("returns empty array for empty products", () => {
    const result = calcPriceSegmentsEnhanced([], []);
    expect(result).toEqual([]);
  });

  it("returns empty array when all prices are 0", () => {
    const products = [makeProduct({ price: "0" }), makeProduct({ price: "0" })];
    const result = calcPriceSegmentsEnhanced(products, []);
    expect(result).toEqual([]);
  });

  it("correctly counts competitors (unique brands)", () => {
    const products = [
      makeProduct({ asin: "A1", brand: "BrandA", price: "15" }),
      makeProduct({ asin: "A2", brand: "BrandB", price: "18" }),
      makeProduct({ asin: "A3", brand: "BrandA", price: "12" }),
      makeProduct({ asin: "A4", brand: "BrandC", price: "14" }),
    ];
    const result = calcPriceSegmentsEnhanced(products, [], [{ min: 10, max: 20 }]);
    expect(result).toHaveLength(1);
    expect(result[0].competitorCount).toBe(3); // BrandA, BrandB, BrandC
  });

  it("correctly counts recent new listings (within 6 months)", () => {
    const now = new Date();
    const threeMonthsAgo = new Date(now);
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    const oneYearAgo = new Date(now);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const products = [
      makeProduct({ asin: "A1", price: "15", listingDate: threeMonthsAgo.toISOString().split("T")[0] }),
      makeProduct({ asin: "A2", price: "18", listingDate: oneYearAgo.toISOString().split("T")[0] }),
      makeProduct({ asin: "A3", price: "12", listingDate: threeMonthsAgo.toISOString().split("T")[0] }),
    ];
    const result = calcPriceSegmentsEnhanced(products, [], [{ min: 10, max: 20 }]);
    expect(result[0].recentNewCount).toBe(2);
    expect(result[0].recentNewPct).toBeCloseTo(2 / 3, 1);
  });

  it("correctly calculates tag distribution as proportions", () => {
    const products = [
      makeProduct({ asin: "A1", price: "15" }),
      makeProduct({ asin: "A2", price: "18" }),
      makeProduct({ asin: "A3", price: "12" }),
      makeProduct({ asin: "A4", price: "14" }),
    ];
    const tags: TagData[] = [
      { asin: "A1", dimensionName: "材质", dimensionValue: "不锈钢" },
      { asin: "A2", dimensionName: "材质", dimensionValue: "不锈钢" },
      { asin: "A3", dimensionName: "材质", dimensionValue: "塑料" },
      { asin: "A4", dimensionName: "材质", dimensionValue: "玻璃" },
      { asin: "A1", dimensionName: "颜色", dimensionValue: "黑色" },
      { asin: "A2", dimensionName: "颜色", dimensionValue: "白色" },
    ];
    const result = calcPriceSegmentsEnhanced(products, tags, [{ min: 10, max: 20 }]);
    expect(result[0].tagDistribution).toBeDefined();
    expect(result[0].tagDistribution["材质"]).toBeDefined();
    // 不锈钢: 2/4 = 0.5, 塑料: 1/4 = 0.25, 玻璃: 1/4 = 0.25
    expect(result[0].tagDistribution["材质"]["不锈钢"]).toBe(0.5);
    expect(result[0].tagDistribution["材质"]["塑料"]).toBe(0.25);
    expect(result[0].tagDistribution["材质"]["玻璃"]).toBe(0.25);
    // 颜色: 黑色 1/2 = 0.5, 白色 1/2 = 0.5
    expect(result[0].tagDistribution["颜色"]["黑色"]).toBe(0.5);
    expect(result[0].tagDistribution["颜色"]["白色"]).toBe(0.5);
  });

  it("returns asins list for each segment", () => {
    const products = [
      makeProduct({ asin: "A1", price: "15" }),
      makeProduct({ asin: "A2", price: "25" }),
      makeProduct({ asin: "A3", price: "12" }),
    ];
    const result = calcPriceSegmentsEnhanced(products, [], [
      { min: 10, max: 20 },
      { min: 20, max: 30 },
    ]);
    expect(result[0].asins).toContain("A1");
    expect(result[0].asins).toContain("A3");
    expect(result[0].asins).not.toContain("A2");
    expect(result[1].asins).toContain("A2");
  });

  it("calculates avgPrice, avgMonthlySales, avgMonthlyRevenue correctly", () => {
    const products = [
      makeProduct({ asin: "A1", price: "10", monthlySales: 100, monthlyRevenue: "1000" }),
      makeProduct({ asin: "A2", price: "20", monthlySales: 200, monthlyRevenue: "4000" }),
    ];
    const result = calcPriceSegmentsEnhanced(products, [], [{ min: 5, max: 25 }]);
    expect(result[0].avgPrice).toBe(15); // (10+20)/2
    expect(result[0].avgMonthlySales).toBe(150); // (100+200)/2
    expect(result[0].avgMonthlyRevenue).toBe(2500); // (1000+4000)/2
  });

  it("handles products with null listingDate gracefully", () => {
    const products = [
      makeProduct({ asin: "A1", price: "15", listingDate: null }),
      makeProduct({ asin: "A2", price: "18", listingDate: null }),
    ];
    const result = calcPriceSegmentsEnhanced(products, [], [{ min: 10, max: 20 }]);
    expect(result[0].recentNewCount).toBe(0);
    expect(result[0].recentNewPct).toBe(0);
  });

  it("handles case-insensitive brand deduplication", () => {
    const products = [
      makeProduct({ asin: "A1", brand: "BrandA", price: "15" }),
      makeProduct({ asin: "A2", brand: "branda", price: "18" }),
      makeProduct({ asin: "A3", brand: "BRANDA", price: "12" }),
    ];
    const result = calcPriceSegmentsEnhanced(products, [], [{ min: 10, max: 20 }]);
    expect(result[0].competitorCount).toBe(1); // All same brand
  });

  it("calculates salesShare correctly across multiple segments", () => {
    const products = [
      makeProduct({ asin: "A1", price: "10", monthlySales: 100 }),
      makeProduct({ asin: "A2", price: "20", monthlySales: 300 }),
      makeProduct({ asin: "A3", price: "30", monthlySales: 600 }),
    ];
    const result = calcPriceSegmentsEnhanced(products, [], [
      { min: 5, max: 15 },
      { min: 15, max: 25 },
      { min: 25, max: 35 },
    ]);
    // Total sales = 1000
    expect(result[0].salesShare).toBe(0.1); // 100/1000
    expect(result[1].salesShare).toBe(0.3); // 300/1000
    expect(result[2].salesShare).toBe(0.6); // 600/1000
  });
});
