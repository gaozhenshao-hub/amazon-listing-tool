import { createHash } from "node:crypto";
import { createHash } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { adKeywordWeekly, dataImports, emperorScheduledTasks, lingxingProductWeekly, opsAsinDailySnapshots, opsExternalSyncBatches, opsExternalSyncConfirmations, opsExternalSyncRows, opsLingxingSyncSchedules, users } from "../../../drizzle/schema";
import { lingxingSyncRouter } from "../../routers/lingxingSync";
import { getDb } from "../../repositories/dbClient";
import { summarizeParentAsinWeeks, type DailySnapshot } from "./productOverview/dailyAggregation";

type ScheduleDomain = "product_performance_daily" | "fba_inventory" | "ad_keyword" | "parent_asin_weekly_rollup";

const shanghaiDate = (input = new Date()) => new Date(input.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const mondayOf = (date: string) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() - ((value.getUTCDay() + 6) % 7));
  return value.toISOString().slice(0, 10);
};

export function scheduledDailyScope(now = new Date()) {
  const previousDate = addDays(shanghaiDate(now), -1);
  return { startDate: previousDate, endDate: previousDate, runKey: `daily:${previousDate}` };
}

export function scheduledInventoryScope(now = new Date()) {
  const snapshotDate = shanghaiDate(now);
  return { startDate: snapshotDate, endDate: snapshotDate, runKey: `inventory:${snapshotDate}` };
}

export function scheduledKeywordScope(now = new Date()) {
  const previousDate = addDays(shanghaiDate(now), -1);
  return { startDate: previousDate, endDate: previousDate, runKey: `keyword:${previousDate}` };
}

export function scheduledWeeklyScope(now = new Date()) {
  const currentMonday = mondayOf(shanghaiDate(now));
  const startDate = addDays(currentMonday, -7);
  return { startDate, endDate: addDays(currentMonday, -1), runKey: `weekly:${startDate}` };
}

type WeeklyExceptionSnapshot = Pick<typeof opsAsinDailySnapshots.$inferSelect, "reportDate" | "salesQty" | "orderQty" | "salesAmount" | "sessionsTotal" | "sourceBatchHash">;

export function weeklyCoverageExceptionSummary(rows: WeeklyExceptionSnapshot[], startDate: string, endDate: string) {
  const expectedDates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) expectedDates.push(date);
  const presentDates = new Set(rows.map((row) => row.reportDate));
  const missingDates = expectedDates.filter((date) => !presentDates.has(date));
  const exceptionTypes: string[] = [];
  const messages: string[] = [];
  if (missingDates.length) {
    exceptionTypes.push("missing_daily_coverage");
    messages.push(`缺少已确认日快照：${missingDates.join("、")}`);
  }
  if (!rows.length) {
    exceptionTypes.push("empty_week");
    messages.push("本自然周无已确认日快照");
  }
  const allZeroMetrics = rows.length > 0 && rows.every((row) => [row.salesQty, row.orderQty, row.salesAmount, row.sessionsTotal].every((metric) => Number(metric || 0) === 0));
  if (allZeroMetrics) {
    exceptionTypes.push("all_zero_metrics");
    messages.push("本自然周已确认日快照的销量、订单、销售额与Session均为0");
  }
  if (rows.some((row) => !text(row.sourceBatchHash))) {
    exceptionTypes.push("upstream_lineage_unverified");
    messages.push("存在无法关联批次哈希的历史日快照，无法继承验证上游截断状态");
  }
  return {
    expectedDates,
    presentDates: [...presentDates].sort(),
    missingDates,
    exceptionTypes,
    isIncomplete: exceptionTypes.length > 0,
    message: messages.length ? `${messages.join("；")}；周汇总已阻断自动应用。` : null,
  };
}

function asDailySnapshot(row: typeof opsAsinDailySnapshots.$inferSelect): DailySnapshot {
  return {
    reportDate: row.reportDate, asin: row.asin, parentAsin: row.parentAsin || row.asin,
    storeName: row.storeName || `SID ${row.sourceStoreId || ""}`, country: row.country || "US", sourceType: row.sourceType,
    salesQty: Number(row.salesQty || 0), orderQty: Number(row.orderQty || 0), salesAmount: Number(row.salesAmount || 0), orderProfit: Number(row.orderProfit || 0),
    adSpend: Number(row.adSpend || 0), adSales: Number(row.adSales || 0), sessionsTotal: Number(row.sessionsTotal || 0),
    adOrders: Number(row.adOrders || 0), organicOrders: Number(row.organicOrders || 0), adClicks: Number(row.adClicks || 0), adImpressions: Number(row.adImpressions || 0), returnQty: Number(row.returnQty || 0),
    fbaAvailable: Number(row.fbaAvailable || row.availableStock || 0), fbaInTransit: Number(row.fbaInTransit || 0), sourceLocalAvailable: Number(row.sourceLocalAvailable || 0),
    title: row.title, productName: row.productName, sku: row.sku || row.msku, operator: row.operator,
  };
}

type WeeklyRollupData = Record<string, unknown> & { week?: Record<string, unknown> };
type WeeklyFactInsert = typeof lingxingProductWeekly.$inferInsert;

