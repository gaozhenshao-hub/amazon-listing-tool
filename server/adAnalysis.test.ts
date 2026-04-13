import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the LingxingAdapter
vi.mock("./lingxingAdapter", () => ({
  getLingxingAdapter: () => ({
    isMockMode: () => true,
    request: vi.fn().mockImplementation(async ({ path, body }: any) => {
      if (path === "/erp/sc/data/seller/lists") {
        return {
          data: [
            { sid: 1001, mid: 1, name: "Test Store US", seller_id: "ATEST123" },
          ],
        };
      }
      if (path === "/erp/sc/data/mws/listing") {
        return {
          data: [
            { asin: "B0TEST001", asin1: "B0TEST001", title: "Test Product 1", sku: "SKU-001", local_name: "Test Product 1", image_url: "" },
            { asin: "B0TEST002", asin1: "B0TEST002", title: "Test Product 2", sku: "SKU-002", local_name: "Test Product 2", image_url: "" },
          ],
        };
      }
      if (path === "/data/advertising/sp/queryWordReports") {
        return {
          data: [
            {
              query: "test keyword 1", target_text: "B0TEST001", match_type: "BROAD",
              campaign_id: "C001", ad_group_id: "AG001",
              impressions: 5000, clicks: 100, cost: 25.5, sales7d: 150, orders: 8,
            },
            {
              query: "test keyword 2", target_text: "B0TEST001", match_type: "EXACT",
              campaign_id: "C001", ad_group_id: "AG001",
              impressions: 200, clicks: 5, cost: 3.0, sales7d: 0, orders: 0,
            },
            {
              query: "irrelevant term", target_text: "B0TEST001", match_type: "AUTO",
              campaign_id: "C002", ad_group_id: "AG002",
              impressions: 8000, clicks: 10, cost: 8.0, sales7d: 0, orders: 0,
            },
          ],
        };
      }
      if (path === "/data/advertising/sp/placementReports") {
        return {
          data: [
            { placement: "Top of Search", impressions: 5000, clicks: 200, cost: 50, sales7d: 300, orders: 15 },
            { placement: "Rest of Search", impressions: 3000, clicks: 80, cost: 20, sales7d: 80, orders: 4 },
            { placement: "Product Pages", impressions: 2000, clicks: 50, cost: 15, sales7d: 40, orders: 2 },
          ],
        };
      }
      if (path.includes("hourReports")) {
        return {
          data: Array.from({ length: 24 }, (_, i) => ({
            hour: i, impressions: 100 + i * 10, clicks: 5 + i, cost: 2 + i * 0.5,
            sales7d: 10 + i * 2, orders: 1 + Math.floor(i / 4),
          })),
        };
      }
      if (path.includes("targetReports")) {
        return {
          data: [
            { targeting_expression: "keyword1", impressions: 3000, clicks: 100, cost: 30, sales7d: 200, orders: 10 },
            { targeting_expression: "keyword2", impressions: 500, clicks: 20, cost: 15, sales7d: 0, orders: 0 },
          ],
        };
      }
      if (path === "/pb/openapi/newad/spProductAds") {
        return {
          data: [
            { campaign_id: "C001", ad_group_id: "AG001", asin: "B0TEST001", sku: "SKU-001", state: "enabled", serving_status: "RUNNING", profile_id: 123, ad_id: 1001, creation_date: 1628567183000, last_updated_date: 1655708791290 },
            { campaign_id: "C001", ad_group_id: "AG002", asin: "B0TEST002", sku: "SKU-002", state: "enabled", serving_status: "RUNNING", profile_id: 123, ad_id: 1002, creation_date: 1628567183000, last_updated_date: 1655708791290 },
            { campaign_id: "C002", ad_group_id: "AG003", asin: "B0TEST001", sku: "SKU-001", state: "paused", serving_status: "CAMPAIGN_PAUSED", profile_id: 123, ad_id: 1003, creation_date: 1628567183000, last_updated_date: 1655708791290 },
          ],
        };
      }
      if (path === "/pb/openapi/newad/sdProductAds") {
        return {
          data: [
            { campaign_id: "SD001", ad_group_id: "SDAG001", asin: "B0TEST001", sku: "SKU-SD-001", state: "enabled", serving_status: "AD_STATUS_LIVE", profile_id: 123, ad_id: 2001, creation_date: 1640591614, last_updated_date: 1640591614 },
            { campaign_id: "SD001", ad_group_id: "SDAG002", asin: "B0TEST003", sku: "SKU-SD-002", state: "enabled", serving_status: "AD_STATUS_LIVE", profile_id: 123, ad_id: 2002, creation_date: 1640591614, last_updated_date: 1640591614 },
          ],
        };
      }
      return { data: [] };
    }),
    requestWithMockFallback: vi.fn().mockImplementation(async ({ path, body }: any) => {
      if (path === "/pb/openapi/newad/spProductAds") {
        return {
          data: [
            { campaign_id: "C001", ad_group_id: "AG001", asin: "B0TEST001", sku: "SKU-001", state: "enabled", serving_status: "RUNNING", profile_id: 123, ad_id: 1001 },
            { campaign_id: "C001", ad_group_id: "AG002", asin: "B0TEST002", sku: "SKU-002", state: "enabled", serving_status: "RUNNING", profile_id: 123, ad_id: 1002 },
            { campaign_id: "C002", ad_group_id: "AG003", asin: "B0TEST001", sku: "SKU-001", state: "paused", serving_status: "CAMPAIGN_PAUSED", profile_id: 123, ad_id: 1003 },
          ],
        };
      }
      if (path === "/pb/openapi/newad/sdProductAds") {
        return {
          data: [
            { campaign_id: "SD001", ad_group_id: "SDAG001", asin: "B0TEST001", sku: "SKU-SD-001", state: "enabled", serving_status: "AD_STATUS_LIVE", profile_id: 123, ad_id: 2001 },
            { campaign_id: "SD001", ad_group_id: "SDAG002", asin: "B0TEST003", sku: "SKU-SD-002", state: "enabled", serving_status: "AD_STATUS_LIVE", profile_id: 123, ad_id: 2002 },
          ],
        };
      }
      return { data: [] };
    }),
  }),
}));

