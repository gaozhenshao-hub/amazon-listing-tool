import { normalizeIdentityPart, normalizeMarketplaceCode } from "@shared/marketplaceIdentity";

export type ProductOverviewScope = {
  parentAsin?: string | null;
  storeName?: string | null;
  country?: string | null;
  marketplace?: string | null;
};

export type MonthlyFinancialProfitScope = ProductOverviewScope & {
  yearMonth: string;
  financialProfit: string | number | null;
};

export function hasVerifiedSourceScope(scope: ProductOverviewScope) {
  return Boolean(
    normalizeIdentityPart(scope.parentAsin)
    && normalizeIdentityPart(scope.storeName)
    && normalizeMarketplaceCode(scope.country ?? scope.marketplace),
  );
}

export function isSameSourceProductScope(left: ProductOverviewScope, right: ProductOverviewScope) {
  if (!hasVerifiedSourceScope(left) || !hasVerifiedSourceScope(right)) return false;
  return normalizeIdentityPart(left.parentAsin) === normalizeIdentityPart(right.parentAsin)
    && normalizeIdentityPart(left.storeName) === normalizeIdentityPart(right.storeName)
    && normalizeMarketplaceCode(left.country ?? left.marketplace) === normalizeMarketplaceCode(right.country ?? right.marketplace);
}

export function selectFinancialProfitsForProduct<T extends MonthlyFinancialProfitScope>(entries: T[], product: ProductOverviewScope) {
  if (hasVerifiedSourceScope(product)) return entries.filter((entry) => isSameSourceProductScope(entry, product));
  return entries.filter((entry) => normalizeIdentityPart(entry.parentAsin) === normalizeIdentityPart(product.parentAsin) && !entry.storeName && !entry.country);
}

export function countLegacyFinancialProfitMonths(entries: MonthlyFinancialProfitScope[], product: ProductOverviewScope) {
  return entries.filter((entry) => normalizeIdentityPart(entry.parentAsin) === normalizeIdentityPart(product.parentAsin) && !entry.storeName && !entry.country).length;
}

/**
 * The ERP query is only needed to supply cards when authoritative MCP weeks
 * are absent. Keep visible MCP cards responsive, but never turn a pending ERP
 * fallback into a misleading empty overview.
 */
export function shouldWaitForProductOverviewFallback(primaryCount: number, fallbackLoading: boolean) {
  return primaryCount === 0 && fallbackLoading;
}
