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
    const date = typeof scope.startDate === "string" ? scope.startDate : "";
    if (!date || date !== scope.endDate || date < startDate || date > endDate) continue;
    const storesExpected = numberOf(summary.storesExpected);
    const windowsExpected = numberOf(summary.storeDateWindowsExpected);
    if (storesExpected <= 0 || windowsExpected <= 0) continue;
    if (Boolean(summary.capped) || numberOf(summary.pageTruncations) > 0) continue;
    if (numberOf(summary.storesRead) < storesExpected || numberOf(summary.storeDateWindowsRead) < windowsExpected) continue;
    completed.add(date);
  }
  return completed;
}
