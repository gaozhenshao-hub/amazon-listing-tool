import { and, desc, eq } from "drizzle-orm";
import { opsExternalSyncBatches, users } from "../drizzle/schema";
import { lingxingSyncRouter } from "../server/routers/lingxingSync";
import { getDb } from "../server/repositories/dbClient";

const WORKSPACE_ID = 1;
const DATA_DOMAIN = "ad_keyword";
const REPORT_DATE = "2026-09-01";

function failedProfileId(summary: unknown) {
  const record = summary && typeof summary === "object" && !Array.isArray(summary) ? summary as Record<string, unknown> : {};
  const failedWindows = Array.isArray(record.failedStoreDateWindows) ? record.failedStoreDateWindows : [];
  const first = failedWindows[0] && typeof failedWindows[0] === "object" ? failedWindows[0] as Record<string, unknown> : {};
  const profileId = String(first.sid || "").trim();
  if (!profileId) throw new Error("最新待复核广告批次未包含可探测的Profile标识");
  return profileId;
}

async function main() {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，不能执行只读Schema探测");
  const [batch] = await db.select({ summary: opsExternalSyncBatches.summary }).from(opsExternalSyncBatches).where(and(
    eq(opsExternalSyncBatches.workspaceId, WORKSPACE_ID),
    eq(opsExternalSyncBatches.dataDomain, DATA_DOMAIN),
    eq(opsExternalSyncBatches.status, "ready_for_review"),
  )).orderBy(desc(opsExternalSyncBatches.id)).limit(1);
  const profileId = failedProfileId(batch?.summary);
  const [actor] = await db.select().from(users).where(and(
    eq(users.role, "super_admin"),
    eq(users.defaultWorkspaceId, WORKSPACE_ID),
  )).limit(1);
  if (!actor) throw new Error("未找到工作空间超级管理员，拒绝执行只读Schema探测");

  const caller = lingxingSyncRouter.createCaller({ user: { ...actor, defaultWorkspaceId: WORKSPACE_ID } } as any);
  const preview = await caller.createPreview({
    dataDomain: DATA_DOMAIN,
    scope: { storeId: profileId, profileId, marketplace: "US", startDate: REPORT_DATE, endDate: REPORT_DATE },
  });

  console.log(JSON.stringify({
    mode: "user_authorized_schema_probe",
    dataDomain: DATA_DOMAIN,
    reportDate: REPORT_DATE,
    result: { batchId: preview.batchId, totalRows: preview.totalRows, needsReview: preview.needsReview },
    writePolicy: "preview_only_no_confirm_no_apply",
  }));
}

void main()
  .catch((error) => {
    console.error(JSON.stringify({
      mode: "user_authorized_schema_probe",
      dataDomain: DATA_DOMAIN,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  })
  .finally(() => {
    // 一次性只读探测在审计输出后退出，避免mysql2 pool关闭回调误报执行失败。
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });
