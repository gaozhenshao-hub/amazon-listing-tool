import { startLegacyConsumerAnalysisJob } from "./legacyConsumerAnalysisJob";
import type { LegacyConsumerProjection } from "./legacyConsumerProjection";
import { enqueueAutomaticTags } from "../knowledge/automaticTagging";
import {enqueuePretranslation} from '../knowledge/pretranslationJob';

type Projection = LegacyConsumerProjection | { consumerType: "kb_images"; imageSetId: number; workspaceId: number; userId: number } | { consumerType: "image_workflow" } | null;

export async function triggerConsumerPostConfirmation(projection: Projection) {
  if (projection?.consumerType === "project_competitor" && projection.captureOnly) {
    try {
      if (!projection.analysisId) throw new Error("竞品资料尚未保存");
      const { analyzeCollectedListing } = await import("../listing/collectedListing");
      const job = await analyzeCollectedListing({projectId:projection.projectId,workspaceId:projection.workspaceId,userId:projection.userId,analysisId:projection.analysisId});
      return { analysisJobRunId: job.runId, analysisJobStatus: job.status, analysisJobError: null, collectedAnalysisId: projection.analysisId };
    } catch (error) {
      if(projection.analysisId)try{const {recordCompetitorAnalysisQueueFailure}=await import('../listing/collectedListing');await recordCompetitorAnalysisQueueFailure({projectId:projection.projectId,workspaceId:projection.workspaceId,userId:projection.userId,analysisId:projection.analysisId});}catch{console.warn('[Competitor] Could not record analysis queue failure');}
      return { analysisJobRunId:null,analysisJobStatus:"failed_to_queue",analysisJobError:error instanceof Error?error.message:"分析任务未能启动",collectedAnalysisId:projection.analysisId };
    }
  }
  if (!projection || projection.consumerType === "image_workflow" || projection.consumerType === "conversion_collector") {
    return { analysisJobRunId: null, analysisJobStatus: null, analysisJobError: null };
  }
  if(projection.consumerType==='kb_images'){
    try{await enqueuePretranslation({...projection,kind:'set',id:projection.imageSetId});}
    catch{console.warn('[Knowledge] Pretranslation could not be queued; saved assets remain available');}
  }
  try {
    const job = projection.consumerType === "kb_images" ? await enqueueAutomaticTags(projection) : await startLegacyConsumerAnalysisJob(projection);
    return { analysisJobRunId: job?.runId ?? null, analysisJobStatus: job?.status ?? null, analysisJobError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Amazon Acquisition] Consumer post-confirmation analysis could not be queued:", message);
    return { analysisJobRunId: null, analysisJobStatus: "failed_to_queue", analysisJobError: message };
  }
}
