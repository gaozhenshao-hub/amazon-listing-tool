/**
 * Bounded parent-ASIN weekly backfill using the existing governed import path.
 * Default: read-only database plan (no MCP request or draft creation).
 * Execute: operator must first quiesce all scheduler/heartbeat invocations; this
 * process additionally acquires the SAME scheduler leader lock, never a new
 * CLI-only lock. It does not stop services, edit configuration or replace facts.
 */
import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { User, InsertLingxingProductWeekly, opsExternalSyncBatches, opsExternalSyncRows, opsLingxingSyncSchedules, emperorScheduledTasks } from "../drizzle/schema";

const DOMAIN = "parent_asin_weekly_mcp";
const SOURCE = "lingxing_mcp_parent_asin_weekly";
type Week = { startDate: string; endDate: string };
type Actor = Pick<User, "id" | "role" | "status" | "defaultWorkspaceId">;
type Batch = Pick<typeof opsExternalSyncBatches.$inferSelect, "id" | "workspaceId" | "userId" | "dataDomain" | "source" | "status" | "scope" | "summary">;
type Row = Pick<typeof opsExternalSyncRows.$inferSelect, "id" | "workspaceId" | "batchId" | "entityKey" | "rowStatus" | "validationErrors" | "normalizedData" | "sourceData">;
export type BackfillOptions = { execute: boolean; schedulerQuiesced: boolean; userId: number; workspaceId: number; weeks: Week[] };
type ApplyResult = { batchId: number; importedRows: number; skippedRows: number; idempotent: boolean };
type Progress = { week: Week; status: string; batchId?: number; importedRows?: number; skippedRows?: number };

export type BackfillDependencies = {
  loadActor: (userId: number) => Promise<Actor | null>;
  acquireSchedulerLock: () => Promise<{ acquired: boolean; lockName: string }>;
  assertLockHeld: () => void;
  releaseSchedulerLock: () => Promise<void>;
  assertNoRunningSchedule: (workspaceId: number) => Promise<void>;
  findAppliedWeek: (workspaceId: number, week: Week) => Promise<{ batchId: number } | null>;
  createPreview: (options: BackfillOptions, week: Week) => Promise<{ batchId: number }>;
  loadBatch: (workspaceId: number, batchId: number) => Promise<{ batch: Batch | null; rows: Row[] }>;
  validateIntegrity: (batch: Batch, rows: Row[], week: Week) => void;
  apply: (options: BackfillOptions, batchId: number) => Promise<ApplyResult>;
  report?: (progress: Progress) => void;
};

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function positiveInteger(value: string | undefined, name: string) {
  if (!value || !/^[1-9]\d*$/u.test(value) || !Number.isSafeInteger(Number(value))) throw new Error(`${name} requires an explicit positive integer`);
  return Number(value);
}

