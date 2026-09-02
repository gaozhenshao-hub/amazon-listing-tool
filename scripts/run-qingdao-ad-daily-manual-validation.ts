import { and, eq } from "drizzle-orm";
import { emperorScheduledTasks } from "../drizzle/schema";
import { runLingxingScheduledDraft } from "../server/domains/ops/lingxingScheduledDrafts";
import { getDb } from "../server/repositories/dbClient";

const WORKSPACE_ID = 1;
const DATA_DOMAIN = "ad_keyword";

async function main() {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用，不能运行受治理广告日常验证");

  const [task] = await db.select({
    externalTaskUid: emperorScheduledTasks.externalTaskUid,
    isActive: emperorScheduledTasks.isActive,
    systemManaged: emperorScheduledTasks.systemManaged,
  }).from(emperorScheduledTasks).where(and(
    eq(emperorScheduledTasks.workspaceId, WORKSPACE_ID),
    eq(emperorScheduledTasks.dataDomain, DATA_DOMAIN),
    eq(emperorScheduledTasks.systemManaged, 1),
  )).limit(1);

  if (!task?.externalTaskUid || Number(task.isActive || 0) !== 1) {
    throw new Error("广告关键词正式受治理任务未启用，拒绝手动验证");
  }

  const result = await runLingxingScheduledDraft(task.externalTaskUid);
  console.log(JSON.stringify({
    mode: "user_authorized_manual_validation",
    dataDomain: DATA_DOMAIN,
    result: {
      ok: result.ok,
      runKey: result.runKey,
      skipped: result.skipped ?? null,
    },
  }));
}

void main()
  .catch((error) => {
    console.error(JSON.stringify({
      mode: "user_authorized_manual_validation",
      dataDomain: DATA_DOMAIN,
      error: error instanceof Error ? error.message : String(error),
    }));
    process.exitCode = 1;
  })
  .finally(() => {
    // 这是一次性systemd单元；mysql2 pool结束时可能在空闲连接回调中抛出未捕获异常。
    // 审计输出完成后强制结束进程，不影响正式Web/Worker/Scheduler的共享连接池。
    setTimeout(() => process.exit(process.exitCode ?? 0), 50);
  });
