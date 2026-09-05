import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "../client/src/pages/ops/OpsProducts.tsx"),
  "utf8",
);
const routerSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "domains/ops/routers/weeklyOps.ts"),
  "utf8",
);
const overviewSource = fs.readFileSync(
  path.resolve(import.meta.dirname, "domains/ops/productOverview/parentWeeklyOverview.ts"),
  "utf8",
);

describe("产品总览父ASIN周报适配", () => {
  it("系统总览直接消费父ASIN周报权威构建器，而不再由前端日快照适配层构造周指标", () => {
    expect(routerSource).toContain("buildParentWeeklyOverview(weeklyFacts, profileSeeds, weeksToShow)");
    expect(routerSource).toContain("lingxingProductWeekly");
    expect(overviewSource).toContain('fact.sourceKind === "lingxing_mcp_parent_asin_weekly"');
    expect(overviewSource).toContain("variantCount: childAsins.length");
  });

  it("页面明确提示周度权威来源及ASIN日数据的受限用途", () => {
    expect(pageSource).toContain("权威周度来源：领星MCP父ASIN自然周报");
    expect(pageSource).toContain("ASIN日数据仅用于单ASIN详情与库存规划");
  });
});
