import { describe, expect, it } from "vitest";
import { buildHistoricalBackfillTimeoutBatch } from "./historicalBackfillTimeout";

describe("buildHistoricalBackfillTimeoutBatch", () => {
  it("将预览前超时持久化为单日待复核批次而不是可应用数据", () => {
    const batch = buildHistoricalBackfillTimeoutBatch({ workspaceId: 1, userId: 1, date: "2026-04-23", error: "历史回补窗口超时：2026-04-23" });
    expect(batch.status).toBe("ready_for_review");
    expect(batch.scope).toMatchObject({ storeId: "ALL_US", startDate: "2026-04-23", endDate: "2026-04-23" });
    expect(batch.summary).toMatchObject({ totalRead: 0, selected: 0, timeoutBeforePreview: true });
    expect(batch.summary.failedStoreDateWindows).toHaveLength(1);
    expect(batch.rawResponseHash).toMatch(/^[a-f0-9]{64}$/);
  });
});
