import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-local-ads",
    email: "test@example.com",
    name: "Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: () => {},
    } as TrpcContext["res"],
  };
  return { ctx };
}

describe("adLocalAnalysis router", () => {
  // Test 1: getCategoryDefinitionsLocal returns correct structure
  it("getCategoryDefinitionsLocal returns categories and defaultThresholds", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getCategoryDefinitionsLocal();

    expect(result).toHaveProperty("categories");
    expect(result).toHaveProperty("defaultThresholds");
    expect(Array.isArray(result.categories)).toBe(true);
    expect(result.categories.length).toBe(12);

    // Verify each category has required fields
    for (const cat of result.categories) {
      expect(cat).toHaveProperty("id");
      expect(cat).toHaveProperty("key");
      expect(cat).toHaveProperty("label");
      expect(cat).toHaveProperty("shortLabel");
    }

    // Verify thresholds have required fields
    expect(result.defaultThresholds).toHaveProperty("highImpressions");
    expect(result.defaultThresholds).toHaveProperty("lowImpressions");
    expect(result.defaultThresholds).toHaveProperty("highCTR");
    expect(result.defaultThresholds).toHaveProperty("lowCTR");
    expect(result.defaultThresholds).toHaveProperty("highCVR");
    expect(result.defaultThresholds).toHaveProperty("lowCVR");
  });

  // Test 2: getAdCampaignsLocal returns correct structure (empty data)
  it("getAdCampaignsLocal returns campaigns and portfolios arrays", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getAdCampaignsLocal({});

    expect(result).toHaveProperty("campaigns");
    expect(result).toHaveProperty("portfolios");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.campaigns)).toBe(true);
    expect(Array.isArray(result.portfolios)).toBe(true);
  });

  // Test 3: getSearchTerms12CategoryLocal returns correct structure
  it("getSearchTerms12CategoryLocal returns searchTerms and categories", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getSearchTerms12CategoryLocal({});

    expect(result).toHaveProperty("searchTerms");
    expect(result).toHaveProperty("categories");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.searchTerms)).toBe(true);
    expect(Array.isArray(result.categories)).toBe(true);
    expect(result.categories.length).toBe(12);
  });

  // Test 4: getAdPlacementDataLocal returns correct structure
  it("getAdPlacementDataLocal returns placements array", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getAdPlacementDataLocal({});

    expect(result).toHaveProperty("placements");
    expect(result).toHaveProperty("isLocalData", true);
    expect(result).toHaveProperty("isMock", false);
    expect(Array.isArray(result.placements)).toBe(true);
  });

  // Test 5: getAdPlacementByKeywordLocal returns keywords and placementNames
  it("getAdPlacementByKeywordLocal returns keywords and placementNames", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getAdPlacementByKeywordLocal({});

    expect(result).toHaveProperty("keywords");
    expect(result).toHaveProperty("placementNames");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.keywords)).toBe(true);
    expect(Array.isArray(result.placementNames)).toBe(true);
  });

  // Test 6: getOrderHourlyHeatmapLocal returns heatmapData in correct format
  it("getOrderHourlyHeatmapLocal returns heatmapData with 7 days × 24 hours", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getOrderHourlyHeatmapLocal({});

    expect(result).toHaveProperty("heatmapData");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.heatmapData)).toBe(true);
    expect(result.heatmapData.length).toBe(7); // 7 days

    for (const day of result.heatmapData) {
      expect(day).toHaveProperty("day");
      expect(day).toHaveProperty("hours");
      expect(Array.isArray(day.hours)).toBe(true);
      expect(day.hours.length).toBe(24); // 24 hours
      for (const h of day.hours) {
        expect(h).toHaveProperty("hour");
        expect(h).toHaveProperty("orders");
        expect(h).toHaveProperty("sales");
        expect(h).toHaveProperty("volume");
      }
    }
  });

  // Test 7: getTargetingAnalysisLocal returns correct structure
  it("getTargetingAnalysisLocal returns targets and categoryStats", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getTargetingAnalysisLocal({});

    expect(result).toHaveProperty("targets");
    expect(result).toHaveProperty("categoryStats");
    expect(result).toHaveProperty("total");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.targets)).toBe(true);
  });

  // Test 8: getWordFrequencyLocal returns attributes and categoryStats
  it("getWordFrequencyLocal returns attributes, categoryStats, totalWords", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getWordFrequencyLocal({});

    expect(result).toHaveProperty("attributes");
    expect(result).toHaveProperty("categoryStats");
    expect(result).toHaveProperty("totalWords");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.attributes)).toBe(true);
  });

  // Test 9: getEffectiveSearchTermsLocal returns effectiveTerms and organicOnlyTerms
  it("getEffectiveSearchTermsLocal returns effectiveTerms and organicOnlyTerms", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getEffectiveSearchTermsLocal({});

    expect(result).toHaveProperty("effectiveTerms");
    expect(result).toHaveProperty("organicOnlyTerms");
    expect(result).toHaveProperty("totalAdTerms");
    expect(result).toHaveProperty("totalTargetedKeywords");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.effectiveTerms)).toBe(true);
    expect(Array.isArray(result.organicOnlyTerms)).toBe(true);
  });

  // Test 10: getAsinAdSummaryLocal returns asins with sku field and totals
  it("getAsinAdSummaryLocal returns asins with sku and totals", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getAsinAdSummaryLocal({});

    expect(result).toHaveProperty("asins");
    expect(result).toHaveProperty("totals");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.asins)).toBe(true);
    expect(result.totals).toHaveProperty("impressions");
    expect(result.totals).toHaveProperty("clicks");
    expect(result.totals).toHaveProperty("cost");
    expect(result.totals).toHaveProperty("sales");
    expect(result.totals).toHaveProperty("orders");
    expect(result.totals).toHaveProperty("acos");
    expect(result.totals).toHaveProperty("roas");
  });

  // Test 11: getSearchTermTrendLocal returns empty when no periods
  it("getSearchTermTrendLocal returns empty arrays when no periods provided", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getSearchTermTrendLocal({});

    expect(result).toHaveProperty("trendData");
    expect(result).toHaveProperty("periodTotals");
    expect(result).toHaveProperty("isLocalData", true);
    expect(result.trendData).toEqual([]);
    expect(result.periodTotals).toEqual([]);
  });

  // Test 12: getSearchTermTrendLocal with periods returns correct structure
  it("getSearchTermTrendLocal with periods returns trendData and periodTotals", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getSearchTermTrendLocal({
      periods: [
        { label: "Week 1", startDate: "2025-01-01", endDate: "2025-01-07" },
        { label: "Week 2", startDate: "2025-01-08", endDate: "2025-01-14" },
      ],
      topN: 10,
    });

    expect(result).toHaveProperty("trendData");
    expect(result).toHaveProperty("periodTotals");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.trendData)).toBe(true);
    expect(Array.isArray(result.periodTotals)).toBe(true);
    expect(result.trendData.length).toBe(2);
    expect(result.periodTotals.length).toBe(2);

    for (const pt of result.periodTotals) {
      expect(pt).toHaveProperty("label");
      expect(pt).toHaveProperty("impressions");
      expect(pt).toHaveProperty("clicks");
      expect(pt).toHaveProperty("cost");
      expect(pt).toHaveProperty("sales");
      expect(pt).toHaveProperty("orders");
      expect(pt).toHaveProperty("acos");
    }

    for (const td of result.trendData) {
      expect(td).toHaveProperty("label");
      expect(td).toHaveProperty("terms");
      expect(Array.isArray(td.terms)).toBe(true);
    }
  });

  // Test 13: getAdHourlyDataLocal returns correct structure
  it("getAdHourlyDataLocal returns hourlyData array", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getAdHourlyDataLocal({});

    expect(result).toHaveProperty("hourlyData");
    expect(result).toHaveProperty("isLocalData", true);
    expect(Array.isArray(result.hourlyData)).toBe(true);
  });

  // Test 14: getAdDiagnosisLocal returns diagnosis structure (LLM-dependent)
  it("getAdDiagnosisLocal returns a result object", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getAdDiagnosisLocal({});

    // LLM may return varying structures, just verify it returns an object with expected keys
    expect(result).toBeDefined();
    expect(typeof result).toBe("object");
    expect(result).toHaveProperty("overall_score");
    expect(result).toHaveProperty("dimensions");
  }, 30000);

  // Test 15: aiBudgetAllocationLocal returns allocation structure (LLM-dependent)
  it("aiBudgetAllocationLocal returns campaignData and totals", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.aiBudgetAllocationLocal({});

    expect(result).toBeDefined();
    expect(result).toHaveProperty("campaignData");
    expect(result).toHaveProperty("totals");
    expect(Array.isArray(result.campaignData)).toBe(true);
  }, 30000);

  // Test 16: evaluateBudgetEffectLocal requires trackingId
  it("evaluateBudgetEffectLocal requires trackingId", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    // Should throw because trackingId 999999 doesn't exist
    await expect(
      caller.adLocalAnalysis.evaluateBudgetEffectLocal({ trackingId: 999999 })
    ).rejects.toThrow();
  });

  // Test 17: getCrossChannelDataLocal returns channel breakdown
  it("getCrossChannelDataLocal returns channels and total", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getCrossChannelDataLocal({});

    expect(result).toHaveProperty("channels");
    expect(result).toHaveProperty("total");
    expect(Array.isArray(result.channels)).toBe(true);
    expect(result.total).toHaveProperty("cost");
    expect(result.total).toHaveProperty("sales");
  });

  // Test 18: getDspReportLocal returns empty data with message
  it("getDspReportLocal returns empty data with hasData=false and message", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getDspReportLocal({});

    expect(result).toHaveProperty("kpi");
    expect(result).toHaveProperty("orders");
    expect(result).toHaveProperty("message");
    expect(result).toHaveProperty("hasData", false);
    expect(result).toHaveProperty("_meta");
    expect(result._meta).toHaveProperty("isLocalData", true);
    expect(result.message).toContain("DSP");
    expect(Array.isArray(result.orders)).toBe(true);
    expect(result.orders.length).toBe(0);
    // Verify KPI fields are all zero
    expect(result.kpi.totalBudget).toBe(0);
    expect(result.kpi.totalSpends).toBe(0);
    expect(result.kpi.totalSales).toBe(0);
    expect(result.kpi.roas).toBe(0);
    expect(result.kpi.acos).toBe(0);
  });

  // Test 19: getDspReportLocal with date filters returns correct structure
  it("getDspReportLocal with date filters returns correct structure", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.getDspReportLocal({
      weekStartDate: "2025-01-01",
      weekEndDate: "2025-01-31",
    });

    // Even with date filters, should return correct structure (likely empty for test user)
    expect(result).toHaveProperty("kpi");
    expect(result).toHaveProperty("orders");
    expect(result).toHaveProperty("hasData");
    expect(result).toHaveProperty("_meta");
    expect(Array.isArray(result.orders)).toBe(true);
  });

  // Test 20: aiDspStrategyLocal returns error message when no data
  it("aiDspStrategyLocal returns error about no DSP data", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.aiDspStrategyLocal({});

    expect(result).toHaveProperty("error");
    expect(result).toHaveProperty("strategy", null);
    expect(result.error).toContain("DSP");
  });

  // Test 21: adChatBotLocal returns answer structure
  it("adChatBotLocal returns answer with structured response", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.adChatBotLocal({
      question: "我的广告ACoS偏高，应该怎么优化？",
    });

    expect(result).toHaveProperty("answer");
    expect(typeof result.answer).toBe("string");
    expect(result.answer.length).toBeGreaterThan(0);
  }, 30000);

  // Test 22: aiChannelStrategyLocal returns strategy (LLM-dependent)
  it("aiChannelStrategyLocal returns a result", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const result = await caller.adLocalAnalysis.aiChannelStrategyLocal({});

    // May return string or object depending on LLM response
    expect(result).toBeDefined();
    expect(result).toBeTruthy();
  }, 30000);

  // Test 23: parseDspReport parses CSV correctly
  it("parseDspReport parses CSV text into structured rows", async () => {
    const { parseDspReport } = await import("./routers/adReportParsers");
    const csv = `订单名称,预算,状态,花费,销售额,订单,曝光,可见曝光,点击,DPV,加购,ROAS,ACoS,CTR,广告项类型,创意类型,店铺名称
DSP Campaign A,5000,Active,1200,3600,45,50000,40000,800,300,120,3.0,33.3%,1.6%,Display,Static,MyStore
DSP Campaign B,3000,Paused,800,1600,20,30000,25000,500,150,60,2.0,50%,1.67%,Video,Dynamic,MyStore`;
    const rows = await parseDspReport(csv);

    expect(rows.length).toBe(2);
    expect(rows[0].orderName).toBe("DSP Campaign A");
    expect(rows[0].orderBudget).toBe(5000);
    expect(rows[0].orderStatus).toBe("Active");
    expect(rows[0].spends).toBe(1200);
    expect(rows[0].sales).toBe(3600);
    expect(rows[0].orders).toBe(45);
    expect(rows[0].impressions).toBe(50000);
    expect(rows[0].viewableImpressions).toBe(40000);
    expect(rows[0].clicks).toBe(800);
    expect(rows[0].dpv).toBe(300);
    expect(rows[0].totalAddToCart).toBe(120);
    expect(rows[0].lineItemType).toBe("Display");
    expect(rows[0].creativeType).toBe("Static");
    expect(rows[0].storeName).toBe("MyStore");
    // Derived metrics: roas = 3600/1200 = 3.0
    expect(rows[0].roas).toBe(3);
    // acos = 1200/3600 = 0.333...
    expect(rows[0].acos).toBeCloseTo(0.333, 2);

    expect(rows[1].orderName).toBe("DSP Campaign B");
    expect(rows[1].orderStatus).toBe("Paused");
  });

  // Test 24: parseDspReport handles empty CSV
  it("parseDspReport returns empty array for empty CSV", async () => {
    const { parseDspReport } = await import("./routers/adReportParsers");
    const csv = `订单名称,预算,状态,花费`;
    const rows = await parseDspReport(csv);
    expect(rows.length).toBe(0);
  });

  // Test 25: parseDspReport handles English column headers
  it("parseDspReport handles English column headers", async () => {
    const { parseDspReport } = await import("./routers/adReportParsers");
    const csv = `Order Name,Budget,Status,Spends,Sales,Orders,Impressions,Viewable Impressions,Clicks,DPV,Add to Cart,ROAS,ACoS,CTR,Line Item Type,Creative Type,Store Name
Test Order,10000,Active,2500,7500,100,100000,80000,2000,500,200,3.0,33.3%,2.0%,Display,Video,TestStore`;
    const rows = await parseDspReport(csv);

    expect(rows.length).toBe(1);
    expect(rows[0].orderName).toBe("Test Order");
    expect(rows[0].orderBudget).toBe(10000);
    expect(rows[0].spends).toBe(2500);
    expect(rows[0].sales).toBe(7500);
    expect(rows[0].storeName).toBe("TestStore");
  });

  // Test 26: uploadDspReport validates empty file
  it("uploadDspReport throws on empty file", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const emptyBase64 = Buffer.from("订单名称,预算,状态,花费\n").toString("base64");
    await expect(
      caller.adReportUpload.uploadDspReport({
        fileBase64: emptyBase64,
        fileName: "empty.csv",
      })
    ).rejects.toThrow("没有有效DSP数据行");
  });

  // Test 27: uploadDspReport succeeds with valid CSV data
  it("uploadDspReport processes valid CSV and returns uploadId", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const csvContent = `订单名称,预算,状态,花费,销售额,订单,曝光,可见曝光,点击,DPV,加购,ROAS,ACoS,CTR,广告项类型,创意类型,店铺名称
Test DSP Order,5000,Active,1000,3000,30,50000,40000,800,200,100,3.0,33.3%,1.6%,Display,Static,TestStore`;
    const base64 = Buffer.from(csvContent).toString("base64");
    const result = await caller.adReportUpload.uploadDspReport({
      fileBase64: base64,
      fileName: "test_dsp.csv",
      weekStartDate: "2025-03-01",
      weekEndDate: "2025-03-07",
    });

    expect(result).toHaveProperty("uploadId");
    expect(result).toHaveProperty("totalRows", 1);
    expect(result).toHaveProperty("importedRows", 1);
    expect(typeof result.uploadId).toBe("number");
  });
});
