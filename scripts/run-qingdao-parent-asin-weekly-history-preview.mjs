import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { users } from "../drizzle/schema";
import { getDb } from "../server/repositories/dbClient";
import { lingxingSyncRouter } from "../server/routers/lingxingSync";

const DAY_MS = 24 * 60 * 60 * 1000;
const START_DATE = "2026-02-23";
const END_DATE = "2026-08-23";
const INTERVAL_MS = 1_200;

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

export function completeMondaySundayWeeks(startDate = START_DATE, endDate = END_DATE) {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || start > end) {
    throw new Error("历史周范围无效");
  }
  if (start.getUTCDay() !== 1 || end.getUTCDay() !== 0 || isoDate(new Date(start.getTime() + 6 * DAY_MS)) > endDate) {
    throw new Error("历史父ASIN周报仅接受周一开始、周日结束的完整自然周范围");
  }
  const weeks = [];
  for (let current = new Date(start); current <= end; current = new Date(current.getTime() + 7 * DAY_MS)) {
    const weekEnd = new Date(current.getTime() + 6 * DAY_MS);
    weeks.push({ startDate: isoDate(current), endDate: isoDate(weekEnd) });
  }
  return weeks;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const weeks = completeMondaySundayWeeks();
  if (process.argv.includes("--dry-run")) {
    console.log(JSON.stringify({ action: "parent_asin_weekly_history_preview_dry_run", previewOnly: true, weekCount: weeks.length, firstWeek: weeks[0], lastWeek: weeks.at(-1) }));
    return;
  }

  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const [owner] = await db.select({
    id: users.id,
    role: users.role,
    organizationId: users.organizationId,
    defaultWorkspaceId: users.defaultWorkspaceId,
  }).from(users).where(and(eq(users.role, "super_admin"), eq(users.status, "active"))).limit(1);
  if (!owner?.defaultWorkspaceId) throw new Error("未找到可执行历史周报预览的超级管理员工作空间");

  const caller = lingxingSyncRouter.createCaller({ user: owner } );
  const outcomes = [];
  for (const week of weeks) {
    try {
      const preview = await caller.createPreview({
        dataDomain: "parent_asin_weekly_mcp",
        scope: { storeId: "ALL_US", marketplace: "US", ...week },
      });
      outcomes.push({ ...week, result: "preview_created", batchId: preview.batchId, totalRows: preview.totalRows });
    } catch (error) {
      outcomes.push({ ...week, result: "preview_failed", error: error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300) });
    }
    await sleep(INTERVAL_MS);
  }
  const created = outcomes.filter((entry) => entry.result === "preview_created");
  const failed = outcomes.filter((entry) => entry.result === "preview_failed");
  console.log(JSON.stringify({
    action: "parent_asin_weekly_history_preview_complete",
    previewOnly: true,
    writeCalls: 0,
    weekCount: weeks.length,
    previewsCreated: created.length,
    previewsFailed: failed.length,
    outcomes,
  }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(() => setTimeout(() => process.exit(process.exitCode || 0), 0));
