import { createHash } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { AcquisitionReviewIdentitySchema, AcquisitionReviewReadInputSchema, acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { ENV } from "../../_core/env";
import { assertPrivateEvidenceStorageAvailable, getActiveStorageProvider, storageGet, storagePut } from "../../storage";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";

export const MANUAL_SNAPSHOT_IMAGE_LIMITS = { bytes: 8 * 1024 * 1024, rawArtifactBytes: 16 * 1024 * 1024, pixels: 25_000_000, edge: 10_000, frames: 30 } as const;
const hash = z.string().regex(/^[a-f0-9]{64}$/u), id = z.number().int().positive().max(2147483647);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
export const ManualSnapshotImageRoleSchema = z.enum(["main", "secondary", "aplus", "brand_story"]);
export const ManualSnapshotImageMimeSchema = z.enum(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif"]);
const fileName = z.string().min(1).max(180).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f/\\]/u.test(value)
  && new TextDecoder().decode(new TextEncoder().encode(value)) === value);
export const ManualSnapshotImageMetadataSchema = z.object({ contentHash: hash, contentType: ManualSnapshotImageMimeSchema,
  byteSize: z.number().int().positive().max(MANUAL_SNAPSHOT_IMAGE_LIMITS.bytes), width: id.max(MANUAL_SNAPSHOT_IMAGE_LIMITS.edge),
  height: id.max(MANUAL_SNAPSHOT_IMAGE_LIMITS.edge), frames: id.max(MANUAL_SNAPSHOT_IMAGE_LIMITS.frames),
}).strict().refine(value => value.width * value.height * value.frames <= MANUAL_SNAPSHOT_IMAGE_LIMITS.pixels);
export type ManualSnapshotImageMetadata = z.infer<typeof ManualSnapshotImageMetadataSchema>;
export function manualSnapshotImageOperationKey(identity: z.infer<typeof AcquisitionReviewIdentitySchema>, operationId: string): string {
  return acquisitionReviewHash({ identity: AcquisitionReviewIdentitySchema.parse(identity), operationId: uuid.parse(operationId), namespace: "acquisition_review_image_v1" });
}
const extension = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/avif": "avif" } as const;
/** Server-only durable prepare. Never return object keys, provider URLs, bytes or
 * this record to the browser. The owning transaction supplies authorization. */
