import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const calls = vi.hoisted(() => ({ getProject: vi.fn(), update: vi.fn(), acquisition: vi.fn() }));
vi.mock("./repositories", async original => ({ ...await original<typeof import("./repositories")>(), getProjectById: calls.getProject, updateProject: calls.update }));
vi.mock("./domains/acquisition/acquisitionJobs", () => ({ startAmazonAcquisitionJob: calls.acquisition }));
vi.mock("./services/securityGovernance", async original => ({ ...await original<typeof import("./services/securityGovernance")>(), assertResourceAction: vi.fn().mockResolvedValue(undefined) }));
import { analysisRouter } from "./routers/analysis";
const ctx = { user: { id: 7, role: "ops_specialist", defaultWorkspaceId: 3 }, workspaceId: 3, req: {}, res: {}, requestId: "capture-route" } as TrpcContext;
const input = { projectId: 11, asin: "B012345678", expectedWorkspaceId: 3 };
beforeEach(() => {
  vi.clearAllMocks(); calls.getProject.mockResolvedValue({ id: 11, workspaceId: 3, userId: 7 });
  calls.acquisition.mockResolvedValue({ jobId: 9, status: "confirmed", cacheHitSnapshotId: 10 });
});
describe("restored capture-only Listing routes", () => {
  it("saves capture mode without automatically starting product analysis", async () => {
    expect(await analysisRouter.createCaller(ctx).collectAsin(input)).toMatchObject({ status: "captured", analysisJobRunId: null, reviewRequired: false });
    expect(calls.acquisition).toHaveBeenCalledWith(expect.objectContaining({ consumerType: "project_competitor", consumerRef: "project-competitor:11:B012345678:capture-v1", requestedBy: 7, workspaceId: 3 }));
    expect(calls.getProject).toHaveBeenCalledWith(11, 7, 3); expect(calls.update).not.toHaveBeenCalled();
  });
  it("rejects a changed workspace before acquisition", async () => {
    await expect(analysisRouter.createCaller(ctx).collectAsin({ ...input, expectedWorkspaceId: 4 })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(calls.acquisition).not.toHaveBeenCalled();
  });
  it("does not fall back from authenticated NULL to a default workspace", async () => {
    await expect(analysisRouter.createCaller({ ...ctx, workspaceId: null }).collectAsin(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(calls.acquisition).not.toHaveBeenCalled();
  });
  it.each([{ userId: 8, workspaceId: 3 }, { userId: 7, workspaceId: 4 }])("rejects a foreign project %#", async changed => {
    calls.getProject.mockResolvedValue({ id: 11, ...changed });
    await expect(analysisRouter.createCaller(ctx).collectAsin(input)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(calls.acquisition).not.toHaveBeenCalled();
  });
  it("does not report queued acquisition as captured", async () => {
    calls.acquisition.mockResolvedValue({ jobId: 9, status: "queued", cacheHitSnapshotId: null });
    expect(await analysisRouter.createCaller(ctx).collectAsin(input)).toMatchObject({ status: "review_required", reviewRequired: true, cacheHitSnapshotId: null });
  });
  it.each(["failed", "canceled"])("does not report %s as successful or pending", async status => {
    calls.acquisition.mockResolvedValue({ jobId: 9, status });
    await expect(analysisRouter.createCaller(ctx).collectAsin(input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("normalizes ASIN and sends explicit refresh policy", async () => {
    await analysisRouter.createCaller(ctx).collectAsin({ ...input, asin: input.asin.toLowerCase(), refresh: true });
    expect(calls.acquisition).toHaveBeenCalledWith(expect.objectContaining({ asin: input.asin, cachePolicy: "refresh" }));
  });
});
