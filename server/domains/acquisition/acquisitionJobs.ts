import { createHash } from "node:crypto";
import { z } from "zod";
import { ACQUISITION_CONSUMER_TYPES } from "../../../shared/acquisition";
import { storagePut } from "../../storage";
import { requireDb, withDbTransaction } from "../../repositories/dbClient";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../../services/aiJobRunner";
import { createConfiguredApifyAmazonProvider } from "./apifyProvider";
import { normalizeApifyAmazonArtifact } from "./amazonNormalizer";
import { ingestAcquisitionAssets } from "./assetIngestion";
import { AmazonAcquisitionCapabilitySchema } from "./contracts";
import {
  acquisitionAttemptIdempotencyKey,
  buildAcquisitionIdempotencyKey,
  evaluateAcquisitionBudget,
  type AcquisitionBudgetPolicy,
} from "./policy";
import {
  createAcquisitionJob,
  createAcquisitionRun,
  createRawArtifact,
  createSourceSnapshot,
  findAcquisitionJobByIdempotency,
  findFreshConfirmedSnapshot,
  getAcquisitionBudgetUsage,
  getAcquisitionJob,
  getActiveAcquisitionProfile,
  nextAcquisitionRunAttempt,
  updateAcquisitionJob,
  updateAcquisitionRun,
  updateSourceSnapshot,
} from "./repository";
import { activateConfirmedSnapshotForConsumer } from "./consumerActivation";
import { triggerConsumerPostConfirmation } from "./postConfirmation";
import { isApiConnectionSecretConfigured } from "../apiConnections/service";

export const AcquisitionJobRequestSchema = z.object({
  workspaceId: z.number().int().positive(),
  requestedBy: z.number().int().positive(),
  consumerType: z.enum(ACQUISITION_CONSUMER_TYPES),
  consumerRef: z.string().trim().min(1).max(128),
  marketplace: z.literal("US"),
  asin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/),
  capabilities: z.array(AmazonAcquisitionCapabilitySchema).min(1),
  cachePolicy: z.enum(["prefer_cache", "refresh", "cache_only"]).default("prefer_cache"),
  maxChargeUsd: z.number().positive().max(100),
});
export type AcquisitionJobRequest = z.infer<typeof AcquisitionJobRequestSchema>;

const AcquisitionWorkerInputSchema = z.object({
  acquisitionJobId: z.number().int().positive(),
});

function profileBudgetPolicy(profile: Awaited<ReturnType<typeof getActiveAcquisitionProfile>>): AcquisitionBudgetPolicy {
  if (!profile) throw new Error("provider not configured");
  const perRunMaxUsd = Number(profile.perRunMaxUsd);
  const dailyBudgetUsd = Number(profile.dailyBudgetUsd);
  const monthlyBudgetUsd = Number(profile.monthlyBudgetUsd);
  if (![perRunMaxUsd, dailyBudgetUsd, monthlyBudgetUsd].every(value => Number.isFinite(value) && value > 0)) {
    throw new Error("provider budget not configured");
  }
  return { perRunMaxUsd, dailyBudgetUsd, monthlyBudgetUsd, cacheTtlSeconds: profile.cacheTtlSeconds };
}

function providerRequestHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export async function startAmazonAcquisitionJob(rawInput: AcquisitionJobRequest) {
  const input = AcquisitionJobRequestSchema.parse(rawInput);
  const db = await requireDb("Amazon acquisition job");
  const profile = await getActiveAcquisitionProfile(db, input.workspaceId);
  if (!profile) throw new Error("provider not configured");
  if (!await isApiConnectionSecretConfigured("apify", "api_token")) throw new Error("provider secret not configured");
  const policy = profileBudgetPolicy(profile);

  if (input.cachePolicy !== "refresh") {
    const freshAfter = new Date(Date.now() - policy.cacheTtlSeconds * 1_000);
    const cached = await findFreshConfirmedSnapshot({
      db,
      workspaceId: input.workspaceId,
      marketplace: input.marketplace,
      asin: input.asin,
      freshAfter,
    });
    if (cached) {
      const idempotencyKey = buildAcquisitionIdempotencyKey({ ...input, cachePolicy: "confirmed_cache" });
      const existing = await findAcquisitionJobByIdempotency(db, input.workspaceId, idempotencyKey);
      if (existing) return { jobId: existing.id, status: existing.status, cacheHitSnapshotId: existing.cacheHitSnapshotId, aiJobRunId: null };
      const reused = await withDbTransaction("Reuse confirmed Amazon acquisition snapshot", async tx => {
        const jobId = await createAcquisitionJob(tx, {
          workspaceId: input.workspaceId,
          requestedBy: input.requestedBy,
          providerProfileId: profile.id,
          consumerType: input.consumerType,
          consumerRef: input.consumerRef,
          marketplace: input.marketplace,
          asin: input.asin,
          requestedCapabilities: input.capabilities,
          idempotencyKey,
          status: "confirmed",
          cachePolicy: input.cachePolicy,
          maxChargeUsd: input.maxChargeUsd.toFixed(4),
          cacheHitSnapshotId: cached.id,
          completedAt: new Date(),
        });
        const projection = await activateConfirmedSnapshotForConsumer({
          db: tx,
          workspaceId: input.workspaceId,
          confirmedSnapshotId: cached.id,
          job: {
            requestedBy: input.requestedBy,
            consumerType: input.consumerType,
            consumerRef: input.consumerRef,
            requestedCapabilities: input.capabilities,
          },
          activatedBy: input.requestedBy,
        });
        return { jobId, status: "confirmed" as const, cacheHitSnapshotId: cached.id, aiJobRunId: null, projection };
      });
      const postConfirmation = await triggerConsumerPostConfirmation(reused.projection);
      return { ...reused, ...postConfirmation };
    }
    if (input.cachePolicy === "cache_only") throw new Error("acquisition cache miss");
  }

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
    maxChargeUsd: input.maxChargeUsd.toFixed(4),
  });
  const aiJob = await startRegisteredAiJob({
    kind: "amazon.acquisition.fetch",
    module: "amazonAcquisition",
    procedure: "amazonAcquisition.createJob",
    workspaceId: input.workspaceId,
    userId: input.requestedBy,
    skillSlug: "acquisition.amazon.catalog.fetch",
    input: { acquisitionJobId: jobId },
    queueName: "external_provider",
    maxAttempts: 2,
    timeoutSeconds: 300,
  });
  return { jobId, status: "queued" as const, cacheHitSnapshotId: null, aiJobRunId: aiJob.runId };
}

