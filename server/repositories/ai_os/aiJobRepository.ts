import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { PROFILE_IMPORT_JOB_KIND } from "../../../shared/profileImportJob";
import { COMPETITOR_RESEARCH_JOB_KIND } from "../../../shared/competitorResearchJob";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../../../shared/competitorDeepExecutionJob";
import { isCheckpointedListingJob } from "../../../shared/checkpointedListingJob";
import type { AiJob, AiJobDeadLetter, InsertAiJob } from "../../../drizzle/schema";
import { aiJobDeadLetters, aiJobs, aiJobWorkers } from "../../../drizzle/schema";
import { requireDb, withDbTransaction, type DbExecutor } from "../dbClient";
import { PRIVATE_IMAGE_TAGGING_JOB_KIND, assertGenericAiJobKind } from "./dedicatedJobPolicy";

function boundedLimit(value: number | undefined, fallback: number, max: number) {
  return Math.min(Math.max(value || fallback, 1), max);
}

export async function createAiJob(data: InsertAiJob) {
  assertGenericAiJobKind(data.kind);
  const db = await requireDb("AI Job repository");
  const [result] = await db.insert(aiJobs).values(data);
  const rows = await db.select().from(aiJobs).where(eq(aiJobs.id, result.insertId)).limit(1);
  return rows[0];
}

export async function getAiJobByRunId(runId: string) {
  const db = await requireDb("AI Job repository");
  const rows = await db.select().from(aiJobs).where(and(eq(aiJobs.runId, runId), ne(aiJobs.kind, PRIVATE_IMAGE_TAGGING_JOB_KIND))).limit(1);
  return rows[0] || null;
}

export async function updateAiJobByRunId(runId: string, data: Partial<InsertAiJob>) {
  assertGenericAiJobKind(data.kind);
  const db = await requireDb("AI Job repository");
  await db.update(aiJobs).set(data).where(and(eq(aiJobs.runId, runId), ne(aiJobs.kind, PRIVATE_IMAGE_TAGGING_JOB_KIND)));
  return getAiJobByRunId(runId);
}

/** Shared lease fence for profile conversion and both selected competitor lanes.
 * The historical export name is retained for existing runner integrations.
 * No lane's private checkpoint or committed receipt is changed here. */
export async function updateOwnedProfileImportJob(
  runId: string,
  change: { type: "progress"; progress: number } | { type: "fail"; errorMessage: string }
    | { type: "heartbeat"; leaseSeconds: number } | { type: "release" },
  guard: { expectedWorkerId?: string; expectedAttempt?: number },
) {
  if (typeof guard.expectedWorkerId !== "string" || !guard.expectedWorkerId.trim()
    || guard.expectedWorkerId.length > 128 || !Number.isSafeInteger(guard.expectedAttempt)
    || (guard.expectedAttempt ?? 0) < 1) return null;
  if (change.type === "progress" && !Number.isFinite(change.progress)) return null;
  if (change.type === "heartbeat" && !Number.isFinite(change.leaseSeconds)) return null;
  const db = await requireDb("Profile import owned job update");
  const values = change.type === "progress"
    ? { progress: Math.min(Math.max(Math.floor(change.progress), 0), 99), lastHeartbeatAt: new Date() }
    : change.type === "heartbeat"
      ? { leaseUntil: sql`DATE_ADD(NOW(), INTERVAL ${Math.min(Math.max(Math.floor(change.leaseSeconds), 30), 7200)} SECOND)`, lastHeartbeatAt: new Date() }
      : change.type === "release"
        ? { leaseUntil: null, lockedBy: null, lastHeartbeatAt: null }
        : { status: "failed" as const, progress: 100, errorMessage: change.errorMessage,
      leaseUntil: null, lockedBy: null, lastHeartbeatAt: null, completedAt: new Date() };
  const [result] = await db.update(aiJobs).set(values).where(and(
    eq(aiJobs.runId, runId), inArray(aiJobs.kind, [PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND, COMPETITOR_DEEP_EXECUTION_JOB_KIND]), eq(aiJobs.status, "running"),
    eq(aiJobs.lockedBy, guard.expectedWorkerId), eq(aiJobs.attempt, guard.expectedAttempt!),
    gt(aiJobs.leaseUntil, sql`NOW()`),
  ));
  if (result.affectedRows !== 1) return null;
  return getAiJobByRunId(runId);
}

