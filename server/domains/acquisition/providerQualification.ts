import { createHash } from "node:crypto";
import { z } from "zod";
import { AppError, APP_ERROR_CODES } from "../../../shared/_core/errors";
import { requireDb } from "../../repositories/dbClient";
import { isApiConnectionSecretConfigured } from "../apiConnections/service";
import { createConfiguredApifyAmazonProvider } from "./apifyProvider";
import { normalizeApifyAmazonArtifact } from "./amazonNormalizer";
import {
  createAcquisitionJob,
  createAcquisitionRun,
  findAcquisitionJobByIdempotency,
  getAcquisitionBudgetUsage,
  updateAcquisitionJob,
  updateAcquisitionRun,
} from "./repository";
import {
  finalizeApifyProviderQualification,
  finalizeApifyProviderRichContentQualification,
  getApifyProviderProfile,
} from "./providerProfileService";
import { evaluateAcquisitionBudget, type AcquisitionBudgetPolicy } from "./policy";
import {
  assertQualificationCanBeApproved,
  classifyProviderFailure,
  type AmazonAcquisitionCapability,
  type ProviderQualificationRecord,
} from "./providerContracts";

const QUALIFICATION_CAPABILITIES = ["catalog_basic", "image_gallery"] as const;
const QUALIFICATION_PROFILE_VERSION = "apify-junglee-us-gallery-2026-09-23-r2";
const QUALIFICATION_CONSUMER_TYPE = "provider_qualification";
const QUALIFICATION_CONSUMER_REF = "apify-primary-gallery-r2";
const REDACTED_QUALIFICATION_SUBJECT = "QUALIFY001";
const RICH_CONTENT_QUALIFICATION_CAPABILITIES = ["catalog_basic", "image_gallery", "aplus", "brand_story"] as const;
const RICH_CONTENT_QUALIFICATION_PROFILE_VERSION = "apify-junglee-us-rich-content-2026-09-28-r1";
const RICH_CONTENT_QUALIFICATION_CONSUMER_REF = "apify-primary-rich-content-r1";
const REDACTED_RICH_CONTENT_QUALIFICATION_SUBJECT = "QUALIFY002";

const QualificationInputSchema = z.object({
  workspaceId: z.number().int().positive(),
  requestedBy: z.number().int().positive(),
  /**
   * Supplied only to the one-off server-side invoker. This value must never
   * be returned, persisted, or put in an AI Job input.
   */
  testAsin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/),
  maxChargeUsd: z.literal(0.1),
});

export type PrimaryProviderQualificationInput = z.infer<typeof QualificationInputSchema>;

export type PrimaryProviderQualificationResult = {
  jobId: number;
  runId: number | null;
  status: "qualified" | "failed" | "already_recorded";
  providerStatus: "active" | "qualification_pending";
  observedCapabilities: string[];
  chargedUsd: number | null;
  failureCategory: string | null;
};

function profileBudgetPolicy(profile: {
  perRunMaxUsd: unknown;
  dailyBudgetUsd: unknown;
  monthlyBudgetUsd: unknown;
  cacheTtlSeconds: number;
}): AcquisitionBudgetPolicy {
  const perRunMaxUsd = Number(profile.perRunMaxUsd);
  const dailyBudgetUsd = Number(profile.dailyBudgetUsd);
  const monthlyBudgetUsd = Number(profile.monthlyBudgetUsd);
  if (![perRunMaxUsd, dailyBudgetUsd, monthlyBudgetUsd].every(value => Number.isFinite(value) && value > 0)) {
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "采集Provider预算尚未配置完成，不能执行资格验证。",
      details: { provider: "apify", reason: "budget_not_configured" },
    });
  }
  return { perRunMaxUsd, dailyBudgetUsd, monthlyBudgetUsd, cacheTtlSeconds: profile.cacheTtlSeconds };
}

function qualificationIdempotencyKey(workspaceId: number) {
  return createHash("sha256")
    .update(`${workspaceId}:${QUALIFICATION_CONSUMER_REF}:${QUALIFICATION_PROFILE_VERSION}`)
    .digest("hex");
}

