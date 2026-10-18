import { sql } from "drizzle-orm";
import mysql from "mysql2/promise";
import { afterAll, describe, expect, it } from "vitest";
import { requireDb } from "./repositories/dbClient";
import {
  completeAiJob,
  createAiJobRun,
  drainAiJobQueue,
  getAiJobRun,
  getAiJobWorkerHealth,
  recoverAiJob,
  registerAiJobHandler,
  startRegisteredAiJob,
} from "./services/aiJobRunner";
import { runDataLifecycleArchive } from "./domains/ai_os/services/artifactLifecycle";
import { createSaihuReportExecutionLock, SAIHU_REPORT_EXECUTION_LOCK } from "./domains/ops/saihuReportExecutionLock";

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

  it("recovers an expired Worker lease without accepting the old attempt result", async () => {
    const job = await createAiJobRun({
      kind,
      module: "qa",
      procedure: "qa.worker.restart-recovery",
      userId: 1,
      input: { scenario: "worker-restart" },
      maxAttempts: 3,
      timeoutSeconds: 30,
    });
    createdRunIds.push(job.runId);

    const db = await requireDb("AI Worker restart fixture");
    await db.execute(sql`
      UPDATE ai_jobs
      SET status='running', attempt=1, progress=25, lockedBy='stopped_worker',
          leaseUntil=DATE_SUB(NOW(), INTERVAL 1 MINUTE), lastHeartbeatAt=DATE_SUB(NOW(), INTERVAL 2 MINUTE)
      WHERE runId=${job.runId}
    `);

    const drained = await drainAiJobQueue({ limit: 20 });
    expect(drained.scheduled).toBeGreaterThanOrEqual(1);
    const recovered = await waitForTerminal(job.runId);
    expect(recovered).toMatchObject({ status: "succeeded", attempt: 2 });

    await completeAiJob(
      job.runId,
      { stale: true },
      { expectedWorkerId: "stopped_worker", expectedAttempt: 1 },
    );
    const afterLateResult = await getAiJobRun(job.runId);
    expect(afterLateResult).toMatchObject({ status: "succeeded", attempt: 2 });
    expect(afterLateResult?.output).toMatchObject({ ok: true });
    expect(afterLateResult?.output).not.toMatchObject({ stale: true });
  }, 30_000);
});

/** These tests enter only through the original explicit disposable DB launcher.
 * No provider, business rows or candidate DDL are needed to verify the shared
 * native session-lock domain against an independent legacy-style connection. */
describe("real Saihu shared execution-session lock", () => {
  const connect = async () => {
    const raw = process.env.DATABASE_URL;
    expect(process.env.RUN_REAL_DB_TESTS).toBe("1");
    expect(process.env.NODE_ENV).toBe("test");
    if (!raw) throw new Error("Explicit synthetic database required");
    const target = new URL(raw);
    expect(target.protocol).toBe("mysql:");
    expect(["127.0.0.1", "[::1]"]).toContain(target.hostname);
    expect(target.pathname).toMatch(/^\/(?:amazon_listing_ci|amazon_fresh_[a-f0-9]{16}_synthetic)$/u);
    return mysql.createConnection({ uri: raw, connectTimeout: 5000, multipleStatements: false });
  };

  it("round-trips private Listing JSON wire bytes and extracts its queued scope without native number rewriting", async () => {
    const connection = await connect();
    try {
      const original = JSON.stringify({ request: { operationId: "0f2f05a0-7587-4dce-90b2-04954fe3e936" },
        source: { value: 0.8455124082255701, nested: [1.7976931348623157e+308, -0.0000000000000002, "中文", "a\\b\"c"] } });
      // Same codec as the new dedicated input/output and private artifacts.
      // It is deliberately not a migration or a rewrite of legacy JSON rows.
      const [result] = await connection.query<mysql.RowDataPacket[]>(
        "SELECT JSON_UNQUOTE(CAST(JSON_QUOTE(?) AS JSON)) AS wire,JSON_UNQUOTE(JSON_EXTRACT(JSON_UNQUOTE(CAST(JSON_QUOTE(?) AS JSON)),'$.request.operationId')) AS operationId",
        [original, original]
      );
      expect(result).toHaveLength(1);
      expect(result[0].wire).toBe(original);
      expect(result[0].operationId).toBe("0f2f05a0-7587-4dce-90b2-04954fe3e936");
    } finally { await connection.end(); }
  });

  it("shares the exact legacy lock across independent sessions and releases only its own lease", async () => {
    const legacy = await connect();
    const acquire = createSaihuReportExecutionLock({ connect });
    let lease: Awaited<ReturnType<typeof acquire>> = null;
    try {
      const [held] = await legacy.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?,0) AS acquired", [SAIHU_REPORT_EXECUTION_LOCK]);
      expect(held[0].acquired).toBe(1);
      expect(await acquire()).toBeNull();
      const [released] = await legacy.query<mysql.RowDataPacket[]>("SELECT RELEASE_LOCK(?) AS released", [SAIHU_REPORT_EXECUTION_LOCK]);
      expect(released[0].released).toBe(1);
      lease = await acquire(); expect(lease).not.toBeNull();
      await lease!.assertOwned();
      const db = await requireDb("Saihu native lock instance identity");
      await db.transaction(async tx => { await lease!.assertDatabase(tx); });
      const [busy] = await legacy.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?,0) AS acquired", [SAIHU_REPORT_EXECUTION_LOCK]);
      expect(busy[0].acquired).toBe(0);
      await lease!.release();
      // Native success here proves the prior holder really released ownership,
      // rather than only clearing a local timer or boolean.
      const [available] = await legacy.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?,1) AS acquired", [SAIHU_REPORT_EXECUTION_LOCK]);
      expect(available[0].acquired).toBe(1);
      await lease!.release();
      const [stillHeld] = await legacy.query<mysql.RowDataPacket[]>("SELECT IS_USED_LOCK(?)=CONNECTION_ID() AS owned", [SAIHU_REPORT_EXECUTION_LOCK]);
      expect(stillHeld[0].owned).toBe(1);
    } finally {
      await lease?.release();
      await legacy.end();
    }
  });

  it("cannot claim ownership after its native connection closes and leaves no lock behind", async () => {
    const created: mysql.Connection[] = [];
    const acquire = createSaihuReportExecutionLock({ connect: async () => {
      const connection = await connect(); created.push(connection); return connection;
    } });
    const lease = await acquire();
    expect(lease).not.toBeNull();
    try {
      await created[0].end();
      await expect(lease!.assertOwned()).rejects.toMatchObject({ code: "EXECUTION_LOCK_LOST" });
      expect(lease!.signal.aborted).toBe(true);
      await lease!.release();
      const observer = await connect();
      try {
        const [rows] = await observer.query<mysql.RowDataPacket[]>("SELECT GET_LOCK(?,1) AS acquired", [SAIHU_REPORT_EXECUTION_LOCK]);
        expect(rows[0].acquired).toBe(1);
      } finally { await observer.end(); }
    } finally { await lease!.release(); }
  });
});
