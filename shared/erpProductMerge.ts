export type ErpSource = "lingxing" | "saihu";

export type ErpProductIdentity = {
  parentAsin: string;
  storeName?: string | null;
  marketplace?: string | null;
  erpSource?: ErpSource;
};

function normalizeKeyPart(value: string | null | undefined) {
  return (value || "").trim().toUpperCase();
}

/**
 * Generates a stable product identity across ERP sources. Store and marketplace
 * remain part of the key so identical parent ASINs in different storefronts are
 * not accidentally collapsed.
 */
export function getErpProductKey(product: ErpProductIdentity) {
  return [
    normalizeKeyPart(product.parentAsin),
    normalizeKeyPart(product.storeName),
    normalizeKeyPart(product.marketplace),
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
