import { and, eq, inArray } from "drizzle-orm";
import {
  adKeywordWeekly,
  emperorScheduledTasks,
  lingxingProductWeekly,
  opsAsinDailySnapshots,
  opsExternalSyncBatches,
  opsExternalSyncRows,
  users,
} from "../drizzle/schema";
import {
  validateDailyAutoApplyIntegrity,
  validateInventoryAutoApplyIntegrity,
  validateKeywordAutoApplyIntegrity,
  runLingxingScheduledDraft,
} from "../server/domains/ops/lingxingScheduledDrafts";
import { lingxingSyncRouter } from "../server/routers/lingxingSync";
import { getDb } from "../server/repositories/dbClient";

const workspaceId = 1;
const firstDailyDate = "2026-02-26";
const firstAdDate = "2026-04-13";
const lastTargetDate = "2026-08-30";
const lastWeeklyEnd = "2026-08-23";
const domains = [
  "product_performance_daily",
  "fba_inventory",
  "ad_keyword",
  "parent_asin_weekly_rollup",
] as const;

type Domain = (typeof domains)[number];
type Plan = { dailyDates: string[]; adDates: string[]; weeklyEnds: string[]; inventoryDate: string };
type AdProfile = { profileId: string; sid: string; name: string; country: string };
type BackfillWorkDomain = Domain;

const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const dateRange = (start: string, end: string) => {
  const output: string[] = [];
  for (let date = start; date <= end; date = addDays(date, 1)) output.push(date);
  return output;
};
const asDate = (value: unknown) => String(value || "").slice(0, 10);
const pause = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function buildPlan(): Promise<{ plan: Plan; taskUids: Record<Domain, string> }> {
  const db = await getDb();
  if (!db) throw new Error("补读计划无法建立：数据库不可用");
  const scheduledTasks = await db.select({
    dataDomain: emperorScheduledTasks.dataDomain,
    externalTaskUid: emperorScheduledTasks.externalTaskUid,
    isActive: emperorScheduledTasks.isActive,
    systemManaged: emperorScheduledTasks.systemManaged,
  }).from(emperorScheduledTasks).where(and(
    eq(emperorScheduledTasks.workspaceId, workspaceId),
    eq(emperorScheduledTasks.systemManaged, 1),
    inArray(emperorScheduledTasks.dataDomain, [...domains]),
  ));
  const taskUids = {} as Record<Domain, string>;
  for (const domain of domains) {
    const task = scheduledTasks.find((item) => item.dataDomain === domain);
    if (!task?.externalTaskUid || Number(task.isActive || 0) !== 1) throw new Error(`缺少启用的受治理任务：${domain}`);
    taskUids[domain] = task.externalTaskUid;
  }

  const dailyRows = await db.select({ reportDate: opsAsinDailySnapshots.reportDate }).from(opsAsinDailySnapshots)
    .where(eq(opsAsinDailySnapshots.workspaceId, workspaceId));
  const dailyPresent = new Set(dailyRows.map((row) => asDate(row.reportDate)).filter(Boolean));

  const adRows = await db.select({ weekStartDate: adKeywordWeekly.weekStartDate, weekEndDate: adKeywordWeekly.weekEndDate })
    .from(adKeywordWeekly).where(eq(adKeywordWeekly.workspaceId, workspaceId));
  const adPresent = new Set<string>();
  for (const row of adRows) {
    const start = asDate(row.weekStartDate);
    const end = asDate(row.weekEndDate);
    if (start && end && start <= end) for (const date of dateRange(start, end)) adPresent.add(date);
  }

  const weeklyRows = await db.select({ weekEndDate: lingxingProductWeekly.weekEndDate }).from(lingxingProductWeekly)
    .where(eq(lingxingProductWeekly.workspaceId, workspaceId));
  const weeklyPresent = new Set(weeklyRows.map((row) => asDate(row.weekEndDate)).filter(Boolean));
  const weeklyEnds = dateRange("2026-04-05", lastWeeklyEnd)
    .filter((date) => new Date(`${date}T00:00:00.000Z`).getUTCDay() === 0 && !weeklyPresent.has(date));

  return {
    taskUids,
    plan: {
      dailyDates: dateRange(firstDailyDate, lastTargetDate).filter((date) => !dailyPresent.has(date)),
      adDates: dateRange(firstAdDate, lastTargetDate).filter((date) => !adPresent.has(date)),
      weeklyEnds,
      inventoryDate: "2026-08-31",
    },
  };
}

