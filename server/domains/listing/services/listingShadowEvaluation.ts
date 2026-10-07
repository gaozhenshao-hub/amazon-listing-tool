import { createHash } from "node:crypto";

export type ShadowFact = { label: string; value: string; quote: string; line: number };
export type ShadowBullet = { subtitle: string; fullText: string };

const ALLOWED_FACT_LABEL = /^(?:尺寸|重量|颜色|材质|容量|功率|电压|主体材质|表面处理|制造工艺|使用温度范围|防水等级|电池容量|充电时间|续航时间|噪音水平|包装内容|包装尺寸|包装重量|适用场景|适用人群|适用季节|功能|结构|安全特性)$/u;
const FORBIDDEN_FACT_LABEL = /(?:ASIN|SKU|链接|URL|图片|竞品|评论|搜索词|关键词|价格|售价|品牌|排名|折扣|联系人|姓名|邮箱|店铺|产品名称|类目|认证|保修|保证)/iu;
const PLACEHOLDER = /^(?:无|暂无|未填写|未填|待填写|待补充|未知|不适用|未提供|na|n\/a|none|null|[-—/]|不涉及|没有|待定|pending|tbd|[一二三四五六七八九十]?个?卖点)$/iu;
const TEMPLATE_PLACEHOLDER = /\[\s*\]|\[\s*(?:如|例如|e\.?g\.?|example|填入|待填)[^\]]*\]/iu;
export const SHADOW_SENSITIVE_VALUE = /(?:https?:\/\/|mailto:|www\.|\b[a-z0-9.-]+\.(?:com|net|org|cn)(?:\/|\b)|\bB0[A-Z0-9]{8}\b|@[a-z0-9.-]+\.[a-z]{2,}|\b1[3-9]\d{9}\b|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b|\bsk_(?:live|test)_[A-Za-z0-9_]+\b|\bBearer\s+[A-Za-z0-9_.-]{8,}|\b(?:sku|asin|phone|mobile|contact|email|address|api[_ -]?key|token|secret|password)\b\s*[:：=#-]?\s*\S+|(?:\$|USD\s*|¥|￥)\s*\d+(?:[.,]\d+)?|姓名|地址|电话|手机号|联系人|价格|竞品|销量|排名)/iu;

/** Only exact values in a user's original uploaded attribute sheet can be shadow facts.
 * Completed AI extraction is NOT a confirmed fact and is never read here. */
export function extractShadowFacts(rawContent: string): ShadowFact[] {
  return rawContent.split(/\r?\n/).flatMap((source, index) => {
    const line = source.trim();
    const boundary = line.search(/[：:]/u);
    if (boundary <= 0) return [];
    const label = line.slice(0, boundary).trim();
    const value = line.slice(boundary + 1).trim();
    if (!ALLOWED_FACT_LABEL.test(label) || FORBIDDEN_FACT_LABEL.test(label)
        || !value || value.length > 180 || PLACEHOLDER.test(value) || TEMPLATE_PLACEHOLDER.test(value)
        || SHADOW_SENSITIVE_VALUE.test(value)) return [];
    const quote = `${label}：${value}`;
    return [{ label, value, quote, line: index + 1 }];
  });
}

/** Index-based matching is explicitly a shadow comparison, not semantic proof that an
 * old bullet corresponds to a given uploaded attribute. Failed coverage stays skipped. */
export function selectShadowFacts(facts: ShadowFact[], bulletIndex: number): ShadowFact[] {
  if (facts.length <= bulletIndex) return [];
  const primary = facts[bulletIndex];
  const supportive = facts.find((fact) => fact.label !== primary.label && (
    fact.label.includes(primary.label) || primary.label.includes(fact.label)
  ));
  return supportive && supportive.quote !== primary.quote ? [primary, supportive] : [primary];
}

export function parseOldShadowBullets(value: unknown): string[] {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string" && !!item.trim()).slice(0, 5) : [];
  } catch { return []; }
}

export function redactShadowText(value: string): string {
  return value
    .replace(/\bB0[A-Z0-9]{8}\b/giu, "[product-id-redacted]")
    .replace(/https?:\/\/\S+|www\.\S+/giu, "[url-redacted]")
    .replace(/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/gu, "[credential-redacted]")
    .replace(/\bsk_(?:live|test)_[A-Za-z0-9_]+\b/giu, "[credential-redacted]")
    .replace(/\bBearer\s+[A-Za-z0-9_.-]{8,}/giu, "[credential-redacted]")
    .replace(/\b(?:api[_ -]?key|token|secret|password)\s*[:=]\s*\S+/giu, "[credential-redacted]")
    .replace(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/giu, "[email-redacted]")
    .replace(/(?:\$|USD\s*|¥|￥)\s*\d+(?:[.,]\d+)?/giu, "[price-redacted]");
}

export function buildShadowBulletInput(index: number, facts: ShadowFact[]) {
  if (facts.length === 0) throw new Error("没有可追溯的原始上传事实");
  return {
    index: index + 1,
    theme: facts[0].label,
    description: facts.map((fact) => fact.quote).join("；"),
    fabeDirection: { feature: facts[0].quote, advantage: "", benefit: "", evidence: facts.map((fact) => fact.quote).join("；") },
    targetKeywords: [] as string[],
  };
}

export function shadowSourceHash(rawContent: string, oldBullet: string): string {
  return createHash("sha256").update(rawContent).update("\u0000").update(oldBullet).digest("hex");
}
