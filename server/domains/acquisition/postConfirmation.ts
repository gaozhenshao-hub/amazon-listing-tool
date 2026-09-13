import { startLegacyConsumerAnalysisJob } from "./legacyConsumerAnalysisJob";
import type { LegacyConsumerProjection } from "./legacyConsumerProjection";

type Projection = LegacyConsumerProjection | { consumerType: "kb_images" } | null;

export async function triggerConsumerPostConfirmation(projection: Projection) {
  if (!projection || projection.consumerType === "kb_images" || projection.consumerType === "conversion_collector") {
    return { analysisJobRunId: null, analysisJobStatus: null, analysisJobError: null };
  }
  try {
    const job = await startLegacyConsumerAnalysisJob(projection);
    return { analysisJobRunId: job?.runId ?? null, analysisJobStatus: job?.status ?? null, analysisJobError: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[Amazon Acquisition] Consumer post-confirmation analysis could not be queued:", message);
    return { analysisJobRunId: null, analysisJobStatus: "failed_to_queue", analysisJobError: message };
  }
}
