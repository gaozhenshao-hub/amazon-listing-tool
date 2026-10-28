import sharp from "sharp";
import { createHash } from "node:crypto";
import type { SourceAssetReference } from "./amazonNormalizer";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { storagePut } from "../../storage";
import type { DbExecutor } from "../../repositories/dbClient";
import { createAssetCandidate } from "./repository";
import { setTimeout as delay } from "node:timers/promises";
import { ingestVideoAsset } from "./videoIngestion";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const ALLOWED_IMAGE_SUFFIXES = ["media-amazon.com", "ssl-images-amazon.com"];

type ImageMeta = { contentType: string; extension: string; width: number | null; height: number | null };

function readJpegSize(bytes: Buffer): { width: number; height: number } | null {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    const size = bytes.readUInt16BE(offset + 2);
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { height: bytes.readUInt16BE(offset + 5), width: bytes.readUInt16BE(offset + 7) };
    }
    if (size < 2) break;
    offset += size + 2;
  }
  return null;
}

export function detectImageMeta(bytes: Buffer, responseContentType: string | null): ImageMeta | null {
  if (bytes.length >= 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    return { contentType: "image/png", extension: "png", width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
  }
  const jpeg = readJpegSize(bytes);
  if (jpeg) return { contentType: "image/jpeg", extension: "jpg", ...jpeg };
  if (bytes.length >= 10 && ["GIF87a", "GIF89a"].includes(bytes.subarray(0, 6).toString("ascii"))) {
    return { contentType: "image/gif", extension: "gif", width: bytes.readUInt16LE(6), height: bytes.readUInt16LE(8) };
  }
  if (bytes.length >= 30 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP") {
    const kind = bytes.subarray(12, 16).toString("ascii");
    if (kind === "VP8X") {
      const width = 1 + bytes.readUIntLE(24, 3);
      const height = 1 + bytes.readUIntLE(27, 3);
      return { contentType: "image/webp", extension: "webp", width, height };
    }
    return { contentType: "image/webp", extension: "webp", width: null, height: null };
  }
  if ((responseContentType || "").split(";")[0].trim().toLowerCase() === "image/avif") {
    return { contentType: "image/avif", extension: "avif", width: null, height: null };
  }
  return null;
}

export type AssetDownloadResult = { assetId: number; role?: string; stored: boolean; fieldStatus: string; attempts: number; failureReason: string | null };
export function summarizeAssetDownloads(total: number, results: AssetDownloadResult[]) {
  return { total, completed: results.length, stored: results.filter(item => item.stored).length,
    failed: results.filter(item => !item.stored).length, imageFailed: results.filter(item=>!item.stored && item.role!=="video").length, videoFailed: results.filter(item=>!item.stored && item.role==="video").length, retried: results.filter(item => item.attempts > 1).length,
    recovered: results.filter(item => item.attempts > 1 && item.stored).length, results };
}

export async function downloadImageAsset(input: {workspaceId:number;snapshotId:number;signal?:AbortSignal}, asset:SourceAssetReference) {
    let stored: Awaited<ReturnType<typeof storagePut>> | null = null;
    let contentHash: string | null = null;
    let meta: ImageMeta | null = null;
    let sizeBytes: number | null = null;
    let fieldStatus = "download_failed";
    let thumbnailStorageKey: string | null = null;
    let attempts = 0, failureReason: string | null = null;
    // One initial request plus one retry, only for this failed image.
    for (let attempt = 1; attempt <= 2; attempt++) {
      input.signal?.throwIfAborted();
      attempts = attempt;
      try {
        const response = await safeHttpRequest(asset.sourceUrl, {
          timeoutMs: 30_000,
          maxRedirects: 3,
          maxResponseBytes: MAX_IMAGE_BYTES,
          allowedHostSuffixes: ALLOWED_IMAGE_SUFFIXES,
          signal: input.signal,
          auditContext: {
            workspaceId: input.workspaceId,
            toolSlug: "acquisition.amazon.asset.fetch",
            operation: "competitor_research_asset_download",
          },
        });
        if (!response.ok) { failureReason = "http_error"; throw new Error("asset response not successful"); }
        meta = detectImageMeta(response.body, response.headers.get("content-type"));
        failureReason = "invalid_image";
        if (!meta) throw new Error("asset format not allowed");
        // Validate format and dimensions before storing; reject non-image responses.
        const decoded = await sharp(response.body, {limitInputPixels:40_000_000}).metadata();
        if (!decoded.width || !decoded.height) throw new Error("asset dimensions missing");
        meta.width = decoded.width; meta.height = decoded.height;
        contentHash = createHash("sha256").update(response.body).digest("hex");
        sizeBytes = response.body.byteLength;
        const key = `acquisition/${input.workspaceId}/snapshots/${input.snapshotId}/${asset.role}/${asset.positionIndex}-${contentHash}.${meta.extension}`;
        failureReason = "storage_failed";
        input.signal?.throwIfAborted();
        stored = await storagePut(key, response.body, meta.contentType);
        fieldStatus = "pending_review";
        failureReason = null;
        try { const thumbnail = await sharp(response.body, {limitInputPixels:40_000_000}).rotate().resize({width:480,height:480,fit:"inside",withoutEnlargement:true}).webp({quality:72}).toBuffer();
          thumbnailStorageKey = (await storagePut(`${key}.thumb.webp`, thumbnail, "image/webp")).storageUri;
        } catch { /* A preview failure must not discard a safely stored original. */ }
        break;
      } catch {
        // Keep the source role and expected position as a visible gap. This is
        // not evidence that the image or its module does not exist.
        fieldStatus = "download_failed";
        input.signal?.throwIfAborted();
        failureReason ||= "download_failed";
        if (attempt < 2) { await delay(400, undefined, { signal: input.signal }); failureReason = null; }
      }
    }
    input.signal?.throwIfAborted();
    return {storageKey:stored?.storageUri??null,thumbnailStorageKey,contentHash,contentType:meta?.contentType??null,
      sizeBytes,width:meta?.width??null,height:meta?.height??null,stored:Boolean(stored),fieldStatus,attempts,failureReason};
}

export async function ingestAcquisitionAssets(input: {
  db: DbExecutor;
  workspaceId: number;
  snapshotId: number;
  rawArtifactId: number;
  assets: SourceAssetReference[];
  signal?: AbortSignal;
  onProgress?: (summary: ReturnType<typeof summarizeAssetDownloads>) => Promise<void>;
}) {
  const results: AssetDownloadResult[] = [];
  async function ingest(asset: SourceAssetReference): Promise<AssetDownloadResult> {
    const downloaded = await downloadImageAsset(input,asset);
    const {stored,fieldStatus,attempts,failureReason,...values}=downloaded;
    const assetId = await createAssetCandidate(input.db, {
      workspaceId: input.workspaceId,
      snapshotId: input.snapshotId,
      sourceArtifactId: input.rawArtifactId,
      role: asset.role,
      positionIndex: asset.positionIndex,
      sourceJsonPath: asset.sourcePath,
      sourceUrlHash: asset.sourceUrlHash,
      ...values,
      moduleType: asset.moduleType,
      moduleClass: asset.moduleClass,
      fieldStatus,
      reviewStatus: "pending",
    });
    return { assetId, role:asset.role, stored: Boolean(stored), fieldStatus, attempts, failureReason };
  }
  // Bound network/decoder pressure while avoiding one slow URL blocking the whole set.
  const images=input.assets.filter(asset=>asset.role!=="video");
  for (let offset = 0; offset < images.length; offset += 4) {
    input.signal?.throwIfAborted();
    results.push(...await Promise.all(images.slice(offset, offset + 4).map(ingest)));
    await input.onProgress?.(summarizeAssetDownloads(input.assets.length, [...results]));
  }
  for(const asset of input.assets.filter(asset=>asset.role==="video")) {
    results.push(await ingestVideoAsset(input,asset));
    await input.onProgress?.(summarizeAssetDownloads(input.assets.length,[...results]));
  }
  return summarizeAssetDownloads(input.assets.length, results);
}
