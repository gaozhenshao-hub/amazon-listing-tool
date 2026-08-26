import { createHash } from "node:crypto";

export function buildHistoricalBackfillTimeoutBatch(input: { workspaceId: number; userId: number; date: string; error: string }) {
  const scope = { storeId: "ALL_US", marketplace: "US", startDate: input.date, endDate: input.date };
  const rawSnapshot = {
    source: "lingxing_mcp",
    dataDomain: "product_performance_daily",
    historicalBackfill: true,
    timeoutBeforePreview: true,
    error: input.error,
  };
  return {
    workspaceId: input.workspaceId,
    userId: input.userId,
    source: "lingxing_mcp",
    dataDomain: "product_performance_daily",
    status: "ready_for_review",
    scope,
    summary: {
      totalRead: 0,
      selected: 0,
      needsReview: 1,
      unmatched: 0,
      capped: false,
      pageTruncations: 0,
      datesRead: 0,
      storesExpected: 0,
      storeDateWindowsExpected: 0,
      storeDateWindowsCompleted: 0,
      timeoutBeforePreview: true,
      failedStoreDateWindows: [{ sid: "ALL_US", reportDate: input.date, page: 0, error: input.error.slice(0, 500) }],
    },
    rawSnapshot,
    rawResponseHash: createHash("sha256").update(JSON.stringify({ scope, error: input.error })).digest("hex"),
    toolRunId: null,
    traceId: `ops_lingxing_backfill_timeout_${input.date}_${Date.now()}`,
  };
}
