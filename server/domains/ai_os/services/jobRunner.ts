import type { AiJob, AiJobDeadLetter, AiJobWorker, InsertAiJob } from "../../../../drizzle/schema";
import os from "os";
import {
  claimAiJobByRunId,
  createAiJob,
  createAiJobDeadLetter,
  getAiJobByRunId,
  heartbeatAiJobWorker,
  heartbeatAiJobLease,
  listAiJobDeadLetters,
  listAiJobWorkers,
  listRecoverableAiJobs,
  markAiJobWorkerStopped,
  releaseAiJobLease,
  retryAiJobByRunId,
  updateAiJobByRunId,
} from "../../../repositories/ai_os";
import { shouldStartWorkerTasks } from "../../../_core/runtime";
import { recordAiOsMetric } from "./observability";

export type AiJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type AiJobSnapshot = {
  runId: string;
  kind: string;
  module: string;
  procedure: string | null;
  status: AiJobStatus;
  progress: number;
  priority: number;
  queueName: string;
  attempt: number;
  maxAttempts: number;
  timeoutSeconds: number;
  userId: number;
  projectId: number | null;
  skillSlug: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  nextRunAt: Date | null;
  leaseUntil: Date | null;
  lockedBy: string | null;
  claimedAt: Date | null;
  lastHeartbeatAt: Date | null;
  deadLetterAt: Date | null;
  deadLetterReason: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiJobHandler<T = unknown> = (job: AiJobSnapshot) => Promise<T>;

export type AiJobMutationGuard = {
  expectedWorkerId?: string;
  expectedAttempt?: number;
};

export type AiJobHandlerRegistration = {
  id: string;
  match: (job: AiJobSnapshot) => boolean;
  handler: AiJobHandler;
  recoverable?: boolean;
};

const ACTIVE_STATUSES = new Set<AiJobStatus>(["queued", "running"]);
const handlerRegistrations = new Map<string, AiJobHandlerRegistration>();
const runningRunIds = new Set<string>();
const pendingScheduleRunIds = new Set<string>();
const activeAbortControllers = new Map<string, AbortController>();
let aiJobQueueDraining = false;
const DEFAULT_WORKER_LEASE_SECONDS = 15 * 60;
const DEFAULT_JOB_TIMEOUT_SECONDS = 10 * 60;
const DEFAULT_WORKER_HEARTBEAT_MS = 30_000;
const DEFAULT_WORKER_STALE_MS = 2 * 60_000;
const DEFAULT_SHUTDOWN_GRACE_MS = 30_000;
const WORKER_ID = `web_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;

export function isActiveAiJob(status?: string | null): boolean {
  return ACTIVE_STATUSES.has((status || "queued") as AiJobStatus);
}

export function registerAiJobHandler(registration: AiJobHandlerRegistration) {
  handlerRegistrations.set(registration.id, {
    ...registration,
    recoverable: registration.recoverable !== false,
  });
}

export function listAiJobHandlerRegistrations() {
  return [...handlerRegistrations.values()].map(({ id, recoverable }) => ({ id, recoverable: recoverable !== false }));
}

export function resolveAiJobHandler(job: AiJobSnapshot): AiJobHandler | null {
  for (const registration of handlerRegistrations.values()) {
    if (registration.match(job)) return registration.handler;
  }
  return null;
}

export function generateAiJobRunId(prefix = "ai"): string {
  const normalizedPrefix = prefix.replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 24) || "ai";
  return `${normalizedPrefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function serializeAiJobError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return "Unknown AI job error";
  }
}

function aiJobMutationAllowed(job: AiJobSnapshot | null, guard: AiJobMutationGuard = {}) {
  if (!job) return false;
  if (guard.expectedWorkerId && job.lockedBy !== guard.expectedWorkerId) return false;
  if (guard.expectedAttempt !== undefined && guard.expectedAttempt !== null && job.attempt !== guard.expectedAttempt) return false;
  return true;
}

export function getAiJobWorkerId() {
  return WORKER_ID;
}

export function isAiJobSchedulingEnabled() {
  return !aiJobQueueDraining
    && shouldStartWorkerTasks()
    && process.env.AI_JOB_RUNNER_MODE !== "external"
    && process.env.AI_JOB_IN_PROCESS !== "false";
}

export function getMaxConcurrentAiJobs() {
  const value = Number(process.env.AI_JOB_MAX_CONCURRENCY || process.env.AI_JOB_WORKER_CONCURRENCY || 2);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 1), 25) : 2;
}

