import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const calls = vi.hoisted(() => ({ start: vi.fn(), get: vi.fn(), list: vi.fn(), resume: vi.fn(), cancel: vi.fn() }));
vi.mock("./domains/listing/services/competitorResearchJob", async importOriginal => {
  const original = await importOriginal<typeof import("./domains/listing/services/competitorResearchJob")>();
  return { ...original, competitorResearchJob: calls };
});
import { analysisRouter } from "./routers/analysis";

const scope = { projectId: 11, expectedWorkspaceId: 7 };
const start = { ...scope, analysisId: 19, expectedRevision: "a".repeat(64) };
const operation = { ...scope, runId: `competitor_${"b".repeat(64)}` };
const ctx = { user: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, workspaceId: 7,
  req: {}, res: {}, requestId: "synthetic-research-route" } as TrpcContext;
beforeEach(() => { vi.clearAllMocks(); for (const call of Object.values(calls)) call.mockResolvedValue({ safe: true }); });

describe("saved competitor analysis uses dedicated scoped routes", () => {
  it("passes the exact authenticated context and frozen selected identity", async () => {
    await expect(analysisRouter.createCaller(ctx).startResearchJob(start)).resolves.toEqual({ safe: true });
    expect(calls.start).toHaveBeenCalledTimes(1); expect(calls.start).toHaveBeenCalledWith(ctx, start);
  });

  it("read/resume/cancel retain original run identity, not a generic retry anchor", async () => {
    const api = analysisRouter.createCaller(ctx);
    await api.getResearchJob(operation); await api.listResearchJobs(scope);
    await api.resumeResearchJob(operation); await api.cancelResearchJob(operation);
    expect(calls.get).toHaveBeenCalledTimes(1); expect(calls.get).toHaveBeenCalledWith(ctx, operation);
    expect(calls.list).toHaveBeenCalledTimes(1); expect(calls.list).toHaveBeenCalledWith(ctx, scope);
    expect(calls.resume).toHaveBeenCalledTimes(1); expect(calls.resume).toHaveBeenCalledWith(ctx, operation);
    expect(calls.cancel).toHaveBeenCalledTimes(1); expect(calls.cancel).toHaveBeenCalledWith(ctx, operation);
    expect(calls.start).not.toHaveBeenCalled();
  });

  it("retains explicit NULL legacy workspace", async () => {
    await analysisRouter.createCaller(ctx).startResearchJob({ ...start, expectedWorkspaceId: null });
    expect(calls.start).toHaveBeenCalledWith(ctx, { ...start, expectedWorkspaceId: null });
  });

  it.each([
    { ...start, expectedWorkspaceId: undefined }, { ...start, expectedRevision: undefined },
    { ...start, expectedRevision: "wrong" }, { ...start, analysisId: 0 },
    { ...start, projectId: 1.5 }, { ...start, analysisIds: [19, 20] },
    { ...start, fileBase64: "must-not-be-uploaded" }, { ...start, modelOverride: "untrusted" },
  ])("rejects invalid or expanded creation contract %# before service execution", async invalid => {
    await expect(analysisRouter.createCaller(ctx).startResearchJob(invalid as typeof start)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls.start).not.toHaveBeenCalled();
  });

  it("rejects arbitrary run IDs and incomplete read scope", async () => {
    const api = analysisRouter.createCaller(ctx);
    await expect(api.resumeResearchJob({ ...operation, runId: "random-new-anchor" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(api.listResearchJobs({ projectId: 11 } as typeof scope)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls.resume).not.toHaveBeenCalled(); expect(calls.list).not.toHaveBeenCalled();
  });

  it("unauthenticated callers cannot read or mutate this lane", async () => {
    const api = analysisRouter.createCaller({ ...ctx, user: null });
    for (const action of [() => api.startResearchJob(start), () => api.getResearchJob(operation),
      () => api.listResearchJobs(scope), () => api.resumeResearchJob(operation), () => api.cancelResearchJob(operation)]) {
      await expect(action()).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    for (const call of Object.values(calls)) expect(call).not.toHaveBeenCalled();
  });
});
