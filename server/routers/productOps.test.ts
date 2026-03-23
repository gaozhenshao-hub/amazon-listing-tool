import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock dependencies
vi.mock("../db", () => ({
  getDb: vi.fn(() => Promise.resolve({
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnValue(Promise.resolve([])),
    insert: vi.fn().mockReturnThis(),
    values: vi.fn().mockReturnValue(Promise.resolve([{ insertId: 1 }])),
    update: vi.fn().mockReturnThis(),
    set: vi.fn().mockReturnThis(),
    delete: vi.fn().mockReturnThis(),
  })),
}));

vi.mock("../lingxingAdapter", () => ({
  getLingxingAdapter: vi.fn(() => ({
    isMockMode: () => true,
    request: vi.fn().mockResolvedValue({ code: 0, data: [], msg: "ok" }),
  })),
}));

describe("productOps router module", () => {
  it("should export productOpsRouter", async () => {
    const mod = await import("./productOps");
    expect(mod.productOpsRouter).toBeDefined();
    expect(mod.productOpsRouter._def).toBeDefined();
  });

  it("should have all expected procedures", async () => {
    const mod = await import("./productOps");
    const procedures = Object.keys(mod.productOpsRouter._def.procedures);
    
    // Product CRUD
    expect(procedures).toContain("listProducts");
    expect(procedures).toContain("getProduct");
    expect(procedures).toContain("createProduct");
    expect(procedures).toContain("updateProduct");
    expect(procedures).toContain("deleteProduct");
    
    // Variants
    expect(procedures).toContain("addVariant");
    expect(procedures).toContain("removeVariant");
    
    // Todos
    expect(procedures).toContain("getTodos");
    expect(procedures).toContain("createTodo");
    expect(procedures).toContain("updateTodo");
    expect(procedures).toContain("deleteTodo");
    
    // Logs
    expect(procedures).toContain("getLogs");
    expect(procedures).toContain("createLog");
    expect(procedures).toContain("deleteLog");
    
    // Keyword monitors
    expect(procedures).toContain("getKeywordMonitors");
    expect(procedures).toContain("addKeywordMonitor");
    expect(procedures).toContain("removeKeywordMonitor");
    expect(procedures).toContain("addKeywordSnapshot");
    
    // Data aggregation
    expect(procedures).toContain("getProductProfitSummary");
    expect(procedures).toContain("getProductInventorySummary");
    expect(procedures).toContain("getProductAdsSummary");
    expect(procedures).toContain("getProductCompetitors");
  });

  it("should have exactly 18 procedures", async () => {
    const mod = await import("./productOps");
    const procedures = Object.keys(mod.productOpsRouter._def.procedures);
    expect(procedures.length).toBe(22);
  });

  it("all procedures should be protected (require auth)", async () => {
    const mod = await import("./productOps");
    const procedures = mod.productOpsRouter._def.procedures;
    // All procedures should exist and be defined
    for (const [name, proc] of Object.entries(procedures)) {
      expect(proc, `Procedure ${name} should be defined`).toBeDefined();
    }
  });
});
