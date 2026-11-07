import { expect, it } from "vitest";
import {
  emptyListingAggregation,
  type ListingAggregation,
} from "../../../shared/listingAggregation";
import { resolveQuestionIds } from "../../../shared/questionMerging";
import {
  mergeResearchProposal,
  preserveManualResearch,
} from "../../../shared/researchEditing";
import {
  consolidateQuestionGroup,
  validateQuestionGroups,
  type QuestionGroup,
} from "./questionConsolidation";
const first = "11111111-1111-4111-8111-111111111111",
  second = "22222222-2222-4222-8222-222222222222";
const originals: ListingAggregation["questions"] = [
  {
    id: first,
    text: "尺码偏大还是偏小？",
    answer: "本品六组尺码。",
    note: "运营核对尺码表",
    manual: true,
    manualFields: ["answer", "note"],
    source: "manual",
    evidence: [
      {
        kind: "listing",
        sourceKey: "Q:10:0",
        quote: "尺码",
        analysisId: 10,
        asin: "B012345678",
      },
    ],
  },
  {
    id: second,
    text: "如何根据身高体重选择合适尺码？",
    answer: "建议核对胸围和躯干长度。",
    note: "",
    source: "uploaded",
    evidence: [
      {
        kind: "listing",
        sourceKey: "Q:11:0",
        quote: "选码",
        analysisId: 11,
        asin: "B012345679",
      },
    ],
  },
];
const group = (): QuestionGroup => ({
  id: first,
  text: "尺码是否合适，应该如何选择？",
  answer:
    "本品提供六组尺码，建议按胸围、躯干长度对照尺码说明选择，并留出作业活动余量。",
  note: "综合尺码偏差、合身和选码顾虑",
  category: "information",
  source: "inferred",
  sourceIds: ["PRODUCT:notes"],
  mergedQuestionIds: [first, second],
});
it("combines answered size questions into one answer and preserves both source records and operator wording", () => {
  const groups = [group()];
  validateQuestionGroups(groups, originals);
  const merged = consolidateQuestionGroup(groups[0], originals, []);
  expect(merged).toMatchObject({
    id: first,
    text: group().text,
    answer: group().answer,
    mergedQuestionIds: [second],
    manual: true,
  });
  expect(merged.originalQuestions).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: first,
        answer: "本品六组尺码。",
        note: "运营核对尺码表",
        manual: true,
      }),
      expect.objectContaining({ id: second }),
    ])
  );
  expect(merged.evidence?.map(e => e.analysisId)).toEqual([10, 11]);
  const current = { ...emptyListingAggregation(), questions: originals };
  const preview = preserveManualResearch(
    current,
    mergeResearchProposal(
      current,
      { ...current, questions: [merged] },
      "questions"
    )
  );
  expect(preview.questions).toHaveLength(1);
  expect(preview.questions[0].answer).toBe(group().answer);
  expect(resolveQuestionIds([first, second, first], preview.questions)).toEqual(
    [first]
  );
});
it("requires every original question in exactly one group, including questions that already have answers", () => {
  expect(() =>
    validateQuestionGroups(
      [{ ...group(), mergedQuestionIds: [first] }],
      originals
    )
  ).toThrow("每个已有问题");
  expect(() =>
    validateQuestionGroups(
      [group(), { ...group(), mergedQuestionIds: [second] }],
      originals
    )
  ).toThrow("只能归入一个");
  expect(() =>
    validateQuestionGroups(
      [
        {
          ...group(),
          mergedQuestionIds: ["33333333-3333-4333-8333-333333333333"],
        },
      ],
      originals
    )
  ).toThrow("不存在");
});
it("retains aliases through another merge and protects a later manual edit on the combined question", () => {
  const merged = consolidateQuestionGroup(group(), originals, []);
  delete merged.mergeInputIds;
  merged.text = "运营最终选码问题";
  merged.answer = "运营确认：六组尺码，按详细尺码表选码。";
  merged.manualFields = ["text", "answer"];
  const next = consolidateQuestionGroup(
    {
      ...group(),
      text: "AI想改标题",
      answer: "AI想替换答案",
      mergedQuestionIds: [first],
    },
    [merged],
    []
  );
  expect(next.text).toBe(merged.text);
  expect(next.answer).toBe(merged.answer);
  expect(next.mergedQuestionIds).toEqual([second]);
  expect(resolveQuestionIds([second], [next])).toEqual([first]);
});
