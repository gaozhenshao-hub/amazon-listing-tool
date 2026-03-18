import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): { ctx: TrpcContext } {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "test-user-kb",
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

describe("Knowledge Base Router Endpoints Existence", () => {
  it("kbProducts router has updateScore procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbProducts.updateScore).toBe("function");
  });

  it("kbProducts router has updateTags procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbProducts.updateTags).toBe("function");
  });

  it("kbListings router has updateScore procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbListings.updateScore).toBe("function");
  });

  it("kbListings router has updateTags procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbListings.updateTags).toBe("function");
  });

  it("kbImages router has updateScore procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbImages.updateScore).toBe("function");
  });

  it("kbImages router has updateImageScore procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbImages.updateImageScore).toBe("function");
  });

  it("kbVideos router has updateScore procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbVideos.updateScore).toBe("function");
  });

  it("kbVideos router has updateTags procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbVideos.updateTags).toBe("function");
  });

  it("kbSearch router has search procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbSearch.search).toBe("function");
  });

  it("kbSearch router has stats procedure", () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    expect(typeof caller.kbSearch.stats).toBe("function");
  });
});

describe("Knowledge Base Input Validation", () => {
  it("kbProducts.updateScore rejects score below 1", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.kbProducts.updateScore({ id: 1, score: 0 })).rejects.toThrow();
  });

  it("kbProducts.updateScore rejects score above 100", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.kbProducts.updateScore({ id: 1, score: 101 })).rejects.toThrow();
  });

  it("kbListings.updateScore rejects score below 1", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.kbListings.updateScore({ id: 1, score: 0 })).rejects.toThrow();
  });

  it("kbVideos.updateScore rejects score below 1", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.kbVideos.updateScore({ id: 1, score: 0 })).rejects.toThrow();
  });

  it("kbVideos.updateScore rejects score above 100", async () => {
    const { ctx } = createAuthContext();
    const caller = appRouter.createCaller(ctx);
    await expect(caller.kbVideos.updateScore({ id: 1, score: 101 })).rejects.toThrow();
  });
});
