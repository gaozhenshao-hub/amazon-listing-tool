import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock DB
const mockDb = {
  select: vi.fn().mockReturnThis(),
  from: vi.fn().mockReturnThis(),
  where: vi.fn().mockReturnThis(),
  orderBy: vi.fn().mockReturnThis(),
  limit: vi.fn().mockReturnThis(),
  insert: vi.fn().mockReturnThis(),
  values: vi.fn().mockResolvedValue([{ insertId: 1 }]),
};

vi.mock("./db", () => ({
  getDb: vi.fn().mockResolvedValue(mockDb),
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: any[]) => ({ type: "eq", args })),
  and: vi.fn((...args: any[]) => ({ type: "and", args })),
  desc: vi.fn((col: any) => ({ type: "desc", col })),
  sql: vi.fn(),
  inArray: vi.fn((...args: any[]) => ({ type: "inArray", args })),
}));

describe("ASIN Logistics API - Schema & Logic", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asinLogs schema has required fields", async () => {
    const { asinLogs } = await import("../drizzle/schema");
    expect(asinLogs).toBeDefined();
    // Check table columns exist
    const columns = Object.keys(asinLogs);
    expect(columns.length).toBeGreaterThan(0);
  });

  it("asinLogs table has correct column names", async () => {
    const { asinLogs } = await import("../drizzle/schema");
    // The table should have these columns defined in schema
    const tableConfig = (asinLogs as any)[Symbol.for("drizzle:Columns")] || (asinLogs as any)._.columns;
    if (tableConfig) {
      const colNames = Object.keys(tableConfig);
      expect(colNames).toContain("id");
      expect(colNames).toContain("userId");
      expect(colNames).toContain("asin");
      expect(colNames).toContain("content");
      expect(colNames).toContain("createdAt");
    }
  });

  it("shippingBatchRouter has getAsinBatches procedure", async () => {
    const { shippingBatchRouter } = await import("./routers/shippingBatch");
    expect(shippingBatchRouter).toBeDefined();
    // Check that the router has the expected procedures
    const procedures = shippingBatchRouter._def.procedures;
    expect(procedures).toHaveProperty("getAsinBatches");
    expect(procedures).toHaveProperty("getAsinLogs");
    expect(procedures).toHaveProperty("addAsinLog");
  });

  it("shippingBatchRouter has listAsinsWithBatches procedure", async () => {
    const { shippingBatchRouter } = await import("./routers/shippingBatch");
    const procedures = shippingBatchRouter._def.procedures;
    expect(procedures).toHaveProperty("listAsinsWithBatches");
    expect(procedures).toHaveProperty("getBatchesByAsin");
  });

  it("SHIPPING_STEPS has 9 steps", async () => {
    const { SHIPPING_STEPS } = await import("./routers/shippingBatch");
    expect(SHIPPING_STEPS).toHaveLength(9);
    expect(SHIPPING_STEPS[0].name).toBe("准备中");
    expect(SHIPPING_STEPS[8].name).toBe("已到亚马逊仓");
  });

  it("getAsinBatches returns empty array when no batches exist", async () => {
    // Mock select to return empty
    mockDb.where.mockResolvedValueOnce([]);
    
    const { shippingBatchRouter } = await import("./routers/shippingBatch");
    const caller = shippingBatchRouter.createCaller({
      user: { id: 999, name: "Test", role: "admin", openId: "test_999" },
    } as any);
    
    const result = await caller.getAsinBatches({ asin: "B0NONEXIST" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("getAsinLogs returns array", async () => {
    mockDb.limit.mockResolvedValueOnce([]);
    
    const { shippingBatchRouter } = await import("./routers/shippingBatch");
    const caller = shippingBatchRouter.createCaller({
      user: { id: 999, name: "Test", role: "admin", openId: "test_999" },
    } as any);
    
    const result = await caller.getAsinLogs({ asin: "B0TEST123" });
    expect(Array.isArray(result)).toBe(true);
  });

  it("addAsinLog mutation succeeds", async () => {
    mockDb.values.mockResolvedValueOnce([{ insertId: 1 }]);
    
    const { shippingBatchRouter } = await import("./routers/shippingBatch");
    const caller = shippingBatchRouter.createCaller({
      user: { id: 999, name: "Test", role: "admin", openId: "test_999" },
    } as any);
    
    const result = await caller.addAsinLog({ 
      asin: "B0TEST123", 
      content: "测试日志内容" 
    });
    expect(result).toEqual({ success: true });
  });

  it("addAsinLog accepts optional batchId and batchName", async () => {
    mockDb.values.mockResolvedValueOnce([{ insertId: 2 }]);
    
    const { shippingBatchRouter } = await import("./routers/shippingBatch");
    const caller = shippingBatchRouter.createCaller({
      user: { id: 999, name: "Test", role: "admin", openId: "test_999" },
    } as any);
    
    const result = await caller.addAsinLog({ 
      asin: "B0TEST123", 
      content: "关联批次的日志",
      batchId: 42,
      batchName: "批次-042"
    });
    expect(result).toEqual({ success: true });
  });
});
