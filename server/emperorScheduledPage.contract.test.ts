import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = readFileSync(resolve(process.cwd(), "client/src/pages/emperor/EmperorScheduled.tsx"), "utf8");
const router = readFileSync(resolve(process.cwd(), "server/domains/ai_os/routers/scheduled.ts"), "utf8");

describe("皇帝定时任务与领星计划统一管理契约", () => {
  it("在皇帝定时任务中心识别领星系统任务并展示受治理说明", () => {
    expect(page).toContain("领星 MCP · 系统任务");
    expect(page).toContain("皇帝受治理同步任务");
    expect(page).toContain("任务UID：");
    expect(page).toContain("查看同步审计");
  });

  it("系统任务暂停恢复使用专用接口，且不提供删除入口", () => {
    expect(page).toContain("setSystemTaskEnabledMutation.mutate");
    expect(page).toContain("isSystemTask(selectedTask) ? (");
    expect(page).toContain("领星系统任务已暂停");
    expect(router).toContain("setSystemTaskEnabled: adminProcedure");
    expect(router).toContain("updateHeartbeatJob(task.externalTaskUid");
    expect(router).toContain("受系统管理的领星任务不可删除");
  });

  it("系统任务从映射表读取并禁止伪造即时触发", () => {
    expect(router).toContain("LEFT JOIN ops_lingxing_sync_schedules");
    expect(router).toContain("systemManaged=1");
    expect(router).toContain("领星同步仅可按受治理计划触发");
  });
});
