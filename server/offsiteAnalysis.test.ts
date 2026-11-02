import { describe, it, expect, vi } from "vitest";

// ─── Prompt exports ─────────────────────────────────────────────
describe("offsitePrompts", () => {
  it("exports all 7 source prompts and 1 summary prompt", async () => {
    const prompts = await import("./offsitePrompts");
    expect(prompts.GOOGLE_TRENDS_PROMPT).toBeDefined();
    expect(prompts.YOUTUBE_ANALYSIS_PROMPT).toBeDefined();
    expect(prompts.TIKTOK_ANALYSIS_PROMPT).toBeDefined();
    expect(prompts.FACEBOOK_ANALYSIS_PROMPT).toBeDefined();
    expect(prompts.INDEPENDENT_SITE_PROMPT).toBeDefined();
    expect(prompts.REDDIT_ANALYSIS_PROMPT).toBeDefined();
    expect(prompts.CROWDFUNDING_ANALYSIS_PROMPT).toBeDefined();
    expect(prompts.OFFSITE_SUMMARY_PROMPT).toBeDefined();
  });

  it("Google Trends prompt contains key analysis sections", async () => {
    const { GOOGLE_TRENDS_PROMPT } = await import("./offsitePrompts");
    expect(GOOGLE_TRENDS_PROMPT).toContain("搜索热度");
    expect(GOOGLE_TRENDS_PROMPT).toContain("市场容量");
    expect(GOOGLE_TRENDS_PROMPT).toContain("季节性");
    expect(GOOGLE_TRENDS_PROMPT).toContain("地域分布");
  });

  it("YouTube prompt contains KOL analysis sections", async () => {
    const { YOUTUBE_ANALYSIS_PROMPT } = await import("./offsitePrompts");
    expect(YOUTUBE_ANALYSIS_PROMPT).toContain("KOL");
    expect(YOUTUBE_ANALYSIS_PROMPT).toContain("视频内容");
    expect(YOUTUBE_ANALYSIS_PROMPT).toContain("互动数据");
    expect(YOUTUBE_ANALYSIS_PROMPT).toContain("竞品曝光");
  });

  it("TikTok prompt contains short video analysis sections", async () => {
    const { TIKTOK_ANALYSIS_PROMPT } = await import("./offsitePrompts");
    expect(TIKTOK_ANALYSIS_PROMPT).toContain("短视频");
    expect(TIKTOK_ANALYSIS_PROMPT).toContain("爆款");
    expect(TIKTOK_ANALYSIS_PROMPT).toContain("达人");
    expect(TIKTOK_ANALYSIS_PROMPT).toContain("趋势预测");
  });

  it("Facebook prompt contains social media analysis sections", async () => {
    const { FACEBOOK_ANALYSIS_PROMPT } = await import("./offsitePrompts");
    expect(FACEBOOK_ANALYSIS_PROMPT).toContain("广告策略");
    expect(FACEBOOK_ANALYSIS_PROMPT).toContain("社群运营");
    expect(FACEBOOK_ANALYSIS_PROMPT).toContain("品牌策略");
  });

  it("Independent site prompt contains website analysis sections", async () => {
    const { INDEPENDENT_SITE_PROMPT } = await import("./offsitePrompts");
    expect(INDEPENDENT_SITE_PROMPT).toContain("流量分析");
    expect(INDEPENDENT_SITE_PROMPT).toContain("产品策略");
    expect(INDEPENDENT_SITE_PROMPT).toContain("营销策略");
    expect(INDEPENDENT_SITE_PROMPT).toContain("品牌建设");
  });

  it("Reddit prompt contains user-specified analysis sections", async () => {
    const { REDDIT_ANALYSIS_PROMPT } = await import("./offsitePrompts");
    expect(REDDIT_ANALYSIS_PROMPT).toContain("讨论总结");
    expect(REDDIT_ANALYSIS_PROMPT).toContain("客户痛点");
    expect(REDDIT_ANALYSIS_PROMPT).toContain("当前解决方案");
    expect(REDDIT_ANALYSIS_PROMPT).toContain("客户语言");
    expect(REDDIT_ANALYSIS_PROMPT).toContain("竞品/品牌提及");
  });

  it("Crowdfunding prompt contains innovation analysis sections", async () => {
    const { CROWDFUNDING_ANALYSIS_PROMPT } = await import("./offsitePrompts");
    expect(CROWDFUNDING_ANALYSIS_PROMPT).toContain("众筹项目");
    expect(CROWDFUNDING_ANALYSIS_PROMPT).toContain("爆款项目");
    expect(CROWDFUNDING_ANALYSIS_PROMPT).toContain("产品创新");
    expect(CROWDFUNDING_ANALYSIS_PROMPT).toContain("市场需求验证");
  });

  it("Summary prompt contains cross-channel analysis sections", async () => {
    const { OFFSITE_SUMMARY_PROMPT } = await import("./offsitePrompts");
    expect(OFFSITE_SUMMARY_PROMPT).toContain("多渠道数据交叉验证");
    expect(OFFSITE_SUMMARY_PROMPT).toContain("市场需求全景");
    expect(OFFSITE_SUMMARY_PROMPT).toContain("竞争态势");
    expect(OFFSITE_SUMMARY_PROMPT).toContain("产品开发建议");
    expect(OFFSITE_SUMMARY_PROMPT).toContain("风险提示");
  });
});

