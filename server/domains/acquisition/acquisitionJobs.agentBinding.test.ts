import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(),
  withDbTransaction: vi.fn(),
  getBasicImagesProfile: vi.fn(),
  createAcquisitionJob: vi.fn(),
  startRegisteredAiJob: vi.fn(),
  registerAiJobHandler: vi.fn(),
  findAcquisitionJobByIdempotency: vi.fn(),
  findFreshConfirmedSnapshotCoveringCapabilities: vi.fn(),
  BasicAmazonImagesProvider: vi.fn(),
  storagePut: vi.fn(),
  activate: vi.fn(),
  post: vi.fn(),
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
vi.mock("./basicProviderProfile", () => ({ getBasicImagesProfile: mocks.getBasicImagesProfile }));
vi.mock("./basicAmazonProvider", () => ({ BasicAmazonImagesProvider: mocks.BasicAmazonImagesProvider }));
vi.mock("./amazonNormalizer", () => ({ normalizeAmazonArtifact: vi.fn() }));
vi.mock("./assetIngestion", () => ({ ingestAcquisitionAssets: vi.fn() }));
vi.mock("./consumerActivation", () => ({ activateConfirmedSnapshotForConsumer: mocks.activate }));
vi.mock("./snapshotReview", () => ({ confirmSnapshotForDirectIngestion: vi.fn() }));
vi.mock("./postConfirmation", () => ({ triggerConsumerPostConfirmation: mocks.post }));
vi.mock("./repository", () => ({
  createAcquisitionJob: mocks.createAcquisitionJob,
  createAcquisitionRun: vi.fn(),
  createRawArtifact: vi.fn(),
  createSourceSnapshot: vi.fn(),
  findAcquisitionJobByIdempotency: mocks.findAcquisitionJobByIdempotency,
  findFreshConfirmedSnapshotCoveringCapabilities: mocks.findFreshConfirmedSnapshotCoveringCapabilities,
  getAcquisitionJob: vi.fn(),
  getBasicImagesProfile: vi.fn(),
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
};
describe("Standalone Amazon acquisition explicit unbound job metadata", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.requireDb.mockResolvedValue({});
    mocks.getBasicImagesProfile.mockResolvedValue({
      id: 3, status: "active", capabilities: ["catalog_basic", "image_gallery"],
      perRunMaxUsd: "0.1000", dailyBudgetUsd: "5.0000", monthlyBudgetUsd: "100.0000", cacheTtlSeconds: 86400,
    });
    mocks.findAcquisitionJobByIdempotency.mockResolvedValue(null);
    mocks.findFreshConfirmedSnapshotCoveringCapabilities.mockResolvedValue(null);
    mocks.createAcquisitionJob.mockResolvedValue(29);
    mocks.startRegisteredAiJob.mockResolvedValue({ runId: "ai-acquisition-29" });
  });

  it("persists explicit null Agent fields with zero collection cost and preserved request ownership", async () => {
    const result = await startAmazonAcquisitionJob(input);

    expect(mocks.startRegisteredAiJob).toHaveBeenCalledTimes(1);
    expect(mocks.startRegisteredAiJob).toHaveBeenCalledWith({
      kind: "amazon.acquisition.fetch", module: "amazonAcquisition", procedure: "amazonAcquisition.createJob",
      workspaceId: 11, userId: 17, skillSlug: "acquisition.amazon.catalog.fetch",
      input: { acquisitionJobId: 29, agentRunId: null, agentNodeId: null },
      queueName: "amazon_acquisition", maxAttempts: 2, timeoutSeconds: 900,
    });
    expect(mocks.createAcquisitionJob).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId: 11, requestedBy: 17, consumerRef: input.consumerRef, maxChargeUsd: "0.0000",
    }));
    expect(result).toEqual({ jobId: 29, status: "queued", cacheHitSnapshotId: null, aiJobRunId: "ai-acquisition-29" });
    expect(mocks.BasicAmazonImagesProvider).not.toHaveBeenCalled();
    expect(mocks.storagePut).not.toHaveBeenCalled();
  });

  it("does not expand the existing request contract to accept unverified Agent identities", () => {
    expect(AcquisitionJobRequestSchema.parse({
      ...input, agentRunId: "untrusted-run", agentNodeId: "untrusted-node",
    })).toEqual(input);
  });
  it.each([false, true])("capture cache replay=%s revalidates and atomically projects without a model or provider", async replay => {
    const tx = { scoped: true };
    mocks.findFreshConfirmedSnapshotCoveringCapabilities.mockResolvedValue({ complete: true, snapshot: { id: 37 } });
    mocks.findAcquisitionJobByIdempotency.mockResolvedValue(replay ? { id: 19, status: "confirmed", cacheHitSnapshotId: 37, requestedBy: 17 } : null);
    mocks.withDbTransaction.mockImplementation(async (_context, callback) => callback(tx));
    const projection = { consumerType: "project_competitor", captureOnly: true, analysisId: 20 };
    mocks.activate.mockResolvedValue(projection); mocks.post.mockResolvedValue({ analysisJobRunId: null, analysisJobStatus: null, analysisJobError: null, collectedAnalysisId: 20 });
    const result = await startAmazonAcquisitionJob({ ...input, consumerType: "project_competitor", consumerRef: "project-competitor:23:B0DCTJLP9R:capture-v1", cachePolicy: "prefer_cache" });
    expect(result).toMatchObject({ status: "confirmed", collectedAnalysisId: 20, analysisJobRunId: null });
    expect(mocks.withDbTransaction).toHaveBeenCalledWith(expect.any(String), expect.any(Function), { required: true });
    expect(mocks.activate).toHaveBeenCalledWith(expect.objectContaining({ db: tx, confirmedSnapshotId: 37, job: expect.objectContaining({ consumerRef: "project-competitor:23:B0DCTJLP9R:capture-v1" }) }));
    expect(mocks.post).toHaveBeenCalledWith(projection);
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled(); expect(mocks.BasicAmazonImagesProvider).not.toHaveBeenCalled();
    expect(mocks.createAcquisitionJob).toHaveBeenCalledTimes(replay ? 0 : 1);
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
    mocks.findAcquisitionJobByIdempotency.mockResolvedValue({ id: 19, status: "confirmed", cacheHitSnapshotId: 37, requestedBy: input.requestedBy });
    mocks.withDbTransaction.mockImplementation(async (_context, callback) => callback({}));
    await expect(startAmazonAcquisitionJob({ ...input, cachePolicy: "prefer_cache" })).resolves.toMatchObject({
      jobId: 19, status: "confirmed", cacheHitSnapshotId: 37, aiJobRunId: null,
    });
    expect(mocks.createAcquisitionJob).not.toHaveBeenCalled();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
    expect(mocks.withDbTransaction).toHaveBeenCalledTimes(1);
    expect(mocks.BasicAmazonImagesProvider).not.toHaveBeenCalled();
  });
});
