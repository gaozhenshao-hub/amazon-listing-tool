import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  http: vi.fn(),
  store: vi.fn(),
  poster: vi.fn(),
  preview: vi.fn(),
}));
vi.mock("../../infrastructure/http/safeHttpClient", () => ({
  safeHttpRequest: mocks.http,
}));
vi.mock("../../storage", () => ({
  storagePut: mocks.store,
  parseStorageUri: () => ({ provider: "local", key: "clip.mp4" }),
}));
vi.mock("../../infrastructure/localObjectStorage", () => ({
  verifiedLocalObjectPath: async () => "/objects/clip.mp4",
}));
vi.mock("../knowledge/videoMedia", () => ({ videoPoster: mocks.poster }));
vi.mock("./repository", () => ({ createAssetCandidate: vi.fn() }));
vi.mock("sharp", () => ({
  default: () => {
    const chain: any = {
      rotate: () => chain,
      resize: () => chain,
      webp: () => chain,
      toBuffer: mocks.preview,
    };
    return chain;
  },
}));
import { downloadVideoAsset } from "./videoIngestion";
const source = {
  role: "video",
  positionIndex: 0,
  sourceUrl: "https://m.media-amazon.com/images/S/example/main.mp4",
  posterUrl: null,
} as any;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.store.mockImplementation(async (key: string) => ({
    storageUri: "storage://local/" + key,
  }));
  mocks.poster.mockResolvedValue(Buffer.from("frame"));
  mocks.preview.mockResolvedValue(Buffer.from("preview"));
});
it("permits bounded large files and generates a poster without fetching the video again", async () => {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24);
  bytes.write("ftyp", 4);
  mocks.http.mockResolvedValue({ ok: true, body: bytes });
  const result = await downloadVideoAsset(
    { workspaceId: 1, snapshotId: 2 },
    source
  );
  expect(result.stored).toBe(true);
  expect(mocks.http).toHaveBeenCalledTimes(1);
  expect(mocks.http.mock.calls[0][1]).toMatchObject({
    maxResponseBytes: 200 * 1024 * 1024,
    responseBodyProfile: "amazon-video",
    timeoutMs: 600000,
  });
  expect(mocks.poster).toHaveBeenCalledWith("/objects/clip.mp4", undefined);
});
it("retries a broken poster once and retains the video already downloaded", async () => {
  const bytes = Buffer.alloc(24);
  bytes.writeUInt32BE(24);
  bytes.write("ftyp", 4);
  mocks.http.mockImplementation(async (url: string) =>
    url.endsWith("jpg") ? { ok: false, status: 404 } : { ok: true, body: bytes }
  );
  const result = await downloadVideoAsset(
    { workspaceId: 1, snapshotId: 2 },
    {
      ...source,
      posterUrl: "https://m.media-amazon.com/images/S/example/poster.jpg",
    }
  );
  expect(result).toMatchObject({ stored: true, attempts: 2 });
  expect(
    mocks.http.mock.calls.filter(([url]) => url.endsWith("mp4"))
  ).toHaveLength(1);
  expect(
    mocks.http.mock.calls.filter(([url]) => url.endsWith("jpg"))
  ).toHaveLength(2);
  expect(mocks.poster).toHaveBeenCalledTimes(1);
});
