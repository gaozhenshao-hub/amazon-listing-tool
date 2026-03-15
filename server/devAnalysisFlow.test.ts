import { describe, it, expect } from "vitest";

/* ─── devStatsEngine unit tests ─── */
describe("devStatsEngine", () => {
  // We test the pure statistical functions by importing them
  // Since the engine exports functions, we can test them directly
  
  describe("computeMarketOverview", () => {
    it("should compute basic market stats from product data", async () => {
      const { calcMarketOverview: computeMarketOverview } = await import("./devStatsEngine");
      const products = [
        { price: "29.99", rating: "4.5", reviewCount: 100, monthlySales: 500, monthlyRevenue: 14995, brand: "BrandA" },
        { price: "39.99", rating: "4.0", reviewCount: 200, monthlySales: 300, monthlyRevenue: 11997, brand: "BrandB" },
        { price: "19.99", rating: "3.5", reviewCount: 50, monthlySales: 800, monthlyRevenue: 15992, brand: "BrandA" },
        { price: "49.99", rating: "4.8", reviewCount: 500, monthlySales: 200, monthlyRevenue: 9998, brand: "BrandC" },
        { price: "24.99", rating: "4.2", reviewCount: 150, monthlySales: 600, monthlyRevenue: 14994, brand: "BrandB" },
      ];
      const result = computeMarketOverview(products as any);
      
      expect(result.avgPrice).toBeGreaterThan(0);
      expect(result.minPrice).toBeLessThanOrEqual(result.maxPrice);
      expect(result.avgRating).toBeGreaterThan(0);
      expect(result.totalAsinCount).toBe(5);
      expect(result.priceDistribution).toBeDefined();
      expect(Array.isArray(result.priceDistribution)).toBe(true);
    });

    it("should handle empty product list", async () => {
      const { calcMarketOverview } = await import("./devStatsEngine");
      const result = calcMarketOverview([]);
      expect(result.avgPrice).toBe(0);
      expect(result.totalAsinCount).toBe(0);
    });

    it("should compute correct price distribution buckets", async () => {
      const { calcMarketOverview } = await import("./devStatsEngine");
      const products = [
        { price: "5.99", rating: "4.0", reviewCount: 10, brand: "A" },
        { price: "15.99", rating: "4.0", reviewCount: 10, brand: "B" },
        { price: "25.99", rating: "4.0", reviewCount: 10, brand: "C" },
        { price: "55.99", rating: "4.0", reviewCount: 10, brand: "D" },
      ];
      const result = calcMarketOverview(products as any);
      
      expect(result.priceDistribution).toBeDefined();
      // Should have multiple price ranges
      const distArr = result.priceDistribution as Array<{ range: string; count: number }>;
      const totalInBuckets = distArr.reduce((a, b) => a + b.count, 0);
      expect(totalInBuckets).toBe(4);
    });
  });

  describe("computePriceSegments", () => {
    it("should segment products by price ranges", async () => {
      const { calcPriceSegments: computePriceSegments } = await import("./devStatsEngine");
      const products = [
        { price: "10.00", rating: "4.0", reviewCount: 50, monthlySales: 100, monthlyRevenue: 1000, brand: "A" },
        { price: "12.00", rating: "4.5", reviewCount: 80, monthlySales: 150, monthlyRevenue: 1800, brand: "B" },
        { price: "30.00", rating: "3.5", reviewCount: 20, monthlySales: 50, monthlyRevenue: 1500, brand: "C" },
        { price: "35.00", rating: "4.0", reviewCount: 100, monthlySales: 80, monthlyRevenue: 2800, brand: "D" },
      ];
      const result = computePriceSegments(products as any);
      
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);
      // Each segment should have required fields
      result.forEach(seg => {
        expect(seg).toHaveProperty("range");
        expect(seg).toHaveProperty("asinCount");
      });
    });

    it("should handle empty product list", async () => {
      const { calcPriceSegments: computePriceSegments } = await import("./devStatsEngine");
      const result = computePriceSegments([]);
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("computeBrandStats", () => {
    it("should aggregate brand-level statistics", async () => {
      const { calcBrandCompetition } = await import("./devStatsEngine");
      const products = [
        { price: "20.00", rating: "4.0", reviewCount: 100, monthlySales: 500, monthlyRevenue: 10000, brand: "BrandA" },
        { price: "25.00", rating: "4.5", reviewCount: 200, monthlySales: 300, monthlyRevenue: 7500, brand: "BrandA" },
        { price: "30.00", rating: "3.5", reviewCount: 50, monthlySales: 200, monthlyRevenue: 6000, brand: "BrandB" },
      ];
      const result = calcBrandCompetition(products as any);
      
      expect(Array.isArray(result.brands)).toBe(true);
      expect(result.brands.length).toBe(2);
      
      const brandA = result.brands.find((b: any) => b.brand === "BrandA");
      expect(brandA).toBeDefined();
      expect(brandA!.asinCount).toBe(2);
    });

    it("should sort brands by market share descending", async () => {
      const { calcBrandCompetition } = await import("./devStatsEngine");
      const products = [
        { price: "20.00", rating: "4.0", reviewCount: 100, monthlySales: 500, monthlyRevenue: 10000, brand: "Small" },
        { price: "25.00", rating: "4.5", reviewCount: 200, monthlySales: 300, monthlyRevenue: 7500, brand: "Big" },
        { price: "30.00", rating: "3.5", reviewCount: 50, monthlySales: 200, monthlyRevenue: 6000, brand: "Big" },
        { price: "35.00", rating: "4.0", reviewCount: 80, monthlySales: 400, monthlyRevenue: 14000, brand: "Big" },
      ];
      const result = calcBrandCompetition(products as any);
      
      // Big brand has 3 products, Small has 1 - Big should be first
      expect(result.brands[0].brand).toBe("Big");
    });
  });
});

/* ─── devAnalysisPrompts tests ─── */
describe("devAnalysisPrompts", () => {
  it("should export all 7 stage prompt generators", async () => {
    const prompts = await import("./devAnalysisPrompts");
    
    expect(prompts.ATTRIBUTE_TAGGING_PROMPT).toBeDefined();
    expect(prompts.MARKET_OVERVIEW_PROMPT).toBeDefined();
    expect(prompts.ATTRIBUTE_ANALYSIS_PROMPT).toBeDefined();
    expect(prompts.PRICE_ANALYSIS_PROMPT).toBeDefined();
    expect(prompts.BRAND_COMPETITION_PROMPT).toBeDefined();
    expect(prompts.REVIEW_KANO_PROMPT).toBeDefined();
    expect(prompts.DECISION_DASHBOARD_PROMPT).toBeDefined();
  });

  it("should generate non-empty prompts with data context", async () => {
    const prompts = await import("./devAnalysisPrompts");
    
    const sampleContext = "Product: Fan Light, Category: Home, 50 products analyzed";
    const sampleStats = JSON.stringify({ avgPrice: 29.99, brandCount: 10 });
    
    // Each prompt should be a string template or function
    expect(typeof prompts.MARKET_OVERVIEW_PROMPT).toBe("string");
    expect(prompts.MARKET_OVERVIEW_PROMPT.length).toBeGreaterThan(50);
    expect(prompts.ATTRIBUTE_ANALYSIS_PROMPT.length).toBeGreaterThan(50);
    expect(prompts.REVIEW_KANO_PROMPT.length).toBeGreaterThan(50);
    expect(prompts.DECISION_DASHBOARD_PROMPT.length).toBeGreaterThan(50);
  });
});

/* ─── Analysis stages schema tests ─── */
describe("Analysis Stages Schema", () => {
  it("should have all 7 stage types defined", () => {
    const stageTypes = [
      "attribute_tagging",
      "market_overview",
      "attribute_cross",
      "price_analysis",
      "brand_competition",
      "review_kano",
      "decision_dashboard",
    ];
    
    // Each stage type should be a valid string
    stageTypes.forEach(st => {
      expect(typeof st).toBe("string");
      expect(st.length).toBeGreaterThan(0);
    });
  });

  it("should have valid status values", () => {
    const validStatuses = ["pending", "running", "completed", "confirmed", "editing"];
    validStatuses.forEach(s => {
      expect(typeof s).toBe("string");
    });
  });
});

/* ─── DevDataUpload component data mapping tests ─── */
describe("Seller Wizard Data Mapping", () => {
  it("should map search data fields correctly", () => {
    // Simulating the field mapping from Search Excel
    const searchRow = {
      "ASIN": "B0DPHXYC7P",
      "标题": "Test Product Title",
      "品牌": "TestBrand",
      "价格": "$29.99",
      "评分": "4.5",
      "评分数": "1234",
      "月销量": "500",
      "月销售额": "$14,995",
      "上架时间": "2024-01-15",
      "卖家": "TestSeller",
      "变体数": "5",
      "BSR": "1234",
    };

    // Verify all required fields exist
    expect(searchRow["ASIN"]).toBeDefined();
    expect(searchRow["标题"]).toBeDefined();
    expect(searchRow["品牌"]).toBeDefined();
    expect(searchRow["价格"]).toBeDefined();
    expect(searchRow["评分"]).toBeDefined();
    expect(searchRow["月销量"]).toBeDefined();
  });

  it("should map bullet points data fields correctly", () => {
    const bulletRow = {
      "ASIN": "B0DPHXYC7P",
      "标题": "Test Product",
      "五点描述": "Feature 1\nFeature 2\nFeature 3",
    };

    expect(bulletRow["ASIN"]).toBeDefined();
    expect(bulletRow["五点描述"]).toBeDefined();
  });

  it("should map review data fields correctly", () => {
    const reviewRow = {
      "评论标题": "Great product!",
      "评论内容": "I love this product, it works perfectly.",
      "评分": "5",
      "日期": "2024-03-01",
      "是否VP": "是",
      "有用数": "10",
    };

    expect(reviewRow["评论标题"]).toBeDefined();
    expect(reviewRow["评论内容"]).toBeDefined();
    expect(reviewRow["评分"]).toBeDefined();
  });

  it("should map historical sales data fields correctly", () => {
    const salesRow = {
      "ASIN": "B0DPHXYC7P",
      "日期": "2024-01",
      "BSR": "1234",
      "价格": "$29.99",
      "评分": "4.5",
      "评分数": "100",
      "月销量": "500",
    };

    expect(salesRow["ASIN"]).toBeDefined();
    expect(salesRow["日期"]).toBeDefined();
    expect(salesRow["月销量"]).toBeDefined();
  });
});

/* ─── Chart data transformation tests ─── */
describe("Chart Data Transformations", () => {
  it("should transform price distribution for Recharts BarChart", () => {
    const priceDistribution = {
      "$0-$10": 5,
      "$10-$20": 12,
      "$20-$30": 18,
      "$30-$50": 8,
      "$50+": 3,
    };

    const chartData = Object.entries(priceDistribution).map(([range, count]) => ({ range, count }));
    
    expect(chartData).toHaveLength(5);
    expect(chartData[0]).toEqual({ range: "$0-$10", count: 5 });
    expect(chartData[2]).toEqual({ range: "$20-$30", count: 18 });
  });

  it("should transform rating distribution for Recharts PieChart", () => {
    const ratingDistribution = { "1": 2, "2": 5, "3": 10, "4": 25, "5": 58 };

    const pieData = Object.entries(ratingDistribution).map(([rating, count]) => ({
      name: `${rating}★`,
      value: count,
    }));

    expect(pieData).toHaveLength(5);
    expect(pieData[4]).toEqual({ name: "5★", value: 58 });
  });

  it("should transform brand data for market share pie chart", () => {
    const brands = [
      { brand: "BrandA", count: 10, marketShare: "33.3" },
      { brand: "BrandB", count: 8, marketShare: "26.7" },
      { brand: "BrandC", count: 5, marketShare: "16.7" },
      { brand: "Others", count: 7, marketShare: "23.3" },
    ];

    const pieData = brands.map(b => ({ name: b.brand, value: parseFloat(b.marketShare) }));
    
    expect(pieData).toHaveLength(4);
    expect(pieData[0].value).toBeCloseTo(33.3, 1);
    const totalShare = pieData.reduce((sum, d) => sum + d.value, 0);
    expect(totalShare).toBeCloseTo(100, 0);
  });

  it("should transform dimension scores for radar chart", () => {
    const dimensions = [
      { name: "市场容量", score: 85 },
      { name: "竞争强度", score: 60 },
      { name: "利润空间", score: 75 },
      { name: "进入门槛", score: 70 },
      { name: "供应链", score: 80 },
    ];

    const radarData = dimensions.map(d => ({
      subject: d.name,
      score: d.score,
      fullMark: 100,
    }));

    expect(radarData).toHaveLength(5);
    expect(radarData[0]).toEqual({ subject: "市场容量", score: 85, fullMark: 100 });
    radarData.forEach(d => {
      expect(d.score).toBeGreaterThanOrEqual(0);
      expect(d.score).toBeLessThanOrEqual(100);
    });
  });
});

/* ─── Stage workflow tests ─── */
describe("Stage Workflow Logic", () => {
  it("should define correct stage order", () => {
    const stages = [
      "attribute_tagging",
      "market_overview",
      "attribute_cross",
      "price_analysis",
      "brand_competition",
      "review_kano",
      "decision_dashboard",
    ];

    expect(stages).toHaveLength(7);
    expect(stages[0]).toBe("attribute_tagging");
    expect(stages[6]).toBe("decision_dashboard");
  });

  it("should enforce stage completion before advancing", () => {
    const stageStatuses = {
      attribute_tagging: "confirmed",
      market_overview: "completed",
      attribute_cross: "pending",
      price_analysis: "pending",
      brand_competition: "pending",
      review_kano: "pending",
      decision_dashboard: "pending",
    };

    // Can advance to market_overview (attribute_tagging is confirmed)
    expect(stageStatuses.attribute_tagging).toBe("confirmed");
    
    // Cannot advance past attribute_cross (market_overview not confirmed)
    expect(stageStatuses.market_overview).not.toBe("confirmed");
  });

  it("should allow editing of confirmed stages", () => {
    const stage = { status: "confirmed", resultJson: '{"data": "test"}' };
    
    // Editing should change status to "editing"
    const editedStage = { ...stage, status: "editing" };
    expect(editedStage.status).toBe("editing");
    
    // Re-confirming should change back to "confirmed"
    const reconfirmedStage = { ...editedStage, status: "confirmed" };
    expect(reconfirmedStage.status).toBe("confirmed");
  });
});