async function executeAmazonAcquisitionJob(aiJob: AiJobSnapshot) {
  const workerInput = AcquisitionWorkerInputSchema.parse(aiJob.input);
  const db = await requireDb("Amazon acquisition worker");
  const workspaceId = aiJob.workspaceId;
  if (!workspaceId) throw new Error("Amazon acquisition worker missing workspace");
  const job = await getAcquisitionJob(db, workspaceId, workerInput.acquisitionJobId);
  if (!job) throw new Error("Amazon acquisition job not found");
  const profile = await getActiveAcquisitionProfile(db, workspaceId);
  if (!profile || profile.id !== job.providerProfileId) throw new Error("provider not configured");
  const capabilities = z.array(AmazonAcquisitionCapabilitySchema).parse(job.requestedCapabilities);
  const maxChargeUsd = Number(job.maxChargeUsd);
  const providerRequest = {
    workspaceId,
    marketplace: "US" as const,
    asin: job.asin,
    capabilities,
    maxChargeUsd,
    idempotencyKey: job.idempotencyKey,
  };
  const provider = await createConfiguredApifyAmazonProvider();
  const estimate = await provider.estimate(providerRequest);
  const usage = await getAcquisitionBudgetUsage(db, workspaceId, new Date());
  const decision = evaluateAcquisitionBudget({
    estimatedMaxUsd: estimate.estimatedMaxUsd,
    requestedMaxUsd: maxChargeUsd,
    ...usage,
    policy: profileBudgetPolicy(profile),
  });
  const attempt = await nextAcquisitionRunAttempt(db, job.id);
  const runId = await createAcquisitionRun(db, {
    workspaceId,
    jobId: job.id,
    providerProfileId: profile.id,
    attempt,
    providerRequestHash: providerRequestHash(providerRequest),
    status: decision.allowed ? "running" : "failed",
    failureCategory: decision.allowed ? null : "budget_exceeded",
    estimatedMaxUsd: estimate.estimatedMaxUsd.toFixed(4),
    startedAt: new Date(),
    completedAt: decision.allowed ? null : new Date(),
  });
  if (!decision.allowed) {
    await updateAcquisitionJob(db, workspaceId, job.id, { status: "failed", completedAt: new Date() });
    return { acquisitionJobId: job.id, status: "failed", failureCategory: "budget_exceeded" };
  }

  await updateAcquisitionJob(db, workspaceId, job.id, { status: "running", startedAt: new Date() });
  await updateAiJobProgress(aiJob.runId, 25);
  const result = await provider.fetch(providerRequest);
  await updateAcquisitionRun(db, runId, {
    providerRunId: result.providerRunId || null,
    status: result.status,
    failureCategory: result.failureCategory,
    chargedUsd: result.chargedUsd === null ? null : result.chargedUsd.toFixed(4),
    resultCount: result.rawArtifact ? 1 : 0,
    completedAt: new Date(),
  });
  if (!result.rawArtifact || result.status === "failed") {
    await updateAcquisitionJob(db, workspaceId, job.id, { status: "failed", completedAt: new Date() });
    return { acquisitionJobId: job.id, status: "failed", failureCategory: result.failureCategory ?? "unknown" };
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
  const normalized = normalizeApifyAmazonArtifact({
    bytes: result.rawArtifact.bytes,
    expectedAsin: job.asin,
    marketplace: "US",
  });
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
  });
  await updateSourceSnapshot(db, workspaceId, snapshotId, {
    completeness: { ...normalized.completeness, assetIngestion: assetSummary },
    status: "pending_review",
  });
  await updateAcquisitionJob(db, workspaceId, job.id, { status: "review_required", completedAt: new Date() });
  return { acquisitionJobId: job.id, snapshotId, status: "review_required", failureCategory: result.failureCategory };
}

registerAiJobHandler({
  id: "amazon-acquisition-fetch",
  match: job => job.kind === "amazon.acquisition.fetch" && job.module === "amazonAcquisition",
  recoverable: true,
  handler: executeAmazonAcquisitionJob,
});
