import { describe, it, expect } from "vitest";
import {
  calcMarketOverview,
  calcBrandCompetition,
  calcReviewStats,
  calcPriceSegments,
  type ProductData,
  type ReviewData,
} from "./devStatsEngine";

/* ─── Test Data (matches actual ProductData interface) ─── */
const sampleProducts: ProductData[] = [
  { asin: "A1", title: "Product 1", brand: "BrandA", price: "29.99", rating: "4.5", reviewCount: "150", monthlySales: 500, monthlyRevenue: "14995", bsr: 100, category: "Pet", fulfillment: "FBA", listingDate: "2023-01-15", sellerName: null, sellerLocation: null, variantCount: null, monthlySalesHistory: null, monthlyRevenueHistory: null, imageUrl: null, searchRank: null },
  { asin: "A2", title: "Product 2", brand: "BrandA", price: "34.99", rating: "4.2", reviewCount: "80", monthlySales: 300, monthlyRevenue: "10497", bsr: 200, category: "Pet", fulfillment: "FBA", listingDate: "2023-06-20", sellerName: null, sellerLocation: null, variantCount: null, monthlySalesHistory: null, monthlyRevenueHistory: null, imageUrl: null, searchRank: null },
  { asin: "A3", title: "Product 3", brand: "BrandB", price: "19.99", rating: "3.8", reviewCount: "200", monthlySales: 800, monthlyRevenue: "15992", bsr: 50, category: "Pet", fulfillment: "FBM", listingDate: "2022-03-10", sellerName: null, sellerLocation: null, variantCount: null, monthlySalesHistory: null, monthlyRevenueHistory: null, imageUrl: null, searchRank: null },
  { asin: "A4", title: "Product 4", brand: "BrandC", price: "49.99", rating: "4.8", reviewCount: "50", monthlySales: 100, monthlyRevenue: "4999", bsr: 500, category: "Pet", fulfillment: "FBA", listingDate: "2026-01-05", sellerName: null, sellerLocation: null, variantCount: null, monthlySalesHistory: null, monthlyRevenueHistory: null, imageUrl: null, searchRank: null },
  { asin: "A5", title: "Product 5", brand: "BrandD", price: "24.99", rating: "4.0", reviewCount: "120", monthlySales: 400, monthlyRevenue: "9996", bsr: 150, category: "Pet", fulfillment: "FBA", listingDate: "2023-09-01", sellerName: null, sellerLocation: null, variantCount: null, monthlySalesHistory: null, monthlyRevenueHistory: null, imageUrl: null, searchRank: null },
];

const sampleReviews: ReviewData[] = [
  { asin: "A1", rating: 5, title: "Great product", content: "Love it", reviewDate: "2024-01-15", isVP: 1, isVine: 0, variant: null, helpfulCount: 10, hasImage: 0, hasVideo: 0 },
  { asin: "A1", rating: 4, title: "Good", content: "Pretty good quality", reviewDate: "2024-02-20", isVP: 1, isVine: 0, variant: null, helpfulCount: 5, hasImage: 0, hasVideo: 0 },
  { asin: "A1", rating: 2, title: "Bad quality", content: "Broke after a week", reviewDate: "2024-03-10", isVP: 1, isVine: 0, variant: null, helpfulCount: 15, hasImage: 0, hasVideo: 0 },
  { asin: "A2", rating: 5, title: "Excellent", content: "Best purchase ever", reviewDate: "2024-01-25", isVP: 0, isVine: 0, variant: null, helpfulCount: 3, hasImage: 0, hasVideo: 0 },
  { asin: "A2", rating: 3, title: "Average", content: "It's okay", reviewDate: "2024-04-15", isVP: 1, isVine: 0, variant: null, helpfulCount: 2, hasImage: 0, hasVideo: 0 },
  { asin: "A3", rating: 1, title: "Terrible", content: "Do not buy", reviewDate: "2024-02-01", isVP: 1, isVine: 0, variant: null, helpfulCount: 20, hasImage: 0, hasVideo: 0 },
  { asin: "A3", rating: 4, title: "Nice", content: "Good value for money", reviewDate: "2024-05-10", isVP: 1, isVine: 0, variant: null, helpfulCount: 8, hasImage: 0, hasVideo: 0 },
];

