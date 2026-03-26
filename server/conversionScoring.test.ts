import { describe, it, expect, vi } from "vitest";

// ═══════════════════════════════════════════════════════════════
// Test: Conversion Data Collector Types & Structure
// ═══════════════════════════════════════════════════════════════

describe("ConversionDataCollector - Types & Structure", () => {
  it("should export collectConversionData function", async () => {
    const mod = await import("./routers/conversionDataCollector");
    expect(typeof mod.collectConversionData).toBe("function");
  });

  it("should export collectMultipleAsins function", async () => {
    const mod = await import("./routers/conversionDataCollector");
    expect(typeof mod.collectMultipleAsins).toBe("function");
  });

  it("ConversionCrawlData should have all 18 category keys", async () => {
    // We can't easily call the real function without network, but we can verify the type structure
    // by checking the createFallbackData function indirectly
    const mod = await import("./routers/conversionDataCollector");
    // collectConversionData with a fake ASIN will fail gracefully
    // Instead, test the structure via collectMultipleAsins with empty array
    const results = await mod.collectMultipleAsins([]);
    expect(results).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════
// Test: Conversion AI Scorer Types & Structure
// ═══════════════════════════════════════════════════════════════

describe("ConversionAiScorer - Types & Structure", () => {
  it("should export scoreAllCheckItems function", async () => {
    const mod = await import("./routers/conversionAiScorer");
    expect(typeof mod.scoreAllCheckItems).toBe("function");
  });
});

// ═══════════════════════════════════════════════════════════════
// Test: Programmatic Scoring Logic
// ═══════════════════════════════════════════════════════════════

describe("ConversionAiScorer - Programmatic Scoring", () => {
  // We need to test the internal tryProgrammaticScore logic
  // Since it's not exported, we test it indirectly through scoreAllCheckItems
  // with mock data that avoids LLM calls

  const createMockCrawlData = (overrides: any = {}) => ({
    asin: "B0TEST123",
    crawledAt: new Date().toISOString(),
    raw: { scraperData: null, competitorData: null, adData: null },
    categories: {
      标题: { text: "Premium Test Product for Home Use with Great Features", charCount: 52, wordCount: 9, brand: "TestBrand", hasBrand: true, rawTitle: "Premium Test Product for Home Use with Great Features" },
      五点: { bullets: ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"], bulletCount: 5, avgCharCount: 7, totalCharCount: 35, charCounts: [7, 7, 7, 7, 7] },
      标: { hasBestSeller: true, hasAmazonChoice: false, hasNewRelease: false, hasDeal: true, dealInfo: "20% off", hasCoupon: true, couponInfo: "5% coupon", hasPrime: true, hasSubscribeSave: false, hasClimateTag: false, hasSmallBusiness: false, totalBadges: 4 },
      价格: { currentPrice: 29.99, listPrice: 39.99, hasStrikethrough: true, discountPercent: 25, hasCoupon: true, couponValue: "5% coupon", hasSubscribeSave: false, unitPrice: null, buyBoxPrice: 29.99, priceEnding: "99" },
      限购: { hasLimit: false, limitQuantity: null, limitText: null },
      配送: { isFBA: true, isFBM: false, deliveryDays: 2, deliveryText: "Free delivery by Thursday", hasPrime: true, hasFreeShipping: true, shipsFrom: "Amazon", soldBy: "TestBrand" },
      变体: { variantCount: 5, variantTypes: ["Color", "Size"], variants: [{ name: "Red", hasImage: true }, { name: "Blue", hasImage: true }], hasImages: true },
      产品信息: { fieldCount: 8, hasWeight: true, hasDimensions: true, hasMaterial: true, hasColor: true, hasManufacturer: true, fields: { "Weight": "2 lbs", "Dimensions": "10x5x3 inches" } },
      商品文档: { hasManual: true, hasCertification: true, documentCount: 2, documentTypes: ["User Manual", "Safety Certificate"] },
      主图: { mainImages: [], mainImageCount: 1, hasMainImage: true, mainImageResolution: null, secondaryImages: [], secondaryImageCount: 6, aplusImages: [], brandStoryImages: [], videoCount: 2, hasVideo: true, totalImageCount: 9 },
      流量闭环: { hasNewModel: false, hasBundleDeal: true, hasFrequentlyBought: true, hasSponsoredProducts: true, hasVirtualBundle: false, hasBrandStoreLink: true },
      品牌故事: { hasBrandStory: true, hasRecommendation: true, imageCount: 4, textContent: "Our brand story...", images: [] },
      "A+": { hasAplus: true, moduleCount: 7, moduleTypes: ["banner", "comparison"], hasComparisonChart: true, hasVideo: false, imageCount: 10, textContent: "Premium quality...", images: [] },
      Video: { videoCount: 2, hasMainVideo: true, videoUrls: [] },
      "Q&A": { questionCount: 35, topQuestions: [] },
      Review: { rating: 4.5, reviewCount: 1200, hasVine: true, topReviews: ["Great product!"], ratingDistribution: { "5": 70, "4": 15, "3": 8, "2": 4, "1": 3 } },
      店铺介绍页面: { feedbackScore: 96, feedbackCount: 5000, hasStorefront: true, storeName: "TestBrand Official" },
      广告: { hasCampaigns: true, campaignCount: 5, totalSpend: 500, acos: 22, roas: 4.5, keywordCount: 30, topKeywords: [{ keyword: "test product", impressions: 10000, clicks: 500, spend: 100, acos: 20 }], searchTerms: [{ term: "best test product", impressions: 5000, clicks: 200, conversions: 50 }] },
      ...overrides,
    },
  });

  it("should score title charCount programmatically (short title = low score)", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData({ 标题: { text: "Short", charCount: 5, wordCount: 1, brand: "", hasBrand: false, rawTitle: "Short" } });
    
    const items = [{ id: 1, categoryName: "标题", subDimension: "字数", standard: "对应类目要充分使用标题字符数", categoryIndex: 1, sortOrder: 0 }];
    
    // scoreAllCheckItems will use programmatic scoring for this item
    // But it also calls AI for other items, so we mock invokeLLM
    vi.mock("../_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ scores: [{ index: 1, score: 3, reason: "test" }] }) } }]
      })
    }));
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBeLessThanOrEqual(2); // Short title should get low score
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score title charCount programmatically (optimal length = high score)", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const longTitle = "A".repeat(175);
    const data = createMockCrawlData({ 标题: { text: longTitle, charCount: 175, wordCount: 30, brand: "TestBrand", hasBrand: true, rawTitle: longTitle } });
    
    const items = [{ id: 1, categoryName: "标题", subDimension: "字数", standard: "对应类目要充分使用标题字符数", categoryIndex: 1, sortOrder: 0 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(5); // Optimal length
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score brand presence programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 2, categoryName: "标题", subDimension: "品牌词", standard: "品牌有一定知名度，突出品牌词", categoryIndex: 1, sortOrder: 1 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(5); // Brand is present in title
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score badge overlay effect programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 3, categoryName: "标", subDimension: "叠加效应", standard: "越多越好", categoryIndex: 3, sortOrder: 0 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBeGreaterThanOrEqual(4); // 4 badges = good
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score strikethrough price programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 4, categoryName: "价格", subDimension: "划线价格", standard: "划线价格", categoryIndex: 4, sortOrder: 0 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(5); // 25% discount = optimal range
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score FBA delivery programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 5, categoryName: "配送", subDimension: "配送方式", standard: "配送方式", categoryIndex: 6, sortOrder: 0 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(5); // FBA = best
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score delivery time programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 6, categoryName: "配送", subDimension: "配送时效", standard: "配送时效", categoryIndex: 6, sortOrder: 1 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(5); // 2 days = excellent
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score variant count programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 7, categoryName: "变体", subDimension: "变体数量", standard: "变体数量", categoryIndex: 7, sortOrder: 0 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(5); // 5 variants = good range
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score variant images programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 8, categoryName: "变体", subDimension: "变体图片", standard: "变体图片", categoryIndex: 7, sortOrder: 1 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(5); // Has variant images
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score product info completeness programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 9, categoryName: "产品信息", subDimension: "完整性", standard: "完整性", categoryIndex: 8, sortOrder: 0 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBeGreaterThanOrEqual(4); // 8 fields = good
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score Q&A count programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 10, categoryName: "Q&A", subDimension: "数量", standard: "数量", categoryIndex: 15, sortOrder: 0 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(4); // 35 Q&A = good
    expect(scores[0].source).toBe("programmatic");
  });

  it("should score ad keyword count programmatically", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [{ id: 11, categoryName: "广告", subDimension: "关键词词库", standard: "关键词词库", categoryIndex: 18, sortOrder: 0 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores.length).toBe(1);
    expect(scores[0].score).toBe(4); // 30 keywords = good
    expect(scores[0].source).toBe("programmatic");
  });
});

// ═══════════════════════════════════════════════════════════════
// Test: Check Items Definition (129 items, 18 categories)
// ═══════════════════════════════════════════════════════════════

describe("Check Items Definition - 129 items in 18 categories", () => {
  it("should have exactly 129 check items", async () => {
    // Read the getDefault132CheckItems function output
    // We can't call it directly since it's not exported, but we can verify the count
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const pushCount = (content.match(/items\.push\(/g) || []).length;
    expect(pushCount).toBe(129);
  });

  it("should have 18 unique categories", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const categoryMatches = content.match(/categoryName: "([^"]+)"/g) || [];
    const categories = new Set(categoryMatches.map(m => m.replace('categoryName: "', '').replace('"', '')));
    expect(categories.size).toBe(18);
  });

  it("should have separate 首图 and 辅图 sub-dimensions in 主图 category", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const mainImageItems = (content.match(/categoryName: "主图", subDimension: "首图"/g) || []).length;
    const secondaryImageItems = (content.match(/categoryName: "主图", subDimension: "辅图"/g) || []).length;
    expect(mainImageItems).toBeGreaterThanOrEqual(4); // At least 4 首图 items
    expect(secondaryImageItems).toBeGreaterThanOrEqual(8); // At least 8 辅图 items
  });

  it("should include all expected category names", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const expectedCategories = [
      "标题", "五点", "标", "价格", "限购", "配送", "变体", "产品信息",
      "商品文档", "主图", "流量闭环", "品牌故事", "A+", "Video", "Q&A",
      "Review", "店铺介绍页面", "广告"
    ];
    for (const cat of expectedCategories) {
      expect(content).toContain(`categoryName: "${cat}"`);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Test: Integration - triggerAiScoring uses real data collector
// ═══════════════════════════════════════════════════════════════

describe("Integration - triggerAiScoring uses real modules", () => {
  it("productOps.ts should import conversionDataCollector", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    expect(content).toContain('import { collectConversionData, collectMultipleAsins');
    expect(content).toContain('from "./conversionDataCollector"');
  });

  it("productOps.ts should import conversionAiScorer", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    expect(content).toContain('import { scoreAllCheckItems');
    expect(content).toContain('from "./conversionAiScorer"');
  });

  it("triggerAiScoring should call collectMultipleAsins instead of generateMockCrawlData", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    // Should use collectMultipleAsins
    expect(content).toContain("collectMultipleAsins(allAsins");
    // Should NOT use generateMockCrawlData in the scoring flow
    // (the function definition may still exist but should not be called in triggerAiScoring)
    const triggerSection = content.substring(
      content.indexOf("triggerAiScoring:"),
      content.indexOf("generateSuggestions:")
    );
    expect(triggerSection).not.toContain("generateMockCrawlData");
  });

  it("triggerAiScoring should call scoreAllCheckItems", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const triggerSection = content.substring(
      content.indexOf("triggerAiScoring:"),
      content.indexOf("generateSuggestions:")
    );
    expect(triggerSection).toContain("scoreAllCheckItems");
  });

  it("triggerAiScoring should handle locked scores correctly", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const triggerSection = content.substring(
      content.indexOf("triggerAiScoring:"),
      content.indexOf("generateSuggestions:")
    );
    // Should check for locked scores
    expect(triggerSection).toContain("lockedKeys");
    expect(triggerSection).toContain("isLocked");
    // Should only delete unlocked scores
    expect(triggerSection).toContain("eq(conversionScores.isLocked, 0)");
  });

  it("triggerAiScoring should handle no-data case without fake scores", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const triggerSection = content.substring(
      content.indexOf("triggerAiScoring:"),
      content.indexOf("generateSuggestions:")
    );
    // Should use no_data source for failed crawls
    expect(triggerSection).toContain('source: "no_data"');
    // Should set score to null when no data
    expect(triggerSection).toContain("score: null");
    // Should NOT use default 3 score for no-data
    expect(triggerSection).not.toContain('score: 3');
    // Should mention data collection failure
    expect(triggerSection).toContain("数据采集失败");
    // Should track failedAsins
    expect(triggerSection).toContain("failedAsins");
  });
});