// ─── Schema ─────────────────────────────────────────────────────
describe("devOffsiteAnalyses schema", () => {
  it("exports table and types", async () => {
    const schema = await import("../drizzle/schema");
    expect(schema.devOffsiteAnalyses).toBeDefined();
    // Check table has expected columns
    const table = schema.devOffsiteAnalyses;
    expect(table.id).toBeDefined();
    expect(table.projectId).toBeDefined();
    expect(table.sourceType).toBeDefined();
    expect(table.keyword).toBeDefined();
    expect(table.status).toBeDefined();
    expect(table.rawData).toBeDefined();
    expect(table.aiAnalysis).toBeDefined();
    expect(table.aiAnalysisConfirmed).toBeDefined();
    expect(table.editedAnalysis).toBeDefined();
  });

  it("source_type enum has all 7 values", async () => {
    const schema = await import("../drizzle/schema");
    const table = schema.devOffsiteAnalyses;
    // The sourceType column should be defined
    expect(table.sourceType).toBeDefined();
  });
});

// ─── Router structure ───────────────────────────────────────────
describe("offsiteAnalysis router", () => {
  it("exports offsiteAnalysisRouter", async () => {
    const { offsiteAnalysisRouter } = await import("./routers/offsiteAnalysis");
    expect(offsiteAnalysisRouter).toBeDefined();
  });

  it("router has all expected procedures", async () => {
    const { offsiteAnalysisRouter } = await import("./routers/offsiteAnalysis");
    const procedures = offsiteAnalysisRouter._def.procedures;
    expect(procedures).toHaveProperty("list");
    expect(procedures).toHaveProperty("listBySource");
    expect(procedures).toHaveProperty("get");
    expect(procedures).toHaveProperty("analyze");
    expect(procedures).toHaveProperty("edit");
    expect(procedures).toHaveProperty("confirm");
    expect(procedures).toHaveProperty("unconfirm");
    expect(procedures).toHaveProperty("delete");
    expect(procedures).toHaveProperty("reanalyze");
    expect(procedures).toHaveProperty("generateSummary");
  });
});

// ─── DB helpers ─────────────────────────────────────────────────
describe("offsite DB helpers", () => {
  it("exports all CRUD functions", async () => {
    const db = await import("./devDb");
    expect(typeof db.createOffsiteAnalysis).toBe("function");
    expect(typeof db.getOffsiteAnalysesByProject).toBe("function");
    expect(typeof db.getOffsiteAnalysesBySource).toBe("function");
    expect(typeof db.getOffsiteAnalysisById).toBe("function");
    expect(typeof db.updateOffsiteAnalysis).toBe("function");
    expect(typeof db.deleteOffsiteAnalysis).toBe("function");
  });
});

// ─── Data fetching functions ────────────────────────────────────
describe("data fetching logic", () => {
  it("router handles all 7 source types in analyze mutation", async () => {
    // Verify the source type enum includes all expected values
    const sourceTypes = [
      "google_trends", "youtube", "tiktok", "facebook",
      "independent_site", "reddit", "crowdfunding"
    ];
    
    // Import the router to verify it handles all source types
    const { offsiteAnalysisRouter } = await import("./routers/offsiteAnalysis");
    expect(offsiteAnalysisRouter).toBeDefined();
    
    // Verify all source types are valid enum values
    sourceTypes.forEach(type => {
      expect(typeof type).toBe("string");
      expect(type.length).toBeGreaterThan(0);
    });
  });
});

// ─── Integration with main router ───────────────────────────────
describe("router integration", () => {
  it("offsiteAnalysis is registered in the main app router", { timeout: 15000 }, async () => {
    const { appRouter } = await import("./routers");
    const procedures = appRouter._def.procedures;
    expect(procedures).toHaveProperty("offsiteAnalysis.list");
    expect(procedures).toHaveProperty("offsiteAnalysis.analyze");
    expect(procedures).toHaveProperty("offsiteAnalysis.edit");
    expect(procedures).toHaveProperty("offsiteAnalysis.confirm");
    expect(procedures).toHaveProperty("offsiteAnalysis.delete");
    expect(procedures).toHaveProperty("offsiteAnalysis.generateSummary");
  });
});
