import { startLegacyConsumerAnalysisJob } from "./legacyConsumerAnalysisJob";
import type { LegacyConsumerProjection } from "./legacyConsumerProjection";
import { enqueueAutomaticTags } from "../knowledge/automaticTagging";
import { syncCapturedVideos,videoRows } from "../knowledge/videoLibrary";
import { enqueueVideoTags } from "../knowledge/videoTagging";
import { sql } from "drizzle-orm";

type Projection = LegacyConsumerProjection | { consumerType: "kb_images"; imageSetId: number; workspaceId: number; userId: number } | { consumerType: "image_workflow" } | null;

export async function triggerConsumerPostConfirmation(projection: Projection) {
  if (projection?.consumerType === "project_competitor" && projection.captureOnly) {
    return { analysisJobRunId: null, analysisJobStatus: null, analysisJobError: null, collectedAnalysisId: projection.analysisId };
  }
  if (!projection || projection.consumerType === "image_workflow" || projection.consumerType === "conversion_collector") {
    return { analysisJobRunId: null, analysisJobStatus: null, analysisJobError: null };
  }
  try {
    const job = projection.consumerType === "kb_images" ? await enqueueAutomaticTags(projection) : await startLegacyConsumerAnalysisJob(projection);
    if(projection.consumerType==="kb_images"){
      try{
        await syncCapturedVideos(projection.imageSetId,projection.workspaceId);
        const videos=await videoRows<{id:number}>(sql`SELECT id FROM kb_videos WHERE imageSetId=${projection.imageSetId} AND workspaceId=${projection.workspaceId} AND labelStatus='unlabeled' AND origin_instance_id='knowledge_video_v1'`);
        for(const video of videos)await enqueueVideoTags(projection,video.id);
      }catch{console.warn("[Knowledge] Video tags could not be queued; images and videos remain available");}
    }
    return { analysisJobRunId: job?.runId ?? null, analysisJobStatus: job?.status ?? null, analysisJobError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Amazon Acquisition] Consumer post-confirmation analysis could not be queued:", message);
    return { analysisJobRunId: null, analysisJobStatus: "failed_to_queue", analysisJobError: message };
  }
}
