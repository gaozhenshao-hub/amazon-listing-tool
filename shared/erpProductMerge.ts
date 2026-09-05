import { normalizeIdentityPart, normalizeMarketplaceCode } from "./marketplaceIdentity";

export type ErpSource = "lingxing" | "saihu";

export type ErpProductIdentity = {
  parentAsin: string;
  storeName?: string | null;
  marketplace?: string | null;
  erpSource?: ErpSource;
};

/**
 * Generates a stable product identity across ERP sources. Store and marketplace
 * remain part of the key so identical parent ASINs in different storefronts are
 * not accidentally collapsed.
 */
export function getErpProductKey(product: ErpProductIdentity) {
  return [
    normalizeIdentityPart(product.parentAsin),
    normalizeIdentityPart(product.storeName),
    normalizeMarketplaceCode(product.marketplace),
  ].join("|");
}

/**
 * Combines normalized Lingxing and Saihu product rows into one ERP list.
 * Inputs are evaluated from left to right, so callers can put the richer
 * Lingxing daily aggregation first and retain it when both ERPs contain the
 * same parent ASIN/store/marketplace record.
 */
export function mergeErpProducts<T extends ErpProductIdentity>(
  sources: Array<{ source: ErpSource; products: T[] }>,
): Array<T & { erpSource: ErpSource }> {
  const productsByKey = new Map<string, T & { erpSource: ErpSource }>();

  for (const { source, products } of sources) {
    for (const product of products) {
      const key = getErpProductKey(product);
      if (!key.replaceAll("|", "")) continue;
      if (!productsByKey.has(key)) {
        productsByKey.set(key, { ...product, erpSource: product.erpSource || source });
      }
    }
  }

  return Array.from(productsByKey.values());
}

type WeeklyProduct = ErpProductIdentity & {
  weeks: Array<{ weekStartDate: string }>;
  monthlySummaries?: unknown[];
};

/**
 * Merges the richer daily-derived parent-ASIN weeks with older imported weekly data.
 * A daily-derived week always wins for the same product identity and natural-week
 * start date; older weekly rows are preserved only where no daily snapshot exists.
 */
export function mergeProductWeeksPreferPrimary<T extends WeeklyProduct>(
  primaryProducts: T[],
  fallbackProducts: T[],
): T[] {
  const fallbackByKey = new Map(fallbackProducts.map(product => [getErpProductKey(product), product]));
  const merged: T[] = [];

  for (const primary of primaryProducts) {
    const key = getErpProductKey(primary);
    const fallback = fallbackByKey.get(key);
    if (!fallback) {
      merged.push(primary);
      continue;
    }
    const weeks = new Map<string, T["weeks"][number]>();
    for (const week of fallback.weeks) weeks.set(week.weekStartDate, week);
    for (const week of primary.weeks) weeks.set(week.weekStartDate, week);
    merged.push({
      ...fallback,
      ...primary,
      weeks: Array.from(weeks.values()).sort((a, b) => b.weekStartDate.localeCompare(a.weekStartDate)),
      monthlySummaries: primary.monthlySummaries?.length ? primary.monthlySummaries : fallback.monthlySummaries,
    });
    fallbackByKey.delete(key);
  }

  return [...merged, ...fallbackByKey.values()];
}
