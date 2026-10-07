/** Single-bullet input policy. An example in a template is not an observed product fact.
 * This module is pure so the page can explain exclusions while the server remains authoritative. */
export type ListingSellingPoint = {
  index: number;
  theme: string;
  themeZh?: string;
  description: string;
  descriptionZh?: string;
  fabeDirection?: { feature: string; advantage: string; benefit: string; evidence: string };
  targetKeywords?: string[];
  addressesGap?: string;
};

const EMPTY_VALUE = /^(?:[\s\-—–_./…·*]+|\[\s*\]|【\s*】|\(\s*\)|\{\s*\}|无|暂无|没有|未知|不适用|未提供|未填写|未填|待填写|待填|待补充|待确认|待定|需补充|请填写|请补充|n\/?a|none|null|undefined|unknown|tbd|todo|pending)$/iu;
const TEMPLATE_BRACKET = /[\[【(（{]\s*(?:如\s*[:：]|例如\s*[:：]?|比如\s*[:：]?|示例(?:值)?\s*[:：]?|样例\s*[:：]?|e\.?g\.?\s*[:：]?|example(?: value)?\s*[:：]?|待填\S*|未填\S*|请填\S*)[^\]】)）}]*[\]】)）}]/iu;
const EXAMPLE_LINE = /(?:^|[:：;；,，(（\[【])\s*(?:如|例如|比如|示例(?:值)?|样例|填写示例|参考示例|e\.?g\.?|for example|example(?: value)?|sample value)(?:\s*[:：,，]\s*\S|\s+\p{L}|\s*\d)/iu;
const EMPTY_FRAGMENT = /\[\s*\]|【\s*】|\(\s*\)|（\s*）|\{\s*\}|<\s*(?:value|填入|待填)\s*>/iu;
const TRAILING_EXAMPLE = /^[^:：]{1,80}[:：]\s*.+?\s*(?:\(\s*(?:example|sample|e\.?g\.?|例如|示例)\s*\)|\s+(?:sample|example|示例))\s*$/iu;

export function isTemplateOrEmptyFact(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== "string") return false;
  const text = value.normalize("NFKC").replace(/[\u200b-\u200d\ufeff]/gu, "").trim();
  if (!text || EMPTY_VALUE.test(text)) return true;
  return TEMPLATE_BRACKET.test(text) || EXAMPLE_LINE.test(text) || EMPTY_FRAGMENT.test(text) || TRAILING_EXAMPLE.test(text)
    || /(?:^|[:：;,，；])\s*(?:请|待)(?:填写|补充|确认)(?:后确认)?(?:\s|$)/u.test(text);
}

export function sanitizeSelectedSellingPoint<T extends ListingSellingPoint>(source: T) {
  const excludedFields: string[] = [];
  const clean = (value: string | undefined, path: string) => {
    if (!value || !value.trim()) return "";
    if (isTemplateOrEmptyFact(value)) {
      excludedFields.push(path);
      return "";
    }
    return value.trim();
  };
  const fabe = source.fabeDirection;
  const point = {
    ...source,
    theme: clean(source.theme, "theme"),
    themeZh: clean(source.themeZh, "themeZh"),
    description: clean(source.description, "description"),
    descriptionZh: clean(source.descriptionZh, "descriptionZh"),
    addressesGap: clean(source.addressesGap, "addressesGap"),
    fabeDirection: fabe ? {
      feature: clean(fabe.feature, "fabeDirection.feature"),
      advantage: clean(fabe.advantage, "fabeDirection.advantage"),
      benefit: clean(fabe.benefit, "fabeDirection.benefit"),
      evidence: clean(fabe.evidence, "fabeDirection.evidence"),
    } : undefined,
    targetKeywords: (source.targetKeywords || []).filter((keyword, index) => {
      if (keyword.trim() && !isTemplateOrEmptyFact(keyword)) return true;
      if (keyword.trim()) excludedFields.push(`targetKeywords.${index}`);
      return false;
    }),
  };
  // Theme is a writing angle, not a product fact. A generic theme alone must not
  // cause the model to invent a specification or try to fill the character target.
  const hasFact = Boolean(point.description || point.fabeDirection?.feature || point.fabeDirection?.evidence);
  return { point, excludedFields, hasFact, canGenerate: Boolean(point.theme && hasFact) };
}

/** Cleans a displayed analysis tree without editing stored uploads. Never leave a
 * specification row that has a label but whose value was a template example. */
export function sanitizeListingFactTree(source: unknown, root = "attributes") {
  const excludedFields: string[] = [];
  const walk = (value: unknown, path: string): unknown => {
    if (typeof value === "string") {
      if (isTemplateOrEmptyFact(value)) {
        if (value.trim()) excludedFields.push(path);
        return undefined;
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((entry, index) => walk(entry, `${path}.${index}`)).filter((entry) => entry !== undefined);
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Object.hasOwn(record, "value") && isTemplateOrEmptyFact(record.value)) {
        excludedFields.push(`${path}.value`);
        return undefined;
      }
      const entries = Object.entries(record).map(([key, entry]) => [key, walk(entry, `${path}.${key}`)] as const)
        .filter(([, entry]) => entry !== undefined);
      return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return value === null ? undefined : value;
  };
  return { value: walk(source, root), excludedFields };
}

/** Values extracted from explicit example brackets in the user's original upload.
 * A downstream AI analysis may have removed the example cue, so the raw sheet
 * remains the higher-priority source. This is a deny list, NOT approved facts. */
export function rawAttributeExampleValues(rawContent: string): string[] {
  const examples = new Set<string>();
  for (const line of rawContent.split(/\r?\n/u)) {
    const normalized = line.normalize("NFKC");
    const trailing = normalized.match(/^[^:：]{1,80}[:：]\s*(.+?)\s*(?:\(\s*(?:example|sample|e\.?g\.?|例如|示例)\s*\)|\s+(?:sample|example|示例))\s*$/iu);
    if (trailing) {
      const exampleValue = trailing[1].trim();
      if (exampleValue.length >= 2 && exampleValue.length <= 100) examples.add(exampleValue.toLowerCase());
    }
    if (!isTemplateOrEmptyFact(line) && !trailing) continue;
    for (const match of normalized.matchAll(/[\[(]\s*(?:如|例如|比如|示例(?:值)?|样例|e\.?g\.?|example(?: value)?|sample value)\s*[:：]?\s*([^\])]+)[\])]/giu)) {
      const value = match[1].trim();
      if (value.length >= 2 && value.length <= 100) examples.add(value.toLowerCase());
    }
    const inline = line.normalize("NFKC").match(/(?:^|[:：])\s*(?:如|例如|比如|示例(?:值)?|e\.?g\.?|example)\s*[:：]\s*([^;；，,]+)$/iu);
    if (inline && inline[1].trim().length >= 2 && inline[1].trim().length <= 100)
      examples.add(inline[1].trim().toLowerCase());
  }
  return [...examples];
}

