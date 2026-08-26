import { and, eq, gte, lte } from "drizzle-orm";
import { opsAsinDailySnapshots, opsExternalSyncBatches, opsExternalSyncRows, users } from "../drizzle/schema/index.js";
import { getDb } from "../server/repositories/dbClient.js";
import { lingxingSyncRouter } from "../server/routers/lingxingSync.js";
import { validateHistoricalBackfillIntegrity } from "../server/domains/ops/lingxingScheduledDrafts.js";
import { collectCompletedDailyBackfillDates, collectReviewRequiredDailyBackfillDates } from "../server/domains/ops/historicalBackfillCoverage.js";
import { buildHistoricalBackfillTimeoutBatch } from "../server/domains/ops/historicalBackfillTimeout.js";

const workspaceId = 1;
const startDate = "2026-02-26";
const endDate = "2026-08-25";
const addDays = (date, days) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const datesBetween = (start, end) => {
  const dates = [];
  for (let date = start; date <= end; date = addDays(date, 1)) dates.push(date);
  return dates;
};
const withTimeout = (promise, timeoutMs, label) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`历史回补窗口超时：${label}`)), timeoutMs);
  promise.then((value) => {
    clearTimeout(timer);
    resolve(value);
  }, (error) => {
    clearTimeout(timer);
    reject(error);
  });
});

const db = await getDb();
if (!db) throw new Error("数据库不可用");
const [owner] = await db.select({ id: users.id, role: users.role, organizationId: users.organizationId, defaultWorkspaceId: users.defaultWorkspaceId })
  .from(users).where(eq(users.id, 1)).limit(1);
if (!owner) throw new Error("计划所有者不存在");
const historicalBatches = await db.select({ status: opsExternalSyncBatches.status, scope: opsExternalSyncBatches.scope, summary: opsExternalSyncBatches.summary })
  .from(opsExternalSyncBatches).where(and(
    eq(opsExternalSyncBatches.workspaceId, workspaceId),
    eq(opsExternalSyncBatches.dataDomain, "product_performance_daily"),
    eq(opsExternalSyncBatches.source, "lingxing_mcp"),
  ));
const completedDates = collectCompletedDailyBackfillDates(historicalBatches, startDate, endDate);
const reviewRequiredDates = collectReviewRequiredDailyBackfillDates(historicalBatches, startDate, endDate);
const missingDates = datesBetween(startDate, endDate).filter((date) => !completedDates.has(date) && !reviewRequiredDates.has(date));
const maxDays = Number(process.env.BACKFILL_MAX_DAYS || 0);
const targetDates = maxDays > 0 ? missingDates.slice(0, maxDays) : missingDates;
const caller = lingxingSyncRouter.createCaller({ user: { ...owner, defaultWorkspaceId: workspaceId } });
const results = [];
for (const date of targetDates) {
  const scope = { startDate: date, endDate: date };
  let batchId = null;
  let stage = "preview";
  console.info(JSON.stringify({ phase: "starting", scope, completedDates: completedDates.size, reviewRequiredDates: reviewRequiredDates.size }));
  try {
    const preview = await withTimeout(
      caller.createPreview({ dataDomain: "product_performance_daily", scope: { storeId: "ALL_US", marketplace: "US", ...scope } }),
      930_000,
      date,
    );
    batchId = preview.batchId;
    const [batch] = await db.select().from(opsExternalSyncBatches).where(and(eq(opsExternalSyncBatches.id, batchId), eq(opsExternalSyncBatches.workspaceId, workspaceId))).limit(1);
    const rows = await db.select().from(opsExternalSyncRows).where(and(eq(opsExternalSyncRows.batchId, batchId), eq(opsExternalSyncRows.workspaceId, workspaceId)));
    const snapshots = await db.select().from(opsAsinDailySnapshots).where(eq(opsAsinDailySnapshots.workspaceId, workspaceId));
    stage = "validate";
    validateHistoricalBackfillIntegrity(batch, rows, scope, snapshots);
    stage = "confirm";
    await caller.confirm({ batchId, selectedRowIds: rows.map((row) => row.id), note: "用户授权的六个月历史缺失数据自动回补：完整性校验通过" });
    stage = "apply";
    const applied = await caller.applyConfirmedProductInventory({ batchId, note: "用户授权的六个月历史缺失数据自动追加日快照" });
    results.push({ ...scope, batchId, status: "applied", importedRows: applied.importedRows, importId: applied.importId });
    console.info(JSON.stringify({ phase: "applied", ...results.at(-1) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!batchId && message.includes("窗口超时")) {
      const [createdTimeoutBatch] = await db.insert(opsExternalSyncBatches)
        .values(buildHistoricalBackfillTimeoutBatch({ workspaceId, userId: owner.id, date, error: message }))
        .$returningId();
      batchId = createdTimeoutBatch.id;
    }
    results.push({ ...scope, batchId, status: "review_required", error: message });
    console.error(JSON.stringify({ phase: "review_required", ...results.at(-1) }));
    if (message.includes("窗口超时") || stage === "apply") break;
  }
}
console.log(JSON.stringify({ range: { startDate, endDate }, completedDates: completedDates.size, reviewRequiredDates: reviewRequiredDates.size, missingDates: missingDates.length, targetedDates: targetDates.length, chunks: results }, null, 2));
