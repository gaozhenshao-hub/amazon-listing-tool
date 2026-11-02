import { randomUUID } from "node:crypto";
import { z } from "zod";
import { storagePut } from "../../storage";
import { requireDb } from "../../repositories/dbClient";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../../services/aiJobRunner";
import { evaluateAcquisitionBudget } from "./policy";
import { ApifyAmazonMonitorProvider, createConfiguredApifyAmazonMonitorProvider } from "./apifyMonitorProvider";
import {
  AmazonMonitorRequestSchema,
  hasRequiredMonitorEvidence,
  monitorRequestHash,
  requiredMonitorCapabilities,
  type AmazonMonitorKind,
  type MonitorTriggerType,
} from "./monitorProviderContracts";
import {
  createMonitorRun,
  getMonitorBudgetUsage,
  getMonitorRun,
  loadMonitorProviderProfileById,
  loadMonitorTarget,
  persistMonitorSnapshot,
  updateMonitorRun,
} from "./monitorRepository";
import {
  getMonitorProviderProfile,
  getQualifiedMonitorProviderProfile,
  markMonitorProviderQualified,
} from "./monitorProviderProfileService";
import { markMonitorAgentConfirmed, markMonitorAgentFailed, markMonitorAgentRunning, startMonitorAgentRun } from "./monitorAgent";

const JobInputSchema = z.object({
  monitorRunId: z.number().int().positive(),
  workspaceId: z.number().int().positive(),
  userId: z.number().int().positive(),
  kind: z.enum(["competitor", "keyword"]),
  agentRunId: z.string().min(1),
  agentNodeId: z.string().min(1),
});

function profilePolicy(profile: { perRunMaxUsd: unknown; dailyBudgetUsd: unknown; monthlyBudgetUsd: unknown; cacheTtlSeconds: number }) {
  return {
    perRunMaxUsd: Number(profile.perRunMaxUsd),
    dailyBudgetUsd: Number(profile.dailyBudgetUsd),
    monthlyBudgetUsd: Number(profile.monthlyBudgetUsd),
    cacheTtlSeconds: profile.cacheTtlSeconds,
  };
}

type PersistedMonitorRun = Awaited<ReturnType<typeof createMonitorRun>>["run"];

async function attachMonitorRunToExecution(input: {
  db: Awaited<ReturnType<typeof requireDb>>;
  run: PersistedMonitorRun;
  kind: AmazonMonitorKind;
  workspaceId: number;
  userId: number;
  monitorId: number | null;
  asin: string;
  procedure: string;
  qualification: boolean;
}) {
  try {
    const agent = await startMonitorAgentRun({
      kind: input.kind,
      monitorRunId: input.run.id,
      monitorId: input.monitorId,
      workspaceId: input.workspaceId,
      userId: input.userId,
      asin: input.asin,
    });
    const aiJob = await startRegisteredAiJob({
      kind: `amazon.monitor.${input.kind}.${input.qualification ? "qualify" : "execute"}`,
      module: "amazonMonitoring",
      procedure: input.procedure,
      workspaceId: input.workspaceId,
      userId: input.userId,
      projectId: input.monitorId,
      input: {
        monitorRunId: input.run.id,
        workspaceId: input.workspaceId,
        userId: input.userId,
        kind: input.kind,
        agentRunId: agent.agentRunId,
        agentNodeId: agent.agentNodeId,
      },
      queueName: "acquisition",
      maxAttempts: 1,
      timeoutSeconds: 420,
    });
    await updateMonitorRun(input.db, input.workspaceId, input.run.id, { aiJobRunId: aiJob.runId, agentRunId: agent.agentRunId });
    return { monitorRunId: input.run.id, aiJobRunId: aiJob.runId, status: aiJob.status };
  } catch (error) {
    await updateMonitorRun(input.db, input.workspaceId, input.run.id, {
      status: "failed",
      failureCategory: "job_enqueue_failed",
      completedAt: new Date(),
    }).catch(() => undefined);
    throw error;
  }
}