export async function claimAiJobByRunId(
  runId: string,
  opts: { workerId: string; leaseSeconds?: number; progress?: number },
) {
  const db = await requireDb("AI Job repository");
  const leaseSeconds = Math.min(Math.max(opts.leaseSeconds || 900, 30), 7200);
  const progress = Math.min(Math.max(opts.progress ?? 10, 0), 99);
  const result = await db.execute(sql`
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
      AND kind <> ${PRIVATE_IMAGE_TAGGING_JOB_KIND}
      AND status IN ('queued', 'running')
      AND (nextRunAt IS NULL OR nextRunAt <= NOW())
      AND (lockedBy IS NULL OR lockedBy = ${opts.workerId} OR leaseUntil IS NULL OR leaseUntil < NOW())
      AND (kind NOT IN (${PROFILE_IMPORT_JOB_KIND}, ${COMPETITOR_RESEARCH_JOB_KIND}, ${COMPETITOR_DEEP_EXECUTION_JOB_KIND}) OR
        (status = 'queued' AND lockedBy IS NULL AND leaseUntil IS NULL) OR
        (status = 'running' AND leaseUntil < NOW()))
  `);
  const job = await getAiJobByRunId(runId);
  if (isCheckpointedListingJob(job?.kind) && (result[0] as { affectedRows?: number })?.affectedRows !== 1) return null;
  return job && job.status === "running" && job.lockedBy === opts.workerId ? job : null;
}

export async function heartbeatAiJobLease(runId: string, workerId: string, leaseSeconds = 900) {
  const db = await requireDb("AI Job repository");
  const boundedLeaseSeconds = Math.min(Math.max(leaseSeconds, 30), 7200);
  await db.execute(sql`
    UPDATE ai_jobs
    SET leaseUntil = DATE_ADD(NOW(), INTERVAL ${boundedLeaseSeconds} SECOND), lastHeartbeatAt = NOW()
    WHERE runId = ${runId} AND lockedBy = ${workerId} AND status = 'running' AND kind <> ${PRIVATE_IMAGE_TAGGING_JOB_KIND}
  `);
  return getAiJobByRunId(runId);
}

export async function releaseAiJobLease(runId: string, workerId?: string) {
  const db = await requireDb("AI Job repository");
  if (workerId) {
    await db.execute(sql`
      UPDATE ai_jobs
      SET lockedBy = NULL, leaseUntil = NULL, lastHeartbeatAt = NULL
      WHERE runId = ${runId} AND lockedBy = ${workerId} AND kind <> ${PRIVATE_IMAGE_TAGGING_JOB_KIND}
    `);
  } else {
    await db.execute(sql`
      UPDATE ai_jobs
      SET lockedBy = NULL, leaseUntil = NULL, lastHeartbeatAt = NULL
      WHERE runId = ${runId} AND kind <> ${PRIVATE_IMAGE_TAGGING_JOB_KIND}
    `);
  }
  return getAiJobByRunId(runId);
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
    .where(and(eq(aiJobs.runId, runId), ne(aiJobs.kind, PRIVATE_IMAGE_TAGGING_JOB_KIND)));
  return getAiJobByRunId(runId);
}

export async function listAiJobsForUser(
  userId: number,
  opts: { module?: string; projectId?: number; status?: InsertAiJob["status"]; limit?: number } = {},
) {
  const db = await requireDb("AI Job repository");
  const conditions = [
    eq(aiJobs.userId, userId),
    ne(aiJobs.kind, PRIVATE_IMAGE_TAGGING_JOB_KIND),
    opts.module ? eq(aiJobs.module, opts.module) : undefined,
    opts.projectId ? eq(aiJobs.projectId, opts.projectId) : undefined,
    opts.status ? eq(aiJobs.status, opts.status) : undefined,
  ].filter(Boolean) as any[];
  const where = conditions.length === 1 ? conditions[0] : and(...conditions);
  return db
    .select()
    .from(aiJobs)
    .where(where)
    .orderBy(desc(aiJobs.createdAt), desc(aiJobs.id))
    .limit(boundedLimit(opts.limit, 20, 100));
}

