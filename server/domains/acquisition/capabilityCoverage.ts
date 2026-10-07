import type { AcquisitionAssetCandidate } from "../../../drizzle/schema/acquisition";
import type {
  AcquisitionFieldStatus,
  AmazonAcquisitionCapability,
} from "../../../shared/acquisition";
export const IMAGE_ACQUISITION_CAPABILITIES = [
  "image_gallery",
  "aplus",
  "brand_story",
] as const;

type ImageAcquisitionCapability = (typeof IMAGE_ACQUISITION_CAPABILITIES)[number];

export const CAPABILITY_COVERAGE_STATES = [
  "not_requested",
  "returned",
  "confirmed_absent",
  "not_returned",
  "provider_unsupported",
  "download_failed",
  "pending_supplement",
  "manually_supplemented",
] as const;
export type CapabilityCoverageState = (typeof CAPABILITY_COVERAGE_STATES)[number];

type FieldEvidence = {
  status?: unknown;
};

type ConfirmedSnapshotCoverageInput = {
  fieldStatuses: unknown;
  confirmedAssetIds: unknown;
  assets: readonly AcquisitionAssetCandidate[];
};

export type CapabilityCoverage = {
  capability: AmazonAcquisitionCapability;
  state: CapabilityCoverageState;
  sourceFieldStatus: AcquisitionFieldStatus | "confirmed" | null;
  safelyStoredAssetIds: number[];
  failedAssetIds: number[];
};

const capabilityFields: Partial<Record<AmazonAcquisitionCapability, readonly string[]>> = {
  catalog_basic: ["title"],
  image_gallery: ["imageGallery"],
  aplus: ["aplus"],
  brand_story: ["brandStory"],
  listing_content: ["description", "bulletPoints"],
  offers: ["price"],
  ratings: ["rating", "reviewCount"],
  availability: ["availability"],
  rankings: ["rankings"],
  search_rank: ["searchRank"],
  product_video: ["productVideo"],
};

const assetRoles: Record<ImageAcquisitionCapability, readonly AcquisitionAssetCandidate["role"][]> = {
  image_gallery: ["main", "secondary"],
  aplus: ["aplus"],
  brand_story: ["brand_story"],
};

function fieldEvidenceMap(value: unknown): Record<string, FieldEvidence> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, FieldEvidence>
    : {};
}

function confirmedAssetIdSet(value: unknown): Set<number> {
  if (!Array.isArray(value)) return new Set();
  return new Set(value.filter((id): id is number => Number.isInteger(id) && id > 0));
}

function fieldStatus(value: unknown): CapabilityCoverage["sourceFieldStatus"] {
  return typeof value === "string" ? value as CapabilityCoverage["sourceFieldStatus"] : null;
}

function isReturned(status: CapabilityCoverage["sourceFieldStatus"]) {
  // "confirmed" is the existing direct-ingestion projection state. New rows may
  // retain the shared "returned" state, so both are valid saved evidence.
  return status === "confirmed" || status === "returned" || status === "pending_review";
}

function imageCapabilityOf(capability: AmazonAcquisitionCapability): capability is ImageAcquisitionCapability {
  return (IMAGE_ACQUISITION_CAPABILITIES as readonly string[]).includes(capability);
}

function stateForUnreturnedField(status: CapabilityCoverage["sourceFieldStatus"]): CapabilityCoverageState {
  if (status === "provider_unsupported") return "provider_unsupported";
  if (status === "confirmed_absent") return "confirmed_absent";
  return "not_returned";
}

function combineFieldStatuses(statuses: CapabilityCoverage["sourceFieldStatus"][]): CapabilityCoverage["sourceFieldStatus"] {
  return statuses.find(status => isReturned(status))
    ?? statuses.find(status => status === "provider_unsupported")
    ?? statuses.find(status => status === "confirmed_absent")
    ?? statuses.find(status => status !== null)
    ?? null;
}

function fieldCoverage(capability: AmazonAcquisitionCapability, evidence: Record<string, FieldEvidence>): CapabilityCoverage {
  const fields = capabilityFields[capability] ?? [];
  const statuses = fields.map(field => fieldStatus(evidence[field]?.status));
  const sourceFieldStatus = combineFieldStatuses(statuses);
  const allReturned = statuses.length > 0 && statuses.every(isReturned);
  return {
    capability,
    state: allReturned ? "returned" : stateForUnreturnedField(sourceFieldStatus),
    sourceFieldStatus,
    safelyStoredAssetIds: [],
    failedAssetIds: [],
  };
}

function imageCoverage(input: {
  capability: ImageAcquisitionCapability;
  evidence: Record<string, FieldEvidence>;
  confirmedAssetIds: Set<number>;
  assets: readonly AcquisitionAssetCandidate[];
}): CapabilityCoverage {
  const [field] = capabilityFields[input.capability] ?? [];
  const sourceFieldStatus = fieldStatus(input.evidence[field]?.status);
  const expectedRoles = assetRoles[input.capability];
  const roleAssets = input.assets.filter(asset => expectedRoles.includes(asset.role));
  const safelyStoredAssetIds = roleAssets
    .filter(asset => input.confirmedAssetIds.has(asset.id) && Boolean(asset.storageKey))
    .map(asset => asset.id);
  const failedAssetIds = roleAssets
    .filter(asset => !asset.storageKey && ["download_failed", "invalid"].includes(asset.fieldStatus))
    .map(asset => asset.id);

  if (!isReturned(sourceFieldStatus)) {
    return {
      capability: input.capability,
      state: stateForUnreturnedField(sourceFieldStatus),
      sourceFieldStatus,
      safelyStoredAssetIds,
      failedAssetIds,
    };
  }
  if (safelyStoredAssetIds.length === 0) {
    return {
      capability: input.capability,
      state: failedAssetIds.length > 0 ? "download_failed" : "not_returned",
      sourceFieldStatus,
      safelyStoredAssetIds,
      failedAssetIds,
    };
  }
  if (failedAssetIds.length > 0) {
    return {
      capability: input.capability,
      state: "download_failed",
      sourceFieldStatus,
      safelyStoredAssetIds,
      failedAssetIds,
    };
  }
  return {
    capability: input.capability,
    state: "returned",
    sourceFieldStatus,
    safelyStoredAssetIds,
    failedAssetIds,
  };
}

/**
 * Derives reusable capabilities from persisted provider evidence and safe asset
 * receipts. It is read-only: failed or unrequested capabilities never alter a
 * snapshot, its existing gallery assets, or its consumer links.
 */
export function assessConfirmedSnapshotCoverage(
  input: ConfirmedSnapshotCoverageInput,
  requestedCapabilities: readonly AmazonAcquisitionCapability[],
): CapabilityCoverage[] {
  const evidence = fieldEvidenceMap(input.fieldStatuses);
  const confirmedAssetIds = confirmedAssetIdSet(input.confirmedAssetIds);
  return requestedCapabilities.map(capability => imageCapabilityOf(capability)
    ? imageCoverage({ capability, evidence, confirmedAssetIds, assets: input.assets })
    : fieldCoverage(capability, evidence));
}

export function isCapabilitySubsetCovered(coverage: readonly CapabilityCoverage[]) {
  return coverage.every(item => item.state === "returned" || item.state === "manually_supplemented");
}

export function uncoveredCapabilitySummary(coverage: readonly CapabilityCoverage[]) {
  return coverage
    .filter(item => item.state !== "returned" && item.state !== "manually_supplemented")
    .map(item => `${item.capability}:${item.state}`);
}
