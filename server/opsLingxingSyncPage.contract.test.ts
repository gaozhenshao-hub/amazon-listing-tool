import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(new URL("../client/src/pages/ops/OpsLingxingSync.tsx", import.meta.url), "utf8");

describe("领星同步页面ASIN日数据契约", () => {
  it("为ASIN日草稿提供确认后追加日快照的受治理入口", () => {
    expect(pageSource).toContain('"product_performance_daily", "order_profit"');
    expect(pageSource).toContain("确认后追加日快照并联动产品总览");
  });

  it("对超大原始响应草稿展示受控归档提示而非内联原始内容", () => {
    expect(pageSource).toContain("rawResponseExternalized");
    expect(pageSource).toContain("完整领星原始响应已受控归档");
  });
});