export async function listRecoverableAiJobs(opts: { limit?: number } = {}) {
  const db = await requireDb("AI Job repository");
  const now = new Date();
  const recoverable = and(or(
    and(eq(aiJobs.status, "queued"), or(isNull(aiJobs.nextRunAt), lt(aiJobs.nextRunAt, now))),
    and(eq(aiJobs.status, "running"), or(isNull(aiJobs.leaseUntil), lt(aiJobs.leaseUntil, now))),
  ), ne(aiJobs.kind, COMPETITOR_DEEP_EXECUTION_JOB_KIND), ne(aiJobs.kind, PRIVATE_IMAGE_TAGGING_JOB_KIND));
  // Deep research has a dedicated metadata-only lane and immutable per-stage
  // dispatch fences. Never hydrate its large private checkpoints here, even
  // while that lane is disabled; it must not crowd out ordinary imports.
  // Keep large input/output JSON out of MySQL's filesort buffer.
  const candidates = await db
    .select({ id: aiJobs.id })
    .from(aiJobs)
    .where(recoverable)
    .orderBy(desc(aiJobs.priority), asc(aiJobs.nextRunAt), asc(aiJobs.createdAt))
    .limit(boundedLimit(opts.limit, 50, 200));
  if (candidates.length === 0) return [];

  const rows = await db
    .select()
    .from(aiJobs)
    .where(and(inArray(aiJobs.id, candidates.map(({ id }) => id)), recoverable));
  const rowsById = new Map(rows.map((row) => [row.id, row]));
  // Restore order without sorting payloads in SQL; missing/ineligible rows are
  // skipped, and the atomic claim still decides execution ownership.
  return candidates.flatMap(({ id }) => {
    const row = rowsById.get(id);
    return row ? [row] : [];
  });
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
  assertGenericAiJobKind(input.job.kind);
  const metadata = JSON.stringify(input.metadata ?? {});
  await withDbTransaction("AI Job dead letter", async (tx: DbExecutor) => {
    await tx.execute(sql`
      INSERT INTO ai_job_dead_letters
        (workspaceId, runId, kind, module, \`procedure\`, status, attempt, maxAttempts, userId, projectId, skillSlug, errorMessage, input, metadata)
      SELECT
        ${(input.job as any).workspaceId ?? null}, ${input.job.runId}, ${input.job.kind}, ${input.job.module}, ${(input.job as any).procedure || null}, ${input.job.status},
         ${input.job.attempt || 0}, ${input.job.maxAttempts || 1}, ${input.job.userId}, ${input.job.projectId || null},
         ${input.job.skillSlug || null}, ${input.reason}, ${JSON.stringify(input.job.input ?? null)}, ${metadata}
      WHERE EXISTS (SELECT 1 FROM ai_jobs WHERE runId=${input.job.runId} AND kind<>${PRIVATE_IMAGE_TAGGING_JOB_KIND})
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
      .where(and(eq(aiJobs.runId, input.job.runId), ne(aiJobs.kind, PRIVATE_IMAGE_TAGGING_JOB_KIND)));
  });
}

function buildDeadLetterQuery(db: DbExecutor, limit: number) {
  return db
    .select()
    .from(aiJobDeadLetters)
    .where(ne(aiJobDeadLetters.kind, PRIVATE_IMAGE_TAGGING_JOB_KIND))
    .orderBy(desc(aiJobDeadLetters.createdAt))
    .limit(limit);
}

export async function listAiJobDeadLetters(opts: { limit?: number } = {}): Promise<AiJobDeadLetter[]> {
  const db = await requireDb("AI Job repository");
  return buildDeadLetterQuery(db, boundedLimit(opts.limit, 50, 200));
}