function canSafelyResumeQualificationRun(run: {
  triggerType: string;
  status: string;
  providerRunId?: string | null;
  aiJobRunId?: string | null;
  agentRunId?: string | null;
  rawStorageKey?: string | null;
  chargedUsd?: unknown;
  monitorId?: number | null;
  requestedBy?: number | null;
}) {
  return run.triggerType === "qualification"
    && ["queued", "failed"].includes(run.status)
    && !run.providerRunId
    && !run.aiJobRunId
    && !run.agentRunId
    && !run.rawStorageKey
    && run.chargedUsd === null
    && run.monitorId === null;
}

export async function startAmazonMonitorJob(input: {
  workspaceId: number;
  userId: number;
  kind: AmazonMonitorKind;
  monitorId: number;
  triggerType?: Exclude<MonitorTriggerType, "qualification">;
  maxChargeUsd?: number;
  idempotencyKey?: string;
}) {
  const db = await requireDb("Amazon monitor job");
  const target = await loadMonitorTarget(db, input.workspaceId, input.kind, input.monitorId);
  if (!target || !target.active) throw new Error("监控任务不存在、未启用或缺少目标ASIN");
  if (target.marketplace !== "US") throw new Error("当前监控Provider仅允许美国站");
  const profile = await getQualifiedMonitorProviderProfile(db, input.workspaceId, input.kind);
  if (!profile) throw new Error("该监控能力尚未完成Provider资格验证，当前不可执行");
  const maxChargeUsd = Math.min(input.maxChargeUsd ?? Number(profile.perRunMaxUsd), Number(profile.perRunMaxUsd));
  const request = AmazonMonitorRequestSchema.parse({
    workspaceId: input.workspaceId,
    kind: input.kind,
    marketplace: "US",
    asin: target.asin,
    keyword: target.keyword,
    postalCode: "10001",
    depth: 1,
    maxChargeUsd,
    idempotencyKey: input.idempotencyKey || `monitor-${input.kind}-${input.monitorId}-${randomUUID()}`,
  });
  const estimate = new ApifyAmazonMonitorProvider().estimate(request);
  if (request.maxChargeUsd < estimate.estimatedMaxUsd) throw new Error("用户授权的费用上限低于Provider预估，当前不可执行");
  const created = await createMonitorRun(db, {
    workspaceId: input.workspaceId,
    monitorKind: input.kind,
    monitorId: input.monitorId,
    maxChargeUsd: request.maxChargeUsd.toFixed(4),
    triggerType: input.triggerType || "manual",
    providerProfileId: profile.id,
    requestedBy: input.userId,
    marketplace: "US",
    asin: request.asin,
    keyword: request.keyword,
    postalCode: request.postalCode,
    depth: request.depth,
    requestedCapabilities: [...requiredMonitorCapabilities(input.kind)],
    idempotencyKey: request.idempotencyKey,
    providerRequestHash: monitorRequestHash(request),
    status: "queued",
    estimatedMaxUsd: new ApifyAmazonMonitorProvider().estimate(request).estimatedMaxUsd.toFixed(4),
  });
  if (created.reused && created.run.aiJobRunId) {
    return { monitorRunId: created.run.id, aiJobRunId: created.run.aiJobRunId, status: created.run.status, reused: true };
  }
  const queued = await attachMonitorRunToExecution({
    db,
    run: created.run,
    kind: input.kind,
    workspaceId: input.workspaceId,
    userId: input.userId,
    monitorId: input.monitorId,
    asin: request.asin,
    procedure: "crawler.queueMonitor",
    qualification: false,
  });
  return { ...queued, reused: false };
}

