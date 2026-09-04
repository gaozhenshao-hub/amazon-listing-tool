import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { applyParentAsinWeeklyMcpBatch } from "../server/domains/ops/lingxingScheduledDrafts";
import { getDb } from "../server/repositories/dbClient";

const batchId = 90576;

async function main() {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const [owner] = await db.select({
    id: users.id,
    defaultWorkspaceId: users.defaultWorkspaceId,
  }).from(users).where(and(eq(users.role, "super_admin"), eq(users.status, "active"))).limit(1);
  if (!owner?.defaultWorkspaceId) throw new Error("未找到可应用父ASIN周报的超级管理员工作空间");

  const result = await applyParentAsinWeeklyMcpBatch(db, {
    batchId,
    workspaceId: owner.defaultWorkspaceId,
    userId: owner.id,
  });
  console.log(JSON.stringify({ action: "parent_asin_weekly_mcp_apply", ...result }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 0));