async function createCaller() {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const [actor] = await db.select().from(users).where(and(eq(users.role, "super_admin"), eq(users.defaultWorkspaceId, workspaceId))).limit(1);
  if (!actor) throw new Error("未找到工作空间的超级管理员，无法建立受治理补读调用方");
  return lingxingSyncRouter.createCaller({ user: { ...actor, defaultWorkspaceId: workspaceId } } as any);
}

async function previewValidateAndApply(input: { domain: "product_performance_daily" | "fba_inventory" | "ad_keyword"; date: string; profile?: AdProfile; caller: Awaited<ReturnType<typeof createCaller>> }) {
  const scope = input.domain === "ad_keyword"
    ? { storeId: input.profile?.sid || "ALL_US_AD_PROFILES", profileId: input.profile?.profileId || "ALL_US_AD_PROFILES", marketplace: "US", startDate: input.date, endDate: input.date }
    : { storeId: "ALL_US", marketplace: "US", startDate: input.date, endDate: input.date };
  const preview = await input.caller.createPreview({ dataDomain: input.domain, scope });
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const [batch] = await db.select().from(opsExternalSyncBatches).where(and(
    eq(opsExternalSyncBatches.id, preview.batchId),
    eq(opsExternalSyncBatches.workspaceId, workspaceId),
  )).limit(1);
  const rows = await db.select().from(opsExternalSyncRows).where(and(
    eq(opsExternalSyncRows.batchId, preview.batchId),
    eq(opsExternalSyncRows.workspaceId, workspaceId),
  ));
  if (!batch) throw new Error(`批次${preview.batchId}不存在或不属于当前工作空间`);
  let priorRows: Array<Record<string, unknown>> = [];
  if (input.domain === "product_performance_daily") {
    const snapshots = await db.select().from(opsAsinDailySnapshots).where(eq(opsAsinDailySnapshots.workspaceId, workspaceId));
    validateDailyAutoApplyIntegrity(batch as any, rows as any, { startDate: input.date, endDate: input.date }, snapshots as any);
  } else if (input.domain === "fba_inventory") {
    const snapshots = (await db.select().from(opsAsinDailySnapshots).where(eq(opsAsinDailySnapshots.workspaceId, workspaceId)))
      .filter((row) => row.sourceType === "lx_inventory_mcp");
    validateInventoryAutoApplyIntegrity(batch as any, rows as any, { startDate: input.date, endDate: input.date }, snapshots as any);
  } else {
    const previousDate = addDays(input.date, -1);
    priorRows = await db.select().from(adKeywordWeekly).where(and(
      eq(adKeywordWeekly.workspaceId, workspaceId),
      eq(adKeywordWeekly.weekStartDate, previousDate),
      eq(adKeywordWeekly.weekEndDate, previousDate),
    ));
  }
  const applicableRows = input.domain === "ad_keyword"
    ? rows.filter((row) => row.rowStatus !== "needs_review" && (!Array.isArray(row.validationErrors) || row.validationErrors.length === 0))
    : rows;
  if (!applicableRows.length) throw new Error(`补读批次${preview.batchId}不存在可应用的有效${input.domain}草稿行`);
  if (input.domain === "ad_keyword") {
    validateKeywordAutoApplyIntegrity(batch as any, applicableRows as any, { startDate: input.date, endDate: input.date }, priorRows as any);
  }
  await input.caller.confirm({ batchId: preview.batchId, selectedRowIds: applicableRows.map((row) => row.id), note: `青岛独立站历史补读：${input.domain} ${input.date}，完整性和异常校验通过` });
  const applied = input.domain === "ad_keyword"
    ? await input.caller.applyConfirmedAds({ batchId: preview.batchId, note: `青岛独立站历史补读：${input.date}` })
    : await input.caller.applyConfirmedProductInventory({ batchId: preview.batchId, note: `青岛独立站历史补读：${input.date}` });
  return { batchId: preview.batchId, applied };
}

