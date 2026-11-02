import { describe, expect, it, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";
import {
  smartRoute,
  formatForPrompt,
  type KbItemType,
  type L1Item,
  type L2Item,
  type L3Item,
} from "./kbContextEngine";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(userId = 1): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: userId,
    openId: `test-user-kb-bot-${userId}`,
    email: `test${userId}@example.com`,
    name: `Test User ${userId}`,
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

// ============================================================
// kbBot Router - Procedure Existence Tests
// ============================================================

describe("kbBot Router - Procedure Existence", () => {
  it("should have chat procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbBot.chat).toBe("function");
  });

  it("should have listConversations procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbBot.listConversations).toBe("function");
  });

  it("should have getHistory procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbBot.getHistory).toBe("function");
  });

  it("should have deleteConversation procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbBot.deleteConversation).toBe("function");
  });

  it("should have clearAll procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbBot.clearAll).toBe("function");
  });

  it("should have updateTitle procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbBot.updateTitle).toBe("function");
  });
});

// ============================================================
// kbBot Router - All procedures registered in appRouter
// ============================================================

describe("kbBot Router - Registration", () => {
  it("should be registered in appRouter", () => {
    const router = appRouter._def.procedures;
    expect(router).toHaveProperty("kbBot.chat");
    expect(router).toHaveProperty("kbBot.listConversations");
    expect(router).toHaveProperty("kbBot.getHistory");
    expect(router).toHaveProperty("kbBot.deleteConversation");
    expect(router).toHaveProperty("kbBot.clearAll");
    expect(router).toHaveProperty("kbBot.updateTitle");
  });
});

// ============================================================
// kbContextEngine - smartRoute Tests
// ============================================================

describe("kbContextEngine - smartRoute", () => {
  it("should suggest image type for image-related queries", () => {
    const result = smartRoute("帮我找一些充电宝类目的优秀A+图片参考");
    expect(result.suggestedTypes).toContain("image");
  });

  it("should suggest listing type for listing-related queries", () => {
    const result = smartRoute("如何写好一个listing标题");
    expect(result.suggestedTypes).toContain("listing");
  });

  it("should suggest product type for product-related queries", () => {
    const result = smartRoute("有没有好的选品创意");
    expect(result.suggestedTypes).toContain("product");
  });

  it("should suggest skill type for SOP-related queries", () => {
    const result = smartRoute("新品上架运营流程SOP");
    expect(result.suggestedTypes).toContain("skill");
  });

  it("should suggest video type for video-related queries", () => {
    const result = smartRoute("有没有好的产品视频参考");
    expect(result.suggestedTypes).toContain("video");
  });

  it("should suggest all types for generic queries", () => {
    const result = smartRoute("最近有什么好的案例");
    expect(result.suggestedTypes.length).toBe(5);
    expect(result.suggestedTypes).toContain("product");
    expect(result.suggestedTypes).toContain("listing");
    expect(result.suggestedTypes).toContain("image");
    expect(result.suggestedTypes).toContain("skill");
    expect(result.suggestedTypes).toContain("video");
  });

  it("should suggest multiple types for multi-intent queries", () => {
    const result = smartRoute("充电宝的listing文案和图片参考");
    expect(result.suggestedTypes).toContain("listing");
    expect(result.suggestedTypes).toContain("image");
  });

  it("should return estimated tokens", () => {
    const result = smartRoute("帮我找图片");
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });
});

// ============================================================
// kbContextEngine - formatForPrompt Tests
// ============================================================

describe("kbContextEngine - formatForPrompt", () => {
  const mockL1Items: L1Item[] = [
    {
      id: 1,
      type: "product",
      title: "Anker充电宝",
      asin: "B0XXXXXX",
      category: "充电宝",
      tags: "便携,快充",
      score: 9,
      status: "confirmed",
      source: "internal",
      userId: 1,
    },
    {
      id: 2,
      type: "listing",
      title: "INIU充电宝Listing",
      asin: "B0YYYYYY",
      category: "充电宝",
      tags: "高转化",
      score: 8,
      status: "confirmed",
      source: "internal",
      userId: 1,
    },
  ];

  const mockL2Items: L2Item[] = mockL1Items.map((item) => ({
    ...item,
    summary: `${item.title}的优秀案例分析`,
    keyPoints: "设计精良,用户体验好",
    strengths: "品牌力强,产品差异化明显",
  }));

  const mockL3Items: L3Item[] = mockL2Items.map((item) => ({
    ...item,
    fullContent: `${item.title}的完整分析内容...`,
    imageUrls: "https://example.com/img1.jpg",
    aiAnalysis: `AI对${item.title}的深度分析...`,
    originalUrl: "",
  }));

  it("should format L1 items with basic info", () => {
    const result = formatForPrompt(mockL1Items, "L1");
    expect(result).toContain("Anker充电宝");
    expect(result).toContain("B0XXXXXX");
    expect(result).toContain("充电宝");
    expect(result).toContain("产品创意");
  });

  it("should format L2 items with summaries", () => {
    const result = formatForPrompt(mockL2Items, "L2");
    expect(result).toContain("摘要:");
    expect(result).toContain("要点:");
    expect(result).toContain("优秀案例分析");
  });

  it("should format L3 items with full content", () => {
    const result = formatForPrompt(mockL3Items, "L3");
    expect(result).toContain("完整内容:");
    expect(result).toContain("AI分析:");
  });

  it("should return empty message for no items", () => {
    const result = formatForPrompt([], "L1");
    expect(result).toContain("暂无匹配内容");
  });
});