export function getAvailableAiJobSlots() {
  return Math.max(getMaxConcurrentAiJobs() - runningRunIds.size - pendingScheduleRunIds.size, 0);
}

export function getAiJobRuntimeStatus() {
  return {
    workerId: WORKER_ID,
    role: process.env.AI_JOB_RUNNER_MODE === "worker" ? "worker" : "web",
    schedulingEnabled: isAiJobSchedulingEnabled(),
    draining: aiJobQueueDraining,
    maxConcurrency: getMaxConcurrentAiJobs(),
    availableSlots: getAvailableAiJobSlots(),
    runningCount: runningRunIds.size,
    pendingScheduleCount: pendingScheduleRunIds.size,
    runningRunIds: [...runningRunIds],
    pendingScheduleRunIds: [...pendingScheduleRunIds],
    registeredHandlers: listAiJobHandlerRegistrations(),
  };
}

function getWorkerHeartbeatMs() {
  const value = Number(process.env.AI_JOB_WORKER_HEARTBEAT_MS || DEFAULT_WORKER_HEARTBEAT_MS);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 5_000), 5 * 60_000) : DEFAULT_WORKER_HEARTBEAT_MS;
}

function getWorkerStaleMs() {
  const value = Number(process.env.AI_JOB_WORKER_STALE_MS || DEFAULT_WORKER_STALE_MS);
  return Number.isFinite(value) ? Math.min(Math.max(Math.floor(value), 15_000), 30 * 60_000) : DEFAULT_WORKER_STALE_MS;
}

function getWorkerRole() {
  return process.env.AI_JOB_RUNNER_MODE === "worker" ? "worker" : "web";
}

export async function reportAiJobWorkerHeartbeat(input: {
  status?: "active" | "draining" | "stopped" | "unhealthy";
  metadata?: unknown;
} = {}) {
  await heartbeatAiJobWorker({
    workerId: WORKER_ID,
    hostname: os.hostname(),
    pid: process.pid,
    role: getWorkerRole(),
    status: input.status || (aiJobQueueDraining ? "draining" : "active"),
    concurrency: getMaxConcurrentAiJobs(),
    runningCount: runningRunIds.size,
    metadata: {
      ...getAiJobRuntimeStatus(),
      ...(input.metadata && typeof input.metadata === "object" ? input.metadata as Record<string, unknown> : { metadata: input.metadata }),
    },
  });
}

export function startAiJobWorkerHeartbeat(opts: { intervalMs?: number; metadata?: unknown } = {}) {
  let stopped = false;
  const intervalMs = Math.min(Math.max(Math.floor(opts.intervalMs || getWorkerHeartbeatMs()), 5_000), 5 * 60_000);
  const beat = async () => {
    if (stopped) return;
    try {
      await reportAiJobWorkerHeartbeat({ metadata: opts.metadata });
    } catch (error) {
      console.warn("[AI Job] worker heartbeat failed:", error);
    }
  };

  void beat();
  const interval = setInterval(() => {
    void beat();
  }, intervalMs);
  (interval as any).unref?.();

  return async (status: "stopped" | "unhealthy" = "stopped") => {
    stopped = true;
    clearInterval(interval);
    try {
      await markAiJobWorkerStopped(WORKER_ID, status);
    } catch (error) {
      console.warn("[AI Job] failed to mark worker stopped:", error);
    }
  };
}

export async function markAiJobWorkerDraining(metadata?: unknown) {
  aiJobQueueDraining = true;
  await reportAiJobWorkerHeartbeat({ status: "draining", metadata });
  return getAiJobRuntimeStatus();
}

export async function markAiJobWorkerStoppedStatus(status: "stopped" | "unhealthy" = "stopped") {
  aiJobQueueDraining = true;
  await markAiJobWorkerStopped(WORKER_ID, status);
  return getAiJobRuntimeStatus();
}

