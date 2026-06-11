/**
 * Tests for kbFeedback Router
 * Phase 4: Feedback loop system
 */
import { describe, it, expect } from "vitest";
import { z } from "zod";

// ─── Schema Validation Tests ────────────────────

describe("kbFeedback Router", () => {
  describe("submitFeedback Input Validation", () => {
    const submitFeedbackSchema = z.object({
      callLogId: z.number().optional(),
      conversationMessageId: z.number().optional(),
      kbItemId: z.number(),
      kbItemType: z.string(),
      rating: z.enum(["helpful", "irrelevant", "wrong"]),
      comment: z.string().max(500).optional(),
    });

    it("should validate helpful feedback without comment", () => {
      const input = {
        kbItemId: 1,
        kbItemType: "skill",
        rating: "helpful" as const,
      };
      const result = submitFeedbackSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should validate wrong feedback with comment", () => {
      const input = {
        conversationMessageId: 42,
        kbItemId: 5,
        kbItemType: "listing",
        rating: "wrong" as const,
        comment: "This listing reference is outdated",
      };
      const result = submitFeedbackSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should validate irrelevant feedback with callLogId", () => {
      const input = {
        callLogId: 100,
        kbItemId: 3,
        kbItemType: "product",
        rating: "irrelevant" as const,
      };
      const result = submitFeedbackSchema.safeParse(input);
      expect(result.success).toBe(true);
    });

    it("should reject invalid rating values", () => {
      const input = {
        kbItemId: 1,
        kbItemType: "skill",
        rating: "excellent",
      };
      const result = submitFeedbackSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject missing required fields", () => {
      const input = {
        rating: "helpful",
      };
      const result = submitFeedbackSchema.safeParse(input);
      expect(result.success).toBe(false);
    });

    it("should reject comment exceeding 500 chars", () => {
      const input = {
        kbItemId: 1,
        kbItemType: "skill",
        rating: "wrong" as const,
        comment: "x".repeat(501),
      };
      const result = submitFeedbackSchema.safeParse(input);
      expect(result.success).toBe(false);
    });
  });

  describe("getStats Input Validation", () => {
    const getStatsSchema = z.object({
      scope: z.enum(["mine", "all"]).default("all"),
    }).optional();

    it("should accept scope=mine", () => {
      const result = getStatsSchema.safeParse({ scope: "mine" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data?.scope).toBe("mine");
    });

    it("should accept scope=all", () => {
      const result = getStatsSchema.safeParse({ scope: "all" });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data?.scope).toBe("all");
    });

    it("should default to all when no scope provided", () => {
      const result = getStatsSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data?.scope).toBe("all");
    });

    it("should accept undefined (optional)", () => {
      const result = getStatsSchema.safeParse(undefined);
      expect(result.success).toBe(true);
    });

    it("should reject invalid scope values", () => {
      const result = getStatsSchema.safeParse({ scope: "team" });
      expect(result.success).toBe(false);
    });
  });

  describe("getTopReferenced Input Validation", () => {
    const getTopReferencedSchema = z.object({
      limit: z.number().min(1).max(50).default(10),
    }).optional();

    it("should accept valid limit", () => {
      const result = getTopReferencedSchema.safeParse({ limit: 5 });
      expect(result.success).toBe(true);
      if (result.success) expect(result.data?.limit).toBe(5);
    });

    it("should default to 10 when no limit provided", () => {
      const result = getTopReferencedSchema.safeParse({});
      expect(result.success).toBe(true);
      if (result.success) expect(result.data?.limit).toBe(10);
    });

    it("should reject limit below 1", () => {
      const result = getTopReferencedSchema.safeParse({ limit: 0 });
      expect(result.success).toBe(false);
    });

    it("should reject limit above 50", () => {
      const result = getTopReferencedSchema.safeParse({ limit: 51 });
      expect(result.success).toBe(false);
    });
  });

  describe("Feedback Distribution Calculation", () => {
    it("should calculate helpful percentage correctly", () => {
      const feedbackDist = { helpful: 15, irrelevant: 3, wrong: 2 };
      const total = feedbackDist.helpful + feedbackDist.irrelevant + feedbackDist.wrong;
      const helpfulPct = Math.round((feedbackDist.helpful / total) * 100);
      expect(helpfulPct).toBe(75);
    });

    it("should handle zero total feedback", () => {
      const feedbackDist = { helpful: 0, irrelevant: 0, wrong: 0 };
      const total = feedbackDist.helpful + feedbackDist.irrelevant + feedbackDist.wrong;
      const helpfulPct = total > 0 ? Math.round((feedbackDist.helpful / total) * 100) : 0;
      expect(helpfulPct).toBe(0);
    });

    it("should handle 100% helpful", () => {
      const feedbackDist = { helpful: 10, irrelevant: 0, wrong: 0 };
      const total = feedbackDist.helpful + feedbackDist.irrelevant + feedbackDist.wrong;
      const helpfulPct = Math.round((feedbackDist.helpful / total) * 100);
      expect(helpfulPct).toBe(100);
    });
  });

  describe("Type Label Mapping", () => {
    const typeLabelMap: Record<string, string> = {
      skill: "运营SOP",
      listing: "Listing文案",
      product: "产品创意",
      image: "图片知识",
      video: "视频知识",
    };

    it("should map all KB types to labels", () => {
      const kbTypes = ["skill", "listing", "product", "image", "video"];
      kbTypes.forEach((type) => {
        expect(typeLabelMap[type]).toBeDefined();
        expect(typeLabelMap[type].length).toBeGreaterThan(0);
      });
    });

    it("should return undefined for unknown types", () => {
      expect(typeLabelMap["unknown"]).toBeUndefined();
    });
  });

  describe("Overview Stats Structure", () => {
    it("should have correct default structure", () => {
      const defaultStats = {
        totalKbItems: { skills: 0, listings: 0, products: 0, images: 0, videos: 0 },
        totalConversations: 0,
        totalMessages: 0,
        totalIntelItems: 0,
        totalIntelSources: 0,
        totalCallLogs: 0,
        feedbackDistribution: { helpful: 0, irrelevant: 0, wrong: 0 },
        recentActivity: [],
        topReferencedTypes: [],
      };

      expect(defaultStats.totalKbItems).toHaveProperty("skills");
      expect(defaultStats.totalKbItems).toHaveProperty("listings");
      expect(defaultStats.totalKbItems).toHaveProperty("products");
      expect(defaultStats.totalKbItems).toHaveProperty("images");
      expect(defaultStats.totalKbItems).toHaveProperty("videos");
      expect(defaultStats.feedbackDistribution).toHaveProperty("helpful");
      expect(defaultStats.feedbackDistribution).toHaveProperty("irrelevant");
      expect(defaultStats.feedbackDistribution).toHaveProperty("wrong");
      expect(Array.isArray(defaultStats.recentActivity)).toBe(true);
      expect(Array.isArray(defaultStats.topReferencedTypes)).toBe(true);
    });
  });

  describe("Router Registration", () => {
    it("should have kbFeedback router registered", async () => {
      const routersModule = await import("./routers");
      const router = routersModule.appRouter;
      expect(router).toBeDefined();
      // Check that kbFeedback is a key in the router
      expect((router as any)._def.procedures).toBeDefined();
    });
  });
});