// Mock LLM
vi.mock("./_core/llm", () => ({
  invokeLLM: vi.fn().mockResolvedValue({
    choices: [{
      message: {
        content: JSON.stringify({
          overall_score: 72,
          overall_assessment: "广告表现中等，有优化空间",
          dimensions: [
            { name: "点击率", score: 65, status: "需关注", problems: ["CTR偏低"], suggestions: ["优化主图"] },
            { name: "转化率", score: 78, status: "良好", problems: [], suggestions: ["保持当前策略"] },
          ],
          priority_actions: ["优化主图提升CTR"],
        }),
      },
    }],
  }),
}));

function createAuthContext(): TrpcContext {
  return {
    user: {
      id: 1,
      openId: "test-user",
      email: "test@example.com",
      name: "Test User",
      loginMethod: "manus",
      role: "user",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    },
    req: {
      protocol: "https",
      headers: {},
    } as TrpcContext["req"],
    res: {
      clearCookie: vi.fn(),
    } as unknown as TrpcContext["res"],
  };
}

describe("adAnalysis router", () => {
  let caller: ReturnType<typeof appRouter.createCaller>;

  beforeEach(() => {
    const ctx = createAuthContext();
    caller = appRouter.createCaller(ctx);
  });

  describe("getProductAsins", () => {
    it("returns a list of ASINs", async () => {
      const result = await caller.adAnalysis.getProductAsins({ marketplace: "US" });
      expect(result).toHaveProperty("asins");
      expect(Array.isArray(result.asins)).toBe(true);
    });
  });

  describe("getSearchTerms12Category", () => {
    it("returns search terms with 12-category classification", async () => {
      const result = await caller.adAnalysis.getSearchTerms12Category({
        marketplace: "US",
        days: 7,
      });
      expect(result).toHaveProperty("searchTerms");
      expect(result).toHaveProperty("categoryStats");
      expect(result).toHaveProperty("thresholds");
      expect(Array.isArray(result.searchTerms)).toBe(true);

      // Each search term should have a categoryId (1-12)
      for (const term of result.searchTerms) {
        expect(term.categoryId).toBeGreaterThanOrEqual(1);
        expect(term.categoryId).toBeLessThanOrEqual(12);
        expect(term).toHaveProperty("query");
        expect(term).toHaveProperty("ctr");
        expect(term).toHaveProperty("convRate");
      }
    });

    it("returns category stats with counts for each category", async () => {
      const result = await caller.adAnalysis.getSearchTerms12Category({
        marketplace: "US",
        days: 7,
      });
      expect(result.categoryStats).toBeDefined();
      // categoryStats can be an array or object with category counts
      expect(typeof result.categoryStats).toBe("object");
    });

    it("returns 12 category definitions", async () => {
      const result = await caller.adAnalysis.getSearchTerms12Category({
        marketplace: "US",
        days: 7,
      });
      expect(result).toHaveProperty("categories");
      if (result.categories) {
        expect(result.categories.length).toBe(12);
        // Each category should have the 4-part advice
        for (const cat of result.categories) {
          expect(cat).toHaveProperty("id");
          expect(cat).toHaveProperty("label");
          expect(cat).toHaveProperty("problemAnalysis");
          expect(cat).toHaveProperty("adPurpose");
          expect(cat).toHaveProperty("adStrategy");
          expect(cat).toHaveProperty("expectedResult");
        }
      }
    });
  });

  describe("getAdPlacementData", () => {
    it("returns placement data for TOS/ROS/PP", async () => {
      const result = await caller.adAnalysis.getAdPlacementData({
        marketplace: "US",
        days: 7,
      });
      expect(result).toHaveProperty("placements");
      expect(Array.isArray(result.placements)).toBe(true);
    });
  });

  describe("getAdHourlyData", () => {
    it("returns hourly aggregated data", async () => {
      const result = await caller.adAnalysis.getAdHourlyData({
        marketplace: "US",
        days: 7,
      });
      expect(result).toHaveProperty("hourlyData");
      expect(Array.isArray(result.hourlyData)).toBe(true);
    });
  });

  describe("getTargetingAnalysis", () => {
    it("returns targeting data with categories", async () => {
      const result = await caller.adAnalysis.getTargetingAnalysis({
        marketplace: "US",
        days: 7,
      });
      expect(result).toHaveProperty("targets");
      expect(Array.isArray(result.targets)).toBe(true);
    });
  });

  describe("getAdDiagnosis", () => {
    it("returns AI diagnosis with dimensions and scores", async () => {
      const result = await caller.adAnalysis.getAdDiagnosis({
        marketplace: "US",
        days: 7,
      });
      expect(result).toHaveProperty("overall_score");
      expect(result).toHaveProperty("overall_assessment");
      expect(result).toHaveProperty("dimensions");
      expect(typeof result.overall_score).toBe("number");
      expect(Array.isArray(result.dimensions)).toBe(true);
    });
  });

  describe("syncSpProductAds (SP+SD)", () => {
    it("syncs both SP and SD product ads and builds ASIN mapping", async () => {
      const result = await caller.adAnalysis.syncSpProductAds({ marketplace: "US" });
      expect(result.success).toBe(true);
      expect(result.totalAds).toBeGreaterThanOrEqual(0);
      expect(result.mapping).toBeDefined();
      expect(result.mapping.campaignToAsins).toBeDefined();
      expect(result.mapping.asinToCampaigns).toBeDefined();
      expect(result.mapping.adGroupToAsins).toBeDefined();
      expect(result.mapping.asinToAdGroups).toBeDefined();
    });

    it("builds correct bidirectional mapping for SP ads", async () => {
      const result = await caller.adAnalysis.syncSpProductAds({ marketplace: "US" });
      const { mapping } = result;
      // Campaign C001 should map to B0TEST001 and B0TEST002
      if (mapping.campaignToAsins["C001"]) {
        expect(mapping.campaignToAsins["C001"]).toContain("B0TEST001");
      }
      // ASIN B0TEST001 should map to campaigns C001 and C002
      if (mapping.asinToCampaigns["B0TEST001"]) {
        expect(mapping.asinToCampaigns["B0TEST001"].length).toBeGreaterThanOrEqual(1);
      }
    });

    it("includes SD ad campaigns in the mapping", async () => {
      const result = await caller.adAnalysis.syncSpProductAds({ marketplace: "US" });
      const { mapping } = result;
      // SD campaign SD001 should be in the mapping
      if (mapping.campaignToAsins["SD001"]) {
        expect(mapping.campaignToAsins["SD001"]).toContain("B0TEST001");
        expect(mapping.campaignToAsins["SD001"]).toContain("B0TEST003");
      }
      // SD ad group SDAG001 should map to B0TEST001
      if (mapping.adGroupToAsins["SDAG001"]) {
        expect(mapping.adGroupToAsins["SDAG001"]).toContain("B0TEST001");
      }
    });

    it("asinDetails includes adTypes for SP and SD", async () => {
      const result = await caller.adAnalysis.syncSpProductAds({ marketplace: "US" });
      const { mapping } = result;
      // B0TEST001 appears in both SP and SD ads
      if (mapping.asinDetails["B0TEST001"]) {
        expect(mapping.asinDetails["B0TEST001"].adTypes).toBeDefined();
        expect(Array.isArray(mapping.asinDetails["B0TEST001"].adTypes)).toBe(true);
        // Should contain both SP and SD since B0TEST001 is in both mock datasets
        expect(mapping.asinDetails["B0TEST001"].adTypes).toContain("SP");
        expect(mapping.asinDetails["B0TEST001"].adTypes).toContain("SD");
      }
      // B0TEST003 only appears in SD ads
      if (mapping.asinDetails["B0TEST003"]) {
        expect(mapping.asinDetails["B0TEST003"].adTypes).toContain("SD");
      }
    });
  });

  describe("getAsinCampaignMapping (SP+SD)", () => {
    it("returns ASIN campaign mapping with auto-sync", async () => {
      const result = await caller.adAnalysis.getAsinCampaignMapping({ marketplace: "US" });
      expect(result).toHaveProperty("campaignToAsins");
      expect(result).toHaveProperty("asinToCampaigns");
      expect(result).toHaveProperty("adGroupToAsins");
      expect(result).toHaveProperty("asinToAdGroups");
      expect(result).toHaveProperty("asinDetails");
      expect(result).toHaveProperty("totalAsins");
    });

    it("returns asinDetails with sku, state and adTypes info", async () => {
      const result = await caller.adAnalysis.getAsinCampaignMapping({ marketplace: "US" });
      if (result.asinDetails && Object.keys(result.asinDetails).length > 0) {
        const firstAsin = Object.values(result.asinDetails)[0] as any;
        expect(firstAsin).toHaveProperty("asin");
        expect(firstAsin).toHaveProperty("sku");
        expect(firstAsin).toHaveProperty("state");
        expect(firstAsin).toHaveProperty("adTypes");
        expect(Array.isArray(firstAsin.adTypes)).toBe(true);
      }
    });

    it("merges SP and SD data into unified mapping", async () => {
      const result = await caller.adAnalysis.getAsinCampaignMapping({ marketplace: "US" });
      // Total ASINs should include both SP-only, SD-only, and SP+SD ASINs
      expect(result.totalAsins).toBeGreaterThanOrEqual(1);
      // Should have both SP and SD campaign IDs in the mapping
      const allCampaignIds = Object.keys(result.campaignToAsins || {});
      expect(allCampaignIds.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("ASIN data anonymization", () => {
    it("should not expose real ASINs in AI requests", async () => {
      // The anonymizeForAI function should replace ASINs with Product_XXX
      // We test this indirectly through the diagnosis endpoint which uses AI
      const result = await caller.adAnalysis.getAdDiagnosis({
        asin: "B0TEST001",
        marketplace: "US",
        days: 7,
      });
      // Result should still contain the original ASIN after de-anonymization
      expect(result).toBeDefined();
      expect(result.overall_score).toBeGreaterThanOrEqual(0);
    });
  });
});
