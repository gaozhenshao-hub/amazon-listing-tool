import { createHash } from "node:crypto";
import { z } from "zod";
import { ACQUISITION_CONSUMER_TYPES } from "../../../shared/acquisition";
import { AppError, APP_ERROR_CODES } from "../../../shared/_core/errors";
import { storagePut } from "../../storage";
import { requireDb, withDbTransaction } from "../../repositories/dbClient";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../../services/aiJobRunner";
import { BasicAmazonImagesProvider } from "./basicAmazonProvider";
import { getBasicImagesProfile } from "./basicProviderProfile";
import { normalizeAmazonArtifact } from "./amazonNormalizer";
import { ingestAcquisitionAssets } from "./assetIngestion";
import { AmazonAcquisitionCapabilitySchema } from "./contracts";
import {
  acquisitionAttemptIdempotencyKey,
  buildAcquisitionIdempotencyKey,
} from "./policy";
import {
  createAcquisitionJob,
  createAcquisitionRun,
  createRawArtifact,
  createSourceSnapshot,
  findAcquisitionJobByIdempotency,
  findFreshConfirmedSnapshotCoveringCapabilities,
  getAcquisitionJob,
  nextAcquisitionRunAttempt,
  updateAcquisitionJob,
  updateAcquisitionRun,
  updateSourceSnapshot,
} from "./repository";
import { activateConfirmedSnapshotForConsumer } from "./consumerActivation";
import { triggerConsumerPostConfirmation } from "./postConfirmation";
import { confirmSnapshotForDirectIngestion } from "./snapshotReview";
import { uncoveredCapabilitySummary } from "./capabilityCoverage";
import { parseLegacySnapshotConsumerRef } from "./legacyConsumerContracts";

export const AcquisitionJobRequestSchema = z.object({
  workspaceId: z.number().int().positive(),
  requestedBy: z.number().int().positive(),
  consumerType: z.enum(ACQUISITION_CONSUMER_TYPES),
  consumerRef: z.string().trim().min(1).max(128),
  marketplace: z.literal("US"),
  asin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/),
  capabilities: z.array(AmazonAcquisitionCapabilitySchema).min(1),
  cachePolicy: z.enum(["prefer_cache", "refresh", "cache_only"]).default("prefer_cache"),
});
export type AcquisitionJobRequest = z.infer<typeof AcquisitionJobRequestSchema>;

const AcquisitionWorkerInputSchema = z.object({
  acquisitionJobId: z.number().int().positive(),
});

function requireEnabledAcquisitionProfile(profile: Awaited<ReturnType<typeof getBasicImagesProfile>>) {
  if (!profile) throw new AppError({ code: APP_ERROR_CODES.PRECONDITION_FAILED, statusCode: 412,
    message: "系统采集尚未启用，请联系管理员。" });
  return profile;
}

function requireQualifiedCapabilities(profile: NonNullable<Awaited<ReturnType<typeof getBasicImagesProfile>>>, capabilities: readonly string[]) {
  const qualified = new Set(Array.isArray(profile.capabilities) ? profile.capabilities : []);
  const missing = capabilities.filter(capability => !qualified.has(capability));
  if (missing.length > 0) {
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "本次请求包含系统尚不支持的采集内容。",
      details: { reason: "capability_not_supported", capabilities: missing },
    });
  }
}

function providerRequestHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function startAmazonAcquisitionJob(rawInput: AcquisitionJobRequest) {
  const input = AcquisitionJobRequestSchema.parse(rawInput);
  if (input.consumerType === "kb_images") {
    const { startKnowledgeCollectionBatch } = await import("./knowledgeCollectionBatch");
    const { randomUUID } = await import("node:crypto");
    const receipt = await startKnowledgeCollectionBatch({ workspaceId: input.workspaceId, requestedBy: input.requestedBy,
      asins: [input.asin], requestId: randomUUID(), mode: "normal" });
    const item = receipt.items[0];
    if (!item) throw new AppError({ code: APP_ERROR_CODES.RESOURCE_CONFLICT, statusCode: 409,
      message: `ASIN ${input.asin} 已采集或正在采集中，已跳过。需要更新图片请使用“采集重复 ASIN”。` });
    return { ...item, aiJobRunId: null };
  }
  const target = input.consumerType === "project_competitor" ? parseLegacySnapshotConsumerRef("project_competitor", input.consumerRef) : null;
  const captureOnly = target?.type === "project_competitor" && target.captureOnly === true;
  const db = await requireDb("Amazon acquisition job");
  const configuredProfile = await getBasicImagesProfile(db, input.workspaceId);
  // Cache-only requests do not need a Provider profile or secret: a retained
  // snapshot is local evidence, not a new collection attempt.
  const cacheTtlSeconds = configuredProfile?.cacheTtlSeconds ?? 86_400;

  if (input.cachePolicy !== "refresh") {
    const freshAfter = new Date(Date.now() - cacheTtlSeconds * 1_000);
    const cached = await findFreshConfirmedSnapshotCoveringCapabilities({
      db,
      workspaceId: input.workspaceId,
      marketplace: input.marketplace,
      asin: input.asin,
      freshAfter,
      requestedCapabilities: input.capabilities,
    });
    if (cached?.complete) {
      const idempotencyKey = buildAcquisitionIdempotencyKey({ ...input, cachePolicy: captureOnly ? `confirmed_cache:${cached.snapshot.id}` : "confirmed_cache" });
      const existing = await findAcquisitionJobByIdempotency(db, input.workspaceId, idempotencyKey);
      if (existing && (existing.status !== "confirmed" || existing.requestedBy !== input.requestedBy || existing.cacheHitSnapshotId !== cached.snapshot.id)) {
        throw new Error("COMPETITOR_CAPTURE_CACHE_CHANGED");
      }
      const reused = await withDbTransaction("Reuse confirmed Amazon acquisition snapshot", async tx => {
        const jobId = existing?.id ?? await createAcquisitionJob(tx, {
          workspaceId: input.workspaceId,
          requestedBy: input.requestedBy,
          providerProfileId: configuredProfile?.id ?? null,
          consumerType: input.consumerType,
          consumerRef: input.consumerRef,
          marketplace: input.marketplace,
          asin: input.asin,
          requestedCapabilities: input.capabilities,
          idempotencyKey,
          status: "confirmed",
          cachePolicy: input.cachePolicy,
          maxChargeUsd: "0.0000",
          cacheHitSnapshotId: cached.snapshot.id,
          completedAt: new Date(),
        });
        const projection = await activateConfirmedSnapshotForConsumer({
          db: tx,
          workspaceId: input.workspaceId,
          confirmedSnapshotId: cached.snapshot.id,
          job: {
            requestedBy: input.requestedBy,
            consumerType: input.consumerType,
            consumerRef: input.consumerRef,
            requestedCapabilities: input.capabilities,
          },
          activatedBy: input.requestedBy,
        });
        return { jobId, status: "confirmed" as const, cacheHitSnapshotId: cached.snapshot.id, aiJobRunId: null, projection };
      }, { required: true });
      const postConfirmation = await triggerConsumerPostConfirmation(reused.projection);
      return { ...reused, ...postConfirmation };
    }
    if (input.cachePolicy === "cache_only") {
      const capabilityGaps = cached ? uncoveredCapabilitySummary(cached.coverage) : input.capabilities;
      throw new AppError({
        code: APP_ERROR_CODES.PRECONDITION_FAILED,
        statusCode: 412,
        message: cached
          ? `缓存保留了已安全保存的部分采集结果，但未覆盖所请求能力：${capabilityGaps.join("、")}。未调用Provider，也不会删除既有图片。`
          : "未找到覆盖所请求能力的可复用缓存。未调用Provider。",
        details: {
          reason: cached ? "capability_coverage_incomplete" : "cache_miss",
          cacheSnapshotId: cached?.snapshot.id ?? null,
          capabilityGaps,
        },
      });
    }
  }

  const profile = requireEnabledAcquisitionProfile(configuredProfile);
  requireQualifiedCapabilities(profile, input.capabilities);

  const baseIdempotencyKey = buildAcquisitionIdempotencyKey({ ...input, cachePolicy: input.cachePolicy });
  const existing = await findAcquisitionJobByIdempotency(db, input.workspaceId, baseIdempotencyKey);
  const attempt = acquisitionAttemptIdempotencyKey({ baseKey: baseIdempotencyKey, existingStatus: existing?.status });
  if (existing && attempt.reuseExisting) {
    return { jobId: existing.id, status: existing.status, cacheHitSnapshotId: existing.cacheHitSnapshotId, aiJobRunId: null };
  }
  const idempotencyKey = attempt.key;

  const jobId = await createAcquisitionJob(db, {
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
    providerProfileId: profile.id,
    consumerType: input.consumerType,
    consumerRef: input.consumerRef,
    marketplace: input.marketplace,
    asin: input.asin,
    requestedCapabilities: input.capabilities,
    idempotencyKey,
    status: "queued",
    cachePolicy: input.cachePolicy,
    maxChargeUsd: "0.0000",
  });
  const aiJob = await startRegisteredAiJob({
    kind: "amazon.acquisition.fetch",
    module: "amazonAcquisition",
    procedure: "amazonAcquisition.createJob",
    workspaceId: input.workspaceId,
    userId: input.requestedBy,
    skillSlug: "acquisition.amazon.catalog.fetch",
    input: {
      acquisitionJobId: jobId,
      // This is standalone Provider collection, not an Agent node execution.
      // The request contract intentionally accepts no caller-supplied Agent IDs.
      agentRunId: null,
      agentNodeId: null,
    },
    queueName: "amazon_acquisition",
    maxAttempts: 2,
      timeoutSeconds: 1800,
  });
  return { jobId, status: "queued" as const, cacheHitSnapshotId: null, aiJobRunId: aiJob.runId };
}

