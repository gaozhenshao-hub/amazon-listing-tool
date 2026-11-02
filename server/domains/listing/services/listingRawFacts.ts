import { createHash } from "node:crypto";
import { containsTemplateFactInFreeText, isTemplateOrEmptyFact } from "../../../../shared/listingFactSafety";

/** A suggestion to the reviewer, never a confirmed claim. The original file remains authoritative. */
export type RawFactSuggestion = {
  attributeKey: string;
  value: string;
  sourceLine: number;
  sourceLineHash: string;
};

const INTERNAL_LABEL = /(?:asin|sku|access.?token|api.?key|password|secret|密钥|账号|订单|竞品|对手)/iu;
const DIRECT_URL = /(?:https?:\/\/|www\.|[\w.-]+\.(?:com|cn|net|org)\/)/iu;
const FIELD = /^\s*([^\t:：=]{1,80})\s*(?:\t|:|：|=)\s*(.*?)\s*$/u;

export function rawFactLineHash(line: string): string {
  return createHash("sha256").update(line.normalize("NFKC").trim()).digest("hex");
}

/** Surface only user-uploaded attribute rows; examples are discarded even if an AI analysis echoed them. */
export function parseRawAttributeFacts(raw: string): RawFactSuggestion[] {
  const suggestions: RawFactSuggestion[] = [];
  for (const [index, line] of raw.replace(/\r\n?/gu, "\n").split("\n").entries()) {
    const match = line.match(FIELD);
    if (!match) continue;
    const attributeKey = match[1].trim();
    const value = match[2].trim();
    if (attributeKey.length < 2 || value.length > 500 || value.length < 2
      || INTERNAL_LABEL.test(attributeKey) || DIRECT_URL.test(value)
      || isTemplateOrEmptyFact(value) || containsTemplateFactInFreeText(line)) continue;
    suggestions.push({ attributeKey, value, sourceLine: index + 1, sourceLineHash: rawFactLineHash(line) });
  }
  return suggestions;
}

/** Confirmation uses a fresh full-file read; the browser cannot provide or alter the source claim. */
export function assertRawFactMatchesSource(raw: string, input: RawFactSuggestion): void {
  const line = raw.replace(/\r\n?/gu, "\n").split("\n")[input.sourceLine - 1];
  if (!line || rawFactLineHash(line) !== input.sourceLineHash) throw new Error("属性原文已变化，请重新查看并核对事实");
  const actual = parseRawAttributeFacts(line)[0];
  if (!actual || actual.attributeKey !== input.attributeKey || actual.value !== input.value)
    throw new Error("该行不是可确认的原始产品事实，请补充真实资料");
}
