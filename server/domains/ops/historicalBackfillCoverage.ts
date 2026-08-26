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
    const storesExpected = numberOf(summary.storesExpected);
    const windowsExpected = numberOf(summary.storeDateWindowsExpected);
    if (storesExpected <= 0 || windowsExpected <= 0) continue;
    if (Boolean(summary.capped) || numberOf(summary.pageTruncations) > 0) continue;
    const scopedDates = datesInScope(scopeStartDate, scopeEndDate);
    if (windowsExpected < storesExpected * scopedDates.length) continue;
    const datesRead = numberOf(summary.datesRead);
    if (datesRead > 0 && datesRead < scopedDates.length) continue;
    if (numberOf(summary.storesRead) < storesExpected || numberOf(summary.storeDateWindowsRead) < windowsExpected) continue;
    for (const date of scopedDates) if (date >= startDate && date <= endDate) completed.add(date);
  }
  return completed;
}
