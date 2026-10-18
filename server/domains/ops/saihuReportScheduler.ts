import { getDb } from "../../repositories/dbClient";
import { createTrackedSchedulerWork } from "../../_core/trackedSchedulerWork";
import {
  SaihuReportIdentitySchema,
  SaihuReportUuid,
} from "../../../shared/saihuReportSync";
import { saihuReportScheduleRepository } from "./saihuReportScheduleRepository";
import { saihuReportRows } from "./saihuReportStore";
import { saihuReportFail } from "./saihuReportContract";

type Hint = {
  identity: { userId: number; workspaceId: number };
  planId: string;
};
export function createSaihuReportScheduler(
  deps: {
    repository?: typeof saihuReportScheduleRepository;
    discover?: () => Promise<Hint[]>;
    enabled?: () => boolean;
    intervalMs?: number;
  } = {}
) {
  const repository = deps.repository ?? saihuReportScheduleRepository,
    enabled =
      deps.enabled ??
      (() => process.env.ENABLE_SAIHU_REPORT_SCHEDULER === "true"),
    work = createTrackedSchedulerWork();
  let stopped = false,
    pending: Promise<void> | null = null,
    timer: ReturnType<typeof setInterval> | null = null;
  const discover =
    deps.discover ??
    (async () => {
      const raw = process.env.SAIHU_REPORT_SCHEDULE_WORKSPACE_ID;
      if (!raw || !/^[1-9][0-9]*$/u.test(raw)) return [];
      const ws = Number(raw);
      if (!Number.isSafeInteger(ws)) return [];
      const db = await getDb();
      if (!db) return [];
      const rows = await saihuReportRows(
        db,
        "SELECT workspace_id AS workspaceId,user_id AS userId,plan_id AS planId FROM ops_saihu_report_schedules WHERE workspace_id=? AND status='active' AND next_run_at<=? ORDER BY next_run_at,plan_id LIMIT 21",
        [ws, Date.now()],
        21
      );
      if (rows.length > 20) saihuReportFail("SCHEDULE_DISCOVERY_BUDGET");
      return rows.map(row => ({
        identity: SaihuReportIdentitySchema.parse({
          workspaceId: row.workspaceId,
          userId: row.userId,
        }),
        planId: SaihuReportUuid.parse(row.planId),
      }));
    });
  const tick = async () => {
    if (stopped || !enabled()) return;
    for (const hint of await discover()) {
      if (stopped || !enabled()) break;
      await repository.enqueueDueOccurrence(hint.identity, hint.planId);
    }
  };
  const run = () => {
    if (stopped || !enabled() || pending) return;
    pending = work
      .run(tick)
      .catch(() => undefined)
      .finally(() => {
        pending = null;
      });
  };
  const stop = async () => {
    stopped = true;
    work.stop();
    if (timer) clearInterval(timer);
    timer = null;
    await work.drain();
  };
  return {
    tick,
    start() {
      if (!enabled()) return async () => undefined;
      timer = setInterval(run, deps.intervalMs ?? 15000);
      timer.unref?.();
      run();
      return stop;
    },
    stop,
  };
}
/** Queue-only producer under the existing scheduler leader. It neither calls
 * the provider nor applies reports; the private capture worker remains separate. */
export function startSaihuReportScheduler() {
  return createSaihuReportScheduler().start();
}
