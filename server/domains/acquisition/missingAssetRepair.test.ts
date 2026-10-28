import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
const m = vi.hoisted(() => ({
  job: null as any,
  snapshot: null as any,
  assets: [] as any[],
  active: null as any,
  download: vi.fn(),
  video: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  confirm: vi.fn(),
  post: vi.fn(),
  sources: [] as any[],
  fetch: vi.fn(),
}));
const db = vi.hoisted(() => ({
  execute: vi.fn(),
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}));
vi.mock("../../repositories/dbClient", () => ({
  requireDb: async () => db,
  withDbTransaction: async (_name: any, fn: any) => fn(db),
}));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: vi.fn(),
  updateAiJobProgress: vi.fn(),
}));
vi.mock("../../storage", () => ({
  parseStorageUri: () => ({ provider: "local", key: "safe/raw.json" }),
}));
vi.mock("../../infrastructure/localObjectStorage", () => ({
  verifiedLocalObjectPath: async () => "safe/raw.json",
}));
vi.mock("node:fs/promises", () => ({
  readFile: async () => Buffer.from("[]"),
}));
vi.mock("./repository", () => ({
  getAcquisitionJob: async () => m.job,
  getSourceSnapshotByJob: async () => m.snapshot,
  listAssetCandidates: async () => m.assets,
  updateSourceSnapshot: vi.fn(),
}));
vi.mock("./amazonNormalizer", () => ({
  normalizeAmazonArtifact: () => ({ sourceAssets: m.sources }),
}));
vi.mock("./assetIngestion", () => ({
  downloadImageAsset: m.download,
  summarizeAssetDownloads: (_n: any, results: any) => ({ results }),
}));
vi.mock("./videoIngestion", () => ({ downloadVideoAsset: m.video }));
vi.mock("./basicAmazonProvider", () => ({
  BasicAmazonImagesProvider: class {
    fetch = m.fetch;
  },
}));
vi.mock("./snapshotReview", () => ({
  confirmSnapshotForDirectIngestion: m.confirm,
}));
vi.mock("./postConfirmation", () => ({
  triggerConsumerPostConfirmation: m.post,
}));
import {
  enqueueMissingAssetRepair,
  runMissingAssetRepair,
  matchRepairSource,
  readRepairableCollection,
} from "./missingAssetRepair";
const scope = { workspaceId: 1, userId: 7, jobId: 9 };
beforeEach(() => {
  vi.clearAllMocks();
  m.active = null;
  m.job = {
    id: 9,
    workspaceId: 1,
    requestedBy: 7,
    consumerType: "kb_images",
    status: "review_required",
    asin: "B012345678",
  };
  m.snapshot = {
    id: 10,
    status: "pending_review",
    rawArtifactId: 11,
    completeness: {},
  };
  m.assets = [
    {
      id: 1,
      role: "main",
      sourceUrlHash: "a",
      storageKey: "saved",
      thumbnailStorageKey: "cover",
    },
    {
      id: 2,
      role: "aplus",
      sourceUrlHash: "b",
      storageKey: null,
      thumbnailStorageKey: null,
    },
  ];
  m.sources = m.assets.map(a => ({
    ...a,
    sourceUrl: `https://m.media-amazon.com/${a.sourceUrlHash}.jpg`,
  }));
  db.execute.mockImplementation(async q =>
    new MySqlDialect().sqlToQuery(q).sql.includes("FROM ai_jobs")
      ? [m.active ? [m.active] : []]
      : [[]]
  );
  db.select.mockReturnValue({
    from: () => ({
      where: () => ({ limit: async () => [{ storageKey: "raw" }] }),
    }),
  });
  db.insert.mockReturnValue({ values: m.insert });
  db.update.mockReturnValue({
    set: (v: any) => ({
      where: async () => {
        m.update(v);
        Object.assign(m.assets[1], v);
        return [{ affectedRows: 1 }];
      },
    }),
  });
  m.download.mockResolvedValue({
    storageKey: "new",
    thumbnailStorageKey: "preview",
    contentHash: "hash",
    contentType: "image/jpeg",
    sizeBytes: 12,
    width: 2,
    height: 2,
    stored: true,
    fieldStatus: "pending_review",
    attempts: 1,
    failureReason: null,
  });
});
describe("missing-slot repair", () => {
  it("refreshes expired links using the built-in collector's supported capability contract", async () => {
    m.download.mockResolvedValue({stored:false,fieldStatus:"download_failed",attempts:2,failureReason:"image_network"});
    m.fetch.mockResolvedValue({});
    await runMissingAssetRepair(scope,{snapshotId:10,assetIds:[2]},new AbortController().signal);
    expect(m.fetch).toHaveBeenCalledWith(expect.objectContaining({capabilities:["catalog_basic","image_gallery","aplus","brand_story"]}));
    expect(m.fetch.mock.calls[0][0].idempotencyKey.length).toBeGreaterThanOrEqual(16);
    expect(m.confirm).not.toHaveBeenCalled();
  });
  it("only downloads a requested missing slot, leaves saved assets intact, and never admits a waiting collection", async () => {
    const result = await runMissingAssetRepair(
      scope,
      { snapshotId: 10, assetIds: [1, 2] },
      new AbortController().signal
    );
    expect(m.download).toHaveBeenCalledTimes(1);
    expect(m.download.mock.calls[0][1].sourceUrlHash).toBe("b");
    expect(m.assets[0].storageKey).toBe("saved");
    expect(result).toMatchObject({ repaired: 1, awaitingConfirmation: true });
    expect(m.confirm).not.toHaveBeenCalled();
    expect(m.post).not.toHaveBeenCalled();
  });
  it("does not substitute a reordered image or video by position", () => {
    expect(
      matchRepairSource({ ...m.assets[1], positionIndex: 0 }, [
        { ...m.sources[0], positionIndex: 0 },
      ])
    ).toBeUndefined();
    expect(
      matchRepairSource(
        { ...m.assets[1], role: "video", moduleClass: "aplus-1" },
        [{ ...m.sources[1], role: "video", moduleClass: "main" }]
      )
    ).toBeUndefined();
  });
  it("rejects another user's task and canceled tasks before downloading", async () => {
    m.job.requestedBy = 8;
    await expect(readRepairableCollection(db, scope)).rejects.toThrow(
      "不可访问"
    );
    m.job.requestedBy = 7;
    m.job.status = "canceled";
    await expect(
      runMissingAssetRepair(
        scope,
        { snapshotId: 10, assetIds: [2] },
        new AbortController().signal
      )
    ).rejects.toThrow();
    expect(m.download).not.toHaveBeenCalled();
  });
  it("returns an active repair instead of creating parallel work for the same collection", async () => {
    m.active = { runId: "already-running", status: "running", progress: 50 };
    expect(await enqueueMissingAssetRepair(scope, "request", 2)).toMatchObject({
      runId: "already-running",
      existing: true,
    });
    expect(m.insert).not.toHaveBeenCalled();
  });
  it("does not create tasks for already saved slots", async () => {
    expect(await enqueueMissingAssetRepair(scope, "request", 1)).toMatchObject({
      runId: null,
      count: 0,
    });
    expect(m.insert).not.toHaveBeenCalled();
  });
  it("stops canceled work before downloads and data writes", async () => {
    const c = new AbortController();
    c.abort();
    await expect(
      runMissingAssetRepair(scope, { snapshotId: 10, assetIds: [2] }, c.signal)
    ).rejects.toThrow();
    expect(m.download).not.toHaveBeenCalled();
    expect(m.update).not.toHaveBeenCalled();
  });
});
