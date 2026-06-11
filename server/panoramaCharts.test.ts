import { describe, it, expect } from "vitest";

/**
 * Unit tests for PanoramaTable group chart visualization
 * Tests the data transformation logic used by the charts
 */

interface GroupSummary {
  tagValue: string;
  products: any[];
  count: number;
  monthlySalesSum: number;
  monthlyRevenueSum: number;
  priceAvg: number;
  ratingAvg: number;
  reviewCountSum: number;
  bsrAvg: number;
}

// Simulate the grouping logic from PanoramaTable
function computeGroupedData(
  filteredProducts: any[],
  tagMap: Record<string, Record<string, string>>,
  groupByTag: string
): GroupSummary[] {
  const groups: Record<string, any[]> = {};
  for (const p of filteredProducts) {
    const asinTags = tagMap[p.asin] || {};
    const tagVal = asinTags[groupByTag] || "(未标注)";
    if (!groups[tagVal]) groups[tagVal] = [];
    groups[tagVal].push(p);
  }
  return Object.entries(groups).map(([tagValue, products]) => {
    const count = products.length;
    const monthlySalesSum = products.reduce((s: number, p: any) => s + (Number(p.monthlySales) || 0), 0);
    const monthlyRevenueSum = products.reduce((s: number, p: any) => s + (Number(p.monthlyRevenue) || 0), 0);
    const pricesValid = products.filter((p: any) => Number(p.price) > 0);
    const priceAvg = pricesValid.length > 0 ? pricesValid.reduce((s: number, p: any) => s + Number(p.price), 0) / pricesValid.length : 0;
    const ratingsValid = products.filter((p: any) => Number(p.rating) > 0);
    const ratingAvg = ratingsValid.length > 0 ? ratingsValid.reduce((s: number, p: any) => s + Number(p.rating), 0) / ratingsValid.length : 0;
    const reviewCountSum = products.reduce((s: number, p: any) => s + (Number(p.reviewCount) || 0), 0);
    const bsrValid = products.filter((p: any) => Number(p.bsr) > 0);
    const bsrAvg = bsrValid.length > 0 ? bsrValid.reduce((s: number, p: any) => s + Number(p.bsr), 0) / bsrValid.length : 0;
    return { tagValue, products, count, monthlySalesSum, monthlyRevenueSum, priceAvg, ratingAvg, reviewCountSum, bsrAvg };
  });
}

// Simulate chart data transformation for bar chart
function toBarChartData(groupedData: GroupSummary[]) {
  return groupedData.map(g => ({
    name: g.tagValue.length > 6 ? g.tagValue.slice(0, 6) + '...' : g.tagValue,
    fullName: g.tagValue,
    月销量: g.monthlySalesSum,
    产品数: g.count,
  }));
}

// Simulate chart data transformation for pie chart
function toPieChartData(groupedData: GroupSummary[]) {
  return groupedData.map(g => ({
    name: g.tagValue,
    value: g.monthlySalesSum,
    count: g.count,
  }));
}

// Simulate chart data transformation for price distribution
function toPriceChartData(groupedData: GroupSummary[]) {
  return groupedData.map(g => ({
    name: g.tagValue.length > 6 ? g.tagValue.slice(0, 6) + '...' : g.tagValue,
    fullName: g.tagValue,
    均价: Number(g.priceAvg.toFixed(1)),
    平均评分: Number(g.ratingAvg.toFixed(2)),
  }));
}

const mockProducts = [
  { asin: "A1", monthlySales: 500, monthlyRevenue: 10000, price: 19.99, rating: 4.5, reviewCount: 100, bsr: 1000 },
  { asin: "A2", monthlySales: 300, monthlyRevenue: 6000, price: 24.99, rating: 4.2, reviewCount: 50, bsr: 2000 },
  { asin: "A3", monthlySales: 800, monthlyRevenue: 24000, price: 29.99, rating: 4.8, reviewCount: 200, bsr: 500 },
  { asin: "A4", monthlySales: 200, monthlyRevenue: 3000, price: 14.99, rating: 3.9, reviewCount: 30, bsr: 5000 },
  { asin: "A5", monthlySales: 600, monthlyRevenue: 15000, price: 24.99, rating: 4.6, reviewCount: 150, bsr: 800 },
  { asin: "A6", monthlySales: 100, monthlyRevenue: 1500, price: 14.99, rating: 4.0, reviewCount: 20, bsr: 8000 },
];

const mockTagMap: Record<string, Record<string, string>> = {
  "A1": { "价格段": "中端", "产品类型": "电子" },
  "A2": { "价格段": "中端", "产品类型": "家居" },
  "A3": { "价格段": "高端", "产品类型": "电子" },
  "A4": { "价格段": "低端", "产品类型": "家居" },
  "A5": { "价格段": "中端", "产品类型": "电子" },
  "A6": { "价格段": "低端", "产品类型": "家居" },
};