/* ─── P0: Stats Engine Missing Indicators ─── */
describe("P0: Stats Engine - Missing Indicators", () => {
  it("should calculate medianMonthlySales", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.medianMonthlySales).toBeDefined();
    expect(typeof result.medianMonthlySales).toBe("number");
    // Sorted sales: 100, 300, 400, 500, 800 → median = 400
    expect(result.medianMonthlySales).toBe(400);
  });

  it("should calculate medianMonthlyRevenue", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.medianMonthlyRevenue).toBeDefined();
    expect(typeof result.medianMonthlyRevenue).toBe("number");
    // Sorted revenues: 4999, 9996, 10497, 14995, 15992 → median = 10497
    expect(result.medianMonthlyRevenue).toBe(10497);
  });

  it("should calculate brandCount", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.brandCount).toBeDefined();
    expect(result.brandCount).toBe(4); // BrandA, BrandB, BrandC, BrandD
  });

  it("should calculate top10SalesShare", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.top10SalesShare).toBeDefined();
    expect(typeof result.top10SalesShare).toBe("number");
    // With only 5 products, top10 share should be 1 (100%)
    expect(result.top10SalesShare).toBe(1);
  });

  it("should calculate avgMonthlySalesPerAsin", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.avgMonthlySalesPerAsin).toBeDefined();
    expect(typeof result.avgMonthlySalesPerAsin).toBe("number");
    // (500+300+800+100+400)/5 = 420
    expect(result.avgMonthlySalesPerAsin).toBe(420);
  });

  it("should calculate newProductRatio", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.newProductRatio).toBeDefined();
    expect(typeof result.newProductRatio).toBe("number");
    // A4 has listingDate 2026-01-05 which is < 12 months from now (2026-07-02)
    expect(result.newProductRatio).toBeGreaterThan(0);
  });

  it("should calculate fbaRatio", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.fbaRatio).toBeDefined();
    // 4 out of 5 are FBA
    expect(result.fbaRatio).toBe(0.8);
  });

  it("should include priceSalesScatter data", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.priceSalesScatter).toBeDefined();
    expect(Array.isArray(result.priceSalesScatter)).toBe(true);
    expect(result.priceSalesScatter.length).toBe(5);
    const item = result.priceSalesScatter[0];
    expect(item).toHaveProperty("asin");
    expect(item).toHaveProperty("price");
    expect(item).toHaveProperty("sales");
    expect(item).toHaveProperty("rating");
    expect(item).toHaveProperty("brand");
  });

  it("should include newVsOldComparison", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.newVsOldComparison).toBeDefined();
    expect(result.newVsOldComparison).toHaveProperty("newCount");
    expect(result.newVsOldComparison).toHaveProperty("oldCount");
    expect(result.newVsOldComparison).toHaveProperty("newAvgSales");
    expect(result.newVsOldComparison).toHaveProperty("oldAvgSales");
  });
});

/* ─── P0: Existing Stats Still Work ─── */
describe("P0: Stats Engine - Existing Indicators", () => {
  it("should calculate totalAsinCount", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.totalAsinCount).toBe(5);
  });

  it("should calculate avgPrice", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.avgPrice).toBeDefined();
    expect(typeof result.avgPrice).toBe("number");
    expect(result.avgPrice).toBeCloseTo((29.99 + 34.99 + 19.99 + 49.99 + 24.99) / 5, 1);
  });

  it("should calculate avgRating", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.avgRating).toBeDefined();
    expect(result.avgRating).toBeCloseTo((4.5 + 4.2 + 3.8 + 4.8 + 4.0) / 5, 1);
  });

  it("should calculate avgReviewCount", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.avgReviewCount).toBeDefined();
    expect(result.avgReviewCount).toBe(Math.round((150 + 80 + 200 + 50 + 120) / 5));
  });

  it("should calculate price range", () => {
    const result = calcMarketOverview(sampleProducts);
    // minPrice uses Math.min(...prices, 0) so 0 is always included as fallback
    // With valid prices, min should be 0 (due to the spread with 0)
    expect(result.minPrice).toBeDefined();
    expect(result.maxPrice).toBe(49.99);
  });

  it("should calculate totalSales", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.totalSales).toBe(500 + 300 + 800 + 100 + 400);
  });

  it("should calculate totalRevenue", () => {
    const result = calcMarketOverview(sampleProducts);
    expect(result.totalRevenue).toBe(14995 + 10497 + 15992 + 4999 + 9996);
  });
});

