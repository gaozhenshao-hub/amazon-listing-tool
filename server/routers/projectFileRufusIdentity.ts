export type RufusProductIdentity = {
  brand: string;
  productName: string;
  asin: string;
  category: string;
};

type RufusAnalysisResult = Record<string, unknown> & {
  coreSpecs?: Array<{ attribute?: unknown; value?: unknown }>;
  productIdentity?: Partial<RufusProductIdentity>;
};

const IDENTITY_LABELS: Record<keyof RufusProductIdentity, RegExp[]> = {
  brand: [/^(?:品牌名称|品牌|brand(?:\s*name)?)$/i],
  productName: [/^(?:产品名称|品名|product\s*name|product)$/i],
  asin: [/^asin$/i],
  category: [/^(?:产品类目|类目|category)$/i],
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function getRawAttributeValue(rawContent: string, key: keyof RufusProductIdentity): string {
  for (const line of rawContent.split(/\r?\n/)) {
    const match = line.match(/^\s*([^:：]+?)\s*[:：]\s*(.*?)\s*$/);
    if (!match) continue;
    if (IDENTITY_LABELS[key].some((label) => label.test(match[1].trim()))) {
      return match[2].trim();
    }
  }
  return "";
}

function getCoreSpecValue(result: RufusAnalysisResult, key: keyof RufusProductIdentity): string {
  const spec = result.coreSpecs?.find((item) => {
    const attribute = normalizeText(item.attribute);
    return IDENTITY_LABELS[key].some((label) => label.test(attribute));
  });
  return normalizeText(spec?.value);
}

function firstValue(...values: unknown[]): string {
  return values.map(normalizeText).find(Boolean) || "";
}

export function normalizeRufusProductIdentity(rawContent: string, result: unknown): unknown {
  if (!result || typeof result !== "object" || Array.isArray(result)) return result;

  const analysis = result as RufusAnalysisResult;
  const productIdentity: RufusProductIdentity = {
    brand: firstValue(getRawAttributeValue(rawContent, "brand"), analysis.productIdentity?.brand, getCoreSpecValue(analysis, "brand")),
    productName: firstValue(getRawAttributeValue(rawContent, "productName"), analysis.productIdentity?.productName, getCoreSpecValue(analysis, "productName")),
    asin: firstValue(getRawAttributeValue(rawContent, "asin"), analysis.productIdentity?.asin, getCoreSpecValue(analysis, "asin")),
    category: firstValue(getRawAttributeValue(rawContent, "category"), analysis.productIdentity?.category, getCoreSpecValue(analysis, "category")),
  };

  return { ...analysis, productIdentity };
}
