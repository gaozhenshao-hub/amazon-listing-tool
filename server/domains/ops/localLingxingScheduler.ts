import cron from "node-cron";
import { and, eq, inArray } from "drizzle-orm";
import { emperorScheduledTasks } from "../../../drizzle/schema";
import { getDb } from "../../repositories/dbClient";
import { runLingxingScheduledDraft } from "./lingxingScheduledDrafts";

const LOCAL_LINGXING_SCHEDULER_ENABLED = "LINGXING_LOCAL_SCHEDULER_ENABLED";
const REFRESH_INTERVAL_MS = 60_000;
const supportedDomains = [
  "product_performance_daily",
  "fba_inventory",
  "ad_keyword",
  "parent_asin_weekly_rollup",
] as const;

type SupportedDomain = (typeof supportedDomains)[number];

type LocalScheduledTask = {
  destroy: () => Promise<void> | void;
  getNextRun: () => Date | null;
};

export type LocalLingxingScheduleTask = {
  id: number;
  dataDomain: string | null;
  cronExpr: string;
  externalTaskUid: string | null;
  isActive: number | null;
  systemManaged: number | null;
  triggerMode: string | null;
};

export function isLocalLingxingSchedulerEnabled(value = process.env[LOCAL_LINGXING_SCHEDULER_ENABLED]) {
  return value === "true";
}

/**
 * 领星任务原先使用托管Heartbeat的6段UTC Cron，因此独立站也必须按UTC解释。
 * 仅接受既有的受管任务投影，不从业务配置额外创建调度项。
 */
export function toLocalLingxingScheduleTask(task: LocalLingxingScheduleTask) {
  if (
    Number(task.isActive || 0) !== 1
    || Number(task.systemManaged || 0) !== 1
    || task.triggerMode !== "heartbeat"
    || !task.externalTaskUid
    || !supportedDomains.includes(task.dataDomain as SupportedDomain)
    || !cron.validate(task.cronExpr)
  ) {
    return null;
  }
  return {
    id: task.id,
    dataDomain: task.dataDomain as SupportedDomain,
    cronExpr: task.cronExpr,
    externalTaskUid: task.externalTaskUid,
  };
}

/**
 * node-cron 4.2.1会将六段Cron中受限的星期字段（例如`* * 1`）错误推进到远期年份。
 * 父ASIN周汇总固定为UTC周一，故用受限计时器替代该单一模式；日任务继续使用node-cron。
 */
export function getNextParentWeeklyRunAt(after = new Date()): Date {
  const result = new Date(after.getTime());
  result.setUTCSeconds(0, 0);
  result.setUTCHours(8, 10, 0, 0);
  const daysUntilMonday = (1 - result.getUTCDay() + 7) % 7;
  result.setUTCDate(result.getUTCDate() + daysUntilMonday);
  if (result.getTime() <= after.getTime()) {
    result.setUTCDate(result.getUTCDate() + 7);
  }
  return result;
}

function isDefaultParentWeeklyCron(cronExpr: string) {
  return /^0\s+10\s+8\s+\*\s+\*\s+(?:1|MON)$/i.test(cronExpr.trim());
}

function scheduleParentWeeklyTask(
  run: (scheduledFor: Date) => Promise<void>
): LocalScheduledTask {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let destroyed = false;
  let nextRunAt = getNextParentWeeklyRunAt();

  const scheduleNext = () => {
    if (destroyed) return;
    nextRunAt = getNextParentWeeklyRunAt();
    timer = setTimeout(async () => {
      const scheduledFor = nextRunAt;
      try {
        await run(scheduledFor);
      } finally {
        scheduleNext();
      }
    }, Math.max(0, nextRunAt.getTime() - Date.now()));
  };
  scheduleNext();

  return {
    getNextRun: () => destroyed ? null : nextRunAt,
    destroy: () => {
      destroyed = true;
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

async function persistNextRun(taskId: number, nextRunAt: Date | null) {
  const db = await getDb();
  if (!db) return;
  await db.update(emperorScheduledTasks)
    .set({ nextRunAt })
    .where(eq(emperorScheduledTasks.id, taskId));
}

export function startLocalLingxingScheduleRunner() {
  if (!isLocalLingxingSchedulerEnabled()) {
    console.log(`[LingXingLocalScheduler] disabled; set ${LOCAL_LINGXING_SCHEDULER_ENABLED}=true only on an independent deployment.`);
    return () => undefined;
  }

  let stopped = false;
  const scheduled = new Map<number, { signature: string; task: LocalScheduledTask }>();

  const refresh = async () => {
    const db = await getDb();
    if (!db || stopped) return;
    const rows = await db.select({
      id: emperorScheduledTasks.id,
      dataDomain: emperorScheduledTasks.dataDomain,
      cronExpr: emperorScheduledTasks.cronExpr,
      externalTaskUid: emperorScheduledTasks.externalTaskUid,
      isActive: emperorScheduledTasks.isActive,
      systemManaged: emperorScheduledTasks.systemManaged,
      triggerMode: emperorScheduledTasks.triggerMode,
    }).from(emperorScheduledTasks).where(and(
      eq(emperorScheduledTasks.systemManaged, 1),
      eq(emperorScheduledTasks.triggerMode, "heartbeat"),
      inArray(emperorScheduledTasks.dataDomain, [...supportedDomains]),
    ));
    const current = new Map(rows.map((row) => [row.id, toLocalLingxingScheduleTask(row)]));

    for (const [id, existing] of scheduled.entries()) {
      const next = current.get(id);
      const signature = next ? `${next.cronExpr}|${next.externalTaskUid}` : null;
      if (!signature || signature !== existing.signature) {
        await existing.task.destroy();
        scheduled.delete(id);
      }
    }

    for (const item of current.values()) {
      if (!item || scheduled.has(item.id) || stopped) continue;
      let task: LocalScheduledTask;
      const runTask = async (scheduledFor: Date) => {
        try {
          await runLingxingScheduledDraft(item.externalTaskUid, scheduledFor);
          console.log(`[LingXingLocalScheduler] completed ${item.dataDomain} at ${scheduledFor.toISOString()}`);
        } catch (error) {
          console.error(`[LingXingLocalScheduler] ${item.dataDomain} failed:`, error);
        } finally {
          await persistNextRun(item.id, task.getNextRun()).catch((error) => {
            console.error(`[LingXingLocalScheduler] failed to persist next run for ${item.dataDomain}:`, error);
          });
        }
      };
      task = item.dataDomain === "parent_asin_weekly_rollup" && isDefaultParentWeeklyCron(item.cronExpr)
        ? scheduleParentWeeklyTask(runTask)
        : cron.schedule(item.cronExpr, async (context) => runTask(context.date), { timezone: "UTC", noOverlap: true, name: `lingxing:${item.dataDomain}` });
      scheduled.set(item.id, { signature: `${item.cronExpr}|${item.externalTaskUid}`, task });
      await persistNextRun(item.id, task.getNextRun());
      console.log(`[LingXingLocalScheduler] registered ${item.dataDomain}; next=${task.getNextRun()?.toISOString() || "none"}`);
    }
  };

  void refresh().catch((error) => console.error("[LingXingLocalScheduler] initial refresh failed:", error));
  const refreshTimer = setInterval(() => void refresh().catch((error) => {
    console.error("[LingXingLocalScheduler] refresh failed:", error);
  }), REFRESH_INTERVAL_MS);
  refreshTimer.unref?.();

  return () => {
    stopped = true;
    clearInterval(refreshTimer);
    for (const entry of scheduled.values()) void entry.task.destroy();
    scheduled.clear();
  };
}