export function weeklyRollupIdentity(input: { workspaceId?: unknown; parentAsin?: unknown; storeName?: unknown; country?: unknown; weekStartDate?: unknown }) {
  return [text(input.workspaceId), text(input.parentAsin).toUpperCase(), text(input.storeName), text(input.country).toUpperCase(), text(input.weekStartDate)].join("|");
}

export function buildWeeklyRollupFact(input: WeeklyRollupData, context: { workspaceId: number; importId: number; userId: number }): WeeklyFactInsert {
  const week = record(input.week);
  const parentAsin = text(input.parentAsin).toUpperCase();
  const storeName = text(input.storeName);
  const country = text(input.country || "US").toUpperCase();
  const weekStartDate = text(week.weekStartDate);
  const weekEndDate = text(week.weekEndDate);
  if (!parentAsin || !storeName || !weekStartDate || !weekEndDate) throw new Error("父ASIN周汇总自动应用失败：缺少父ASIN、店铺或自然周身份字段");
  const asins = Array.isArray(input.asins) ? input.asins.map(text).filter(Boolean) : [text(input.asin)].filter(Boolean);
  const asDecimal = (value: unknown) => String(Number(value || 0));
  const asPercent = (value: unknown) => value === null || value === undefined || value === "" ? null : String(Number(Number(value).toFixed(4)));
  return {
    workspaceId: context.workspaceId,
    importId: context.importId,
    userId: context.userId,
    weekStartDate,
    weekEndDate,
    asin: asins.join(","),
    parentAsin,
    msku: text(input.sku),
    sku: text(input.sku),
    storeName,
    country,
    title: text(input.title),
    productName: text(input.productName),
    operator: text(input.operator),
    salesQty: Number(week.salesQty || 0),
    salesAmount: asDecimal(week.salesAmount),
    orderQty: Number(week.orderQty || 0),
    orderProfit: asDecimal(week.orderProfit),
    orderProfitMargin: asPercent(week.profitMargin),
    sessionsTotal: Number(week.sessionsTotal || 0),
    cvr: asPercent(week.cvr),
    adCvr: asPercent(week.adCvr),
    organicCvr: asPercent(week.organicCvr),
    adOrders: Number(week.adOrders || 0),
    organicOrders: Number(week.organicOrders || 0),
    adClicks: Number(week.adClicks || 0),
    adImpressions: Number(week.adImpressions || 0),
    ctr: asPercent(week.ctr),
    cpc: asDecimal(week.cpc),
    adSpend: asDecimal(week.adSpend),
    adSales: asDecimal(week.adSales),
    acos: asPercent(week.acos),
    returnQty: Number(week.returnQty || 0),
    returnRate: asPercent(week.returnRate),
    fbaAvailable: Number(week.fbaAvailable || 0),
    fbaInTransit: Number(week.fbaInTransit || 0),
  };
}

function weeklyFactComparable(input: Partial<typeof lingxingProductWeekly.$inferSelect> | WeeklyFactInsert) {
  return {
    identity: weeklyRollupIdentity(input),
    asin: text(input.asin),
    sku: text(input.sku),
    salesQty: Number(input.salesQty || 0),
    salesAmount: Number(input.salesAmount || 0),
    orderQty: Number(input.orderQty || 0),
    orderProfit: Number(input.orderProfit || 0),
    orderProfitMargin: numberOrNull(input.orderProfitMargin),
    sessionsTotal: Number(input.sessionsTotal || 0),
    cvr: numberOrNull(input.cvr),
    adCvr: numberOrNull(input.adCvr),
    organicCvr: numberOrNull(input.organicCvr),
    adOrders: Number(input.adOrders || 0),
    organicOrders: Number(input.organicOrders || 0),
    adClicks: Number(input.adClicks || 0),
    adImpressions: Number(input.adImpressions || 0),
    ctr: numberOrNull(input.ctr),
    cpc: Number(input.cpc || 0),
    adSpend: Number(input.adSpend || 0),
    adSales: Number(input.adSales || 0),
    acos: numberOrNull(input.acos),
    returnQty: Number(input.returnQty || 0),
    returnRate: numberOrNull(input.returnRate),
    fbaAvailable: Number(input.fbaAvailable || 0),
    fbaInTransit: Number(input.fbaInTransit || 0),
  };
}

export function weeklyFactsEqual(left: Partial<typeof lingxingProductWeekly.$inferSelect> | WeeklyFactInsert, right: Partial<typeof lingxingProductWeekly.$inferSelect> | WeeklyFactInsert) {
  return JSON.stringify(weeklyFactComparable(left)) === JSON.stringify(weeklyFactComparable(right));
}

