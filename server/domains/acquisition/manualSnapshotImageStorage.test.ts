import { createHash } from "node:crypto";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import type { SafeHttpResponse } from "../../infrastructure/http/safeHttpClient";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { createManualSnapshotImageStorage, decodeManualSnapshotImageBase64, inspectManualSnapshotImageBytes, MANUAL_SNAPSHOT_IMAGE_LIMITS,
  ManualSnapshotPreparedImageSchema, manualSnapshotImageBytesHash, manualSnapshotPreparedImageRequestHash } from "./manualSnapshotImageStorage";

const identity = { userId: 3, workspaceId: 7 }, scope = { expectedWorkspaceId: 7, expectedProjectId: 11, snapshotId: 13 };
const operationId = "11ad21b6-18f1-4d4f-8ddf-000000000001", sourceUrl = "https://m.media-amazon.com/images/I/original.png";
const h = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture() {
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: "#123456" } }).png().toBuffer();
  const metadata = await inspectManualSnapshotImageBytes(bytes, "image/png");
  const put = vi.fn(async (key: string) => ({ key, storageUri: `storage://oss/${key}`, url: "https://private.example.test/object?signature=secret" }));
  const get = vi.fn(async (key: string) => ({ key, url: "https://private.example.test/object?signature=secret" }));
  const request = vi.fn(async () => ({ ok: true, status: 200, body: bytes }) as SafeHttpResponse);
  const dependencies = { assertPrivate: vi.fn(), provider: () => "oss" as const, configured: () => true, put, get, request };
  const storage = createManualSnapshotImageStorage(dependencies);
  const requestHash = manualSnapshotPreparedImageRequestHash({ identity, scope, operationId, expectedRevisionHash: h("revision"), mode: "supplement", sourceAssetId: null,
    role: "secondary", fileName: "原始图片.png", metadata });
  const prepared = storage.prepare({ identity, scope, operationId, mode: "supplement", expectedRevisionHash: h("revision"), requestHash,
    sourceAssetId: null, role: "secondary", sourceArtifactId: 17, sourceJsonPath: `$.manualSupplement.${operationId}`,
    sourceUrlHash: acquisitionReviewHash({ kind: "manual_supplement", contentHash: metadata.contentHash }), fileName: "原始图片.png", metadata });
  return { bytes, metadata, prepared, dependencies, storage, put, get, request };
}