export function containsRawExampleValue(value: unknown, examples: readonly string[]): boolean {
  if (typeof value !== "string" && typeof value !== "number") return false;
  const normalized = String(value).normalize("NFKC").toLowerCase().replace(/\s+/gu, " ");
  return examples.some((example) => {
    // An AI extractor may convert "1200W" into JSON number 1200 or string
    // "1200". Without an observed unit this is still derived from an example.
    const bareNumber = normalized.match(/^\d+(?:[.,]\d+)?$/u);
    const exampleNumber = example.match(/^(\d+(?:[.,]\d+)?)(?:\s*[a-z%°]+)?$/u);
    if (bareNumber && exampleNumber && bareNumber[0].replace(/,/gu, "") === exampleNumber[1].replace(/,/gu, "")) return true;
    let start = normalized.indexOf(example);
    while (start >= 0) {
      const before = normalized[start - 1] || "";
      const after = normalized[start + example.length] || "";
      if (!/[a-z0-9]/u.test(before) && !/[a-z0-9]/u.test(after)) return true;
      start = normalized.indexOf(example, start + 1);
    }
    return false;
  });
}

export function selectedPointContainsRawExamples(point: ListingSellingPoint, examples: readonly string[]): boolean {
  return [point.theme, point.themeZh, point.description, point.descriptionZh, point.addressesGap,
    ...Object.values(point.fabeDirection || {}), ...(point.targetKeywords || [])]
    .some((value) => containsRawExampleValue(value, examples));
}

