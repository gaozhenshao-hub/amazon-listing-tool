const BEIJING_UTC_OFFSET_MS = 8 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Report dates are Beijing calendar dates, independent of browser timezone. */
export function beijingReportDateDaysAgo(daysAgo: number, nowMs = Date.now()): string {
  if (!Number.isInteger(daysAgo) || daysAgo < 0 || !Number.isFinite(nowMs)) {
    throw new Error("Invalid Beijing report date offset");
  }
  return new Date(nowMs + BEIJING_UTC_OFFSET_MS - daysAgo * DAY_MS).toISOString().slice(0, 10);
}
