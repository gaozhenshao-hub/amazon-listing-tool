import { describe, expect, it } from "vitest";
import { buildDailyBackfillReviewQueue, buildScheduledAutoApplyReviewQueue, dailyBackfillReviewIssue } from "./historicalBackfillReview";

describe("历史回补异常复核队列", () => {
  it("按日期合并未覆盖的异常草稿，并排除被完整批次覆盖的旧异常", () => {
    const queue = buildDailyBackfillReviewQueue([
      { id: 3, status: "applied", scope: { startDate: "2026-08-10", endDate: "2026-08-16" }, summary: { storesRead: 9, datesRead: 7, capped: false, pageTruncations: 0 } },
      { id: 4, status: "ready_for_review", scope: { startDate: "2026-08-10", endDate: "2026-08-10", storeId: "ALL_US" }, summary: { applyBlocked: "duplicate_daily_snapshot_identity", duplicateDailySnapshotCount: 177 } },
      { id: 5, status: "ready_for_review", scope: { startDate: "2026-04-23", endDate: "2026-04-23", storeId: "ALL_US" }, summary: { timeoutBeforePreview: true } },
      { id: 6, status: "ready_for_review", scope: { startDate: "2026-04-25", endDate: "2026-04-25", storeId: "ALL_US" }, summary: { pageTruncations: 1, capped: false } },
      { id: 7, status: "ready_for_review", scope: { startDate: "2026-04-25", endDate: "2026-04-25", storeId: "ALL_US" }, summary: { timeoutBeforePreview: true } },
    ]);
    expect(queue).toHaveLength(2);
    expect(queue[0]).toMatchObject({ reportDate: "2026-04-23", attempts: 1, issue: { code: "preview_timeout" } });
    expect(queue[1]).toMatchObject({ reportDate: "2026-04-25", attempts: 2, batchIds: [7, 6], latestBatch: { id: 7 }, issue: { code: "preview_timeout" } });
  });

  it("将截断、失败窗口、覆盖不足和重复身份识别为不可确认的治理阻断", () => {
    expect(dailyBackfillReviewIssue({ summary: { pageTruncations: 1 }, scope: {}, errorMessage: null })?.code).toBe("pagination_truncated");
    expect(dailyBackfillReviewIssue({ summary: { failedStoreDateWindows: [{ sid: "1" }] }, scope: {}, errorMessage: null })?.code).toBe("store_window_failed");
    expect(dailyBackfillReviewIssue({ summary: { storesExpected: 9, storesRead: 8 }, scope: {}, errorMessage: null })?.code).toBe("coverage_incomplete");
    expect(dailyBackfillReviewIssue({ summary: { applyBlocked: "duplicate_daily_snapshot_identity" }, scope: {}, errorMessage: null })?.code).toBe("duplicate_identity");
  });

  it("将库存和关键词自动应用异常按数据域及报告日纳入统一复核队列", () => {
    const queue = buildScheduledAutoApplyReviewQueue([
      { id: 8, dataDomain: "fba_inventory", status: "ready_for_review", scope: { startDate: "2026-08-25", endDate: "2026-08-25" }, summary: { storesExpected: 9, storesRead: 8 } },
      { id: 9, dataDomain: "ad_keyword", status: "ready_for_review", scope: { startDate: "2026-08-24", endDate: "2026-08-24" }, summary: { pageTruncations: 1 } },
    ] as any);
    expect(queue).toMatchObject([
      { dataDomain: "ad_keyword", reportDate: "2026-08-24", issue: { code: "pagination_truncated" } },
      { dataDomain: "fba_inventory", reportDate: "2026-08-25", issue: { code: "coverage_incomplete" } },
    ]);
  });
});
