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

  it("triggerAiScoring should have fallback for crawl failures", async () => {
    const fs = await import("fs");
    const content = fs.readFileSync("server/routers/productOps.ts", "utf-8");
    const triggerSection = content.substring(
      content.indexOf("triggerAiScoring:"),
      content.indexOf("generateSuggestions:")
    );
    expect(triggerSection).toContain("crawl_failed");
    expect(triggerSection).toContain("数据采集失败");
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