export function excludeRawExamplesFromFactTree(source: unknown, examples: readonly string[], root = "attributes") {
  const excludedFields: string[] = [];
  const walk = (value: unknown, path: string): unknown => {
    if (typeof value === "string" || typeof value === "number") {
      if (containsRawExampleValue(value, examples)) { excludedFields.push(path); return undefined; }
      return value;
    }
    if (Array.isArray(value)) return value.map((entry, index) => walk(entry, `${path}.${index}`)).filter((entry) => entry !== undefined);
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      if (Object.hasOwn(record, "value") && containsRawExampleValue(record.value, examples)) {
        excludedFields.push(`${path}.value`); return undefined;
      }
      const entries = Object.entries(record).map(([key, entry]) => [key, walk(entry, `${path}.${key}`)] as const)
        .filter(([, entry]) => entry !== undefined);
      return entries.length ? Object.fromEntries(entries) : undefined;
    }
    return value;
  };
  return { value: walk(source, root), excludedFields };
}

export function formatSingleBulletIdentity(project: {
  productName?: string | null; name?: string | null; brand?: string | null;
  category?: string | null; targetMarket?: string | null;
}) {
  return ([
    ["Product", project.productName || project.name],
    ["Brand", project.brand],
    ["Category", project.category],
    ["Target Market", project.targetMarket],
  ] as const).filter(([, value]) => value && !isTemplateOrEmptyFact(value))
    .map(([label, value]) => `${label}: ${value}`).join("\n");
}

export function sanitizeListingProjectFacts<T extends {
  productName?: string | null; name?: string | null; brand?: string | null;
  category?: string | null; targetMarket?: string | null;
  productFeatures?: string | null; productSpecs?: string | null;
}>(project: T) {
  const excludedFields: string[] = [];
  const clean = (value: string | null | undefined, path: string) => {
    if (!value) return value;
    if (isTemplateOrEmptyFact(value)) { excludedFields.push(path); return null; }
    return value;
  };
  const cleanStructured = (value: string | null | undefined, path: string) => {
    if (!value) return value;
    try {
      const result = sanitizeListingFactTree(JSON.parse(value), path);
      excludedFields.push(...result.excludedFields);
      return result.value ? JSON.stringify(result.value) : null;
    } catch {
      return clean(value, path);
    }
  };
  return { project: { ...project,
    productName: clean(project.productName, "productName"),
    name: clean(project.name, "name"),
    brand: clean(project.brand, "brand"),
    category: clean(project.category, "category"),
    targetMarket: clean(project.targetMarket, "targetMarket"),
    productFeatures: cleanStructured(project.productFeatures, "productFeatures"),
    productSpecs: cleanStructured(project.productSpecs, "productSpecs"),
  }, excludedFields };
}

export function containsTemplateFactInFreeText(value: string): boolean {
  return value.split(/\r?\n/u).some((line) => {
    if (isTemplateOrEmptyFact(line)) return true;
    const separator = Math.max(line.indexOf(":"), line.indexOf("："));
    if (separator < 0) return false;
    const label = line.slice(0, separator).trim();
    const fieldValue = line.slice(separator + 1).trim();
    // A colon ending a normal English headline is punctuation, not a missing
    // specification; an explicit product-attribute label needs a value.
    if (!fieldValue) return /^(?:power|wattage|capacity|size|weight|material|certification|功率|容量|尺寸|重量|材质|认证)$/iu.test(label);
    return isTemplateOrEmptyFact(fieldValue);
  });
}
