import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "../server/repositories/dbClient";
import { lingxingSyncRouter } from "../server/routers/lingxingSync";

const scope = {
  storeId: "ALL_US",
  marketplace: "US",
  startDate: "2026-08-24",
  endDate: "2026-08-30",
};

async function main() {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const [owner] = await db.select({
    id: users.id,
    role: users.role,
    organizationId: users.organizationId,
    defaultWorkspaceId: users.defaultWorkspaceId,
  }).from(users).where(and(eq(users.role, "super_admin"), eq(users.status, "active"))).limit(1);
  if (!owner?.defaultWorkspaceId) throw new Error("未找到可执行首次周报预览的超级管理员工作空间");

  const caller = lingxingSyncRouter.createCaller({
    user: { ...owner, defaultWorkspaceId: owner.defaultWorkspaceId },
  } as any);
  const preview = await caller.createPreview({ dataDomain: "parent_asin_weekly_mcp", scope });
  console.log(JSON.stringify({ action: "parent_asin_weekly_mcp_preview", batchId: preview.batchId, totalRows: preview.totalRows, scope }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 0));