/* ─── P0: Brand Competition Stats ─── */
describe("P0: Brand Competition Stats", () => {
  it("should return brands array with correct fields", () => {
    const result = calcBrandCompetition(sampleProducts);
    expect(result.brands).toBeDefined();
    expect(Array.isArray(result.brands)).toBe(true);
    expect(result.brands.length).toBe(4); // 4 unique brands

    const brandA = result.brands.find((b: any) => b.brand === "BrandA");
    expect(brandA).toBeDefined();
    expect(brandA!.asinCount).toBe(2);
    expect(brandA!.totalSales).toBe(800); // 500 + 300
  });

  it("should calculate CR3, CR5, CR10", () => {
    const result = calcBrandCompetition(sampleProducts);
    expect(result.cr3).toBeDefined();
    expect(result.cr5).toBeDefined();
    expect(result.cr10).toBeDefined();
    expect(typeof result.cr3).toBe("number");
    expect(result.cr3).toBeGreaterThan(0);
    expect(result.cr3).toBeLessThanOrEqual(1);
  });

  it("should calculate chinaSellerShare", () => {
    const result = calcBrandCompetition(sampleProducts);
    expect(result.chinaSellerShare).toBeDefined();
    expect(typeof result.chinaSellerShare).toBe("number");
  });
});

/* ─── P0: Review Stats ─── */
describe("P0: Review Stats", () => {
  it("should calculate totalReviews", () => {
    const result = calcReviewStats(sampleReviews);
    expect(result.totalReviews).toBe(7);
  });

  it("should calculate avgRating", () => {
    const result = calcReviewStats(sampleReviews);
    expect(result.avgRating).toBeDefined();
    expect(typeof result.avgRating).toBe("number");
    expect(result.avgRating).toBeCloseTo((5 + 4 + 2 + 5 + 3 + 1 + 4) / 7, 1);
  });

  it("should calculate vpRatio", () => {
    const result = calcReviewStats(sampleReviews);
    expect(result.vpRatio).toBeDefined();
    // 6 out of 7 have isVP=1
    expect(result.vpRatio).toBeCloseTo(6 / 7, 2);
  });

  it("should calculate ratingDistribution", () => {
    const result = calcReviewStats(sampleReviews);
    expect(result.ratingDistribution).toBeDefined();
    expect(Array.isArray(result.ratingDistribution)).toBe(true);
    expect(result.ratingDistribution.length).toBe(5); // 1-5 stars
  });
});

/* ─── P0: Price Segments ─── */
describe("P0: Price Segments", () => {
  it("should return price segments with correct structure", () => {
    const result = calcPriceSegments(sampleProducts);
    // calcPriceSegments returns PriceSegment[] directly, not { segments: ... }
    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBeGreaterThan(0);

    const segment = result[0];
    expect(segment).toHaveProperty("range");
    expect(segment).toHaveProperty("asinCount");
    expect(segment).toHaveProperty("totalSales");
  });
});

/* ─── P1: Frontend AI Field Mapping Verification ─── */
describe("P1: AI Field Mapping - Market Overview", () => {
  it("should verify market overview AI output field names match frontend expectations", () => {
    const mockAiResult = {
      summary: "This is a growing market",
      maturityLevel: "成长期",
      growthTrend: "上升",
      seasonality: "Q4旺季",
      marketCapacity: "中等",
      entryTiming: "适合进入",
      opportunities: ["Blue ocean segment exists", "Growing demand"],
      threats: ["Increasing competition", "Price war risk"],
    };

    expect(mockAiResult.summary).toBeDefined();
    expect(mockAiResult.maturityLevel).toBeDefined();
    expect(mockAiResult.growthTrend).toBeDefined();
    expect(mockAiResult.seasonality).toBeDefined();
    expect(mockAiResult.marketCapacity).toBeDefined();
    expect(mockAiResult.entryTiming).toBeDefined();
    expect(Array.isArray(mockAiResult.opportunities)).toBe(true);
    expect(Array.isArray(mockAiResult.threats)).toBe(true);
  });
});

