/**
 * 将领星不同报表中可能出现的国家显示名规范化为稳定的站点代码。
 * 该函数仅用于负责人映射键；调用方仍必须同时匹配父 ASIN 与店铺，
 * 因而不会以站点别名扩大为跨店归属。
 */
export function normalizeMarketplaceForOperatorMapping(value?: string | null): string {
  const normalized = String(value || "").trim().toUpperCase();
  const aliases: Record<string, string> = {
    "美国": "US", US: "US",
    "加拿大": "CA", CA: "CA",
    "墨西哥": "MX", MX: "MX",
    "英国": "UK", GB: "UK", UK: "UK",
    "德国": "DE", DE: "DE",
    "法国": "FR", FR: "FR",
    "意大利": "IT", IT: "IT",
    "西班牙": "ES", ES: "ES",
    "日本": "JP", JP: "JP",
    "澳大利亚": "AU", AU: "AU",
  };
  return aliases[normalized] || normalized;
}

function normalizeMappingText(value?: string | null): string {
  return String(value || "").trim().toUpperCase();
}

export function buildOperatorProfileKey(parentAsin?: string | null, storeName?: string | null): string {
  return [normalizeMappingText(parentAsin), normalizeMappingText(storeName)].join("|");
}

export function buildOperatorParentKey(parentAsin?: string | null, storeName?: string | null, country?: string | null): string {
  return [
    normalizeMappingText(parentAsin),
    normalizeMappingText(storeName),
    normalizeMarketplaceForOperatorMapping(country),
  ].join("|");
}
