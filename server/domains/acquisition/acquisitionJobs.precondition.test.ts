import { beforeEach, describe, expect, it, vi } from "vitest";
import { toTrpcError } from "../../_core/appError";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(),
  getApifyProviderProfile: vi.fn(),
  isApiConnectionSecretConfigured: vi.fn(),
  createAcquisitionJob: vi.fn(),
  startRegisteredAiJob: vi.fn(),
  registerAiJobHandler: vi.fn(),
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
vi.mock("../apiConnections/service", () => ({ isApiConnectionSecretConfigured: mocks.isApiConnectionSecretConfigured }));
vi.mock("./providerProfileService", () => ({ getApifyProviderProfile: mocks.getApifyProviderProfile }));
vi.mock("./apifyProvider", () => ({ createConfiguredApifyAmazonProvider: vi.fn() }));
vi.mock("./amazonNormalizer", () => ({ normalizeApifyAmazonArtifact: vi.fn() }));
vi.mock("./assetIngestion", () => ({ ingestAcquisitionAssets: vi.fn() }));
vi.mock("./consumerActivation", () => ({ activateConfirmedSnapshotForConsumer: vi.fn() }));
vi.mock("./postConfirmation", () => ({ triggerConsumerPostConfirmation: vi.fn() }));
vi.mock("./repository", () => ({
  createAcquisitionJob: mocks.createAcquisitionJob,
  createAcquisitionRun: vi.fn(),
  createRawArtifact: vi.fn(),
  createSourceSnapshot: vi.fn(),
  findAcquisitionJobByIdempotency: vi.fn(),
  findFreshConfirmedSnapshot: vi.fn(),
  getAcquisitionBudgetUsage: vi.fn(),
  getAcquisitionJob: vi.fn(),
  getActiveAcquisitionProfile: vi.fn(),
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
  maxChargeUsd: 0.1,
};

describe("Amazon acquisition job preconditions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDb.mockResolvedValue({});
    mocks.isApiConnectionSecretConfigured.mockResolvedValue(true);
  });

  it("returns a readable failed-closed precondition when no Provider profile exists", async () => {
    mocks.getApifyProviderProfile.mockResolvedValue(null);

    await expect(startAmazonAcquisitionJob(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      statusCode: 412,
      message: expect.stringContaining("尚未配置"),
    });
    expect(mocks.createAcquisitionJob).not.toHaveBeenCalled();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
  });

  it("returns a readable failed-closed precondition when a profile remains pending", async () => {
    mocks.getApifyProviderProfile.mockResolvedValue({
      id: 3,
      status: "qualification_pending",
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
      message: expect.stringContaining("未启用"),
    });
    expect(toTrpcError(failure)).toMatchObject({
      code: "PRECONDITION_FAILED",
      message: expect.stringContaining("未启用"),
    });
    expect(mocks.createAcquisitionJob).not.toHaveBeenCalled();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
  });
});