export async function applyParentAsinWeeklyRollupBatch(db: any, input: { batchId: number; workspaceId: number; userId: number }) {
  const [batch] = await db.select().from(opsExternalSyncBatches).where(and(
    eq(opsExternalSyncBatches.id, input.batchId),
    eq(opsExternalSyncBatches.workspaceId, input.workspaceId),
  )).limit(1);
  if (!batch || batch.dataDomain !== "parent_asin_weekly_rollup") throw new Error("父ASIN周汇总批次不存在或不属于当前工作空间");
  if (batch.status === "applied") return { success: true, batchId: batch.id, importedRows: 0, skippedRows: Number(record(batch.summary).appliedRows || 0), idempotent: true as const };
  if (batch.status !== "ready_for_review" && batch.status !== "confirmed") throw new Error("父ASIN周汇总批次不处于可自动应用状态");
  const rows = await db.select().from(opsExternalSyncRows).where(and(
    eq(opsExternalSyncRows.batchId, input.batchId),
    eq(opsExternalSyncRows.workspaceId, input.workspaceId),
  ));
  if (!rows.length) throw new Error("父ASIN周汇总自动应用失败：批次没有汇总行");
  const facts = rows.map((row: typeof opsExternalSyncRows.$inferSelect) => {
    const errors = Array.isArray(row.validationErrors) ? row.validationErrors : [];
    if (errors.length) throw new Error("父ASIN周汇总自动应用失败：批次存在覆盖或字段异常");
    return { row, fact: buildWeeklyRollupFact(record(row.normalizedData), { workspaceId: input.workspaceId, importId: 0, userId: input.userId }) };
  });
  const identities = facts.map(({ fact }) => weeklyRollupIdentity(fact));
  if (new Set(identities).size !== identities.length) throw new Error("父ASIN周汇总自动应用失败：批次存在重复业务身份");
  const scope = record(batch.scope);
  const weekStartDate = text(scope.startDate || facts[0].fact.weekStartDate);
  const weekEndDate = text(scope.endDate || facts[0].fact.weekEndDate);
  const existing = await db.select().from(lingxingProductWeekly).where(and(
    eq(lingxingProductWeekly.workspaceId, input.workspaceId),
    eq(lingxingProductWeekly.weekStartDate, weekStartDate),
    eq(lingxingProductWeekly.weekEndDate, weekEndDate),
  ));
  const existingByIdentity = new Map(existing.map((row: typeof lingxingProductWeekly.$inferSelect) => [weeklyRollupIdentity(row), row]));
  const conflicting = facts.filter(({ fact }) => {
    const current = existingByIdentity.get(weeklyRollupIdentity(fact));
    return current && !weeklyFactsEqual(current, fact);
  });
  if (conflicting.length) {
    const message = `父ASIN周汇总自动应用失败：${conflicting.length}条历史周事实存在冲突，未覆盖原记录`;
    await db.update(opsExternalSyncBatches).set({ status: "failed", errorMessage: message, summary: { ...record(batch.summary), autoApplyBlocked: true, conflictCount: conflicting.length, writePolicy: "validated_weekly_auto_apply" } }).where(eq(opsExternalSyncBatches.id, input.batchId));
    throw new Error(message);
  }
  const pending = facts.filter(({ fact }) => !existingByIdentity.has(weeklyRollupIdentity(fact)));
  const identicalRows = facts.length - pending.length;
  const execute = async (tx: any) => {
    let importId = 0;
    if (pending.length) {
      const [createdImport] = await tx.insert(dataImports).values({
        workspaceId: input.workspaceId,
        userId: input.userId,
        sourceType: "lingxing",
        fileName: `系统父ASIN周汇总-批次${input.batchId}`,
        weekStartDate,
        weekEndDate,
        dataGranularity: "weekly",
        totalRows: pending.length,
        importedRows: pending.length,
        skippedRows: identicalRows,
        status: "completed",
      }).$returningId();
      importId = createdImport.id;
      for (let offset = 0; offset < pending.length; offset += 100) {
        await tx.insert(lingxingProductWeekly).values(pending.slice(offset, offset + 100).map(({ fact }) => ({ ...fact, importId })) as WeeklyFactInsert[]);
      }
    }
    await tx.update(opsExternalSyncRows).set({ rowStatus: "applied", selected: 1, appliedAt: new Date() }).where(and(
      eq(opsExternalSyncRows.batchId, input.batchId),
      eq(opsExternalSyncRows.workspaceId, input.workspaceId),
    ));
    await tx.insert(opsExternalSyncConfirmations).values({
      workspaceId: input.workspaceId,
      batchId: input.batchId,
      userId: input.userId,
      action: "system_auto_apply",
      selectedRowIds: rows.map((row: typeof opsExternalSyncRows.$inferSelect) => row.id),
      note: "父ASIN周汇总完整性校验通过后由系统直接应用",
    });
    await tx.update(opsExternalSyncBatches).set({
      status: "applied",
      appliedAt: new Date(),
      appliedBy: input.userId,
      errorMessage: null,
      summary: { ...record(batch.summary), autoApplied: true, writePolicy: "validated_weekly_auto_apply", appliedRows: pending.length, skippedRows: identicalRows },
    }).where(eq(opsExternalSyncBatches.id, input.batchId));
    return { success: true, batchId: input.batchId, importId: importId || null, importedRows: pending.length, skippedRows: identicalRows, idempotent: pending.length === 0 };
  };
  return typeof db.transaction === "function" ? db.transaction((tx: any) => execute(tx)) : execute(db);
}

