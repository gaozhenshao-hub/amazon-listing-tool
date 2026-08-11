import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import type { AiJob, AiJobDeadLetter, InsertAiJob } from "../../../drizzle/schema";
import { aiJobDeadLetters, aiJobs, aiJobWorkers } from "../../../drizzle/schema";
import { requireDb, withDbTransaction, type DbExecutor } from "../dbClient";

function boundedLimit(value: number | undefined, fallback: number, max: number) {
  return Math.min(Math.max(value || fallback, 1), max);
}

export async function createAiJob(data: InsertAiJob) {
  const db = await requireDb("AI Job repository");
  const [result] = await db.insert(aiJobs).values(data);
  const rows = await db.select().from(aiJobs).where(eq(aiJobs.id, result.insertId)).limit(1);
  return rows[0];
}

export async function getAiJobByRunId(runId: string) {
  const db = await requireDb("AI Job repository");
  const rows = await db.select().from(aiJobs).where(eq(aiJobs.runId, runId)).limit(1);
  return rows[0] || null;
}

export async function updateAiJobByRunId(runId: string, data: Partial<InsertAiJob>) {
  const db = await requireDb("AI Job repository");
  await db.update(aiJobs).set(data).where(eq(aiJobs.runId, runId));
  const rows = await db.select().from(aiJobs).where(eq(aiJobs.runId, runId)).limit(1);
  return rows[0] || null;
}

export async function claimAiJobByRunId(
  runId: string,
  opts: { workerId: string; leaseSeconds?: number; progress?: number },
) {
  const db = await requireDb("AI Job repository");
  const leaseSeconds = Math.min(Math.max(opts.leaseSeconds || 900, 30), 7200);
  const progress = Math.min(Math.max(opts.progress ?? 10, 0), 99);
  await db.execute(sql`
    UPDATE ai_jobs
    SET
      status = 'running',
      progress = GREATEST(progress, ${progress}),
      attempt = attempt + 1,
      lockedBy = ${opts.workerId},
      leaseUntil = DATE_ADD(NOW(), INTERVAL ${leaseSeconds} SECOND),
      claimedAt = NOW(),
      lastHeartbeatAt = NOW(),
      startedAt = COALESCE(startedAt, NOW()),
      completedAt = NULL,
      errorMessage = NULL
    WHERE runId = ${runId}
      AND status IN ('queued', 'running')
      AND (nextRunAt IS NULL OR nextRunAt <= NOW())
      AND (lockedBy IS NULL OR lockedBy = ${opts.workerId} OR leaseUntil IS NULL OR leaseUntil < NOW())
  `);
  const rows = await db.select().from(aiJobs).where(eq(aiJobs.runId, runId)).limit(1);
  const job = rows[0] || null;
  return job && job.status === "running" && job.lockedBy === opts.workerId ? job : null;
}

export async function heartbeatAiJobLease(runId: string, workerId: string, leaseSeconds = 900) {
  const db = await requireDb("AI Job repository");
  const boundedLeaseSeconds = Math.min(Math.max(leaseSeconds, 30), 7200);
  await db.execute(sql`
    UPDATE ai_jobs
    SET leaseUntil = DATE_ADD(NOW(), INTERVAL ${boundedLeaseSeconds} SECOND), lastHeartbeatAt = NOW()
    WHERE runId = ${runId} AND lockedBy = ${workerId} AND status = 'running'
  `);
  const rows = await db.select().from(aiJobs).where(eq(aiJobs.runId, runId)).limit(1);
  return rows[0] || null;
}

export async function releaseAiJobLease(runId: string, workerId?: string) {
  const db = await requireDb("AI Job repository");
  if (workerId) {
    await db.execute(sql`
      UPDATE ai_jobs
      SET lockedBy = NULL, leaseUntil = NULL, lastHeartbeatAt = NULL
      WHERE runId = ${runId} AND lockedBy = ${workerId}
    `);
  } else {
    await db.execute(sql`
      UPDATE ai_jobs
      SET lockedBy = NULL, leaseUntil = NULL, lastHeartbeatAt = NULL
      WHERE runId = ${runId}
    `);
  }
  const rows = await db.select().from(aiJobs).where(eq(aiJobs.runId, runId)).limit(1);
  return rows[0] || null;
}

export async function retryAiJobByRunId(
  runId: string,
  data: { errorMessage: string; nextRunAt: Date; progress?: number },
) {
  const db = await requireDb("AI Job repository");
  await db
    .update(aiJobs)
    .set({
      status: "queued",
      progress: data.progress ?? 0,
      errorMessage: data.errorMessage,
      nextRunAt: data.nextRunAt,
      leaseUntil: null,
      lockedBy: null,
      claimedAt: null,
      lastHeartbeatAt: null,
      completedAt: null,
    })
    .where(eq(aiJobs.runId, runId));
  const rows = await db.select().from(aiJobs).where(eq(aiJobs.runId, runId)).limit(1);
  return rows[0] || null;
}

export async function listAiJobsForUser(
  userId: number,
  opts: { module?: string; projectId?: number; status?: InsertAiJob["status"]; limit?: number } = {},
) {
  const db = await requireDb("AI Job repository");
  const conditions = [
    eq(aiJobs.userId, userId),
    opts.module ? eq(aiJobs.module, opts.module) : undefined,
    opts.projectId ? eq(aiJobs.projectId, opts.projectId) : undefined,
    opts.status ? eq(aiJobs.status, opts.status) : undefined,
  ].filter(Boolean) as any[];
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  return db
    .select()
    .from(aiJobs)
    .where(where)
    .orderBy(desc(aiJobs.createdAt))
    .limit(boundedLimit(opts.limit, 20, 100));
}

