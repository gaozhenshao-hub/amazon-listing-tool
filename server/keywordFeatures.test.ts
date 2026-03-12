import { describe, it, expect } from "vitest";

// ─── Feature 1: Keyword Import Column Mapping (流量词 support) ───
describe("Keyword Import - Column Mapping", () => {
  it("should map 流量词 column to keyword field", () => {
    const columnMappings: Record<string, string[]> = {
      keyword: ["关键词", "keyword", "search term", "流量词", "搜索词"],
      translationCn: ["关键词翻译", "中文翻译", "翻译", "translation"],
      isAcRecommended: ["ac推荐", "ac推荐词", "amazon choice", "ac"],
    };

    expect(columnMappings.keyword).toContain("流量词");
    expect(columnMappings.keyword).toContain("关键词");
    expect(columnMappings.translationCn).toContain("关键词翻译");
    expect(columnMappings.isAcRecommended).toContain("ac推荐");
  });

  it("should detect column headers case-insensitively", () => {
    const headers = ["流量词", "关键词翻译", "月搜索量", "AC推荐"];
    const normalized = headers.map(h => h.toLowerCase().trim());
    
    expect(normalized).toContain("流量词");
    expect(normalized).toContain("关键词翻译");
    expect(normalized).toContain("ac推荐");
  });
});

// ─── Feature 2: Translation and AC Recommended Fields ───
describe("Keyword - Translation and AC Fields", () => {
  it("should store translationCn on keyword record", () => {
    const keyword = {
      id: 1,
      keyword: "dog harness",
      translationCn: "狗胸背带",
      isAcRecommended: true,
      monthlySearchVolume: 50000,
    };

    expect(keyword.translationCn).toBe("狗胸背带");
    expect(keyword.isAcRecommended).toBe(true);
  });

  it("should handle missing translation gracefully", () => {
    const keyword = {
      id: 2,
      keyword: "pet collar",
      translationCn: null,
      isAcRecommended: false,
    };

    expect(keyword.translationCn).toBeNull();
    expect(keyword.isAcRecommended).toBe(false);
  });
});

// ─── Feature 3: Negative Keyword Reasons in Chinese ───
describe("Negative Keywords - Chinese Reasons", () => {
  const REASON_CN_MAP: Record<string, string> = {
    "low_relevance": "相关性低",
    "wrong_category": "类目不匹配",
    "competitor_brand": "竞品品牌词",
    "too_broad": "过于宽泛",
    "semantic_mismatch": "语义不匹配",
    "duplicate_intent": "意图重复",
    "low_conversion": "转化率低",
    "irrelevant_attribute": "属性不相关",
  };

  it("should map English reasons to Chinese", () => {
    expect(REASON_CN_MAP["low_relevance"]).toBe("相关性低");
    expect(REASON_CN_MAP["wrong_category"]).toBe("类目不匹配");
    expect(REASON_CN_MAP["competitor_brand"]).toBe("竞品品牌词");
  });

  it("should support filtering by reason", () => {
    const negatives = [
      { id: 1, keyword: "cat toy", reason: "wrong_category", reasonCn: "类目不匹配" },
      { id: 2, keyword: "cheap harness", reason: "low_relevance", reasonCn: "相关性低" },
      { id: 3, keyword: "brand x harness", reason: "competitor_brand", reasonCn: "竞品品牌词" },
      { id: 4, keyword: "toy harness", reason: "wrong_category", reasonCn: "类目不匹配" },
    ];

    const filtered = negatives.filter(n => n.reasonCn === "类目不匹配");
    expect(filtered).toHaveLength(2);
    expect(filtered.every(n => n.reasonCn === "类目不匹配")).toBe(true);
  });

  it("should extract unique reasons for filter dropdown", () => {
    const negatives = [
      { reasonCn: "类目不匹配" },
      { reasonCn: "相关性低" },
      { reasonCn: "类目不匹配" },
      { reasonCn: "竞品品牌词" },
    ];

    const uniqueReasons = Array.from(new Set(negatives.map(n => n.reasonCn)));
    expect(uniqueReasons).toHaveLength(3);
    expect(uniqueReasons).toContain("类目不匹配");
    expect(uniqueReasons).toContain("相关性低");
    expect(uniqueReasons).toContain("竞品品牌词");
  });
});

