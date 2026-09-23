import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(),
  secretConfigured: vi.fn(),
  createProvider: vi.fn(),
  getProfile: vi.fn(),
  finalizeProfile: vi.fn(),
  createJob: vi.fn(),
  createRun: vi.fn(),
  findByIdempotency: vi.fn(),
  budgetUsage: vi.fn(),
  updateJob: vi.fn(),
  updateRun: vi.fn(),
  normalize: vi.fn(),
}));

vi.mock("../../repositories/dbClient", () => ({ requireDb: mocks.requireDb }));
vi.mock("../apiConnections/service", () => ({ isApiConnectionSecretConfigured: mocks.secretConfigured }));
vi.mock("./apifyProvider", () => ({ createConfiguredApifyAmazonProvider: mocks.createProvider }));
vi.mock("./providerProfileService", () => ({
  getApifyProviderProfile: mocks.getProfile,
  finalizeApifyProviderQualification: mocks.finalizeProfile,
}));
vi.mock("./repository", () => ({
  createAcquisitionJob: mocks.createJob,
  createAcquisitionRun: mocks.createRun,
  findAcquisitionJobByIdempotency: mocks.findByIdempotency,
  getAcquisitionBudgetUsage: mocks.budgetUsage,
  updateAcquisitionJob: mocks.updateJob,
  updateAcquisitionRun: mocks.updateRun,
}));
vi.mock("./amazonNormalizer", () => ({ normalizeApifyAmazonArtifact: mocks.normalize }));

import { runPrimaryProviderQualification } from "./providerQualification";

const input = { workspaceId: 1, requestedBy: 7, testAsin: "B0DCTJLP9R", maxChargeUsd: 0.1 as const };
const pendingProfile = {
  id: 11,
  status: "qualification_pending",
  perRunMaxUsd: 0.1,
  dailyBudgetUsd: 5,
  monthlyBudgetUsd: 100,
  cacheTtlSeconds: 86400,
  capabilities: [],
};

describe("primary Provider qualification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDb.mockResolvedValue({});
    mocks.secretConfigured.mockResolvedValue(true);
    mocks.getProfile.mockResolvedValue(pendingProfile);
    mocks.findByIdempotency.mockResolvedValue(null);
    mocks.createJob.mockResolvedValue(101);
    mocks.createRun.mockResolvedValue(202);
    mocks.budgetUsage.mockResolvedValue({ dailyChargedUsd: 0, monthlyChargedUsd: 0 });
  });

  it("records one redacted technical qualification and activates only observed required capabilities", async () => {
    const fetch = vi.fn().mockResolvedValue({
      providerCode: "apify.junglee.amazon_crawler",
      providerRunId: "run-private",
      status: "succeeded",
      failureCategory: null,
      chargedUsd: 0.005,
      rawArtifact: { bytes: new Uint8Array([1]), contentHash: "a".repeat(64), contentType: "application/json" },
    });
    mocks.createProvider.mockResolvedValue({ estimate: vi.fn().mockResolvedValue({ estimatedMaxUsd: 0.005 }), fetch });
    mocks.normalize.mockReturnValue({
      completeness: { basicFieldsReturned: 3, mainGalleryCount: 2 },
      sourceHash: "ignored",
      snapshot: {},
    });

    const result = await runPrimaryProviderQualification(input);

    expect(result).toEqual(expect.objectContaining({
      jobId: 101,
      runId: 202,
      status: "qualified",
      providerStatus: "active",
      observedCapabilities: ["catalog_basic", "image_gallery"],
      chargedUsd: 0.005,
    }));
    expect(mocks.createJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      consumerType: "provider_qualification",
      consumerRef: "apify-primary-gallery-r2",
      asin: "QUALIFY001",
      requestedCapabilities: ["catalog_basic", "image_gallery"],
    }));
    expect(fetch).toHaveBeenCalledWith(expect.objectContaining({
      asin: input.testAsin,
      capabilities: ["catalog_basic", "image_gallery"],
      maxChargeUsd: 0.1,
    }));
    expect(mocks.finalizeProfile).toHaveBeenCalledWith(expect.objectContaining({
      jobId: 101,
      runId: 202,
      record: expect.objectContaining({ observedCapabilities: ["catalog_basic", "image_gallery"] }),
    }));
    expect(JSON.stringify(mocks.createJob.mock.calls)).not.toContain(input.testAsin);
    expect(JSON.stringify(mocks.finalizeProfile.mock.calls)).not.toContain(input.testAsin);
  });

  it("fails closed after an incomplete sample and does not activate the Provider", async () => {
    mocks.createProvider.mockResolvedValue({
      estimate: vi.fn().mockResolvedValue({ estimatedMaxUsd: 0.005 }),
      fetch: vi.fn().mockResolvedValue({
        providerCode: "apify.junglee.amazon_crawler",
        providerRunId: "run-private",
        status: "succeeded",
        failureCategory: null,
        chargedUsd: 0.005,
        rawArtifact: { bytes: new Uint8Array([1]), contentHash: "b".repeat(64), contentType: "application/json" },
      }),
    });
    mocks.normalize.mockReturnValue({ completeness: { basicFieldsReturned: 2, mainGalleryCount: 0 }, sourceHash: "ignored", snapshot: {} });

    const result = await runPrimaryProviderQualification(input);

    expect(result).toEqual(expect.objectContaining({ status: "failed", providerStatus: "qualification_pending" }));
    expect(mocks.finalizeProfile).not.toHaveBeenCalled();
    expect(mocks.updateJob).toHaveBeenCalledWith(expect.anything(), 1, 101, expect.objectContaining({ status: "failed" }));
  });

  it("rejects a repeated qualification attempt before an external Provider call", async () => {
    mocks.findByIdempotency.mockResolvedValue({ id: 77, status: "failed" });

    await expect(runPrimaryProviderQualification(input)).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      statusCode: 412,
      message: expect.stringContaining("不会自动重试"),
    });
    expect(mocks.createProvider).not.toHaveBeenCalled();
    expect(mocks.createJob).not.toHaveBeenCalled();
  });
});
