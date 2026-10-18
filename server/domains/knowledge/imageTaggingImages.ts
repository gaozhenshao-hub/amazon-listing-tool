import { createPrivateEvidencePreviewUrl, getActiveStorageProvider, parseLegacyPresignedObjectKey, parseStorageUri, storageGet,
  assertPrivateEvidenceStorageAvailable } from "../../storage";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { inspectManualSnapshotImageBytes } from "../acquisition/manualSnapshotImageStorage";
import { IMAGE_TAGGING_LIMITS, ImageTaggingSourceImageSchema, type ImageTaggingSourceImage } from "../../../shared/imageTagging";
import { ImageTaggingEvidenceSchema } from "./imageTaggingRuntimeContract";

const fail = (code: string): never => { throw new Error(`IMAGE_TAGGING_${code}`); };
function url(value: string) {
  if (/[\\\u0000-\u0020\u007f]/u.test(value)) return fail("IMAGE_REFERENCE_INVALID");
  let result: URL; try { result = new URL(value); } catch { return fail("IMAGE_REFERENCE_INVALID"); }
  if (result.protocol !== "https:" || result.username || result.password || result.hash || result.port && result.port !== "443") return fail("IMAGE_REFERENCE_INVALID");
  return result;
}
function key(value: string) {
  if (!value || value.length > 1024 || value.split("/").some(part => !part || part === "." || part === "..")
    || /[\\\u0000-\u0020\u007f]/u.test(value)) return fail("IMAGE_REFERENCE_INVALID");
  return value;
}
const amazon = (value: URL) => ["media-amazon.com", "ssl-images-amazon.com"].some(suffix => value.hostname === suffix || value.hostname.endsWith(`.${suffix}`));
/** Accept only a repository-captured reference, never a browser-supplied URL.
 * Reads preserve original bytes; no crop, resize, reencode, PUT or model call. */
export function createImageTaggingImages(dependencies: Partial<{ get: typeof storageGet; request: typeof safeHttpRequest;
  inspect: typeof inspectManualSnapshotImageBytes; provider: typeof getActiveStorageProvider;
  assertPrivate: typeof assertPrivateEvidenceStorageAvailable; privatePreview: typeof createPrivateEvidencePreviewUrl;
  parseLegacy: typeof parseLegacyPresignedObjectKey }> = {}) {
  const deps = { get: storageGet, request: safeHttpRequest, inspect: inspectManualSnapshotImageBytes, provider: getActiveStorageProvider,
    assertPrivate: assertPrivateEvidenceStorageAvailable, privatePreview: createPrivateEvidencePreviewUrl,
    parseLegacy: parseLegacyPresignedObjectKey, ...dependencies };
  function reference(image: ImageTaggingSourceImage) {
    const parsed = parseStorageUri(image.imageUrl);
    if (parsed) {
      if (!["s3", "oss"].includes(parsed.provider) || parsed.provider !== deps.provider()
        || image.imageUrl !== `storage://${parsed.provider}/${parsed.key}`) return fail("IMAGE_STORAGE_UNAVAILABLE");
      return { kind: "storage" as const, provider: parsed.provider, key: key(parsed.key) };
    }
    const legacy = deps.parseLegacy(image.imageUrl);
    if (legacy) {
      const provider = deps.provider(); if (provider !== "s3" && provider !== "oss") return fail("IMAGE_STORAGE_UNAVAILABLE");
      return { kind: "storage" as const, provider, key: key(legacy) };
    }
    const external = url(image.imageUrl);
    if (!amazon(external) || external.search) return fail("IMAGE_SOURCE_UNSUPPORTED");
    return { kind: "amazon" as const, url: external };
  }
  return {
    async preview(raw: ImageTaggingSourceImage): Promise<string | null> {
      try {
        const image = ImageTaggingSourceImageSchema.parse(raw), source = reference(image);
        if (source.kind === "amazon") return source.url.href;
        deps.assertPrivate(); return await deps.privatePreview(`storage://${source.provider}/${source.key}`);
      } catch { return null; }
    },
    async read(raw: ImageTaggingSourceImage, identity: { workspaceId: number }, signal?: AbortSignal) {
      const image = ImageTaggingSourceImageSchema.parse(raw), source = reference(image);
      signal?.throwIfAborted();
      let target: URL;
      if (source.kind === "storage") {
        deps.assertPrivate(); const signed = await deps.get(source.key, { expectedProvider: source.provider, expiresSeconds: 60 });
        if (signed.key !== source.key || deps.provider() !== source.provider) return fail("IMAGE_STORAGE_CHANGED");
        target = url(signed.url);
      } else target = source.url;
      const response = await deps.request(target, { method: "GET", allowedHosts: [target.hostname], maxRedirects: 0,
        maxResponseBytes: IMAGE_TAGGING_LIMITS.imageBytes, timeoutMs: 30_000, signal,
        auditContext: { workspaceId: identity.workspaceId, operation: "knowledge.image_tagging.original" } });
      if (!response.ok || response.status !== 200 || !Buffer.isBuffer(response.body)) return fail("IMAGE_UNAVAILABLE");
      if (source.kind === "storage" && source.provider !== deps.provider()) return fail("IMAGE_STORAGE_CHANGED");
      const metadata = await deps.inspect(response.body);
      if (image.originalContentHash !== null && metadata.contentHash !== image.originalContentHash) return fail("IMAGE_CONTENT_CHANGED");
      const evidence = ImageTaggingEvidenceSchema.parse({ imageSetId: image.imageSetId, imageId: image.id, imageRevision: image.revisionHash,
        sourceUrlRef: image.imageUrl, contentHash: metadata.contentHash, contentType: metadata.contentType, byteSize: metadata.byteSize });
      return { originalBytes: Buffer.from(response.body), evidence };
    },
  };
}
export const imageTaggingImages = createImageTaggingImages();