function qualificationRequestHash(input: { workspaceId: number; testAsin: string; maxChargeUsd: number }) {
  return createHash("sha256")
    .update(JSON.stringify({
      workspaceId: input.workspaceId,
      subjectHash: createHash("sha256").update(input.testAsin).digest("hex"),
      capabilities: QUALIFICATION_CAPABILITIES,
      maxChargeUsd: input.maxChargeUsd,
      qualificationVersion: QUALIFICATION_PROFILE_VERSION,
    }))
    .digest("hex");
}

function qualificationRecord(input: {
  chargedUsd: number | null;
  basicFieldsReturned: number;
  galleryCount: number;
}): ProviderQualificationRecord {
  const catalogObserved = input.basicFieldsReturned >= 2;
  const galleryObserved = input.galleryCount >= 1;
  return {
    provider: "apify.junglee.amazon_crawler",
    actor: "junglee/Amazon-crawler",
    actorVersion: null,
    checkedAt: new Date().toISOString(),
    declaredCapabilities: [...QUALIFICATION_CAPABILITIES],
    observedCapabilities: [
      ...(catalogObserved ? ["catalog_basic" as const] : []),
      ...(galleryObserved ? ["image_gallery" as const] : []),
    ],
    fieldEvidence: {
      catalog_basic: {
        status: catalogObserved ? "returned" : "not_returned",
        sourcePath: catalogObserved ? "$.qualification.catalog" : null,
        valueHash: null,
        noteCode: catalogObserved ? "qualification_observed" : "qualification_not_observed",
      },
      image_gallery: {
        status: galleryObserved ? "returned" : "not_returned",
        sourcePath: galleryObserved ? "$.highResolutionImages" : null,
        valueHash: null,
        noteCode: galleryObserved ? "qualification_observed" : "qualification_not_observed",
      },
    },
    decision: catalogObserved && galleryObserved ? "conditionally_approved" : "rejected",
    pricingModel: "pay_per_result",
    maxObservedChargeUsd: input.chargedUsd,
  };
}

async function recordFailedQualification(input: {
  db: Awaited<ReturnType<typeof requireDb>>;
  workspaceId: number;
  jobId: number;
  runId: number | null;
  failureCategory: string;
  chargedUsd?: number | null;
}) {
  if (input.runId) {
    await updateAcquisitionRun(input.db, input.runId, {
      status: "failed",
      failureCategory: input.failureCategory,
      chargedUsd: input.chargedUsd === null || input.chargedUsd === undefined
        ? null
        : input.chargedUsd.toFixed(4),
      completedAt: new Date(),
    });
  }
  await updateAcquisitionJob(input.db, input.workspaceId, input.jobId, {
    status: "failed",
    completedAt: new Date(),
  });
}

/**
 * Runs a one-time technical qualification without persisting the test ASIN or
 * exposing raw Provider payloads. The test subject and raw payload stay only
 * in process memory; the Provider profile receives a redacted technical
 * evidence summary containing counts and fixed statuses.
 */
