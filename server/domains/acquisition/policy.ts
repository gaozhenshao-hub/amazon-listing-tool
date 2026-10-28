import { createHash } from "node:crypto";
import type { AmazonAcquisitionCapability } from "../../../shared/acquisition";

export const DEFAULT_ACQUISITION_CACHE_TTL_SECONDS = 24 * 60 * 60;


export function buildAcquisitionIdempotencyKey(input: {
  workspaceId: number;
  consumerType: string;
  consumerRef: string;
  marketplace: string;
  asin: string;
  capabilities: readonly AmazonAcquisitionCapability[];
  cachePolicy: string;
}): string {
  const canonical = JSON.stringify({
    workspaceId: input.workspaceId,
    consumerType: input.consumerType.trim(),
    consumerRef: input.consumerRef.trim(),
    marketplace: input.marketplace.trim().toUpperCase(),
    asin: input.asin.trim().toUpperCase(),
    capabilities: [...new Set(input.capabilities)].sort(),
    cachePolicy: input.cachePolicy,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function acquisitionAttemptIdempotencyKey(input: {
  baseKey: string;
  existingStatus?: string | null;
  now?: Date;
}): { key: string; reuseExisting: boolean } {
  if (input.existingStatus && ["queued", "running", "review_required"].includes(input.existingStatus)) {
    return { key: input.baseKey, reuseExisting: true };
  }
  if (!input.existingStatus) return { key: input.baseKey, reuseExisting: false };
  const minuteBucket = Math.floor((input.now ?? new Date()).getTime() / 60_000).toString(36);
  return { key: `${input.baseKey}:${minuteBucket}`, reuseExisting: false };
}

export function isAcquisitionCacheFresh(input: {
  capturedAt: Date;
  now: Date;
  cacheTtlSeconds: number;
}): boolean {
  const ageMs = input.now.getTime() - input.capturedAt.getTime();
  return ageMs >= 0 && ageMs <= input.cacheTtlSeconds * 1_000;
}
