import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(),
  registerAiJobHandler: vi.fn(),
  startRegisteredAiJob: vi.fn(),
  updateAiJobProgress: vi.fn(),
  evaluateAcquisitionBudget: vi.fn(),
  estimate: vi.fn(),
  fetch: vi.fn(),
  createMonitorRun: vi.fn(),
  getMonitorBudgetUsage: vi.fn(),
  getMonitorRun: vi.fn(),
  loadMonitorProviderProfileById: vi.fn(),
  loadMonitorTarget: vi.fn(),
  persistMonitorSnapshot: vi.fn(),
  updateMonitorRun: vi.fn(),
  getMonitorProviderProfile: vi.fn(),
  getQualifiedMonitorProviderProfile: vi.fn(),
  markMonitorProviderQualified: vi.fn(),
  markMonitorAgentConfirmed: vi.fn(),
  markMonitorAgentFailed: vi.fn(),
  markMonitorAgentRunning: vi.fn(),
  startMonitorAgentRun: vi.fn(),
  storagePut: vi.fn(),
  createConfiguredProvider: vi.fn(),
  registered: { handler: null as null | ((job: unknown) => Promise<unknown>) },
}));

vi.mock("../../repositories/dbClient", () => ({ requireDb: mocks.requireDb }));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: (registration: { handler: (job: unknown) => Promise<unknown> }) => { mocks.registerAiJobHandler(registration); mocks.registered.handler = registration.handler; },
  startRegisteredAiJob: mocks.startRegisteredAiJob,
  updateAiJobProgress: mocks.updateAiJobProgress,
}));
vi.mock("../../storage", () => ({ storagePut: mocks.storagePut }));
vi.mock("./policy", () => ({ evaluateAcquisitionBudget: mocks.evaluateAcquisitionBudget }));
vi.mock("./apifyMonitorProvider", () => ({
  ApifyAmazonMonitorProvider: class {
    estimate = mocks.estimate;
    fetch = mocks.fetch;
  },
  createConfiguredApifyAmazonMonitorProvider: mocks.createConfiguredProvider,
}));
vi.mock("./monitorRepository", () => ({
  createMonitorRun: mocks.createMonitorRun,
  getMonitorBudgetUsage: mocks.getMonitorBudgetUsage,
  getMonitorRun: mocks.getMonitorRun,
  loadMonitorProviderProfileById: mocks.loadMonitorProviderProfileById,
  loadMonitorTarget: mocks.loadMonitorTarget,
  persistMonitorSnapshot: mocks.persistMonitorSnapshot,
  updateMonitorRun: mocks.updateMonitorRun,
}));
vi.mock("./monitorProviderProfileService", () => ({
  getMonitorProviderProfile: mocks.getMonitorProviderProfile,
  getQualifiedMonitorProviderProfile: mocks.getQualifiedMonitorProviderProfile,
  markMonitorProviderQualified: mocks.markMonitorProviderQualified,
}));
vi.mock("./monitorAgent", () => ({
  markMonitorAgentConfirmed: mocks.markMonitorAgentConfirmed,
  markMonitorAgentFailed: mocks.markMonitorAgentFailed,
  markMonitorAgentRunning: mocks.markMonitorAgentRunning,
  startMonitorAgentRun: mocks.startMonitorAgentRun,
}));

import { resumeUnstartedMonitorQualificationRun, startAmazonMonitorJob, startMonitorQualificationJob } from "./monitorJob";

const profile = { id: 4, status: "active", perRunMaxUsd: "0.1000", dailyBudgetUsd: "5.0000", monthlyBudgetUsd: "100.0000", cacheTtlSeconds: 3600 };

