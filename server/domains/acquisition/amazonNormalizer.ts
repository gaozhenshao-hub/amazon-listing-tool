import { createHash } from "node:crypto";
import type {
  AcquisitionAssetRole,
  AcquisitionFieldEvidence,
  AcquisitionMarketplace,
  NormalizedAmazonSnapshot,
} from "../../../shared/acquisition";
import { NormalizedAmazonSnapshotSchema } from "./contracts";

type JsonObject = Record<string, unknown>;

export type SourceAssetReference = {
  role: AcquisitionAssetRole;
  positionIndex: number;
  sourcePath: string;
  sourceUrl: string;
  sourceUrlHash: string;
  moduleType: string | null;
  moduleClass: string | null;
};

export type NormalizedAmazonResult = {
  snapshot: NormalizedAmazonSnapshot;
  sourceAssets: SourceAssetReference[];
  sourceHash: string;
  completeness: {
    basicFieldsReturned: number;
    mainGalleryCount: number;
    aplusAssetCount: number;
    brandStoryAssetCount: number;
    variantCount: number;
  };
};

function hash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

function asObject(value: unknown): JsonObject | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map(nonEmptyString).filter((item): item is string => Boolean(item))
    : [];
}

function numberOrNull(value: unknown): number | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

function decimalString(value: unknown): string | null {
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? String(parsed) : null;
}

function valueEvidence(value: unknown, sourcePath: string): AcquisitionFieldEvidence {
  const returned = value !== null && value !== undefined && value !== ""
    && (!Array.isArray(value) || value.length > 0);
  return {
    status: returned ? "pending_review" : "not_returned",
    sourcePath: returned ? sourcePath : null,
    valueHash: returned ? hash(JSON.stringify(value)) : null,
    noteCode: returned ? "provider_value_unconfirmed" : "provider_value_not_returned",
  };
}

function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (
      /\.(avif|gif|jpe?g|png|webp)(?:$|\?)/i.test(url.pathname + url.search)
      || url.hostname.endsWith("media-amazon.com")
      || url.hostname.endsWith("ssl-images-amazon.com")
    );
  } catch {
    return false;
  }
}

function collectNestedImages(value: unknown, path: string, output: Array<{ url: string; path: string }>, depth = 0) {
  if (depth > 12 || output.length >= 200) return;
  if (typeof value === "string") {
    if (isImageUrl(value)) output.push({ url: value, path });
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectNestedImages(item, `${path}[${index}]`, output, depth + 1));
    return;
  }
  const object = asObject(value);
  if (!object) return;
  Object.entries(object).forEach(([key, item]) => collectNestedImages(item, `${path}.${key}`, output, depth + 1));
}

function addAssets(input: {
  urls: Array<{ url: string; path: string }>;
  role: AcquisitionAssetRole;
  existing: Set<string>;
  output: SourceAssetReference[];
}) {
  for (const item of input.urls) {
    const sourceUrlHash = hash(item.url);
    if (input.existing.has(sourceUrlHash)) continue;
    input.existing.add(sourceUrlHash);
    const rolePosition = input.output.filter(asset => asset.role === input.role).length;
    input.output.push({
      role: input.role === "secondary" && rolePosition === 0 && !input.output.some(asset => asset.role === "main")
        ? "main"
        : input.role,
      positionIndex: rolePosition,
      sourcePath: item.path,
      sourceUrl: item.url,
      sourceUrlHash,
      moduleType: input.role === "aplus" ? "a_plus" : input.role === "brand_story" ? "brand_story" : null,
      moduleClass: null,
    });
  }
}

function extractPrice(item: JsonObject): { value: string; currency: string } | null {
  const price = asObject(item.price) ?? asObject(item.listPrice);
  if (!price) return null;
  const value = decimalString(price.value ?? price.amount ?? price.price);
  const currency = nonEmptyString(price.currency ?? price.currencyCode);
  return value && currency && currency.length === 3 ? { value, currency: currency.toUpperCase() } : null;
}