type AutoApplyBatch = { id: number; status: string; summary: unknown; scope: unknown };
type AutoApplyRow = { id: number; entityKey: string; validationErrors: unknown; normalizedData: unknown; sourceData: unknown };
type PreviousDailySnapshot = Pick<typeof opsAsinDailySnapshots.$inferSelect, "sourceStoreId" | "country" | "asin" | "reportDate" | "salesQty" | "orderQty" | "salesAmount" | "adSpend" | "sessionsTotal">;
const record = (input: unknown): Record<string, unknown> => input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {};
const text = (input: unknown) => input === null || input === undefined ? "" : String(input).trim();
const numberOrNull = (input: unknown) => input === null || input === undefined || input === "" ? null : Number(input);
const dailyIdentity = (input: { sourceStoreId?: unknown; storeId?: unknown; country?: unknown; asin?: unknown; reportDate?: unknown }) => [text(input.sourceStoreId ?? input.storeId), text(input.country), text(input.asin), text(input.reportDate)].join("|");
type AnomalyThreshold = { multiplier: number; absoluteIncrease: number };
const defaultAnomalyThreshold: AnomalyThreshold = { multiplier: 20, absoluteIncrease: 10_000 };
const resolveAnomalyThreshold = (value: unknown): AnomalyThreshold => {
  const config = record(value).anomalyThreshold;
  const multiplier = numberOrNull(record(config).multiplier);
  const absoluteIncrease = numberOrNull(record(config).absoluteIncrease);
  return {
    multiplier: multiplier !== null && Number.isInteger(multiplier) && multiplier >= 2 && multiplier <= 20 ? multiplier : defaultAnomalyThreshold.multiplier,
    absoluteIncrease: absoluteIncrease !== null && Number.isInteger(absoluteIncrease) && absoluteIncrease >= 100 && absoluteIncrease <= 10_000 ? absoluteIncrease : defaultAnomalyThreshold.absoluteIncrease,
  };
};
const exceedsAnomalyThreshold = (current: number, baseline: number, threshold: AnomalyThreshold) => current > Math.max(baseline * threshold.multiplier, baseline + threshold.absoluteIncrease);

/** 仅供每日ASIN日表现的自动应用前置校验；任一异常均保留草稿并转人工。 */
export function validateDailyAutoApplyIntegrity(batch: AutoApplyBatch, rows: AutoApplyRow[], scope: { startDate: string; endDate: string }, previousSnapshots: PreviousDailySnapshot[] = [], threshold = defaultAnomalyThreshold) {
  const summary = record(batch.summary);
  if (batch.status !== "ready_for_review") throw new Error("自动应用校验未通过：草稿批次不处于待确认状态");
  if (Boolean(summary.capped) || Number(summary.pageTruncations || 0) > 0) throw new Error("自动应用校验未通过：读取存在分页或行数截断");
  if (Number(summary.datesRead || 0) !== 1 || scope.startDate !== scope.endDate) throw new Error("自动应用校验未通过：每日计划必须完整覆盖单一报告日");
  if (Number(summary.storesRead || 0) < 1) throw new Error("自动应用校验未通过：未覆盖任何授权店铺");
  if (Number(summary.storesExpected || 0) !== Number(summary.storesRead || 0)) throw new Error("自动应用校验未通过：授权店铺覆盖不完整");
  if (Number(summary.storeDateWindowsExpected || 0) !== Number(summary.storeDateWindowsRead || 0)) throw new Error("自动应用校验未通过：店铺日期窗口覆盖不完整");
  if (!rows.length) throw new Error("自动应用校验未通过：不存在可追加的日快照草稿");

  const previousDate = addDays(scope.startDate, -1);
  const priorByIdentity = new Map(previousSnapshots.filter((snapshot) => snapshot.reportDate === previousDate).map((snapshot) => [dailyIdentity(snapshot), snapshot]));
  const entityKeys = new Set<string>();
  for (const row of rows) {
    if (!row.entityKey || entityKeys.has(row.entityKey)) throw new Error("自动应用校验未通过：存在重复或缺失的日快照身份键");
    entityKeys.add(row.entityKey);
    const errors = Array.isArray(row.validationErrors) ? row.validationErrors : [];
    if (errors.length) throw new Error("自动应用校验未通过：草稿包含字段校验错误");
    const data = record(row.normalizedData);
    if (!text(data.asin) || text(data.asin) === "-" || !text(data.parentAsin) || text(data.reportDate) !== scope.startDate) {
      throw new Error("自动应用校验未通过：存在缺失ASIN、父ASIN或报告日的草稿行");
    }
    for (const key of ["salesQty", "orderQty", "salesAmount", "adSpend", "adSales", "adOrders", "sessionsTotal", "adClicks", "adImpressions", "returnQty"]) {
      const metric = numberOrNull(data[key]);
      if (metric !== null && (!Number.isFinite(metric) || metric < 0)) throw new Error(`自动应用校验未通过：${key}存在无效或负数指标`);
    }
    const orderProfit = numberOrNull(data.orderProfit);
    if (orderProfit !== null && !Number.isFinite(orderProfit)) throw new Error("自动应用校验未通过：orderProfit存在无效指标");
    const previous = priorByIdentity.get(dailyIdentity({ storeId: data.storeId, country: data.country, asin: data.asin, reportDate: previousDate }));
    if (previous) {
      for (const [key, previousValue] of [["salesQty", previous.salesQty], ["orderQty", previous.orderQty], ["salesAmount", previous.salesAmount], ["adSpend", previous.adSpend], ["sessionsTotal", previous.sessionsTotal]] as const) {
        const currentValue = numberOrNull(data[key]);
        const baseline = numberOrNull(previousValue);
        if (currentValue !== null && baseline !== null && baseline > 0 && exceedsAnomalyThreshold(currentValue, baseline, threshold)) {
          throw new Error(`自动应用校验未通过：${key}相较前一日异常跃升，需人工复核`);
        }
      }
    }
  }
}

