import { describe, expect, it } from "vitest";
import { collectCompletedDailyBackfillDates } from "./historicalBackfillCoverage";

describe("历史MCP回补完成断点", () => {
  const complete = {
    status: "applied",
    scope: { startDate: "2026-02-27", endDate: "2026-02-27" },
    summary: { storesExpected: 9, storesRead: 9, storeDateWindowsExpected: 9, storeDateWindowsRead: 9, capped: false, pageTruncations: 0, activeProductRows: 158, filteredInactiveProductRows: 385 },
  };

  it("以完整已应用批次而非活跃快照店铺数判定日期已完成", () => {
    expect([...collectCompletedDailyBackfillDates([complete], "2026-02-26", "2026-02-28")]).toEqual(["2026-02-27"]);
  });

  it("截断、不完整窗口、未应用或多日批次不能作为单日回补断点", () => {
    const invalid = [
      { ...complete, status: "confirmed" },
      { ...complete, summary: { ...complete.summary, capped: true } },
      { ...complete, summary: { ...complete.summary, storeDateWindowsRead: 8 } },
      { ...complete, scope: { startDate: "2026-02-26", endDate: "2026-02-27" } },
    ];
    expect(collectCompletedDailyBackfillDates(invalid, "2026-02-26", "2026-02-28")).toEqual(new Set());
  });
});