export async function runPrimaryProviderQualification(rawInput: PrimaryProviderQualificationInput): Promise<PrimaryProviderQualificationResult> {
  const input = QualificationInputSchema.parse(rawInput);
  const db = await requireDb("Amazon primary Provider qualification");
  const profile = await getApifyProviderProfile(db, input.workspaceId);
  if (!profile) {
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "采集Provider尚未配置，不能执行资格验证。",
      details: { provider: "apify", reason: "profile_not_configured" },
    });
  }
  if (profile.status !== "qualification_pending") {
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "采集Provider当前不处于待资格验证状态，已拒绝重复运行。",
      details: { provider: "apify", reason: "profile_not_pending", status: profile.status },
    });
  }
  if (!await isApiConnectionSecretConfigured("apify", "api_token")) {
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "Apify受控密钥尚未配置，不能执行资格验证。",
      details: { provider: "apify", reason: "secret_not_configured" },
    });
  }

  const policy = profileBudgetPolicy(profile);
  const idempotencyKey = qualificationIdempotencyKey(input.workspaceId);
  const existing = await findAcquisitionJobByIdempotency(db, input.workspaceId, idempotencyKey);
  if (existing) {
    if (["queued", "running", "confirmed"].includes(existing.status)) {
      return {
        jobId: existing.id,
        runId: null,
        status: "already_recorded",
        providerStatus: existing.status === "confirmed" ? "active" : "qualification_pending",
        observedCapabilities: [],
        chargedUsd: null,
        failureCategory: null,
      };
    }
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "已有失败关闭的资格验证记录；为避免重复费用，不会自动重试。",
      details: { provider: "apify", reason: "previous_qualification_failed" },
    });
  }

  const jobId = await createAcquisitionJob(db, {
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
    providerProfileId: profile.id,
    consumerType: QUALIFICATION_CONSUMER_TYPE,
    consumerRef: QUALIFICATION_CONSUMER_REF,
    marketplace: "US",
    asin: REDACTED_QUALIFICATION_SUBJECT,
    requestedCapabilities: [...QUALIFICATION_CAPABILITIES],
    idempotencyKey,
    status: "running",
    cachePolicy: "cache_only",
    maxChargeUsd: input.maxChargeUsd.toFixed(4),
    startedAt: new Date(),
  });

  const providerRequest = {
    workspaceId: input.workspaceId,
    marketplace: "US" as const,
    asin: input.testAsin,
    capabilities: [...QUALIFICATION_CAPABILITIES],
    maxChargeUsd: input.maxChargeUsd,
    idempotencyKey,
  };
  let runId: number | null = null;
  try {
    const provider = await createConfiguredApifyAmazonProvider();
    const estimate = await provider.estimate(providerRequest);
    const usage = await getAcquisitionBudgetUsage(db, input.workspaceId, new Date());
    const decision = evaluateAcquisitionBudget({
      estimatedMaxUsd: estimate.estimatedMaxUsd,
      requestedMaxUsd: input.maxChargeUsd,
      ...usage,
      policy,
    });
    runId = await createAcquisitionRun(db, {
      workspaceId: input.workspaceId,
      jobId,
      providerProfileId: profile.id,
      attempt: 1,
      providerRequestHash: qualificationRequestHash(input),
      status: decision.allowed ? "running" : "failed",
      failureCategory: decision.allowed ? null : "budget_exceeded",
      estimatedMaxUsd: estimate.estimatedMaxUsd.toFixed(4),
      startedAt: new Date(),
      completedAt: decision.allowed ? null : new Date(),
    });
    if (!decision.allowed) {
      await recordFailedQualification({ db, workspaceId: input.workspaceId, jobId, runId, failureCategory: "budget_exceeded" });
      return { jobId, runId, status: "failed", providerStatus: "qualification_pending", observedCapabilities: [], chargedUsd: null, failureCategory: "budget_exceeded" };
    }

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
      await recordFailedQualification({
        db,
        workspaceId: input.workspaceId,
        jobId,
        runId,
        failureCategory: result.failureCategory ?? "unknown",
        chargedUsd: result.chargedUsd,
      });
      return {
        jobId,
        runId,
        status: "failed",
        providerStatus: "qualification_pending",
        observedCapabilities: [],
        chargedUsd: result.chargedUsd,
        failureCategory: result.failureCategory ?? "unknown",
      };
    }

    const normalized = normalizeApifyAmazonArtifact({
      bytes: result.rawArtifact.bytes,
      expectedAsin: input.testAsin,
      marketplace: "US",
    });
    const record = qualificationRecord({
      chargedUsd: result.chargedUsd,
      basicFieldsReturned: normalized.completeness.basicFieldsReturned,
      galleryCount: normalized.completeness.mainGalleryCount,
    });
    assertQualificationCanBeApproved(record);
    await finalizeApifyProviderQualification({
      db,
      workspaceId: input.workspaceId,
      userId: input.requestedBy,
      profileId: profile.id,
      record,
      jobId,
      runId,
    });
    await updateAcquisitionJob(db, input.workspaceId, jobId, { status: "confirmed", completedAt: new Date() });
    return {
      jobId,
      runId,
      status: "qualified",
      providerStatus: "active",
      observedCapabilities: record.observedCapabilities,
      chargedUsd: result.chargedUsd,
      failureCategory: null,
    };
  } catch (error) {
    const failureCategory = classifyProviderFailure(error);
    await recordFailedQualification({ db, workspaceId: input.workspaceId, jobId, runId, failureCategory });
    return { jobId, runId, status: "failed", providerStatus: "qualification_pending", observedCapabilities: [], chargedUsd: null, failureCategory };
  }
}