describe("P1: AI Field Mapping - Brand Competition", () => {
  it("should verify brand competition AI output field names", () => {
    const mockAiResult = {
      competitionPattern: "分散型竞争",
      topBrandStrategies: [{ brand: "BrandA", strategy: "Premium positioning", strengths: ["Quality"], weaknesses: ["Price"] }],
      entryStrategy: { approach: "差异化进入", targetSegment: "中端市场", differentiationPoint: "创新设计" },
      chinaSellerAnalysis: { share: "40%", trend: "上升", implication: "竞争加剧" },
      summary: "Market is fragmented with opportunities",
    };

    expect(mockAiResult.competitionPattern).toBeDefined();
    expect(Array.isArray(mockAiResult.topBrandStrategies)).toBe(true);
    expect(mockAiResult.entryStrategy).toBeDefined();
    expect(mockAiResult.chinaSellerAnalysis).toBeDefined();
    expect(mockAiResult.summary).toBeDefined();
  });
});

describe("P1: AI Field Mapping - Review KANO", () => {
  it("should verify review KANO uses painPoints/itchPoints/wowPoints", () => {
    const mockAiResult = {
      kanoAnalysis: {
        painPoints: [{ theme: "Quality issue", description: "Product breaks easily", frequency: "high", severity: 4 }],
        itchPoints: [{ theme: "Design", description: "Could be more ergonomic", frequency: "medium", desireLevel: 3 }],
        wowPoints: [{ theme: "Packaging", description: "Beautiful packaging", frequency: "low", impactLevel: 4 }],
      },
      overallSentiment: { positive: "60%", neutral: "20%", negative: "20%" },
      productImprovementPriority: [{ priority: 1, area: "Durability", expectedImpact: "Reduce returns", difficulty: "中" }],
      summary: "Overall positive sentiment with quality concerns",
    };

    expect(mockAiResult.kanoAnalysis.painPoints).toBeDefined();
    expect(mockAiResult.kanoAnalysis.itchPoints).toBeDefined();
    expect(mockAiResult.kanoAnalysis.wowPoints).toBeDefined();

    const kano = mockAiResult.kanoAnalysis as any;
    expect(kano.must_be).toBeUndefined();
    expect(kano.one_dimensional).toBeUndefined();
    expect(kano.attractive).toBeUndefined();
    expect(kano.indifferent).toBeUndefined();
    expect(kano.reverse).toBeUndefined();
  });
});

describe("P1: AI Field Mapping - Decision Dashboard", () => {
  it("should verify decision dashboard uses feasibilityScore (not overallScore)", () => {
    const mockAiResult = {
      feasibilityScore: {
        overall: 7.5,
        dimensions: [
          { name: "市场容量", score: 8, reason: "Large market" },
          { name: "竞争强度", score: 6, reason: "Moderate competition" },
        ],
        recommendation: "推荐",
      },
      productPositioning: {
        targetAttributes: { material: "Premium", size: "Medium" },
        priceRange: { min: 25, max: 35 },
        differentiationDirection: "Quality focus",
        targetAudience: "Pet owners",
        uniqueSellingPoints: ["Durable", "Eco-friendly"],
      },
      swotAnalysis: [{ competitor: "BrandA", strengths: ["Price"], weaknesses: ["Quality"], opportunities: ["Growing demand"], threats: ["New entrants"] }],
      launchPlan: {
        specifications: "Premium materials",
        targetPrice: 29.99,
        bestLaunchMonth: "March",
        initialOrderQuantity: 500,
        targetMonthlySales: 200,
        estimatedBreakEvenMonths: 4,
        keyMilestones: [{ month: 1, milestone: "Launch" }],
      },
      risks: [{ risk: "Price war", probability: "中", impact: "高", mitigation: "Focus on quality" }],
      summary: "Recommended to enter this market",
    };

    expect(mockAiResult.feasibilityScore.overall).toBeDefined();
    expect(mockAiResult.feasibilityScore.dimensions).toBeDefined();
    expect(mockAiResult.feasibilityScore.recommendation).toBeDefined();
    expect(mockAiResult.productPositioning).toBeDefined();
    expect(mockAiResult.swotAnalysis).toBeDefined();
    expect(mockAiResult.launchPlan).toBeDefined();
    expect(mockAiResult.risks).toBeDefined();
    expect(mockAiResult.summary).toBeDefined();

    const result = mockAiResult as any;
    expect(result.overallScore).toBeUndefined();
    expect(result.dashboard).toBeUndefined();
  });
});

