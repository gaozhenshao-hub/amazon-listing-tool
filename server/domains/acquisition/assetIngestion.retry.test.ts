import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({ request: vi.fn(), put: vi.fn(), insert: vi.fn() }));
vi.mock("../../infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: mocks.request }));
vi.mock("../../storage", () => ({ storagePut: mocks.put }));
vi.mock("./repository", () => ({ createAssetCandidate: mocks.insert }));
import { ingestAcquisitionAssets } from "./assetIngestion";
import type { SourceAssetReference } from "./amazonNormalizer";

const asset = (n: number): SourceAssetReference => ({ role: n ? "secondary" : "main", positionIndex: n, sourcePath: `images.${n}`, sourceUrl: `https://m.media-amazon.com/${n}.png`, sourceUrlHash: String(n), moduleType: null, moduleClass: null });
const input = { db: {} as never, workspaceId: 1, snapshotId: 2, rawArtifactId: 3 };
let bytes: Buffer;
beforeEach(async () => {
  vi.clearAllMocks();
  bytes = await sharp({ create: { width: 8, height: 8, channels: 3, background: "white" } }).png().toBuffer();
  mocks.put.mockImplementation(async (key: string) => ({ storageUri: `local://${key}` }));
  mocks.insert.mockImplementation(async (_db, row) => row.positionIndex + 1);
});
const ok = () => ({ ok: true, body: bytes, headers: new Headers({ "content-type": "image/png" }) });
describe("per-image bounded automatic retry", () => {
  it("retries a failed video cover once before downloading the video", async () => {
    const mp4=Buffer.alloc(32);mp4.writeUInt32BE(24,0);mp4.write('ftyp',4);
    let posters=0;
    mocks.request.mockImplementation(async(url:string)=>url.endsWith('.jpg')
      ? ++posters===1?{ok:false,body:Buffer.from('error')}:ok()
      : {ok:true,body:mp4});
    const result=await ingestAcquisitionAssets({...input,assets:[{...asset(0),role:'video',sourceUrl:'https://m.media-amazon.com/video.mp4',posterUrl:'https://m.media-amazon.com/cover.jpg'}]});
    expect(result).toMatchObject({stored:1,videoFailed:0,retried:1,recovered:1});
    expect(mocks.request.mock.calls.filter(([url])=>url.endsWith('.jpg'))).toHaveLength(2);
    expect(mocks.request.mock.calls.filter(([url])=>url.endsWith('.mp4'))).toHaveLength(1);
  });
  it("stops after the second video failure and retains the successful cover", async () => {
    mocks.request.mockImplementation(async(url:string)=>url.endsWith('.jpg')?ok():{ok:false,body:Buffer.from('error')});
    const result=await ingestAcquisitionAssets({...input,assets:[{...asset(0),role:'video',sourceUrl:'https://m.media-amazon.com/video.mp4',posterUrl:'https://m.media-amazon.com/cover.jpg'}]});
    expect(result).toMatchObject({stored:0,videoFailed:1,retried:1,recovered:0});
    expect(mocks.request.mock.calls.filter(([url])=>url.endsWith('.mp4'))).toHaveLength(2);
    expect(mocks.request.mock.calls.filter(([url])=>url.endsWith('.jpg'))).toHaveLength(1);
    expect(mocks.insert).toHaveBeenCalledWith(input.db,expect.objectContaining({role:'video',storageKey:null,thumbnailStorageKey:expect.stringContaining('.poster.webp')}));
  });
  it("retries a failed video once, keeps its cover and never sends it to the image decoder",async()=>{
    const mp4=Buffer.alloc(32);mp4.writeUInt32BE(24,0);mp4.write('ftyp',4);
    let downloads=0;
    mocks.request.mockImplementation(async(url:string)=>url.endsWith('.jpg')?ok():++downloads===1?{ok:false,body:Buffer.from('error')}: {ok:true,body:mp4});
    const result=await ingestAcquisitionAssets({...input,assets:[{...asset(0),role:'video',sourceUrl:'https://m.media-amazon.com/default.jobtemplate.mp4.480.mp4',posterUrl:'https://m.media-amazon.com/cover.jpg'}]});
    expect(result).toMatchObject({stored:1,imageFailed:0,videoFailed:0,retried:1,recovered:1});
    expect(mocks.request.mock.calls.filter(([url])=>url.endsWith('.jpg'))).toHaveLength(1);
    expect(mocks.insert).toHaveBeenCalledWith(input.db,expect.objectContaining({role:'video',contentType:'video/mp4',fieldStatus:'pending_review',thumbnailStorageKey:expect.stringContaining('.poster.webp')}));
  });
  it("keeps successful images, retries only failures once, and reports recovery", async () => {
    let calls = 0;
    mocks.request.mockImplementation(async (url: string) => { if (url.endsWith("1.png") && calls++ === 0) throw Error("timeout"); return ok(); });
    const progress = vi.fn();
    const result = await ingestAcquisitionAssets({ ...input, assets: [asset(0), asset(1)], onProgress: progress });
    expect(result).toMatchObject({ total: 2, completed: 2, stored: 2, failed: 0, retried: 1, recovered: 1 });
    expect(mocks.request.mock.calls.filter(([url]) => url.endsWith("0.png"))).toHaveLength(1);
    expect(mocks.request.mock.calls.filter(([url]) => url.endsWith("1.png"))).toHaveLength(2);
    expect(mocks.insert).toHaveBeenCalledTimes(2);
    expect(progress).toHaveBeenLastCalledWith(result);
  });
  it("stops after two failed attempts and keeps the missing position for manual upload", async () => {
    mocks.request.mockResolvedValue({ ok: true, body: Buffer.from("<html>blocked</html>"), headers: new Headers({ "content-type": "image/jpeg" }) });
    const result = await ingestAcquisitionAssets({ ...input, assets: [asset(0)] });
    expect(mocks.request).toHaveBeenCalledTimes(2);
    expect(mocks.put).not.toHaveBeenCalled();
    expect(result).toMatchObject({ stored: 0, failed: 1, retried: 1, recovered: 0 });
    expect(mocks.insert).toHaveBeenCalledWith(input.db, expect.objectContaining({ role: "main", positionIndex: 0, fieldStatus: "download_failed", storageKey: null }));
  });
  it("does not re-download an original when only its thumbnail fails", async () => {
    mocks.request.mockResolvedValue(ok());
    mocks.put.mockImplementation(async (key: string) => { if (key.endsWith(".webp")) throw Error("preview storage unavailable"); return { storageUri: key }; });
    expect(await ingestAcquisitionAssets({ ...input, assets: [asset(0)] })).toMatchObject({ stored: 1, retried: 0 });
    expect(mocks.request).toHaveBeenCalledTimes(1);
  });
  it("cancels before requests and never inserts a false download failure", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(ingestAcquisitionAssets({ ...input, assets: [asset(0)], signal: controller.signal })).rejects.toBeDefined();
    expect(mocks.request).not.toHaveBeenCalled(); expect(mocks.insert).not.toHaveBeenCalled();
  });
});