export function normalizeApifyAmazonArtifact(input: {
  bytes: Uint8Array;
  expectedAsin: string;
  marketplace: AcquisitionMarketplace;
}): NormalizedAmazonResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(new TextDecoder().decode(input.bytes));
  } catch {
    throw new Error("normalization failed: provider artifact is not JSON");
  }
  if (!Array.isArray(parsed) || parsed.length !== 1) {
    throw new Error("normalization failed: provider artifact must contain exactly one result");
  }
  const item = asObject(parsed[0]);
  if (!item) throw new Error("normalization failed: provider result is not an object");
  const asin = nonEmptyString(item.asin)?.toUpperCase();
  if (asin !== input.expectedAsin.toUpperCase()) {
    throw new Error("normalization failed: provider ASIN does not match request");
  }

  const sourceAssets: SourceAssetReference[] = [];
  const seen = new Set<string>();
  const gallery = stringArray(item.highResolutionImages).map((url, index) => ({
    url,
    path: `$.highResolutionImages[${index}]`,
  }));
  addAssets({ urls: gallery.slice(0, 1), role: "main", existing: seen, output: sourceAssets });
  addAssets({ urls: gallery.slice(1), role: "secondary", existing: seen, output: sourceAssets });

  const aplusImages: Array<{ url: string; path: string }> = [];
  collectNestedImages(item.aPlusContent, "$.aPlusContent", aplusImages);
  addAssets({ urls: aplusImages, role: "aplus", existing: seen, output: sourceAssets });

  const brandStoryImages: Array<{ url: string; path: string }> = [];
  collectNestedImages(item.brandStory, "$.brandStory", brandStoryImages);
  addAssets({ urls: brandStoryImages, role: "brand_story", existing: seen, output: sourceAssets });

  const variantAsins = Array.from(new Set([
    ...stringArray(item.variantAsins),
    ...(Array.isArray(item.variantDetails)
      ? item.variantDetails.map(detail => nonEmptyString(asObject(detail)?.asin)).filter((value): value is string => Boolean(value))
      : []),
  ].map(value => value.toUpperCase()).filter(value => /^[A-Z0-9]{10}$/.test(value))));
  const title = nonEmptyString(item.title);
  const brand = nonEmptyString(item.brand);
  const category = nonEmptyString(item.breadCrumbs ?? item.category);
  const description = nonEmptyString(item.description ?? item.productDescription);
  const bulletPoints = stringArray(item.features ?? item.bulletPoints);
  const price = extractPrice(item);
  const rating = decimalString(item.stars ?? item.rating);
  const reviewCount = numberOrNull(item.reviewsCount ?? item.reviewCount);
  const sourceUrl = nonEmptyString(item.url ?? item.input) ?? `${input.marketplace}:${asin}`;

  const fieldEvidence: Record<string, AcquisitionFieldEvidence> = {
    title: valueEvidence(title, "$.title"),
    brand: valueEvidence(brand, "$.brand"),
    category: valueEvidence(category, item.breadCrumbs ? "$.breadCrumbs" : "$.category"),
    description: valueEvidence(description, item.description ? "$.description" : "$.productDescription"),
    bulletPoints: valueEvidence(bulletPoints, item.features ? "$.features" : "$.bulletPoints"),
    price: valueEvidence(price, "$.price"),
    rating: valueEvidence(rating, item.stars !== undefined ? "$.stars" : "$.rating"),
    reviewCount: valueEvidence(reviewCount, item.reviewsCount !== undefined ? "$.reviewsCount" : "$.reviewCount"),
    imageGallery: valueEvidence(gallery, "$.highResolutionImages"),
    aplus: valueEvidence(item.aPlusContent, "$.aPlusContent"),
    brandStory: valueEvidence(item.brandStory, "$.brandStory"),
    variants: valueEvidence(variantAsins, "$.variantAsins"),
  };

  const snapshot = NormalizedAmazonSnapshotSchema.parse({
    asin,
    marketplace: input.marketplace,
    sourceUrlHash: hash(sourceUrl),
    title,
    brand,
    category,
    description,
    bulletPoints,
    price,
    rating,
    reviewCount,
    variantAsins,
    assets: sourceAssets.map(({ sourceUrl: _sourceUrl, ...asset }) => ({
      ...asset,
      providerAssetId: null,
    })),
    fieldEvidence,
  });
  const sourceHash = hash(JSON.stringify(snapshot));

  return {
    snapshot,
    sourceAssets,
    sourceHash,
    completeness: {
      basicFieldsReturned: [title, brand, category, description, bulletPoints.length ? bulletPoints : null]
        .filter(Boolean).length,
      mainGalleryCount: sourceAssets.filter(asset => asset.role === "main" || asset.role === "secondary").length,
      aplusAssetCount: sourceAssets.filter(asset => asset.role === "aplus").length,
      brandStoryAssetCount: sourceAssets.filter(asset => asset.role === "brand_story").length,
      variantCount: variantAsins.length,
    },
  };
}
