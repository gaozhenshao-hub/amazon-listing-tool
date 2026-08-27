import { collectCompletedDailyBackfillDates, type HistoricalBackfillBatch } from "./historicalBackfillCoverage";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const numberOf = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0;

export type DailyBackfillReviewBatch = HistoricalBackfillBatch & {
  id: number;
  errorMessage?: string | null;
  traceId?: string | null;
  toolRunId?: string | null;
  rawSnapshot?: unknown;
  createdAt?: Date | null;
};

export type DailyBackfillReviewIssue = {
  code: "pagination_truncated" | "preview_timeout" | "store_window_failed" | "duplicate_identity" | "coverage_incomplete" | "integrity_blocked";
  label: string;
  detail: string;
};

export function dailyBackfillReviewIssue(input: Pick<DailyBackfillReviewBatch, "summary" | "scope" | "errorMessage">): DailyBackfillReviewIssue | null {
  const summary = record(input.summary);
  const scope = record(input.scope);
  if (summary.applyBlocked === "duplicate_daily_snapshot_identity") return { code: "duplicate_identity", label: "日快照身份重复", detail: `检测到${numberOf(summary.duplicateDailySnapshotCount)}条已存在或重复的店铺、站点、ASIN、报告日组合。` };
  if (Boolean(summary.capped) || numberOf(summary.pageTruncations) > 0) return { code: "pagination_truncated", label: "分页或行数截断", detail: `分页截断${numberOf(summary.pageTruncations)}次${Boolean(summary.capped) ? "，并触发总行数上限" : ""}。` };
  if (Boolean(summary.timeoutBeforePreview)) return { code: "preview_timeout", label: "预览创建前超时", detail: "外层等待在创建完整预览前超时；没有可安全确认的业务行。" };
  const failedWindows = Array.isArray(summary.failedStoreDateWindows) ? summary.failedStoreDateWindows : [];
  if (failedWindows.length) return { code: "store_window_failed", label: "店铺日期窗口失败", detail: `存在${failedWindows.length}个店铺×日期窗口未完成读取。` };
  const expectedWindows = numberOf(summary.storeDateWindowsExpected);
  const readWindows = numberOf(summary.storeDateWindowsRead);
  if (expectedWindows > 0 && expectedWindows !== readWindows) return { code: "coverage_incomplete", label: "店铺日期窗口覆盖不完整", detail: `已完成${readWindows}/${expectedWindows}个店铺×日期读取窗口。` };
  const expectedStores = numberOf(summary.storesExpected);
  const readStores = numberOf(summary.storesRead);
  if (expectedStores > 0 && expectedStores !== readStores) return { code: "coverage_incomplete", label: "授权店铺覆盖不完整", detail: `已读取${readStores}/${expectedStores}个授权店铺。` };
  if (input.errorMessage) return { code: "integrity_blocked", label: "完整性校验阻断", detail: input.errorMessage.slice(0, 500) };
  if (scope.startDate !== scope.endDate) return null;
  return null;
}

export function buildDailyBackfillReviewQueue(batches: DailyBackfillReviewBatch[]) {
  const completedDates = collectCompletedDailyBackfillDates(batches, "2000-01-01", "2100-12-31");
  const byDate = new Map<string, DailyBackfillReviewBatch[]>();
  for (const batch of batches) {
    if (batch.status !== "ready_for_review") continue;
    const scope = record(batch.scope);
    const reportDate = typeof scope.startDate === "string" ? scope.startDate : "";
    if (!reportDate || scope.endDate !== reportDate || completedDates.has(reportDate)) continue;
    if (!dailyBackfillReviewIssue(batch)) continue;
    byDate.set(reportDate, [...(byDate.get(reportDate) || []), batch]);
  }
  return [...byDate.entries()].map(([reportDate, dateBatches]) => {
    const sorted = [...dateBatches].sort((a, b) => b.id - a.id);
    const latestBatch = sorted[0];
    return {
      reportDate,
      attempts: sorted.length,
      batchIds: sorted.map((batch) => batch.id),
      latestBatch,
      issue: dailyBackfillReviewIssue(latestBatch)!,
    };
  }).sort((a, b) => a.reportDate.localeCompare(b.reportDate));
}