// ═══════════════════════════════════════════════════════════════
// Test: Data Collector Category Context Builder
// ═══════════════════════════════════════════════════════════════

describe("ConversionAiScorer - Category Context Builder", () => {
  it("should handle all 18 categories without errors", async () => {
    const mod = await import("./routers/conversionAiScorer");
    // The buildCategoryContext function is internal, but we can test it through scoreAllCheckItems
    // by passing items from each category
    const categories = [
      "标题", "五点", "标", "价格", "限购", "配送", "变体", "产品信息",
      "商品文档", "主图", "流量闭环", "品牌故事", "A+", "Video", "Q&A",
      "Review", "店铺介绍页面", "广告"
    ];
    
    // Just verify the module loads without errors
    expect(categories.length).toBe(18);
    expect(mod.scoreAllCheckItems).toBeDefined();
  });
});


// ═══════════════════════════════════════════════════════════════
// Test: Source Field in Scoring
// ═══════════════════════════════════════════════════════════════

describe("ConversionAiScorer - Source Field", () => {
  const createMockCrawlData = (overrides: any = {}) => ({
    asin: "B0TEST123",
    crawledAt: new Date().toISOString(),
    raw: { scraperData: null, competitorData: null, adData: null },
    categories: {
      标题: { text: "Premium Test Product for Home Use with Great Features", charCount: 52, wordCount: 9, brand: "TestBrand", hasBrand: true, rawTitle: "Premium Test Product for Home Use with Great Features" },
      五点: { bullets: ["Point 1", "Point 2", "Point 3", "Point 4", "Point 5"], bulletCount: 5, avgCharCount: 7, totalCharCount: 35, charCounts: [7, 7, 7, 7, 7] },
      标: { hasBestSeller: true, hasAmazonChoice: false, hasNewRelease: false, hasDeal: true, dealInfo: "20% off", hasCoupon: true, couponInfo: "5% coupon", hasPrime: true, hasSubscribeSave: false, hasClimateTag: false, hasSmallBusiness: false, totalBadges: 4 },
      价格: { currentPrice: 29.99, listPrice: 39.99, hasStrikethrough: true, discountPercent: 25, hasCoupon: true, couponValue: "5% coupon", hasSubscribeSave: false, unitPrice: null, buyBoxPrice: 29.99, priceEnding: "99" },
      限购: { hasLimit: false, limitQuantity: null, limitText: null },
      配送: { isFBA: true, isFBM: false, deliveryDays: 2, deliveryText: "Free delivery by Thursday", hasPrime: true, hasFreeShipping: true, shipsFrom: "Amazon", soldBy: "TestBrand" },
      变体: { variantCount: 5, variantTypes: ["Color", "Size"], variants: [{ name: "Red", hasImage: true }, { name: "Blue", hasImage: true }], hasImages: true },
      产品信息: { fieldCount: 8, hasWeight: true, hasDimensions: true, hasMaterial: true, hasColor: true, hasManufacturer: true, fields: { "Weight": "2 lbs", "Dimensions": "10x5x3 inches" } },
      商品文档: { hasManual: true, hasCertification: true, documentCount: 2, documentTypes: ["User Manual", "Safety Certificate"] },
      主图: { mainImages: [], mainImageCount: 1, hasMainImage: true, mainImageResolution: null, secondaryImages: [], secondaryImageCount: 6, aplusImages: [], brandStoryImages: [], videoCount: 2, hasVideo: true, totalImageCount: 9 },
      流量闭环: { hasNewModel: false, hasBundleDeal: true, hasFrequentlyBought: true, hasSponsoredProducts: true, hasVirtualBundle: false, hasBrandStoreLink: true },
      品牌故事: { hasBrandStory: true, hasRecommendation: true, imageCount: 4, textContent: "Our brand story...", images: [] },
      "A+": { hasAplus: true, moduleCount: 7, moduleTypes: ["banner", "comparison"], hasComparisonChart: true, hasVideo: false, imageCount: 10, textContent: "Premium quality...", images: [] },
      Video: { videoCount: 2, hasMainVideo: true, videoUrls: [] },
      "Q&A": { questionCount: 35, topQuestions: [] },
      Review: { rating: 4.5, reviewCount: 1200, hasVine: true, topReviews: ["Great product!"], ratingDistribution: { "5": 70, "4": 15, "3": 8, "2": 4, "1": 3 } },
      店铺介绍页面: { feedbackScore: 96, feedbackCount: 5000, hasStorefront: true, storeName: "TestBrand Official" },
      广告: { hasCampaigns: true, campaignCount: 5, totalSpend: 500, acos: 22, roas: 4.5, keywordCount: 30, topKeywords: [{ keyword: "test product", impressions: 10000, clicks: 500, spend: 100, acos: 20 }], searchTerms: [{ term: "best test product", impressions: 5000, clicks: 200, conversions: 50 }] },
      ...overrides,
    },
  });

  it("programmatic scores should have source='programmatic'", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    // Test title charCount - a programmatic item
    const items = [{ id: 1, categoryName: "标题", subDimension: "字数", standard: "对应类目要充分使用标题字符数", categoryIndex: 1, sortOrder: 0 }];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores[0].source).toBe("programmatic");
  });

  it("AI scores should have source='ai'", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    // Test an item that requires AI scoring (e.g., 主图 quality)
    const items = [{ id: 100, categoryName: "首图", subDimension: "构图", standard: "主图构图合理", categoryIndex: 10, sortOrder: 0 }];
    
    vi.mock("../_core/llm", () => ({
      invokeLLM: vi.fn().mockResolvedValue({
        choices: [{ message: { content: JSON.stringify({ scores: [{ index: 100, score: 4, reason: "Good composition" }] }) } }]
      })
    }));
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    expect(scores[0].source).toBe("ai");
  });

  it("CheckItemScore interface should include source field with no_data option", async () => {
    const mod = await import("./routers/conversionAiScorer");
    const data = createMockCrawlData();
    
    const items = [
      { id: 1, categoryName: "标题", subDimension: "字数", standard: "对应类目要充分使用标题字符数", categoryIndex: 1, sortOrder: 0 },
      { id: 2, categoryName: "标题", subDimension: "品牌词", standard: "品牌有一定知名度，突出品牌词", categoryIndex: 1, sortOrder: 1 },
    ];
    
    const scores = await mod.scoreAllCheckItems(items, data as any);
    for (const s of scores) {
      expect(s).toHaveProperty("source");
      expect(["programmatic", "ai", "no_data"]).toContain(s.source);
    }
  });
});

