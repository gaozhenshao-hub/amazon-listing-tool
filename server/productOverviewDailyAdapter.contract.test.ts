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

describe("产品总览赛狐来源",()=>{
 it("使用赛狐统一北美美元口径",()=>{
  expect(routerSource).toContain('sourceType:"saihu"');
  expect(routerSource).toContain('consolidateNorthAmerica:true');
  expect(routerSource).not.toContain('from(lingxingProductWeekly)');
  expect(pageSource).toContain('sourceType: "saihu"');
  expect(pageSource).toContain('consolidateNorthAmerica: true');
 });
});
