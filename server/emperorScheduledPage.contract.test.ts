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

  it("为系统任务提供运营级编辑，并锁定任务UID、数据域和周汇总自动应用", () => {
    expect(page).toContain("编辑领星系统任务");
    expect(page).toContain("保存受治理变更");
    expect(page).toContain("异常倍数阈值");
    expect(page).toContain("始终锁定：数据域、MCP工具白名单、美国店铺范围、任务UID");
    expect(page).toContain('selectedTask?.dataDomain === "parent_asin_weekly_rollup" ? false : systemDraft.autoApply');
    expect(router).toContain("updateSystemTask: adminProcedure");
    expect(router).toContain("父ASIN周汇总仅生成草稿，不允许开启自动应用");
    expect(router).toContain("externalTaskUid: task.externalTaskUid");
  });

  it("限制Cron和异常阈值的输入范围，并同步唯一Heartbeat与领星执行配置", () => {
    expect(router).toContain("Cron必须为6段UTC表达式，秒字段固定为0");
    expect(router).toContain("multiplier: z.number().int().min(2).max(20)");
    expect(router).toContain("absoluteIncrease: z.number().int().min(100).max(10_000)");
    expect(router).toContain("updateHeartbeatJob(task.externalTaskUid, { cron: input.cronExpr");
    expect(router).toContain("cronExpression: input.cronExpr");
    expect(router).toContain('action: "emperor.scheduled_task.update"');
  });

  it("将执行频率和北京时间转换为受治理UTC Cron，并保留高级编辑与周任务频率锁定", () => {
    expect(page).toContain("执行频率");
    expect(page).toContain("执行时间（北京时间）");
    expect(page).toContain("系统自动转换为UTC时间。");
    expect(page).toContain("编辑高级Cron");
    expect(page).toContain("使用可视化设置");
    expect(page).toContain("周汇总固定每周一，不能改为每日。");
    expect(page).toContain("function createUtcCron");
    expect(page).toContain('const utcWeekday = frequency === "weekly" ? (beijingHour < 8 ? "0" : "1") : "*"');
  });
});
