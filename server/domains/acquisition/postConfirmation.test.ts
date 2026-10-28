import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ startLegacyConsumerAnalysisJob: vi.fn(), enqueue: vi.fn() }));
vi.mock("../knowledge/automaticTagging", () => ({ enqueueAutomaticTags: mocks.enqueue }));
vi.mock("../knowledge/videoLibrary",()=>({syncCapturedVideos:vi.fn(),videoRows:vi.fn().mockResolvedValue([])}));
vi.mock("../knowledge/videoTagging",()=>({enqueueVideoTags:vi.fn()}));

vi.mock("./legacyConsumerAnalysisJob", () => ({
  startLegacyConsumerAnalysisJob: mocks.startLegacyConsumerAnalysisJob,
}));

import { triggerConsumerPostConfirmation } from "./postConfirmation";

describe("consumer post-confirmation actions", () => {
  beforeEach(() => vi.clearAllMocks());
  it("queues image tags after acquisition and keeps the image collection successful if enqueue fails", async () => {
    const projection = { consumerType: "kb_images" as const, imageSetId: 14, workspaceId: 3, userId: 7 };
    mocks.enqueue.mockResolvedValueOnce({ runId: "tags-1", status: "queued" });
    expect(await triggerConsumerPostConfirmation(projection)).toMatchObject({ analysisJobRunId: "tags-1", analysisJobStatus: "queued" });
    expect(mocks.enqueue).toHaveBeenCalledWith(projection);
    mocks.enqueue.mockRejectedValueOnce(new Error("小酷尚未配置"));
    expect(await triggerConsumerPostConfirmation(projection)).toMatchObject({ analysisJobStatus: "failed_to_queue" });
    expect(mocks.startLegacyConsumerAnalysisJob).not.toHaveBeenCalled();
  });
  it("does not queue AI after capture-only competitor admission", async () => {
    expect(await triggerConsumerPostConfirmation({ consumerType: "project_competitor", projectId: 11, workspaceId: 3, userId: 7,
      asin: "B012345678", confirmedSnapshotId: 9, captureOnly: true, analysisId: 20 })).toEqual({ analysisJobRunId: null, analysisJobStatus: null, analysisJobError: null, collectedAnalysisId: 20 });
    expect(mocks.startLegacyConsumerAnalysisJob).not.toHaveBeenCalled();
  });

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
