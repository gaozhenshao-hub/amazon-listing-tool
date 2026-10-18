import "dotenv/config";
import "../routers/aiJobs";
import "../routers/imageWorkflow";
import "../domains/listing/services/generationJob";
import "../domains/listing/services/profileImportJob";
import "../domains/listing/services/competitorResearchJob";
import "../services/analysisImportJob";
import "../services/emperorAgentRunner";
import "../domains/product_development/analysis/informationSummaryService";
import "../domains/product_development/analysis/analysisStageJobService";
import "../domains/product_development/panorama/marketInsightService";
import "../domains/keyword/keywordGenerationJob";
import "../domains/video/videoGenerationJob";
import "../domains/acquisition/acquisitionJobs";
import "../domains/acquisition/legacyConsumerAnalysisJob";
import "../domains/acquisition/monitorJob";
import "../domains/image/services/competitorGalleryJob";
import "../domains/image/services/expressionLinkageJob";
import {
  drainAiJobQueue,
  getAiJobWorkerId,
  getAiJobRuntimeStatus,
  listAiJobHandlerRegistrations,
  markAiJobWorkerDraining,
  markAiJobWorkerStoppedStatus,
  startAiJobWorkerHeartbeat,
  waitForAiJobsToDrain,
} from "../services/aiJobRunner";
import { recoverTimedOutAgentNodes } from "../services/emperorAgentRunner";
import { assertStartupConfig } from "./startupValidation";
import { startInventoryCollectionWorker } from "../domains/ops/inventoryCollectionWorker";
import { startAssistantConversationWorker } from "../domains/ai_os/services/assistantConversationWorker";
import { startProfitAnalysisWorker } from "../domains/ops/profitAnalysisWorker";
import { startCompetitorDeepWorker } from "../domains/listing/services/competitorDeepWorker";
import { startImageTaggingWorker } from "../domains/knowledge/imageTaggingWorker";
import { startImagePlanningWorker } from "../domains/image/services/imagePlanningWorker";
import { startDevelopmentMarketWorker } from "../domains/product_development/analysis/developmentMarketWorker";
import { startKnowledgeQaWorker } from "../domains/knowledge/knowledgeQaWorker";
import { startVideoWorkflowWorker } from "../domains/video/videoWorkflowWorker";
import { startSaihuReportCaptureWorker } from "../domains/ops/saihuReportCaptureWorker";
import { startListingConfiguredWorker } from "../domains/listing/services/listingConfiguredWorker";
import { startListingAuxiliaryWorker } from "../domains/listing/services/listingAuxiliaryWorker";
import { observeDedicatedWorkerDrains } from "./dedicatedWorkerDrain";

const pollMs = Math.min(
  Math.max(Number(process.env.AI_JOB_WORKER_POLL_MS || 5000), 1000),
  60000
);
const jobLimit = Math.min(
  Math.max(Number(process.env.AI_JOB_WORKER_LIMIT || 25), 1),
  200
);
const nodeLimit = Math.min(
  Math.max(Number(process.env.AGENT_NODE_RECOVERY_LIMIT || 50), 1),
  200
);
const shutdownGraceMs = Math.min(
  Math.max(Number(process.env.AI_JOB_WORKER_SHUTDOWN_GRACE_MS || 30000), 1000),
  10 * 60_000
);

let stopped = false;
let running = false;
let stopHeartbeat: Awaited<
  ReturnType<typeof startAiJobWorkerHeartbeat>
> | null = null;

async function tick() {
  if (running || stopped) return;
  running = true;
  try {
    const jobs = await drainAiJobQueue({ limit: jobLimit });
    const nodes = await recoverTimedOutAgentNodes({ limit: nodeLimit });
    if (
      jobs.scheduled > 0 ||
      jobs.skippedWithoutHandler > 0 ||
      jobs.skippedNoCapacity > 0 ||
      nodes.failed > 0 ||
      nodes.retried > 0 ||
      nodes.skippedPaused > 0 ||
      nodes.skippedStale > 0
    ) {
      console.log(
        `[AI Worker] jobs scanned=${jobs.scanned}, scheduled=${jobs.scheduled}, skipped=${jobs.skippedWithoutHandler}, noCapacity=${jobs.skippedNoCapacity}; ` +
          `nodes scanned=${nodes.scanned}, retried=${nodes.retried}, failed=${nodes.failed}, skippedPaused=${nodes.skippedPaused}, skippedStale=${nodes.skippedStale}`
      );
    }
  } catch (error) {
    console.error("[AI Worker] tick failed:", error);
  } finally {
    running = false;
  }
}

