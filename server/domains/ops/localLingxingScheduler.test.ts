import { describe, expect, it } from "vitest";
import {
  getNextParentWeeklyRunAt,
  isLocalLingxingSchedulerEnabled,
  toLocalLingxingScheduleTask,
} from "./localLingxingScheduler";

const validTask = {
  id: 1,
  dataDomain: "product_performance_daily",
  cronExpr: "0 0 8 * * *",
  externalTaskUid: "task-uid",
  isActive: 1,
  systemManaged: 1,
  triggerMode: "heartbeat",
};

describe("独立站领星本机调度器", () => {
  it("只在明确启用时启动，避免托管环境重复触发", () => {
    expect(isLocalLingxingSchedulerEnabled("true")).toBe(true);
    expect(isLocalLingxingSchedulerEnabled("false")).toBe(false);
    expect(isLocalLingxingSchedulerEnabled(undefined)).toBe(false);
  });

  it("仅复用启用的受管领星Heartbeat任务", () => {
    expect(toLocalLingxingScheduleTask(validTask)).toMatchObject({
      dataDomain: "product_performance_daily",
      cronExpr: "0 0 8 * * *",
    });
    expect(toLocalLingxingScheduleTask({ ...validTask, triggerMode: "internal" })).toBeNull();
    expect(toLocalLingxingScheduleTask({ ...validTask, systemManaged: 0 })).toBeNull();
    expect(toLocalLingxingScheduleTask({ ...validTask, isActive: 0 })).toBeNull();
    expect(toLocalLingxingScheduleTask({ ...validTask, cronExpr: "invalid" })).toBeNull();
  });

  it("将每周一的父ASIN汇总投影到下一自然周，而不是远期年份", () => {
    expect(getNextParentWeeklyRunAt(new Date("2026-08-31T12:59:00.000Z")).toISOString())
      .toBe("2026-09-07T08:10:00.000Z");
    expect(getNextParentWeeklyRunAt(new Date("2026-08-31T08:10:00.000Z")).toISOString())
      .toBe("2026-09-07T08:10:00.000Z");
  });
});
