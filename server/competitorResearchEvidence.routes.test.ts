import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";
const calls = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock("./domains/listing/services/competitorResearchEvidence", async original => ({
  ...await original<typeof import("./domains/listing/services/competitorResearchEvidence")>(), competitorResearchEvidence: calls,
}));
import { analysisRouter } from "./routers/analysis";
const ctx = { user: { id: 3, role: "ops_specialist", defaultWorkspaceId: 7 }, workspaceId: 7, req: {}, res: {} } as TrpcContext;
const request = { projectId: 11, analysisId: 21, expectedWorkspaceId: 7, expectedRevision: "a".repeat(64) };
beforeEach(() => { calls.preview.mockReset().mockResolvedValue({ modelRead: false }); });
describe("read-only selected research evidence preview route", () => {
  it("forwards authenticated context and exact selected revision, without starting a job", async () => {
    await analysisRouter.createCaller(ctx).previewResearchEvidence(request);
    expect(calls.preview).toHaveBeenCalledOnce(); expect(calls.preview).toHaveBeenCalledWith(ctx, request);
  });
  it("preserves explicit NULL workspace and optional original corpus pin", async () => {
    const input = { ...request, expectedWorkspaceId: null, expectedCorpusHash: "b".repeat(64) };
    await analysisRouter.createCaller(ctx).previewResearchEvidence(input);
    expect(calls.preview).toHaveBeenCalledWith(ctx, input);
  });
  it.each([{ expectedRevision: undefined }, { expectedRevision: "old" }, { analysisId: 0 }, { expectedWorkspaceId: undefined },
    { userId: 99 }, { fileBase64: "upload" }, { sourceUrl: "https://untrusted.invalid" }, { page: 1 }])("rejects broadened or unpinned input %#", async patch => {
    await expect(analysisRouter.createCaller(ctx).previewResearchEvidence({ ...request, ...patch } as typeof request)).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(calls.preview).not.toHaveBeenCalled();
  });
  it("refuses unauthenticated access", async () => {
    await expect(analysisRouter.createCaller({ ...ctx, user: null }).previewResearchEvidence(request)).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(calls.preview).not.toHaveBeenCalled();
  });
});
