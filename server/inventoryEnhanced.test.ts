import { describe, it, expect, vi } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

// Mock the LingxingAdapter
vi.mock("./lingxingAdapter", () => ({
  getLingxingAdapter: () => ({
    isMockMode: () => true,
    request: vi.fn().mockImplementation(async ({ path }: any) => {
      if (path === "/erp/sc/data/seller/lists") {
        return { data: [{ sid: 1001, mid: 1, name: "Test Store US", seller_id: "ATEST123" }] };
      }
      if (path === "/erp/sc/data/mws/listing") {
        return {
          data: [
            { asin: "B0TEST001", asin1: "B0TEST001", title: "Test Product 1", sku: "SKU-001", local_name: "Test Product 1", image_url: "" },
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
              query: "low click term", target_text: "B0TEST001", match_type: "EXACT",
              campaign_id: "C001", ad_group_id: "AG001",
              impressions: 200, clicks: 5, cost: 3.0, sales7d: 0, orders: 0,
            },
          ],
        };
      }
      // AWD inventory mock
      if (path === "/erp/sc/inventoryManage/awdStockList") {
        return {
          data: [
            { sku: "SKU-001", product_name: "Test Product 1", awd_quantity: 500, awd_inbound_quantity: 100, awd_reserved_quantity: 50, awd_warehouse: "AWD-US-1", status: "available", last_updated: "2026-03-27" },
            { sku: "SKU-002", product_name: "Test Product 2", awd_quantity: 200, awd_inbound_quantity: 0, awd_reserved_quantity: 10, awd_warehouse: "AWD-US-2", status: "available", last_updated: "2026-03-27" },
          ],
        };
      }
      // Local warehouse mock
      if (path === "/erp/sc/inventoryManage/localWarehouseDetail") {
        return {
          data: [
            { sku: "SKU-001", product_name: "Test Product 1", warehouse_name: "深圳仓", available_qty: 1000, reserved_qty: 50, defective_qty: 5, total_qty: 1055, batch_no: "B2026-001", unit_cost: 8.5, total_value: 8967.5 },
          ],
        };
      }
      // FBA inventory mock
      if (path === "/erp/sc/inventoryManage/fbaStockList" || path === "/erp/sc/routing/inventoryManage/lists") {
        return {
          data: [
            { seller_sku: "SKU-001", asin: "B0TEST001", product_name: "Test Product 1", fulfillable_qty: 300, inbound_qty: 50, avg_daily_sales: 10, days_of_supply: 30, alertLevel: "normal" },
          ],
        };
      }
      return { data: [] };
    }),
    requestWithMockFallback: vi.fn().mockImplementation(async ({ path }: any) => {
      if (path === "/erp/sc/data/fba/FbaShipmentList") {
        return { data: [{ seller_sku: "SKU-001", asin: "B0TEST001", product_name: "Test Product 1", fulfillable_qty: 100, inbound_qty: 20, avg_daily_sales: 5, days_of_supply: 20, alertLevel: "normal" }] };
      }
      if (path === "/erp/sc/data/fba/awdShipmentList" || path.includes("awd")) {
        return { data: [{ seller_sku: "SKU-001", asin: "B0TEST001", product_name: "Test Product 1", quantity: 200, status: "ACTIVE" }] };
      }
      if (path === "/erp/sc/data/inventory/list" || path.includes("inventory")) {
        return { data: [{ seller_sku: "SKU-001", asin: "B0TEST001", product_name: "Test Product 1", quantity: 50, warehouse_name: "Local WH" }] };
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
          suggestions: [
            { seller_sku: "SKU-001", urgency: "plan", suggested_qty: 500, reason: "库存充足但需提前准备", estimated_stockout_date: "2026-05-01", notes: "考虑AWD库存500件" },
          ],
          summary: "整体库存健康",
        }),
      },
    }],
  }),
}));

const mockUser = { id: 1, openId: "test-user", name: "Test User", role: "admin" as const };
const createCaller = () => {
  const ctx: TrpcContext = { user: mockUser };
  return appRouter.createCaller(ctx);
};

describe("Inventory Enhanced APIs", () => {
  it("should return AWD inventory data", async () => {
    const caller = createCaller();
    const result = await caller.operations.getAwdInventory({ marketplace: "US" });
    expect(result).toBeDefined();
    expect(result.items).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
    if (result.items.length > 0) {
      const item = result.items[0];
      expect(item).toHaveProperty("sku");
      expect(item).toHaveProperty("awd_quantity");
    }
  });

  it("should return local warehouse inventory data", async () => {
    const caller = createCaller();
    const result = await caller.operations.getLocalWarehouseInventory({ marketplace: "US" });
    expect(result).toBeDefined();
    expect(result.items).toBeDefined();
    expect(Array.isArray(result.items)).toBe(true);
    if (result.items.length > 0) {
      const item = result.items[0];
      expect(item).toHaveProperty("sku");
      expect(item).toHaveProperty("warehouse_name");
      expect(item).toHaveProperty("total_qty");
    }
  });

  it("should return omni-channel inventory aggregation", async () => {
    const caller = createCaller();
    const result = await caller.operations.getOmniChannelInventory({ marketplace: "US" });
    expect(result).toBeDefined();
    expect(result.items).toBeDefined();
    expect(result.summary).toBeDefined();
    expect(result.summary).toHaveProperty("total_skus");
    expect(result.summary).toHaveProperty("total_fba");
    expect(result.summary).toHaveProperty("total_awd");
    expect(result.summary).toHaveProperty("total_local");
  });
});

describe("Word Frequency Classification API", () => {
  it("should return word frequency 6-classification results", async () => {
    const caller = createCaller();
    const result = await caller.adAnalysis.getWordFrequencyAnalysis({
      asin: "B0TEST001",
      days: 30,
      marketplace: "US",
    });
    expect(result).toBeDefined();
    // Returns attributes array and categoryStats object
    expect(result.attributes).toBeDefined();
    expect(Array.isArray(result.attributes)).toBe(true);
    expect(result.categoryStats).toBeDefined();
    // Should have 6 category stats
    expect(Object.keys(result.categoryStats).length).toBe(6);
    // Each category stat should have count, impressions, clicks, orders, cost
    for (const key of Object.keys(result.categoryStats)) {
      const stat = (result.categoryStats as any)[key];
      expect(stat).toHaveProperty("count");
      expect(stat).toHaveProperty("impressions");
    }
    expect(result.totalWords).toBeDefined();
    expect(result.isMock).toBeDefined();
  });
});

describe("Effective Search Terms Discovery API", () => {
  it("should return effective search terms discovery results", async () => {
    const caller = createCaller();
    const result = await caller.adAnalysis.getEffectiveSearchTerms({
      asin: "B0TEST001",
      days: 30,
      marketplace: "US",
    });
    expect(result).toBeDefined();
    expect(result.effectiveTerms).toBeDefined();
    expect(Array.isArray(result.effectiveTerms)).toBe(true);
    if (result.effectiveTerms.length > 0) {
      const term = result.effectiveTerms[0];
      expect(term).toHaveProperty("query");
      expect(term).toHaveProperty("orders");
    }
  });
});
