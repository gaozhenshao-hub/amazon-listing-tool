export const AMAZON_ACQUISITION_CAPABILITIES = [
  "catalog_basic",
  "image_gallery",
  "aplus",
  "brand_story",
  "listing_content",
  "offers",
  "ratings",
  "availability",
  "rankings",
  "search_rank",
  "product_video",
] as const;
export type AmazonAcquisitionCapability = (typeof AMAZON_ACQUISITION_CAPABILITIES)[number];

export const ACQUISITION_FIELD_STATUSES = [
  "returned",
  "confirmed_absent",
  "not_returned",
  "provider_unsupported",
  "provider_blocked_suspected",
  "invalid",
  "pending_review",
] as const;
export type AcquisitionFieldStatus = (typeof ACQUISITION_FIELD_STATUSES)[number];

export const PROVIDER_FAILURE_CATEGORIES = [
  "provider_not_configured",
  "authentication_failed",
  "permission_denied",
  "rate_limited",
  "request_timeout",
  "budget_exceeded",
  "partial_result",
  "schema_drift",
  "normalization_failed",
  "provider_blocked_suspected",
  "provider_unavailable",
  "unknown",
] as const;
export type ProviderFailureCategory = (typeof PROVIDER_FAILURE_CATEGORIES)[number];

export const ACQUISITION_MARKETPLACES = ["US", "CA", "MX", "UK", "DE", "FR", "IT", "ES", "JP", "AU"] as const;
export type AcquisitionMarketplace = (typeof ACQUISITION_MARKETPLACES)[number];

export const ACQUISITION_ASSET_ROLES = [
  "main",
  "secondary",
  "aplus",
  "brand_story",
  "video",
  "unknown",
] as const;
export type AcquisitionAssetRole = (typeof ACQUISITION_ASSET_ROLES)[number];

export const ACQUISITION_CONSUMER_TYPES = [
  "kb_images",
  "image_workflow",
  "kb_listing",
  "kb_product",
  "project_competitor",
  "conversion_collector",
  "competitor_monitor",
] as const;
export type AcquisitionConsumerType = (typeof ACQUISITION_CONSUMER_TYPES)[number];

export type AcquisitionFieldEvidence = {
  status: AcquisitionFieldStatus;
  sourcePath: string | null;
  valueHash: string | null;
  noteCode: string | null;
};

export type NormalizedAmazonAsset = {
  role: AcquisitionAssetRole;
  positionIndex: number;
  sourcePath: string;
  sourceUrlHash: string;
  providerAssetId: string | null;
  moduleType: string | null;
  moduleClass: string | null;
};

export type NormalizedAmazonSnapshot = {
  asin: string;
  marketplace: AcquisitionMarketplace;
  sourceUrlHash: string;
  title: string | null;
  brand: string | null;
  category: string | null;
  description: string | null;
  bulletPoints: string[];
  price: { value: string; currency: string } | null;
  rating: string | null;
  reviewCount: number | null;
  variantAsins: string[];
  assets: NormalizedAmazonAsset[];
  fieldEvidence: Record<string, AcquisitionFieldEvidence>;
};
