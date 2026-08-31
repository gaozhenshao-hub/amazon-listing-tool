import { describe, expect, it } from "vitest";
import {
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
});