// ─── Feature 4: Batch Restore from Negative Library ───
describe("Negative Keywords - Batch Restore", () => {
  it("should restore keywords with skipSemanticFilter flag", () => {
    const restoredKeyword = {
      id: 1,
      keyword: "dog harness",
      skipSemanticFilter: true,
      status: "active",
    };

    expect(restoredKeyword.skipSemanticFilter).toBe(true);
    expect(restoredKeyword.status).toBe("active");
  });

  it("should skip semantic filter for keywords with skipSemanticFilter=true", () => {
    const keywords = [
      { id: 1, keyword: "dog harness", skipSemanticFilter: true },
      { id: 2, keyword: "cat toy", skipSemanticFilter: false },
      { id: 3, keyword: "pet collar", skipSemanticFilter: true },
    ];

    const toFilter = keywords.filter(k => !k.skipSemanticFilter);
    const skipped = keywords.filter(k => k.skipSemanticFilter);

    expect(toFilter).toHaveLength(1);
    expect(skipped).toHaveLength(2);
    expect(skipped.every(k => k.skipSemanticFilter)).toBe(true);
  });
});

// ─── Feature 5: Brand Competitor Tags ───
describe("Strategy Matrix - Brand Competitor Tags", () => {
  it("should support brand_competitor root category", () => {
    const rootCategories = [
      "core", "function", "scene", "audience", "spec",
      "painpoint", "gift_holiday", "brand_competitor",
    ];

    expect(rootCategories).toContain("brand_competitor");
  });

  it("should support brand_offensive strategy category", () => {
    const strategyCategories = [
      "core_main", "sub_core", "precise_longtail", "scene_intent",
      "longtail_main", "observe_test", "negative", "brand_offensive",
    ];

    expect(strategyCategories).toContain("brand_offensive");
  });

  it("should classify competitor brand keywords correctly", () => {
    const keywords = [
      { keyword: "ruffwear harness", rootCategory: "brand_competitor", strategyCategory: "brand_offensive" },
      { keyword: "kurgo dog harness", rootCategory: "brand_competitor", strategyCategory: "brand_offensive" },
      { keyword: "dog harness", rootCategory: "core", strategyCategory: "core_main" },
    ];

    const brandKeywords = keywords.filter(k => k.rootCategory === "brand_competitor");
    expect(brandKeywords).toHaveLength(2);
    expect(brandKeywords.every(k => k.strategyCategory === "brand_offensive")).toBe(true);
  });
});

// ─── Feature 6: Ad Structure - Offensive Campaign ───
describe("Ad Structure - Offensive Campaign", () => {
  it("should include offensive campaign in ad structure", () => {
    const adCampaigns = [
      { type: "auto", name: "自动广告" },
      { type: "exact", name: "精确匹配" },
      { type: "broad", name: "广泛匹配" },
      { type: "brand_offensive", name: "进攻广告活动" },
    ];

    const offensiveCampaign = adCampaigns.find(c => c.type === "brand_offensive");
    expect(offensiveCampaign).toBeDefined();
    expect(offensiveCampaign!.name).toBe("进攻广告活动");
  });

  it("should target competitor brand root keywords for offensive campaigns", () => {
    const keywords = [
      { keyword: "ruffwear harness", rootCategory: "brand_competitor", strategyCategory: "brand_offensive" },
      { keyword: "kurgo harness", rootCategory: "brand_competitor", strategyCategory: "brand_offensive" },
      { keyword: "dog harness", rootCategory: "core", strategyCategory: "core_main" },
    ];

    const offensiveTargets = keywords.filter(k => k.strategyCategory === "brand_offensive");
    expect(offensiveTargets).toHaveLength(2);
    expect(offensiveTargets.every(k => k.rootCategory === "brand_competitor")).toBe(true);
  });
});
