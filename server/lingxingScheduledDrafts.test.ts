import { describe, expect, it } from "vitest";
import { scheduledDailyScope, scheduledWeeklyScope } from "./domains/ops/lingxingScheduledDrafts";

describe("领星分域定时草稿范围", () => {
  it("每日北京时间17:00对应的任务读取前一天，且生成稳定幂等键", () => {
    const scope = scheduledDailyScope(new Date("2026-08-25T09:00:00.000Z"));
    expect(scope).toEqual({ startDate: "2026-08-24", endDate: "2026-08-24", runKey: "daily:2026-08-24" });
  });

  it("每周一任务只汇总上一自然周已确认日快照", () => {
    const scope = scheduledWeeklyScope(new Date("2026-08-24T09:10:00.000Z"));
    expect(scope).toEqual({ startDate: "2026-08-17", endDate: "2026-08-23", runKey: "weekly:2026-08-17" });
  });
});
