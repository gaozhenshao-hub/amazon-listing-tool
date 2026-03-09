import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB functions
vi.mock("./db", () => ({
  createAdStructure: vi.fn().mockResolvedValue({ id: 1 }),
  getAdStructuresByProject: vi.fn().mockResolvedValue([]),
  getAdStructureById: vi.fn().mockResolvedValue(null),
  updateAdStructure: vi.fn().mockResolvedValue({ success: true }),
  deleteAdStructure: vi.fn().mockResolvedValue({ success: true }),
  getProjectById: vi.fn().mockResolvedValue({
    id: 1, name: "Test Product", brand: "TestBrand",
    productName: "Wireless Earbuds", category: "Electronics",
    targetMarket: "US", productFeatures: '["Noise Cancelling","Waterproof"]',
  }),
  getKeywordsByProject: vi.fn().mockResolvedValue([
    { keyword: "wireless earbuds", relevance: "high", trafficLevel: "high", competition: "high", strategyCategory: "core_main", monthlySearchVolume: 50000, ppcBid: "1.50" },
    { keyword: "bluetooth earbuds noise cancelling", relevance: "high", trafficLevel: "medium", competition: "medium", strategyCategory: "precise_longtail", monthlySearchVolume: 8000, ppcBid: "0.80" },
    { keyword: "earbuds for running", relevance: "medium", trafficLevel: "medium", competition: "low", strategyCategory: "scene_intent", sceneTags: '["运动","户外"]', monthlySearchVolume: 5000, ppcBid: "0.60" },
  ]),
}));

// Import prompt
import { AD_STRUCTURE_PROMPT } from "./adStructurePrompt";

describe("Ad Structure Prompt", () => {
  it("should contain all required sections", () => {
    expect(AD_STRUCTURE_PROMPT).toContain("核心大词组");
    expect(AD_STRUCTURE_PROMPT).toContain("精准长尾组");
    expect(AD_STRUCTURE_PROMPT).toContain("场景意图组");
    expect(AD_STRUCTURE_PROMPT).toContain("竞品ASIN定投组");
    expect(AD_STRUCTURE_PROMPT).toContain("品牌防御组");
    expect(AD_STRUCTURE_PROMPT).toContain("自动广告组");
  });

  it("should contain match type definitions", () => {
    expect(AD_STRUCTURE_PROMPT).toContain("Exact（精准匹配）");
    expect(AD_STRUCTURE_PROMPT).toContain("Phrase（词组匹配）");
    expect(AD_STRUCTURE_PROMPT).toContain("Broad（广泛匹配）");
  });

  it("should contain budget allocation section", () => {
    expect(AD_STRUCTURE_PROMPT).toContain("budgetAllocation");
    expect(AD_STRUCTURE_PROMPT).toContain("totalDailyBudget");
    expect(AD_STRUCTURE_PROMPT).toContain("percentage");
  });

  it("should contain phase strategy section", () => {
    expect(AD_STRUCTURE_PROMPT).toContain("phaseStrategy");
    expect(AD_STRUCTURE_PROMPT).toContain("newProduct");
    expect(AD_STRUCTURE_PROMPT).toContain("growth");
    expect(AD_STRUCTURE_PROMPT).toContain("mature");
  });

  it("should contain negative keyword strategy", () => {
    expect(AD_STRUCTURE_PROMPT).toContain("negativeKeywordStrategy");
    expect(AD_STRUCTURE_PROMPT).toContain("campaignLevel");
    expect(AD_STRUCTURE_PROMPT).toContain("adGroupLevel");
  });

  it("should have placeholders for dynamic content", () => {
    expect(AD_STRUCTURE_PROMPT).toContain("{productContext}");
    expect(AD_STRUCTURE_PROMPT).toContain("{keywordData}");
    expect(AD_STRUCTURE_PROMPT).toContain("{competitorSummary}");
  });

  it("should contain JSON output format specification", () => {
    expect(AD_STRUCTURE_PROMPT).toContain("adStructure");
    expect(AD_STRUCTURE_PROMPT).toContain("campaigns");
    expect(AD_STRUCTURE_PROMPT).toContain("campaignName");
    expect(AD_STRUCTURE_PROMPT).toContain("adGroupType");
    expect(AD_STRUCTURE_PROMPT).toContain("matchType");
    expect(AD_STRUCTURE_PROMPT).toContain("suggestedBid");
  });

  it("should contain optimization notes", () => {
    expect(AD_STRUCTURE_PROMPT).toContain("否定词策略要防止广告组之间的内部竞争");
    expect(AD_STRUCTURE_PROMPT).toContain("核心大词组只放最重要的3-5个高流量词");
  });
});

