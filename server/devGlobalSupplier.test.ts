import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock devDb module
vi.mock("./devDb", () => {
  let suppliers: any[] = [];
  let nextId = 1;

  return {
    getDevGlobalSuppliers: vi.fn(async (userId: number) => {
      return suppliers.filter((s) => s.userId === userId);
    }),
    saveDevGlobalSupplier: vi.fn(async (data: any) => {
      if (data.id) {
        // Update
        const idx = suppliers.findIndex((s) => s.id === data.id);
        if (idx >= 0) {
          suppliers[idx] = { ...suppliers[idx], ...data, updatedAt: new Date() };
          return suppliers[idx];
        }
        throw new Error("Supplier not found");
      }
      // Create
      const newSupplier = {
        id: nextId++,
        ...data,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      suppliers.push(newSupplier);
      return newSupplier;
    }),
    deleteDevGlobalSupplier: vi.fn(async (id: number, userId: number) => {
      const idx = suppliers.findIndex((s) => s.id === id && s.userId === userId);
      if (idx >= 0) {
        suppliers.splice(idx, 1);
      }
    }),
    // Reset helper for tests
    __resetSuppliers: () => {
      suppliers = [];
      nextId = 1;
    },
  };
});

function createTestContext(userId = 1): TrpcContext {
  return {
    user: {
      id: userId,
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

describe("devGlobalSupplier router", () => {
  beforeEach(async () => {
    const devDb = await import("./devDb");
    (devDb as any).__resetSuppliers();
  });

  describe("add", () => {
    it("should add a supplier with required name field", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devGlobalSupplier.add({
        name: "测试供应商A",
        contactPerson: "张三",
        phone: "13800138000",
        email: "test@example.com",
      });

      expect(result).toBeDefined();
      expect(result.name).toBe("测试供应商A");
      expect(result.contactPerson).toBe("张三");
    });

    it("should reject empty name", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.devGlobalSupplier.add({ name: "" })
      ).rejects.toThrow();
    });

    it("should handle categories as array", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devGlobalSupplier.add({
        name: "供应商B",
        categories: ["电子配件", "塑料件"],
      });

      expect(result).toBeDefined();
      expect(result.categories).toBe(JSON.stringify(["电子配件", "塑料件"]));
    });
  });

  describe("list", () => {
    it("should list suppliers for the current user", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      await caller.devGlobalSupplier.add({ name: "供应商1" });
      await caller.devGlobalSupplier.add({ name: "供应商2" });

      const list = await caller.devGlobalSupplier.list();
      expect(list).toHaveLength(2);
    });

    it("should filter by search term", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      await caller.devGlobalSupplier.add({ name: "电子元件供应商" });
      await caller.devGlobalSupplier.add({ name: "包装材料商" });

      const filtered = await caller.devGlobalSupplier.list({ search: "电子" });
      expect(filtered).toHaveLength(1);
      expect(filtered[0].name).toBe("电子元件供应商");
    });
  });

  describe("update", () => {
    it("should update an existing supplier", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      const added = await caller.devGlobalSupplier.add({ name: "原始名称" });

      const updated = await caller.devGlobalSupplier.update({
        id: added.id,
        name: "更新名称",
        phone: "13900139000",
      });

      expect(updated.name).toBe("更新名称");
      expect(updated.phone).toBe("13900139000");
    });
  });

  describe("delete", () => {
    it("should delete a supplier", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      const added = await caller.devGlobalSupplier.add({ name: "待删除" });

      const result = await caller.devGlobalSupplier.delete({ id: added.id });
      expect(result).toEqual({ success: true });

      const list = await caller.devGlobalSupplier.list();
      expect(list).toHaveLength(0);
    });
  });

  describe("batchImport", () => {
    it("should import multiple suppliers at once", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      const result = await caller.devGlobalSupplier.batchImport({
        suppliers: [
          { name: "批量供应商1", phone: "111" },
          { name: "批量供应商2", phone: "222" },
          { name: "批量供应商3", email: "s3@test.com" },
        ],
      });

      expect(result.imported).toBe(3);
      expect(result.failed).toBe(0);

      const list = await caller.devGlobalSupplier.list();
      expect(list).toHaveLength(3);
    });

    it("should reject batch with empty name", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      await expect(
        caller.devGlobalSupplier.batchImport({
          suppliers: [{ name: "" }],
        })
      ).rejects.toThrow();
    });
  });

  describe("getById", () => {
    it("should return a supplier by id", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      const added = await caller.devGlobalSupplier.add({
        name: "查询测试",
        email: "query@test.com",
      });

      const found = await caller.devGlobalSupplier.getById({ id: added.id });
      expect(found).toBeDefined();
      expect(found?.name).toBe("查询测试");
    });

    it("should return null for non-existent id", async () => {
      const ctx = createTestContext();
      const caller = appRouter.createCaller(ctx);

      const found = await caller.devGlobalSupplier.getById({ id: 999 });
      expect(found).toBeNull();
    });
  });
});