export async function startMonitorQualificationJob(input: {
  workspaceId: number;
  userId: number;
  kind: AmazonMonitorKind;
  asin: string;
  keyword?: string | null;
  depth?: number;
  maxChargeUsd: number;
  confirmExternalCharge: true;
}) {
  const db = await requireDb("Amazon monitor provider qualification");
  const profile = await getMonitorProviderProfile(db, input.workspaceId, input.kind);
  if (!profile || profile.status !== "qualification_pending") throw new Error("请先登记待验证的监控Provider候选");
  const request = AmazonMonitorRequestSchema.parse({
    workspaceId: input.workspaceId,
    kind: input.kind,
    marketplace: "US",
    asin: input.asin,
    keyword: input.kind === "keyword" ? input.keyword : null,
    postalCode: "10001",
    depth: input.kind === "keyword" ? (input.depth ?? 3) : 1,
    maxChargeUsd: input.maxChargeUsd,
    idempotencyKey: `monitor-qualification-${input.kind}-${randomUUID()}`,
  });
  const estimate = new ApifyAmazonMonitorProvider().estimate(request);
  if (request.maxChargeUsd < estimate.estimatedMaxUsd) throw new Error("用户授权的资格验证费用上限低于Provider预估，当前不可执行");
  const created = await createMonitorRun(db, {
    workspaceId: input.workspaceId,
    monitorKind: input.kind,
    monitorId: null,
    maxChargeUsd: request.maxChargeUsd.toFixed(4),
    triggerType: "qualification",
    providerProfileId: profile.id,
    requestedBy: input.userId,
    marketplace: "US",
    asin: request.asin,
    keyword: request.keyword,
    postalCode: request.postalCode,
    depth: request.depth,
    requestedCapabilities: [...requiredMonitorCapabilities(input.kind)],
    idempotencyKey: request.idempotencyKey,
    providerRequestHash: monitorRequestHash(request),
    status: "queued",
    estimatedMaxUsd: estimate.estimatedMaxUsd.toFixed(4),
  });
  return attachMonitorRunToExecution({
    db,
    run: created.run,
    kind: input.kind,
    workspaceId: input.workspaceId,
    userId: input.userId,
    monitorId: null,
    asin: request.asin,
    procedure: "crawler.qualifyProvider",
    qualification: true,
  });
}

export async function resumeUnstartedMonitorQualificationRun(input: {
  workspaceId: number;
  userId: number;
  monitorRunId: number;
}) {
  const db = await requireDb("Amazon monitor qualification resume");
  const run = await getMonitorRun(db, input.workspaceId, input.monitorRunId);
  if (!run) throw new Error("资格任务不存在或不属于当前工作空间");
  if (run.requestedBy !== input.userId) throw new Error("只能恢复本人发起的资格任务");
  if (!canSafelyResumeQualificationRun(run)) {
    throw new Error("该资格任务已存在Provider、Agent或AI Job执行痕迹，禁止恢复以避免重复费用");
  }
  const kind = run.monitorKind as AmazonMonitorKind;
  const profile = await loadMonitorProviderProfileById(db, input.workspaceId, run.providerProfileId);
  if (!profile || profile.status !== "qualification_pending") {
    throw new Error("资格Provider当前状态不允许恢复任务");
  }
  return attachMonitorRunToExecution({
    db,
    run,
    kind,
    workspaceId: input.workspaceId,
    userId: input.userId,
    monitorId: null,
    asin: run.asin,
    procedure: "crawler.resumeQualification",
    qualification: true,
  });
}

