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
});
