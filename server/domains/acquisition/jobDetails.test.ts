import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: vi.fn(), job: vi.fn(), source: vi.fn(), assets: vi.fn(), url: vi.fn() }));
vi.mock("../../repositories/dbClient", () => ({ requireDb: mocks.db }));
vi.mock("../../storage", () => ({ resolveStoredObjectUrl: mocks.url }));
vi.mock("./repository", () => ({ getAcquisitionJob: mocks.job, getSourceSnapshotByJob: mocks.source, getSourceSnapshot: vi.fn(), listAssetCandidates: mocks.assets }));
import { readKnowledgeAcquisitionDetails } from "./jobDetails";
beforeEach(() => {
  vi.clearAllMocks(); mocks.db.mockResolvedValue({ execute: async()=>[[]], select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) });
  mocks.job.mockResolvedValue({ id: 9, requestedBy: 7, consumerType: "kb_images", status: "running", asin: "B0G3WN7CL2" });
  mocks.source.mockResolvedValue({ id: 2, normalizedData: { title: "Lamp", assets: [{}, {}, {}] }, completeness: { assetIngestion: { total: 3, results: [{ assetId: 1, attempts: 2 }, { assetId: 2, attempts: 2 }] } } });
  mocks.assets.mockResolvedValue([{ id: 1, role: "main", positionIndex: 0, storageKey: "secret-key", thumbnailStorageKey: "secret-thumb" }, { id: 2, role: "aplus", positionIndex: 0, storageKey: null }]);
  mocks.url.mockResolvedValue("/signed-preview");
});
describe("collection details", () => {
  it.each([false, true])("retains main/A+ gaps after image confirmation, including expired cache=%s", async expired => {
    mocks.job.mockResolvedValue({ id:9,requestedBy:7,consumerType:"kb_images",status:"confirmed",cacheExpiredAt:expired?new Date():null });
    mocks.assets.mockResolvedValue([
      {id:1,role:"video",moduleType:"主图视频",storageKey:null,thumbnailStorageKey:"cover"},
      {id:2,role:"video",moduleType:"A+ 视频",storageKey:"video",thumbnailStorageKey:null},
      {id:3,role:"video",moduleType:"A+视频",storageKey:"video",thumbnailStorageKey:"cover"},
      {id:4,role:"main",storageKey:null},
    ]);
    const result=await readKnowledgeAcquisitionDetails(1,7,9);
    expect(result).toMatchObject({status:"confirmed",missingMainVideos:1,missingAplusVideos:1,canConfirm:false});
    if(expired)expect(result.assets).toEqual([]);
  });
  it("retains historical counts after expiry without signing stale previews or offering supplementation", async () => {
    mocks.job.mockResolvedValue({ id: 9, requestedBy: 7, consumerType: "kb_images", status: "confirmed", cacheExpiredAt: new Date() });
    expect(await readKnowledgeAcquisitionDetails(1, 7, 9)).toMatchObject({ total: 3, stored: 1, failed: 1, assets: [], canSupplement: false });
    expect(mocks.url).not.toHaveBeenCalled();
  });
  it("reports in-flight downloads and recovery without leaking internal storage", async () => {
    const result = await readKnowledgeAcquisitionDetails(1, 7, 9);
    expect(result).toMatchObject({ total: 3, completed: 2, stored: 1, failed: 1, retried: 2, recovered: 1, canSupplement: false });
    expect(JSON.stringify(result)).not.toContain("secret-");
    expect(mocks.url).toHaveBeenCalledWith("secret-thumb");
  });
  it.each([{ requestedBy: 8 }, { consumerType: "project_competitor" }, { deletedAt: new Date() }])("rejects inaccessible or out-of-scope jobs before reading images %j", async override => {
    mocks.job.mockResolvedValue({ id: 9, requestedBy: 7, consumerType: "kb_images", ...override });
    await expect(readKnowledgeAcquisitionDetails(1, 7, 9)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(mocks.assets).not.toHaveBeenCalled(); expect(mocks.source).not.toHaveBeenCalled();
  });
  it("preserves the manual upload entry for a terminal partial result", async () => {
    mocks.job.mockResolvedValue({ id: 9, requestedBy: 7, consumerType: "kb_images", status: "confirmed" });
    expect(await readKnowledgeAcquisitionDetails(1, 7, 9)).toMatchObject({ canSupplement: true, imageSetId: null });
  });
});
