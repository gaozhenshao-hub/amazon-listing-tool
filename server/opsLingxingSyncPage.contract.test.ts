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

  it("提供产品、库存、关键词每日校验后自动追加与每周仅草稿的独立计划治理", () => {
    expect(pageSource).toContain("受治理自动计划");
    expect(pageSource).toContain("每天北京时间 17:00");
    expect(pageSource).toContain("每天北京时间 17:20");
    expect(pageSource).toContain("每天北京时间 17:40");
    expect(pageSource).toContain("每周一北京时间 17:10");
    expect(pageSource).toContain("lingxingSync.setScheduleEnabled");
    expect(pageSource).toContain("校验通过自动追加历史事实");
    expect(pageSource).toContain("FBA库存快照与广告关键词历史事实仅在完整性校验通过后自动追加");
  });

  it("明确同步与下载仅保留所选时间内有经营、广告或表现数据的商品", () => {
    expect(pageSource).toContain("统计范围（同步与下载）");
    expect(pageSource).toContain("有销量、广告或表现数据的商品");
    expect(pageSource).toContain("全零商品保留在受控原始读取审计中");
  });

  it("将受QPS限制的官方目录读取与纯数据库历史/计划查询分阶段发起", () => {
    expect(pageSource).toContain("directoryBootstrapSettled");
    expect(pageSource).toContain("避免首屏同批局部429污染其缓存");
    expect(pageSource).toContain("enabled: reviewQueueBootstrapReady");
    expect(pageSource).toContain("enabled: historyBootstrapReady");
    expect(pageSource).toContain("enabled: scheduleBootstrapReady");
    expect(pageSource).toContain("也不因目录暂时超时而隐藏已经启用的自动计划");
  });

  it("提供按日期的异常回补复核入口、证据查看、复核审计与受控重新读取", () => {
    expect(pageSource).toContain("异常数据复核");
    expect(pageSource).toContain("lingxingSync.listBackfillReviewQueue");
    expect(pageSource).toContain("lingxingSync.acknowledgeBackfillReview");
    expect(pageSource).toContain("重新读取");
    expect(pageSource).toContain("旧草稿和审计证据会保留");
    expect(pageSource).toContain("正在准备店铺目录并读取异常复核队列");
  });

  it("对异常ASIN日草稿锁定确认与应用，不允许前端绕过完整性校验", () => {
    expect(pageSource).toContain("activeBatchReviewBlocked");
    expect(pageSource).toContain("该批次为异常复核草稿，已锁定确认与应用");
    expect(pageSource).toContain("异常批次不可确认");
  });

  it("为Phase 5只读域提供美国站全店范围和不可确认的结构化字段对账提示", () => {
    expect(pageSource).toContain("美国站全部授权店铺（只读预览）");
    expect(pageSource).toContain("美国站全部广告授权Profile");
    expect(pageSource).toContain("仅字段对账草稿，未开放确认或业务写入");
    expect(pageSource).toContain("99999999");
  });
});
