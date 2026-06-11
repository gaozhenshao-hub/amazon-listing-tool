import { describe, it, expect } from "vitest";

// Test the grouping logic independently (same algorithm as the frontend useMemo)
interface Product {
  id: number;
  asin: string;
  monthlySales: number;
  monthlyRevenue: number;
  price: number;
  rating: number;
  reviewCount: number;
  bsr: number;
}

interface GroupSummary {
  tagValue: string;
  products: Product[];
  count: number;
  monthlySalesSum: number;
  monthlyRevenueSum: number;
  priceAvg: number;
  ratingAvg: number;
  reviewCountSum: number;
  bsrAvg: number;
}

function computeGroups(
  products: Product[],
  tagMap: Record<string, Record<string, string>>,
  groupByTag: string,
  sortField: string = "count",
  sortDir: "asc" | "desc" = "desc"
): GroupSummary[] {
  const groups: Record<string, Product[]> = {};
  for (const p of products) {
    const asinTags = tagMap[p.asin] || {};
    const tagVal = asinTags[groupByTag] || "(未标注)";
    if (!groups[tagVal]) groups[tagVal] = [];
    groups[tagVal].push(p);
  }
  const summaries: GroupSummary[] = Object.entries(groups).map(([tagValue, prods]) => {
    const count = prods.length;
    const monthlySalesSum = prods.reduce((s, p) => s + (Number(p.monthlySales) || 0), 0);
    const monthlyRevenueSum = prods.reduce((s, p) => s + (Number(p.monthlyRevenue) || 0), 0);
    const pricesValid = prods.filter(p => Number(p.price) > 0);
    const priceAvg = pricesValid.length > 0 ? pricesValid.reduce((s, p) => s + Number(p.price), 0) / pricesValid.length : 0;
    const ratingsValid = prods.filter(p => Number(p.rating) > 0);
    const ratingAvg = ratingsValid.length > 0 ? ratingsValid.reduce((s, p) => s + Number(p.rating), 0) / ratingsValid.length : 0;
    const reviewCountSum = prods.reduce((s, p) => s + (Number(p.reviewCount) || 0), 0);
    const bsrValid = prods.filter(p => Number(p.bsr) > 0);
    const bsrAvg = bsrValid.length > 0 ? bsrValid.reduce((s, p) => s + Number(p.bsr), 0) / bsrValid.length : 0;
    return { tagValue, products: prods, count, monthlySalesSum, monthlyRevenueSum, priceAvg, ratingAvg, reviewCountSum, bsrAvg };
  });
  summaries.sort((a, b) => {
    let va: number, vb: number;
    switch (sortField) {
      case "sales": va = a.monthlySalesSum; vb = b.monthlySalesSum; break;
      case "revenue": va = a.monthlyRevenueSum; vb = b.monthlyRevenueSum; break;
      case "price": va = a.priceAvg; vb = b.priceAvg; break;
      case "rating": va = a.ratingAvg; vb = b.ratingAvg; break;
      case "reviews": va = a.reviewCountSum; vb = b.reviewCountSum; break;
      case "bsr": va = a.bsrAvg; vb = b.bsrAvg; break;
      default: va = a.count; vb = b.count;
    }
    return sortDir === "desc" ? vb - va : va - vb;
  });
  return summaries;
}

const sampleProducts: Product[] = [
  { id: 1, asin: "B001", monthlySales: 500, monthlyRevenue: 10000, price: 20, rating: 4.5, reviewCount: 100, bsr: 1000 },
  { id: 2, asin: "B002", monthlySales: 300, monthlyRevenue: 6000, price: 20, rating: 4.0, reviewCount: 50, bsr: 2000 },
  { id: 3, asin: "B003", monthlySales: 800, monthlyRevenue: 24000, price: 30, rating: 4.8, reviewCount: 200, bsr: 500 },
  { id: 4, asin: "B004", monthlySales: 200, monthlyRevenue: 4000, price: 20, rating: 3.5, reviewCount: 30, bsr: 5000 },
  { id: 5, asin: "B005", monthlySales: 600, monthlyRevenue: 18000, price: 30, rating: 4.2, reviewCount: 150, bsr: 800 },
  { id: 6, asin: "B006", monthlySales: 100, monthlyRevenue: 1000, price: 10, rating: 3.0, reviewCount: 10, bsr: 10000 },
];

const sampleTagMap: Record<string, Record<string, string>> = {
  "B001": { "产品类型": "类型A", "价格段": "中端" },
  "B002": { "产品类型": "类型A", "价格段": "中端" },
  "B003": { "产品类型": "类型B", "价格段": "高端" },
  "B004": { "产品类型": "类型A", "价格段": "低端" },
  "B005": { "产品类型": "类型B", "价格段": "高端" },
  "B006": { "产品类型": "类型C", "价格段": "低端" },
};

