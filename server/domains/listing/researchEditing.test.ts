import { expect, it } from "vitest";
import {
  emptyListingAggregation,
  listingAggregationSchema,
} from "../../../shared/listingAggregation";
import {
  recordManualResearch,
  mergeResearchProposal,
  preserveManualResearch,
} from "../../../shared/researchEditing";
import { researchCategory } from "../../../shared/researchCategories";
const id = "11111111-1111-4111-8111-111111111111";
it("treats the edited six-pocket value as product truth without rewriting competitor evidence", () => {
  const before = listingAggregationSchema.parse({
    ...emptyListingAggregation(),
    features: [
      {
        id,
        text: "8个口袋",
        group: "detail",
        note: "竞品配置",
        evidence: [
          {
            kind: "image",
            sourceKey: "competitor-pocket",
            quote: "8 pockets",
            basis: "direct",
          },
        ],
      },
    ],
  });
  const next = structuredClone(before);
  next.features![0].text = "6个口袋";
  const saved = recordManualResearch(before, next);
  expect(saved.features![0]).toMatchObject({
    text: "6个口袋",
    manual: true,
    manualFields: ["text"],
    evidence: [{ quote: "8 pockets" }],
  });
  expect(saved.features![0].manualChangedAt).toBeTruthy();
});
it("tracks answers and classifications and keeps exclusions after removal", () => {
  const before = listingAggregationSchema.parse({
    ...emptyListingAggregation(),
    questions: [
      {
        id,
        text: "有几种尺寸？",
        answer: "六组",
        category: "information",
        note: "",
        source: "manual",
      },
    ],
  });
  const changed = structuredClone(before);
  changed.questions[0].answer = "提供六组尺码，并附详细选码说明。";
  expect(
    recordManualResearch(before, changed).questions[0].manualFields
  ).toContain("answer");
  const removed = recordManualResearch(before, { ...before, questions: [] });
  expect(removed.excludedConcepts?.[0]).toMatchObject({
    id,
    kind: "questions",
  });
});
it("supports product purposes across categories and keeps differentiation independent", () => {
  expect(researchCategory({ text: "水泵动力", category: "core" })).toBe("core");
  expect(researchCategory({ text: "养蜂服防蜇", category: "core" })).toBe(
    "core"
  );
  const data = listingAggregationSchema.parse({
    ...emptyListingAggregation(),
    features: [
      {
        id,
        text: "双层面纱",
        group: "design",
        category: "design",
        differentiated: true,
        availability: "current",
        note: "",
      },
    ],
    pageLocks: { selling: true },
    organized: { selling: true },
    researchJobs: { selling: "job-1" },
  });
  expect(data.features![0].differentiated).toBe(true);
  expect(researchCategory(data.features![0])).toBe("design");
});

it("accepts a question preview after unrelated chat/lock updates while preserving manual order and blank-answer completion", () => {
  const second = "22222222-2222-4222-8222-222222222222";
  const current = listingAggregationSchema.parse({
    ...emptyListingAggregation(),
    questions: [
      {
        id: second,
        text: "先显示的人工问题",
        note: "保留",
        source: "manual",
        answer: "",
        manual: true,
        manualFields: ["text", "note", "answer"],
      },
      { id, text: "原问题", note: "", source: "inferred" },
    ],
    pageLocks: { selling: true },
    planningConversation: {
      epoch: id,
      revision: 2,
      messages: [],
      opened: true,
      jobRunId: null,
    },
  });
  const stale = listingAggregationSchema.parse({
    ...emptyListingAggregation(),
    questions: [
      { id, text: "原问题", note: "", answer: "答案一", source: "inferred" },
      {
        id: second,
        text: "AI想改标题",
        note: "旧说明",
        answer: "补充的积极回答",
        source: "inferred",
      },
    ],
  });
  const merged = preserveManualResearch(
    current,
    mergeResearchProposal(current, stale, "questions")
  );
  expect(merged.questions.map(q => q.id)).toEqual([second, id]);
  expect(merged.questions[0]).toMatchObject({
    text: "先显示的人工问题",
    note: "保留",
    answer: "补充的积极回答",
  });
  expect(merged.planningConversation?.revision).toBe(2);
  expect(merged.pageLocks).toEqual({ selling: true });
});
it("does not reintroduce a deleted concept from a preview generated before deletion", () => {
  const current = {
    ...emptyListingAggregation(),
    questions: [],
    excludedConcepts: [
      { id, kind: "questions" as const, text: "已移除", sourceKey: "q-key" },
    ],
  };
  const stale = listingAggregationSchema.parse({
    ...emptyListingAggregation(),
    questions: [
      {
        id,
        text: "AI换了一种问法",
        note: "",
        source: "inferred",
        answer: "回答",
      },
    ],
  });
  expect(mergeResearchProposal(current, stale, "questions").questions).toEqual(
    []
  );
});

it("sets review defaults without overwriting an explicitly edited review status",()=>{
 const positive={id,text:"耐用",note:"",sentiment:"positive" as const,status:"unset" as const,percentage:null,sampleSize:null};
 const current={...emptyListingAggregation(),reviews:[positive]};
 expect(mergeResearchProposal(current,current,"reviews").reviews[0].status).toBe("covered");
 const edited={...current,reviews:[{...positive,status:"not_covered" as const,manual:true,manualFields:["status"]}]};
 expect(preserveManualResearch(edited,mergeResearchProposal(edited,current,"reviews")).reviews[0].status).toBe("not_covered");
});
