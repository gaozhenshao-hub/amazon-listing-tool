import type { AiJob, InsertAiJob } from "../../drizzle/schema";
import {
  createAiJob,
  getAiJobByRunId,
  listRecoverableAiJobs,
  updateAiJobByRunId,
} from "../db";

export type AiJobStatus = "queued" | "running" | "succeeded" | "failed" | "canceled";

export type AiJobSnapshot = {
  runId: string;
  kind: string;
  module: string;
  procedure: string | null;
  status: AiJobStatus;
  progress: number;
  userId: number;
  projectId: number | null;
  skillSlug: string | null;
  input: unknown;
  output: unknown;
  error: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type AiJobHandler<T = unknown> = (job: AiJobSnapshot) => Promise<T>;

export type AiJobHandlerRegistration = {
  id: string;
  match: (job: AiJobSnapshot) => boolean;
  handler: AiJobHandler;
  recoverable?: boolean;
};

const ACTIVE_STATUSES = new Set<AiJobStatus>(["queued", "running"]);
const handlerRegistrations = new Map<string, AiJobHandlerRegistration>();
const runningRunIds = new Set<string>();

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
    userId: job.userId,
    projectId: job.projectId ?? null,
    skillSlug: job.skillSlug || null,
    input: normalizeJsonValue(job.input),
    output: normalizeJsonValue(job.output),
    error: job.errorMessage || null,
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
}) {
  const runId = input.runId || generateAiJobRunId(input.module);
  const job = await createAiJob({
    runId,
    kind: input.kind,
    module: input.module,
    procedure: input.procedure || null,
    status: "queued",
    progress: input.progress ?? 0,
    userId: input.userId,
    projectId: input.projectId ?? null,
    skillSlug: input.skillSlug || null,
    input: input.input ?? null,
    output: null,
    errorMessage: null,
    startedAt: new Date(),
    completedAt: null,
  } as InsertAiJob);
  return buildAiJobSnapshot(job);
}

export async function markAiJobRunning(runId: string, progress = 10) {
  const existing = await getAiJobRun(runId);
  if (existing?.status === "canceled") return existing;

  const job = await updateAiJobByRunId(runId, {
    status: "running",
    progress,
    errorMessage: null,
    startedAt: new Date(),
    completedAt: null,
  });
  return job ? buildAiJobSnapshot(job) : null;
}

export async function completeAiJob(runId: string, output: unknown) {
  const existing = await getAiJobRun(runId);
  if (existing?.status === "canceled") return existing;

  const job = await updateAiJobByRunId(runId, {
    status: "succeeded",
    progress: 100,
    output,
    errorMessage: null,
    completedAt: new Date(),
  } as Partial<InsertAiJob>);
  return job ? buildAiJobSnapshot(job) : null;
}

export async function failAiJob(runId: string, error: unknown) {
  const existing = await getAiJobRun(runId);
  if (existing?.status === "canceled") return existing;

  const job = await updateAiJobByRunId(runId, {
    status: "failed",
    progress: 100,
    errorMessage: serializeAiJobError(error),
    completedAt: new Date(),
  });
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

  runningRunIds.add(runId);
  try {
    const running = await markAiJobRunning(runId, Math.max(existing.progress || 0, 10));
    const current = running || existing;
    if (current.status === "canceled") return current;

    const output = await handler(current);
    return await completeAiJob(runId, output);
  } catch (error) {
    await failAiJob(runId, error);
    throw error;
  } finally {
    runningRunIds.delete(runId);
  }
}

export async function scheduleAiJobRun(runId: string, handler?: AiJobHandler) {
  const existing = await getAiJobRun(runId);
  if (!existing) throw new Error(`AI job not found: ${runId}`);
  if (!isActiveAiJob(existing.status) || runningRunIds.has(runId)) return existing;

  const resolvedHandler = handler || resolveAiJobHandler(existing);
  if (!resolvedHandler) {
    console.warn(`[AI Job] No handler registered for ${existing.kind} (${runId}); leaving job ${existing.status}.`);
    return existing;
  }

  setTimeout(() => {
    void runAiJobInProcess(runId, resolvedHandler).catch((error) => {
      console.error(`[AI Job] ${runId} failed:`, error);
    });
  }, 0);

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
  const rows = await listRecoverableAiJobs({ limit: opts.limit });
  const result = {
    scanned: rows.length,
    scheduled: 0,
    skippedWithoutHandler: 0,
  };

  for (const row of rows) {
    const job = buildAiJobSnapshot(row);
    const handler = resolveAiJobHandler(job);
    if (!handler) {
      result.skippedWithoutHandler += 1;
      continue;
    }
    await scheduleAiJobRun(job.runId, handler);
    result.scheduled += 1;
  }

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
