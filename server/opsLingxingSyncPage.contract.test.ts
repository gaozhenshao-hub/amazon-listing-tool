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

  it("提供批次范围、数据影响和历史筛选，支持真实会话审阅", () => {
    expect(pageSource).toContain("读取范围");
    expect(pageSource).toContain("数据影响");
    expect(pageSource).toContain("historyDomainFilter");
    expect(pageSource).toContain("historyStatusFilter");
    expect(pageSource).toContain("按数据域筛选批次");
    expect(pageSource).toContain("原始响应已归档");
  });

  it("在选择库存或广告数据域时展示独立的联动与人工参数保护规则", () => {
    expect(pageSource).toContain("独立联动规则");
    expect(pageSource).toContain("getLingxingSyncRule");
    expect(pageSource).toContain("保护与缺失值");
  });

  it("提供每日与每周自动草稿计划管理，但明确不自动确认或写入业务数据", () => {
    expect(pageSource).toContain("自动草稿计划");
    expect(pageSource).toContain("每天北京时间 17:00");
    expect(pageSource).toContain("每周一北京时间 17:10");
    expect(pageSource).toContain("lingxingSync.setScheduleEnabled");
    expect(pageSource).toContain("不会自动确认、应用、覆盖历史数据");
  });
});