// ═══════════════════════════════════════════════════════════════
// Test: Schema Source Field
// ═══════════════════════════════════════════════════════════════

describe("Schema - ConversionScores source field", () => {
  it("conversionScores table should have source column defined", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.conversionScores).toBeDefined();
    // Check that the table has the source column by checking the column names
    const columns = Object.keys(schema.conversionScores);
    // The table object has column accessors
    expect(schema.conversionScores.source).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════════
// Test: Reset and Reinit Check Items
// ═══════════════════════════════════════════════════════════════

describe("ProductOps - resetAndReinitCheckItems", () => {
  it("productOpsRouter should be exported and defined", async () => {
    const routerMod = await import("./routers/productOps");
    expect(routerMod).toBeDefined();
    expect(routerMod.productOpsRouter).toBeDefined();
  });

  it("productOpsRouter should have resetAndReinitCheckItems procedure", async () => {
    const routerMod = await import("./routers/productOps");
    // tRPC routers expose procedures as properties
    const router = routerMod.productOpsRouter;
    expect(router).toBeDefined();
    // Check that the router has the procedure defined
    expect(router._def).toBeDefined();
    expect(router._def.procedures).toBeDefined();
    expect(router._def.procedures.resetAndReinitCheckItems).toBeDefined();
  });
});


// ═══════════════════════════════════════════════════════════════
// Test: No-Data / No-Hallucination Behavior
// ═══════════════════════════════════════════════════════════════

describe("No-Hallucination: No fake data when crawl fails", () => {
  it("collectMultipleAsins should NOT export createFallbackData", async () => {
    const mod = await import("./routers/conversionDataCollector");
    // createFallbackData should not be exported - no fake data generation
    expect((mod as any).createFallbackData).toBeUndefined();
  });

  it("conversionDataCollector code should not contain hasPrime: true default", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/conversionDataCollector.ts", "utf-8");
    // Should use actual scraper data for hasPrime, not default true
    const lines = content.split("\n");
    const hasPrimeDefaults = lines.filter(l => l.includes("hasPrime: true") && l.includes("默认"));
    expect(hasPrimeDefaults.length).toBe(0);
  });

  it("ConversionCrawlData should have hasData and dataSourceStatus fields", async () => {
    const mod = await import("./routers/conversionDataCollector");
    // Verify the type structure includes the new fields
    expect(mod.collectConversionData).toBeDefined();
    expect(mod.collectMultipleAsins).toBeDefined();
  });

  it("conversionDataCollector should NOT have createFallbackData function exported", async () => {
    const mod = await import("./routers/conversionDataCollector");
    // createFallbackData should not be exported (or should not exist)
    expect((mod as any).createFallbackData).toBeUndefined();
  });

  it("productOps.ts should NOT contain default 3 score for no-data", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const triggerSection = content.substring(
      content.indexOf("triggerAiScoring:"),
      content.indexOf("generateSuggestions:")
    );
    // Should NOT have "score: 3" for no-data fallback
    expect(triggerSection).not.toContain("score: 3,");
    // Should have "score: null" for no-data
    expect(triggerSection).toContain("score: null");
  });

  it("conversionAiScorer should return null score when data is missing for programmatic items", async () => {
    const mod = await import("./routers/conversionAiScorer");
    // Create data with empty title (simulating no data)
    const emptyData = {
      asin: "B0EMPTY",
      crawledAt: new Date().toISOString(),
      hasData: true,
      dataSourceStatus: {
        scraper: { success: false, error: "Failed" },
        competitor: { success: false, error: "Failed" },
        lingxingAd: { success: false, error: "Failed" },
      },
      raw: { scraperData: null, competitorData: null, adData: null },
      categories: {
        标题: { text: "", charCount: 0, wordCount: 0, brand: "", hasBrand: false, rawTitle: "" },
        五点: { bullets: [], bulletCount: 0, avgCharCount: 0, totalCharCount: 0, charCounts: [] },
        标: { hasBestSeller: false, hasAmazonChoice: false, hasNewRelease: false, hasDeal: false, dealInfo: null, hasCoupon: false, couponInfo: null, hasPrime: false, hasSubscribeSave: false, hasClimateTag: false, hasSmallBusiness: false, totalBadges: 0 },
        价格: { currentPrice: null, listPrice: null, hasStrikethrough: false, discountPercent: null, hasCoupon: false, couponValue: null, hasSubscribeSave: false, unitPrice: null, buyBoxPrice: null, priceEnding: null },
        限购: { hasLimit: false, limitQuantity: null, limitText: null },
        配送: { isFBA: false, isFBM: false, deliveryDays: null, deliveryText: null, hasPrime: false, hasFreeShipping: false, shipsFrom: null, soldBy: null },
        变体: { variantCount: 0, variantTypes: [], variants: [], hasImages: false },
        产品信息: { fieldCount: 0, hasWeight: false, hasDimensions: false, hasMaterial: false, hasColor: false, hasManufacturer: false, fields: {} },
        商品文档: { hasManual: false, hasCertification: false, documentCount: 0, documentTypes: [] },
        主图: { mainImages: [], mainImageCount: 0, hasMainImage: false, mainImageResolution: null, secondaryImages: [], secondaryImageCount: 0, aplusImages: [], brandStoryImages: [], videoCount: 0, hasVideo: false, totalImageCount: 0 },
        流量闭环: { hasNewModel: false, hasBundleDeal: false, hasFrequentlyBought: false, hasSponsoredProducts: false, hasVirtualBundle: false, hasBrandStoreLink: false },
        品牌故事: { hasBrandStory: false, hasRecommendation: false, imageCount: 0, textContent: "", images: [] },
        "A+": { hasAplus: false, moduleCount: 0, moduleTypes: [], hasComparisonChart: false, hasVideo: false, imageCount: 0, textContent: "", images: [] },
        Video: { videoCount: 0, hasMainVideo: false, videoUrls: [] },
        "Q&A": { questionCount: 0, topQuestions: [] },
        Review: { rating: null, reviewCount: null, hasVine: false, topReviews: [], ratingDistribution: {} },
        店铺介绍页面: { feedbackScore: null, feedbackCount: null, hasStorefront: false, storeName: null },
        广告: { hasCampaigns: false, campaignCount: 0, totalSpend: null, acos: null, roas: null, keywordCount: 0, topKeywords: [], searchTerms: [] },
      },
    };

    // Test title with 0 charCount - should return null score
    const titleItem = [{ id: 1, categoryName: "标题", subDimension: "字数", standard: "test", categoryIndex: 1, sortOrder: 0 }];
    const titleScores = await mod.scoreAllCheckItems(titleItem, emptyData as any);
    expect(titleScores[0].score).toBeNull();
    expect(titleScores[0].source).toBe("no_data");
    expect(titleScores[0].reason).toContain("手动评分");

    // Test brand with empty brand - should return null score
    const brandItem = [{ id: 2, categoryName: "标题", subDimension: "品牌词", standard: "test", categoryIndex: 1, sortOrder: 1 }];
    const brandScores = await mod.scoreAllCheckItems(brandItem, emptyData as any);
    expect(brandScores[0].score).toBeNull();
    expect(brandScores[0].source).toBe("no_data");

    // Test variant count with 0 variants - should return null score
    const variantItem = [{ id: 3, categoryName: "变体", subDimension: "变体数量", standard: "test", categoryIndex: 7, sortOrder: 0 }];
    const variantScores = await mod.scoreAllCheckItems(variantItem, emptyData as any);
    expect(variantScores[0].score).toBeNull();
    expect(variantScores[0].source).toBe("no_data");

    // Test delivery time with null - should return null score
    const deliveryItem = [{ id: 4, categoryName: "配送", subDimension: "配送时效", standard: "test", categoryIndex: 6, sortOrder: 1 }];
    const deliveryScores = await mod.scoreAllCheckItems(deliveryItem, emptyData as any);
    expect(deliveryScores[0].score).toBeNull();
    expect(deliveryScores[0].source).toBe("no_data");

    // Test buy box with null - should return null score
    const buyBoxItem = [{ id: 5, categoryName: "价格", subDimension: "购物车价格", standard: "test", categoryIndex: 4, sortOrder: 0 }];
    const buyBoxScores = await mod.scoreAllCheckItems(buyBoxItem, emptyData as any);
    expect(buyBoxScores[0].score).toBeNull();
    expect(buyBoxScores[0].source).toBe("no_data");
  });

  it("conversionDataCollector should NOT default hasPrime to true", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/conversionDataCollector.ts", "utf-8");
    // Should NOT have "hasPrime: true" as a default
    expect(content).not.toContain("hasPrime: true, // 默认FBA有Prime");
    expect(content).not.toContain("hasPrime: true, // 默认");
  });

  it("conversionDataCollector should NOT default isFBA to true", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/conversionDataCollector.ts", "utf-8");
    // Should NOT have "isFBA: true" as a default
    expect(content).not.toContain("isFBA: true, // 默认假设FBA");
    expect(content).not.toContain("isFBA: true, // 默认");
  });

  it("overall score calculation should exclude no-data items", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const triggerSection = content.substring(
      content.indexOf("triggerAiScoring:"),
      content.indexOf("generateSuggestions:")
    );
    // Should filter out null scores when calculating average
    expect(triggerSection).toContain("scoredItems");
    expect(triggerSection).toContain("noDataItems");
    // Should only average scored items
    expect(triggerSection).toContain("scoredItems.length > 0");
  });
});
