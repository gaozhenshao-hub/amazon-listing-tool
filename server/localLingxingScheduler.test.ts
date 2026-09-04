import { describe, expect, it } from "vitest";
import { getNextParentWeeklyRunAt, toLocalLingxingScheduleTask } from "./domains/ops/localLingxingScheduler";

describe("青岛本机领星Scheduler父ASIN周报任务", () => {
  it("仅接纳启用、受系统管理且具有效Cron的父ASIN周报MCP任务", () => {
    const task = toLocalLingxingScheduleTask({
      id: 9,
      dataDomain: "parent_asin_weekly_mcp",
      cronExpr: "0 10 8 * * 1",
      externalTaskUid: "system.lingxing.parent_asin_weekly_mcp",
      isActive: 1,
      systemManaged: 1,
      triggerMode: "heartbeat",
    });
    expect(task).toMatchObject({ id: 9, dataDomain: "parent_asin_weekly_mcp", cronExpr: "0 10 8 * * 1" });
    expect(toLocalLingxingScheduleTask({ ...task!, dataDomain: "parent_asin_weekly_rollup" })).toBeNull();
    expect(toLocalLingxingScheduleTask({ ...task!, cronExpr: null })).toBeNull();
  });

  it("固定把父ASIN周报安排在下一次UTC周一08:10，即北京时间周一16:10", () => {
    const beforeMonday = new Date("2026-09-06T09:00:00.000Z");
    expect(getNextParentWeeklyRunAt(beforeMonday).toISOString()).toBe("2026-09-07T08:10:00.000Z");
    const afterMondaySlot = new Date("2026-09-07T08:11:00.000Z");
    expect(getNextParentWeeklyRunAt(afterMondaySlot).toISOString()).toBe("2026-09-14T08:10:00.000Z");
  });
});
