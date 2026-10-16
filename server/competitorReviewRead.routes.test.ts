import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const calls = vi.hoisted(() => ({ list: vi.fn() }));
vi.mock("./domains/listing/services/competitorReviewRead", async original => ({
  ...await original<typeof import("./domains/listing/services/competitorReviewRead")>(), competitorReviewRead: calls,
}));
import { analysisRouter } from "./routers/analysis";
const ctx = { user: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, workspaceId: 7, req: {}, res: {} } as TrpcContext;
const request = { projectId: 11, analysisId: 21, expectedWorkspaceId: 7 };
beforeEach(() => { calls.list.mockReset().mockResolvedValue({ status: "unavailable", total: null }); });
describe("original review read route", () => {
  it("dispatches exact authenticated identity to the dedicated read service with bounded defaults", async () => {
    await analysisRouter.createCaller(ctx).listCompetitorReviews(request);
    expect(calls.list).toHaveBeenCalledOnce(); expect(calls.list).toHaveBeenCalledWith(ctx, { ...request, page: 1, pageSize: 30 });
  });
  it("keeps explicit NULL and pinned corpus across pages", async () => {
    const input = { ...request, expectedWorkspaceId: null, page: 2, pageSize: 30, expectedCorpusHash: "b".repeat(64) };
    await analysisRouter.createCaller(ctx).listCompetitorReviews(input);
    expect(calls.list).toHaveBeenCalledWith(ctx, input);
  });
  it.each([{ ...request, expectedWorkspaceId: undefined }, { ...request, page: 2 }, { ...request, pageSize: 51 },
    { ...request, analysisId: 0 }, { ...request, expectedCorpusHash: "bad" }, { ...request, sourceUrl: "https://untrusted.invalid" },
    { ...request, userId: 999 }, { ...request, fileBase64: "not an upload endpoint" }])("rejects broadened/invalid request %#", async input => {
    await expect(analysisRouter.createCaller(ctx).listCompetitorReviews(input as typeof request)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls.list).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated callers before service entry", async () => {
    await expect(analysisRouter.createCaller({ ...ctx, user: null }).listCompetitorReviews(request)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls.list).not.toHaveBeenCalled();
  });
});
