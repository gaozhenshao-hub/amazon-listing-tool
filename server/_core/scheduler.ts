import "dotenv/config";
import { intelScheduler } from "../intelAutoCollect";
import {
  startTodoReminderScheduler,
  stopTodoReminderScheduler,
} from "../todoReminder";
import { createSchedulerLeaderLock } from "./leaderLock";
import { assertStartupConfig } from "./startupValidation";
import { startAiOsOperationalScheduler } from "../domains/ai_os/services/operationalScheduler";

const shutdownGraceMs = Math.min(
  Math.max(Number(process.env.SCHEDULER_SHUTDOWN_GRACE_MS || 10_000), 1_000),
  120_000
);

let stopped = false;
let releaseLock: (() => Promise<void>) | null = null;

async function sleep(ms: number) {
  await new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  process.env.APP_PROCESS_ROLE = process.env.APP_PROCESS_ROLE || "scheduler";
  const report = assertStartupConfig({
    entrypoint: "scheduler",
    role: "scheduler",
  });
  const lock = createSchedulerLeaderLock();
  const lockTimeoutSeconds = Math.min(
    Math.max(
      Number(process.env.SCHEDULER_LEADER_LOCK_TIMEOUT_SECONDS || 10),
      0
    ),
    300
  );
  const result = await lock.acquire(lockTimeoutSeconds);
  if (!result.acquired) {
    console.warn(
      `[Scheduler] Another scheduler owns leader lock ${result.lockName}; exiting without starting timers.`
    );
    await lock.release().catch(() => null);
    return;
  }
  releaseLock = () => lock.release();
  console.log(
    `[Scheduler] started role=${report.role} lock=${result.lockName} owner=${result.ownerId}`
  );

  intelScheduler.start();
  startTodoReminderScheduler();
  const stopAiOsOperationalScheduler = startAiOsOperationalScheduler();

  const stop = async (signal: string) => {
    if (stopped) return;
    stopped = true;
    console.log(`[Scheduler] received ${signal}, stopping timers`);
    try {
      intelScheduler.stop();
      stopTodoReminderScheduler();
      stopAiOsOperationalScheduler();
      await sleep(Math.min(shutdownGraceMs, 5_000));
      await releaseLock?.();
      console.log("[Scheduler] stopped");
    } catch (error) {
      console.error("[Scheduler] graceful shutdown failed:", error);
      process.exitCode = 1;
    }
  };

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

void main().catch(error => {
  console.error("[Scheduler] fatal:", error);
  process.exitCode = 1;
});
