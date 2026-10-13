import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(),
  withDbTransaction: vi.fn(),
  getApifyProviderProfile: vi.fn(),
  isApiConnectionSecretConfigured: vi.fn(),
  createAcquisitionJob: vi.fn(),
  startRegisteredAiJob: vi.fn(),
  registerAiJobHandler: vi.fn(),
  findAcquisitionJobByIdempotency: vi.fn(),
  findFreshConfirmedSnapshotCoveringCapabilities: vi.fn(),
  createConfiguredApifyAmazonProvider: vi.fn(),
  storagePut: vi.fn(),
}));

vi.mock("../../repositories/dbClient", () => ({
  requireDb: mocks.requireDb,
  withDbTransaction: mocks.withDbTransaction,
}));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: mocks.registerAiJobHandler,
  startRegisteredAiJob: mocks.startRegisteredAiJob,
  updateAiJobProgress: vi.fn(),
}));
vi.mock("../../storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("../apiConnections/service", () => ({ isApiConnectionSecretConfigured: mocks.isApiConnectionSecretConfigured }));
vi.mock("./providerProfileService", () => ({ getApifyProviderProfile: mocks.getApifyProviderProfile }));
vi.mock("./apifyProvider", () => ({ createConfiguredApifyAmazonProvider: mocks.createConfiguredApifyAmazonProvider }));
vi.mock("./amazonNormalizer", () => ({ normalizeApifyAmazonArtifact: vi.fn() }));
vi.mock("./assetIngestion", () => ({ ingestAcquisitionAssets: vi.fn() }));
vi.mock("./consumerActivation", () => ({ activateConfirmedSnapshotForConsumer: vi.fn() }));
vi.mock("./snapshotReview", () => ({ confirmSnapshotForDirectIngestion: vi.fn() }));
vi.mock("./postConfirmation", () => ({ triggerConsumerPostConfirmation: vi.fn() }));
vi.mock("./repository", () => ({
  createAcquisitionJob: mocks.createAcquisitionJob,
  createAcquisitionRun: vi.fn(),
  createRawArtifact: vi.fn(),
  createSourceSnapshot: vi.fn(),
  findAcquisitionJobByIdempotency: mocks.findAcquisitionJobByIdempotency,
  findFreshConfirmedSnapshotCoveringCapabilities: mocks.findFreshConfirmedSnapshotCoveringCapabilities,
  getAcquisitionBudgetUsage: vi.fn(),
  getAcquisitionJob: vi.fn(),
  getActiveAcquisitionProfile: vi.fn(),
  nextAcquisitionRunAttempt: vi.fn(),
  updateAcquisitionJob: vi.fn(),
  updateAcquisitionRun: vi.fn(),
  updateSourceSnapshot: vi.fn(),
}));

import { AcquisitionJobRequestSchema, startAmazonAcquisitionJob, type AcquisitionJobRequest } from "./acquisitionJobs";

const input: AcquisitionJobRequest = {
  workspaceId: 11,
  requestedBy: 17,
  consumerType: "image_workflow",
  consumerRef: "project:23:competitor-gallery",
  marketplace: "US",
  asin: "B0DCTJLP9R",
  capabilities: ["catalog_basic", "image_gallery"],
  cachePolicy: "refresh",
  maxChargeUsd: 0.1,
};
describe("Standalone Amazon acquisition explicit unbound job metadata", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireDb.mockResolvedValue({});
    mocks.getApifyProviderProfile.mockResolvedValue({
      id: 3, status: "active", capabilities: ["catalog_basic", "image_gallery"],
      perRunMaxUsd: "0.1000", dailyBudgetUsd: "5.0000", monthlyBudgetUsd: "100.0000", cacheTtlSeconds: 86400,
    });
    mocks.isApiConnectionSecretConfigured.mockResolvedValue(true);
    mocks.findAcquisitionJobByIdempotency.mockResolvedValue(null);
    mocks.findFreshConfirmedSnapshotCoveringCapabilities.mockResolvedValue(null);
    mocks.createAcquisitionJob.mockResolvedValue(29);
    mocks.startRegisteredAiJob.mockResolvedValue({ runId: "ai-acquisition-29" });
  });

  it("persists explicit null Agent fields without changing queue, budget or request ownership", async () => {
    const result = await startAmazonAcquisitionJob(input);

    expect(mocks.startRegisteredAiJob).toHaveBeenCalledTimes(1);
    expect(mocks.startRegisteredAiJob).toHaveBeenCalledWith({
      kind: "amazon.acquisition.fetch", module: "amazonAcquisition", procedure: "amazonAcquisition.createJob",
      workspaceId: 11, userId: 17, skillSlug: "acquisition.amazon.catalog.fetch",
      input: { acquisitionJobId: 29, agentRunId: null, agentNodeId: null },
      queueName: "external_provider", maxAttempts: 2, timeoutSeconds: 300,
    });
    expect(mocks.createAcquisitionJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId: 11, requestedBy: 17, consumerRef: input.consumerRef, maxChargeUsd: "0.1000",
    }));
    expect(result).toEqual({ jobId: 29, status: "queued", cacheHitSnapshotId: null, aiJobRunId: "ai-acquisition-29" });
    expect(mocks.createConfiguredApifyAmazonProvider).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("does not expand the existing request contract to accept unverified Agent identities", () => {
    expect(AcquisitionJobRequestSchema.parse({
      ...input, agentRunId: "untrusted-run", agentNodeId: "untrusted-node",
    })).toEqual(input);
  });

  it("does not create or rebind a duplicate already-queued acquisition", async () => {
    mocks.findAcquisitionJobByIdempotency.mockResolvedValue({ id: 19, status: "queued", cacheHitSnapshotId: null });
    await expect(startAmazonAcquisitionJob(input)).resolves.toEqual({
      jobId: 19, status: "queued", cacheHitSnapshotId: null, aiJobRunId: null,
    });
    expect(mocks.createAcquisitionJob).not.toHaveBeenCalled();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
  });

  it("preserves the confirmed-cache early return without creating a worker job", async () => {
    mocks.findFreshConfirmedSnapshotCoveringCapabilities.mockResolvedValue({ complete: true, snapshot: { id: 37 } });
    mocks.findAcquisitionJobByIdempotency.mockResolvedValue({ id: 19, status: "confirmed", cacheHitSnapshotId: 37 });
    await expect(startAmazonAcquisitionJob({ ...input, cachePolicy: "prefer_cache" })).resolves.toEqual({
      jobId: 19, status: "confirmed", cacheHitSnapshotId: 37, aiJobRunId: null,
    });
    expect(mocks.createAcquisitionJob).not.toHaveBeenCalled();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
    expect(mocks.withDbTransaction).not.toHaveBeenCalled();
    expect(mocks.createConfiguredApifyAmazonProvider).not.toHaveBeenCalled();
  });
});
