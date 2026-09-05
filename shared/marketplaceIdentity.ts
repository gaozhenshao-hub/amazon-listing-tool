const aliases: Record<string, string> = {
  US: "US",
  "美国": "US",
  "美国站": "US",
  "亚马逊美国站": "US",
  "AMAZON.COM": "US",
  CA: "CA",
  "加拿大": "CA",
  "加拿大站": "CA",
  UK: "UK",
  GB: "UK",
  "英国": "UK",
  "英国站": "UK",
  DE: "DE",
  "德国": "DE",
  "德国站": "DE",
  FR: "FR",
  "法国": "FR",
  "法国站": "FR",
  IT: "IT",
  "意大利": "IT",
  "意大利站": "IT",
  ES: "ES",
  "西班牙": "ES",
  "西班牙站": "ES",
  JP: "JP",
  "日本": "JP",
  "日本站": "JP",
  AU: "AU",
  "澳大利亚": "AU",
  "澳洲": "AU",
  "澳大利亚站": "AU",
  MX: "MX",
  "墨西哥": "MX",
  "墨西哥站": "MX",
  BR: "BR",
  "巴西": "BR",
  "巴西站": "BR",
  AE: "AE",
  "阿联酋": "AE",
  "阿联酋站": "AE",
  SA: "SA",
  "沙特": "SA",
  "沙特站": "SA",
  SG: "SG",
  "新加坡": "SG",
  "新加坡站": "SG",
};

/**
 * Converts display labels and marketplace aliases into a stable business code.
 * Unknown values remain stable rather than being silently discarded.
 */
export function normalizeMarketplaceCode(value: string | null | undefined) {
  const normalized = String(value || "").trim().toUpperCase();
  return aliases[normalized] || normalized;
}

export function normalizeIdentityPart(value: string | null | undefined) {
  return String(value || "").trim().toUpperCase();
}