export function parseBackfillOptions(args: string[], now = new Date()): BackfillOptions {
  const { values } = parseArgs({ args, strict: true, allowPositionals: false, options: {
    execute: { type: "boolean", default: false }, preview: { type: "boolean", default: false },
    "scheduler-quiesced": { type: "boolean", default: false },
    "user-id": { type: "string" }, "workspace-id": { type: "string" }, weeks: { type: "string" },
  } });
  if (values.execute && values.preview) throw new Error("Choose --preview or --execute, not both");
  if (values.execute && !values["scheduler-quiesced"]) throw new Error("--execute requires --scheduler-quiesced after the operator has stopped/drained all local and external scheduled invocations");
  const userId = positiveInteger(values["user-id"], "--user-id");
  const workspaceId = positiveInteger(values["workspace-id"], "--workspace-id");
  const starts = (values.weeks || "").split(",").map(value => value.trim());
  if (!starts.length || starts.length > 3 || starts.some(value => !value)) throw new Error("--weeks requires one to three explicit Monday dates, comma-separated");
  if (new Set(starts).size !== starts.length) throw new Error("Duplicate weeks are not allowed");
  const shanghaiToday = new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const weeks = starts.sort().map(startDate => {
    if (!/^\d{4}-\d{2}-\d{2}$/u.test(startDate)) throw new Error("Week dates must use YYYY-MM-DD");
    const date = new Date(`${startDate}T00:00:00Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== startDate || date.getUTCDay() !== 1) throw new Error(`Not a valid Monday: ${startDate}`);
    date.setUTCDate(date.getUTCDate() + 6);
    const endDate = date.toISOString().slice(0, 10);
    if (endDate >= shanghaiToday) throw new Error(`Week is not yet complete in Asia/Shanghai: ${startDate}`);
    return { startDate, endDate };
  });
  return { execute: values.execute, schedulerQuiesced: values["scheduler-quiesced"], userId, workspaceId, weeks };
}

export function assertBackfillOperator(actor: Actor | null, options: BackfillOptions) {
  if (!actor || actor.id !== options.userId || actor.status !== "active" || actor.role !== "super_admin" || actor.defaultWorkspaceId !== options.workspaceId) {
    throw new Error("Operator must be an existing active super_admin whose actual defaultWorkspaceId matches --workspace-id");
  }
}

type Schedule = Pick<typeof opsLingxingSyncSchedules.$inferSelect, "id" | "workspaceId" | "dataDomain" | "enabled" | "autoApply" | "scheduleCronTaskUid" | "lastStatus">;
type Task = Pick<typeof emperorScheduledTasks.$inferSelect, "workspaceId" | "dataDomain" | "systemManaged" | "externalScheduleId" | "externalTaskUid" | "isActive" | "triggerMode" | "inputTemplate" | "lastRunStatus">;
export function assertApprovedWeeklyBackfillSchedule(schedules: Schedule[], tasks: Task[], workspaceId: number) {
  const schedule = schedules[0];
  if (schedules.length !== 1 || !schedule || schedule.workspaceId !== workspaceId || schedule.dataDomain !== DOMAIN
    || schedule.enabled !== 1 || schedule.autoApply !== 1 || !schedule.scheduleCronTaskUid) throw new Error("Expected exactly one already-enabled, auto-apply approved weekly schedule; CLI will not change its governance settings");
  const task = tasks[0];
  if (tasks.length !== 1 || !task || task.workspaceId !== workspaceId || task.dataDomain !== DOMAIN || task.systemManaged !== 1
    || task.externalScheduleId !== schedule.id || task.externalTaskUid !== schedule.scheduleCronTaskUid
    || task.isActive !== 1 || task.triggerMode !== "heartbeat" || ![true, 1].includes(record(task.inputTemplate).autoApply as boolean | number)) throw new Error("Weekly schedule has no unique active auto-apply approved governed task projection");
  if (schedule.lastStatus === "running" || task.lastRunStatus === "running") throw new Error("A weekly scheduled invocation is marked running; drain/inspect it before backfill, do not clear the marker blindly");
}

/** Additional fail-closed boundary; never relax the existing weekly validator. */
function assertWeeklyBatch(batch: Batch | null, rows: Row[], workspaceId: number, week: Week, expectedBatchId: number, status: "applied" | "ready_for_review", userId?: number) {
  if (!batch || batch.id !== expectedBatchId || batch.workspaceId !== workspaceId || (userId !== undefined && batch.userId !== userId)
    || batch.dataDomain !== DOMAIN || batch.source !== "lingxing_mcp" || batch.status !== status) throw new Error("Backfill batch identity, owner, workspace, source or status mismatch");
  const scope = record(batch.scope);
  if (scope.storeId !== "ALL_US" || scope.marketplace !== "US" || scope.startDate !== week.startDate || scope.endDate !== week.endDate) throw new Error("Backfill scope must exactly match the approved ALL_US natural week");
  const summary = record(batch.summary);
  const expected = Number(summary.storesExpected);
  const windows = Number(summary.storeDateWindowsExpected);
  if (!Number.isInteger(expected) || expected < 1 || Number(summary.storesRead) !== expected
    || windows !== expected || Number(summary.storeDateWindowsRead) !== windows || Number(summary.datesRead) !== 7
    || summary.capped || summary.timeoutBeforePreview || summary.applyBlocked || summary.autoApplyBlocked
    || Number(summary.pageTruncations) !== 0 || !Array.isArray(summary.failedStoreDateWindows) || summary.failedStoreDateWindows.length) throw new Error("Backfill requires complete all-store/week/page coverage without blocked or failed windows");
  if (!rows.length || Number(summary.totalRead) !== rows.length || Number(summary.needsReview) !== 0
    || rows.some(row => row.workspaceId !== workspaceId || row.batchId !== expectedBatchId
    || !(status === "applied" ? ["applied"] : ["new", "changed", "unchanged"]).includes(row.rowStatus)
    || !Array.isArray(row.validationErrors) || row.validationErrors.length)) throw new Error("Backfill contains missing, foreign or invalid source rows");
}

export function assertStrictWeeklyBackfillBatch(batch: Batch | null, rows: Row[], options: BackfillOptions, week: Week, expectedBatchId: number) {
  assertWeeklyBatch(batch, rows, options.workspaceId, week, expectedBatchId, "ready_for_review", options.userId);
}

type WeeklyHelpers = Pick<typeof import("../server/domains/ops/lingxingScheduledDrafts"), "validateParentAsinWeeklyMcpAutoApplyIntegrity" | "buildWeeklyRollupFact" | "aggregateParentAsinWeeklyMemberFacts" | "weeklyRollupIdentity" | "weeklyFactsEqual">;

/** Counts alone are insufficient: only skip if every applied source identity
 * and comparable fact still exists, with no duplicate or foreign identities. */
export function verifiedAppliedWeeklyBatch(batch: Batch, rows: Row[], facts: InsertLingxingProductWeekly[], workspaceId: number, week: Week, helpers: WeeklyHelpers) {
  try {
    assertWeeklyBatch(batch, rows, workspaceId, week, batch.id, "applied");
    helpers.validateParentAsinWeeklyMcpAutoApplyIntegrity(batch, rows, week);
    const summary = record(batch.summary);
    if (summary.sourceSchemaVersion !== "lingxing_asin_weekly_source_period_v2") return false;
    const expected = helpers.aggregateParentAsinWeeklyMemberFacts(rows.map(row => ({
      fact: helpers.buildWeeklyRollupFact(record(row.normalizedData), { workspaceId, importId: 0, userId: batch.userId, sourceKind: SOURCE }),
    }))).map(item => item.fact);
    if (!facts.length || expected.length !== facts.length || Number(summary.appliedRows) + Number(summary.skippedRows) !== facts.length) return false;
    if (facts.some(fact => fact.workspaceId !== workspaceId || fact.sourceKind !== SOURCE || fact.weekStartDate !== week.startDate || fact.weekEndDate !== week.endDate)) return false;
    const byIdentity = new Map(facts.map(fact => [helpers.weeklyRollupIdentity(fact), fact]));
    if (byIdentity.size !== facts.length) return false;
    return expected.every(fact => {
      const existing = byIdentity.get(helpers.weeklyRollupIdentity(fact));
      return existing && helpers.weeklyFactsEqual(existing, fact);
    });
  } catch { return false; }
}

export async function runParentWeeklyBackfill(options: BackfillOptions, deps: BackfillDependencies) {
  assertBackfillOperator(await deps.loadActor(options.userId), options);
  if (options.execute && !options.schedulerQuiesced) throw new Error("Schedulers must be explicitly quiesced before execute");
  const outcomes: Progress[] = [];
  let lockAttempted = false;
  try {
    if (options.execute) {
      lockAttempted = true;
      const lock = await deps.acquireSchedulerLock();
      if (!lock.acquired) throw new Error(`Scheduler leader lock is busy (${lock.lockName}); no MCP request or business write performed`);
      deps.assertLockHeld();
      await deps.assertNoRunningSchedule(options.workspaceId);
    }
    for (const week of options.weeks) {
      let batchId: number | undefined;
      try {
        if (options.execute) {
          deps.assertLockHeld();
          assertBackfillOperator(await deps.loadActor(options.userId), options);
          await deps.assertNoRunningSchedule(options.workspaceId);
        }
        const existing = await deps.findAppliedWeek(options.workspaceId, week);
        if (existing) {
          const outcome = { week, status: "already_applied", batchId: existing.batchId };
          outcomes.push(outcome); deps.report?.(outcome); continue;
        }
        if (!options.execute) {
          const outcome = { week, status: "would_read_validate_apply" };
          outcomes.push(outcome); deps.report?.(outcome); continue;
        }
        deps.assertLockHeld();
        const preview = await deps.createPreview(options, week);
        batchId = preview.batchId;
        deps.report?.({ week, status: "preview_created", batchId });
        deps.assertLockHeld();
        const loaded = await deps.loadBatch(options.workspaceId, batchId);
        assertStrictWeeklyBackfillBatch(loaded.batch, loaded.rows, options, week, batchId);
        deps.validateIntegrity(loaded.batch!, loaded.rows, week);
        assertBackfillOperator(await deps.loadActor(options.userId), options);
        await deps.assertNoRunningSchedule(options.workspaceId);
        deps.assertLockHeld();
        const applied = await deps.apply(options, batchId);
        const outcome = { week, status: "applied", batchId, importedRows: applied.importedRows, skippedRows: applied.skippedRows };
        outcomes.push(outcome); deps.report?.(outcome);
      } catch (error) {
        deps.report?.({ week, status: "failed_stopped_no_retry", ...(batchId ? { batchId } : {}) });
        throw error;
      }
    }
    return { mode: options.execute ? "execute" : "preview", workspaceId: options.workspaceId, userId: options.userId, outcomes,
      modelCalls: 0, schedulerConfigurationChanged: false, replacesExistingFacts: false };
  } finally {
    if (lockAttempted) await deps.releaseSchedulerLock();
  }
}

async function runtimeDependencies(): Promise<BackfillDependencies> {
  const [{ and, desc, eq, sql }, schema, { getDb }, { createSchedulerLeaderLock }, weekly, { lingxingSyncRouter }] = await Promise.all([
    import("drizzle-orm"), import("../drizzle/schema"), import("../server/repositories/dbClient"), import("../server/_core/leaderLock"),
    import("../server/domains/ops/lingxingScheduledDrafts"), import("../server/routers/lingxingSync"),
  ]);
  const db = await getDb();
  if (!db) throw new Error("Database unavailable; use the existing runtime environment, never supply secrets in CLI arguments");
  let locked = false;
  let lost = false;
  let actor: (Actor & Pick<User, "organizationId">) | undefined;
  const lock = createSchedulerLeaderLock({ onConnectionLost: () => { lost = true; locked = false; } });
  return {
    async loadActor(userId) {
      [actor] = await db.select({ id: schema.users.id, role: schema.users.role, status: schema.users.status,
        defaultWorkspaceId: schema.users.defaultWorkspaceId, organizationId: schema.users.organizationId,
      }).from(schema.users).where(eq(schema.users.id, userId)).limit(1);
      return actor ?? null;
    },
    async acquireSchedulerLock() { const result = await lock.acquire(0); locked = result.acquired; return result; },
    assertLockHeld() { if (!locked || lost) throw new Error("Scheduler leader lock lost; refusing further backfill operations"); },
    async releaseSchedulerLock() { locked = false; await lock.release(); },
    async assertNoRunningSchedule(workspaceId) {
      const schedules = await db.select().from(schema.opsLingxingSyncSchedules).where(and(
        eq(schema.opsLingxingSyncSchedules.workspaceId, workspaceId), eq(schema.opsLingxingSyncSchedules.dataDomain, DOMAIN),
      ));
      const schedule = schedules[0];
      const tasks = !schedule?.scheduleCronTaskUid ? [] : await db.select().from(schema.emperorScheduledTasks).where(and(
        eq(schema.emperorScheduledTasks.workspaceId, workspaceId), eq(schema.emperorScheduledTasks.dataDomain, DOMAIN),
        eq(schema.emperorScheduledTasks.systemManaged, 1), eq(schema.emperorScheduledTasks.externalScheduleId, schedule.id),
        eq(schema.emperorScheduledTasks.externalTaskUid, schedule.scheduleCronTaskUid),
      ));
      assertApprovedWeeklyBackfillSchedule(schedules, tasks, workspaceId);
    },
    async findAppliedWeek(workspaceId, week) {
      const batches = await db.select({ id: schema.opsExternalSyncBatches.id, workspaceId: schema.opsExternalSyncBatches.workspaceId, userId: schema.opsExternalSyncBatches.userId,
        dataDomain: schema.opsExternalSyncBatches.dataDomain, source: schema.opsExternalSyncBatches.source, status: schema.opsExternalSyncBatches.status,
        scope: schema.opsExternalSyncBatches.scope, summary: schema.opsExternalSyncBatches.summary }).from(schema.opsExternalSyncBatches).where(and(
        eq(schema.opsExternalSyncBatches.workspaceId, workspaceId), eq(schema.opsExternalSyncBatches.dataDomain, DOMAIN), eq(schema.opsExternalSyncBatches.source, "lingxing_mcp"), eq(schema.opsExternalSyncBatches.status, "applied"),
        sql`JSON_UNQUOTE(JSON_EXTRACT(${schema.opsExternalSyncBatches.scope}, '$.storeId')) = 'ALL_US'`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${schema.opsExternalSyncBatches.scope}, '$.marketplace')) = 'US'`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${schema.opsExternalSyncBatches.scope}, '$.startDate')) = ${week.startDate}`,
        sql`JSON_UNQUOTE(JSON_EXTRACT(${schema.opsExternalSyncBatches.scope}, '$.endDate')) = ${week.endDate}`,
      )).orderBy(desc(schema.opsExternalSyncBatches.id));
      if (!batches.length) return null;
      const facts = await db.select().from(schema.lingxingProductWeekly).where(and(
        eq(schema.lingxingProductWeekly.workspaceId, workspaceId), eq(schema.lingxingProductWeekly.sourceKind, SOURCE),
        eq(schema.lingxingProductWeekly.weekStartDate, week.startDate), eq(schema.lingxingProductWeekly.weekEndDate, week.endDate),
      ));
      for (const batch of batches) {
        const rows = await db.select().from(schema.opsExternalSyncRows).where(and(eq(schema.opsExternalSyncRows.workspaceId, workspaceId), eq(schema.opsExternalSyncRows.batchId, batch.id)));
        if (verifiedAppliedWeeklyBatch(batch, rows, facts, workspaceId, week, weekly)) return { batchId: batch.id };
      }
      return null;
    },
    async createPreview(options, week) {
      assertBackfillOperator(actor ?? null, options);
      const requestId = `parent_weekly_backfill_${options.workspaceId}_${week.startDate}_${Date.now()}`;
      const caller = lingxingSyncRouter.createCaller({ user: actor, workspaceId: options.workspaceId, requestId,
        req: { headers: {}, ip: "local-cli", get: () => undefined }, res: { locals: { requestId } },
      } as unknown as import("../server/_core/context").TrpcContext);
      return caller.createPreview({ dataDomain: DOMAIN, scope: { storeId: "ALL_US", marketplace: "US", ...week } });
    },
    async loadBatch(workspaceId, batchId) {
      const [batch] = await db.select().from(schema.opsExternalSyncBatches).where(and(eq(schema.opsExternalSyncBatches.workspaceId, workspaceId), eq(schema.opsExternalSyncBatches.id, batchId))).limit(1);
      const rows = await db.select().from(schema.opsExternalSyncRows).where(and(eq(schema.opsExternalSyncRows.workspaceId, workspaceId), eq(schema.opsExternalSyncRows.batchId, batchId)));
      return { batch: batch ?? null, rows };
    },
    validateIntegrity: weekly.validateParentAsinWeeklyMcpAutoApplyIntegrity,
    apply: (options, batchId) => weekly.applyParentAsinWeeklyMcpBatch(db, { batchId, workspaceId: options.workspaceId, userId: options.userId }),
    report: progress => console.log(JSON.stringify({ operation: "parent_weekly_backfill", ...progress })),
  };
}

async function main() {
  const options = parseBackfillOptions(process.argv.slice(2));
  try {
    const result = await runParentWeeklyBackfill(options, await runtimeDependencies());
    console.log(JSON.stringify(result));
  } finally {
    const { closeDbConnection } = await import("../server/repositories/dbClient");
    await closeDbConnection();
  }
}

const isEntry = process.argv[1] && realpathSync(resolve(process.argv[1])) === fileURLToPath(import.meta.url);
if (isEntry) void main().catch(error => {
  console.error(JSON.stringify({ operation: "parent_weekly_backfill", status: "failed", automaticRetry: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
