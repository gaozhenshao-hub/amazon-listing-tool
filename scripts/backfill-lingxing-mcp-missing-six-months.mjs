import { and, eq, gte, lte } from "drizzle-orm";
import { opsAsinDailySnapshots, opsExternalSyncBatches, opsExternalSyncRows, users } from "../drizzle/schema/index.js";
import { getDb } from "../server/repositories/dbClient.js";
import { lingxingSyncRouter } from "../server/routers/lingxingSync.js";
import { validateHistoricalBackfillIntegrity } from "../server/domains/ops/lingxingScheduledDrafts.js";

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
const existing = await db.select().from(opsAsinDailySnapshots).where(and(
  eq(opsAsinDailySnapshots.workspaceId, workspaceId),
  eq(opsAsinDailySnapshots.sourceType, "lingxing_mcp"),
  gte(opsAsinDailySnapshots.reportDate, startDate),
  lte(opsAsinDailySnapshots.reportDate, endDate),
));
const existingStores = new Set(existing.map((row) => String(row.sourceStoreId || "")).filter(Boolean));
const expectedStoreCount = existingStores.size || 8;
const coverageByDate = new Map();
for (const row of existing) {
  const date = row.reportDate;
  const stores = coverageByDate.get(date) || new Set();
  if (row.sourceStoreId) stores.add(String(row.sourceStoreId));
  coverageByDate.set(date, stores);
}
const missingDates = datesBetween(startDate, endDate).filter((date) => (coverageByDate.get(date)?.size || 0) < expectedStoreCount);
const maxDays = Number(process.env.BACKFILL_MAX_DAYS || 0);
const targetDates = maxDays > 0 ? missingDates.slice(0, maxDays) : missingDates;
const caller = lingxingSyncRouter.createCaller({ user: { ...owner, defaultWorkspaceId: workspaceId } });
const results = [];
for (const date of targetDates) {
  const scope = { startDate: date, endDate: date };
  let batchId = null;
  console.info(JSON.stringify({ phase: "starting", scope, expectedStoreCount }));
  try {
    const preview = await withTimeout(
      caller.createPreview({ dataDomain: "product_performance_daily", scope: { storeId: "ALL_US", marketplace: "US", ...scope } }),
      150_000,
      date,
    );
    batchId = preview.batchId;
    const [batch] = await db.select().from(opsExternalSyncBatches).where(and(eq(opsExternalSyncBatches.id, batchId), eq(opsExternalSyncBatches.workspaceId, workspaceId))).limit(1);
    const rows = await db.select().from(opsExternalSyncRows).where(and(eq(opsExternalSyncRows.batchId, batchId), eq(opsExternalSyncRows.workspaceId, workspaceId)));
    const snapshots = await db.select().from(opsAsinDailySnapshots).where(eq(opsAsinDailySnapshots.workspaceId, workspaceId));
    validateHistoricalBackfillIntegrity(batch, rows, scope, snapshots);
    await caller.confirm({ batchId, selectedRowIds: rows.map((row) => row.id), note: "用户授权的六个月历史缺失数据自动回补：完整性校验通过" });
    const applied = await caller.applyConfirmedProductInventory({ batchId, note: "用户授权的六个月历史缺失数据自动追加日快照" });
    results.push({ ...scope, batchId, status: "applied", importedRows: applied.importedRows, importId: applied.importId });
    console.info(JSON.stringify({ phase: "applied", ...results.at(-1) }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    results.push({ ...scope, batchId, status: "review_required", error: message });
    console.error(JSON.stringify({ phase: "review_required", ...results.at(-1) }));
    if (message.includes("窗口超时")) {
      console.log(JSON.stringify({ range: { startDate, endDate }, expectedStoreCount, missingDates: missingDates.length, targetedDates: targetDates.length, chunks: results }, null, 2));
      process.exit(1);
    }
  }
}
console.log(JSON.stringify({ range: { startDate, endDate }, expectedStoreCount, missingDates: missingDates.length, targetedDates: targetDates.length, chunks: results }, null, 2));
