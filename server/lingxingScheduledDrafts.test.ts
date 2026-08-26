import { describe, expect, it } from "vitest";
import { scheduledDailyScope, scheduledWeeklyScope, weeklyCoverageExceptionSummary } from "./domains/ops/lingxingScheduledDrafts";

describe("领星分域定时草稿范围", () => {
  it("每日北京时间17:00对应的任务读取前一天，且生成稳定幂等键", () => {
    const scope = scheduledDailyScope(new Date("2026-08-25T09:00:00.000Z"));
    expect(scope).toEqual({ startDate: "2026-08-24", endDate: "2026-08-24", runKey: "daily:2026-08-24" });
  });

  it("每周一任务只汇总上一自然周已确认日快照", () => {
    const scope = scheduledWeeklyScope(new Date("2026-08-24T09:10:00.000Z"));
    expect(scope).toEqual({ startDate: "2026-08-17", endDate: "2026-08-23", runKey: "weekly:2026-08-17" });
  });

  it("周汇总对缺失的确认日快照生成明确人工审阅摘要", () => {
    const summary = weeklyCoverageExceptionSummary([{ reportDate: "2026-08-17" }, { reportDate: "2026-08-19" }] as any, "2026-08-17", "2026-08-23");
    expect(summary).toMatchObject({ isIncomplete: true, missingDates: ["2026-08-18", "2026-08-20", "2026-08-21", "2026-08-22", "2026-08-23"] });
    expect(summary.message).toContain("仅供人工审阅");
  });

  it("周汇总区分空周、全零指标和无法核验上游截断状态的追溯缺口", () => {
    const empty = weeklyCoverageExceptionSummary([], "2026-08-17", "2026-08-23");
    expect(empty.exceptionTypes).toEqual(expect.arrayContaining(["missing_daily_coverage", "empty_week"]));
    const unverified = weeklyCoverageExceptionSummary([{ reportDate: "2026-08-17", salesQty: 0, orderQty: 0, salesAmount: 0, sessionsTotal: 0, sourceBatchHash: null }] as any, "2026-08-17", "2026-08-17");
    expect(unverified.exceptionTypes).toEqual(expect.arrayContaining(["all_zero_metrics", "upstream_lineage_unverified"]));
  });
});