describe("PanoramaTable Tag Grouping", () => {
  describe("computeGroups", () => {
    it("should group products by tag dimension", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型");
      expect(groups.length).toBe(3); // 类型A, 类型B, 类型C
      const typeA = groups.find(g => g.tagValue === "类型A");
      expect(typeA).toBeDefined();
      expect(typeA!.count).toBe(3); // B001, B002, B004
      const typeB = groups.find(g => g.tagValue === "类型B");
      expect(typeB).toBeDefined();
      expect(typeB!.count).toBe(2); // B003, B005
      const typeC = groups.find(g => g.tagValue === "类型C");
      expect(typeC).toBeDefined();
      expect(typeC!.count).toBe(1); // B006
    });

    it("should correctly calculate sales sum per group", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型");
      const typeA = groups.find(g => g.tagValue === "类型A")!;
      expect(typeA.monthlySalesSum).toBe(500 + 300 + 200); // 1000
      const typeB = groups.find(g => g.tagValue === "类型B")!;
      expect(typeB.monthlySalesSum).toBe(800 + 600); // 1400
    });

    it("should correctly calculate revenue sum per group", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型");
      const typeA = groups.find(g => g.tagValue === "类型A")!;
      expect(typeA.monthlyRevenueSum).toBe(10000 + 6000 + 4000); // 20000
    });

    it("should correctly calculate average price per group", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型");
      const typeA = groups.find(g => g.tagValue === "类型A")!;
      expect(typeA.priceAvg).toBe(20); // all $20
      const typeB = groups.find(g => g.tagValue === "类型B")!;
      expect(typeB.priceAvg).toBe(30); // all $30
    });

    it("should correctly calculate average rating per group", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型");
      const typeA = groups.find(g => g.tagValue === "类型A")!;
      expect(typeA.ratingAvg).toBeCloseTo((4.5 + 4.0 + 3.5) / 3, 2); // 4.0
      const typeB = groups.find(g => g.tagValue === "类型B")!;
      expect(typeB.ratingAvg).toBeCloseTo((4.8 + 4.2) / 2, 2); // 4.5
    });

    it("should correctly calculate review count sum per group", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型");
      const typeA = groups.find(g => g.tagValue === "类型A")!;
      expect(typeA.reviewCountSum).toBe(100 + 50 + 30); // 180
    });

    it("should correctly calculate average BSR per group", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型");
      const typeB = groups.find(g => g.tagValue === "类型B")!;
      expect(typeB.bsrAvg).toBeCloseTo((500 + 800) / 2, 0); // 650
    });

    it("should sort groups by count descending by default", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型");
      expect(groups[0].tagValue).toBe("类型A"); // 3 products
      expect(groups[1].tagValue).toBe("类型B"); // 2 products
      expect(groups[2].tagValue).toBe("类型C"); // 1 product
    });

    it("should sort groups by sales descending", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型", "sales", "desc");
      expect(groups[0].tagValue).toBe("类型B"); // 1400 sales
      expect(groups[1].tagValue).toBe("类型A"); // 1000 sales
    });

    it("should sort groups ascending", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "产品类型", "count", "asc");
      expect(groups[0].tagValue).toBe("类型C"); // 1 product
      expect(groups[groups.length - 1].tagValue).toBe("类型A"); // 3 products
    });

    it("should group by different tag dimension", () => {
      const groups = computeGroups(sampleProducts, sampleTagMap, "价格段");
      expect(groups.length).toBe(3); // 中端, 高端, 低端
      const mid = groups.find(g => g.tagValue === "中端");
      expect(mid).toBeDefined();
      expect(mid!.count).toBe(2); // B001, B002
    });

    it("should handle products without tags as (未标注)", () => {
      const tagMapPartial = { "B001": { "产品类型": "类型A" } };
      const groups = computeGroups(sampleProducts, tagMapPartial, "产品类型");
      const untagged = groups.find(g => g.tagValue === "(未标注)");
      expect(untagged).toBeDefined();
      expect(untagged!.count).toBe(5); // B002-B006
    });

    it("should handle empty products array", () => {
      const groups = computeGroups([], sampleTagMap, "产品类型");
      expect(groups.length).toBe(0);
    });

    it("should handle empty tagMap", () => {
      const groups = computeGroups(sampleProducts, {}, "产品类型");
      expect(groups.length).toBe(1);
      expect(groups[0].tagValue).toBe("(未标注)");
      expect(groups[0].count).toBe(6);
    });

    it("should handle products with zero values correctly", () => {
      const productsWithZeros: Product[] = [
        { id: 1, asin: "Z001", monthlySales: 0, monthlyRevenue: 0, price: 0, rating: 0, reviewCount: 0, bsr: 0 },
        { id: 2, asin: "Z002", monthlySales: 100, monthlyRevenue: 2000, price: 20, rating: 4.0, reviewCount: 50, bsr: 1000 },
      ];
      const tagMapZeros = { "Z001": { "类型": "A" }, "Z002": { "类型": "A" } };
      const groups = computeGroups(productsWithZeros, tagMapZeros, "类型");
      expect(groups[0].count).toBe(2);
      expect(groups[0].monthlySalesSum).toBe(100);
      expect(groups[0].priceAvg).toBe(20); // only Z002 has price > 0
      expect(groups[0].ratingAvg).toBe(4.0); // only Z002 has rating > 0
    });
  });
});
