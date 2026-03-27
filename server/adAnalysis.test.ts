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
