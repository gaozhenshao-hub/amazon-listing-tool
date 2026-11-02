import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(),
  registerAiJobHandler: vi.fn(),
  updateAiJobProgress: vi.fn(),
  createConfiguredApifyAmazonProvider: vi.fn(),
  normalizeApifyAmazonArtifact: vi.fn(),
  ingestAcquisitionAssets: vi.fn(),
  storagePut: vi.fn(),
  getAcquisitionJob: vi.fn(),
  getActiveAcquisitionProfile: vi.fn(),
  getAcquisitionBudgetUsage: vi.fn(),
  nextAcquisitionRunAttempt: vi.fn(),
  createAcquisitionRun: vi.fn(),
  updateAcquisitionRun: vi.fn(),
  createRawArtifact: vi.fn(),
  createSourceSnapshot: vi.fn(),
  updateSourceSnapshot: vi.fn(),
  updateAcquisitionJob: vi.fn(),
  confirmSnapshotForDirectIngestion: vi.fn(),
  triggerConsumerPostConfirmation: vi.fn(),
}));

vi.mock("../../repositories/dbClient", () => ({ requireDb: mocks.requireDb, withDbTransaction: vi.fn() }));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: mocks.registerAiJobHandler,
  startRegisteredAiJob: vi.fn(),
  updateAiJobProgress: mocks.updateAiJobProgress,
}));
vi.mock("../../storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("./apifyProvider", () => ({ createConfiguredApifyAmazonProvider: mocks.createConfiguredApifyAmazonProvider }));
vi.mock("./amazonNormalizer", () => ({ normalizeApifyAmazonArtifact: mocks.normalizeApifyAmazonArtifact }));
vi.mock("./assetIngestion", () => ({ ingestAcquisitionAssets: mocks.ingestAcquisitionAssets }));
vi.mock("./providerProfileService", () => ({ getApifyProviderProfile: vi.fn() }));
vi.mock("./consumerActivation", () => ({ activateConfirmedSnapshotForConsumer: vi.fn() }));
vi.mock("./snapshotReview", () => ({ confirmSnapshotForDirectIngestion: mocks.confirmSnapshotForDirectIngestion }));
vi.mock("./postConfirmation", () => ({ triggerConsumerPostConfirmation: mocks.triggerConsumerPostConfirmation }));
vi.mock("../apiConnections/service", () => ({ isApiConnectionSecretConfigured: vi.fn() }));
vi.mock("./policy", async () => {
  const actual = await vi.importActual<typeof import("./policy")>("./policy");
  return { ...actual, evaluateAcquisitionBudget: vi.fn(() => ({ allowed: true })) };
});
vi.mock("./repository", () => ({
  createAcquisitionJob: vi.fn(),
  createAcquisitionRun: mocks.createAcquisitionRun,
  createRawArtifact: mocks.createRawArtifact,
  createSourceSnapshot: mocks.createSourceSnapshot,
  findAcquisitionJobByIdempotency: vi.fn(),
  findFreshConfirmedSnapshot: vi.fn(),
  getAcquisitionBudgetUsage: mocks.getAcquisitionBudgetUsage,
  getAcquisitionJob: mocks.getAcquisitionJob,
  getActiveAcquisitionProfile: mocks.getActiveAcquisitionProfile,
  nextAcquisitionRunAttempt: mocks.nextAcquisitionRunAttempt,
  updateAcquisitionJob: mocks.updateAcquisitionJob,
  updateAcquisitionRun: mocks.updateAcquisitionRun,
  updateSourceSnapshot: mocks.updateSourceSnapshot,
}));

import "./acquisitionJobs";

const registeredWorker = mocks.registerAiJobHandler.mock.calls.find(([entry]) => entry.id === "amazon-acquisition-fetch");

const worker = () => {
  if (!registeredWorker) throw new Error("acquisition worker was not registered");
  return registeredWorker[0].handler as (job: any) => Promise<any>;
};

const aiJob = {
  runId: "ai-run-1",
  workspaceId: 1,
  input: { acquisitionJobId: 8 },
  attempt: 1,
  maxAttempts: 2,
};

const job = {
  id: 8,
  providerProfileId: 3,
  requestedBy: 7,
  requestedCapabilities: ["catalog_basic", "image_gallery"],
  maxChargeUsd: "0.1000",
  idempotencyKey: "acquisition-job-idempotency-key",
  asin: "B012345678",
};

const profile = {
  id: 3,
  perRunMaxUsd: "0.1000",
  dailyBudgetUsd: "5.0000",
  monthlyBudgetUsd: "100.0000",
  cacheTtlSeconds: 86400,
};

const normalized = {
  sourceHash: "a".repeat(64),
  snapshot: {
    asin: "B012345678",
    marketplace: "US",
    sourceUrlHash: "b".repeat(64),
    title: "Sample product",
    brand: null,
    category: null,
    description: null,
    bulletPoints: [],
    price: null,
    rating: null,
    reviewCount: null,
    variantAsins: [],
    assets: [],
    fieldEvidence: {},
  },
  sourceAssets: [],
  completeness: { basicFieldsReturned: 1, mainGalleryCount: 1, aplusAssetCount: 0, brandStoryAssetCount: 0, variantCount: 0 },
};

function arrangeSucceededProvider() {
  mocks.getAcquisitionJob.mockResolvedValue(job);
  mocks.getActiveAcquisitionProfile.mockResolvedValue(profile);
  mocks.getAcquisitionBudgetUsage.mockResolvedValue({ dailyChargedUsd: 0, monthlyChargedUsd: 0 });
  mocks.nextAcquisitionRunAttempt.mockResolvedValue(1);
  mocks.createAcquisitionRun.mockResolvedValue(12);
  mocks.updateAcquisitionRun.mockResolvedValue(undefined);
  mocks.updateAcquisitionJob.mockResolvedValue(undefined);
  mocks.storagePut.mockResolvedValue({ storageUri: "s3://artifact" });
  mocks.createRawArtifact.mockResolvedValue(13);
  mocks.normalizeApifyAmazonArtifact.mockReturnValue(normalized);
  mocks.createSourceSnapshot.mockResolvedValue(14);
  mocks.ingestAcquisitionAssets.mockResolvedValue({ total: 1, stored: 1, failed: 0, results: [] });
  mocks.confirmSnapshotForDirectIngestion.mockResolvedValue({
    confirmedSnapshotId: 15,
    projection: { consumerType: "kb_images" },
  });
  mocks.triggerConsumerPostConfirmation.mockResolvedValue({ analysisJobRunId: null, analysisJobStatus: null, analysisJobError: null });
  mocks.createConfiguredApifyAmazonProvider.mockResolvedValue({
    estimate: vi.fn().mockResolvedValue({ estimatedMaxUsd: 0.1 }),
    fetch: vi.fn().mockResolvedValue({
      status: "succeeded",
      failureCategory: null,
      chargedUsd: 0,
      providerRunId: "provider-run-1",
      rawArtifact: { bytes: new Uint8Array([1]), contentType: "application/json", contentHash: "c".repeat(64), providerRunId: "provider-run-1" },
    }),
  });
}

describe("Amazon acquisition worker direct ingestion", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDb.mockResolvedValue({});
  });

  it("confirms and projects a complete successful result without review_required", async () => {
    arrangeSucceededProvider();

    const result = await worker()(aiJob);

    expect(mocks.confirmSnapshotForDirectIngestion).toHaveBeenCalledWith({ workspaceId: 1, snapshotId: 14, requestedBy: 7 });
    expect(mocks.triggerConsumerPostConfirmation).toHaveBeenCalledWith({ consumerType: "kb_images" });
    expect(mocks.updateAcquisitionJob).not.toHaveBeenCalledWith(expect.anything(), 1, 8, expect.objectContaining({ status: "review_required" }));
    expect(result).toMatchObject({ acquisitionJobId: 8, confirmedSnapshotId: 15, status: "confirmed", directIngestion: true });
  });

  it("fails closed for a partial provider result and does not create a direct ingestion snapshot", async () => {
    mocks.getAcquisitionJob.mockResolvedValue(job);
    mocks.getActiveAcquisitionProfile.mockResolvedValue(profile);
    mocks.getAcquisitionBudgetUsage.mockResolvedValue({ dailyChargedUsd: 0, monthlyChargedUsd: 0 });
    mocks.nextAcquisitionRunAttempt.mockResolvedValue(1);
    mocks.createAcquisitionRun.mockResolvedValue(12);
    mocks.createConfiguredApifyAmazonProvider.mockResolvedValue({
      estimate: vi.fn().mockResolvedValue({ estimatedMaxUsd: 0.1 }),
      fetch: vi.fn().mockResolvedValue({
        status: "partial",
        failureCategory: "partial_result",
        chargedUsd: 0,
        providerRunId: "provider-run-2",
        rawArtifact: { bytes: new Uint8Array([1]), contentType: "application/json", contentHash: "d".repeat(64), providerRunId: "provider-run-2" },
      }),
    });

    const result = await worker()(aiJob);

    expect(mocks.confirmSnapshotForDirectIngestion).not.toHaveBeenCalled();
    expect(mocks.createSourceSnapshot).not.toHaveBeenCalled();
    expect(mocks.updateAcquisitionJob).toHaveBeenCalledWith(expect.anything(), 1, 8, expect.objectContaining({ status: "failed" }));
    expect(result).toMatchObject({ acquisitionJobId: 8, status: "failed", failureCategory: "partial_result" });
  });
});