function richContentQualificationIdempotencyKey(workspaceId: number) {
  return createHash("sha256")
    .update(`${workspaceId}:${RICH_CONTENT_QUALIFICATION_CONSUMER_REF}:${RICH_CONTENT_QUALIFICATION_PROFILE_VERSION}`)
    .digest("hex");
}

function richContentQualificationRequestHash(input: { workspaceId: number; testAsin: string; maxChargeUsd: number }) {
  return createHash("sha256")
    .update(JSON.stringify({
      workspaceId: input.workspaceId,
      subjectHash: createHash("sha256").update(input.testAsin).digest("hex"),
      capabilities: RICH_CONTENT_QUALIFICATION_CAPABILITIES,
      maxChargeUsd: input.maxChargeUsd,
      qualificationVersion: RICH_CONTENT_QUALIFICATION_PROFILE_VERSION,
    }))
    .digest("hex");
}

function richContentQualificationRecord(input: {
  chargedUsd: number | null;
  basicFieldsReturned: number;
  galleryCount: number;
  aplusAssetCount: number;
  brandStoryAssetCount: number;
}): ProviderQualificationRecord {
  const catalogObserved = input.basicFieldsReturned >= 2;
  const galleryObserved = input.galleryCount >= 1;
  const aplusObserved = input.aplusAssetCount >= 1;
  const brandStoryObserved = input.brandStoryAssetCount >= 1;
  const evidence = (observed: boolean, sourcePath: string, successCode: string) => ({
    status: observed ? "returned" as const : "not_returned" as const,
    sourcePath: observed ? sourcePath : null,
    valueHash: null,
    noteCode: observed ? successCode : "qualification_not_observed",
  });
  const observedCapabilities: AmazonAcquisitionCapability[] = [
    ...(catalogObserved ? ["catalog_basic" as const] : []),
    ...(galleryObserved ? ["image_gallery" as const] : []),
    ...(aplusObserved ? ["aplus" as const] : []),
    ...(brandStoryObserved ? ["brand_story" as const] : []),
  ];
  return {
    provider: "apify.junglee.amazon_crawler",
    actor: "junglee/Amazon-crawler",
    actorVersion: null,
    checkedAt: new Date().toISOString(),
    declaredCapabilities: [...RICH_CONTENT_QUALIFICATION_CAPABILITIES],
    observedCapabilities,
    fieldEvidence: {
      catalog_basic: evidence(catalogObserved, "$.qualification.catalog", "qualification_observed"),
      image_gallery: evidence(galleryObserved, "$.highResolutionImages", "qualification_observed"),
      aplus: evidence(aplusObserved, "$.aPlusContent", "qualification_rich_content_observed"),
      brand_story: evidence(brandStoryObserved, "$.brandStory", "qualification_rich_content_observed"),
    },
    decision: catalogObserved && galleryObserved && aplusObserved && brandStoryObserved ? "approved" : "rejected",
    pricingModel: "pay_per_result",
    maxObservedChargeUsd: input.chargedUsd,
  };
}

