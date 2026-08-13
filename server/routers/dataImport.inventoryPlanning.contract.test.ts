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

  it("子 ASIN 成本参数与产品总览基本信息使用同一保存契约和美元平手价口径", () => {
    expect(routerSource).toContain("productCost: z.number().min(0).optional()");
    expect(routerSource).toContain("estimatedFirstLegCost: z.number().min(0).optional()");
    expect(routerSource).toContain("actualFirstLegCost: z.number().min(0).optional()");
    expect(routerSource).toContain("estimatedFbaFee: z.number().min(0).optional()");
    expect(routerSource).toContain("actualFbaFee: z.number().min(0).optional()");
    expect(routerSource).toContain("sellingPrice: z.number().min(0).optional()");
    expect(routerSource).toContain('currency: z.literal("USD")');
    expect(routerSource).toContain("const estimatedBreakEven = sellingPrice !== null");
    expect(routerSource).toContain("const actualBreakEven = sellingPrice !== null");
    expect(productsPageSource).toContain("产品基本信息（USD）");
    expect(productsPageSource).toContain("costPanelOpen");
    expect(productsPageSource).toContain("saveInventoryPlanningParameters");
    expect(productsPageSource).toContain("sellingPrice * 0.85");
    expect(productsPageSource).toContain("产品基本信息已保存，平手价和采购成本已同步更新");
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

  it("产品总览卡片优先展示上传表品名，品名缺失时才回退到Listing标题", () => {
    expect(productsPageSource).toContain("title: product.productName || product.title || product.parentAsin");
    expect(productsPageSource).toContain("chineseName: product.productName || null");
    expect(productsPageSource).toContain("product.chineseName || product.title");
  });

  it("领星日粒度父 ASIN 汇总复用既有周度数据中的运营负责人映射", () => {
    expect(routerSource).toContain("operatorByParentKey");
    expect(routerSource).toContain("lingxingProductWeekly.operator");
    expect(routerSource).toContain("productProfiles.operator");
    expect(routerSource).toContain("operatorByProfileKey");
    expect(routerSource).toContain("item.operator = item.operator");
    expect(routerSource).toContain("|| operatorByProfileKey.get");
  });

  it("产品总览前端保留后端已经映射的运营字段，不将其重置为空", () => {
    expect(productsPageSource).toContain("operator: product.operator || null");
    expect(productsPageSource).not.toContain("operator: null, storeName: product.storeName");
  });

  it("库存规划以子 ASIN 独立覆盖生产、物流和缓冲时间，父 ASIN 不参与计算覆盖", () => {
    expect(routerSource).toContain('item.scopeType === "asin" && item.asin === latest.asin');
    expect(routerSource).not.toContain('item.scopeType === "parent_asin" && item.parentAsin === latest.parentAsin');
    expect(inventoryPageSource).toContain("子 ASIN 库存规划表");
    expect(inventoryPageSource).toContain('scopeType: "asin"');
    expect(inventoryPageSource).not.toContain('scopeType: "parent_asin"');
  });

  it("库存规划以市场代码筛选时可识别领星中文国家名和店铺站点后缀", () => {
    expect(routerSource).toContain("function matchesLingxingMarketplace");
    expect(routerSource).toContain('US: ["US", "美国"]');
    expect(routerSource).toContain("const scopedSnapshots = snapshots.filter(row => matchesLingxingMarketplace(row, input.marketplace))");
  });

  it("库存规划直接读取同工作空间共享的领星日快照，避免按登录用户拆分数据", () => {
    expect(routerSource).toContain("产品总览上传的数据是同一工作空间共享的业务事实");
    expect(routerSource).toContain("const workspaceId = ctx.user.defaultWorkspaceId ?? currentOpsWorkspaceId()");
    expect(routerSource).toContain("eq(opsAsinDailySnapshots.workspaceId, workspaceId)");
    expect(routerSource).not.toContain("fallbackOwnerId");
  });

  it("库存页以库存规划工作台替代旧预警主界面，并允许确认本地库存", () => {
    expect(inventoryPageSource).toContain("库存规划工作台");
    expect(inventoryPageSource).toContain("getInventoryPlanningFromImport");
    expect(inventoryPageSource).toContain("confirmLocalInventory");
    expect(inventoryPageSource).toContain("默认总货期");
  });

  it("月度采购表按建议订货日归集三个月计划，并且只对已录入成本计算采购资金", () => {
    expect(inventoryPageSource).toContain("monthlyPurchasePlans");
    expect(inventoryPageSource).toContain('length: 3');
    expect(inventoryPageSource).toContain("建议订货日归入本月、下月和后月");
    expect(inventoryPageSource).toContain("purchaseAmount: productCost == null ? null : quantity * productCost");
    expect(inventoryPageSource).toContain("待录入成本");
    expect(inventoryPageSource).toContain("月度采购表与资金规划");
  });
});
