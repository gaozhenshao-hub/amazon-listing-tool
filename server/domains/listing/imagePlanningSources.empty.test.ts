import { it, expect, vi } from "vitest";
vi.mock("../../repositories", () => ({
  getProjectById: async () => ({
    id: 14,
    workspaceId: 1,
    productName: "",
    productFeatures: null,
    productSpecs: null,
  }),
  getCompetitorAnalysesByProject: async () => [],
}));
vi.mock("./aggregationStore", () => ({
  readListingAggregation: async () => ({
    revision: 0,
    data: { selling: [], reviews: [], questions: [], marks: [] },
  }),
}));
vi.mock("../knowledge/taggingUnitPreview", () => ({
  taggingUnitPreview: vi.fn(),
}));
import { imagePlanningSources } from "./imagePlanningSources";
it("reads a new empty project with no review summary and computes a stable source hash", async () => {
  const first = await imagePlanningSources({
      projectId: 14,
      workspaceId: 1,
      userId: 2,
    }),
    second = await imagePlanningSources({
      projectId: 14,
      workspaceId: 1,
      userId: 2,
    });
  expect(first.revision).toBe(0);
  expect(first.upstream.selling).toEqual([]);
  expect(first.sourceHash).toMatch(/^[a-f0-9]{64}$/);
  expect(second.sourceHash).toBe(first.sourceHash);
});