/**
 * Performs one isolated positive qualification of A+ and Brand Story on a
 * profile that already passed the base catalog/gallery check. Failure records
 * an auditable technical outcome but never removes the already-qualified base
 * capabilities or creates a business Snapshot.
 */
export async function runPrimaryProviderRichContentQualification(rawInput: PrimaryProviderQualificationInput): Promise<PrimaryProviderQualificationResult> {
  const input = QualificationInputSchema.parse(rawInput);
  const db = await requireDb("Amazon primary Provider rich-content qualification");
  const profile = await getApifyProviderProfile(db, input.workspaceId);
  if (!profile || profile.status !== "active") {
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "采集Provider尚未完成基础图资格验证，不能执行A+/品牌故事扩展验证。",
      details: { provider: "apify", reason: "profile_not_base_qualified" },
    });
  }
  const currentCapabilities = Array.isArray(profile.capabilities) ? profile.capabilities : [];
  if (!currentCapabilities.includes("catalog_basic") || !currentCapabilities.includes("image_gallery")) {
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "采集Provider缺少已验证的基础图能力，不能执行A+/品牌故事扩展验证。",
      details: { provider: "apify", reason: "base_capabilities_not_qualified" },
    });
  }
  if (currentCapabilities.includes("aplus") && currentCapabilities.includes("brand_story")) {
    return {
      jobId: 0,
      runId: null,
      status: "already_recorded",
      providerStatus: "active",
      observedCapabilities: [...RICH_CONTENT_QUALIFICATION_CAPABILITIES],
      chargedUsd: null,
      failureCategory: null,
    };
  }
  if (!await isApiConnectionSecretConfigured("apify", "api_token")) {
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "Apify受控密钥尚未配置，不能执行A+/品牌故事资格验证。",
      details: { provider: "apify", reason: "secret_not_configured" },
    });
  }

  const policy = profileBudgetPolicy(profile);
  const idempotencyKey = richContentQualificationIdempotencyKey(input.workspaceId);
  const existing = await findAcquisitionJobByIdempotency(db, input.workspaceId, idempotencyKey);
  if (existing) {
    if (["queued", "running", "confirmed"].includes(existing.status)) {
      return { jobId: existing.id, runId: null, status: "already_recorded", providerStatus: "active", observedCapabilities: [], chargedUsd: null, failureCategory: null };
    }
    throw new AppError({
      code: APP_ERROR_CODES.PRECONDITION_FAILED,
      statusCode: 412,
      message: "已有失败关闭的A+/品牌故事资格验证记录；为避免重复费用，不会自动重试。",
      details: { provider: "apify", reason: "previous_rich_content_qualification_failed" },
    });
  }

  const jobId = await createAcquisitionJob(db, {
    workspaceId: input.workspaceId,
    requestedBy: input.requestedBy,
    providerProfileId: profile.id,
    consumerType: QUALIFICATION_CONSUMER_TYPE,
    consumerRef: RICH_CONTENT_QUALIFICATION_CONSUMER_REF,
    marketplace: "US",
    asin: REDACTED_RICH_CONTENT_QUALIFICATION_SUBJECT,
    requestedCapabilities: [...RICH_CONTENT_QUALIFICATION_CAPABILITIES],
    idempotencyKey,
    status: "running",
    cachePolicy: "cache_only",
    maxChargeUsd: input.maxChargeUsd.toFixed(4),
    startedAt: new Date(),
  });
  const providerRequest = {
    workspaceId: input.workspaceId,
    marketplace: "US" as const,
    asin: input.testAsin,
    capabilities: [...RICH_CONTENT_QUALIFICATION_CAPABILITIES],
    maxChargeUsd: input.maxChargeUsd,
    idempotencyKey,
  };
  let runId: number | null = null;
  try {
    const provider = await createConfiguredApifyAmazonProvider();
    const estimate = await provider.estimate(providerRequest);
    const usage = await getAcquisitionBudgetUsage(db, input.workspaceId, new Date());
    const decision = evaluateAcquisitionBudget({ estimatedMaxUsd: estimate.estimatedMaxUsd, requestedMaxUsd: input.maxChargeUsd, ...usage, policy });
    runId = await createAcquisitionRun(db, {
      workspaceId: input.workspaceId,
      jobId,
      providerProfileId: profile.id,
      attempt: 1,
      providerRequestHash: richContentQualificationRequestHash(input),
      status: decision.allowed ? "running" : "failed",
      failureCategory: decision.allowed ? null : "budget_exceeded",
      estimatedMaxUsd: estimate.estimatedMaxUsd.toFixed(4),
      startedAt: new Date(),
      completedAt: decision.allowed ? null : new Date(),
    });
    if (!decision.allowed) {
      await recordFailedQualification({ db, workspaceId: input.workspaceId, jobId, runId, failureCategory: "budget_exceeded" });
      return { jobId, runId, status: "failed", providerStatus: "active", observedCapabilities: [], chargedUsd: null, failureCategory: "budget_exceeded" };
    }
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
      await recordFailedQualification({ db, workspaceId: input.workspaceId, jobId, runId, failureCategory: result.failureCategory ?? "unknown", chargedUsd: result.chargedUsd });
      return { jobId, runId, status: "failed", providerStatus: "active", observedCapabilities: [], chargedUsd: result.chargedUsd, failureCategory: result.failureCategory ?? "unknown" };
    }
    const normalized = normalizeApifyAmazonArtifact({ bytes: result.rawArtifact.bytes, expectedAsin: input.testAsin, marketplace: "US" });
    const record = richContentQualificationRecord({
      chargedUsd: result.chargedUsd,
      basicFieldsReturned: normalized.completeness.basicFieldsReturned,
      galleryCount: normalized.completeness.mainGalleryCount,
      aplusAssetCount: normalized.completeness.aplusAssetCount,
      brandStoryAssetCount: normalized.completeness.brandStoryAssetCount,
    });
    const required = ["catalog_basic", "image_gallery", "aplus", "brand_story"];
    if (!required.every(capability => record.observedCapabilities.includes(capability as AmazonAcquisitionCapability))) {
      await recordFailedQualification({ db, workspaceId: input.workspaceId, jobId, runId, failureCategory: "partial_result", chargedUsd: result.chargedUsd });
      return { jobId, runId, status: "failed", providerStatus: "active", observedCapabilities: record.observedCapabilities, chargedUsd: result.chargedUsd, failureCategory: "partial_result" };
    }
    await finalizeApifyProviderRichContentQualification({ db, workspaceId: input.workspaceId, userId: input.requestedBy, profileId: profile.id, record, jobId, runId });
    await updateAcquisitionJob(db, input.workspaceId, jobId, { status: "confirmed", completedAt: new Date() });
    return { jobId, runId, status: "qualified", providerStatus: "active", observedCapabilities: record.observedCapabilities, chargedUsd: result.chargedUsd, failureCategory: null };
  } catch (error) {
    const failureCategory = classifyProviderFailure(error);
    await recordFailedQualification({ db, workspaceId: input.workspaceId, jobId, runId, failureCategory });
    return { jobId, runId, status: "failed", providerStatus: "active", observedCapabilities: [], chargedUsd: null, failureCategory };
  }
}

export const PRIMARY_PROVIDER_QUALIFICATION = {
  capabilities: QUALIFICATION_CAPABILITIES,
  profileVersion: QUALIFICATION_PROFILE_VERSION,
  consumerType: QUALIFICATION_CONSUMER_TYPE,
  consumerRef: QUALIFICATION_CONSUMER_REF,
};

export const PRIMARY_PROVIDER_RICH_CONTENT_QUALIFICATION = {
  capabilities: RICH_CONTENT_QUALIFICATION_CAPABILITIES,
  profileVersion: RICH_CONTENT_QUALIFICATION_PROFILE_VERSION,
  consumerType: QUALIFICATION_CONSUMER_TYPE,
  consumerRef: RICH_CONTENT_QUALIFICATION_CONSUMER_REF,
};
