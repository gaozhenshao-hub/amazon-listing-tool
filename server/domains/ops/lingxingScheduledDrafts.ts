import { createHash } from "node:crypto";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { opsAsinDailySnapshots, opsExternalSyncBatches, opsExternalSyncRows, opsLingxingSyncSchedules, users } from "../../../drizzle/schema";
import { lingxingSyncRouter } from "../../routers/lingxingSync";
import { getDb } from "../../repositories/dbClient";
import { summarizeParentAsinWeeks, type DailySnapshot } from "./productOverview/dailyAggregation";

type ScheduleDomain = "product_performance_daily" | "parent_asin_weekly_rollup";

const shanghaiDate = (input = new Date()) => new Date(input.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
};

export function scheduledDailyScope(now = new Date()) {
  const previousDate = addDays(shanghaiDate(now), -1);
  return { startDate: previousDate, endDate: previousDate, runKey: `daily:${previousDate}` };
}

export function scheduledWeeklyScope(now = new Date()) {
  const currentMonday = mondayOf(shanghaiDate(now));
  const startDate = addDays(currentMonday, -7);
  return { startDate, endDate: addDays(currentMonday, -1), runKey: `weekly:${startDate}` };
}

function asDailySnapshot(row: typeof opsAsinDailySnapshots.$inferSelect): DailySnapshot {
  return {
    reportDate: row.reportDate, asin: row.asin, parentAsin: row.parentAsin || row.asin,
    storeName: row.storeName || `SID ${row.sourceStoreId || ""}`, country: row.country || "US", sourceType: row.sourceType,
    salesQty: Number(row.salesQty || 0), orderQty: Number(row.orderQty || 0), salesAmount: Number(row.salesAmount || 0), orderProfit: Number(row.orderProfit || 0),
    adSpend: Number(row.adSpend || 0), adSales: Number(row.adSales || 0), sessionsTotal: Number(row.sessionsTotal || 0),
    adOrders: Number(row.adOrders || 0), organicOrders: Number(row.organicOrders || 0), adClicks: Number(row.adClicks || 0), adImpressions: Number(row.adImpressions || 0), returnQty: Number(row.returnQty || 0),
    fbaAvailable: Number(row.fbaAvailable || row.availableStock || 0), fbaInTransit: Number(row.fbaInTransit || 0), sourceLocalAvailable: Number(row.sourceLocalAvailable || 0),
    title: row.title, productName: row.productName, sku: row.sku || row.msku, operator: row.operator,
  };
}

export async function runLingxingScheduledDraft(taskUid: string, now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const [schedule] = await db.select().from(opsLingxingSyncSchedules)
    .where(and(eq(opsLingxingSyncSchedules.scheduleCronTaskUid, taskUid), eq(opsLingxingSyncSchedules.enabled, 1))).limit(1);
  if (!schedule) return { ok: true, skipped: "orphan_or_paused" as const };
  const domain = schedule.dataDomain as ScheduleDomain;
  const scope = domain === "product_performance_daily" ? scheduledDailyScope(now) : scheduledWeeklyScope(now);
  if (schedule.lastRunKey === scope.runKey && schedule.lastStatus === "succeeded") return { ok: true, skipped: "idempotent" as const, runKey: scope.runKey };

  await db.update(opsLingxingSyncSchedules).set({ lastStatus: "running", lastError: null, lastRunAt: now }).where(eq(opsLingxingSyncSchedules.id, schedule.id));
  try {
    let batchId: number;
    if (domain === "product_performance_daily") {
      const [owner] = await db.select({ id: users.id, role: users.role, organizationId: users.organizationId, defaultWorkspaceId: users.defaultWorkspaceId })
        .from(users).where(eq(users.id, schedule.ownerUserId)).limit(1);
      if (!owner) throw new Error("计划创建者不存在或已删除");
      const caller = lingxingSyncRouter.createCaller({ user: { ...owner, defaultWorkspaceId: schedule.workspaceId } } as any);
      const preview = await caller.createPreview({ dataDomain: "product_performance_daily", scope: { storeId: "ALL_US", marketplace: "US", startDate: scope.startDate, endDate: scope.endDate } });
      batchId = preview.batchId;
    } else {
      const snapshots = await db.select().from(opsAsinDailySnapshots).where(and(
        eq(opsAsinDailySnapshots.workspaceId, schedule.workspaceId),
      ));
      const weekRows = snapshots.filter((row) => row.reportDate >= scope.startDate && row.reportDate <= scope.endDate);
      const parents = summarizeParentAsinWeeks(weekRows.map(asDailySnapshot), 1)
        .map((parent) => ({ ...parent, week: parent.weeks.find((week) => week.weekStartDate === scope.startDate) }))
        .filter((parent) => parent.week);
      const rawResponseHash = createHash("sha256").update(JSON.stringify(parents)).digest("hex");
      const [created] = await db.insert(opsExternalSyncBatches).values({
        workspaceId: schedule.workspaceId, userId: schedule.ownerUserId, source: "internal_rollup", dataDomain: "parent_asin_weekly_rollup", status: parents.length ? "ready_for_review" : "empty",
        scope: { startDate: scope.startDate, endDate: scope.endDate, marketplace: "US", scheduleTaskUid: taskUid },
        rawResponseHash, rawSnapshot: { source: "confirmed_daily_snapshots", rawResponseHash, parentCount: parents.length },
        summary: { totalRead: weekRows.length, parentCount: parents.length, selected: 0, scheduled: true, writePolicy: "draft_only" },
      }).$returningId();
      batchId = created.id;
      for (let offset = 0; offset < parents.length; offset += 250) {
        await db.insert(opsExternalSyncRows).values(parents.slice(offset, offset + 250).map((parent) => ({
          workspaceId: schedule.workspaceId, batchId, entityKey: `${parent.storeName}|${parent.country}|${parent.parentAsin}|${scope.startDate}`,
          rowStatus: "new", selected: 0, sourceData: parent as any, normalizedData: parent as any,
          validationErrors: [], matchInfo: { strategy: "confirmed_daily_parent_asin_weekly_rollup", writePolicy: "draft_only" },
        })) as any);
      }
    }
    await db.update(opsLingxingSyncSchedules).set({ lastRunKey: scope.runKey, lastRunAt: new Date(), lastBatchId: batchId, lastStatus: "succeeded", lastError: null }).where(eq(opsLingxingSyncSchedules.id, schedule.id));
    return { ok: true, batchId, runKey: scope.runKey, writePolicy: "draft_only" as const };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.update(opsLingxingSyncSchedules).set({ lastStatus: "failed", lastError: message.slice(0, 3000), lastRunAt: new Date() }).where(eq(opsLingxingSyncSchedules.id, schedule.id));
    throw error;
  }
}
