import { describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { createImageTaggingImages } from "./imageTaggingImages";
import type { SafeHttpRequestOptions } from "../../infrastructure/http/safeHttpClient";
import { IMAGE_TAGGING_TAG_FIELDS, type ImageTaggingSourceImage } from "../../../shared/imageTagging";

const image: ImageTaggingSourceImage = { id: 8, imageSetId: 9, imagePosition: "main", positionIndex: 0, revisionHash: "a".repeat(64),
  originalContentHash: null, tagsConfirmed: false, analysisConfirmed: false,
  tags: Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(key => [key, null])) as ImageTaggingSourceImage["tags"], imageUrl: "storage://oss/kb-images/old-as-in/1-upload.png" };
async function fixture() {
  const bytes = await sharp({ create: { width: 2, height: 2, channels: 3, background: "white" } }).png().toBuffer();
  const request = vi.fn(async (_target: URL, _options: SafeHttpRequestOptions) => ({ ok: true, status: 200, body: bytes }));
  const get = vi.fn(async (key: string) => ({ key, url: "https://bucket.example.test/controlled?signature=short" }));
  const privatePreview = vi.fn(async () => "https://bucket.example.test/preview?signature=short");
  const dependencies = { request, get, privatePreview, provider: () => "oss" as const, assertPrivate: vi.fn(), parseLegacy: () => null };
  const adapter = createImageTaggingImages(dependencies as unknown as Parameters<typeof createImageTaggingImages>[0]);
  return { bytes, request, get, privatePreview, adapter };
}
describe("image tagging original-byte adapter", () => {
  it("reads the authorized legacy private key once without transforming bytes", async () => {
    const f = await fixture(), result = await f.adapter.read(image, { workspaceId: 7 });
    expect(result.originalBytes).toEqual(f.bytes);
    expect(result.evidence.contentHash).toBe(createHash("sha256").update(f.bytes).digest("hex"));
    expect(result.evidence.sourceUrlRef).toBe(image.imageUrl);
    expect(f.get).toHaveBeenCalledWith("kb-images/old-as-in/1-upload.png", { expectedProvider: "oss", expiresSeconds: 60 });
    expect(f.request).toHaveBeenCalledTimes(1);
    expect(f.request.mock.calls[0][1]).toMatchObject({ maxRedirects: 0, maxResponseBytes: 8388608, timeoutMs: 30000 });
  });
  it("verifies durable original content hash before any model stage", async () => {
    const f = await fixture(); await expect(f.adapter.read({ ...image, originalContentHash: "0".repeat(64) }, { workspaceId: 7 })).rejects.toThrow("IMAGE_CONTENT_CHANGED");
  });
  it.each(["storage://oss/a/../b.png", "storage://oss/a//b.png", "storage://s3/other.png", "storage://local/etc/passwd", "https://evil.example/image.png", "https://m.media-amazon.com/image.png?token=secret", "https://m.media-amazon.com.evil.example/x.png", "https://127.0.0.1/x.png"])("does not fetch arbitrary/uncontrolled %s", async imageUrl => {
    const f = await fixture(); await expect(f.adapter.read({ ...image, imageUrl }, { workspaceId: 7 })).rejects.toThrow();
    expect(f.request).not.toHaveBeenCalled();
  });
  it("accepts only the captured Amazon CDN without a redirect", async () => {
    const f = await fixture(); await f.adapter.read({ ...image, imageUrl: "https://m.media-amazon.com/images/I/example.png" }, { workspaceId: 7 });
    expect(f.get).not.toHaveBeenCalled(); expect(f.request).toHaveBeenCalledTimes(1);
  });
  it("preview returns only a newly controlled short URL, not the persisted reference", async () => {
    const f = await fixture(); expect(await f.adapter.preview(image)).toContain("signature=short"); expect(f.request).not.toHaveBeenCalled();
    expect(await f.adapter.preview({ ...image, imageUrl: "storage://forge/private.jpg" })).toBeNull();
  });
  it("full decoding rejects a signature-only/truncated image", async () => {
    const f = await fixture(); f.request.mockResolvedValue({ ok: true, status: 200, body: f.bytes.subarray(0, 26) });
    await expect(f.adapter.read(image, { workspaceId: 7 })).rejects.toThrow();
  });
  it("does not start a read after an explicit stop", async () => {
    const f = await fixture(), controller = new AbortController(); controller.abort();
    await expect(f.adapter.read(image, { workspaceId: 7 }, controller.signal)).rejects.toThrow(); expect(f.request).not.toHaveBeenCalled();
  });
});
