import "dotenv/config";
import "../routers/aiJobs";
import "../routers/imageWorkflow";
import "../services/emperorAgentRunner";
import {
  getAiJobWorkerId,
  listAiJobHandlerRegistrations,
  recoverActiveAiJobs,
} from "../services/aiJobRunner";
import { recoverTimedOutAgentNodes } from "../services/emperorAgentRunner";

const pollMs = Math.min(Math.max(Number(process.env.AI_JOB_WORKER_POLL_MS || 5000), 1000), 60000);
const jobLimit = Math.min(Math.max(Number(process.env.AI_JOB_WORKER_LIMIT || 25), 1), 200);
const nodeLimit = Math.min(Math.max(Number(process.env.AGENT_NODE_RECOVERY_LIMIT || 50), 1), 200);

let stopped = false;
let running = false;

async function tick() {
  if (running || stopped) return;
  running = true;
  try {
    const jobs = await recoverActiveAiJobs({ limit: jobLimit });
    const nodes = await recoverTimedOutAgentNodes({ limit: nodeLimit });
    if (jobs.scheduled > 0 || jobs.skippedWithoutHandler > 0 || nodes.failed > 0 || nodes.skippedPaused > 0) {
      console.log(
        `[AI Worker] jobs scanned=${jobs.scanned}, scheduled=${jobs.scheduled}, skipped=${jobs.skippedWithoutHandler}; `
        + `nodes scanned=${nodes.scanned}, failed=${nodes.failed}, skippedPaused=${nodes.skippedPaused}`,
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
  const handlers = listAiJobHandlerRegistrations().map((handler) => handler.id).join(", ");
  console.log(`[AI Worker] started workerId=${getAiJobWorkerId()} pollMs=${pollMs} handlers=${handlers || "none"}`);
  await tick();
  const interval = setInterval(() => {
    void tick();
  }, pollMs);

  const stop = async (signal: string) => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval);
    console.log(`[AI Worker] received ${signal}, shutting down`);
  };
  process.once("SIGINT", () => void stop("SIGINT"));
  process.once("SIGTERM", () => void stop("SIGTERM"));
}

void main().catch((error) => {
  console.error("[AI Worker] fatal:", error);
  process.exitCode = 1;
});
