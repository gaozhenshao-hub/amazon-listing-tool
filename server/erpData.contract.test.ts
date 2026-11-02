import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const routerSource = readFileSync(resolve(process.cwd(), "server/routers/dataImport.ts"), "utf8");
const productsPageSource = readFileSync(resolve(process.cwd(), "client/src/pages/ops/OpsProducts.tsx"), "utf8");
const detailPageSource = readFileSync(resolve(process.cwd(), "client/src/pages/ops/OpsProductDetail.tsx"), "utf8");
const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

describe("ERP 数据统一入口契约", () => {
  it("后端统一查询可接收 ERP 请求并合并两类来源", () => {
    expect(routerSource).toContain('sourceType: z.enum(["erp", "lingxing", "saihu"])');
    expect(routerSource).toContain('if (input.sourceType === "erp")');
    expect(routerSource).toContain("mergeErpProducts");
    expect(routerSource).toContain('source: "lingxing"');
    expect(routerSource).toContain('source: "saihu"');
  });

  it("产品总览合并权威周报与 ERP 历史回退，而不让用户切换孤立来源", () => {
    expect(productsPageSource).toContain('sourceType: "erp"');
    expect(productsPageSource).toContain("buildUnifiedProductOverview");
    expect(productsPageSource).toContain("MCP parent-ASIN weeks are the primary facts");
    expect(productsPageSource).toContain("ERP remains only as explicitly labelled historical fallback");
  });

  it("详情页使用 ERP 路由且继续兼容旧导入链接", () => {
    expect(appSource).toContain('/ops/products/erp/:source/:parentAsin');
    expect(appSource).toContain('/ops/products/import/:source/:parentAsin');
    expect(detailPageSource).toContain('useRoute("/ops/products/erp/:source/:parentAsin")');
    expect(detailPageSource).toContain('useRoute("/ops/products/import/:source/:parentAsin")');
    expect(detailPageSource).toContain("ASIN周数据系统父ASIN汇总优先 · ERP历史回退");
  });
});