function validateScheduledReadCoverage(batch: AutoApplyBatch, rows: AutoApplyRow[], scope: { startDate: string; endDate: string }, label: string) {
  const summary = record(batch.summary);
  if (batch.status !== "ready_for_review") throw new Error(`${label}自动应用校验未通过：草稿批次不处于待确认状态`);
  if (Boolean(summary.capped) || Number(summary.pageTruncations || 0) > 0) throw new Error(`${label}自动应用校验未通过：读取存在分页或行数截断`);
  if (Array.isArray(summary.failedStoreDateWindows) && summary.failedStoreDateWindows.length) throw new Error(`${label}自动应用校验未通过：存在读取失败窗口`);
  if (Number(summary.storesExpected || 0) < 1 || Number(summary.storesExpected) !== Number(summary.storesRead || 0)) throw new Error(`${label}自动应用校验未通过：授权范围覆盖不完整`);
  if (Number(summary.storeDateWindowsExpected || 0) > 0 && Number(summary.storeDateWindowsExpected) !== Number(summary.storeDateWindowsRead || 0)) throw new Error(`${label}自动应用校验未通过：读取窗口覆盖不完整`);
  if (!rows.length) throw new Error(`${label}自动应用校验未通过：不存在可应用的有效草稿行`);
  const entityKeys = new Set<string>();
  for (const row of rows) {
    if (!row.entityKey || entityKeys.has(row.entityKey)) throw new Error(`${label}自动应用校验未通过：存在重复或缺失的业务身份键`);
    entityKeys.add(row.entityKey);
    if (Array.isArray(row.validationErrors) && row.validationErrors.length) throw new Error(`${label}自动应用校验未通过：草稿包含字段校验错误`);
  }
  if (scope.startDate !== scope.endDate) throw new Error(`${label}自动应用校验未通过：每日计划必须覆盖单一报告日`);
}

export function validateInventoryAutoApplyIntegrity(batch: AutoApplyBatch, rows: AutoApplyRow[], scope: { startDate: string; endDate: string }, previousSnapshots: PreviousDailySnapshot[] = [], threshold = defaultAnomalyThreshold) {
  validateScheduledReadCoverage(batch, rows, scope, "库存快照");
  const previousByIdentity = new Map(previousSnapshots.map((snapshot) => [dailyIdentity(snapshot), snapshot]));
  for (const row of rows) {
    const data = record(row.normalizedData);
    if (!text(data.asin) || text(data.asin) === "-" || !text(data.parentAsin) || text(data.reportDate) !== scope.endDate) throw new Error("库存快照自动应用校验未通过：存在缺失ASIN、父ASIN或快照日期的草稿行");
    for (const key of ["fbaAvailable", "fbaReserved", "fbaInTransit"]) {
      const metric = numberOrNull(data[key]);
      if (metric === null || !Number.isFinite(metric) || metric < 0) throw new Error(`库存快照自动应用校验未通过：${key}存在无效或负数指标`);
    }
    const previous = previousByIdentity.get(dailyIdentity({ storeId: data.storeId, country: data.country, asin: data.asin, reportDate: addDays(scope.endDate, -1) }));
    if (previous) {
      for (const key of ["fbaAvailable", "fbaReserved", "fbaInTransit"] as const) {
        const current = numberOrNull(data[key]);
        const baseline = numberOrNull((previous as RecordValue)[key]);
        if (current !== null && baseline !== null && baseline > 0 && exceedsAnomalyThreshold(current, baseline, threshold)) throw new Error(`库存快照自动应用校验未通过：${key}相较前一日异常跃升，需人工复核`);
      }
    }
  }
}

export function validateKeywordAutoApplyIntegrity(batch: AutoApplyBatch, rows: AutoApplyRow[], scope: { startDate: string; endDate: string }, previousRows: Array<Record<string, unknown>> = [], threshold = defaultAnomalyThreshold) {
  validateScheduledReadCoverage(batch, rows, scope, "广告关键词");
  const keywordIdentity = (value: RecordValue) => [text(value.profileId || value.sourceProfileId), text(value.campaignId || value.campaignName), text(value.adGroupId || value.adGroupName), text(value.keyword), text(value.matchType || "unknown")].join("|");
  const previousByIdentity = new Map(previousRows.map((row) => [keywordIdentity(row), row]));
  for (const row of rows) {
    const data = record(row.normalizedData);
    if (!text(data.profileId) || !text(data.campaignName) || !text(data.keyword) || text(data.periodStart) !== scope.startDate || text(data.periodEnd) !== scope.endDate) throw new Error("广告关键词自动应用校验未通过：存在缺失Profile、活动、关键词或报告期的草稿行");
    for (const key of ["adImpressions", "adClicks", "adSpend", "adSales", "adOrders", "adAcos", "adCpc", "adCtr"]) {
      const metric = numberOrNull(data[key]);
      if (metric !== null && (!Number.isFinite(metric) || metric < 0)) throw new Error(`广告关键词自动应用校验未通过：${key}存在无效或负数指标`);
    }
    const previous = previousByIdentity.get(keywordIdentity(data));
    if (previous) {
      for (const [currentKey, previousKey] of [["adImpressions", "impressions"], ["adClicks", "clicks"], ["adSpend", "spend"], ["adSales", "sales"]] as const) {
        const current = numberOrNull(data[currentKey]);
        const baseline = numberOrNull(previous[previousKey]);
        if (current !== null && baseline !== null && baseline > 0 && exceedsAnomalyThreshold(current, baseline, threshold)) throw new Error(`广告关键词自动应用校验未通过：${currentKey}相较前一日异常跃升，需人工复核`);
      }
    }
  }
}

