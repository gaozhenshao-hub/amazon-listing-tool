import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ startLegacyConsumerAnalysisJob: vi.fn(), enqueue: vi.fn(), prepare:vi.fn(), analyzeCollectedListing: vi.fn(), recordCompetitorAnalysisQueueFailure: vi.fn() }));
vi.mock("../listing/collectedListing", () => ({ analyzeCollectedListing: mocks.analyzeCollectedListing,recordCompetitorAnalysisQueueFailure:mocks.recordCompetitorAnalysisQueueFailure }));
vi.mock("../knowledge/automaticTagging", () => ({ enqueueAutomaticTags: mocks.enqueue }));
vi.mock("../knowledge/pretranslationJob",()=>({enqueuePretranslation:mocks.prepare}));
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
    expect(mocks.prepare).toHaveBeenCalledWith({...projection,kind:"set",id:14});
    mocks.enqueue.mockRejectedValueOnce(new Error("小酷尚未配置"));
    expect(await triggerConsumerPostConfirmation(projection)).toMatchObject({ analysisJobStatus: "failed_to_queue" });
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    expect(mocks.startLegacyConsumerAnalysisJob).not.toHaveBeenCalled();
  });
  it("queues analysis after capture without creating knowledge tags", async () => {
    mocks.analyzeCollectedListing.mockResolvedValueOnce({runId:"analysis-1",status:"queued"});
    expect(await triggerConsumerPostConfirmation({ consumerType: "project_competitor", projectId: 11, workspaceId: 3, userId: 7,
      asin: "B012345678", confirmedSnapshotId: 9, captureOnly: true, analysisId: 20 })).toEqual({ analysisJobRunId: "analysis-1", analysisJobStatus: "queued", analysisJobError: null, collectedAnalysisId: 20 });
    expect(mocks.enqueue).not.toHaveBeenCalled();
    expect(mocks.startLegacyConsumerAnalysisJob).not.toHaveBeenCalled();
  });
  it("keeps the collected result and records an automatic analysis failure",async()=>{
    mocks.analyzeCollectedListing.mockRejectedValueOnce(new Error('模型暂不可用'));
    await expect(triggerConsumerPostConfirmation({consumerType:'project_competitor',projectId:11,workspaceId:3,userId:7,asin:'B012345678',confirmedSnapshotId:9,captureOnly:true,analysisId:20})).resolves.toMatchObject({analysisJobStatus:'failed_to_queue',collectedAnalysisId:20});
    expect(mocks.recordCompetitorAnalysisQueueFailure).toHaveBeenCalledWith({projectId:11,workspaceId:3,userId:7,analysisId:20});
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
