import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ startLegacyConsumerAnalysisJob: vi.fn() }));

vi.mock("./legacyConsumerAnalysisJob", () => ({
  startLegacyConsumerAnalysisJob: mocks.startLegacyConsumerAnalysisJob,
}));

import { triggerConsumerPostConfirmation } from "./postConfirmation";

describe("consumer post-confirmation actions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns a recoverable queue error without throwing after snapshot confirmation", async () => {
    mocks.startLegacyConsumerAnalysisJob.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(triggerConsumerPostConfirmation({
      consumerType: "kb_listing",
      recordId: 11,
      workspaceId: 3,
      userId: 7,
      asin: "B012345678",
      confirmedSnapshotId: 9,
    })).resolves.toEqual({
      analysisJobRunId: null,
      analysisJobStatus: "failed_to_queue",
      analysisJobError: "queue unavailable",
    });
  });

  it("does not queue AI analysis for conversion snapshot consumption", async () => {
    const result = await triggerConsumerPostConfirmation({
      consumerType: "conversion_collector",
      workspaceId: 3,
      userId: 7,
      asin: "B012345678",
      confirmedSnapshotId: 9,
    });
    expect(result).toEqual({ analysisJobRunId: null, analysisJobStatus: null, analysisJobError: null });
    expect(mocks.startLegacyConsumerAnalysisJob).not.toHaveBeenCalled();
  });
});
