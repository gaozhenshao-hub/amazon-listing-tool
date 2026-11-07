import SHA256 from "crypto-js/sha256.js";
import type { ListingAggregation } from "./listingAggregation";
type Question = ListingAggregation["questions"][number];

export const questionMergeSignature = (questions: Question[]) =>
  SHA256(JSON.stringify(questions)).toString();

export function questionAliasMap(questions: Question[]) {
  const aliases = new Map<string, string>();
  for (const question of questions) {
    for (const id of question.mergedQuestionIds || []) {
      const existing = aliases.get(id);
      if (existing && existing !== question.id)
        throw new Error("同一个原问题不能合并到多个问题");
      aliases.set(id, question.id);
    }
  }
  for (const question of questions) {
    if (aliases.has(question.id) && aliases.get(question.id) !== question.id)
      throw new Error("合并后的问题不能同时保留为另一条问题");
    aliases.set(question.id, question.id);
  }
  return aliases;
}

export function resolveQuestionIds(ids: string[], questions: Question[]) {
  const aliases = questionAliasMap(questions);
  return [...new Set(ids.map(id => aliases.get(id) || id))];
}

/** A multi-question merge is explicitly reviewed as a combined question/answer.
 * Original operator wording remains available in originalQuestions. */
export const isNewQuestionMerge = (question: Question) =>
  (question.mergeInputIds?.length || 0) > 1;
