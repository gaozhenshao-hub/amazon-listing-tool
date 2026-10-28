export const MISSING_REPAIR_KIND = "knowledge.collection.repair";
import { TRPCError } from "@trpc/server";
import { sql } from "drizzle-orm";
import type { DbExecutor } from "../../repositories/dbClient";
type CollectionScope = { workspaceId: number; userId: number; jobId: number };
export async function activeCollectionRepair(
  db: DbExecutor,
  scope: CollectionScope
) {
  const [rows] =
    await db.execute(sql`SELECT runId,status,progress FROM ai_jobs WHERE workspaceId=${scope.workspaceId} AND userId=${scope.userId}
    AND kind=${MISSING_REPAIR_KIND} AND status IN ('queued','running') AND JSON_EXTRACT(input,'$.jobId')=${scope.jobId} ORDER BY id DESC LIMIT 1`);
  return (
    (
      rows as unknown as Array<{
        runId: string;
        status: string;
        progress: number;
      }>
    )[0] ?? null
  );
}
export async function assertNoCollectionRepair(
  db: DbExecutor,
  scope: CollectionScope
) {
  if (await activeCollectionRepair(db, scope))
    throw new TRPCError({
      code: "CONFLICT",
      message: "缺失素材正在补采，请完成后再上传或确认入库",
    });
}
