vi.mock("./researchLocks",()=>({assertResearchEditable:vi.fn()}));
import { beforeEach, expect, it, vi } from "vitest";
const f = vi.hoisted(() => ({
  read: vi.fn(),
  save: vi.fn(),
  project: vi.fn(),
  records: vi.fn(),
  run: vi.fn(),
}));
vi.mock("./aggregationStore", () => ({
  readListingAggregation: f.read,
  saveListingAggregation: f.save,
}));
vi.mock("../../repositories", () => ({
  getProjectById: f.project,
  getCompetitorAnalysesByProject: f.records,
}));
vi.mock("../ai_os/services/skillRunner", () => ({
  runEmperorSkill: f.run,
  safeParseSkillJSON: JSON.parse,
}));
import {
  adjustAggregationResult,
  applyAggregationChanges,
} from "./aggregationAdjustments";
import {
  emptyListingAggregation,
  listingAggregationSchema,
} from "../../../shared/listingAggregation";
const id = "11111111-1111-4111-8111-111111111111";
const data = () =>
  listingAggregationSchema.parse({
    ...emptyListingAggregation(),
    features: [
      {
        id,
        text: "六组尺码",
        note: "原有人工说明",
        group: "design",
        position: { x: 2, y: 3 },
        evidence: [
          {
            kind: "user",
            sourceKey: "PRODUCT:notes",
            quote: "六组尺码可选",
            basis: "user",
          },
        ],
      },
    ],
    productNotes: "六组尺码可选",
  });
beforeEach(() => {
  vi.clearAllMocks();
  f.read.mockResolvedValue({ revision: 3, data: data() });
  f.project.mockResolvedValue({
    workspaceId: 1,
    productName: "养蜂服",
    productFeatures: "",
    productSpecs: "",
  });
  f.records.mockResolvedValue([]);
  f.run.mockImplementation(async request => ({
    parsed: request.validate(
      JSON.stringify({
        reply: "已补充详细说明",
        changes: [
          {
            key: "features:" + id + ":note",
            original: "原有人工说明",
            value: "提供六组尺码，方便按体型选择",
          },
        ],
      })
    ),
  }));
});
it("changes only explicit editable fields and preserves evidence, layout and original input", () => {
  const original = data(),
    next = applyAggregationChanges(original, [
      {
        key: "features:" + id + ":note",
        original: "原有人工说明",
        value: "补充选码说明",
      },
    ]);
  expect(next.features![0]).toMatchObject({
    note: "补充选码说明",
    position: { x: 2, y: 3 },
    manual: true,
    evidence: original.features![0].evidence,
  });
  expect(original.features![0].note).toBe("原有人工说明");
});
it("rejects invented evidence fields and stale original values", () => {
  expect(() =>
    applyAggregationChanges(data(), [
      { key: "features:" + id + ":evidence", original: "", value: "fake" },
    ])
  ).toThrow("字段");
  expect(() =>
    applyAggregationChanges(data(), [
      { key: "features:" + id + ":note", original: "已过期", value: "fake" },
    ])
  ).toThrow("字段");
});
it("previews a real conversation without saving", async () => {
  const result = await adjustAggregationResult(
    { workspaceId: 1, userId: 2 },
    { projectId: 1, data: data(), message: "补充选码说明", history: [] }
  );
  expect(result.data.features![0].note).toContain("六组尺码");
  expect(result.baseline.revision).toBe(3);
  expect(f.save).not.toHaveBeenCalled();
});
it("refuses another paid round after source data changes", async () => {
  const input = {
      projectId: 1,
      data: data(),
      message: "补充说明",
      history: [],
    },
    scope = { workspaceId: 1, userId: 2 };
  const first = await adjustAggregationResult(scope, input);
  f.project.mockResolvedValue({
    workspaceId: 1,
    productName: "新资料",
    productFeatures: "",
    productSpecs: "",
  });
  await expect(
    adjustAggregationResult(scope, { ...input, baseline: first.baseline })
  ).rejects.toThrow("已更新");
  expect(f.run).toHaveBeenCalledTimes(1);
});