describe("PanoramaTable Group Charts - Data Transformation", () => {
  describe("computeGroupedData", () => {
    it("should correctly group products by tag", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "价格段");
      expect(grouped.length).toBe(3); // 中端, 高端, 低端
      const midRange = grouped.find(g => g.tagValue === "中端");
      expect(midRange).toBeDefined();
      expect(midRange!.count).toBe(3); // A1, A2, A5
    });

    it("should calculate correct sales sum per group", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "价格段");
      const midRange = grouped.find(g => g.tagValue === "中端")!;
      expect(midRange.monthlySalesSum).toBe(500 + 300 + 600); // 1400
      const highEnd = grouped.find(g => g.tagValue === "高端")!;
      expect(highEnd.monthlySalesSum).toBe(800);
      const lowEnd = grouped.find(g => g.tagValue === "低端")!;
      expect(lowEnd.monthlySalesSum).toBe(200 + 100); // 300
    });

    it("should calculate correct average price per group", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "价格段");
      const midRange = grouped.find(g => g.tagValue === "中端")!;
      const expectedAvg = (19.99 + 24.99 + 24.99) / 3;
      expect(midRange.priceAvg).toBeCloseTo(expectedAvg, 2);
    });

    it("should calculate correct average rating per group", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "产品类型");
      const electronics = grouped.find(g => g.tagValue === "电子")!;
      const expectedRating = (4.5 + 4.8 + 4.6) / 3;
      expect(electronics.ratingAvg).toBeCloseTo(expectedRating, 2);
    });

    it("should handle products without tags as '未标注'", () => {
      const productsWithMissing = [...mockProducts, { asin: "A7", monthlySales: 50, monthlyRevenue: 500, price: 9.99, rating: 3.5, reviewCount: 5, bsr: 10000 }];
      const grouped = computeGroupedData(productsWithMissing, mockTagMap, "价格段");
      const untagged = grouped.find(g => g.tagValue === "(未标注)");
      expect(untagged).toBeDefined();
      expect(untagged!.count).toBe(1);
    });

    it("should group by different tag dimensions correctly", () => {
      const byType = computeGroupedData(mockProducts, mockTagMap, "产品类型");
      expect(byType.length).toBe(2); // 电子, 家居
      const electronics = byType.find(g => g.tagValue === "电子")!;
      expect(electronics.count).toBe(3); // A1, A3, A5
      const home = byType.find(g => g.tagValue === "家居")!;
      expect(home.count).toBe(3); // A2, A4, A6
    });
  });

  describe("toBarChartData", () => {
    it("should truncate long tag names to 6 chars with ellipsis", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "产品类型");
      const barData = toBarChartData(grouped);
      // "电子" is 2 chars, should not be truncated
      const electronics = barData.find(d => d.fullName === "电子");
      expect(electronics!.name).toBe("电子");
    });

    it("should preserve fullName for tooltip display", () => {
      const grouped: GroupSummary[] = [{
        tagValue: "超长标签名称测试用例",
        products: [], count: 5, monthlySalesSum: 1000,
        monthlyRevenueSum: 5000, priceAvg: 20, ratingAvg: 4.5,
        reviewCountSum: 100, bsrAvg: 1000,
      }];
      const barData = toBarChartData(grouped);
      expect(barData[0].name).toBe("超长标签名称...");
      expect(barData[0].fullName).toBe("超长标签名称测试用例");
    });

    it("should include sales and count data", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "价格段");
      const barData = toBarChartData(grouped);
      const midRange = barData.find(d => d.fullName === "中端")!;
      expect(midRange.月销量).toBe(1400);
      expect(midRange.产品数).toBe(3);
    });
  });

  describe("toPieChartData", () => {
    it("should produce correct pie chart data with value and count", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "价格段");
      const pieData = toPieChartData(grouped);
      expect(pieData.length).toBe(3);
      const total = pieData.reduce((s, d) => s + d.value, 0);
      expect(total).toBe(500 + 300 + 800 + 200 + 600 + 100); // 2500
    });

    it("should calculate correct percentage shares", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "价格段");
      const pieData = toPieChartData(grouped);
      const total = pieData.reduce((s, d) => s + d.value, 0);
      const midRange = pieData.find(d => d.name === "中端")!;
      const midPercent = midRange.value / total;
      expect(midPercent).toBeCloseTo(1400 / 2500, 2);
    });
  });

  describe("toPriceChartData", () => {
    it("should produce correct price and rating data", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "价格段");
      const priceData = toPriceChartData(grouped);
      const midRange = priceData.find(d => d.fullName === "中端")!;
      expect(midRange.均价).toBeCloseTo((19.99 + 24.99 + 24.99) / 3, 1);
      expect(midRange.平均评分).toBeCloseTo((4.5 + 4.2 + 4.6) / 3, 2);
    });

    it("should round values to correct precision", () => {
      const grouped = computeGroupedData(mockProducts, mockTagMap, "产品类型");
      const priceData = toPriceChartData(grouped);
      const electronics = priceData.find(d => d.fullName === "电子")!;
      // Price should be 1 decimal place
      expect(String(electronics.均价).split('.')[1]?.length || 0).toBeLessThanOrEqual(1);
      // Rating should be 2 decimal places
      expect(String(electronics.平均评分).split('.')[1]?.length || 0).toBeLessThanOrEqual(2);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty product list", () => {
      const grouped = computeGroupedData([], mockTagMap, "价格段");
      expect(grouped.length).toBe(0);
    });

    it("should handle products with zero values", () => {
      const zeroProducts = [
        { asin: "A1", monthlySales: 0, monthlyRevenue: 0, price: 0, rating: 0, reviewCount: 0, bsr: 0 },
      ];
      const grouped = computeGroupedData(zeroProducts, mockTagMap, "价格段");
      const midRange = grouped.find(g => g.tagValue === "中端")!;
      expect(midRange.monthlySalesSum).toBe(0);
      expect(midRange.priceAvg).toBe(0); // no valid prices
      expect(midRange.ratingAvg).toBe(0); // no valid ratings
    });

    it("should handle single product group", () => {
      const singleProduct = [mockProducts[2]]; // A3 - 高端
      const grouped = computeGroupedData(singleProduct, mockTagMap, "价格段");
      expect(grouped.length).toBe(1);
      expect(grouped[0].tagValue).toBe("高端");
      expect(grouped[0].count).toBe(1);
      expect(grouped[0].priceAvg).toBe(29.99);
    });
  });
});
