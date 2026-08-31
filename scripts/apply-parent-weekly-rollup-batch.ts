import { and, eq } from "drizzle-orm";
import { opsExternalSyncBatches } from "../drizzle/schema";
import { applyParentAsinWeeklyRollupBatch } from "../server/domains/ops/lingxingScheduledDrafts";
import { requireDb } from "../server/repositories/dbClient";

function positiveInteger(value: string | undefined, label: string) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`${label}必须为正整数`);
  return parsed;
}

async function main() {
  const batchId = positiveInteger(process.argv[2], "batchId");
  const workspaceId = positiveInteger(process.argv[3], "workspaceId");
  const db = await requireDb("父ASIN周汇总批次应用");
  const [batch] = await db.select({ id: opsExternalSyncBatches.id, dataDomain: opsExternalSyncBatches.dataDomain, userId: opsExternalSyncBatches.userId })
    .from(opsExternalSyncBatches)
    .where(and(eq(opsExternalSyncBatches.id, batchId), eq(opsExternalSyncBatches.workspaceId, workspaceId)))
    .limit(1);
  if (!batch || batch.dataDomain !== "parent_asin_weekly_rollup") throw new Error("目标不是当前工作空间的父ASIN周汇总批次");
  const result = await applyParentAsinWeeklyRollupBatch(db, { batchId, workspaceId, userId: batch.userId });
  console.log(JSON.stringify(result));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
