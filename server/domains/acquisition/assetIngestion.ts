import { createHash } from "node:crypto";
import type { SourceAssetReference } from "./amazonNormalizer";
import { safeHttpRequest } from "../../infrastructure/http/safeHttpClient";
import { storagePut } from "../../storage";
import type { DbExecutor } from "../../repositories/dbClient";
import { createAssetCandidate } from "./repository";

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

export async function ingestAcquisitionAssets(input: {
  db: DbExecutor;
  workspaceId: number;
  snapshotId: number;
  rawArtifactId: number;
  assets: SourceAssetReference[];
  signal?: AbortSignal;
}) {
  const results: Array<{ assetId: number; stored: boolean; fieldStatus: string }> = [];
  for (const asset of input.assets) {
    let stored: Awaited<ReturnType<typeof storagePut>> | null = null;
    let contentHash: string | null = null;
    let meta: ImageMeta | null = null;
    let sizeBytes: number | null = null;
    let fieldStatus = "invalid";
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
      if (!response.ok) throw new Error("asset response not successful");
      meta = detectImageMeta(response.body, response.headers.get("content-type"));
      if (!meta) throw new Error("asset format not allowed");
      contentHash = createHash("sha256").update(response.body).digest("hex");
      sizeBytes = response.body.byteLength;
      const key = `acquisition/${input.workspaceId}/snapshots/${input.snapshotId}/${asset.role}/${asset.positionIndex}-${contentHash}.${meta.extension}`;
      stored = await storagePut(key, response.body, meta.contentType);
      fieldStatus = "pending_review";
    } catch {
      fieldStatus = "invalid";
    }
    const assetId = await createAssetCandidate(input.db, {
      workspaceId: input.workspaceId,
      snapshotId: input.snapshotId,
      sourceArtifactId: input.rawArtifactId,
      role: asset.role,
      positionIndex: asset.positionIndex,
      sourceJsonPath: asset.sourcePath,
      sourceUrlHash: asset.sourceUrlHash,
      storageKey: stored?.storageUri ?? null,
      contentHash,
      contentType: meta?.contentType ?? null,
      sizeBytes,
      width: meta?.width ?? null,
      height: meta?.height ?? null,
      moduleType: asset.moduleType,
      moduleClass: asset.moduleClass,
      fieldStatus,
      reviewStatus: "pending",
    });
    results.push({ assetId, stored: Boolean(stored), fieldStatus });
  }
  return {
    total: results.length,
    stored: results.filter(item => item.stored).length,
    failed: results.filter(item => !item.stored).length,
    results,
  };
}
