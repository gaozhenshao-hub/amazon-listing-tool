import { isTemplateOrEmptyFact } from "../../../../shared/listingFactSafety";
import type { RawFactSuggestion } from "./listingRawFacts";

const REQUIRES_PROOF = /(?:certif(?:ication|ied)|approved|fda|ul[- ]?(?:listed|certified)|ce[- ]?mark|fsc|bpa[- ]?free|warranty|guarantee|认证|资质|保修|质保|食品级|环保认证)/iu;
const REQUIRES_PERFORMANCE_PROOF = /(?:\d+(?:\.\d+)?\s*%|\b(?:more|less|better|faster|stronger|best|#\s*1|ranked)\s+than\b|优于|领先|比(?:同行|竞品)|第一名)/iu;

export type ProposedFactDecision = {
  source: RawFactSuggestion;
  correctedValue?: string;
  reviewNote?: string;
  proofFileId?: number;
};

/** Safety checks for human review. Proof presence is checked against the same project by the DB service. */
export function validateProposedFactDecision(decision: ProposedFactDecision): string {
  const value = (decision.correctedValue ?? decision.source.value).trim();
  if (!value || value.length > 500 || isTemplateOrEmptyFact(value)) {
    throw new Error("事实值为空或属于模板示例，请先补充真实本品资料");
  }
  if (value !== decision.source.value && (!decision.reviewNote || decision.reviewNote.trim().length < 8)) {
    throw new Error("人工更正必须说明修改理由，不能把AI推测直接确认成产品事实");
  }
  if ((REQUIRES_PROOF.test(`${decision.source.attributeKey} ${value}`) || REQUIRES_PERFORMANCE_PROOF.test(value))
      && (!decision.proofFileId || !Number.isInteger(decision.proofFileId))) {
    throw new Error("认证、保修或比较性能主张必须附本项目可核验的证明文件");
  }
  return value;
}
