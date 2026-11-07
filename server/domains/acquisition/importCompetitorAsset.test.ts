import { beforeEach, expect, it, vi } from "vitest";
import { workspaces } from "../../../drizzle/schema/auth";
import {
  acquisitionConfirmedSnapshots,
  acquisitionAssetCandidates,
} from "../../../drizzle/schema/acquisition";
import { kbImages } from "../../../drizzle/schema/image";
import { kbVideos } from "../../../drizzle/schema/knowledge";
const f = vi.hoisted(() => ({
  rows: new Map(),
  inserts: [] as Array<{ table: unknown; value: any }>,
  tags: vi.fn(),
  videos: vi.fn(),
  translate: vi.fn(),
  allowed: vi.fn(() => true),
}));
vi.mock("../../repositories/dbClient", () => ({
  withDbTransaction: async (_label: string, fn: any) =>
    fn({
      select: () => ({
        from: (table: unknown) => ({
          where: () => {
            const rows = f.rows.get(table) || [];
            return {
              for: async () => rows,
              limit: async () => rows,
              then: (resolve: any) => Promise.resolve(rows).then(resolve),
            };
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (value: unknown) => {
          f.inserts.push({ table, value });
          return { $returningId: async () => [{ id: 42 }] };
        },
      }),
    }),
}));
vi.mock("../knowledge/standaloneImages", () => ({
  enqueueStandaloneTags: f.tags,
}));
vi.mock("../knowledge/videoTagging", () => ({ enqueueVideoTags: f.videos }));
vi.mock("../knowledge/pretranslationJob", () => ({
  enqueuePretranslation: f.translate,
}));
vi.mock("../knowledge/videoLibrary", () => ({ videoObjectAllowed: f.allowed }));
import { importCompetitorAsset } from "./importCompetitorAsset";
const hash = "a".repeat(64),
  bytes = "b".repeat(64),
  input = {
    workspaceId: 3,
    userId: 7,
    asin: "B012345678",
    snapshotId: 9,
    kind: "image" as const,
    hash,
  };
beforeEach(() => {
  vi.clearAllMocks();
  f.rows.clear();
  f.inserts = [];
  f.allowed.mockReturnValue(true);
  f.rows.set(workspaces, [{ id: 3 }]);
  f.rows.set(acquisitionConfirmedSnapshots, [
    {
      id: 9,
      workspaceId: 3,
      snapshotId: 8,
      asin: input.asin,
      marketplace: "US",
      isCurrent: 1,
      revisionId: null,
      confirmedAssetIds: [10],
      confirmedData: {},
    },
  ]);
  f.rows.set(acquisitionAssetCandidates, [
    {
      id: 10,
      workspaceId: 3,
      snapshotId: 8,
      role: "aplus",
      reviewStatus: "approved",
      sourceUrlHash: hash,
      contentHash: bytes,
      storageKey: "local://image.jpg",
      thumbnailStorageKey: "local://thumb.jpg",
    },
  ]);
});
it("imports one image independently and copies only the matching prepared translation", async () => {
  const translation = {
    version: 1,
    sourceHash: hash,
    contentHash: bytes,
    status: "complete",
    regions: [
      {
        source: "Cotton",
        translation: "棉",
        x: 0.1,
        y: 0.1,
        width: 0.3,
        height: 0.2,
      },
    ],
    notes: "",
  };
  const r = await importCompetitorAsset({
    ...input,
    presentation: {
      version: 1,
      generatedAt: "now",
      texts: [],
      images: [translation],
    },
  });
  expect(r).toMatchObject({
    kind: "image",
    imageSetId: null,
    imageId: 42,
    videoId: null,
  });
  expect(f.inserts[0].table).toBe(kbImages);
  expect(f.inserts[0].value).toMatchObject({
    imageSetId: null,
    userId: 7,
    workspaceId: 3,
    uploadHash: bytes,
    imageTranslation: { sourceHash: hash, contentHash: bytes },
  });
  expect(f.inserts[0].value).not.toHaveProperty("asin");
  expect(f.tags).toHaveBeenCalledOnce();
  expect(f.videos).not.toHaveBeenCalled();
});
it("imports a video without an ASIN, module or image-set association", async () => {
  f.rows.get(acquisitionAssetCandidates)[0].role = "video";
  await importCompetitorAsset({ ...input, kind: "video" });
  expect(f.inserts[0].table).toBe(kbVideos);
  expect(f.inserts[0].value).toMatchObject({
    asin: null,
    moduleId: null,
    imageSetId: null,
    sourceKey: `independent:7:${bytes}`,
  });
  expect(f.videos).toHaveBeenCalledOnce();
  expect(f.translate).not.toHaveBeenCalled();
  expect(f.tags).not.toHaveBeenCalled();
});
it("does not import stale, unapproved or incomplete assets", async () => {
  f.rows.get(acquisitionConfirmedSnapshots)[0].isCurrent = 0;
  await expect(importCompetitorAsset(input)).rejects.toThrow("已更新");
  f.rows.get(acquisitionConfirmedSnapshots)[0].isCurrent = 1;
  f.rows.get(acquisitionAssetCandidates)[0].reviewStatus = "pending";
  await expect(importCompetitorAsset(input)).rejects.toThrow("尚未完整保存");
  f.rows.get(acquisitionAssetCandidates)[0].reviewStatus = "approved";
  f.rows.get(acquisitionConfirmedSnapshots)[0].confirmedAssetIds = [];
  await expect(importCompetitorAsset(input)).rejects.toThrow("尚未完整保存");
  expect(f.inserts).toHaveLength(0);
});
it("rejects video objects outside the workspace delivery gate", async () => {
  f.rows.get(acquisitionAssetCandidates)[0].role = "video";
  f.allowed.mockReturnValue(false);
  await expect(
    importCompetitorAsset({ ...input, kind: "video" })
  ).rejects.toThrow("原件尚未完整保存");
  expect(f.inserts).toHaveLength(0);
});
it("never analyzes an explicitly imported brand background", async () => {
  f.rows.get(acquisitionConfirmedSnapshots)[0].confirmedData = {
    sourceLayout: {
      version: 2,
      modules: [
        {
          id: "brand",
          section: "brand_story",
          kind: "brand_story",
          background: { hash },
          cards: [],
        },
      ],
    },
  };
  await importCompetitorAsset(input);
  expect(f.inserts[0].value).toMatchObject({
    imageTranslation: { status: "excluded_background" },
    labelStatus: "complete",
  });
  expect(f.tags).not.toHaveBeenCalled();
  expect(f.translate).not.toHaveBeenCalled();
});
it("does not overwrite a duplicate or resurrect an item from the recycle bin", async () => {
  f.rows.set(kbImages, [{ id: 11, labelStatus: "complete", tagsConfirmed: 1 }]);
  expect(await importCompetitorAsset(input)).toMatchObject({
    duplicate: true,
    imageId: 11,
  });
  expect(f.inserts).toHaveLength(0);
  expect(f.tags).not.toHaveBeenCalled();
  f.rows.get(kbImages)[0].recycleId = "trashed";
  await expect(importCompetitorAsset(input)).rejects.toThrow("回收站");
});
