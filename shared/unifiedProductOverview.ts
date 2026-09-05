import { mergeProductWeeksPreferPrimary } from "./erpProductMerge";

export type UnifiedOverviewProduct = {
  parentAsin: string;
  storeName?: string | null;
  marketplace?: string | null;
  weeks: Array<{ weekStartDate: string }>;
};

export type UnifiedOverviewSource = "mcp_parent_weekly" | "erp_history";

export function getUnifiedProductIdentity(product: Pick<UnifiedOverviewProduct, "parentAsin" | "storeName" | "marketplace">) {
  return [product.parentAsin, product.storeName || "", product.marketplace || ""]
    .map(value => value.trim().toUpperCase())
    .join("|");
}

/**
 * Produces one card per parent ASIN/store/site. MCP parent-week facts are primary
 * for the same natural week; ERP is preserved only as historical fallback.
 */
export function buildUnifiedProductOverview<T extends UnifiedOverviewProduct>(mcpProducts: T[], erpProducts: T[]) {
  const mcpKeys = new Set(mcpProducts.map(getUnifiedProductIdentity));
  const erpKeys = new Set(erpProducts.map(getUnifiedProductIdentity));
  return mergeProductWeeksPreferPrimary(mcpProducts, erpProducts).map(product => {
    const identity = getUnifiedProductIdentity(product);
    return {
      ...product,
      weeklySource: mcpKeys.has(identity) ? "mcp_parent_weekly" as UnifiedOverviewSource : "erp_history" as UnifiedOverviewSource,
      hasErpHistory: erpKeys.has(identity),
    };
  });
}
