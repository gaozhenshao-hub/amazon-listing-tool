import "dotenv/config";
import { and, asc, eq } from "drizzle-orm";
import { opsExternalSyncBatches, opsExternalSyncRows, users } from "../drizzle/schema/index.ts";
import {
  buildWeeklyRollupFact,
  rawMarketplaceFromWeeklySyncRow,
  weeklyRollupIdentity,
} from "../server/domains/ops/lingxingScheduledDrafts.ts";
import { getDb } from "../server/repositories/dbClient.ts";

const START_DATE = "2026-03-01";
const END_DATE = "2026-08-23";

const record = (input) => input && typeof input === "object" && !Array.isArray(input) ? input : {};
const text = (input) => input === null || input === undefined ? "" : String(input).trim();

function rawCountryBucket(row) {
  const normalized = record(row.normalizedData);
  const rawCountry = text(rawMarketplaceFromWeeklySyncRow(row) || "US").toUpperCase();
  const normalizedCountry = text(normalized.country || "US").toUpperCase();
  if (rawCountry === normalizedCountry) return "canonical_or_unavailable";
  return "raw_alias_differs_from_normalized";
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const [owner] = await db.select({ id: users.id, defaultWorkspaceId: users.defaultWorkspaceId })
    .from(users)
    .where(and(eq(users.role, "super_admin"), eq(users.status, "active")))
    .limit(1);
  if (!owner?.defaultWorkspaceId) throw new Error("未找到超级管理员工作空间");

  const batches = await db.select().from(opsExternalSyncBatches).where(and(
    eq(opsExternalSyncBatches.workspaceId, owner.defaultWorkspaceId),
    eq(opsExternalSyncBatches.dataDomain, "parent_asin_weekly_mcp"),
    eq(opsExternalSyncBatches.status, "ready_for_review"),
  )).orderBy(asc(opsExternalSyncBatches.id));
  const batch = batches.find((candidate) => {
    const scope = record(candidate.scope);
    const week = text(scope.startDate);
    return week >= START_DATE && week <= END_DATE;
  });
  if (!batch) throw new Error("未找到待应用父ASIN周报批次");

  const rows = await db.select().from(opsExternalSyncRows).where(and(
    eq(opsExternalSyncRows.workspaceId, owner.defaultWorkspaceId),
    eq(opsExternalSyncRows.batchId, batch.id),
  ));
  const byIdentity = new Map();
  for (const row of rows) {
    const fact = buildWeeklyRollupFact(record(row.normalizedData), {
      workspaceId: owner.defaultWorkspaceId,
      importId: 0,
      userId: owner.id,
      sourceKind: "lingxing_mcp_parent_asin_weekly",
      sourceBatchId: batch.id,
    });
    const identity = weeklyRollupIdentity(fact);
    const bucket = byIdentity.get(identity) || [];
    bucket.push({ rawCountryBucket: rawCountryBucket(row), hasValidationErrors: Array.isArray(row.validationErrors) && row.validationErrors.length > 0 });
    byIdentity.set(identity, bucket);
  }
  const duplicated = [...byIdentity.values()].filter((bucket) => bucket.length > 1);
  const diagnostic = {
    action: "audit_parent_weekly_duplicate_identities",
    batchId: batch.id,
    rowCount: rows.length,
    normalizedIdentityCount: byIdentity.size,
    duplicateIdentityGroupCount: duplicated.length,
    duplicateCandidateRowCount: duplicated.reduce((total, bucket) => total + bucket.length, 0),
    duplicateGroupsWithRawAliasEvidence: duplicated.filter((bucket) => new Set(bucket.map((item) => item.rawCountryBucket)).size > 1).length,
    duplicateGroupsCanonicalOnly: duplicated.filter((bucket) => bucket.every((item) => item.rawCountryBucket === "canonical_or_unavailable")).length,
    duplicateGroupsWithValidationErrors: duplicated.filter((bucket) => bucket.some((item) => item.hasValidationErrors)).length,
    writePerformed: false,
  };
  console.log(JSON.stringify(diagnostic));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 0));
