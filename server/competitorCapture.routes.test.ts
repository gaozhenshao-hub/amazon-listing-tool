import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const calls = vi.hoisted(() => ({ getProject: vi.fn(), update: vi.fn(), acquisition: vi.fn() }));
vi.mock("./repositories", async original => ({ ...await original<typeof import("./repositories")>(), getProjectById: calls.getProject, updateProject: calls.update }));
vi.mock("./domains/acquisition/acquisitionJobs", () => ({ startAmazonAcquisitionJob: calls.acquisition }));
import { analysisRouter } from "./routers/analysis";
const ctx = { user: { id: 7, role: "ops_specialist", defaultWorkspaceId: 3 }, workspaceId: 3, req: {}, res: {}, requestId: "capture-route" } as TrpcContext;
const input = { projectId: 11, asin: "B012345678", captureOnly: true, expectedWorkspaceId: 3 };
beforeEach(() => {
  vi.clearAllMocks(); calls.getProject.mockResolvedValue({ id: 11, workspaceId: 3, userId: 7 });
  calls.acquisition.mockResolvedValue({ jobId: 9, status: "confirmed", cacheHitSnapshotId: 10, collectedAnalysisId: 20 });
});
describe("opt-in selected competitor capture routes", () => {
  it("persists mode in the consumer ref and does not mark the project analyzing", async () => {
    expect(await analysisRouter.createCaller(ctx).analyzeAsin(input)).toMatchObject({ status: "collected", analysisJobRunId: null, reviewRequired: false });
    expect(calls.acquisition).toHaveBeenCalledWith(expect.objectContaining({ consumerType: "project_competitor", consumerRef: "project-competitor:11:B012345678:capture-v1", requestedBy: 7, workspaceId: 3 }));
    expect(calls.getProject).toHaveBeenCalledWith(11, 7, 3); expect(calls.update).not.toHaveBeenCalled();
  });
  it.each([undefined, null, 4])("requires the explicit current workspace: %s", async expectedWorkspaceId => {
    await expect(analysisRouter.createCaller(ctx).analyzeAsin({ ...input, expectedWorkspaceId })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(calls.acquisition).not.toHaveBeenCalled();
  });
  it("does not fall back from authenticated NULL to the user's default workspace", async () => {
    await expect(analysisRouter.createCaller({ ...ctx, workspaceId: null }).analyzeAsin(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(calls.acquisition).not.toHaveBeenCalled();
  });
  it.each([{ userId: 8, workspaceId: 3 }, { userId: 7, workspaceId: 4 }])("rejects foreign project scope %#", async changed => {
    calls.getProject.mockResolvedValue({ id: 11, ...changed });
    await expect(analysisRouter.createCaller(ctx).analyzeAsin(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls.acquisition).not.toHaveBeenCalled();
  });
  it("does not call a new queued task collected or cached", async () => {
    calls.acquisition.mockResolvedValue({ jobId: 9, status: "queued", cacheHitSnapshotId: null });
    expect(await analysisRouter.createCaller(ctx).analyzeAsin(input)).toMatchObject({ status: "direct_ingestion_pending", directIngestionPending: true, cacheHitSnapshotId: null });
  });
  it.each(["failed", "canceled"])("does not report %s acquisition as pending", async status => {
    calls.acquisition.mockResolvedValue({ jobId: 9, status });
    await expect(analysisRouter.createCaller(ctx).analyzeAsin(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("retains legacy mode while reporting unknown analysis status honestly", async () => {
    expect(await analysisRouter.createCaller(ctx).analyzeAsin({ projectId: 11, asin: input.asin })).toMatchObject({ status: "analysis_status_unknown" });
    expect(calls.acquisition).toHaveBeenCalledWith(expect.objectContaining({ consumerRef: "project-competitor:11:B012345678" }));
    expect(calls.update).toHaveBeenCalled();
  });
  it("batch capture deduplicates normalized ASINs and reports saved rows", async () => {
    expect(await analysisRouter.createCaller(ctx).batchAnalyze({ projectId: 11, asins: [input.asin, input.asin.toLowerCase()], captureOnly: true, expectedWorkspaceId: 3 })).toMatchObject({ total: 1, successCount: 1, partialCount: 0, failedCount: 0 });
    expect(calls.acquisition).toHaveBeenCalledTimes(1); expect(calls.update).not.toHaveBeenCalled();
  });
});