/** 历史回补使用与每日计划等同的治理规则，但必须完整覆盖输入范围内的所有日期。 */
export function validateHistoricalBackfillIntegrity(batch: AutoApplyBatch, rows: AutoApplyRow[], scope: { startDate: string; endDate: string }, previousSnapshots: PreviousDailySnapshot[] = []) {
  const summary = record(batch.summary);
  if (batch.status !== "ready_for_review") throw new Error("历史回补校验未通过：草稿批次不处于待确认状态");
  if (Boolean(summary.capped) || Number(summary.pageTruncations || 0) > 0) throw new Error("历史回补校验未通过：读取存在分页或行数截断");
  const expectedDates: string[] = [];
  for (let date = scope.startDate; date <= scope.endDate; date = addDays(date, 1)) expectedDates.push(date);
  if (Number(summary.datesRead || 0) !== expectedDates.length) throw new Error("历史回补校验未通过：日期覆盖不完整");
  if (Number(summary.storesRead || 0) < 1 || Number(summary.storesExpected || 0) !== Number(summary.storesRead || 0)) throw new Error("历史回补校验未通过：授权店铺覆盖不完整");
  if (Number(summary.storeDateWindowsExpected || 0) !== Number(summary.storeDateWindowsRead || 0)) throw new Error("历史回补校验未通过：店铺日期窗口覆盖不完整");
  if (!rows.length) throw new Error("历史回补校验未通过：不存在可追加的日快照草稿");

  const snapshotsByIdentity = new Map(previousSnapshots.map((snapshot) => [dailyIdentity(snapshot), snapshot]));
  const candidateByIdentity = new Map<string, AutoApplyRow>();
  for (const row of rows) {
    if (!row.entityKey || candidateByIdentity.has(row.entityKey)) throw new Error("历史回补校验未通过：存在重复或缺失的日快照身份键");
    candidateByIdentity.set(row.entityKey, row);
  }
  for (const row of rows) {
    const errors = Array.isArray(row.validationErrors) ? row.validationErrors : [];
    if (errors.length) throw new Error("历史回补校验未通过：草稿包含字段校验错误");
    const data = record(row.normalizedData);
    const reportDate = text(data.reportDate);
    if (!text(data.asin) || text(data.asin) === "-" || !text(data.parentAsin) || !expectedDates.includes(reportDate)) {
      throw new Error("历史回补校验未通过：存在缺失ASIN、父ASIN或范围外报告日的草稿行");
    }
    for (const key of ["salesQty", "orderQty", "salesAmount", "adSpend", "adSales", "adOrders", "sessionsTotal", "adClicks", "adImpressions", "returnQty"]) {
      const metric = numberOrNull(data[key]);
      if (metric !== null && (!Number.isFinite(metric) || metric < 0)) throw new Error(`历史回补校验未通过：${key}存在无效或负数指标`);
    }
    const orderProfit = numberOrNull(data.orderProfit);
    if (orderProfit !== null && !Number.isFinite(orderProfit)) throw new Error("历史回补校验未通过：orderProfit存在无效指标");
    const previousDate = addDays(reportDate, -1);
    const identity = dailyIdentity({ storeId: data.storeId, country: data.country, asin: data.asin, reportDate: previousDate });
    const candidatePrevious = candidateByIdentity.get(identity);
    const previousData = candidatePrevious ? record(candidatePrevious.normalizedData) : snapshotsByIdentity.get(identity);
    if (previousData) {
      for (const [key, previousValue] of [["salesQty", (previousData as any).salesQty], ["orderQty", (previousData as any).orderQty], ["salesAmount", (previousData as any).salesAmount], ["adSpend", (previousData as any).adSpend], ["sessionsTotal", (previousData as any).sessionsTotal]] as const) {
        const currentValue = numberOrNull(data[key]);
        const baseline = numberOrNull(previousValue);
        if (currentValue !== null && baseline !== null && baseline > 0 && currentValue > Math.max(baseline * 20, baseline + 10_000)) {
          throw new Error(`历史回补校验未通过：${key}相较前一日异常跃升，需人工复核`);
        }
      }
    }
  }
}

