import { z } from "zod";
import {
  ACQUISITION_ASSET_ROLES,
  ACQUISITION_FIELD_STATUSES,
  ACQUISITION_MARKETPLACES,
  AMAZON_ACQUISITION_CAPABILITIES,
  type AcquisitionMarketplace,
  type AmazonAcquisitionCapability,
  type NormalizedAmazonSnapshot,
  type ProviderFailureCategory,
} from "../../../shared/acquisition";

export const AcquisitionMarketplaceSchema = z.enum(ACQUISITION_MARKETPLACES);
export const AcquisitionAssetRoleSchema = z.enum(ACQUISITION_ASSET_ROLES);
export const AcquisitionFieldStatusSchema = z.enum(ACQUISITION_FIELD_STATUSES);
export const AmazonAcquisitionCapabilitySchema = z.enum(AMAZON_ACQUISITION_CAPABILITIES);

export const AcquisitionFieldEvidenceSchema = z.object({
  status: AcquisitionFieldStatusSchema,
  sourcePath: z.string().min(1).nullable(),
  valueHash: z.string().min(1).nullable(),
  noteCode: z.string().min(1).nullable(),
});

export const NormalizedAmazonAssetSchema = z.object({
  role: AcquisitionAssetRoleSchema,
  positionIndex: z.number().int().nonnegative(),
  sourcePath: z.string().min(1),
  sourceUrlHash: z.string().min(32),
  providerAssetId: z.string().min(1).nullable(),
  moduleType: z.string().min(1).nullable(),
  moduleClass: z.string().min(1).nullable(),
});

export const NormalizedAmazonSnapshotSchema: z.ZodType<NormalizedAmazonSnapshot> = z.object({
  asin: z.string().regex(/^[A-Z0-9]{10}$/),
  marketplace: AcquisitionMarketplaceSchema,
  sourceUrlHash: z.string().min(32),
  title: z.string().min(1).nullable(),
  brand: z.string().min(1).nullable(),
  category: z.string().min(1).nullable(),
  description: z.string().min(1).nullable(),
  bulletPoints: z.array(z.string().min(1)),
  price: z.object({ value: z.string().regex(/^\d+(\.\d+)?$/), currency: z.string().length(3) }).nullable(),
  rating: z.string().regex(/^\d+(\.\d+)?$/).nullable(),
  reviewCount: z.number().int().nonnegative().nullable(),
  variantAsins: z.array(z.string().regex(/^[A-Z0-9]{10}$/)),
  assets: z.array(NormalizedAmazonAssetSchema),
  fieldEvidence: z.record(z.string(), AcquisitionFieldEvidenceSchema),
});

export const AmazonAcquisitionRequestSchema = z.object({
  workspaceId: z.number().int().positive(),
  marketplace: AcquisitionMarketplaceSchema,
  asin: z.string().regex(/^[A-Z0-9]{10}$/),
  capabilities: z.array(AmazonAcquisitionCapabilitySchema).min(1),
  maxChargeUsd: z.number().nonnegative(),
  idempotencyKey: z.string().min(16).max(128),
});
export type AmazonAcquisitionRequest = z.infer<typeof AmazonAcquisitionRequestSchema>;

export type ProviderCostEstimate = {
  estimatedMaxUsd: number;
  pricingModel: string;
  cacheEligible: boolean;
};

export type ProviderRawArtifact = {
  contentType: "application/json";
  bytes: Uint8Array;
  contentHash: string;
  providerRunId: string;
};

export type ProviderFetchResult = {
  providerCode: string;
  providerRunId: string;
  status: "succeeded" | "partial" | "failed";
  failureCategory: ProviderFailureCategory | null;
  chargedUsd: number | null;
  rawArtifact: ProviderRawArtifact | null;
};

export interface AmazonAcquisitionProvider {
  readonly providerCode: string;
  readonly supportedMarketplaces: readonly AcquisitionMarketplace[];
  readonly capabilities: readonly AmazonAcquisitionCapability[];
  estimate(request: AmazonAcquisitionRequest): Promise<ProviderCostEstimate>;
  fetch(request: AmazonAcquisitionRequest): Promise<ProviderFetchResult>;
}

export function assertProviderSupportsRequest(
  provider: AmazonAcquisitionProvider,
  request: AmazonAcquisitionRequest,
): void {
  if (!provider.supportedMarketplaces.includes(request.marketplace)) {
    throw new Error(`Provider does not support marketplace: ${request.marketplace}`);
  }
  const supported = new Set(provider.capabilities);
  const missing = request.capabilities.filter((capability) => !supported.has(capability));
  if (missing.length > 0) {
    throw new Error(`Provider does not support capabilities: ${missing.join(",")}`);
  }
}
