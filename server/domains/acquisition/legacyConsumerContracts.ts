import type { AmazonAcquisitionCapability } from "../../../shared/acquisition";

export const KB_LISTING_ACQUISITION_CAPABILITIES = [
  "catalog_basic",
  "listing_content",
] as const satisfies readonly AmazonAcquisitionCapability[];

export const KB_PRODUCT_ACQUISITION_CAPABILITIES = [
  "catalog_basic",
  "listing_content",
  "ratings",
  "image_gallery",
] as const satisfies readonly AmazonAcquisitionCapability[];

export const PROJECT_COMPETITOR_ACQUISITION_CAPABILITIES = [
  "catalog_basic",
  "listing_content",
  "ratings",
  "image_gallery",
] as const satisfies readonly AmazonAcquisitionCapability[];

export const CONVERSION_COLLECTOR_ACQUISITION_CAPABILITIES = [
  "catalog_basic",
  "listing_content",
  "ratings",
  "image_gallery",
  "aplus",
  "brand_story",
] as const satisfies readonly AmazonAcquisitionCapability[];

export type LegacySnapshotConsumerType =
  | "kb_listing"
  | "kb_product"
  | "project_competitor"
  | "conversion_collector";

export function kbListingConsumerRef(recordId: number): string {
  return `kb-listing:${recordId}`;
}

export function kbProductConsumerRef(recordId: number): string {
  return `kb-product:${recordId}`;
}

export function projectCompetitorConsumerRef(projectId: number, asin: string): string {
  return `project-competitor:${projectId}:${asin.trim().toUpperCase()}`;
}

export function conversionCollectorConsumerRef(asin: string): string {
  return `conversion-collector:US:${asin.trim().toUpperCase()}`;
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`invalid ${label} consumer reference`);
  return parsed;
}

export function parseLegacySnapshotConsumerRef(type: LegacySnapshotConsumerType, ref: string) {
  const parts = ref.trim().split(":");
  if (type === "kb_listing" && parts.length === 2 && parts[0] === "kb-listing") {
    return { type, recordId: positiveInteger(parts[1], "kb listing") } as const;
  }
  if (type === "kb_product" && parts.length === 2 && parts[0] === "kb-product") {
    return { type, recordId: positiveInteger(parts[1], "kb product") } as const;
  }
  if (type === "project_competitor" && parts.length === 3 && parts[0] === "project-competitor") {
    const asin = parts[2].toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error("invalid project competitor ASIN reference");
    return { type, projectId: positiveInteger(parts[1], "project competitor"), asin } as const;
  }
  if (type === "conversion_collector" && parts.length === 3 && parts[0] === "conversion-collector" && parts[1] === "US") {
    const asin = parts[2].toUpperCase();
    if (!/^[A-Z0-9]{10}$/.test(asin)) throw new Error("invalid conversion collector ASIN reference");
    return { type, marketplace: "US" as const, asin } as const;
  }
  throw new Error(`invalid ${type} consumer reference`);
}
