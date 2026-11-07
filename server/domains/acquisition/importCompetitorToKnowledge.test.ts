import { beforeEach, describe, expect, it, vi } from "vitest";
import { workspaces } from "../../../drizzle/schema/auth";
import { acquisitionAssetCandidates, acquisitionConfirmedSnapshots, acquisitionJobs } from "../../../drizzle/schema/acquisition";
import { kbImageSets } from "../../../drizzle/schema/image";

const f = vi.hoisted(() => ({ rows: new Map(), activate: vi.fn(), post: vi.fn() }));
vi.mock("../../repositories/dbClient", () => ({ withDbTransaction: async (_: string, fn: (tx: unknown) => unknown) => fn({
  select: () => ({ from: (table: unknown) => ({ where: () => {
    const rows = f.rows.get(table) || [];
    return { for: async () => rows, limit: async () => rows, then: (resolve: (value: unknown) => unknown) => Promise.resolve(rows).then(resolve) };
  } }) }),
}) }));
vi.mock("./consumerActivation", () => ({ activateConfirmedSnapshotForConsumer: f.activate }));
vi.mock("./postConfirmation", () => ({ triggerConsumerPostConfirmation: f.post }));
import { importCompetitorToKnowledge } from "./importCompetitorToKnowledge";

const input = { workspaceId: 3, userId: 7, asin: "B012345678", snapshotId: 9 };
beforeEach(() => {
  vi.clearAllMocks(); f.rows.clear();
  f.rows.set(workspaces, [{ id: 3 }]); f.rows.set(kbImageSets, []); f.rows.set(acquisitionJobs, []);
  f.rows.set(acquisitionConfirmedSnapshots, [{ id: 9, workspaceId: 3, snapshotId: 8, asin: input.asin, marketplace: "US", isCurrent: 1,
    revisionId: null, confirmedAssetIds: [10], fieldStatuses: { imageGallery: { status: "confirmed" } } }]);
  f.rows.set(acquisitionAssetCandidates, [{ id: 10, role: "main", storageKey: "s3://main" }]);
  f.activate.mockResolvedValue({ consumerType: "kb_images", imageSetId: 15, workspaceId: 3, userId: 7 });
  f.post.mockResolvedValue({ analysisJobStatus: "queued" });
});
describe("explicit competitor import", () => {
  it("projects the confirmed snapshot and only then starts knowledge tagging", async () => {
    await expect(importCompetitorToKnowledge(input)).resolves.toEqual({ imageSetId: 15, taggingStatus: "queued" });
    expect(f.activate).toHaveBeenCalledWith(expect.objectContaining({ confirmedSnapshotId: 9,
      imagesOnly:true,job: expect.objectContaining({ consumerType: "kb_images", requestedCapabilities: expect.arrayContaining(["image_gallery", "aplus"]) }) }));
    expect(f.activate.mock.calls[0][0].job.requestedCapabilities).not.toContain('product_video');
    expect(f.post).toHaveBeenCalledOnce();
  });
  it("does not overwrite a duplicate or a pending knowledge collection", async () => {
    f.rows.set(kbImageSets, [{ id: 4 }]);
    await expect(importCompetitorToKnowledge(input)).rejects.toThrow("已存在");
    f.rows.set(kbImageSets, []); f.rows.set(acquisitionJobs, [{ id: 5 }]);
    await expect(importCompetitorToKnowledge(input)).rejects.toThrow("正在采集");
    expect(f.activate).not.toHaveBeenCalled();
  });
  it("imports a new version without overwriting a recycled copy", async () => {
    f.rows.set(kbImageSets, [{ id: 4, asin: input.asin, version: 1, recycleId: 'trashed' }]);
    await importCompetitorToKnowledge(input);
    expect(f.activate).toHaveBeenCalledWith(expect.objectContaining({job: expect.objectContaining({consumerRef: `kb-images:US:${input.asin}:version:2`})}));
  });
  it("rejects snapshots without a safely stored main image", async () => {
    f.rows.set(acquisitionAssetCandidates, []);
    await expect(importCompetitorToKnowledge(input)).rejects.toThrow("主图尚未完整保存");
    expect(f.activate).not.toHaveBeenCalled();
  });
});
