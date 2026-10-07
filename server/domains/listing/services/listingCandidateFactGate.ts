import { isTemplateOrEmptyFact } from "../../../../shared/listingFactSafety";

export type ReviewedClaimFact = { id: number; attributeKey: string; value: string };

function tokens(text: string) {
  return [...text.matchAll(/(?<![\w])\d[\d,.]*(?:\s*(?:%|rpm|w|v|in|ft|lb|oz|hours?|minutes?))?/gi)]
    .map(([match]) => match.replace(/,/g, "").toLowerCase().replace(/\s+/g, ""));
}

/** Human confirmation is separate from model self-audit; facts must match the edited content. */
export function validateReviewedBulletClaims(input: {
  subtitle: string;
  fullText: string;
  evidenceFactIds: number[];
  approvedFacts: ReviewedClaimFact[];
}): string[] {
  const issues: string[] = [];
  const combined = `${input.subtitle.trim()} ${input.fullText.trim()}`.trim();
  const citations = input.approvedFacts.filter(fact => input.evidenceFactIds.includes(fact.id));
  if (!citations.length || citations.length !== input.evidenceFactIds.length) issues.push("候选必须引用当前已确认且属于本条核心的具体事实");
  if (citations.some(fact => isTemplateOrEmptyFact(fact.value)) || isTemplateOrEmptyFact(combined)) issues.push("示例或空白字段不可作为卖点依据");
  if (/\r|\n|<\/?[a-z][^>]*>|[\u3400-\u9fff]/iu.test(combined)) issues.push("候选仅允许单段无HTML的英文卖点");
  if (!input.subtitle.trim() || !input.fullText.trim()) issues.push("卖点小标题和正文不能留空");
  if (combined.length < 200 || combined.length > 280) issues.push("卖点应符合当前200–280字符内部质量策略");
  if (/\b(?:best|perfect|guaranteed|revolutionary|industry-leading|must-have|game-changing|#1)\b|\$\s*\d/iu.test(combined)) issues.push("禁止绝对化或价格陈述");
  const quoted = citations.map(fact => `${fact.attributeKey}: ${fact.value}`).join(" ").toLowerCase();
  const citedNumbers = new Set(tokens(quoted));
  if (tokens(combined).some(value => !citedNumbers.has(value))) issues.push("数字或规格没有在选定的已确认事实中逐字出现");
  const guardedClaims = /\b(?:titanium|stainless steel|aluminum|aluminium|ceramic|silicone|leather|cotton|bpa.free|fda.approved|ul.certified|usda.certified|ce.certified|warrant(?:y|ies)|dishwasher.safe|waterproof|hypoallergenic|food.grade|non.toxic|heat.resistant|fire.resistant|antibacterial|lifetime|certified)\b/giu;
  if ([...combined.matchAll(guardedClaims)].some(([claim]) => !quoted.includes(claim.toLowerCase()))) issues.push("材料、性能、认证或保修缺少选定的已确认事实依据");
  const comparison = /\b(?:more|less|faster|slower|better|lighter|stronger|longer)\b[^,.;:!?]{0,45}\bthan\b[^,.;:!?]{0,55}|\b(?:compatible with|works with|fits the|fits a|fits an)\b[^,.;:!?]{0,60}/giu;
  if ([...combined.matchAll(comparison)].some(([claim]) => !quoted.includes(claim.toLowerCase().trim()))) issues.push("比较或兼容性表述缺少完整的已确认事实引文");
  return issues;
}

/** A conservative cross-bullet gate: exact title/text, and near-identical openings. */
export function validateCrossBulletDistinctness(input: {
  subtitle: string;
  fullText: string;
  previous: Array<{ subtitle: string; fullText: string }>;
}): string[] {
  const normalized = (value: string) => value.toLowerCase().replace(/\s+/g, " ").trim();
  const title = normalized(input.subtitle);
  const text = normalized(`${input.subtitle} ${input.fullText}`);
  const opening = normalized(input.fullText).split(/[,;.!?]/, 1)[0].split(" ").slice(0, 10).join(" ");
  return input.previous.some(item => title === normalized(item.subtitle)
      || text === normalized(`${item.subtitle} ${item.fullText}`)
      || (opening.split(" ").length >= 7 && opening === normalized(item.fullText).split(/[,;.!?]/, 1)[0].split(" ").slice(0, 10).join(" ")))
    ? ["与同项目其他已确认卖点的标题或开头高度重复，请采用不同的买家理由"] : [];
}
