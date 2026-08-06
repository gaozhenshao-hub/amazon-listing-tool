import { sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { requireDb } from "./repositories/dbClient";
import {
  getAiJobRun,
  getAiJobWorkerHealth,
  recoverAiJob,
  registerAiJobHandler,
  startRegisteredAiJob,
} from "./services/aiJobRunner";
import { runDataLifecycleArchive } from "./domains/ai_os/services/artifactLifecycle";

const kind = `qa.worker.db.${Date.now()}`;
const createdRunIds: string[] = [];

async function waitForTerminal(runId: string) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const job = await getAiJobRun(runId);
    if (job && ["succeeded", "failed", "canceled"].includes(job.status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`AI job did not finish in time: ${runId}`);
}

registerAiJobHandler({
  id: kind,
  match: (job) => job.kind === kind,
  handler: async (job) => ({ ok: true, input: job.input }),
});

afterAll(async () => {
  const db = await requireDb("AI Worker integration cleanup");
  for (const runId of createdRunIds) {
    await db.execute(sql`DELETE FROM ai_job_dead_letters WHERE runId = ${runId}`);
    await db.execute(sql`DELETE FROM emperor_ai_os_metrics WHERE entityId = ${runId}`);
    await db.execute(sql`DELETE FROM ai_data_archive_items WHERE sourceTable = 'ai_jobs' AND sourceId = ${runId}`);
    await db.execute(sql`DELETE FROM ai_jobs WHERE runId = ${runId}`);
  }
});

describe("real AI Worker and MySQL integration", () => {
  it("persists execution, heartbeat, failure recovery, and lifecycle archival", async () => {
    const first = await startRegisteredAiJob({
      kind,
      module: "qa",
      procedure: "qa.worker.database",
      userId: 1,
      input: { value: 42 },
      maxAttempts: 2,
      timeoutSeconds: 30,
    });
    createdRunIds.push(first.runId);
    expect(await waitForTerminal(first.runId)).toMatchObject({ status: "succeeded", progress: 100 });

    const workerHealth = await getAiJobWorkerHealth({ limit: 20 });
    expect(workerHealth.workers.some((worker) => worker.lastHeartbeatAt)).toBe(true);

    const db = await requireDb("AI Worker integration failure fixture");
    await db.execute(sql`UPDATE ai_jobs SET status='failed', errorMessage='qa failure', completedAt=NOW() WHERE runId=${first.runId}`);
    const recovered = await recoverAiJob(first.runId, "QA recovery verification");
    createdRunIds.push(recovered.runId);
    expect(recovered).toMatchObject({ recoveryOfRunId: first.runId, recoveryReason: "QA recovery verification" });
    expect(await waitForTerminal(recovered.runId)).toMatchObject({ status: "succeeded" });

    await db.execute(sql`
      UPDATE ai_jobs
      SET createdAt=DATE_SUB(NOW(), INTERVAL 200 DAY), archiveAfter=DATE_SUB(NOW(), INTERVAL 1 DAY)
      WHERE runId=${recovered.runId}
    `);
    const archived = await runDataLifecycleArchive({
      policySlug: "ai_jobs.completed",
      mode: "archive",
      batchSize: 100,
    });
    expect(archived.archivedCount).toBeGreaterThanOrEqual(1);
    expect(await getAiJobRun(recovered.runId)).toMatchObject({ status: "succeeded" });
    const [rows] = await db.execute(sql`SELECT retentionClass FROM ai_jobs WHERE runId=${recovered.runId}`) as any;
    expect((Array.isArray(rows) ? rows[0] : null)?.retentionClass).toBe("archive");
  }, 30_000);
});