describe("manual snapshot exact-byte private image storage", () => {
  it("strictly decodes base64 without data URLs, whitespace, noncanonical bits or oversized bytes", () => {
    expect(decodeManualSnapshotImageBase64("YWJj")).toEqual(Buffer.from("abc"));
    for (const value of ["", "YWJj\n", "data:image/png;base64,YWJj", "YR==", "YQ", "____", "YQ===", "YQ=\n"]) expect(() => decodeManualSnapshotImageBase64(value)).toThrow("BASE64_INVALID");
    expect(() => decodeManualSnapshotImageBase64(Buffer.alloc(MANUAL_SNAPSHOT_IMAGE_LIMITS.bytes + 1).toString("base64"))).toThrow("BASE64_INVALID");
  });
  it.each(["png", "jpeg", "webp", "gif", "avif"] as const)("fully decodes actual %s pixels without changing supplied bytes", async format => {
    const bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: "#123456" } }).toFormat(format).toBuffer();
    const before = Buffer.from(bytes), metadata = await inspectManualSnapshotImageBytes(bytes);
    expect(metadata).toMatchObject({ width: 3, height: 2, byteSize: bytes.length, contentHash: manualSnapshotImageBytesHash(bytes), frames: 1 });
    expect(bytes).toEqual(before);
  });
  it("does not trust MIME, image header dimensions, HTML, SVG or damaged pixels", async () => {
    const f = await fixture();
    await expect(inspectManualSnapshotImageBytes(f.bytes, "image/jpeg")).rejects.toThrow("TYPE_INVALID");
    for (const bytes of [Buffer.from("<svg><image /></svg>"), Buffer.from("<html>image.png</html>"), f.bytes.subarray(0, 40)]) {
      await expect(inspectManualSnapshotImageBytes(bytes)).rejects.toThrow();
    }
    const oversized = await sharp({ create: { width: 10_001, height: 1, channels: 3, background: "#123456" } }).png().toBuffer();
    await expect(inspectManualSnapshotImageBytes(oversized)).rejects.toThrow("PIXEL_LIMIT");
  });
  it("decodes every preserved animation frame and rejects the31frame limit", async () => {
    for (const frames of [2, 31]) {
      const raw = Buffer.alloc(2 * 2 * frames * 3);
      for (let frame = 0; frame < frames; frame++) raw.fill(frame * 7, frame * 12, frame * 12 + 12);
      const bytes = await sharp(raw, { raw: { width: 2, height: 2 * frames, channels: 3, pageHeight: 2 } }).gif({ delay: Array(frames).fill(10) }).toBuffer();
      if (frames === 2) expect(await inspectManualSnapshotImageBytes(bytes)).toMatchObject({ width: 2, height: 2, frames: 2, contentHash: manualSnapshotImageBytesHash(bytes) });
      else await expect(inspectManualSnapshotImageBytes(bytes)).rejects.toThrow("PIXEL_LIMIT");
    }
  });
  it("prepares deterministic private scoped metadata and performs no I/O", async () => {
    const f = await fixture();
    expect(f.prepared.objectKey).toMatch(/^acquisition-review\/7\/snapshots\/13\/[a-f0-9]{64}\.png$/u);
    expect(f.prepared).not.toHaveProperty("base64"); expect(f.prepared).not.toHaveProperty("url");
    expect(f.put).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled(); expect(f.request).not.toHaveBeenCalled();
  });
  it("sends unmodified original bytes with explicit SDK maxAttempts one", async () => {
    const f = await fixture(); await f.storage.putOnce(f.prepared, f.bytes);
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.put).toHaveBeenCalledWith(f.prepared.objectKey, f.bytes, "image/png", { maxAttempts: 1 });
  });
  it("an unknown PUT is not retried and does not reveal provider signatures", async () => {
    const f = await fixture(); f.put.mockRejectedValue(new Error("https://secret/signature=token"));
    await expect(f.storage.putOnce(f.prepared, f.bytes)).rejects.toThrow(/^ACQUISITION_IMAGE_PUT_UNCONFIRMED$/u);
    expect(f.put).toHaveBeenCalledTimes(1); expect(f.get).not.toHaveBeenCalled();
  });
  it.each(["size", "hash"])("rejects content %s mismatch before PUT", async kind => {
    const f = await fixture(), bytes = kind === "size" ? f.bytes.subarray(1) : Buffer.alloc(f.bytes.length);
    await expect(f.storage.putOnce(f.prepared, bytes)).rejects.toThrow("CONTENT_MISMATCH"); expect(f.put).not.toHaveBeenCalled();
  });
  it("verifies original object via bounded private GET and full decode, never PUT", async () => {
    const f = await fixture(); expect(await f.storage.readVerified(f.prepared)).toEqual(f.metadata);
    expect(f.get).toHaveBeenCalledTimes(1); expect(f.get).toHaveBeenCalledWith(f.prepared.objectKey, { expectedProvider: "oss", expiresSeconds: 60 });
    expect(f.request).toHaveBeenCalledWith(expect.any(URL), expect.objectContaining({ method: "GET", allowedHosts: ["private.example.test"],
      maxResponseBytes: f.bytes.length, maxRedirects: 0, timeoutMs: 30_000 })); expect(f.put).not.toHaveBeenCalled();
  });
  it.each(["size", "hash", "dimensions", "missing", "partial", "redirect", "network", "signed-key"])("refuses an unverifiable stored object: %s", async kind => {
    const f = await fixture(), response = { ok: true, status: 200, body: f.bytes } as SafeHttpResponse;
    if (kind === "size") response.body = Buffer.from("x");
    if (kind === "hash") response.body = Buffer.alloc(f.bytes.length);
    if (kind === "dimensions") f.prepared.metadata.width++;
    if (kind === "missing") { response.ok = false; response.status = 404; }
    if (kind === "partial") response.status = 206;
    if (kind === "redirect") response.status = 302;
    if (kind === "network") f.request.mockRejectedValue(new Error("private-signature")); else f.request.mockResolvedValue(response);
    if (kind === "signed-key") f.get.mockResolvedValue({ key: "other", url: "https://private.example.test/object" });
    await expect(f.storage.readVerified(f.prepared)).rejects.toThrow("OBJECT_UNVERIFIED"); expect(f.put).not.toHaveBeenCalled();
  });
  it.each(["http://private.example.test/x", "https://u:p@private.example.test/x", "https://private.example.test:8443/x", "https://private.example.test/x#fragment"])("rejects unsafe object transport %s", async url => {
    const f = await fixture(); f.get.mockImplementation(async key => ({ key, url }));
    await expect(f.storage.readVerified(f.prepared)).rejects.toThrow("OBJECT_UNVERIFIED"); expect(f.request).not.toHaveBeenCalled();
  });
  it.each(["workspace", "snapshot", "key", "uri", "manual-path", "manual-hash", "extra-bytes"])("rejects forged durable prepare %s", async kind => {
    const f = await fixture(), prepared = structuredClone(f.prepared) as typeof f.prepared & { base64?: string };
    if (kind === "workspace") prepared.scope.expectedWorkspaceId++;
    if (kind === "snapshot") prepared.scope.snapshotId++;
    if (kind === "key") prepared.objectKey += "../other";
    if (kind === "uri") prepared.storageUri = "https://public.example.test/image.png";
    if (kind === "manual-path") prepared.sourceJsonPath = "$.highResolutionImages[0]";
    if (kind === "manual-hash") prepared.sourceUrlHash = h("arbitrary");
    if (kind === "extra-bytes") prepared.base64 = "secret";
    expect(ManualSnapshotPreparedImageSchema.safeParse(prepared).success).toBe(false);
    await expect(f.storage.putOnce(prepared, f.bytes)).rejects.toThrow(); expect(f.put).not.toHaveBeenCalled();
  });
  it.each(["public", "forge", "unconfigured", "provider-changed"])("refuses %s storage without network", async kind => {
    const f = await fixture(), storage = createManualSnapshotImageStorage({ ...f.dependencies,
      ...(kind === "public" ? { assertPrivate: () => { throw new Error("public"); } } : {}),
      ...(kind === "forge" ? { provider: () => "forge" as const } : {}), ...(kind === "unconfigured" ? { configured: () => false } : {}),
      ...(kind === "provider-changed" ? { provider: () => "s3" as const } : {}) });
    await expect(storage.readVerified(f.prepared)).rejects.toThrow(); await expect(storage.putOnce(f.prepared, f.bytes)).rejects.toThrow();
    expect(f.put).not.toHaveBeenCalled(); expect(f.get).not.toHaveBeenCalled();
  });
  it("reads only the exact original raw artifact provider/key/hash/size", async () => {
    const f = await fixture(), bytes = Buffer.from('[{"asin":"B000000001"}]'), contentHash = manualSnapshotImageBytesHash(bytes);
    const raw = { id: 17, workspaceId: 7, runId: 19, artifactKind: "provider_result" as const, contentHash, contentType: "application/json" as const,
      sizeBytes: bytes.length, storageKey: `storage://oss/acquisition/7/runs/19/${contentHash}.json` };
    f.request.mockResolvedValue({ ok: true, status: 200, body: bytes } as SafeHttpResponse);
    expect(await f.storage.readRawArtifact(raw)).toEqual(bytes);
    await expect(f.storage.readRawArtifact({ ...raw, storageKey: raw.storageKey.replace("runs/19", "runs/20") })).rejects.toThrow("RAW_UNVERIFIED");
    f.request.mockResolvedValue({ ok: true, status: 200, body: Buffer.alloc(bytes.length) } as SafeHttpResponse);
    await expect(f.storage.readRawArtifact(raw)).rejects.toThrow("RAW_UNVERIFIED"); expect(f.put).not.toHaveBeenCalled();
  });
  it("fetches only a hash-bound original controlled CDN URL once with no redirects", async () => {
    const f = await fixture(); expect(await f.storage.fetchOriginal(sourceUrl, h(sourceUrl), 7)).toEqual({ bytes: f.bytes, metadata: f.metadata });
    expect(f.request).toHaveBeenCalledTimes(1); expect(f.request).toHaveBeenCalledWith(new URL(sourceUrl), expect.objectContaining({ method: "GET", allowedHosts: ["m.media-amazon.com"],
      maxRedirects: 0, maxResponseBytes: MANUAL_SNAPSHOT_IMAGE_LIMITS.bytes })); expect(f.put).not.toHaveBeenCalled();
  });
  it.each(["https://media-amazon.com.evil.test/image.png", "https://m.media-amazon.com@evil.test/a", "http://m.media-amazon.com/a", "https://127.0.0.1/a", "https://m.media-amazon.com/a#x"])("rejects arbitrary or unsafe original URL %s", async url => {
    const f = await fixture(); await expect(f.storage.fetchOriginal(url, h(url), 7)).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
  });
  it("rejects a changed source URL hash and provider ACK", async () => {
    const f = await fixture(); await expect(f.storage.fetchOriginal(sourceUrl, h("other"), 7)).rejects.toThrow("SOURCE_UNVERIFIED");
    f.put.mockImplementation(async key => ({ key, storageUri: `storage://s3/${key}`, url: "https://public.example.test" }));
    await expect(f.storage.putOnce(f.prepared, f.bytes)).rejects.toThrow("PUT_UNCONFIRMED"); expect(f.put).toHaveBeenCalledTimes(1);
  });
});
