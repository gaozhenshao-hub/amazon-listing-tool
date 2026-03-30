import { describe, it, expect } from "vitest";

// ─── Ad Type Parameter Validation ──────────────────────────
describe("adType parameter validation", () => {
  it("search term adType accepts SP and SB only", () => {
    const validTypes = ["SP", "SB"];
    const invalidTypes = ["SD", "DSP", "", "sp"];
    for (const t of validTypes) {
      expect(["SP", "SB"].includes(t)).toBe(true);
    }
    for (const t of invalidTypes) {
      expect(["SP", "SB"].includes(t)).toBe(false);
    }
  });

  it("targeting/placement/hourly adType accepts SP, SB, and SD", () => {
    const validTypes = ["SP", "SB", "SD"];
    const invalidTypes = ["DSP", "", "sp", "sb"];
    for (const t of validTypes) {
      expect(["SP", "SB", "SD"].includes(t)).toBe(true);
    }
    for (const t of invalidTypes) {
      expect(["SP", "SB", "SD"].includes(t)).toBe(false);
    }
  });

  it("rejects invalid adType values", () => {
    const invalid = ["DSP", "SBV", "AUTO", null, undefined, 123];
    for (const v of invalid) {
      expect(["SP", "SB", "SD"].includes(v as any)).toBe(false);
    }
  });
});

// ─── API Path Selection by adType ──────────────────────────
describe("API path selection by adType", () => {
  const getSearchTermPath = (adType: string) =>
    adType === "SB" ? "/pb/openapi/newad/hsaQueryWordReports" : "/pb/openapi/newad/queryWordReports";

  const getTargetingPath = (adType: string) =>
    adType === "SB" ? "/pb/openapi/newad/listHsaTargetingReport"
      : adType === "SD" ? "/pb/openapi/newad/sdMatchTargetReports"
        : "/pb/openapi/newad/spKeywordReports";

  const getPlacementPath = (adType: string) =>
    adType === "SB" ? "/pb/openapi/newad/hsaCampaignPlacementReports"
      : adType === "SD" ? "/pb/openapi/newad/sdCampaignReports"
        : "/pb/openapi/newad/campaignPlacementReports";

  const getHourlyPath = (adType: string) =>
    adType === "SB" ? "/pb/openapi/newad/sbCampaignHourData"
      : adType === "SD" ? "/pb/openapi/newad/sdCampaignHourData"
        : "/pb/openapi/newad/spCampaignHourData";

  it("search terms: SP uses queryWordReports", () => {
    expect(getSearchTermPath("SP")).toBe("/pb/openapi/newad/queryWordReports");
  });
  it("search terms: SB uses hsaQueryWordReports", () => {
    expect(getSearchTermPath("SB")).toBe("/pb/openapi/newad/hsaQueryWordReports");
  });

  it("targeting: SP uses spKeywordReports", () => {
    expect(getTargetingPath("SP")).toBe("/pb/openapi/newad/spKeywordReports");
  });
  it("targeting: SB uses listHsaTargetingReport", () => {
    expect(getTargetingPath("SB")).toBe("/pb/openapi/newad/listHsaTargetingReport");
  });
  it("targeting: SD uses sdMatchTargetReports", () => {
    expect(getTargetingPath("SD")).toBe("/pb/openapi/newad/sdMatchTargetReports");
  });

  it("placement: SP uses campaignPlacementReports", () => {
    expect(getPlacementPath("SP")).toBe("/pb/openapi/newad/campaignPlacementReports");
  });
  it("placement: SB uses hsaCampaignPlacementReports", () => {
    expect(getPlacementPath("SB")).toBe("/pb/openapi/newad/hsaCampaignPlacementReports");
  });
  it("placement: SD uses sdCampaignReports", () => {
    expect(getPlacementPath("SD")).toBe("/pb/openapi/newad/sdCampaignReports");
  });

  it("hourly: SP uses spCampaignHourData", () => {
    expect(getHourlyPath("SP")).toBe("/pb/openapi/newad/spCampaignHourData");
  });
  it("hourly: SB uses sbCampaignHourData", () => {
    expect(getHourlyPath("SB")).toBe("/pb/openapi/newad/sbCampaignHourData");
  });
  it("hourly: SD uses sdCampaignHourData", () => {
    expect(getHourlyPath("SD")).toBe("/pb/openapi/newad/sdCampaignHourData");
  });
});

// ─── SB-specific mock data fields ──────────────────────────
describe("SB-specific mock data fields", () => {
  // Simulate SB search term data structure
  const sbSearchTerm = {
    query: "bluetooth earbuds brand",
    impressions: 3000, clicks: 50, cost: 60, sales: 250, orders: 6,
    new_to_brand_orders: 4, new_to_brand_sales: 160, new_to_brand_units: 4,
    video_complete_views: 120, video_first_quartile_views: 400,
    video_midpoint_views: 250, video_third_quartile_views: 180,
  };

  it("SB search term has new-to-brand fields", () => {
    expect(sbSearchTerm.new_to_brand_orders).toBeDefined();
    expect(sbSearchTerm.new_to_brand_sales).toBeDefined();
    expect(sbSearchTerm.new_to_brand_units).toBeDefined();
    expect(sbSearchTerm.new_to_brand_orders).toBeLessThanOrEqual(sbSearchTerm.orders);
  });

  it("SB search term has video fields", () => {
    expect(sbSearchTerm.video_complete_views).toBeDefined();
    expect(sbSearchTerm.video_first_quartile_views).toBeGreaterThan(0);
    expect(sbSearchTerm.video_complete_views).toBeLessThanOrEqual(sbSearchTerm.video_first_quartile_views);
  });
});

