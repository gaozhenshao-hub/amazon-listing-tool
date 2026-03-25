import { describe, it, expect, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";

// ─── Test: Database Schema ───
describe("Shipping Batch Database Schema", () => {
  const schemaPath = path.resolve(__dirname, "../drizzle/schema.ts");
  const schema = fs.readFileSync(schemaPath, "utf-8");

  it("should define shipping_batches table with 9-step flow columns", () => {
    expect(schema).toContain('mysqlTable("shipping_batches"');
    expect(schema).toContain("currentStep");
    expect(schema).toContain("plannedQuantity");
    expect(schema).toContain("orderedQuantity");
    expect(schema).toContain("shippedQuantity");
    expect(schema).toContain("warehouseReceivedQuantity");
    expect(schema).toContain("internationalShippedQuantity");
    expect(schema).toContain("amazonReceivedQuantity");
    expect(schema).toContain("amazonStockedQuantity");
  });

  it("should define batch_step_configs table for custom step durations", () => {
    expect(schema).toContain('mysqlTable("batch_step_configs"');
    expect(schema).toContain("expectedDays");
    expect(schema).toContain("actualStartAt");
    expect(schema).toContain("actualEndAt");
  });

  it("should define batch_products table for product line items", () => {
    expect(schema).toContain('mysqlTable("batch_products"');
    expect(schema).toContain("batchId");
    expect(schema).toContain("sellerSku");
    expect(schema).toContain("unitCost");
  });

  it("should define batch_logs table for operation history", () => {
    expect(schema).toContain('mysqlTable("batch_logs"');
    expect(schema).toContain("action");
    expect(schema).toContain("details");
  });

  it("should define step_time_history table for AI learning", () => {
    expect(schema).toContain('mysqlTable("step_time_history"');
    expect(schema).toContain("stepNumber");
    expect(schema).toContain("actualDays");
    expect(schema).toContain("shippingMethod");
  });

  it("should define replenishment_predictions table", () => {
    expect(schema).toContain('mysqlTable("replenishment_predictions"');
    expect(schema).toContain("alertLevel");
    expect(schema).toContain("daysOfStockRemaining");
    expect(schema).toContain("fullCycleDays");
    expect(schema).toContain("recommendedQuantity");
    expect(schema).toContain('aiSuggestion: json("ai_suggestion")');
  });

  it("should define step_time_templates table with individual step columns", () => {
    expect(schema).toContain('mysqlTable("step_time_templates"');
    expect(schema).toContain("step1Days");
    expect(schema).toContain("step9Days");
    expect(schema).toContain("isDefault");
    expect(schema).toContain("aiSuggested");
  });
});

// ─── Test: Shipping Batch Router ───
describe("Shipping Batch Router", () => {
  const routerPath = path.resolve(__dirname, "./routers/shippingBatch.ts");
  const routerCode = fs.readFileSync(routerPath, "utf-8");

  it("should have all CRUD procedures", () => {
    expect(routerCode).toContain("list:");
    expect(routerCode).toContain("getById:");
    expect(routerCode).toContain("create:");
    expect(routerCode).toContain("update:");
    expect(routerCode).toContain("delete:");
  });

  it("should have step advancement procedure with validation", () => {
    expect(routerCode).toContain("advanceStep:");
    // Should validate logistics number for step 4
    expect(routerCode).toContain("trackingNumber");
    expect(routerCode).toContain("internationalTrackingNumber");
  });

  it("should have batch completion procedure", () => {
    expect(routerCode).toContain("completeBatch:");
  });

  it("should have product management procedures", () => {
    expect(routerCode).toContain("addProduct:");
    expect(routerCode).toContain("removeProduct:");
    expect(routerCode).toContain("updateQuantity:");
  });

  it("should have inventory pipeline summary procedure", () => {
    expect(routerCode).toContain("getInventoryPipeline:");
    expect(routerCode).toContain("getInventoryPipelineSummary:");
  });

  it("should have AI replenishment prediction procedures", () => {
    expect(routerCode).toContain("runPredictions:");
    expect(routerCode).toContain("getPredictions:");
    expect(routerCode).toContain("confirmPrediction:");
  });

  it("should have step time template CRUD procedures", () => {
    expect(routerCode).toContain("getStepTemplates:");
    expect(routerCode).toContain("saveStepTemplate:");
    expect(routerCode).toContain("deleteStepTemplate:");
  });

  it("should have AI duration learning procedure", () => {
    expect(routerCode).toContain("getAIDurations:");
  });

  it("should have Lingxing API integration procedures", () => {
    expect(routerCode).toContain("getLingxingDeliveryOrders:");
    expect(routerCode).toContain("getLingxingLogisticsChannels:");
    expect(routerCode).toContain("getLingxingFbaInventory:");
  });

  it("should use String(ctx.user.id) for varchar userId columns", () => {
    // All ctx.user.id references should be wrapped in String()
    const ctxUserIdRefs = routerCode.match(/ctx\.user\.id/g) || [];
    const stringWrapped = routerCode.match(/String\(ctx\.user\.id\)/g) || [];
    expect(stringWrapped.length).toBe(ctxUserIdRefs.length);
  });
});

// ─── Test: Replenishment Engine ───
describe("Replenishment Engine", () => {
  const enginePath = path.resolve(__dirname, "./replenishmentEngine.ts");
  const engineCode = fs.readFileSync(enginePath, "utf-8");

  it("should export core prediction functions", () => {
    expect(engineCode).toContain("export async function runReplenishmentPredictions");
    expect(engineCode).toContain("export async function getSavedPredictions");
    expect(engineCode).toContain("export async function getInventoryPipelineSummary");
  });

  it("should export step time learning functions", () => {
    expect(engineCode).toContain("export async function recordStepTime");
    expect(engineCode).toContain("export async function getAIRecommendedDurations");
  });

  it("should define 9 step names matching the flow", () => {
    expect(engineCode).toContain("STEP_NAMES");
    expect(engineCode).toContain("准备中");
    expect(engineCode).toContain("采购中");
    expect(engineCode).toContain("准备寄出");
    expect(engineCode).toContain("已寄出");
    expect(engineCode).toContain("国内运输中");
    expect(engineCode).toContain("已到仓");
    expect(engineCode).toContain("国际物流运输中");
    expect(engineCode).toContain("接收中");
    expect(engineCode).toContain("已到亚马逊仓");
  });

  it("should define 4 alert levels", () => {
    expect(engineCode).toContain("determineAlertLevel");
    expect(engineCode).toContain("urgent");
    expect(engineCode).toContain("warning");
    expect(engineCode).toContain("advance");
    expect(engineCode).toContain("sufficient");
  });

  it("should use LLM for AI suggestions", () => {
    expect(engineCode).toContain("invokeLLM");
  });

  it("should calculate full cycle days from step durations", () => {
    expect(engineCode).toContain("calculateFullCycleDays");
  });

  it("should track in-transit inventory across steps 4-8", () => {
    expect(engineCode).toContain("getInTransitInventory");
  });
});

// ─── Test: Frontend Pages ───
describe("Frontend Shipping Batch Pages", () => {
  const batchListPath = path.resolve(__dirname, "../client/src/pages/ops/OpsShippingBatch.tsx");
  const batchDetailPath = path.resolve(__dirname, "../client/src/pages/ops/OpsShippingBatchDetail.tsx");
  const inventoryPath = path.resolve(__dirname, "../client/src/pages/ops/OpsInventory.tsx");

  it("should have OpsShippingBatch list page", () => {
    const code = fs.readFileSync(batchListPath, "utf-8");
    expect(code).toContain("trpc.shippingBatch.list");
    expect(code).toContain("trpc.shippingBatch.create");
  });

  it("should have OpsShippingBatchDetail page with 9-step progress", () => {
    const code = fs.readFileSync(batchDetailPath, "utf-8");
    expect(code).toContain("trpc.shippingBatch.getById");
    expect(code).toContain("trpc.shippingBatch.advanceStep");
    // Should show 9 steps
    expect(code).toContain("准备中");
    expect(code).toContain("国际物流");
    expect(code).toContain("已到亚马逊仓");
  });

  it("should have enhanced OpsInventory with pipeline dashboard", () => {
    const code = fs.readFileSync(inventoryPath, "utf-8");
    expect(code).toContain("trpc.shippingBatch.getInventoryPipelineSummary");
    expect(code).toContain("trpc.shippingBatch.getPredictions");
    expect(code).toContain("trpc.shippingBatch.runPredictions");
  });

  it("should have batch detail page with inventory tracking", () => {
    const code = fs.readFileSync(batchDetailPath, "utf-8");
    expect(code).toContain("库存追踪");
    expect(code).toContain("损耗率");
  });

  it("should have batch detail page with log management", () => {
    const code = fs.readFileSync(batchDetailPath, "utf-8");
    expect(code).toContain("trpc.shippingBatch.addLog");
    expect(code).toContain("日志");
  });
});

// ─── Test: Lingxing Adapter Mock Endpoints ───
describe("Lingxing Adapter Logistics Endpoints", () => {
  const adapterPath = path.resolve(__dirname, "./lingxingAdapter.ts");
  const adapterCode = fs.readFileSync(adapterPath, "utf-8");

  it("should have FBA delivery order mock endpoint", () => {
    expect(adapterCode).toContain("shipmentList");
  });

  it("should have logistics channel mock endpoint", () => {
    expect(adapterCode).toContain("channelList");
  });

  it("should have FBA inventory V2 mock endpoint", () => {
    expect(adapterCode).toContain("fbaWarehouseDetail");
  });

  it("should have logistics provider mock endpoint", () => {
    expect(adapterCode).toContain("fbaStock/fbaList");
  });

  it("should have warehouse inventory mock endpoint", () => {
    expect(adapterCode).toContain("warehouseInventory");
  });
});

// ─── Test: Route Registration ───
describe("Route Registration", () => {
  const appPath = path.resolve(__dirname, "../client/src/App.tsx");
  const appCode = fs.readFileSync(appPath, "utf-8");
  const layoutPath = path.resolve(__dirname, "../client/src/components/DashboardLayout.tsx");
  const layoutCode = fs.readFileSync(layoutPath, "utf-8");

  it("should register shipping batch detail route in App.tsx", () => {
    // Batch list is now merged into OpsInventory pipeline tab
    // Only the detail route remains as a standalone page
    expect(appCode).toContain("OpsShippingBatchDetail");
    expect(appCode).toContain("/ops/shipping/:id");
  });

  it("should have inventory nav item in sidebar (batch management merged into pipeline)", () => {
    // Batch management is now part of the inventory pipeline view
    expect(layoutCode).toContain("库存预警");
    expect(layoutCode).toContain("/ops/inventory");
  });
});