export async function listRecoverableAiJobs(opts: { limit?: number } = {}) {
  const db = await requireDb("AI Job repository");
  const now = new Date();
  return db
    .select()
    .from(aiJobs)
    .where(
      or(
        and(eq(aiJobs.status, "queued"), or(isNull(aiJobs.nextRunAt), lt(aiJobs.nextRunAt, now))),
        and(eq(aiJobs.status, "running"), or(isNull(aiJobs.leaseUntil), lt(aiJobs.leaseUntil, now))),
      ),
    )
    .orderBy(desc(aiJobs.priority), asc(aiJobs.nextRunAt), asc(aiJobs.createdAt))
    .limit(boundedLimit(opts.limit, 50, 200));
}

export async function heartbeatAiJobWorker(input: {
  workerId: string;
  hostname?: string | null;
  pid?: number | null;
  role?: string | null;
  status?: "active" | "draining" | "stopped" | "unhealthy";
  concurrency?: number;
  runningCount?: number;
  metadata?: unknown;
}) {
  const db = await requireDb("AI Job repository");
  const concurrency = Math.min(Math.max(Math.floor(input.concurrency || 1), 1), 100);
  const runningCount = Math.min(Math.max(Math.floor(input.runningCount || 0), 0), 100);
  const status = input.status || "active";
  const metadata = JSON.stringify(input.metadata ?? {});
  await db.execute(sql`
    INSERT INTO ai_job_workers
      (workerId, hostname, pid, role, status, concurrency, runningCount, lastHeartbeatAt, startedAt, metadata)
    VALUES
      (${input.workerId}, ${input.hostname || null}, ${input.pid || null}, ${input.role || "worker"}, ${status}, ${concurrency}, ${runningCount}, NOW(), NOW(), ${metadata})
    ON DUPLICATE KEY UPDATE
      hostname = VALUES(hostname),
      pid = VALUES(pid),
      role = VALUES(role),
      status = VALUES(status),
      concurrency = VALUES(concurrency),
      runningCount = VALUES(runningCount),
      lastHeartbeatAt = NOW(),
      metadata = VALUES(metadata),
      stoppedAt = CASE WHEN VALUES(status) IN ('stopped','unhealthy') THEN NOW() ELSE NULL END,
      updatedAt = NOW()
  `);
}

export async function markAiJobWorkerStopped(
  workerId: string,
  status: "draining" | "stopped" | "unhealthy" = "stopped",
) {
  const db = await requireDb("AI Job repository");
  await db.execute(sql`
    UPDATE ai_job_workers
    SET status = ${status}, runningCount = 0, stoppedAt = NOW(), updatedAt = NOW()
    WHERE workerId = ${workerId}
  `);
}

export async function listAiJobWorkers(opts: { limit?: number } = {}) {
  const db = await requireDb("AI Job repository");
  return db
    .select()
    .from(aiJobWorkers)
    .orderBy(desc(aiJobWorkers.lastHeartbeatAt))
    .limit(boundedLimit(opts.limit, 50, 200));
}

export async function createAiJobDeadLetter(input: {
  job: AiJob;
  reason: string;
  metadata?: unknown;
}) {
  const metadata = JSON.stringify(input.metadata ?? {});
  await withDbTransaction("AI Job dead letter", async (tx: DbExecutor) => {
    await tx.execute(sql`
      INSERT INTO ai_job_dead_letters
        (workspaceId, runId, kind, module, \`procedure\`, status, attempt, maxAttempts, userId, projectId, skillSlug, errorMessage, input, metadata)
      VALUES
        (${(input.job as any).workspaceId ?? null}, ${input.job.runId}, ${input.job.kind}, ${input.job.module}, ${(input.job as any).procedure || null}, ${input.job.status},
         ${input.job.attempt || 0}, ${input.job.maxAttempts || 1}, ${input.job.userId}, ${input.job.projectId || null},
         ${input.job.skillSlug || null}, ${input.reason}, ${JSON.stringify(input.job.input ?? null)}, ${metadata})
      ON DUPLICATE KEY UPDATE
        status = VALUES(status),
        attempt = VALUES(attempt),
        maxAttempts = VALUES(maxAttempts),
        errorMessage = VALUES(errorMessage),
        metadata = VALUES(metadata)
    `);
    await tx
      .update(aiJobs)
      .set({
        deadLetterAt: new Date(),
        deadLetterReason: input.reason,
      } as Partial<InsertAiJob>)
      .where(eq(aiJobs.runId, input.job.runId));
  });
}

function buildDeadLetterQuery(db: DbExecutor, limit: number) {
  return db
    .select()
    .from(aiJobDeadLetters)
    .orderBy(desc(aiJobDeadLetters.createdAt))
    .limit(limit);
}

export async function listAiJobDeadLetters(opts: { limit?: number } = {}): Promise<AiJobDeadLetter[]> {
  const db = await requireDb("AI Job repository");
  return buildDeadLetterQuery(db, boundedLimit(opts.limit, 50, 200));
}