export async function executeAmazonAcquisitionJob(aiJob: AiJobSnapshot, context?: { signal: AbortSignal }) {
  const workerInput = AcquisitionWorkerInputSchema.parse(aiJob.input);
  const db = await requireDb("Amazon acquisition worker");
  const workspaceId = aiJob.workspaceId;
  if (!workspaceId) throw new Error("Amazon acquisition worker missing workspace");
  const job = await getAcquisitionJob(db, workspaceId, workerInput.acquisitionJobId);
  if (!job) throw new Error("Amazon acquisition job not found");
  const profile = await getBasicImagesProfile(db, workspaceId);
  if (!profile || profile.id !== job.providerProfileId) {
    await updateAcquisitionJob(db, workspaceId, job.id, { status: "failed", completedAt: new Date() });
    return { acquisitionJobId: job.id, status: "failed", failureCategory: "provider_not_configured" };
  }
  const capabilities = z.array(AmazonAcquisitionCapabilitySchema).parse(job.requestedCapabilities);
  const providerRequest = {
    workspaceId,
    marketplace: "US" as const,
    asin: job.asin,
    capabilities,
    idempotencyKey: job.idempotencyKey,
  };
  const provider = new BasicAmazonImagesProvider();
  const attempt = await nextAcquisitionRunAttempt(db, job.id);
  const runId = await createAcquisitionRun(db, {
    workspaceId,
    jobId: job.id,
    providerProfileId: profile.id,
    attempt,
    providerRequestHash: providerRequestHash(providerRequest),
    status: "running",
    failureCategory: null,
    estimatedMaxUsd: "0.0000",
    startedAt: new Date(),
    completedAt: null,
  });

  await updateAcquisitionJob(db, workspaceId, job.id, { status: "running", startedAt: new Date() });
  await updateAiJobProgress(aiJob.runId, 25);
  const result = await provider.fetch(providerRequest);
  context?.signal.throwIfAborted();
  await updateAcquisitionRun(db, runId, {
    providerRunId: result.providerRunId || null,
    status: result.status,
    failureCategory: result.failureCategory,
    chargedUsd: result.chargedUsd === null ? null : result.chargedUsd.toFixed(4),
    resultCount: result.rawArtifact ? 1 : 0,
    completedAt: new Date(),
  });
  if (!result.rawArtifact || result.status !== "succeeded") {
    await updateAcquisitionJob(db, workspaceId, job.id, { status: "failed", completedAt: new Date() });
    return {
      acquisitionJobId: job.id,
      status: "failed",
      failureCategory: result.failureCategory ?? (result.status === "partial" ? "partial_result" : "unknown"),
    };
  }

  await updateAiJobProgress(aiJob.runId, 70);
  const key = `acquisition/${workspaceId}/runs/${runId}/${result.rawArtifact.contentHash}.json`;
  const stored = await storagePut(key, result.rawArtifact.bytes, result.rawArtifact.contentType);
  const rawArtifactId = await createRawArtifact(db, {
    workspaceId,
    runId,
    artifactKind: "provider_result",
    storageKey: stored.storageUri,
    contentHash: result.rawArtifact.contentHash,
    contentType: result.rawArtifact.contentType,
    sizeBytes: result.rawArtifact.bytes.byteLength,
  });
  let normalized: ReturnType<typeof normalizeAmazonArtifact>;
  try {
    normalized = normalizeAmazonArtifact({
      bytes: result.rawArtifact.bytes,
      expectedAsin: job.asin,
      marketplace: "US",
    });
  } catch (error) {
    await updateAcquisitionRun(db, runId, {
      status: "failed",
      failureCategory: "normalization_failed",
      completedAt: new Date(),
    });
    await updateAcquisitionJob(db, workspaceId, job.id, { status: "failed", completedAt: new Date() });
    return { acquisitionJobId: job.id, status: "failed", failureCategory: "normalization_failed" };
  }
  const snapshotId = await createSourceSnapshot(db, {
    workspaceId,
    jobId: job.id,
    runId,
    rawArtifactId,
    marketplace: "US",
    asin: job.asin,
    schemaVersion: "amazon_snapshot_v1",
    sourceHash: normalized.sourceHash,
    normalizedData: normalized.snapshot,
    fieldStatuses: normalized.snapshot.fieldEvidence,
    completeness: normalized.completeness,
    status: "draft",
  });
  const assetSummary = await ingestAcquisitionAssets({
    db,
    workspaceId,
    snapshotId,
    rawArtifactId,
    assets: normalized.sourceAssets,
    signal: context?.signal,
    onProgress: async summary => {
      await updateSourceSnapshot(db, workspaceId, snapshotId, { completeness: { ...normalized.completeness, assetIngestion: summary } });
      await updateAiJobProgress(aiJob.runId, 70 + Math.round(25 * summary.completed / Math.max(1, summary.total)));
    },
  });
  await updateSourceSnapshot(db, workspaceId, snapshotId, {
    completeness: { ...normalized.completeness, assetIngestion: assetSummary },
  });
  if (job.consumerType === "kb_images" && (assetSummary.failed > 0 || assetSummary.stored === 0)) {
    await updateSourceSnapshot(db, workspaceId, snapshotId, {status:"pending_review",reviewNote:"missing_images_require_supplement_confirmation"});
    await updateAcquisitionJob(db, workspaceId, job.id, {status:"review_required",completedAt:new Date()});
    await updateAiJobProgress(aiJob.runId,100);
    return {acquisitionJobId:job.id,snapshotId,status:"review_required",missingAssetCount:assetSummary.failed};
  }
  try {
    const directIngestion = await confirmSnapshotForDirectIngestion({
      workspaceId,
      snapshotId,
      requestedBy: job.requestedBy,
    });
    const postConfirmation = await triggerConsumerPostConfirmation(directIngestion.projection);
    await updateAiJobProgress(aiJob.runId, 100);
    return {
      acquisitionJobId: job.id,
      snapshotId,
      confirmedSnapshotId: directIngestion.confirmedSnapshotId,
      status: "confirmed",
      directIngestion: true,
      failureCategory: null,
      ...postConfirmation,
    };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await updateSourceSnapshot(db, workspaceId, snapshotId, {
      status: "rejected",
      reviewNote: `system_direct_ingestion_blocked: ${reason.slice(0, 1800)}`,
    });
    await updateAcquisitionRun(db, runId, {
      status: "failed",
      failureCategory: "partial_result",
      completedAt: new Date(),
    });
    await updateAcquisitionJob(db, workspaceId, job.id, { status: "failed", completedAt: new Date() });
    return { acquisitionJobId: job.id, snapshotId, status: "failed", failureCategory: "partial_result" };
  }
}

registerAiJobHandler({
  id: "amazon-acquisition-fetch",
  match: job => job.kind === "amazon.acquisition.fetch" && job.module === "amazonAcquisition",
  recoverable: true,
  handler: executeAmazonAcquisitionJob,
});