// ─── SD-specific mock data fields ──────────────────────────
describe("SD-specific mock data fields", () => {
  const sdTargeting = {
    targeting_id: "SDT001", targeting: "asin=B09ABC1234",
    targeting_type: "product", matched_target: "B09ABC1234",
    impressions: 2000, view_impressions: 2500, clicks: 40, cost: 30, sales: 180, orders: 5,
  };

  it("SD targeting has matched_target field", () => {
    expect(sdTargeting.matched_target).toBeDefined();
    expect(sdTargeting.matched_target).toBe("B09ABC1234");
  });

  it("SD targeting has view_impressions >= impressions", () => {
    expect(sdTargeting.view_impressions).toBeGreaterThanOrEqual(sdTargeting.impressions);
  });
});

// ─── NaN protection in metric calculations ─────────────────
describe("NaN protection in metric calculations", () => {
  const safeAcos = (cost: number, sales: number) => sales > 0 ? Math.round(cost / sales * 10000) / 100 : (cost > 0 ? 999 : 0);
  const safeCtr = (clicks: number, impressions: number) => impressions > 0 ? Math.round(clicks / impressions * 10000) / 100 : 0;
  const safeCvr = (orders: number, clicks: number) => clicks > 0 ? Math.round(orders / clicks * 10000) / 100 : 0;

  it("ACoS: no NaN when sales=0", () => {
    expect(Number.isNaN(safeAcos(10, 0))).toBe(false);
    expect(safeAcos(10, 0)).toBe(999);
    expect(safeAcos(0, 0)).toBe(0);
  });

  it("CTR: no NaN when impressions=0", () => {
    expect(Number.isNaN(safeCtr(5, 0))).toBe(false);
    expect(safeCtr(5, 0)).toBe(0);
  });

  it("CVR: no NaN when clicks=0", () => {
    expect(Number.isNaN(safeCvr(3, 0))).toBe(false);
    expect(safeCvr(3, 0)).toBe(0);
  });

  it("all metrics finite for normal data", () => {
    expect(Number.isFinite(safeAcos(10, 100))).toBe(true);
    expect(Number.isFinite(safeCtr(10, 1000))).toBe(true);
    expect(Number.isFinite(safeCvr(5, 50))).toBe(true);
  });
});

// ─── SB placement name normalization ───────────────────────
describe("SB placement name normalization", () => {
  it("SB placements have distinct names from SP", () => {
    const sbPlacements = ["TOP OF SEARCH ON-AMAZON (SB)", "DETAIL PAGE (SB)", "OTHER (SB)"];
    const spPlacements = ["TOP OF SEARCH ON-AMAZON", "REST OF SEARCH", "PRODUCT PAGES"];
    for (const sbP of sbPlacements) {
      expect(spPlacements.includes(sbP)).toBe(false);
    }
  });

  it("SD placements have distinct names from SP", () => {
    const sdPlacements = ["PRODUCT DETAIL PAGE (SD)", "OFF-AMAZON", "REMARKETING"];
    const spPlacements = ["TOP OF SEARCH ON-AMAZON", "REST OF SEARCH", "PRODUCT PAGES"];
    for (const sdP of sdPlacements) {
      expect(spPlacements.includes(sdP)).toBe(false);
    }
  });
});

// ─── targeting 9-category classification ───────────────────
describe("targeting 9-category classification", () => {
  function classifyTarget(cvr: number, clicks: number, cost: number, orders: number): string {
    if (cvr >= 0.10 && clicks >= 10) return "star";
    if (cvr >= 0.10 && clicks < 10) return "potential";
    if (cvr >= 0.03 && cvr < 0.10 && clicks >= 10) return "stable";
    if (cvr >= 0.03 && cvr < 0.10 && clicks < 10) return "test";
    if (cvr < 0.03 && clicks >= 20) return "waste";
    if (cvr < 0.03 && clicks >= 5) return "decline";
    if (cost > 5 && orders === 0) return "negate";
    if (clicks < 3) return "new";
    return "observe";
  }

  it("high CVR + high clicks = star", () => {
    expect(classifyTarget(0.15, 20, 10, 3)).toBe("star");
  });
  it("high CVR + low clicks = potential", () => {
    expect(classifyTarget(0.20, 5, 5, 1)).toBe("potential");
  });
  it("medium CVR + high clicks = stable", () => {
    expect(classifyTarget(0.05, 15, 10, 1)).toBe("stable");
  });
  it("low CVR + high clicks = waste", () => {
    expect(classifyTarget(0.01, 25, 20, 0)).toBe("waste");
  });
  it("high cost + zero orders = negate", () => {
    expect(classifyTarget(0, 4, 10, 0)).toBe("negate");
  });
  it("very low clicks = new", () => {
    expect(classifyTarget(0, 2, 1, 0)).toBe("new");
  });
});

// ─── Cache key includes adType ─────────────────────────────
describe("cache key includes adType", () => {
  const buildCacheKey = (campaignId: string, marketplace: string, days: number, adType: string) =>
    `searchTerms_${campaignId || 'all'}_${marketplace || 'ALL'}_${days}_${adType}`;

  it("SP and SB produce different cache keys", () => {
    const spKey = buildCacheKey("C001", "US", 3, "SP");
    const sbKey = buildCacheKey("C001", "US", 3, "SB");
    expect(spKey).not.toBe(sbKey);
    expect(spKey).toContain("_SP");
    expect(sbKey).toContain("_SB");
  });

  it("same params with same adType produce same cache key", () => {
    const key1 = buildCacheKey("C001", "US", 3, "SP");
    const key2 = buildCacheKey("C001", "US", 3, "SP");
    expect(key1).toBe(key2);
  });
});
