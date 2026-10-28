import { beforeEach, describe, expect, it, vi } from "vitest";
import { toTrpcError } from "../../_core/appError";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(),
  getBasicImagesProfile: vi.fn(),
  createAcquisitionJob: vi.fn(),
  startRegisteredAiJob: vi.fn(),
  registerAiJobHandler: vi.fn(),
  findFreshConfirmedSnapshotCoveringCapabilities: vi.fn(),
}));

vi.mock("../../repositories/dbClient", () => ({
  requireDb: mocks.requireDb,
  withDbTransaction: vi.fn(),
}));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: mocks.registerAiJobHandler,
  startRegisteredAiJob: mocks.startRegisteredAiJob,
  updateAiJobProgress: vi.fn(),
}));
vi.mock("../../storage", () => ({ storagePut: vi.fn() }));
vi.mock("./basicProviderProfile", () => ({ getBasicImagesProfile: mocks.getBasicImagesProfile }));
vi.mock("./basicAmazonProvider", () => ({ BasicAmazonImagesProvider: vi.fn() }));
vi.mock("./amazonNormalizer", () => ({ normalizeAmazonArtifact: vi.fn() }));
vi.mock("./assetIngestion", () => ({ ingestAcquisitionAssets: vi.fn() }));
vi.mock("./consumerActivation", () => ({ activateConfirmedSnapshotForConsumer: vi.fn() }));
vi.mock("./postConfirmation", () => ({ triggerConsumerPostConfirmation: vi.fn() }));
vi.mock("./repository", () => ({
  createAcquisitionJob: mocks.createAcquisitionJob,
  createAcquisitionRun: vi.fn(),
  createRawArtifact: vi.fn(),
  createSourceSnapshot: vi.fn(),
  findAcquisitionJobByIdempotency: vi.fn(),
  findFreshConfirmedSnapshotCoveringCapabilities: mocks.findFreshConfirmedSnapshotCoveringCapabilities,
  getAcquisitionJob: vi.fn(),
  getBasicImagesProfile: vi.fn(),
  nextAcquisitionRunAttempt: vi.fn(),
  updateAcquisitionJob: vi.fn(),
  updateAcquisitionRun: vi.fn(),
  updateSourceSnapshot: vi.fn(),
}));

import { startAmazonAcquisitionJob } from "./acquisitionJobs";

const input = {
  workspaceId: 1,
  requestedBy: 7,
  consumerType: "image_workflow" as const,
  consumerRef: "project:12:competitor-gallery",
  marketplace: "US" as const,
  asin: "B0DCTJLP9R",
  capabilities: ["catalog_basic", "image_gallery"] as const,
  cachePolicy: "prefer_cache" as const,
};

describe("Amazon acquisition job preconditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDb.mockResolvedValue({});
  });

  it("returns a readable failed-closed precondition when no Provider profile exists", async () => {
    mocks.getBasicImagesProfile.mockResolvedValue(null);

    await expect(startAmazonAcquisitionJob(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      statusCode: 412,
      message: expect.stringContaining("尚未启用"),
    });
    expect(mocks.createAcquisitionJob).not.toHaveBeenCalled();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
  });

  it("returns a readable failed-closed precondition when requested capabilities are unsupported", async () => {
    mocks.getBasicImagesProfile.mockResolvedValue({
      id: 3,
      status: "active", capabilities: [],
      perRunMaxUsd: "0.1000",
      dailyBudgetUsd: "5.0000",
      monthlyBudgetUsd: "100.0000",
      cacheTtlSeconds: 86400,
    });

    const failure = await startAmazonAcquisitionJob(input).then(
      () => { throw new Error("expected acquisition Provider precondition"); },
      error => error,
    );
    expect(failure).toMatchObject({
      code: "PRECONDITION_FAILED",
      statusCode: 412,
      message: expect.stringContaining("尚不支持"),
    });
    expect(toTrpcError(failure)).toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("尚不支持"),
    });
    expect(mocks.createAcquisitionJob).not.toHaveBeenCalled();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
  });

  it("cache-only misses when A+ is requested from a gallery-only snapshot without calling a Provider or deleting gallery history", async () => {
    const galleryHistory = { confirmedAssetIds: [101, 102] };
    mocks.getBasicImagesProfile.mockResolvedValue(null);
    mocks.findFreshConfirmedSnapshotCoveringCapabilities.mockResolvedValue({
      complete: false,
      snapshot: { id: 44 },
      coverage: [
        { capability: "image_gallery", state: "returned", safelyStoredAssetIds: [101, 102], failedAssetIds: [] },
        { capability: "aplus", state: "not_returned", safelyStoredAssetIds: [], failedAssetIds: [] },
      ],
    });

    const error = await startAmazonAcquisitionJob({
      ...input,
      capabilities: ["image_gallery", "aplus"],
      cachePolicy: "cache_only",
    }).then(
      () => { throw new Error("expected capability coverage cache miss"); },
      cause => cause,
    );

    expect(error).toMatchObject({
      code: "PRECONDITION_FAILED",
      statusCode: 412,
      message: expect.stringContaining("aplus:not_returned"),
      details: { reason: "capability_coverage_incomplete", cacheSnapshotId: 44 },
    });
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
    expect(mocks.createAcquisitionJob).not.toHaveBeenCalled();
    expect(galleryHistory.confirmedAssetIds).toEqual([101, 102]);
  });
});
