import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-offsite-user",
    email: "offsite@test.com",
    name: "Offsite Test User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };

  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as TrpcContext["res"],
  };
}

describe("offsite marketing module", () => {
  const ctx = createAuthContext();
  const caller = appRouter.createCaller(ctx);

  describe("offInfluencer router", () => {
    it("search returns an array", async () => {
      const result = await caller.offInfluencer.search({});
      expect(Array.isArray(result)).toBe(true);
    });

    it("search with filters returns array", async () => {
      const result = await caller.offInfluencer.search({ platform: "tiktok", limit: 10 });
      expect(Array.isArray(result)).toBe(true);
    });

    it("create and get influencer", async () => {
      const { id } = await caller.offInfluencer.create({
        platform: "tiktok",
        handle: "@test_influencer",
        displayName: "Test Influencer",
        category: "beauty",
        country: "US",
        followerCount: 50000,
      });
      expect(id).toBeGreaterThan(0);

      const inf = await caller.offInfluencer.get({ id });
      expect(inf.handle).toBe("@test_influencer");
      expect(inf.displayName).toBe("Test Influencer");
      expect(inf.scores).toBeDefined();
    });
  });

  describe("offCampaign router", () => {
    it("list returns an array", async () => {
      const result = await caller.offCampaign.list({});
      expect(Array.isArray(result)).toBe(true);
    });

    it("create and get campaign", async () => {
      const { id } = await caller.offCampaign.create({
        name: "Test Campaign",
        type: "influencer",
        budget: "5000",
        targetMarketplace: "US",
        targetAsin: "B0TEST123",
      });
      expect(id).toBeGreaterThan(0);

      const campaign = await caller.offCampaign.get({ id });
      expect(campaign.name).toBe("Test Campaign");
      expect(campaign.budget).toBe("5000.00");
    });

    it("update campaign status", async () => {
      const { id } = await caller.offCampaign.create({
        name: "Status Test",
        type: "social_media",
        budget: "1000",
      });
      const result = await caller.offCampaign.update({ id, data: { status: "active" } });
      expect(result.success).toBe(true);
    });
  });

  describe("offOutreach router", () => {
    it("list returns an array", async () => {
      const result = await caller.offOutreach.list({});
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("offContent router", () => {
    it("list returns an array", async () => {
      const result = await caller.offContent.list({});
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("offSocial router", () => {
    it("listAccounts returns an array", async () => {
      const result = await caller.offSocial.listAccounts();
      expect(Array.isArray(result)).toBe(true);
    });

    it("listMatrixGroups returns an array", async () => {
      const result = await caller.offSocial.listMatrixGroups();
      expect(Array.isArray(result)).toBe(true);
    });

    it("listCalendar returns an array", async () => {
      const result = await caller.offSocial.listCalendar({ startDate: "2026-01-01", endDate: "2026-12-31" });
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe("offAnalytics router", () => {
    it("getDashboardStats returns stats object", async () => {
      const stats = await caller.offAnalytics.getDashboardStats();
      expect(stats).toHaveProperty("influencers");
      expect(stats).toHaveProperty("campaigns");
      expect(stats).toHaveProperty("collaborations");
      expect(stats).toHaveProperty("outreach");
      expect(stats).toHaveProperty("social");
      expect(stats).toHaveProperty("calendar");
      expect(stats).toHaveProperty("attribution");
      expect(stats).toHaveProperty("matrix");
    });

    it("listLinks returns an array", async () => {
      const result = await caller.offAnalytics.listLinks({});
      expect(Array.isArray(result)).toBe(true);
    });

    it("createLink creates a tracking link", async () => {
      const { id } = await caller.offAnalytics.createLink({
        originalUrl: "https://amazon.com/dp/B0TEST123",
        utmSource: "tiktok",
        utmMedium: "influencer",
        utmCampaign: "test_campaign",
      });
      expect(id).toBeGreaterThan(0);
    });
  });
});
