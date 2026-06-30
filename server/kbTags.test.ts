import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAdminContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 1,
    openId: "admin-user",
    email: "admin@example.com",
    name: "Admin User",
    loginMethod: "manus",
    role: "admin",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

function createUserContext(): TrpcContext {
  const user: AuthenticatedUser = {
    id: 2,
    openId: "regular-user",
    email: "user@example.com",
    name: "Regular User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  return {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
  };
}

describe("kbTags Router", () => {
  const caller = appRouter.createCaller(createAdminContext());
  const userCaller = appRouter.createCaller(createUserContext());

  describe("getDimensions", () => {
    it("should return all 7 dimensions", async () => {
      const dims = await caller.kbTags.getDimensions();
      expect(dims).toHaveLength(7);
      expect(dims.map(d => d.key)).toEqual([
        "category", "color", "style", "imageType", "sellingPoint", "composition", "imageBelong"
      ]);
    });

    it("should include hasParent flag for hierarchical dimensions", async () => {
      const dims = await caller.kbTags.getDimensions();
      const imageType = dims.find(d => d.key === "imageType");
      const sellingPoint = dims.find(d => d.key === "sellingPoint");
      const category = dims.find(d => d.key === "category");
      expect(imageType?.hasParent).toBe(true);
      expect(sellingPoint?.hasParent).toBe(true);
      expect(category?.hasParent).toBe(false);
    });
  });

  describe("listAllForDimension", () => {
    it("should return tags for a given dimension", async () => {
      const tags = await caller.kbTags.listAllForDimension({ dimension: "category" });
      expect(Array.isArray(tags)).toBe(true);
    });

    it("should return tags for hierarchical dimension", async () => {
      const tags = await caller.kbTags.listAllForDimension({ dimension: "imageType" });
      expect(Array.isArray(tags)).toBe(true);
    });
  });

  describe("create", () => {
    it("should allow admin to create a system tag", async () => {
      const result = await caller.kbTags.create({
        dimension: "category",
        value: "测试类目_" + Date.now(),
        isSystem: true,
      });
      expect(result.id).toBeDefined();
      expect(typeof result.id).toBe("number");
    });

    it("should allow regular user to create a custom tag", async () => {
      const result = await userCaller.kbTags.create({
        dimension: "category",
        value: "用户自定义类目_" + Date.now(),
        isSystem: false,
      });
      expect(result.id).toBeDefined();
    });

    it("should prevent regular user from creating system tags", async () => {
      await expect(
        userCaller.kbTags.create({
          dimension: "category",
          value: "非法系统标签_" + Date.now(),
          isSystem: true,
        })
      ).rejects.toThrow("只有管理员可以创建系统标签");
    });
  });

  describe("update", () => {
    it("should allow admin to update a tag", async () => {
      // First create a tag
      const { id } = await caller.kbTags.create({
        dimension: "composition",
        value: "更新前_" + Date.now(),
        isSystem: true,
      });
      // Then update it
      const result = await caller.kbTags.update({
        id,
        value: "更新后_" + Date.now(),
      });
      expect(result.success).toBe(true);
    });
  });

  describe("delete", () => {
    it("should allow admin to delete a tag with 0 usage", async () => {
      const { id } = await caller.kbTags.create({
        dimension: "composition",
        value: "待删除_" + Date.now(),
        isSystem: true,
      });
      const result = await caller.kbTags.delete({ id, force: false });
      expect(result.success).toBe(true);
    });
  });

  describe("getUsageStats", () => {
    it("should return stats for all dimensions", async () => {
      const stats = await caller.kbTags.getUsageStats();
      expect(stats).toHaveProperty("category");
      expect(stats).toHaveProperty("color");
      expect(stats).toHaveProperty("style");
      expect(stats).toHaveProperty("imageType");
      expect(stats).toHaveProperty("sellingPoint");
      expect(stats).toHaveProperty("composition");
      expect(stats).toHaveProperty("imageBelong");
      // Each stat should have total, labeled, topValues
      expect(stats.category).toHaveProperty("total");
      expect(stats.category).toHaveProperty("labeled");
      expect(stats.category).toHaveProperty("topValues");
      expect(Array.isArray(stats.category.topValues)).toBe(true);
    });
  });

  describe("initSystemTags", () => {
    it("should initialize system tags (admin only)", async () => {
      const result = await caller.kbTags.initSystemTags();
      expect(result).toHaveProperty("inserted");
      expect(result).toHaveProperty("message");
      expect(typeof result.inserted).toBe("number");
    });

    it("should be idempotent (running twice should not duplicate)", async () => {
      // Run init twice
      await caller.kbTags.initSystemTags();
      const result2 = await caller.kbTags.initSystemTags();
      // Second run should insert 0 (all already exist)
      expect(result2.inserted).toBe(0);
    });
  });
});