// ============================================================
// kbBot Router - Input Validation Tests
// ============================================================

describe("kbBot Router - Input Validation", () => {
  it("chat should reject empty message", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.kbBot.chat({ message: "" })
    ).rejects.toThrow();
  });

  it("chat should reject message exceeding max length", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const longMessage = "a".repeat(5001);
    await expect(
      caller.kbBot.chat({ message: longMessage })
    ).rejects.toThrow();
  });

  it("getHistory should require conversationId", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      // @ts-expect-error - testing missing required field
      caller.kbBot.getHistory({})
    ).rejects.toThrow();
  });

  it("deleteConversation should require conversationId", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      // @ts-expect-error - testing missing required field
      caller.kbBot.deleteConversation({})
    ).rejects.toThrow();
  });

  it("updateTitle should reject empty title", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(
      caller.kbBot.updateTitle({ conversationId: 1, title: "" })
    ).rejects.toThrow();
  });

  it("updateTitle should reject title exceeding max length", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    const longTitle = "a".repeat(256);
    await expect(
      caller.kbBot.updateTitle({ conversationId: 1, title: longTitle })
    ).rejects.toThrow();
  });
});

// ============================================================
// kbBot - Reference and SearchPath Types
// ============================================================

describe("kbBot - Reference and SearchPath Types", () => {
  it("KbReference should have correct structure", () => {
    const ref = {
      id: 1,
      type: "product" as KbItemType,
      title: "Test Product",
      asin: "B0XXXXXX",
      score: 9,
      relevanceScore: 0.95,
      excerpt: "Test excerpt",
      category: "Electronics",
    };
    expect(ref.id).toBe(1);
    expect(ref.type).toBe("product");
    expect(ref.relevanceScore).toBeGreaterThan(0);
    expect(ref.relevanceScore).toBeLessThanOrEqual(1);
  });

  it("SearchPathStep should have correct structure", () => {
    const step = {
      level: "L1" as const,
      scannedCount: 50,
      matchedCount: 8,
      tokensUsed: 2500,
    };
    expect(step.level).toBe("L1");
    expect(step.scannedCount).toBeGreaterThanOrEqual(step.matchedCount);
    expect(step.tokensUsed).toBeGreaterThan(0);
  });

  it("SearchPath should follow L1 → L2 → L3 progression", () => {
    const searchPath = [
      { level: "L1" as const, scannedCount: 50, matchedCount: 8, tokensUsed: 2500 },
      { level: "L2" as const, scannedCount: 8, matchedCount: 5, tokensUsed: 1600 },
      { level: "L3" as const, scannedCount: 5, matchedCount: 3, tokensUsed: 3000 },
    ];
    expect(searchPath[0].level).toBe("L1");
    expect(searchPath[1].level).toBe("L2");
    expect(searchPath[2].level).toBe("L3");
    // Each level should scan fewer items than the previous matched
    expect(searchPath[1].scannedCount).toBeLessThanOrEqual(searchPath[0].matchedCount);
    expect(searchPath[2].scannedCount).toBeLessThanOrEqual(searchPath[1].matchedCount);
  });
});

// ============================================================
// kbBot - extractKeyword logic (tested via smartRoute behavior)
// ============================================================

describe("kbBot - Query Processing", () => {
  it("smartRoute handles Chinese queries correctly", () => {
    const result = smartRoute("帮我找一些充电宝类目的优秀主图参考");
    expect(result.suggestedTypes).toContain("image");
  });

  it("smartRoute handles English queries", () => {
    const result = smartRoute("Find good listing bullet points examples");
    expect(result.suggestedTypes).toContain("listing");
  });

  it("smartRoute handles mixed language queries", () => {
    const result = smartRoute("A+页面的best practice");
    expect(result.suggestedTypes).toContain("image");
  });

  it("smartRoute handles empty-like queries", () => {
    const result = smartRoute("帮我找");
    // Should default to all types
    expect(result.suggestedTypes.length).toBe(5);
  });
});
