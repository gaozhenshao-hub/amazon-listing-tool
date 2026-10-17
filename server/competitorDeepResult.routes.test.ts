import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const calls = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./domains/listing/services/competitorDeepResultRead", async original => ({
  ...await original<typeof import("./domains/listing/services/competitorDeepResultRead")>(), competitorDeepResultRead: calls,
}));
import { analysisRouter } from "./routers/analysis";

const ctx = { user: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, workspaceId: 7, req: {}, res: {} } as TrpcContext;
const request = { projectId: 11, analysisId: 21, expectedWorkspaceId: 7, expectedRevision: "a".repeat(64) };
beforeEach(() => { calls.read.mockReset().mockResolvedValue({ status: "not_available", reviewRequired: true }); });

describe("read-only selected competitor deep result route", () => {
  it("forwards authenticated context and exact selection without starting a generation", async () => {
    const result = await analysisRouter.createCaller(ctx).getCompetitorDeepResult(request);
    expect(calls.read).toHaveBeenCalledOnce();
    expect(calls.read).toHaveBeenCalledWith(ctx, request);
    expect(result).toEqual({ status: "not_available", reviewRequired: true });
    expect(analysisRouter._def.procedures.getCompetitorDeepResult._def.type).toBe("query");
  });
  it("preserves the explicit NULL workspace", async () => {
    const input = { ...request, expectedWorkspaceId: null };
    await analysisRouter.createCaller(ctx).getCompetitorDeepResult(input);
    expect(calls.read).toHaveBeenCalledWith(ctx, input);
  });
  it.each([
    { expectedRevision: undefined }, { expectedRevision: "old" }, { analysisId: 0 }, { projectId: 0 },
    { expectedWorkspaceId: undefined }, { userId: 99 }, { runId: "foreign-job" }, { artifactId: "foreign-artifact" },
    { skills: { authority: "user-primary" } }, { fileBase64: "upload" }, { sourceUrl: "https://untrusted.invalid" },
  ])("rejects broadened or unpinned input %#", async patch => {
    await expect(analysisRouter.createCaller(ctx).getCompetitorDeepResult({ ...request, ...patch } as typeof request))
      .rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls.read).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated access", async () => {
    await expect(analysisRouter.createCaller({ ...ctx, user: null }).getCompetitorDeepResult(request))
      .rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls.read).not.toHaveBeenCalled();
  });
});