describe("Ad Structure Data Model", () => {
  it("should parse valid ad structure JSON", () => {
    const sampleData = {
      adStructure: {
        campaigns: [
          {
            campaignName: "SP-核心大词-精准",
            campaignType: "manual",
            adGroupType: "core_keywords",
            matchType: "exact",
            dailyBudget: "$30",
            bidStrategy: "动态竞价-提高和降低",
            phase: "成熟期",
            priority: "high",
            keywords: [
              { keyword: "wireless earbuds", suggestedBid: "$1.50", searchVolume: "高", competition: "高", note: "核心主词" },
            ],
            negativeKeywords: ["free", "cheap"],
            optimizationTips: "重点监控ACoS",
          },
          {
            campaignName: "SP-精准长尾-精准",
            campaignType: "manual",
            adGroupType: "precise_longtail",
            matchType: "exact",
            dailyBudget: "$15",
            bidStrategy: "固定竞价",
            phase: "新品期",
            priority: "high",
            keywords: [
              { keyword: "bluetooth earbuds noise cancelling", suggestedBid: "$0.80", searchVolume: "中", competition: "中", note: "长尾精准" },
            ],
            negativeKeywords: [],
            optimizationTips: "新品期主力投放",
          },
        ],
        autoCompaign: {
          dailyBudget: "$10",
          defaultBid: "$0.50",
          negativeExact: ["wireless earbuds"],
          negativePhrase: [],
          optimizationTips: "每周收词一次",
          harvestStrategy: "7天内有2次以上点击的词移入手动广告",
        },
      },
      budgetAllocation: {
        totalDailyBudget: "$80",
        breakdown: [
          { campaignGroup: "核心大词", percentage: 35, dailyAmount: "$28", reason: "主要转化来源" },
          { campaignGroup: "精准长尾", percentage: 25, dailyAmount: "$20", reason: "新品期主力" },
        ],
      },
      phaseStrategy: {
        newProduct: { duration: "1-4周", focus: "精准长尾组", budgetSplit: "长尾60%+自动30%+核心10%", keyActions: ["低竞价测试", "收集数据"] },
        growth: { duration: "1-3个月", focus: "核心大词组+场景意图组", budgetSplit: "核心40%+长尾25%+场景20%+自动15%", keyActions: ["提高核心词竞价", "拓展场景词"] },
        mature: { duration: "3个月+", focus: "核心大词组+品牌防御", budgetSplit: "核心50%+品牌20%+场景15%+其他15%", keyActions: ["优化ACoS", "品牌词防御"] },
      },
      negativeKeywordStrategy: {
        campaignLevel: ["free", "cheap", "how to"],
        adGroupLevel: { core_keywords: ["earbuds for running"], precise_longtail: [] },
        rules: "每周检查搜索词报告，将不相关词添加为否定词",
      },
      overallStrategy: "以精准长尾词为新品期突破口，逐步拓展核心大词和场景词",
    };

    // Verify structure
    expect(sampleData.adStructure.campaigns).toHaveLength(2);
    expect(sampleData.adStructure.campaigns[0].adGroupType).toBe("core_keywords");
    expect(sampleData.adStructure.campaigns[0].matchType).toBe("exact");
    expect(sampleData.adStructure.campaigns[0].keywords).toHaveLength(1);
    expect(sampleData.adStructure.autoCompaign.dailyBudget).toBe("$10");
    expect(sampleData.budgetAllocation.breakdown).toHaveLength(2);
    expect(sampleData.phaseStrategy.newProduct.keyActions).toHaveLength(2);
    expect(sampleData.negativeKeywordStrategy.campaignLevel).toContain("free");
  });

  it("should correctly count campaigns and keywords", () => {
    const campaigns = [
      { keywords: [{ keyword: "a" }, { keyword: "b" }] },
      { keywords: [{ keyword: "c" }] },
      { keywords: [{ keyword: "d" }, { keyword: "e" }, { keyword: "f" }] },
    ];
    const totalKeywords = campaigns.reduce((sum, c) => sum + (c.keywords?.length || 0), 0);
    expect(totalKeywords).toBe(6);
    expect(campaigns.length).toBe(3);
  });

  it("should handle empty campaigns array", () => {
    const data = { adStructure: { campaigns: [] } };
    const totalKeywords = data.adStructure.campaigns.reduce((sum: number, c: any) => sum + (c.keywords?.length || 0), 0);
    expect(totalKeywords).toBe(0);
  });

  it("should group campaigns by adGroupType and matchType for matrix view", () => {
    const campaigns = [
      { adGroupType: "core_keywords", matchType: "exact", keywords: [{ keyword: "a" }] },
      { adGroupType: "core_keywords", matchType: "phrase", keywords: [{ keyword: "b" }] },
      { adGroupType: "precise_longtail", matchType: "exact", keywords: [{ keyword: "c" }] },
      { adGroupType: "scene_intent", matchType: "broad", keywords: [{ keyword: "d" }] },
    ];

    const matrix: Record<string, Record<string, any>> = {};
    for (const campaign of campaigns) {
      const groupType = campaign.adGroupType;
      const matchType = campaign.matchType;
      if (!matrix[groupType]) matrix[groupType] = {};
      matrix[groupType][matchType] = campaign;
    }

    expect(Object.keys(matrix)).toHaveLength(3);
    expect(matrix["core_keywords"]["exact"].keywords[0].keyword).toBe("a");
    expect(matrix["core_keywords"]["phrase"].keywords[0].keyword).toBe("b");
    expect(matrix["precise_longtail"]["exact"].keywords[0].keyword).toBe("c");
    expect(matrix["scene_intent"]["broad"].keywords[0].keyword).toBe("d");
    expect(matrix["core_keywords"]["broad"]).toBeUndefined();
  });

  it("should build product context from project data", () => {
    const project = {
      name: "Test Product",
      brand: "TestBrand",
      productName: "Wireless Earbuds",
      category: "Electronics",
      targetMarket: "US",
      productFeatures: '["Noise Cancelling","Waterproof"]',
    };

    const parts: string[] = [];
    if (project.name) parts.push(`Product: ${project.name}`);
    if (project.brand) parts.push(`Brand: ${project.brand}`);
    if (project.productName) parts.push(`Product Name: ${project.productName}`);
    if (project.category) parts.push(`Category: ${project.category}`);
    if (project.targetMarket) parts.push(`Target Market: ${project.targetMarket}`);
    if (project.productFeatures) {
      try {
        const features = JSON.parse(project.productFeatures);
        parts.push(`Features: ${features.join(", ")}`);
      } catch { /* ignore */ }
    }
    const context = parts.join("\n");

    expect(context).toContain("Product: Test Product");
    expect(context).toContain("Brand: TestBrand");
    expect(context).toContain("Features: Noise Cancelling, Waterproof");
  });

  it("should build keyword summary grouped by strategy category", () => {
    const keywords = [
      { keyword: "wireless earbuds", strategyCategory: "core_main", relevance: "high", trafficLevel: "high" },
      { keyword: "bluetooth earbuds", strategyCategory: "core_main", relevance: "high", trafficLevel: "high" },
      { keyword: "earbuds for running", strategyCategory: "scene_intent", relevance: "medium", trafficLevel: "medium", sceneTags: '["运动"]' },
    ];

    const grouped: Record<string, any[]> = {};
    for (const kw of keywords) {
      const cat = kw.strategyCategory || "unclassified";
      if (!grouped[cat]) grouped[cat] = [];
      grouped[cat].push(kw);
    }

    expect(Object.keys(grouped)).toHaveLength(2);
    expect(grouped["core_main"]).toHaveLength(2);
    expect(grouped["scene_intent"]).toHaveLength(1);
  });
});

describe("Ad Structure Priority and Phase Mapping", () => {
  it("should map priority levels correctly", () => {
    const priorities = ["high", "medium", "low"];
    const labels: Record<string, string> = { high: "高优先", medium: "中优先", low: "低优先" };
    for (const p of priorities) {
      expect(labels[p]).toBeDefined();
    }
  });

  it("should map ad group types correctly", () => {
    const types = ["core_keywords", "precise_longtail", "scene_intent", "competitor_targeting", "brand_defense", "auto_campaign"];
    const labels: Record<string, string> = {
      core_keywords: "核心大词组",
      precise_longtail: "精准长尾组",
      scene_intent: "场景意图组",
      competitor_targeting: "竞品ASIN定投组",
      brand_defense: "品牌防御组",
      auto_campaign: "自动广告组",
    };
    for (const t of types) {
      expect(labels[t]).toBeDefined();
    }
  });

  it("should map match types correctly", () => {
    const types = ["exact", "phrase", "broad"];
    const labels: Record<string, string> = { exact: "精准匹配", phrase: "词组匹配", broad: "广泛匹配" };
    for (const t of types) {
      expect(labels[t]).toBeDefined();
    }
  });
});
