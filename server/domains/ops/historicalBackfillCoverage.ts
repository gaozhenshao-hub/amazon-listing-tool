export type HistoricalBackfillBatch = {
  status: string;
  scope: unknown;
  summary: unknown;
};

const asRecord = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const numberOf = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};
const addDays = (date: string, days: number) => {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
};
const datesInScope = (startDate: string, endDate: string) => {
  const dates: string[] = [];
  for (let date = startDate; date <= endDate; date = addDays(date, 1)) dates.push(date);
  return dates;
};

/**
 * 活跃商品过滤会使某个已完整读取的店铺没有日快照，因此不能再以快照的店铺数判定日期缺失。
 * 只接受覆盖完整、无截断并已成功应用的单日MCP批次作为回补断点。
 */
export function collectCompletedDailyBackfillDates(batches: HistoricalBackfillBatch[], startDate: string, endDate: string) {
  const completed = new Set<string>();
  for (const batch of batches) {
    if (batch.status !== "applied") continue;
    const scope = asRecord(batch.scope);
    const summary = asRecord(batch.summary);
    const scopeStartDate = typeof scope.startDate === "string" ? scope.startDate : "";
    const scopeEndDate = typeof scope.endDate === "string" ? scope.endDate : "";
    if (!scopeStartDate || !scopeEndDate || scopeStartDate > scopeEndDate) continue;
    // 0175以前的完整批次只记录了 storesRead / datesRead，没有店铺日期窗口字段。
    // 对这类旧审计记录，仅在范围天数、店铺数、无截断三个证据同时成立时兼容认定完成。
    const storesExpected = numberOf(summary.storesExpected) || numberOf(summary.storesRead);
    const hasWindowMetadata = Object.prototype.hasOwnProperty.call(summary, "storeDateWindowsExpected")
      || Object.prototype.hasOwnProperty.call(summary, "storeDateWindowsRead");
    const scopedDates = datesInScope(scopeStartDate, scopeEndDate);
    const windowsExpected = numberOf(summary.storeDateWindowsExpected) || (hasWindowMetadata ? 0 : storesExpected * scopedDates.length);
    if (storesExpected <= 0 || windowsExpected <= 0) continue;
    if (Boolean(summary.capped) || numberOf(summary.pageTruncations) > 0) continue;
    if (windowsExpected < storesExpected * scopedDates.length) continue;
    const datesRead = numberOf(summary.datesRead);
    if (datesRead > 0 && datesRead < scopedDates.length) continue;
    if (numberOf(summary.storesRead) < storesExpected) continue;
    const windowsRead = numberOf(summary.storeDateWindowsRead) || (hasWindowMetadata ? 0 : windowsExpected);
    if (windowsRead < windowsExpected) continue;
    for (const date of scopedDates) if (date >= startDate && date <= endDate) completed.add(date);
  }
  return completed;
}

/** 已产生待复核草稿的单日窗口已具备异常审计，不应在同一自动回补流程中被无限重试。 */
export function collectReviewRequiredDailyBackfillDates(batches: HistoricalBackfillBatch[], startDate: string, endDate: string) {
  const reviewRequired = new Set<string>();
  for (const batch of batches) {
    if (batch.status !== "ready_for_review") continue;
    const scope = asRecord(batch.scope);
    const scopeStartDate = typeof scope.startDate === "string" ? scope.startDate : "";
    const scopeEndDate = typeof scope.endDate === "string" ? scope.endDate : "";
    if (!scopeStartDate || scopeStartDate !== scopeEndDate || scopeStartDate < startDate || scopeStartDate > endDate) continue;
    reviewRequired.add(scopeStartDate);
  }
  return reviewRequired;
}
