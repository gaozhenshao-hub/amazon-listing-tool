import "dotenv/config";
import { intelScheduler } from "../intelAutoCollect";
import {
  startTodoReminderScheduler,
  stopTodoReminderScheduler,
} from "../todoReminder";
import { createSchedulerLeaderLock } from "./leaderLock";
import { closeDbConnection } from "../repositories/dbClient";
import { assertStartupConfig } from "./startupValidation";
import { startAiOsOperationalScheduler } from "../domains/ai_os/services/operationalScheduler";
import { startLocalLingxingScheduleRunner } from "../domains/ops/localLingxingScheduler";
import { startSaihuReportScheduler } from "../domains/ops/saihuReportScheduler";
import { createSchedulerShutdown } from "./schedulerShutdown";

const shutdownGraceMs = Math.min(
  Math.max(Number(process.env.SCHEDULER_SHUTDOWN_GRACE_MS || 10_000), 1_000),
  120_000
);

let stopScheduler: ((signal: string) => Promise<void>) | null = null;
let leaderLost = false;

async function main() {
  process.env.APP_PROCESS_ROLE = process.env.APP_PROCESS_ROLE || "scheduler";
  const report = assertStartupConfig({
    entrypoint: "scheduler",
    role: "scheduler",
  });
  const lock = createSchedulerLeaderLock({
    onConnectionLost: () => {
      leaderLost = true;
      process.exitCode = 1;
      console.error("[Scheduler] leader ownership lost; stopping new triggers and draining accepted work without claiming the lock is still held.");
      void stopScheduler?.("leader_lock_lost");
    },
  });
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
  console.log(
    `[Scheduler] started role=${report.role} lock=${result.lockName} owner=${result.ownerId}`
  );

  const stops: Array<() => void | Promise<void>> = [() => intelScheduler.stop(), stopTodoReminderScheduler];
  const shutdown = createSchedulerShutdown({
    stops,
    graceMs: shutdownGraceMs,
    releaseLock: () => lock.release(),
    closeDatabase: closeDbConnection,
    onDeadline: lost => {
      process.exitCode = 1;
      console.error(`[Scheduler] shutdown deadline ${shutdownGraceMs}ms exceeded: NOT DRAINED; shared DB remains open; ${lost ? "leader ownership already lost" : "leader lock has not been released"}. Waiting for accepted work; no automatic retry.`);
    },
    onDrained: lost => {
      console.log(lost ? "[Scheduler] accepted work drained after leader loss; no lock ownership claimed" : "[Scheduler] stopped after verified drain");
      // Only now is a failed-leader restart safe for these tracked handlers.
      if (lost) setImmediate(() => process.exit(1));
    },
  });
  const stop = async (signal: string) => {
    console.log(`[Scheduler] received ${signal}, closing new triggers and awaiting actual work`);
    await shutdown(leaderLost ? "leader_lock_lost" : signal).catch(error => {
      console.error("[Scheduler] shutdown NOT VERIFIED; lock/database cleanup not declared complete:", error);
      process.exitCode = 1;
    });
  };
  stopScheduler = stop;

  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
  try {
    if (leaderLost) { await stop("leader_lock_lost"); return; }
    intelScheduler.start();
    startTodoReminderScheduler();
    stops.push(startAiOsOperationalScheduler());
    stops.push(startLocalLingxingScheduleRunner());
    stops.push(startSaihuReportScheduler());
  } catch (error) {
    await stop("startup_failure");
    throw error;
  }
}

void main().catch(error => {
  console.error("[Scheduler] fatal:", error);
  process.exitCode = 1;
});