async function main() {
  process.env.AI_JOB_RUNNER_MODE = process.env.AI_JOB_RUNNER_MODE || "worker";
  process.env.APP_PROCESS_ROLE = process.env.APP_PROCESS_ROLE || "worker";
  assertStartupConfig({ entrypoint: "worker", role: "worker" });
  const stopInventoryCollectionWorker = startInventoryCollectionWorker("worker");
  const stopAssistantConversationWorker = startAssistantConversationWorker("worker");
  const stopProfitAnalysisWorker = startProfitAnalysisWorker("worker");
  const stopCompetitorDeepWorker = startCompetitorDeepWorker("worker");
  const stopImageTaggingWorker = startImageTaggingWorker("worker");
  const imagePlanningWorker = startImagePlanningWorker("worker");
  const stopDevelopmentMarketWorker = startDevelopmentMarketWorker("worker");
  const knowledgeQaWorker = startKnowledgeQaWorker("worker");
  const videoWorkflowWorker = startVideoWorkflowWorker("worker");
  const stopSaihuReportCaptureWorker = startSaihuReportCaptureWorker("worker");
  const listingConfiguredWorker = startListingConfiguredWorker("worker");
  const listingAuxiliaryWorker = startListingAuxiliaryWorker("worker");
  const handlers = listAiJobHandlerRegistrations()
    .map(handler => handler.id)
    .join(", ");
  stopHeartbeat = startAiJobWorkerHeartbeat({
    metadata: {
      startedBy: "aiWorker",
      pollMs,
      jobLimit,
      nodeLimit,
      shutdownGraceMs,
    },
  });
  console.log(
    `[AI Worker] started workerId=${getAiJobWorkerId()} pollMs=${pollMs} ` +
      `concurrency=${getAiJobRuntimeStatus().maxConcurrency} handlers=${handlers || "none"}`
  );
  await tick();
  const interval = setInterval(() => {
    void tick();
  }, pollMs);

  const stop = async (signal: string) => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    const inventoryDrain = stopInventoryCollectionWorker();
    const conversationDrain = stopAssistantConversationWorker();
    const profitDrain = stopProfitAnalysisWorker();
    const competitorDeepDrain = stopCompetitorDeepWorker();
    const imageTaggingDrain = stopImageTaggingWorker();
    const imagePlanningDrain = imagePlanningWorker?.stop();
    const developmentMarketDrain = stopDevelopmentMarketWorker();
    const knowledgeQaDrain = knowledgeQaWorker?.stop(shutdownGraceMs);
    const videoWorkflowDrain = videoWorkflowWorker?.stop(shutdownGraceMs);
    const saihuReportDrain = stopSaihuReportCaptureWorker();
    const listingConfiguredDrain = listingConfiguredWorker?.stop(shutdownGraceMs);
    const listingAuxiliaryDrain = listingAuxiliaryWorker?.stop(shutdownGraceMs);
    // Observe every dedicated drain immediately: a timeout may reject while
    // the draining-status write is still pending. Preserve that rejection for
    // the awaited aggregate below instead of an unhandled premature exit.
    const dedicatedDrain = observeDedicatedWorkerDrains([inventoryDrain, conversationDrain, profitDrain, competitorDeepDrain, imageTaggingDrain, imagePlanningDrain, developmentMarketDrain, knowledgeQaDrain, videoWorkflowDrain, saihuReportDrain, listingConfiguredDrain, listingAuxiliaryDrain]);
    console.log(`[AI Worker] received ${signal}, draining in-flight jobs`);
    try {
      await markAiJobWorkerDraining({ signal });
      const [drainResult] = await Promise.all([waitForAiJobsToDrain(shutdownGraceMs), dedicatedDrain]);
      if (!drainResult.drained) {
        console.warn(
          `[AI Worker] shutdown grace elapsed; running=${drainResult.runningRunIds.join(",") || "none"} ` +
            `pending=${drainResult.pendingScheduleRunIds.join(",") || "none"}`
        );
      }
      await stopHeartbeat?.("stopped");
      await markAiJobWorkerStoppedStatus("stopped");
    } catch (error) {
      console.error("[AI Worker] graceful shutdown failed:", error);
      await stopHeartbeat?.("unhealthy").catch(() => null);
      await markAiJobWorkerStoppedStatus("unhealthy").catch(() => null);
      process.exitCode = 1;
    }
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

void main().catch(error => {
  console.error("[AI Worker] fatal:", error);
  process.exitCode = 1;
});