export async function runLingxingScheduledDraft(taskUid: string, now = new Date()) {
  const db = await getDb();
  if (!db) throw new Error("数据库不可用");
  const [emperorTask] = await db.select().from(emperorScheduledTasks).where(and(
    eq(emperorScheduledTasks.externalTaskUid, taskUid),
    eq(emperorScheduledTasks.systemManaged, 1),
  )).limit(1);
  if (!emperorTask || Number(emperorTask.isActive || 0) !== 1) return { ok: true, skipped: "orphan_or_paused" as const };
  const [schedule] = await db.select().from(opsLingxingSyncSchedules)
    .where(and(eq(opsLingxingSyncSchedules.id, emperorTask.externalScheduleId!), eq(opsLingxingSyncSchedules.scheduleCronTaskUid, taskUid), eq(opsLingxingSyncSchedules.enabled, 1))).limit(1);
  if (!schedule) return { ok: true, skipped: "orphan_or_paused" as const };
  const domain = schedule.dataDomain as ScheduleDomain;
  const anomalyThreshold = resolveAnomalyThreshold(emperorTask.inputTemplate);
  const scope = domain === "product_performance_daily" ? scheduledDailyScope(now) : domain === "fba_inventory" ? scheduledInventoryScope(now) : domain === "ad_keyword" ? scheduledKeywordScope(now) : scheduledWeeklyScope(now);
  if (schedule.lastRunKey === scope.runKey && schedule.lastStatus === "succeeded") return { ok: true, skipped: "idempotent" as const, runKey: scope.runKey };

  await db.update(opsLingxingSyncSchedules).set({ lastStatus: "running", lastError: null, lastRunAt: now }).where(eq(opsLingxingSyncSchedules.id, schedule.id));
  await db.update(emperorScheduledTasks).set({ lastRunStatus: "running", lastRunAt: now, runCount: sql`${emperorScheduledTasks.runCount} + 1` }).where(eq(emperorScheduledTasks.id, emperorTask.id));
  let batchId: number | null = null;
  let writePolicy: "draft_only" | "validated_daily_auto_apply" | "validated_weekly_auto_apply" = "draft_only";
  try {
    if (["product_performance_daily", "fba_inventory", "ad_keyword"].includes(domain)) {
      const [owner] = await db.select({ id: users.id, role: users.role, organizationId: users.organizationId, defaultWorkspaceId: users.defaultWorkspaceId })
        .from(users).where(eq(users.id, schedule.ownerUserId)).limit(1);
      if (!owner) throw new Error("计划创建者不存在或已删除");
      const caller = lingxingSyncRouter.createCaller({ user: { ...owner, defaultWorkspaceId: schedule.workspaceId } } as any);
      const preview = await caller.createPreview({
        dataDomain: domain,
        scope: {
          storeId: domain === "ad_keyword" ? "ALL_US_AD_PROFILES" : "ALL_US",
          profileId: domain === "ad_keyword" ? "ALL_US_AD_PROFILES" : undefined,
          marketplace: "US",
          startDate: scope.startDate,
          endDate: scope.endDate,
        },
      });
      batchId = preview.batchId;
      if (Number(schedule.autoApply || 0) === 1) {
        const [batch] = await db.select().from(opsExternalSyncBatches).where(and(
          eq(opsExternalSyncBatches.id, batchId),
          eq(opsExternalSyncBatches.workspaceId, schedule.workspaceId),
        )).limit(1);
        const rows = await db.select().from(opsExternalSyncRows).where(and(
          eq(opsExternalSyncRows.batchId, batchId),
          eq(opsExternalSyncRows.workspaceId, schedule.workspaceId),
        ));
        const applicableRows = domain === "ad_keyword"
          ? rows.filter((row) => row.rowStatus !== "needs_review" && (!Array.isArray(row.validationErrors) || row.validationErrors.length === 0))
          : rows;
        if (domain === "product_performance_daily") {
          const snapshots = await db.select().from(opsAsinDailySnapshots).where(eq(opsAsinDailySnapshots.workspaceId, schedule.workspaceId));
          validateDailyAutoApplyIntegrity(batch as AutoApplyBatch, applicableRows as AutoApplyRow[], scope, snapshots as PreviousDailySnapshot[], anomalyThreshold);
        } else if (domain === "fba_inventory") {
          const previousSnapshots = (await db.select().from(opsAsinDailySnapshots).where(eq(opsAsinDailySnapshots.workspaceId, schedule.workspaceId)))
            .filter((snapshot) => snapshot.sourceType === "lx_inventory_mcp");
          validateInventoryAutoApplyIntegrity(batch as AutoApplyBatch, applicableRows as AutoApplyRow[], scope, previousSnapshots as PreviousDailySnapshot[], anomalyThreshold);
        } else {
          const previousDate = addDays(scope.startDate, -1);
          const previousKeywords = await db.select().from(adKeywordWeekly).where(and(
            eq(adKeywordWeekly.workspaceId, schedule.workspaceId),
            eq(adKeywordWeekly.weekStartDate, previousDate),
            eq(adKeywordWeekly.weekEndDate, previousDate),
          ));
          validateKeywordAutoApplyIntegrity(batch as AutoApplyBatch, applicableRows as AutoApplyRow[], scope, previousKeywords as Array<Record<string, unknown>>, anomalyThreshold);
        }
        const selectedRowIds = applicableRows.map((row) => row.id);
        if (!selectedRowIds.length) throw new Error("自动应用校验未通过：所有广告关键词行均缺失身份或字段，已保留待复核");
        await caller.confirm({ batchId, selectedRowIds, note: `系统${domain}每日校验通过自动确认` });
        if (domain === "ad_keyword") await caller.applyConfirmedAds({ batchId, note: "系统每日关键词校验通过自动追加历史事实" });
        else await caller.applyConfirmedProductInventory({ batchId, note: domain === "fba_inventory" ? "系统每日库存校验通过自动追加库存快照" : "系统每日校验通过自动追加日快照" });
        writePolicy = "validated_daily_auto_apply";
      }
    } else {
      const snapshots = (await db.select().from(opsAsinDailySnapshots).where(and(
        eq(opsAsinDailySnapshots.workspaceId, schedule.workspaceId),
      ))).filter((snapshot) => snapshot.sourceType !== "lx_inventory_mcp");
      const weekRows = snapshots.filter((row) => row.reportDate >= scope.startDate && row.reportDate <= scope.endDate);
      const coverageException = weeklyCoverageExceptionSummary(weekRows, scope.startDate, scope.endDate);
      const parents = summarizeParentAsinWeeks(weekRows.map(asDailySnapshot), 1)
        .map((parent) => ({ ...parent, week: parent.weeks.find((week) => week.weekStartDate === scope.startDate) }))
        .filter((parent) => parent.week);
      const rawResponseHash = createHash("sha256").update(JSON.stringify(parents)).digest("hex");
      const [created] = await db.insert(opsExternalSyncBatches).values({
        workspaceId: schedule.workspaceId, userId: schedule.ownerUserId, source: "internal_rollup", dataDomain: "parent_asin_weekly_rollup", status: !parents.length ? "empty" : coverageException.isIncomplete ? "failed" : "ready_for_review",
        scope: { startDate: scope.startDate, endDate: scope.endDate, marketplace: "US", scheduleTaskUid: taskUid },
        rawResponseHash, rawSnapshot: { source: "confirmed_daily_snapshots", rawResponseHash, parentCount: parents.length },
        errorMessage: coverageException.message,
        summary: { totalRead: weekRows.length, parentCount: parents.length, selected: coverageException.isIncomplete ? 0 : parents.length, scheduled: true, writePolicy: "validated_weekly_auto_apply", coverageException },
      }).$returningId();
      batchId = created.id;
      for (let offset = 0; offset < parents.length; offset += 250) {
        await db.insert(opsExternalSyncRows).values(parents.slice(offset, offset + 250).map((parent) => ({
          workspaceId: schedule.workspaceId, batchId, entityKey: `${parent.storeName}|${parent.country}|${parent.parentAsin}|${scope.startDate}`,
          rowStatus: coverageException.isIncomplete ? "needs_review" : "new", selected: coverageException.isIncomplete ? 0 : 1, sourceData: parent as any, normalizedData: parent as any,
          validationErrors: coverageException.message ? [coverageException.message] : [], matchInfo: { strategy: "confirmed_daily_parent_asin_weekly_rollup", writePolicy: "validated_weekly_auto_apply", coverageException },
        })) as any);
      }
      if (coverageException.isIncomplete) throw new Error(coverageException.message || "父ASIN周汇总覆盖不完整，已阻断自动应用");
      if (parents.length) {
        await applyParentAsinWeeklyRollupBatch(db, { batchId, workspaceId: schedule.workspaceId, userId: schedule.ownerUserId });
        writePolicy = "validated_weekly_auto_apply";
      }
    }
    await db.update(opsLingxingSyncSchedules).set({ lastRunKey: scope.runKey, lastRunAt: new Date(), lastBatchId: batchId, lastStatus: "succeeded", lastError: null }).where(eq(opsLingxingSyncSchedules.id, schedule.id));
    await db.update(emperorScheduledTasks).set({ lastRunStatus: "succeeded", lastRunAt: new Date(), lastBatchId: batchId }).where(eq(emperorScheduledTasks.id, emperorTask.id));
    return { ok: true, batchId: batchId!, runKey: scope.runKey, writePolicy };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (batchId) {
      const [batch] = await db.select().from(opsExternalSyncBatches).where(and(
        eq(opsExternalSyncBatches.id, batchId),
        eq(opsExternalSyncBatches.workspaceId, schedule.workspaceId),
      )).limit(1);
      if (batch?.status === "ready_for_review") await db.update(opsExternalSyncBatches).set({
        errorMessage: message.slice(0, 3000),
        summary: { ...(record(batch.summary)), autoApplyBlocked: true, autoApplyError: message.slice(0, 1000), scheduled: true },
      }).where(eq(opsExternalSyncBatches.id, batchId));
    }
    await db.update(opsLingxingSyncSchedules).set({ lastStatus: "failed", lastError: message.slice(0, 3000), lastRunAt: new Date() }).where(eq(opsLingxingSyncSchedules.id, schedule.id));
    await db.update(emperorScheduledTasks).set({ lastRunStatus: "failed", lastRunAt: new Date(), lastBatchId: batchId }).where(eq(emperorScheduledTasks.id, emperorTask.id));
    throw error;
  }
}
