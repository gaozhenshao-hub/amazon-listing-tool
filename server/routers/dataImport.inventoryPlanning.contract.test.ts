import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routerSource = readFileSync(resolve(process.cwd(), "server/routers/dataImport.ts"), "utf8");
const productsPageSource = readFileSync(resolve(process.cwd(), "client/src/pages/ops/OpsProducts.tsx"), "utf8");
const detailPageSource = readFileSync(resolve(process.cwd(), "client/src/pages/ops/OpsProductDetail.tsx"), "utf8");
const inventoryPageSource = readFileSync(resolve(process.cwd(), "client/src/pages/ops/OpsInventory.tsx"), "utf8");

describe("导入模式库存规划接口契约", () => {
  it("以 ASIN 日快照作为库存规划输入，而不是旧库存预警表", () => {
    expect(routerSource).toContain("getInventoryPlanningFromImport");
    expect(routerSource).toContain("opsAsinDailySnapshots");
    expect(routerSource).toContain("calculateInventoryPlan");
  });

  it("确认本地库存时保留历史版本并将旧确认记录标记为已替代", () => {
    expect(routerSource).toContain("confirmLocalInventory");
    expect(routerSource).toContain('status: "confirmed"');
    expect(routerSource).toContain('status: "superseded"');
    expect(routerSource).toContain("supersededById: created.id");
  });

  it("没有专属参数时使用确认的 30/30/10 默认货期", () => {
    expect(routerSource).toContain("saveInventoryPlanningParameters");
    expect(routerSource).toContain("productionDays: parameter?.productionDays ?? 30");
    expect(routerSource).toContain("shippingDays: parameter?.shippingDays ?? 30");
    expect(routerSource).toContain("bufferDays: parameter?.bufferDays ?? 10");
  });

  it("产品总览和详情页均使用新的日粒度库存与变体销量接口", () => {
    expect(productsPageSource).toContain("getLingxingDailyOverview");
    expect(productsPageSource).toContain("adaptDailyParentOverview");
    expect(productsPageSource).toContain("ProductBlock");
    expect(productsPageSource).toContain("avgDailySales7d: latest.salesQty");
    expect(productsPageSource).not.toContain("avgDailySales7d: salesQty /");
    expect(productsPageSource).toContain("getInventoryPlanningFromImport");
    expect(productsPageSource).toContain("库存规划工作台");
    expect(detailPageSource).toContain("getLingxingDailyVariants");
    expect(detailPageSource).toContain("近{week}周");
  });

  it("领星日粒度父 ASIN 汇总复用既有周度数据中的运营负责人映射", () => {
    expect(routerSource).toContain("operatorByParentKey");
    expect(routerSource).toContain("lingxingProductWeekly.operator");
    expect(routerSource).toContain("item.operator = operatorByParentKey.get");
  });

  it("父 ASIN 可独立覆盖生产、物流和缓冲时间，并优先参与库存规划计算", () => {
    expect(routerSource).toContain('item.scopeType === "parent_asin"');
    expect(routerSource).toContain('scopeType: z.enum(["workspace", "store_country", "parent_asin", "asin"])');
    expect(routerSource).toContain("parentAsin: latest.parentAsin");
    expect(inventoryPageSource).toContain("产品独立货期");
    expect(inventoryPageSource).toContain('scopeType: "parent_asin"');
  });

  it("库存页以库存规划工作台替代旧预警主界面，并允许确认本地库存", () => {
    expect(inventoryPageSource).toContain("库存规划工作台");
    expect(inventoryPageSource).toContain("getInventoryPlanningFromImport");
    expect(inventoryPageSource).toContain("confirmLocalInventory");
    expect(inventoryPageSource).toContain("默认总货期");
  });
});
