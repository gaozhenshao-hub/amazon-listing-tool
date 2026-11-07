import { randomUUID } from "node:crypto";
import {
  aggregationConceptKey,
  originalQuestionSchema,
  type AggregationEvidence,
  type ListingAggregation,
} from "../../../shared/listingAggregation";
type Question = ListingAggregation["questions"][number];
export type QuestionGroup = {
  id?: string;
  text: string;
  note: string;
  answer: string;
  category: NonNullable<Question["category"]>;
  source: "uploaded" | "review" | "listing" | "inferred";
  sourceIds: string[];
  mergedQuestionIds?: string[];
};

export function validateQuestionGroups(
  groups: QuestionGroup[],
  existing: Question[]
) {
  const ids = new Set(existing.map(q => q.id)),
    used = new Set<string>();
  for (const group of groups) {
    const members =
      group.mergedQuestionIds ||
      (group.id && ids.has(group.id) ? [group.id] : []);
    group.mergedQuestionIds = members;
    if (new Set(members).size !== members.length)
      throw new Error("同一组不能重复引用原问题");
    for (const id of members) {
      if (!ids.has(id)) throw new Error("合并问题引用了不存在的旧问题：" + id);
      if (used.has(id))
        throw new Error("一个旧问题只能归入一个合并结果：" + id);
      used.add(id);
    }
  }
  const missing = existing.filter(q => !used.has(q.id));
  if (missing.length)
    throw new Error(
      "每个已有问题都必须归入一组；同义问题通过mergedQuestionIds放在同组，不要逐条重复输出。遗漏：" +
        missing.map(q => q.id).join("、")
    );
}

export function consolidateQuestionGroup(
  group: QuestionGroup,
  existing: Question[],
  evidence: AggregationEvidence[]
): Question {
  const members = existing.filter(q => group.mergedQuestionIds?.includes(q.id));
  const primary =
    members.find(q => q.id === group.id) ||
    members.find(q => q.manual) ||
    members[0];
  const id = primary?.id || randomUUID();
  const aliases = [
    ...new Set(members.flatMap(q => [q.id, ...(q.mergedQuestionIds || [])])),
  ].filter(old => old !== id);
  const originals = members.flatMap(q => {
    const history = q.originalQuestions || [];
    const {
      evidence: _evidence,
      mergedQuestionIds: _aliases,
      mergeInputIds: _inputs,
      originalQuestions: _history,
      ...snapshot
    } = q;
    return history.length && !q.manual
      ? history
      : [...history, originalQuestionSchema.parse(snapshot)];
  });
  // The question schema is strict; source history is a compact, non-recursive
  // snapshot so original words and operator answers never disappear in a merge.
  const history = [
    ...new Map(originals.map(q => [JSON.stringify(q), q])).values(),
  ];
  if (history.length > 1000 || aliases.length > 1000)
    throw new Error("问题合并来源较多，请先分组整理");
  const refs = [
    ...new Map(
      [...members.flatMap(q => q.evidence || []), ...evidence].map(e => [
        JSON.stringify([
          e.analysisId,
          e.kind,
          e.sourceKey,
          e.hash,
          e.blockId,
          e.quote,
        ]),
        e,
      ])
    ).values(),
  ];
  const combined = members.length > 1;
  return {
    ...(primary || {}),
    id,
    text: combined || !primary?.manual ? group.text : primary.text,
    answer:
      combined || !primary?.manual || !primary.answer?.trim()
        ? group.answer
        : primary.answer,
    note: combined || !primary?.manual ? group.note : primary.note,
    category:
      primary?.manual && primary.manualFields?.includes("category")
        ? primary.category
        : group.category,
    source: primary?.source === "manual" ? "manual" : group.source,
    sourceKey:
      primary?.sourceKey || aggregationConceptKey("questions", group.text),
    evidence: refs,
    ...(aliases.length ? { mergedQuestionIds: aliases } : {}),
    ...(combined || primary?.originalQuestions?.length
      ? { originalQuestions: history }
      : {}),
    mergeInputIds: members.map(q => q.id),
    ...(members.some(q => q.manual)
      ? {
          manual: true,
          manualFields: [
            ...new Set(
              members.flatMap(q => q.manualFields || ["text", "note", "answer"])
            ),
          ],
        }
      : {}),
  };
}
