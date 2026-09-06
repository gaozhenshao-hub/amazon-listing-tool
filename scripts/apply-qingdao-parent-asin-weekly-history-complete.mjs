import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { opsExternalSyncBatches, users } from "../drizzle/schema/index.ts";
import { applyParentAsinWeeklyMcpBatch } from "../server/domains/ops/lingxingScheduledDrafts.ts";
import { getDb } from "../server/repositories/dbClient.ts";

const START_DATE = "2026-03-01";
const END_DATE = "2026-08-23";
const EXPECTED_COMPLETE_BATCHES = 21;
const applyRequested = process.argv.includes("--apply");

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function number(value) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function scopeStartDate(batch) {
  return String(record(batch.scope).startDate ?? "");
}

function isCompleteWeeklyBatch(batch) {
  const summary = record(batch.summary);
  const failedWindows = Array.isArray(summary.failedStoreDateWindows) ? summary.failedStoreDateWindows.length : 0;
  const expectedStores = number(summary.storesExpected);
  const completedStores = number(summary.storesRead);
  return Boolean(
    !summary.capped
    && number(summary.pageTruncations) === 0
    && failedWindows === 0
    && expectedStores > 0
    && expectedStores === completedStores
    && number(summary.datesRead) === 7
    && number(summary.storeDateWindowsExpected) === number(summary.storeDateWindowsRead),
  );
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const [owner] = await db.select({ id: users.id, defaultWorkspaceId: users.defaultWorkspaceId })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.status, "active")))
    .limit(1);
  if (!owner?.defaultWorkspaceId) throw new Error("未找到可应用父ASIN周报的超级管理员工作空间");

  const candidates = await db.select().from(opsExternalSyncBatches).where(and(
    eq(opsExternalSyncBatches.workspaceId, owner.defaultWorkspaceId),
    eq(opsExternalSyncBatches.dataDomain, "parent_asin_weekly_mcp"),
    eq(opsExternalSyncBatches.status, "ready_for_review"),
  ));
  const complete = candidates
    .filter((batch) => {
      const week = scopeStartDate(batch);
      return week >= START_DATE && week <= END_DATE && isCompleteWeeklyBatch(batch);
    })
    .sort((left, right) => scopeStartDate(left).localeCompare(scopeStartDate(right)) || left.id - right.id);

  const audit = {
    action: applyRequested ? "apply_complete_parent_weekly_backfill" : "dry_run_complete_parent_weekly_backfill",
    dateRange: { startDate: START_DATE, endDate: END_DATE },
    completeBatchCount: complete.length,
    expectedCompleteBatchCount: EXPECTED_COMPLETE_BATCHES,
    candidateWeeks: complete.map((batch) => ({ batchId: batch.id, weekStartDate: scopeStartDate(batch) })),
  };
  if (!applyRequested) {
    console.log(JSON.stringify({ ...audit, writePerformed: false }));
    return;
  }
  if (complete.length !== EXPECTED_COMPLETE_BATCHES) {
    throw new Error(`受治理应用已阻断：完整草稿批次数为${complete.length}，预期为${EXPECTED_COMPLETE_BATCHES}；未执行写入`);
  }

  const results = [];
  for (const batch of complete) {
    const result = await applyParentAsinWeeklyMcpBatch(db, {
      batchId: batch.id,
      workspaceId: owner.defaultWorkspaceId,
      userId: owner.id,
    });
    results.push({ batchId: batch.id, weekStartDate: scopeStartDate(batch), importedRows: result.importedRows, skippedRows: result.skippedRows, idempotent: result.idempotent });
  }
  console.log(JSON.stringify({ ...audit, writePerformed: true, appliedBatchCount: results.length, results }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 0));
