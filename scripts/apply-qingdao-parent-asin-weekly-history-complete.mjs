import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { opsExternalSyncBatches, users } from "../drizzle/schema/index.ts";
import { applyParentAsinWeeklyMcpBatch } from "../server/domains/ops/lingxingScheduledDrafts.ts";
import { getDb } from "../server/repositories/dbClient.ts";

const START_DATE = "2026-02-23";
const END_DATE = "2026-08-23";
const applyRequested = process.argv.includes("--apply");
const approvedWeekStarts = String(process.env.APPROVED_PARENT_WEEK_STARTS || "").split(",").map((value) => value.trim()).filter(Boolean);

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

function scopeEndDate(batch) {
  return String(record(batch.scope).endDate ?? "");
}

function isMondaySundayNaturalWeek(batch) {
  const startDate = scopeStartDate(batch);
  const endDate = scopeEndDate(batch);
  const start = new Date(`${startDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || start.getUTCDay() !== 1) return false;
  start.setUTCDate(start.getUTCDate() + 6);
  return start.toISOString().slice(0, 10) === endDate;
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
      return week >= START_DATE && week <= END_DATE && isMondaySundayNaturalWeek(batch) && isCompleteWeeklyBatch(batch);
    })
    .sort((left, right) => scopeStartDate(left).localeCompare(scopeStartDate(right)) || left.id - right.id);

  const audit = {
    action: applyRequested ? "apply_complete_parent_weekly_backfill" : "dry_run_complete_parent_weekly_backfill",
    dateRange: { startDate: START_DATE, endDate: END_DATE },
    completeBatchCount: complete.length,
    approvedWeekCount: approvedWeekStarts.length,
    candidateWeeks: complete.map((batch) => ({ batchId: batch.id, weekStartDate: scopeStartDate(batch) })),
  };
  if (!applyRequested) {
    console.log(JSON.stringify({ ...audit, writePerformed: false }));
    return;
  }
  if (!approvedWeekStarts.length) {
    throw new Error("受治理应用已阻断：未提供经用户确认的APPROVED_PARENT_WEEK_STARTS精确周清单；未执行写入");
  }
  const candidateWeekStarts = complete.map(scopeStartDate);
  const approvedUnique = [...new Set(approvedWeekStarts)].sort();
  if (JSON.stringify(candidateWeekStarts) !== JSON.stringify(approvedUnique)) {
    throw new Error(`受治理应用已阻断：完整草稿周集合与经用户确认的精确周清单不一致；未执行写入`);
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
