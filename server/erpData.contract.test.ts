import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(resolve(process.cwd(), "server/routers/dataImport.ts"), "utf8");
const productsPageSource = readFileSync(resolve(process.cwd(), "client/src/pages/ops/OpsProducts.tsx"), "utf8");
const detailPageSource = readFileSync(resolve(process.cwd(), "client/src/pages/ops/OpsProductDetail.tsx"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

describe("ERP 数据统一入口契约", () => {
  it("后端保留文件来源兼容，统一总览默认使用赛狐", () => {
    expect(routerSource).toContain('sourceType: z.enum(["erp", "lingxing", "saihu"])');
    expect(routerSource).toContain('input.consolidateNorthAmerica');
    expect(routerSource).toContain("mergeErpProducts");
    expect(routerSource).toContain('input.sourceType === "lingxing"');
    expect(routerSource).toContain('applyOperatorMappings(db!, products, "saihu")');
  });

  it("产品总览合并权威周报与 ERP 历史回退，而不让用户切换孤立来源", () => {
    expect(productsPageSource).toContain('sourceType: "saihu"');
    expect(productsPageSource).toContain("buildUnifiedProductOverview");
    expect(productsPageSource).toContain("consolidateNorthAmerica: true");
    expect(productsPageSource).toContain("赛狐未提供负责人");
  });

  it("详情页使用 ERP 路由且继续兼容旧导入链接", () => {
    expect(appSource).toContain('/ops/products/erp/:source/:parentAsin');
    expect(appSource).toContain('/ops/products/import/:source/:parentAsin');
    expect(detailPageSource).toContain('useRoute("/ops/products/erp/:source/:parentAsin")');
    expect(detailPageSource).toContain('useRoute("/ops/products/import/:source/:parentAsin")');
    expect(detailPageSource).toContain("ASIN周数据系统父ASIN汇总优先 · ERP历史回退");
  });
});