export const ManualSnapshotPreparedImageSchema = z.object({
  version: z.literal(1), identity: AcquisitionReviewIdentitySchema, scope: AcquisitionReviewReadInputSchema,
  operationId: uuid, expectedRevisionHash: hash, requestHash: hash, mode: z.enum(["retry_original", "supplement"]),
  sourceAssetId: id.nullable(), role: ManualSnapshotImageRoleSchema, sourceArtifactId: id,
  sourceJsonPath: z.string().min(1).max(512), sourceUrlHash: hash, fileName: fileName.nullable(),
  metadata: ManualSnapshotImageMetadataSchema, provider: z.enum(["s3", "oss"]), objectKey: z.string().min(1).max(400), storageUri: z.string().min(1).max(450),
}).strict().superRefine((value, ctx) => {
  const key = `acquisition-review/${value.identity.workspaceId}/snapshots/${value.scope.snapshotId}/${manualSnapshotImageOperationKey(value.identity, value.operationId)}.${extension[value.metadata.contentType]}`;
  if (value.identity.workspaceId !== value.scope.expectedWorkspaceId || value.requestHash !== manualSnapshotPreparedImageRequestHash(value)
    || value.objectKey !== key || value.storageUri !== `storage://${value.provider}/${key}`
    || (value.mode === "retry_original" && (value.sourceAssetId === null || value.fileName !== null))
    || (value.mode === "supplement" && (value.fileName === null || value.sourceJsonPath !== `$.manualSupplement.${value.operationId}`
      || value.sourceUrlHash !== acquisitionReviewHash({ kind: "manual_supplement", contentHash: value.metadata.contentHash })))) {
    ctx.addIssue({ code: "custom", message: "Prepared image binding mismatch" });
  }
});
export type ManualSnapshotPreparedImage = z.infer<typeof ManualSnapshotPreparedImageSchema>;
export function manualSnapshotPreparedImageRequestHash(value: Pick<ManualSnapshotPreparedImage,
  "identity" | "scope" | "operationId" | "expectedRevisionHash" | "mode" | "sourceAssetId" | "role" | "fileName" | "metadata">): string {
  const request = { ...value.scope, operationId: value.operationId, expectedRevisionHash: value.expectedRevisionHash, mode: value.mode, sourceAssetId: value.sourceAssetId };
  return acquisitionReviewHash({ identity: value.identity, request: value.mode === "retry_original" ? request
    : { ...request, role: value.role, fileName: value.fileName, contentHash: value.metadata.contentHash, byteSize: value.metadata.byteSize } });
}
export const ManualSnapshotRawArtifactSchema = z.object({ id, workspaceId: id, runId: id, artifactKind: z.literal("provider_result"),
  storageKey: z.string().min(1).max(1024), contentHash: hash, contentType: z.literal("application/json"),
  sizeBytes: z.number().int().positive().max(MANUAL_SNAPSHOT_IMAGE_LIMITS.rawArtifactBytes),
}).strict();
export type ManualSnapshotRawArtifact = z.infer<typeof ManualSnapshotRawArtifactSchema>;
export class ManualSnapshotImageStorageError extends Error {
  constructor(readonly code: string) { super(code); this.name = "ManualSnapshotImageStorageError"; }
}
const fail = (code: string): never => { throw new ManualSnapshotImageStorageError(code); };
export const manualSnapshotImageBytesHash = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
function detectedMime(bytes: Buffer): z.infer<typeof ManualSnapshotImageMimeSchema> | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 13 && /^(GIF87a|GIF89a)$/u.test(bytes.toString("ascii", 0, 6))) return "image/gif";
  if (bytes.length >= 30 && bytes.toString("ascii", 0, 4) === "RIFF" && bytes.toString("ascii", 8, 12) === "WEBP" && bytes.readUInt32LE(4) + 8 === bytes.length) return "image/webp";
  if (bytes.length >= 24 && bytes.toString("ascii", 4, 8) === "ftyp" && bytes.readUInt32BE(0) <= bytes.length
    && /^(avif|avis)$/u.test(bytes.toString("ascii", 8, 12))) return "image/avif";
  return null;
}
/** Full bounded decode is validation only: no rotate, resize, crop, toBuffer or
 * image re-encoding. The caller retains precisely the originally supplied bytes. */
export async function inspectManualSnapshotImageBytes(raw: Uint8Array, declaredMime?: string): Promise<ManualSnapshotImageMetadata> {
  if (!(raw instanceof Uint8Array) || !raw.length || raw.length > MANUAL_SNAPSHOT_IMAGE_LIMITS.bytes) return fail("ACQUISITION_IMAGE_SIZE_INVALID");
  const bytes = Buffer.from(raw), contentType = detectedMime(bytes);
  if (!contentType || declaredMime !== undefined && contentType !== declaredMime) return fail("ACQUISITION_IMAGE_TYPE_INVALID");
  const image = sharp(bytes, { animated: true, failOn: "warning", limitInputPixels: MANUAL_SNAPSHOT_IMAGE_LIMITS.pixels });
  try {
    const meta = await image.metadata(), frames = meta.pages ?? 1;
    const format = contentType === "image/jpeg" ? "jpeg" : contentType === "image/avif" ? "heif" : contentType.slice(6);
    const parsed = ManualSnapshotImageMetadataSchema.safeParse({ contentHash: manualSnapshotImageBytesHash(bytes), contentType, byteSize: bytes.length,
      width: meta.width, height: meta.pageHeight ?? meta.height, frames });
    if (!parsed.success || meta.format !== format) return fail("ACQUISITION_IMAGE_PIXEL_LIMIT");
    await image.stats();
    return parsed.data;
  } catch (error) { if (error instanceof ManualSnapshotImageStorageError) throw error; return fail("ACQUISITION_IMAGE_DECODE_INVALID"); }
  finally { image.destroy(); }
}
export function decodeManualSnapshotImageBase64(value: string): Buffer {
  if (typeof value !== "string" || !value.length || value.length > Math.ceil(MANUAL_SNAPSHOT_IMAGE_LIMITS.bytes / 3) * 4
    || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(value)) return fail("ACQUISITION_IMAGE_BASE64_INVALID");
  const bytes = Buffer.from(value, "base64");
  if (!bytes.length || bytes.length > MANUAL_SNAPSHOT_IMAGE_LIMITS.bytes || bytes.toString("base64") !== value) return fail("ACQUISITION_IMAGE_BASE64_INVALID");
  return bytes;
}
const defaults = { assertPrivate: assertPrivateEvidenceStorageAvailable, provider: getActiveStorageProvider,
  configured: () => Boolean(ENV.s3Region.trim() && ENV.s3Bucket.trim() && ENV.s3AccessKeyId.trim() && ENV.s3SecretAccessKey.trim()),
  put: storagePut, get: storageGet, request: safeHttpRequest };
function httpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { return fail("ACQUISITION_IMAGE_TRANSPORT_INVALID"); }
  if (url.protocol !== "https:" || url.username || url.password || url.hash || url.port && url.port !== "443"
    || /[\\\u0000-\u0020\u007f]/u.test(value)) return fail("ACQUISITION_IMAGE_TRANSPORT_INVALID");
  return url;
}
/** No authorization, transaction, retry or deletion is hidden in this adapter. */
export function createManualSnapshotImageStorage(dependencies: Partial<typeof defaults> = {}) {
  const deps = { ...defaults, ...dependencies };
  function assertAvailable(): "s3" | "oss" {
    try { deps.assertPrivate(); const provider = deps.provider(); if ((provider !== "s3" && provider !== "oss") || !deps.configured()) return fail("ACQUISITION_IMAGE_STORAGE_UNAVAILABLE"); return provider; }
    catch { return fail("ACQUISITION_IMAGE_STORAGE_UNAVAILABLE"); }
  }
  function prepare(input: Omit<ManualSnapshotPreparedImage, "version" | "provider" | "objectKey" | "storageUri">): ManualSnapshotPreparedImage {
    const provider = assertAvailable(), objectKey = `acquisition-review/${input.identity.workspaceId}/snapshots/${input.scope.snapshotId}/${manualSnapshotImageOperationKey(input.identity, input.operationId)}.${extension[input.metadata.contentType]}`;
    return ManualSnapshotPreparedImageSchema.parse({ ...input, version: 1, provider, objectKey, storageUri: `storage://${provider}/${objectKey}` });
  }
  function checked(input: ManualSnapshotPreparedImage): ManualSnapshotPreparedImage {
    const value = ManualSnapshotPreparedImageSchema.parse(input);
    if (value.provider !== assertAvailable()) return fail("ACQUISITION_IMAGE_STORAGE_PROVIDER_CHANGED"); return value;
  }
  async function readObject(provider: "s3" | "oss", key: string, size: number, contentHash: string, workspaceId: number): Promise<Buffer> {
    const signed = await deps.get(key, { expectedProvider: provider, expiresSeconds: 60 });
    if (signed.key !== key || deps.provider() !== provider) return fail("ACQUISITION_IMAGE_OBJECT_UNVERIFIED");
    const url = httpsUrl(signed.url), response = await deps.request(url, { method: "GET", allowedHosts: [url.hostname], maxRedirects: 0,
      maxResponseBytes: size, timeoutMs: 30_000, auditContext: { workspaceId, operation: "acquisition.review.image.verify" } });
    if (!response.ok || response.status !== 200 || !Buffer.isBuffer(response.body) || response.body.length !== size
      || manualSnapshotImageBytesHash(response.body) !== contentHash || deps.provider() !== provider) return fail("ACQUISITION_IMAGE_OBJECT_UNVERIFIED");
    return Buffer.from(response.body);
  }
  async function putOnce(input: ManualSnapshotPreparedImage, bytes: Uint8Array): Promise<void> {
    const prepared = checked(input);
    if (!(bytes instanceof Uint8Array) || bytes.length !== prepared.metadata.byteSize || manualSnapshotImageBytesHash(bytes) !== prepared.metadata.contentHash) return fail("ACQUISITION_IMAGE_CONTENT_MISMATCH");
    try {
      const result = await deps.put(prepared.objectKey, Buffer.from(bytes), prepared.metadata.contentType, { maxAttempts: 1 });
      if (result.key !== prepared.objectKey || result.storageUri !== prepared.storageUri || deps.provider() !== prepared.provider) return fail("ACQUISITION_IMAGE_PUT_UNCONFIRMED");
    } catch { return fail("ACQUISITION_IMAGE_PUT_UNCONFIRMED"); }
  }
  async function readVerified(input: ManualSnapshotPreparedImage): Promise<ManualSnapshotImageMetadata> {
    const prepared = checked(input);
    try {
      const bytes = await readObject(prepared.provider, prepared.objectKey, prepared.metadata.byteSize, prepared.metadata.contentHash, prepared.identity.workspaceId);
      const metadata = await inspectManualSnapshotImageBytes(bytes, prepared.metadata.contentType);
      if (acquisitionReviewHash(metadata) !== acquisitionReviewHash(prepared.metadata)) return fail("ACQUISITION_IMAGE_OBJECT_UNVERIFIED");
      return metadata;
    } catch { return fail("ACQUISITION_IMAGE_OBJECT_UNVERIFIED"); }
  }
  async function readRawArtifact(raw: ManualSnapshotRawArtifact): Promise<Buffer> {
    const artifact = ManualSnapshotRawArtifactSchema.parse(raw), provider = assertAvailable();
    const key = `acquisition/${artifact.workspaceId}/runs/${artifact.runId}/${artifact.contentHash}.json`;
    if (artifact.storageKey !== `storage://${provider}/${key}`) return fail("ACQUISITION_IMAGE_RAW_UNVERIFIED");
    try { return await readObject(provider, key, artifact.sizeBytes, artifact.contentHash, artifact.workspaceId); }
    catch { return fail("ACQUISITION_IMAGE_RAW_UNVERIFIED"); }
  }
  async function fetchOriginal(sourceUrl: string, sourceUrlHash: string, workspaceId: number): Promise<{ bytes: Buffer; metadata: ManualSnapshotImageMetadata }> {
    try {
      if (!hash.safeParse(sourceUrlHash).success || manualSnapshotImageBytesHash(Buffer.from(sourceUrl, "utf8")) !== sourceUrlHash) return fail("ACQUISITION_IMAGE_SOURCE_UNVERIFIED");
      const url = httpsUrl(sourceUrl);
      if (!["media-amazon.com", "ssl-images-amazon.com"].some(suffix => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))) return fail("ACQUISITION_IMAGE_SOURCE_UNVERIFIED");
      const response = await deps.request(url, { method: "GET", allowedHosts: [url.hostname], maxRedirects: 0, maxResponseBytes: MANUAL_SNAPSHOT_IMAGE_LIMITS.bytes,
        timeoutMs: 30_000, auditContext: { workspaceId, operation: "acquisition.review.image.original" } });
      if (!response.ok || response.status !== 200 || !Buffer.isBuffer(response.body)) return fail("ACQUISITION_IMAGE_ORIGINAL_UNAVAILABLE");
      const metadata = await inspectManualSnapshotImageBytes(response.body);
      return { bytes: Buffer.from(response.body), metadata };
    } catch (error) { if (error instanceof ManualSnapshotImageStorageError) throw error; return fail("ACQUISITION_IMAGE_ORIGINAL_UNAVAILABLE"); }
  }
  return { assertAvailable, prepare, putOnce, readVerified, readRawArtifact, fetchOriginal };
}
export const manualSnapshotImageStorage = createManualSnapshotImageStorage();
