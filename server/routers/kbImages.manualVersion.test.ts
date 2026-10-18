import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), images: vi.fn(), sets: vi.fn(), allImages: vi.fn(), resolve: vi.fn(), coverage: vi.fn(), database: vi.fn(), model: vi.fn(), http: vi.fn() }));
vi.mock("../_core/trpc", async () => { const { initTRPC } = await import("@trpc/server"); return { router: initTRPC.create().router }; });
vi.mock("../domains/ai_os/workspaceScopedProcedure", async () => { const { initTRPC } = await import("@trpc/server"); return { workspaceScopedProcedure: () => initTRPC.create().procedure }; });
vi.mock("../kbDb", () => ({ getReadableImageSet: mocks.get, listImagesBySetLight: mocks.images, listImageSetsWithThumbnails: mocks.sets, listAllImages: mocks.allImages }));
vi.mock("../domains/image/routerContext", async () => {
  const { initTRPC } = await import("@trpc/server"), { z } = await import("zod"); const t = initTRPC.create();
  const unused = Object.fromEntries(["APLUS_MODULE_STYLE_GUIDE", "IMAGE_ADVICE_TRANSLATION_PROMPT", "STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT", "STEP0_COMPETITOR_SUMMARY_PROMPT",
    "STEP1_SELLING_POINTS_PROMPT", "STEP2_IMAGE_OUTLINE_PROMPT", "STEP3_STYLE_PROMPT", "STEP4_REFERENCE_PROMPT", "STEP4_REOPTIMIZE_WITH_REFS_PROMPT", "STEP5_APLUS_COMBO_RECOMMEND_PROMPT",
    "STEP5_APLUS_MODULE_OPTIMIZE_PROMPT", "STEP5_FINAL_SUGGESTION_PROMPT", "STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT", "buildImageWorkflowContext", "buildStep5FinalSuggestion",
    "buildStep5RunSnapshot", "callLLMWithRetry", "db", "devDb", "ensureWriteAccess", "generateStep5RunId", "getKBReference", "invokeBusinessSkill", "isActiveStep5Run", "parseLLMJson",
    "parseStoredJson", "persistStep5ListingAdvice", "registerAiJobHandler", "resolveProjectAccess", "resolveSessionAccess", "resolveSessionForExecution", "runStep5GenerationJob",
    "serializeStep5Error", "startRegisteredAiJob", "step5JobInput", "storagePut"].map(name => [name, undefined]));
  return { ...unused, router: t.router, protectedProcedure: t.procedure, z, kbDb: { listAllImages: mocks.allImages } };
});
vi.mock("../storage", () => ({ resolveStoredObjectUrl: mocks.resolve, storagePut: vi.fn(() => { throw new Error("NO_STORAGE_WRITE"); }) }));
vi.mock("../repositories/dbClient", () => ({ requireDb: mocks.database }));
vi.mock("../domains/ai_os/services/businessSkillGateway", () => ({ invokeBusinessSkill: mocks.model }));
vi.mock("../infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: mocks.http }));
vi.mock("../domains/acquisition/acquisitionJobs", () => ({ startAmazonAcquisitionJob: vi.fn(() => { throw new Error("NO_JOB_START"); }) }));
vi.mock("../domains/acquisition/kbManualImageCoverage", () => ({ readManualKbImageCoverage: mocks.coverage }));
vi.mock("../domains/image/services/imageApprovedExport", () => ({ requireImageDeliverableAccess: vi.fn(() => { throw new Error("NO_EXPORT_WRITE"); }) }));
vi.mock("../domains/image/services/imageWorkflowVersionPolicy", () => ({ asImageWorkflowVersionTrpcError: vi.fn(), getApprovedImageWorkflowExport: vi.fn(() => { throw new Error("NO_EXPORT_READ"); }) }));
import { kbImagesRouter } from "./kbImages";
import { imageKnowledgeExportProcedures } from "../domains/image/routers/knowledgeExport";
import { router } from "../_core/trpc";
const set = { id: 101, userId: 3, workspaceId: 7, visibility: "private", originInstanceId: "manual_acquisition_review_v1", remoteId: 41, syncVersion: 3, asin: "B012345678" };
const image = { id: 201, imageSetId: 101, imageUrl: "storage://s3/manual/synthetic.png", imagePosition: "main", positionIndex: 0, aplusModuleType: null, aplusModuleClass: null };
const coverage = { mode: "manual_revision", status: "verified", revisionVersion: 3, confirmedSnapshotId: 41, kept: 1, excluded: 2, total: 3 };
const caller = () => kbImagesRouter.createCaller({ user: { id: 3 }, workspaceId: 7 } as never);
const exportCaller = () => router(imageKnowledgeExportProcedures).createCaller({ user: { id: 3 }, workspaceId: 7 } as never);
beforeEach(() => { vi.clearAllMocks(); mocks.get.mockResolvedValue({ ...set }); mocks.images.mockResolvedValue([{ ...image }]); mocks.resolve.mockImplementation(async value => `https://example.invalid/${encodeURIComponent(value)}`);
  mocks.sets.mockResolvedValue([{ ...set, thumbnailImages: [{ ...image }] }]); mocks.allImages.mockResolvedValue([{ ...image }]);
  mocks.database.mockResolvedValue({}); mocks.coverage.mockResolvedValue(coverage); });
describe("KB getSet optional manual version branch", () => {
  it("uses original owner/workspace getter, then verifies raw image identities before signing", async () => {
    const result = await caller().getSet({ id: 101 });
    expect(mocks.get).toHaveBeenCalledWith(101, 3, 7); expect(mocks.coverage).toHaveBeenCalledWith({}, { userId: 3, workspaceId: 7 }, set, [image]);
    expect(mocks.coverage.mock.invocationCallOrder[0]).toBeLessThan(mocks.resolve.mock.invocationCallOrder[0]);
    expect(result).toMatchObject({ acquisitionCoverage: null, sourceCoverage: coverage }); expect(mocks.model).not.toHaveBeenCalled(); expect(mocks.http).not.toHaveBeenCalled();
  });
  it.each([{ userId: 4 }, { workspaceId: 8 }, { visibility: "team" }])("manual exact-owner scope cannot broaden through shared readability", async change => {
    mocks.get.mockResolvedValue({ ...set, ...change }); await expect(caller().getSet({ id: 101 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.images).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled(); expect(mocks.coverage).not.toHaveBeenCalled();
  });
  it("unverified manual coverage remains unavailable, never the old candidate-minus-stored formula", async () => {
    mocks.coverage.mockResolvedValue({ mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" });
    const result = await caller().getSet({ id: 101 }); expect(result?.acquisitionCoverage).toBeNull(); expect(result?.sourceCoverage).toEqual({ mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" });
    expect(result?.images).toEqual([]); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("does not sign or return a manual image pointer whose durable source cannot bind its workspace", async () => {
    mocks.images.mockResolvedValue([{ ...image, imageUrl: "storage://s3/acquisition/8/snapshots/99/private.png" }]);
    mocks.coverage.mockResolvedValue({ mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" });
    const result = await caller().getSet({ id: 101 });
    expect(result?.images).toEqual([]); expect(mocks.resolve).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).not.toContain("snapshots/99");
  });
  it("preserves the existing direct-ingestion counts and never calls manual replay for legacy sets", async () => {
    mocks.get.mockResolvedValue({ ...set, originInstanceId: "unified_amazon_acquisition" });
    const select = vi.fn().mockReturnValueOnce({ from: () => ({ where: () => ({ limit: async () => [{ snapshotId: 21 }] }) }) })
      .mockReturnValueOnce({ from: () => ({ where: async () => [{ storageKey: "a", fieldStatus: "pending_review" }, { storageKey: null, fieldStatus: "download_failed" }] }) });
    mocks.database.mockResolvedValue({ select });
    const result = await caller().getSet({ id: 101 }); expect(result?.acquisitionCoverage).toEqual({ stored: 1, missing: 1, total: 2, partial: true });
    expect(result?.sourceCoverage).toBeNull(); expect(mocks.coverage).not.toHaveBeenCalled();
  });
  it("a missing unauthorized set never reads or signs any image", async () => {
    mocks.get.mockResolvedValue(null); expect(await caller().getSet({ id: 101 })).toBeNull(); expect(mocks.images).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("verifies a manual thumbnail against the full set, not only five list rows", async () => {
    const result = await caller().listSets(); expect(result[0].sourceCoverage).toEqual(coverage);
    expect(mocks.images).toHaveBeenCalledWith(101); expect(mocks.coverage).toHaveBeenCalledTimes(1); expect(mocks.resolve).toHaveBeenCalledTimes(1);
  });
  it("does not sign unverified thumbnails or silently export unverified waterfall rows", async () => {
    mocks.coverage.mockResolvedValue({ mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" });
    expect((await caller().listSets())[0].thumbnailImages).toEqual([]);
    await expect(caller().listAllImages()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it.each(["listKbImages", "getKbImageFilterOptions"] as const)("%s cannot bypass manual proof through the image-workflow browser", async endpoint => {
    mocks.coverage.mockResolvedValue({ mode: "manual_revision", status: "unavailable", reasonCode: "MANUAL_VERSION_UNVERIFIED" });
    await expect(exportCaller()[endpoint]()).rejects.toMatchObject({ code: "PRECONDITION_FAILED" }); expect(mocks.resolve).not.toHaveBeenCalled();
    expect(mocks.model).not.toHaveBeenCalled(); expect(mocks.http).not.toHaveBeenCalled();
  });
  it("keeps verified workflow selection complete without signing or modifying the original URI", async () => {
    expect(await exportCaller().listKbImages()).toEqual([image]); expect(mocks.coverage).toHaveBeenCalledTimes(1); expect(mocks.resolve).not.toHaveBeenCalled();
  });
});