export async function waitForAiJobsToDrain(timeoutMs = DEFAULT_SHUTDOWN_GRACE_MS) {
  const deadline = Date.now() + Math.min(Math.max(Math.floor(timeoutMs), 1_000), 10 * 60_000);
  while (Date.now() < deadline) {
    if (runningRunIds.size === 0 && pendingScheduleRunIds.size === 0) {
      return {
        drained: true,
        runningRunIds: [] as string[],
        pendingScheduleRunIds: [] as string[],
      };
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return {
    drained: runningRunIds.size === 0 && pendingScheduleRunIds.size === 0,
    runningRunIds: [...runningRunIds],
    pendingScheduleRunIds: [...pendingScheduleRunIds],
  };
}

function buildWorkerHealthSnapshot(row: AiJobWorker, checkedAt: Date, staleAfterMs: number) {
  const lastHeartbeatAt = row.lastHeartbeatAt || null;
  const heartbeatAgeMs = lastHeartbeatAt ? checkedAt.getTime() - lastHeartbeatAt.getTime() : null;
  const stale = row.status !== "stopped" && (heartbeatAgeMs === null || heartbeatAgeMs > staleAfterMs);
  return {
    workerId: row.workerId,
    hostname: row.hostname || null,
    pid: row.pid ?? null,
    role: row.role,
    status: row.status,
    effectiveStatus: stale ? "unhealthy" : row.status,
    concurrency: Number(row.concurrency || 1),
    runningCount: Number(row.runningCount || 0),
    lastHeartbeatAt,
    heartbeatAgeMs,
    stale,
    startedAt: row.startedAt,
    stoppedAt: row.stoppedAt || null,
    metadata: normalizeJsonValue(row.metadata),
    updatedAt: row.updatedAt,
  };
}

export async function getAiJobWorkerHealth(opts: { limit?: number; staleAfterMs?: number } = {}) {
  const checkedAt = new Date();
  const staleAfterMs = Math.min(Math.max(Math.floor(opts.staleAfterMs || getWorkerStaleMs()), 15_000), 30 * 60_000);
  const workers = (await listAiJobWorkers({ limit: opts.limit })).map((row) => buildWorkerHealthSnapshot(row, checkedAt, staleAfterMs));
  return {
    checkedAt,
    staleAfterMs,
    workerId: WORKER_ID,
    healthyCount: workers.filter((worker) => worker.effectiveStatus === "active").length,
    staleCount: workers.filter((worker) => worker.stale).length,
    unhealthyCount: workers.filter((worker) => worker.effectiveStatus === "unhealthy").length,
    drainingCount: workers.filter((worker) => worker.effectiveStatus === "draining").length,
    stoppedCount: workers.filter((worker) => worker.effectiveStatus === "stopped").length,
    workers,
  };
}

function buildDeadLetterSnapshot(row: AiJobDeadLetter) {
  return {
    ...row,
    input: normalizeJsonValue(row.input),
    metadata: normalizeJsonValue(row.metadata),
  };
}

export async function listAiJobDeadLetterRuns(opts: { limit?: number } = {}) {
  const rows = await listAiJobDeadLetters({ limit: opts.limit });
  return rows.map(buildDeadLetterSnapshot);
}

export function calculateAiJobRetryDelayMs(attempt: number): number {
  const boundedAttempt = Math.min(Math.max(attempt, 1), 6);
  return Math.min(30_000 * 2 ** (boundedAttempt - 1), 10 * 60_000);
}

function normalizeJsonValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

export function buildAiJobSnapshot(job: AiJob): AiJobSnapshot {
  return {
    runId: job.runId,
    kind: job.kind,
    module: job.module,
    procedure: job.procedure || null,
    status: job.status as AiJobStatus,
    progress: Number(job.progress || 0),
    priority: Number((job as any).priority || 0),
    queueName: String((job as any).queueName || "default"),
    attempt: Number((job as any).attempt || 0),
    maxAttempts: Number((job as any).maxAttempts || 1),
    timeoutSeconds: Number((job as any).timeoutSeconds || DEFAULT_JOB_TIMEOUT_SECONDS),
    userId: job.userId,
    projectId: job.projectId ?? null,
    skillSlug: job.skillSlug || null,
    input: normalizeJsonValue(job.input),
    output: normalizeJsonValue(job.output),
    error: job.errorMessage || null,
    nextRunAt: (job as any).nextRunAt || null,
    leaseUntil: (job as any).leaseUntil || null,
    lockedBy: (job as any).lockedBy || null,
    claimedAt: (job as any).claimedAt || null,
    lastHeartbeatAt: (job as any).lastHeartbeatAt || null,
    deadLetterAt: (job as any).deadLetterAt || null,
    deadLetterReason: (job as any).deadLetterReason || null,
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  };
}

export async function createAiJobRun(input: {
  runId?: string;
  kind: string;
  module: string;
  procedure?: string | null;
  userId: number;
  projectId?: number | null;
  skillSlug?: string | null;
  input?: unknown;
  progress?: number;
  priority?: number;
  queueName?: string;
  maxAttempts?: number;
  timeoutSeconds?: number;
  nextRunAt?: Date | null;
}) {
  const runId = input.runId || generateAiJobRunId(input.module);
  const job = await createAiJob({
    runId,
    kind: input.kind,
    module: input.module,
    procedure: input.procedure || null,
    status: "queued",
    progress: input.progress ?? 0,
    priority: Math.min(Math.max(Math.floor(Number(input.priority || 0)), -1000), 1000),
    queueName: String(input.queueName || "default").slice(0, 64) || "default",
    attempt: 0,
    maxAttempts: Math.min(Math.max(input.maxAttempts || 1, 1), 10),
    timeoutSeconds: Math.min(Math.max(input.timeoutSeconds || DEFAULT_JOB_TIMEOUT_SECONDS, 5), 7200),
    userId: input.userId,
    projectId: input.projectId ?? null,
    skillSlug: input.skillSlug || null,
    input: input.input ?? null,
    output: null,
    errorMessage: null,
    nextRunAt: input.nextRunAt || null,
    leaseUntil: null,
    lockedBy: null,
    lastHeartbeatAt: null,
    startedAt: new Date(),
    completedAt: null,
  } as InsertAiJob);
  return buildAiJobSnapshot(job);
}

export async function markAiJobRunning(runId: string, progress = 10) {
  const existing = await getAiJobRun(runId);
  if (existing?.status === "canceled") return existing;

  const job = await claimAiJobByRunId(runId, {
    workerId: WORKER_ID,
    leaseSeconds: existing?.timeoutSeconds || DEFAULT_WORKER_LEASE_SECONDS,
    progress,
  });
  return job ? buildAiJobSnapshot(job) : null;
}

export async function completeAiJob(runId: string, output: unknown, guard: AiJobMutationGuard = {}) {
  const existing = await getAiJobRun(runId);
  if (existing?.status === "canceled") return existing;
  if (!aiJobMutationAllowed(existing, guard)) return existing;
  if (existing?.status !== "running") return existing;

  const job = await updateAiJobByRunId(runId, {
    status: "succeeded",
    progress: 100,
    output,
    errorMessage: null,
    leaseUntil: null,
    lockedBy: null,
    lastHeartbeatAt: null,
    completedAt: new Date(),
  } as Partial<InsertAiJob>);
  if (job) {
    const snapshot = buildAiJobSnapshot(job);
    void recordAiOsMetric({
      entityType: "job",
      entityId: snapshot.runId,
      metricName: "job.completed",
      metricValue: snapshot.completedAt && snapshot.startedAt ? snapshot.completedAt.getTime() - snapshot.startedAt.getTime() : null,
      status: snapshot.status,
      userId: snapshot.userId,
      projectId: snapshot.projectId,
      skillSlug: snapshot.skillSlug,
      metadata: { kind: snapshot.kind, module: snapshot.module, procedure: snapshot.procedure, attempt: snapshot.attempt },
    });
  }
  return job ? buildAiJobSnapshot(job) : null;
}

async function recordAiJobDeadLetter(job: AiJob, reason: string, metadata?: unknown) {
  try {
    await createAiJobDeadLetter({
      job,
      reason,
      metadata,
    });
    const snapshot = buildAiJobSnapshot(job);
    void recordAiOsMetric({
      entityType: "job",
      entityId: snapshot.runId,
      metricName: "job.dead_lettered",
      metricValue: null,
      status: snapshot.status,
      userId: snapshot.userId,
      projectId: snapshot.projectId,
      skillSlug: snapshot.skillSlug,
      metadata: { kind: snapshot.kind, module: snapshot.module, procedure: snapshot.procedure, reason },
    });
  } catch (deadLetterError) {
    console.warn(`[AI Job] failed to record dead letter for ${job.runId}:`, deadLetterError);
  }
}

export async function failAiJob(runId: string, error: unknown, guard: AiJobMutationGuard = {}) {
  const existing = await getAiJobRun(runId);
  if (existing?.status === "canceled") return existing;
  if (existing?.status === "succeeded") return existing;
  if (!aiJobMutationAllowed(existing, guard)) return existing;
  const errorMessage = serializeAiJobError(error);

  const job = await updateAiJobByRunId(runId, {
    status: "failed",
    progress: 100,
    errorMessage,
    leaseUntil: null,
    lockedBy: null,
    lastHeartbeatAt: null,
    completedAt: new Date(),
  });
  if (job) {
    const snapshot = buildAiJobSnapshot(job);
    void recordAiOsMetric({
      entityType: "job",
      entityId: snapshot.runId,
      metricName: "job.failed",
      metricValue: snapshot.completedAt && snapshot.startedAt ? snapshot.completedAt.getTime() - snapshot.startedAt.getTime() : null,
      status: snapshot.status,
      userId: snapshot.userId,
      projectId: snapshot.projectId,
      skillSlug: snapshot.skillSlug,
      metadata: { kind: snapshot.kind, module: snapshot.module, procedure: snapshot.procedure, attempt: snapshot.attempt, error: snapshot.error },
    });
    await recordAiJobDeadLetter(job, errorMessage, {
      attempt: snapshot.attempt,
      maxAttempts: snapshot.maxAttempts,
      workerId: WORKER_ID,
    });
  }
  return job ? buildAiJobSnapshot(job) : null;
}

export async function retryAiJob(runId: string, error: unknown, guard: AiJobMutationGuard = {}) {
  const existing = await getAiJobRun(runId);
  if (!existing || existing.status === "canceled") return existing;
  if (!isActiveAiJob(existing.status)) return existing;
  if (!aiJobMutationAllowed(existing, guard)) return existing;
  if (existing.attempt >= existing.maxAttempts) return failAiJob(runId, error, guard);

  const delayMs = calculateAiJobRetryDelayMs(existing.attempt);
  const job = await retryAiJobByRunId(runId, {
    errorMessage: serializeAiJobError(error),
    nextRunAt: new Date(Date.now() + delayMs),
    progress: Math.max(0, Math.min(existing.progress, 95)),
  });
  if (job) {
    await scheduleAiJobRun(runId);
    return buildAiJobSnapshot(job);
  }
  return null;
}

export async function cancelAiJob(runId: string, reason = "AI job canceled") {
  activeAbortControllers.get(runId)?.abort(reason);
  const job = await updateAiJobByRunId(runId, {
    status: "canceled",
    progress: 100,
    errorMessage: reason,
    leaseUntil: null,
    lockedBy: null,
    lastHeartbeatAt: null,
    completedAt: new Date(),
  });
  if (job) {
    const snapshot = buildAiJobSnapshot(job);
    void recordAiOsMetric({
      entityType: "job",
      entityId: snapshot.runId,
      metricName: "job.canceled",
      metricValue: null,
      status: snapshot.status,
      userId: snapshot.userId,
      projectId: snapshot.projectId,
      skillSlug: snapshot.skillSlug,
      metadata: { kind: snapshot.kind, module: snapshot.module, procedure: snapshot.procedure, reason },
    });
  }
  pendingScheduleRunIds.delete(runId);
  return job ? buildAiJobSnapshot(job) : null;
}

export async function getAiJobRun(runId: string) {
  const job = await getAiJobByRunId(runId);
  return job ? buildAiJobSnapshot(job) : null;
}

export async function runAiJobInProcess<T>(runId: string, handler: AiJobHandler<T>) {
  const existing = await getAiJobRun(runId);
  if (!existing) throw new Error(`AI job not found: ${runId}`);
  if (existing.status === "canceled") return existing;
  if (runningRunIds.has(runId)) return existing;
  if (aiJobQueueDraining) return existing;

  runningRunIds.add(runId);
  void reportAiJobWorkerHeartbeat().catch(() => null);
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  let current: AiJobSnapshot | null = null;
  const abortController = new AbortController();
  activeAbortControllers.set(runId, abortController);
  try {
    const running = await markAiJobRunning(runId, Math.max(existing.progress || 0, 10));
    if (!running) return existing;
    current = running;
    if (current.status === "canceled") return current;

    const leaseSeconds = Math.min(Math.max(current.timeoutSeconds || DEFAULT_JOB_TIMEOUT_SECONDS, 5), 7200);
    heartbeat = setInterval(() => {
      void heartbeatAiJobLease(runId, WORKER_ID, leaseSeconds).catch((error) => {
        console.warn(`[AI Job] Failed to heartbeat ${runId}:`, error);
      });
    }, Math.min(Math.max(Math.floor(leaseSeconds * 1000 / 3), 5_000), 60_000));

    const timeout = new Promise<never>((_, reject) => {
      timeoutHandle = setTimeout(() => reject(new Error(`AI job timed out after ${leaseSeconds}s`)), leaseSeconds * 1000);
    });
    const canceled = new Promise<never>((_, reject) => {
      abortController.signal.addEventListener("abort", () => reject(new Error(String(abortController.signal.reason || "AI job canceled"))), { once: true });
    });
    const output = await Promise.race([handler(current), timeout, canceled]);
    return await completeAiJob(runId, output, { expectedWorkerId: WORKER_ID, expectedAttempt: current.attempt });
  } catch (error) {
    await retryAiJob(runId, error, { expectedWorkerId: WORKER_ID, expectedAttempt: current?.attempt });
    throw error;
  } finally {
    if (heartbeat) clearInterval(heartbeat);
    if (timeoutHandle) clearTimeout(timeoutHandle);
    await releaseAiJobLease(runId, WORKER_ID).catch(() => null);
    activeAbortControllers.delete(runId);
    runningRunIds.delete(runId);
    void reportAiJobWorkerHeartbeat().catch(() => null);
  }
}

export async function scheduleAiJobRun(runId: string, handler?: AiJobHandler) {
  if (!isAiJobSchedulingEnabled()) return getAiJobRun(runId);

  const existing = await getAiJobRun(runId);
  if (!existing) throw new Error(`AI job not found: ${runId}`);
  if (!isActiveAiJob(existing.status) || runningRunIds.has(runId)) return existing;
  if (pendingScheduleRunIds.has(runId)) return existing;

  const resolvedHandler = handler || resolveAiJobHandler(existing);
  if (!resolvedHandler) {
    console.warn(`[AI Job] No handler registered for ${existing.kind} (${runId}); leaving job ${existing.status}.`);
    return existing;
  }

  const delayMs = existing.nextRunAt ? Math.max(existing.nextRunAt.getTime() - Date.now(), 0) : 0;
  if (delayMs > 0 && getWorkerRole() === "worker") {
    return existing;
  }

  if (getAvailableAiJobSlots() <= 0) {
    if (!pendingScheduleRunIds.has(runId)) {
      pendingScheduleRunIds.add(runId);
      setTimeout(() => {
        pendingScheduleRunIds.delete(runId);
        void scheduleAiJobRun(runId, resolvedHandler).catch((error) => {
          console.error(`[AI Job] ${runId} reschedule failed:`, error);
        });
      }, 1000);
    }
    return existing;
  }

  pendingScheduleRunIds.add(runId);
  setTimeout(() => {
    pendingScheduleRunIds.delete(runId);
    void runAiJobInProcess(runId, resolvedHandler).catch((error) => {
      console.error(`[AI Job] ${runId} failed:`, error);
    });
  }, delayMs);

  return existing;
}

export async function startRegisteredAiJob(input: Parameters<typeof createAiJobRun>[0]) {
  const job = await createAiJobRun(input);
  const handler = resolveAiJobHandler(job);
  if (!handler) {
    await failAiJob(job.runId, new Error(`No AI job handler registered for ${job.kind}`));
    throw new Error(`No AI job handler registered for ${job.kind}`);
  }
  await scheduleAiJobRun(job.runId, handler);
  return job;
}

export async function recoverActiveAiJobs(opts: { limit?: number } = {}) {
  return drainAiJobQueue(opts);
}

export async function drainAiJobQueue(opts: { limit?: number } = {}) {
  if (aiJobQueueDraining) {
    return {
      scanned: 0,
      scheduled: 0,
      skippedWithoutHandler: 0,
      skippedNoCapacity: 0,
      availableSlots: getAvailableAiJobSlots(),
      draining: true,
    };
  }

  const rows = await listRecoverableAiJobs({ limit: opts.limit });
  const result = {
    scanned: rows.length,
    scheduled: 0,
    skippedWithoutHandler: 0,
    skippedNoCapacity: 0,
    availableSlots: getAvailableAiJobSlots(),
    draining: false,
  };

  for (const row of rows) {
    if (getAvailableAiJobSlots() <= 0) {
      result.skippedNoCapacity += 1;
      continue;
    }
    const job = buildAiJobSnapshot(row);
    const handler = resolveAiJobHandler(job);
    if (!handler) {
      result.skippedWithoutHandler += 1;
      continue;
    }
    await scheduleAiJobRun(job.runId, handler);
    result.scheduled += 1;
  }

  result.availableSlots = getAvailableAiJobSlots();
  return result;
}

export async function startAiJobInProcess<T>(
  input: Parameters<typeof createAiJobRun>[0],
  handler: AiJobHandler<T>,
) {
  const job = await createAiJobRun(input);
  await scheduleAiJobRun(job.runId, handler);
  return job;
}