async function executeItems<T>(label: string, items: T[], run: (item: T) => Promise<unknown>) {
  const results: Array<{ item: T; ok: boolean; result?: unknown; error?: string }> = [];
  for (const item of items) {
    try {
      const result = await run(item);
      results.push({ item, ok: true, result });
      console.log(JSON.stringify({ label, item, status: "succeeded", result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      results.push({ item, ok: false, error: message });
      console.error(JSON.stringify({ label, item, status: "blocked_or_failed", error: message.slice(0, 1000) }));
    }
    await pause(1100);
  }
  return { attempted: items.length, succeeded: results.filter((item) => item.ok).length, blockedOrFailed: results.filter((item) => !item.ok).length, results };
}

async function main() {
  const execute = process.argv.includes("--execute");
  const requestedDomains = process.argv.find((arg) => arg.startsWith("--domains="))?.slice("--domains=".length).split(",").filter(Boolean) || [...domains];
  const selectedDomains = new Set(requestedDomains);
  const unsupported = requestedDomains.filter((domain) => !domains.includes(domain as Domain));
  if (unsupported.length) throw new Error(`不支持的补读数据域：${unsupported.join(",")}`);
  const { plan, taskUids } = await buildPlan();
  console.log(JSON.stringify({ mode: execute ? "execute" : "plan", workspaceId, target: "US authorized stores and ad profiles only", selectedDomains: [...selectedDomains], plan }));
  if (!execute) return;
  const caller = await createCaller();
  const skipped = (domain: BackfillWorkDomain) => ({ domain, skipped: true, attempted: 0, succeeded: 0, blockedOrFailed: 0, results: [] });
  const daily = selectedDomains.has("product_performance_daily")
    ? await executeItems("product_performance_daily", plan.dailyDates, (date) => previewValidateAndApply({ domain: "product_performance_daily", date, caller }))
    : skipped("product_performance_daily");
  const inventory = selectedDomains.has("fba_inventory")
    ? await executeItems("fba_inventory", [plan.inventoryDate], (date) => previewValidateAndApply({ domain: "fba_inventory", date, caller }))
    : skipped("fba_inventory");
  let advertising = skipped("ad_keyword");
  if (selectedDomains.has("ad_keyword")) {
    const adProfiles = (await caller.listAdProfiles()).filter((profile) => profile.profileId && (profile.country === "US" || profile.country === "美国" || /\bUS\b/i.test(profile.name)));
    if (!adProfiles.length) throw new Error("未发现美国站已授权广告Profile，不能开始关键词历史补读");
    const adItems = plan.adDates.flatMap((date) => adProfiles.map((profile) => ({ date, profile: { profileId: profile.profileId, sid: profile.sid, name: profile.name, country: profile.country } })));
    advertising = await executeItems("ad_keyword", adItems, ({ date, profile }) => previewValidateAndApply({ domain: "ad_keyword", date, profile, caller }));
  }
  const weekly = selectedDomains.has("parent_asin_weekly_rollup") ? await executeItems("parent_asin_weekly_rollup", plan.weeklyEnds, async (weekEnd) => {
    const monday = addDays(weekEnd, -6);
    return runLingxingScheduledDraft(taskUids.parent_asin_weekly_rollup, new Date(`${addDays(monday, 7)}T04:10:00.000Z`));
  }) : skipped("parent_asin_weekly_rollup");
  const summary = { completedAt: new Date().toISOString(), daily, inventory, advertising, weekly };
  console.log(JSON.stringify({ summary }));
  if ([daily, inventory, advertising, weekly].some((item) => item.blockedOrFailed > 0)) process.exitCode = 2;
}

void main().then(() => {
  // Drizzle/MySQL连接池不会自动关闭；本脚本是一次性补读任务，完成审计输出后必须退出。
  setTimeout(() => process.exit(process.exitCode ?? 0), 50);
}).catch((error) => {
  console.error(JSON.stringify({ fatal: error instanceof Error ? error.message : String(error) }));
  process.exit(1);
});