describe("Amazon monitor Job", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireDb.mockResolvedValue({});
    mocks.loadMonitorTarget.mockResolvedValue({ active: true, marketplace: "US", asin: "B0H1VCSGWK", keyword: null, ownerUserId: 7 });
    mocks.getQualifiedMonitorProviderProfile.mockResolvedValue(profile);
    mocks.getMonitorProviderProfile.mockResolvedValue({ ...profile, status: "qualification_pending" });
    mocks.estimate.mockReturnValue({ estimatedMaxUsd: 0.002, pricingModel: "pay_per_snapshot" });
    mocks.createConfiguredProvider.mockResolvedValue({ estimate: mocks.estimate, fetch: mocks.fetch });
    mocks.createMonitorRun.mockResolvedValue({ reused: false, run: { id: 31 } });
    mocks.startMonitorAgentRun.mockResolvedValue({ agentRunId: "agent-31", agentNodeId: "provider_snapshot" });
    mocks.startRegisteredAiJob.mockResolvedValue({ runId: "job-31", status: "queued" });
    mocks.updateMonitorRun.mockResolvedValue(undefined);
    mocks.markMonitorAgentRunning.mockResolvedValue(undefined);
    mocks.markMonitorAgentConfirmed.mockResolvedValue(undefined);
    mocks.markMonitorAgentFailed.mockResolvedValue(undefined);
    mocks.updateAiJobProgress.mockResolvedValue(undefined);
  });

  it("fails closed before creating a Run when the capability is not qualified", async () => {
    mocks.getQualifiedMonitorProviderProfile.mockResolvedValue(null);
    await expect(startAmazonMonitorJob({ workspaceId: 2, userId: 7, kind: "competitor", monitorId: 9 })).rejects.toThrow("尚未完成Provider资格验证");
    expect(mocks.createMonitorRun).not.toHaveBeenCalled();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
  });

  it("creates a persistent Monitor Run, Agent Run and acquisition queue Job", async () => {
    const result = await startAmazonMonitorJob({ workspaceId: 2, userId: 7, kind: "competitor", monitorId: 9, idempotencyKey: "heartbeat-task-9-2026-09-13" });
    expect(mocks.createMonitorRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ workspaceId: 2, monitorKind: "competitor", monitorId: 9, requestedCapabilities: ["offers", "rankings"], idempotencyKey: "heartbeat-task-9-2026-09-13" }));
    expect(mocks.startRegisteredAiJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "amazon.monitor.competitor.execute", queueName: "acquisition", maxAttempts: 1 }));
    expect(result).toEqual({ monitorRunId: 31, aiJobRunId: "job-31", status: "queued", reused: false });
  });

  it("persists the explicitly authorized three-page keyword qualification scope without expanding the charge cap", async () => {
    const result = await startMonitorQualificationJob({
      workspaceId: 2,
      userId: 7,
      kind: "keyword",
      asin: "B0H1VCSGWK",
      keyword: "example keyword",
      depth: 3,
      maxChargeUsd: 0.1,
      confirmExternalCharge: true,
    });
    expect(mocks.createMonitorRun).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      workspaceId: 2,
      monitorKind: "keyword",
      triggerType: "qualification",
      postalCode: "10001",
      depth: 3,
      maxChargeUsd: "0.1000",
    }));
    expect(mocks.startRegisteredAiJob).toHaveBeenCalledWith(expect.objectContaining({ kind: "amazon.monitor.keyword.qualify", queueName: "acquisition" }));
    expect(result).toEqual({ monitorRunId: 31, aiJobRunId: "job-31", status: "queued" });
  });

  it("fails closed after Run persistence when Agent or Job registration fails", async () => {
    mocks.startMonitorAgentRun.mockRejectedValueOnce(new Error("unsupported Agent node"));
    await expect(startMonitorQualificationJob({
      workspaceId: 2,
      userId: 7,
      kind: "competitor",
      asin: "B0H1VCSGWK",
      maxChargeUsd: 0.1,
      confirmExternalCharge: true,
    })).rejects.toThrow("unsupported Agent node");
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
    expect(mocks.updateMonitorRun).toHaveBeenCalledWith(expect.anything(), 2, 31, expect.objectContaining({
      status: "failed",
      failureCategory: "job_enqueue_failed",
    }));
  });

  it("only resumes an unstarted qualification Run without Provider, Agent or Job evidence", async () => {
    mocks.getMonitorRun.mockResolvedValue({
      id: 31,
      monitorKind: "competitor",
      triggerType: "qualification",
      status: "queued",
      providerProfileId: 4,
      monitorId: null,
      asin: "B0H1VCSGWK",
      requestedBy: 7,
      providerRunId: null,
      agentRunId: null,
      aiJobRunId: null,
      rawStorageKey: null,
      chargedUsd: null,
    });
    mocks.loadMonitorProviderProfileById.mockResolvedValue({ ...profile, status: "qualification_pending" });
    await expect(resumeUnstartedMonitorQualificationRun({ workspaceId: 2, userId: 7, monitorRunId: 31 }))
      .resolves.toEqual({ monitorRunId: 31, aiJobRunId: "job-31", status: "queued" });
    expect(mocks.startRegisteredAiJob).toHaveBeenCalledWith(expect.objectContaining({
      kind: "amazon.monitor.competitor.qualify",
      procedure: "crawler.resumeQualification",
    }));
  });

  it("refuses to resume a qualification Run with any Provider execution evidence", async () => {
    mocks.getMonitorRun.mockResolvedValue({
      id: 31,
      monitorKind: "competitor",
      triggerType: "qualification",
      status: "queued",
      providerProfileId: 4,
      monitorId: null,
      asin: "B0H1VCSGWK",
      requestedBy: 7,
      providerRunId: "provider-31",
      agentRunId: null,
      aiJobRunId: null,
      rawStorageKey: null,
      chargedUsd: null,
    });
    await expect(resumeUnstartedMonitorQualificationRun({ workspaceId: 2, userId: 7, monitorRunId: 31 }))
      .rejects.toThrow("禁止恢复");
    expect(mocks.startMonitorAgentRun).not.toHaveBeenCalled();
    expect(mocks.startRegisteredAiJob).not.toHaveBeenCalled();
  });

  it("archives raw evidence, persists the normalized snapshot and completes the Tool node", async () => {
    const normalized = { kind: "competitor", asin: "B0H1VCSGWK", marketplace: "US", title: "Example", price: "29.99", currency: "USD", bsrRank: 100, bsrCategory: "Home", bsrCategories: [], buyBoxWinner: null, buyBoxSellerName: null, shipsFrom: null, offerCount: 2, snapshotAt: null, coverage: { price: "returned", bsrRank: "returned", buyBox: "not_returned", offerCount: "returned", ratings: "provider_unsupported", availability: "provider_unsupported", coupon: "provider_unsupported", deal: "provider_unsupported" } };
    mocks.getMonitorRun.mockResolvedValue({ id: 31, triggerType: "manual", providerProfileId: 4, monitorId: 9, asin: "B0H1VCSGWK", keyword: null, postalCode: "10001", depth: 1, maxChargeUsd: "0.0500", idempotencyKey: "monitor-run-31-test", status: "queued" });
    mocks.loadMonitorProviderProfileById.mockResolvedValue(profile);
    mocks.getMonitorBudgetUsage.mockResolvedValue({ dailyUsedUsd: 0, monthlyUsedUsd: 0 });
    mocks.evaluateAcquisitionBudget.mockReturnValue({ allowed: true });
    mocks.fetch.mockResolvedValue({ providerCode: "apify_bsr", providerRunId: "provider-31", status: "succeeded", failureCategory: null, chargedUsd: 0.002, rawArtifact: { bytes: new TextEncoder().encode("[]"), contentHash: "a".repeat(64), contentType: "application/json" }, normalized });
    mocks.storagePut.mockResolvedValue({ storageUri: "s3://bucket/monitor-run-31.json" });
    mocks.persistMonitorSnapshot.mockResolvedValue(77);
    if (!mocks.registered.handler) throw new Error("Monitor handler was not registered");
    const output = await mocks.registered.handler({ runId: "job-31", attempt: 1, input: { monitorRunId: 31, workspaceId: 2, userId: 7, kind: "competitor", agentRunId: "agent-31", agentNodeId: "provider_snapshot" } });
    expect(mocks.storagePut).toHaveBeenCalledWith(expect.stringContaining("workspace-2/run-31"), expect.any(Uint8Array), "application/json");
    expect(mocks.persistMonitorSnapshot).toHaveBeenCalledWith(expect.objectContaining({ workspaceId: 2, monitorId: 9, result: normalized }));
    expect(mocks.markMonitorAgentConfirmed).toHaveBeenCalledWith(expect.objectContaining({ agentRunId: "agent-31", aiJobRunId: "job-31" }));
    expect(output).toMatchObject({ monitorRunId: 31, snapshotId: 77, providerRunId: "provider-31" });
  });

  it("marks the Run partial and refuses projection when required capability evidence is missing", async () => {
    const normalized = { kind: "competitor", asin: "B0H1VCSGWK", marketplace: "US", title: "Example", price: "29.99", currency: "USD", bsrRank: 100, bsrCategory: "Home", bsrCategories: [], buyBoxWinner: null, buyBoxSellerName: null, shipsFrom: null, offerCount: null, snapshotAt: null, coverage: { price: "returned", bsrRank: "returned", buyBox: "not_returned", offerCount: "not_returned", ratings: "provider_unsupported", availability: "provider_unsupported", coupon: "provider_unsupported", deal: "provider_unsupported" } };
    mocks.getMonitorRun.mockResolvedValue({ id: 31, triggerType: "qualification", providerProfileId: 4, monitorId: null, asin: "B0H1VCSGWK", keyword: null, postalCode: "10001", depth: 1, maxChargeUsd: "0.0500", idempotencyKey: "monitor-run-31-test", status: "queued" });
    mocks.loadMonitorProviderProfileById.mockResolvedValue({ ...profile, status: "qualification_pending" });
    mocks.getMonitorBudgetUsage.mockResolvedValue({ dailyChargedUsd: 0, monthlyChargedUsd: 0 });
    mocks.evaluateAcquisitionBudget.mockReturnValue({ allowed: true });
    mocks.fetch.mockResolvedValue({ providerCode: "apify_bsr", providerRunId: "provider-31", status: "succeeded", failureCategory: null, chargedUsd: 0.002, rawArtifact: null, normalized });
    if (!mocks.registered.handler) throw new Error("Monitor handler was not registered");
    await expect(mocks.registered.handler({ runId: "job-31", attempt: 1, input: { monitorRunId: 31, workspaceId: 2, userId: 7, kind: "competitor", agentRunId: "agent-31", agentNodeId: "provider_snapshot" } })).rejects.toThrow("required evidence missing");
    expect(mocks.persistMonitorSnapshot).not.toHaveBeenCalled();
    expect(mocks.markMonitorProviderQualified).not.toHaveBeenCalled();
    expect(mocks.updateMonitorRun).toHaveBeenCalledWith(expect.anything(), 2, 31, expect.objectContaining({ status: "partial", failureCategory: "schema_drift" }));
  });
});
