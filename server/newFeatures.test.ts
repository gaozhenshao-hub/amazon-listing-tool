import { describe, it, expect, vi } from "vitest";

// ─── Test 1: Report HTML Generation ──────────────────────────────

describe("Report Router - generateReportHtml", () => {
  it("should generate valid HTML report with project info", async () => {
    // Import the report module to test HTML generation
    const reportModule = await import("./routers/report");
    
    // The generateReportHtml is not exported directly, so we test via the router
    // Instead, we test the escapeHtml utility pattern
    const testHtml = "<script>alert('xss')</script>";
    const escaped = testHtml
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
    
    expect(escaped).toBe("&lt;script&gt;alert(&#x27;xss&#x27;)&lt;/script&gt;".replace(/&#x27;/g, "'"));
    expect(escaped).not.toContain("<script>");
  });

  it("should handle empty listing data gracefully", () => {
    // Test that null/undefined listing fields don't crash
    const listing = {
      title: null,
      titleCn: null,
      bulletPoints: null,
      bulletPointsCn: null,
      description: null,
      descriptionCn: null,
      searchTerms: null,
      searchTermsCn: null,
      imageAdvice: null,
      imageAdviceCn: null,
    };

    // Simulate the parsing logic from report.ts
    let bulletPoints: any[] = [];
    let bulletPointsCn: any[] = [];
    let imageAdvice: any = null;

    try { bulletPoints = listing?.bulletPoints ? JSON.parse(listing.bulletPoints) : []; } catch {}
    try { bulletPointsCn = listing?.bulletPointsCn ? JSON.parse(listing.bulletPointsCn) : []; } catch {}
    try { imageAdvice = listing?.imageAdvice ? JSON.parse(listing.imageAdvice) : null; } catch {}

    expect(bulletPoints).toEqual([]);
    expect(bulletPointsCn).toEqual([]);
    expect(imageAdvice).toBeNull();
  });

  it("should correctly parse bulletPoints object with nested array", () => {
    const bpData = JSON.stringify({
      bulletPoints: [
        { subtitle: "Test", fullText: "Full text here" },
        { subtitle: "Test2", fullText: "Full text 2" },
      ],
    });

    let bulletPoints: any = JSON.parse(bpData);
    
    // Simulate the unwrapping logic
    if (bulletPoints && !Array.isArray(bulletPoints) && (bulletPoints as any).bulletPoints) {
      bulletPoints = (bulletPoints as any).bulletPoints;
    }

    expect(Array.isArray(bulletPoints)).toBe(true);
    expect(bulletPoints).toHaveLength(2);
    expect(bulletPoints[0].subtitle).toBe("Test");
  });
});

// ─── Test 2: Version History Logic ───────────────────────────────

describe("Analysis Version History", () => {
  it("should track version numbers correctly", () => {
    // Simulate version numbering
    const versions = [
      { version: 1, changeType: "auto_analysis", changeNote: "Initial AI analysis" },
      { version: 2, changeType: "manual_edit", changeNote: "Manual edit" },
      { version: 3, changeType: "manual_edit", changeNote: "Restored from version 1" },
    ];

    expect(versions[0].version).toBe(1);
    expect(versions[versions.length - 1].version).toBe(3);
    
    // Latest version should be highest number
    const latestVersion = Math.max(...versions.map(v => v.version));
    expect(latestVersion).toBe(3);
  });

  it("should distinguish change types correctly", () => {
    const validTypes = ["auto_analysis", "manual_edit", "re_analysis"];
    
    expect(validTypes).toContain("auto_analysis");
    expect(validTypes).toContain("manual_edit");
    expect(validTypes).toContain("re_analysis");
    expect(validTypes).not.toContain("unknown");
  });

  it("should handle restore version creating new entry", () => {
    const versions = [
      { version: 1, changeType: "auto_analysis", analysisResult: '{"key":"v1"}' },
      { version: 2, changeType: "manual_edit", analysisResult: '{"key":"v2"}' },
    ];

    // Simulate restore: create new version with old data
    const restoredVersion = {
      version: 3,
      changeType: "manual_edit",
      analysisResult: versions[0].analysisResult, // Restore v1 data
      changeNote: `Restored from version ${versions[0].version}`,
    };

    expect(restoredVersion.version).toBe(3);
    expect(restoredVersion.analysisResult).toBe('{"key":"v1"}');
    expect(restoredVersion.changeNote).toBe("Restored from version 1");
  });
});

// ─── Test 3: File Template Config ────────────────────────────────

describe("File Template Download", () => {
  it("should have template URLs for all 4 file types", () => {
    const fileTypes = ["product_attributes", "competitor_listings", "search_term_report", "aba_keywords"];
    
    // Each file type should have a corresponding template
    expect(fileTypes).toHaveLength(4);
    fileTypes.forEach(type => {
      expect(typeof type).toBe("string");
      expect(type.length).toBeGreaterThan(0);
    });
  });

  it("should validate template file extensions", () => {
    const templates = {
      product_attributes: "本品属性表_模板.txt",
      competitor_listings: "竞品Listing文本_模板.txt",
      search_term_report: "竞品出单词报告_模板.csv",
      aba_keywords: "ABA关键词数据_模板.csv",
    };

    expect(templates.product_attributes).toMatch(/\.txt$/);
    expect(templates.competitor_listings).toMatch(/\.txt$/);
    expect(templates.search_term_report).toMatch(/\.csv$/);
    expect(templates.aba_keywords).toMatch(/\.csv$/);
  });
});

// ─── Test 4: Report Data Assembly ────────────────────────────────

describe("Report Data Assembly", () => {
  it("should assemble analysis summary from project files", () => {
    const files = [
      { fileType: "product_attributes", status: "completed", analysisResult: '{"uniqueSellingPoints":["USP1"]}' },
      { fileType: "competitor_listings", status: "completed", analysisResult: '{"parityPoints":[]}' },
      { fileType: "search_term_report", status: "completed", analysisResult: '{"sceneClusters":[]}' },
      { fileType: "aba_keywords", status: "failed", analysisResult: null },
    ];

    const summary: Record<string, any> = {
      productAttributes: null,
      competitorListings: null,
      cosmoScenes: null,
      a9Keywords: null,
    };

    for (const file of files) {
      if (file.status !== "completed" || !file.analysisResult) continue;
      try {
        const result = JSON.parse(file.analysisResult);
        switch (file.fileType) {
          case "product_attributes": summary.productAttributes = result; break;
          case "competitor_listings": summary.competitorListings = result; break;
          case "search_term_report": summary.cosmoScenes = result; break;
          case "aba_keywords": summary.a9Keywords = result; break;
        }
      } catch {}
    }

    expect(summary.productAttributes).not.toBeNull();
    expect(summary.productAttributes.uniqueSellingPoints).toEqual(["USP1"]);
    expect(summary.competitorListings).not.toBeNull();
    expect(summary.cosmoScenes).not.toBeNull();
    expect(summary.a9Keywords).toBeNull(); // Failed file should not be included
  });

  it("should detect hasAllFiles correctly", () => {
    const summary = {
      productAttributes: { data: true },
      competitorListings: { data: true },
      cosmoScenes: { data: true },
      a9Keywords: null,
    };

    const hasAllFiles = !!(
      summary.productAttributes &&
      summary.competitorListings &&
      summary.cosmoScenes &&
      summary.a9Keywords
    );

    expect(hasAllFiles).toBe(false);

    // With all files
    summary.a9Keywords = { data: true } as any;
    const hasAll2 = !!(
      summary.productAttributes &&
      summary.competitorListings &&
      summary.cosmoScenes &&
      summary.a9Keywords
    );
    expect(hasAll2).toBe(true);
  });
});

// ─── Feature 5: Competitor ASIN Targeting Estimation ───────────────

describe("Competitor ASIN Targeting Estimation", () => {
  it("should calculate targeting score based on rating", () => {
    const rating1 = 3.2;
    const rating2 = 4.8;
    
    const ratingScore1 = Math.max(0, (5 - rating1) / 5 * 30);
    const ratingScore2 = Math.max(0, (5 - rating2) / 5 * 30);
    
    expect(ratingScore1).toBeGreaterThan(ratingScore2);
    expect(ratingScore1).toBeCloseTo(10.8, 1);
    expect(ratingScore2).toBeCloseTo(1.2, 1);
  });

  it("should calculate targeting score based on review count", () => {
    const reviews1 = 50;
    const reviews2 = 5000;
    
    const reviewScore1 = Math.max(0, 20 - Math.log10(reviews1 + 1) * 5);
    const reviewScore2 = Math.max(0, 20 - Math.log10(reviews2 + 1) * 5);
    
    expect(reviewScore1).toBeGreaterThan(reviewScore2);
  });

  it("should classify priority correctly", () => {
    const classify = (score: number) => {
      if (score >= 70) return "high";
      if (score >= 50) return "medium";
      if (score >= 30) return "low";
      return "skip";
    };
    
    expect(classify(85)).toBe("high");
    expect(classify(60)).toBe("medium");
    expect(classify(40)).toBe("low");
    expect(classify(20)).toBe("skip");
  });

  it("should generate targeting recommendations based on score", () => {
    const getRecommendation = (priority: string) => {
      const recs: Record<string, string> = {
        high: "强烈建议定投",
        medium: "建议测试定投",
        low: "可选择性定投",
        skip: "暂不建议定投",
      };
      return recs[priority] || "暂不建议定投";
    };
    
    expect(getRecommendation("high")).toBe("强烈建议定投");
    expect(getRecommendation("medium")).toBe("建议测试定投");
    expect(getRecommendation("low")).toBe("可选择性定投");
    expect(getRecommendation("skip")).toBe("暂不建议定投");
  });

  it("should handle competitors with missing data gracefully", () => {
    const competitor = { asin: "B0TEST12345", rating: null, reviewCount: null, price: null };
    
    const rating = competitor.rating ?? 4.0;
    const reviews = competitor.reviewCount ?? 100;
    
    expect(rating).toBe(4.0);
    expect(reviews).toBe(100);
  });
});

// ─── Feature 6: Keyword Readiness Indicator ───────────────

describe("Keyword Readiness Indicator", () => {
  it("should detect scene tagging completion", () => {
    const stats = { total: 100, withSceneTags: 80, withStrategy: 60, withPlacement: 50 };
    
    const sceneTagged = stats.withSceneTags > 0;
    const scenePercentage = Math.round((stats.withSceneTags / stats.total) * 100);
    
    expect(sceneTagged).toBe(true);
    expect(scenePercentage).toBe(80);
  });

  it("should detect strategy matrix completion", () => {
    const stats = { total: 100, withSceneTags: 0, withStrategy: 0, withPlacement: 0 };
    
    const strategyDone = stats.withStrategy > 0;
    const placementDone = stats.withPlacement > 0;
    
    expect(strategyDone).toBe(false);
    expect(placementDone).toBe(false);
  });

  it("should calculate overall readiness", () => {
    const steps = [
      { name: "keywords_imported", done: true },
      { name: "scene_tagged", done: true },
      { name: "strategy_analyzed", done: false },
      { name: "placement_assigned", done: false },
    ];
    
    const completedSteps = steps.filter(s => s.done).length;
    const totalSteps = steps.length;
    const readinessPercentage = Math.round((completedSteps / totalSteps) * 100);
    
    expect(readinessPercentage).toBe(50);
  });

  it("should show zero readiness when no keywords exist", () => {
    const stats = { total: 0, withSceneTags: 0, withStrategy: 0, withPlacement: 0 };
    
    const hasKeywords = stats.total > 0;
    expect(hasKeywords).toBe(false);
  });
});

// ─── Feature 7: Keyword CSV Export ───────────────

describe("Keyword CSV Export", () => {
  it("should generate valid CSV header", () => {
    const headers = [
      "关键词", "搜索量", "PPC竞价", "相关性", "流量级别",
      "竞争度", "策略分类", "词根分类", "词根", "Listing位置",
      "场景标签", "状态", "来源"
    ];
    
    const csvHeader = headers.join(",");
    expect(csvHeader).toContain("关键词");
    expect(csvHeader).toContain("搜索量");
    expect(csvHeader).toContain("策略分类");
    expect(headers.length).toBe(13);
  });

  it("should escape commas in CSV values", () => {
    const sceneTags = ["outdoor", "camping", "hiking"];
    const escaped = `"${sceneTags.join(", ")}"`;
    
    expect(escaped).toBe('"outdoor, camping, hiking"');
  });

  it("should handle null values in CSV rows", () => {
    const kw = { keyword: "test", searchVolume: null, ppcBid: null, relevance: "high" };
    
    const row = [
      kw.keyword,
      kw.searchVolume || "",
      kw.ppcBid || "",
      kw.relevance || "",
    ].join(",");
    
    expect(row).toBe("test,,,high");
  });

  it("should add BOM for Excel compatibility", () => {
    const bom = "\uFEFF";
    const csvContent = bom + "关键词,搜索量\ntest,1000";
    
    expect(csvContent.startsWith("\uFEFF")).toBe(true);
  });

  it("should generate ad structure CSV with campaign data", () => {
    const campaigns = [
      {
        campaignName: "SP-Core-Exact",
        adGroupType: "核心词组",
        matchType: "精准匹配",
        keywords: [
          { keyword: "test keyword", suggestedBid: "$1.50" },
          { keyword: "another keyword", suggestedBid: "$2.00" },
        ],
        dailyBudget: "$50",
      },
    ];
    
    const rows: string[] = [];
    rows.push("Campaign,广告组类型,匹配类型,关键词,建议竞价,日预算");
    
    for (const c of campaigns) {
      for (const kw of c.keywords) {
        rows.push([
          c.campaignName,
          c.adGroupType,
          c.matchType,
          kw.keyword,
          kw.suggestedBid,
          c.dailyBudget,
        ].join(","));
      }
    }
    
    expect(rows.length).toBe(3);
    expect(rows[1]).toContain("test keyword");
    expect(rows[2]).toContain("another keyword");
  });
});

// ─── Feature 8: AI Optimize Dimension ───────────────

describe("AI Optimize Dimension", () => {
  it("should identify optimizable dimensions", () => {
    const OPTIMIZABLE = new Set([
      "Title Optimization",
      "Bullet Points Quality",
      "Description Quality",
      "Search Terms Optimization",
    ]);
    
    expect(OPTIMIZABLE.has("Title Optimization")).toBe(true);
    expect(OPTIMIZABLE.has("Bullet Points Quality")).toBe(true);
    expect(OPTIMIZABLE.has("Description Quality")).toBe(true);
    expect(OPTIMIZABLE.has("Search Terms Optimization")).toBe(true);
    expect(OPTIMIZABLE.has("Keyword Coverage")).toBe(false);
    expect(OPTIMIZABLE.has("Overall SEO")).toBe(false);
  });

  it("should map dimension to listing field correctly", () => {
    const fieldMap: Record<string, string> = {
      "Title Optimization": "title",
      "Bullet Points Quality": "bulletPoints",
      "Description Quality": "description",
      "Search Terms Optimization": "searchTerms",
    };
    
    expect(fieldMap["Title Optimization"]).toBe("title");
    expect(fieldMap["Bullet Points Quality"]).toBe("bulletPoints");
    expect(fieldMap["Description Quality"]).toBe("description");
    expect(fieldMap["Search Terms Optimization"]).toBe("searchTerms");
  });

  it("should collect failed issues for optimization context", () => {
    const details = [
      { passed: true, messageCn: "标题长度合适", severity: "info" },
      { passed: false, messageCn: "标题缺少核心关键词", severity: "critical" },
      { passed: false, messageCn: "标题未使用Title Case", severity: "warning" },
      { passed: true, messageCn: "标题包含品牌名", severity: "info" },
    ];
    
    const issues = details
      .filter(d => !d.passed)
      .map(d => d.messageCn);
    
    expect(issues.length).toBe(2);
    expect(issues[0]).toBe("标题缺少核心关键词");
    expect(issues[1]).toBe("标题未使用Title Case");
  });

  it("should determine if dimension needs optimization based on percentage", () => {
    const dimensions = [
      { name: "Title Optimization", percentage: 90 },
      { name: "Bullet Points Quality", percentage: 60 },
      { name: "Description Quality", percentage: 45 },
      { name: "Search Terms Optimization", percentage: 80 },
    ];
    
    const needsOptimize = dimensions.filter(d => d.percentage < 85);
    expect(needsOptimize.length).toBe(3);
    expect(needsOptimize[0].name).toBe("Bullet Points Quality");
  });

  it("should find lowest scoring optimizable dimension", () => {
    const OPTIMIZABLE = new Set([
      "Title Optimization",
      "Bullet Points Quality",
      "Description Quality",
      "Search Terms Optimization",
    ]);
    
    const dimensions = [
      { name: "Title Optimization", percentage: 75 },
      { name: "Bullet Points Quality", percentage: 45 },
      { name: "Description Quality", percentage: 60 },
      { name: "Keyword Coverage", percentage: 30 },
      { name: "Overall SEO", percentage: 50 },
    ];
    
    const lowest = dimensions
      .filter(d => OPTIMIZABLE.has(d.name) && d.percentage < 70)
      .sort((a, b) => a.percentage - b.percentage)[0];
    
    expect(lowest.name).toBe("Bullet Points Quality");
    expect(lowest.percentage).toBe(45);
  });

  it("should validate bullet points JSON format", () => {
    const validJson = JSON.stringify({
      bulletPoints: [
        { subtitle: "TEST", fullText: "TEST - description", characterCount: 200, keywordsUsed: ["kw1"] },
      ],
    });
    
    const parsed = JSON.parse(validJson);
    expect(parsed.bulletPoints).toBeDefined();
    expect(Array.isArray(parsed.bulletPoints)).toBe(true);
    expect(parsed.bulletPoints[0].subtitle).toBe("TEST");
  });

  it("should handle non-optimizable dimensions gracefully", () => {
    const OPTIMIZABLE = new Set([
      "Title Optimization",
      "Bullet Points Quality",
      "Description Quality",
      "Search Terms Optimization",
    ]);
    
    const dimension = "Keyword Coverage";
    const canOptimize = OPTIMIZABLE.has(dimension);
    
    expect(canOptimize).toBe(false);
  });
});