async function executeMonitorJob(job: AiJobSnapshot) {
  const input = JobInputSchema.parse(job.input);
  const db = await requireDb("Amazon monitor worker");
  const run = await getMonitorRun(db, input.workspaceId, input.monitorRunId);
  if (!run) throw new Error("Amazon monitor run not found");
  const profile = await loadMonitorProviderProfileById(db, input.workspaceId, run.providerProfileId);
  const qualification = run.triggerType === "qualification";
  if (!profile || (qualification ? profile.status !== "qualification_pending" : profile.status !== "active")) {
    throw new Error("monitor provider not configured or not qualified");
  }
  const request = AmazonMonitorRequestSchema.parse({
    workspaceId: input.workspaceId,
    kind: input.kind,
    marketplace: "US",
    asin: run.asin,
    keyword: run.keyword,
    postalCode: run.postalCode,
    depth: run.depth || 1,
    maxChargeUsd: Number(run.maxChargeUsd),
    idempotencyKey: run.idempotencyKey,
  });
  const provider = await createConfiguredApifyAmazonMonitorProvider();
  const estimate = provider.estimate(request);
  const usage = await getMonitorBudgetUsage(db, input.workspaceId, profile.id);
  const decision = evaluateAcquisitionBudget({ estimatedMaxUsd: estimate.estimatedMaxUsd, requestedMaxUsd: request.maxChargeUsd, ...usage, policy: profilePolicy(profile) });
  if (!decision.allowed) {
    await updateMonitorRun(db, input.workspaceId, run.id, { status: "failed", failureCategory: "budget_exceeded", completedAt: new Date() });
    throw new Error(`monitor budget exceeded: ${decision.reason}`);
  }
  await markMonitorAgentRunning({ kind: input.kind, agentRunId: input.agentRunId, aiJobRunId: job.runId, attempt: job.attempt });
  await updateMonitorRun(db, input.workspaceId, run.id, { status: "running", startedAt: new Date(), failureCategory: null });
  try {
    await updateAiJobProgress(job.runId, 20);
    const result = await provider.fetch(request);
    let rawStorageKey: string | null = null;
    if (result.rawArtifact) {
      const stored = await storagePut(
        `amazon-monitoring/workspace-${input.workspaceId}/run-${run.id}/${result.rawArtifact.contentHash}.json`,
        result.rawArtifact.bytes,
        result.rawArtifact.contentType,
      );
      rawStorageKey = stored.storageUri;
      await updateMonitorRun(db, input.workspaceId, run.id, {
        rawStorageKey,
        rawContentHash: result.rawArtifact.contentHash,
        rawContentType: result.rawArtifact.contentType,
        rawSizeBytes: result.rawArtifact.bytes.byteLength,
      });
    }
    if (result.status !== "succeeded" || !result.normalized) {
      await updateMonitorRun(db, input.workspaceId, run.id, {
        status: result.status === "partial" ? "partial" : "failed",
        providerRunId: result.providerRunId || null,
        chargedUsd: result.chargedUsd === null ? null : result.chargedUsd.toFixed(4),
        failureCategory: result.failureCategory || "partial_result",
        completedAt: new Date(),
      });
      throw new Error(`monitor provider failed: ${result.failureCategory || result.status}`);
    }
    if (!hasRequiredMonitorEvidence(result.normalized)) {
      await updateMonitorRun(db, input.workspaceId, run.id, {
        status: "partial",
        providerRunId: result.providerRunId || null,
        chargedUsd: result.chargedUsd === null ? null : result.chargedUsd.toFixed(4),
        failureCategory: "schema_drift",
        normalizedResult: result.normalized,
        completedAt: new Date(),
      });
      throw new Error("monitor provider required evidence missing");
    }
    await updateAiJobProgress(job.runId, 75);
    const snapshotId = qualification || run.monitorId === null
      ? null
      : await persistMonitorSnapshot({ db, workspaceId: input.workspaceId, monitorId: run.monitorId, result: result.normalized });
    if (qualification) {
      await markMonitorProviderQualified({ db, workspaceId: input.workspaceId, profileId: profile.id, userId: input.userId, kind: input.kind });
    }
    const output = {
      monitorRunId: run.id,
      monitorId: run.monitorId,
      qualification,
      snapshotId,
      normalized: result.normalized,
      providerRunId: result.providerRunId,
      rawStorageKey,
    };
    await updateMonitorRun(db, input.workspaceId, run.id, {
      status: "succeeded",
      providerRunId: result.providerRunId,
      chargedUsd: result.chargedUsd === null ? null : result.chargedUsd.toFixed(4),
      normalizedResult: result.normalized,
      failureCategory: null,
      completedAt: new Date(),
    });
    await markMonitorAgentConfirmed({ kind: input.kind, agentRunId: input.agentRunId, aiJobRunId: job.runId, attempt: job.attempt, userId: input.userId, output });
    return output;
  } catch (error) {
    await markMonitorAgentFailed({ kind: input.kind, agentRunId: input.agentRunId, aiJobRunId: job.runId, attempt: job.attempt, finalAttempt: true, error }).catch(() => null);
    const latest = await getMonitorRun(db, input.workspaceId, run.id);
    if (latest && !["failed", "partial"].includes(latest.status)) {
      await updateMonitorRun(db, input.workspaceId, run.id, { status: "failed", failureCategory: "provider_unavailable", completedAt: new Date() });
    }
    throw error;
  }
}

registerAiJobHandler({
  id: "amazon-monitor-provider-job-v1",
  match: job => job.kind.startsWith("amazon.monitor.") && (job.kind.endsWith(".execute") || job.kind.endsWith(".qualify")),
  handler: executeMonitorJob,
});
