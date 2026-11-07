import { beforeEach, it, expect, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { emptyListingAggregation } from "../../../shared/listingAggregation";
const f = vi.hoisted(() => ({
  data: null as any,
  output: null as any,
  revision: 2,
  adjust: vi.fn(),
  saved: vi.fn(),
  start: vi.fn(),
  locked: false,
}));
const dialect = new MySqlDialect();
const execute = async (q: any) => {
  const { sql, params } = dialect.sqlToQuery(q);
  if (sql.startsWith("SELECT output,status"))
    return [[{ output: JSON.stringify(f.output), status: "succeeded" }]];
  if (sql.startsWith("SELECT revision")) return [[{ revision: f.revision }]];
  if (sql.startsWith("UPDATE ai_jobs")) {
    f.output = JSON.parse(params[0] as string);
    return [{}];
  }
  throw new Error(sql);
};
vi.mock("./researchManagedStore", () => ({
  mutateResearchManaged: async (
    _scope: any,
    page: any,
    fn: any,
    options: any
  ) => {
    if (f.locked && !(page === "selling" && options?.allowLockedSelling)) throw new Error("已锁定");
    const data = structuredClone(f.data),
      result = await fn(data, { execute });
    if (!options?.readOnly && JSON.stringify(data) !== JSON.stringify(f.data)) {
      f.data = data;
      f.revision++;
    }
    return { result, revision: f.revision };
  },
}));
vi.mock("./aggregationStore", () => ({
  readListingAggregation: async () => ({
    data: structuredClone(f.data),
    revision: f.revision,
  }),
  saveListingAggregation: async (_scope: any, rev: number, data: any) => {
    if (rev !== f.revision) throw new Error("版本变化");
    f.saved(data);
    f.data = structuredClone(data);
    delete f.data.researchJobs.selling;
    return { data: f.data, revision: ++f.revision };
  },
}));
vi.mock("./aggregationAdjustments", () => ({
  adjustAggregationResult: f.adjust,
}));
vi.mock("./generateListingAggregation", () => ({
  generateListingAggregation: vi.fn(),
}));
vi.mock("./researchLocks", () => ({
  assertResearchEditable: async () => {
    if (f.locked) throw new Error("已锁定");
  },
}));
vi.mock("./researchAgent", () => ({
  ensureResearchAgent: async () => ({ agentRunId: "agent" }),
  researchAgentContext: async () => ({}),
}));
vi.mock("../../services/aiJobRunner", () => ({
  registerAiJobHandler: vi.fn(),
  getAiJobRun: async () => null,
  startRegisteredAiJob: f.start,
}));
vi.mock("../ai_os/services/businessManagedAgent", () => ({
  markBusinessManagedNodeConfirmed: vi.fn(),
  markBusinessManagedNodeRunning: vi.fn(),
  markBusinessManagedNodeWaitingHuman: vi.fn(),
  markBusinessManagedNodeFailed: vi.fn(),
}));
import {
  dismissResearchPreview,
  confirmResearchPreview,
  refineResearchPreview,
} from "./researchOrganization";
const scope = { projectId: 1, workspaceId: 1, userId: 2 },
  input = {
    projectId: 1,
    section: "selling" as const,
    runId: "research-test",
    previewRevision: 0,
  };
beforeEach(() => {
  f.revision = 2;
  f.locked = false;
  vi.clearAllMocks();
  f.data = {
    ...emptyListingAggregation(),
    researchJobs: { selling: input.runId },
    organized: { selling: true },
    features: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        text: "六个口袋",
        note: "运营确认",
        group: "detail",
        manual: true,
        manualFields: ["text"],
      },
    ],
    selling: [],
  };
  f.output = {
    data: {
      ...structuredClone(f.data),
      features: [{ ...f.data.features[0], text: "八个口袋" }],
    },
    revision: 2,
    section: "selling",
    previewRevision: 0,
    history: [],
  };
});
it("cancel clears only the candidate pointer and leaves original human results intact", async () => {
  const original = structuredClone(f.data.features);
  await dismissResearchPreview(scope, input);
  expect(f.data.features).toEqual(original);
  expect(f.data.researchJobs.selling).toBeUndefined();
  expect(f.output.decision).toBe("canceled");
  expect(f.saved).not.toHaveBeenCalled();
});
it("refines the saved candidate with feedback and history while preserving manual facts; confirms latest only", async () => {
  f.adjust.mockImplementation(async (_scope, request) => ({
    data: {
      ...request.data,
      features: [
        { ...request.data.features[0], text: "八个口袋", note: "新版说明" },
      ],
    },
    reply: "已细化说明",
  }));
  await refineResearchPreview(scope, { ...input, message: "把说明写具体" });
  expect(f.adjust.mock.calls[0][1]).toMatchObject({
    message: "把说明写具体",
    data: { features: [expect.objectContaining({ text: "六个口袋" })] },
  });
  expect(f.data.features[0].note).toBe("运营确认");
  expect(f.output.previewRevision).toBe(1);
  expect(f.output.history).toHaveLength(2);
  expect(f.output.data.features[0].text).toBe("六个口袋");
  await expect(confirmResearchPreview(scope, input)).rejects.toThrow("已更新");
  expect(f.saved).not.toHaveBeenCalled();
  await confirmResearchPreview(scope, { ...input, previewRevision: 1 });
  expect(f.data.features[0]).toMatchObject({
    text: "六个口袋",
    note: "新版说明",
  });
});
it("adopts the displayed selling result even while locked or manually changed", async () => {
  f.locked = true;
  f.data.features[0].text = "后来改过的名称";
  f.output.preserveManual = false;
  await confirmResearchPreview(scope, input);
  expect(f.saved).toHaveBeenCalledOnce();
  expect(f.data.features[0].text).toBe("八个口袋");
});
it("discards the selling preview while locked", async () => {
  f.locked = true;
  await expect(dismissResearchPreview(scope, input)).resolves.toBeDefined();
  expect(f.data.researchJobs.selling).toBeUndefined();
  expect(f.saved).not.toHaveBeenCalled();
});
it("a concurrent human edit during model refinement keeps the original candidate", async () => {
  const original = structuredClone(f.output);
  f.adjust.mockImplementation(async (_scope, request) => {
    f.data.features[0].text = "运营刚修改的四个口袋";
    return { data: request.data, reply: "已调整" };
  });
  await expect(
    refineResearchPreview(scope, { ...input, message: "改善说明" })
  ).rejects.toThrow("已更新");
  expect(f.output).toEqual(original);
  expect(f.data.features[0].text).toBe("运营刚修改的四个口袋");
});