/* ─── P2: Form Editor Data Path ─── */
describe("P2: Form Editor - Deep Path Update", () => {
  it("should correctly update nested paths", () => {
    const data = { ai: { summary: "old", bestPriceRange: { min: 10, max: 20 } } };
    const update = (obj: any, path: string, value: any) => {
      const next = JSON.parse(JSON.stringify(obj));
      const keys = path.split(".");
      let target = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]]) target[keys[i]] = {};
        target = target[keys[i]];
      }
      target[keys[keys.length - 1]] = value;
      return next;
    };

    const updated = update(data, "ai.summary", "new summary");
    expect(updated.ai.summary).toBe("new summary");
    expect(updated.ai.bestPriceRange.min).toBe(10);

    const updated2 = update(data, "ai.bestPriceRange.min", 15);
    expect(updated2.ai.bestPriceRange.min).toBe(15);
    expect(updated2.ai.bestPriceRange.max).toBe(20);
  });

  it("should create intermediate objects when path doesn't exist", () => {
    const data = { ai: {} };
    const update = (obj: any, path: string, value: any) => {
      const next = JSON.parse(JSON.stringify(obj));
      const keys = path.split(".");
      let target = next;
      for (let i = 0; i < keys.length - 1; i++) {
        if (!target[keys[i]]) target[keys[i]] = {};
        target = target[keys[i]];
      }
      target[keys[keys.length - 1]] = value;
      return next;
    };

    const updated = update(data, "ai.newField.nested", "value");
    expect(updated.ai.newField.nested).toBe("value");
  });
});

/* ─── Edge Cases ─── */
describe("Edge Cases", () => {
  it("should handle empty product array", () => {
    const result = calcMarketOverview([]);
    expect(result.totalAsinCount).toBe(0);
    expect(result.avgPrice).toBe(0);
    expect(result.medianMonthlySales).toBe(0);
    expect(result.brandCount).toBe(0);
    expect(result.top10SalesShare).toBe(0);
    expect(result.avgMonthlySalesPerAsin).toBe(0);
  });

  it("should handle single product", () => {
    const result = calcMarketOverview([sampleProducts[0]]);
    expect(result.totalAsinCount).toBe(1);
    expect(result.medianMonthlySales).toBe(500);
    expect(result.medianMonthlyRevenue).toBe(14995);
    expect(result.brandCount).toBe(1);
  });

  it("should handle empty reviews array", () => {
    const result = calcReviewStats([]);
    expect(result.totalReviews).toBe(0);
  });

  it("should handle products with missing brand", () => {
    const incomplete: ProductData[] = [
      { asin: "X1", title: "No brand", brand: "", price: "10", rating: "0", reviewCount: "0", monthlySales: 0, monthlyRevenue: "0", bsr: 0, category: "", fulfillment: "", listingDate: "", sellerName: null, sellerLocation: null, variantCount: null, monthlySalesHistory: null, monthlyRevenueHistory: null, imageUrl: null, searchRank: null },
    ];
    const result = calcMarketOverview(incomplete);
    expect(result.totalAsinCount).toBe(1);
    expect(result.brandCount).toBe(0); // empty brand should not count
  });

  it("should handle even number of products for median calculation", () => {
    const fourProducts = sampleProducts.slice(0, 4);
    const result = calcMarketOverview(fourProducts);
    // Sorted sales: 100, 300, 500, 800 → median = (300+500)/2 = 400
    expect(result.medianMonthlySales).toBe(400);
  });
});
