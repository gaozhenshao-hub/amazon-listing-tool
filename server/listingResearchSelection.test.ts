import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorAnalysis, CompetitorComparisonReport } from "../drizzle/schema/project";
import {
  listingResearchBindingSchema, listingResearchIdsSchema, type ListingResearchBinding,
} from "../shared/listingResearchSelection";

const deps = vi.hoisted(() => ({ project: vi.fn(), analyses: vi.fn(), comparison: vi.fn() }));
vi.mock("./domains/listing/repository", () => ({
  getProjectByIdAdmin: deps.project, getCompetitorAnalysesByProject: deps.analyses,
  getLatestCompetitorComparisonReport: deps.comparison,
}));
import { assertListingResearchSelection, prepareListingResearchSelection } from "./domains/listing/services/listingResearchSelection";

const scope = { projectId: 5, workspaceId: 7 };
const stamp = new Date("2026-10-16T00:00:00.000Z");
function analysis(id: number, patch: Partial<CompetitorAnalysis> = {}): CompetitorAnalysis {
  return { id, projectId: 5, asin: `B${String(id).padStart(9, "0")}`, title: `Competitor ${id}`,
    bulletPoints: '["External claim only"]', imageUrls: "[]", price: "0", rating: "0", reviewCount: "0",
    reviewAnalysis: '{"painPoints":[{"point":"Synthetic research","frequency":0}]}', keywords: "[]",
    rawData: '{"count":0,"enabled":false}', aiSummary: "AI observation, not product fact", summary: null,
    summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null,
    createdAt: stamp, updatedAt: stamp, ...patch };
}
function comparison(patch: Partial<CompetitorComparisonReport> = {}): CompetitorComparisonReport {
  return { id: 90, workspaceId: 7, projectId: 5, userId: 2, selectionKey: "11-22", analysisIds: "[11,22]",
    analyzedAsins: '["B000000011","B000000022"]', aiSummary: "Untrusted external research",
    summary: "Reviewed competitor comparison", sellingPointRows: '[{"selected":false,"humanNote":"0"}]',
    status: "confirmed", version: 1, confirmedBy: 2, confirmedAt: stamp, createdAt: stamp, updatedAt: stamp, ...patch };
}
let rows: CompetitorAnalysis[];
beforeEach(() => {
  vi.clearAllMocks(); rows = [analysis(22), analysis(11), analysis(33)];
  deps.project.mockResolvedValue({ id: 5, workspaceId: 7, userId: 2 });
  deps.analyses.mockImplementation(async () => rows);
  deps.comparison.mockResolvedValue(null);
});

describe("shared persisted research contracts", () => {
  it("accepts explicit empty, unsorted request IDs and exactly 1000 IDs", () => {
    expect(listingResearchIdsSchema.parse([])).toEqual([]);
    expect(listingResearchIdsSchema.parse([22, 11])).toEqual([22, 11]);
    expect(listingResearchIdsSchema.parse(Array.from({ length: 1000 }, (_, i) => i + 1))).toHaveLength(1000);
  });
  it.each([[1, 1], [0], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], [NaN], [Infinity], ["1"], [null], new Array(1)])(
    "rejects invalid/duplicate/sparse request IDs %j", ids => expect(listingResearchIdsSchema.safeParse(ids).success).toBe(false),
  );
  it("rejects more than 1000 IDs", () => {
    expect(listingResearchIdsSchema.safeParse(Array.from({ length: 1001 }, (_, i) => i + 1)).success).toBe(false);
  });
  it("requires canonical persisted IDs, a known version/mode and an exact shape", () => {
    const binding: ListingResearchBinding = { version: 1, ...scope, mode: "explicit", analysisIds: [11, 22], sourceHash: "a".repeat(64) };
    expect(listingResearchBindingSchema.parse(binding)).toEqual(binding);
    for (const patch of [{ analysisIds: [22, 11] }, { analysisIds: [11, 11] }, { version: 2 }, { mode: "all" },
      { sourceHash: "A".repeat(64) }, { workspaceId: undefined }, { projectId: 0 }, { extra: true }]) {
      expect(listingResearchBindingSchema.safeParse({ ...binding, ...patch }).success).toBe(false);
    }
    expect(listingResearchBindingSchema.parse({ ...binding, workspaceId: null }).workspaceId).toBeNull();
  });
});

describe("scope and exact ID admission before research reads", () => {
  it.each([{ workspaceId: 0 }, { workspaceId: undefined }, { projectId: -1 }, { analysisIds: [11, 11] }, { unexpected: true }])(
    "rejects malformed preparation input before any repository call: %j", async patch => {
      await expect(prepareListingResearchSelection({ ...scope, ...patch } as Parameters<typeof prepareListingResearchSelection>[0]))
        .rejects.toMatchObject({ code: "BAD_REQUEST" });
      expect(deps.project).not.toHaveBeenCalled(); expect(deps.analyses).not.toHaveBeenCalled();
    },
  );
  it.each([null, { id: 6, workspaceId: 7 }, { id: 5, workspaceId: 8 }])("rejects absent/wrong/foreign parent %j first", async parent => {
    deps.project.mockResolvedValue(parent);
    await expect(prepareListingResearchSelection({ ...scope, analysisIds: [11] })).rejects.toThrow();
    expect(deps.project).toHaveBeenCalledWith(5, 7);
    expect(deps.analyses).not.toHaveBeenCalled(); expect(deps.comparison).not.toHaveBeenCalled();
  });
  it("retains an authorized legacy NULL parent without changing the authenticated scope", async () => {
    deps.project.mockResolvedValue({ id: 5, workspaceId: null, userId: 2 });
    expect((await prepareListingResearchSelection({ ...scope, analysisIds: [11] })).binding.workspaceId).toBe(7);
    const result = await prepareListingResearchSelection({ projectId: 5, workspaceId: null, analysisIds: [11] });
    expect(result.binding.workspaceId).toBeNull(); expect(deps.project).toHaveBeenLastCalledWith(5, null);
  });
  it("does not treat an explicit workspace as compatible with authenticated NULL", async () => {
    await expect(prepareListingResearchSelection({ projectId: 5, workspaceId: null, analysisIds: [11] }))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deps.analyses).not.toHaveBeenCalled();
  });
  it("requires every requested ID instead of silently filtering missing analyses", async () => {
    await expect(prepareListingResearchSelection({ ...scope, analysisIds: [11, 404] })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(deps.comparison).not.toHaveBeenCalled();
  });
  it.each(["foreign", "duplicate", "invalid-id"])("rejects a corrupt repository result: %s", async kind => {
    rows = kind === "foreign" ? [analysis(11, { projectId: 6 })] : kind === "duplicate" ? [analysis(11), analysis(11)] : [analysis(0)];
    await expect(prepareListingResearchSelection({ ...scope, analysisIds: [11] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(deps.comparison).not.toHaveBeenCalled();
  });
  it("explicit [] still checks the parent but reads no unrelated competitors or comparison", async () => {
    const result = await prepareListingResearchSelection({ ...scope, analysisIds: [] });
    expect(result).toMatchObject({ binding: { version: 1, ...scope, mode: "explicit", analysisIds: [] },
      competitors: [], confirmedComparison: null, reviewAggregation: null });
    expect(deps.project).toHaveBeenCalledOnce(); expect(deps.analyses).not.toHaveBeenCalled(); expect(deps.comparison).not.toHaveBeenCalled();
  });
});

describe("selection snapshots survive JSON restart without broadening", () => {
  it("explicit selection returns only canonical requested rows and preserves zero/false research", async () => {
    const result = await prepareListingResearchSelection({ ...scope, analysisIds: [22, 11] });
    expect(result.binding).toMatchObject({ mode: "explicit", analysisIds: [11, 22], sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/) });
    expect(result.competitors.map(row => row.id)).toEqual([11, 22]);
    expect(result.competitors[0]).toMatchObject({ price: "0", reviewCount: "0", rawData: '{"count":0,"enabled":false}' });
    expect(result.competitors[0].updatedAt).toEqual(stamp);
    expect(result.reviewAggregation).toBeNull();
    expect(deps.comparison).toHaveBeenCalledWith(5, "11-22");
  });
  it("undefined freezes all current IDs once; additions/unselected edits after restart do not drift it", async () => {
    const prepared = await prepareListingResearchSelection(scope);
    const binding = JSON.parse(JSON.stringify(prepared.binding)) as ListingResearchBinding;
    expect(binding).toMatchObject({ mode: "legacy_all", analysisIds: [11, 22, 33] });
    rows.push(analysis(44, { title: "New competitor" }));
    rows.reverse();
    const restored = await assertListingResearchSelection(binding, scope);
    expect(restored.binding).toEqual(binding); expect(restored.competitors.map(row => row.id)).toEqual([11, 22, 33]);
  });
  it("new or modified unselected competitors never enter an explicit selection", async () => {
    const { binding } = await prepareListingResearchSelection({ ...scope, analysisIds: [11] });
    rows = [analysis(33, { title: "Completely changed", reviewAnalysis: "unselected" }), analysis(44), analysis(11)];
    expect((await assertListingResearchSelection(binding, scope)).binding).toEqual(binding);
  });
  it("an empty legacy snapshot remains empty when competitors are subsequently added", async () => {
    rows = [];
    const { binding } = await prepareListingResearchSelection(scope);
    rows = [analysis(11)]; deps.analyses.mockClear();
    expect((await assertListingResearchSelection(binding, scope)).competitors).toEqual([]);
    expect(deps.analyses).not.toHaveBeenCalled();
    const explicit = await prepareListingResearchSelection({ ...scope, analysisIds: [] });
    expect(explicit.binding.sourceHash).not.toBe(binding.sourceHash);
  });
  it("refuses too many legacy inputs instead of truncating the frozen list", async () => {
    rows = Array.from({ length: 1001 }, (_, i) => analysis(i + 1));
    await expect(prepareListingResearchSelection(scope)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(deps.comparison).not.toHaveBeenCalled();
  });
  it("source row and object key ordering do not change the hash", async () => {
    const before = await prepareListingResearchSelection({ ...scope, analysisIds: [22, 11] });
    rows = rows.reverse().map(row => Object.fromEntries(Object.entries(row).reverse()) as CompetitorAnalysis);
    expect((await assertListingResearchSelection(before.binding, scope)).binding).toEqual(before.binding);
  });
  it.each([
    { title: "changed" }, { bulletPoints: '["changed"]' }, { imageUrls: '["changed"]' }, { price: null }, { rating: "1" },
    { reviewCount: "1" }, { reviewAnalysis: "changed" }, { keywords: "changed" }, { rawData: '{"count":0,"enabled":true}' },
    { aiSummary: "changed" }, { summary: "edited" }, { summaryStatus: "confirmed" }, { summaryVersion: 2 },
    { summaryConfirmedBy: 2 }, { summaryConfirmedAt: new Date(stamp.getTime() + 1000) }, { asin: "B000000099" },
    { createdAt: new Date(stamp.getTime() + 1000) }, { updatedAt: new Date(stamp.getTime() + 1000) },
  ] as Partial<CompetitorAnalysis>[])("rejects changed selected source field(s) %j", async patch => {
    const { binding } = await prepareListingResearchSelection({ ...scope, analysisIds: [11] });
    rows = [analysis(11, patch)];
    await expect(assertListingResearchSelection(binding, scope)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rejects a selected deletion and never substitutes another row", async () => {
    const { binding } = await prepareListingResearchSelection({ ...scope, analysisIds: [11] });
    rows = [analysis(22)];
    await expect(assertListingResearchSelection(binding, scope)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
  it("checks binding scope and schema before repository I/O", async () => {
    const { binding } = await prepareListingResearchSelection({ ...scope, analysisIds: [11] });
    vi.clearAllMocks();
    await expect(assertListingResearchSelection(binding, { ...scope, workspaceId: 8 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertListingResearchSelection(binding, { ...scope, projectId: 6 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(assertListingResearchSelection({ ...binding, sourceHash: "invalid" }, scope)).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(deps.project).not.toHaveBeenCalled();
  });
  it("rejects a forged hash or changed mode, even with the same IDs", async () => {
    const { binding } = await prepareListingResearchSelection({ ...scope, analysisIds: [11] });
    await expect(assertListingResearchSelection({ ...binding, sourceHash: "0".repeat(64) }, scope)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(assertListingResearchSelection({ ...binding, mode: "legacy_all" }, scope)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("rechecks the parent for persisted jobs", async () => {
    const { binding } = await prepareListingResearchSelection({ ...scope, analysisIds: [11] });
    deps.project.mockResolvedValue({ id: 5, workspaceId: 8 }); deps.analyses.mockClear();
    await expect(assertListingResearchSelection(binding, scope)).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(deps.analyses).not.toHaveBeenCalled();
  });
  it("returned snapshots cannot mutate the repository's source objects", async () => {
    const result = await prepareListingResearchSelection({ ...scope, analysisIds: [11] });
    result.competitors[0].title = "local change";
    result.competitors[0].updatedAt.setTime(0);
    expect((await assertListingResearchSelection(result.binding, scope)).binding).toEqual(result.binding);
  });
  it.each([undefined, NaN, new Date("invalid")])("refuses lossy selected field %s rather than hashing null/omitting", async value => {
    rows = [analysis(11)]; (rows[0] as unknown as Record<string, unknown>).title = value;
    await expect(prepareListingResearchSelection({ ...scope, analysisIds: [11] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
});

describe("exact-set comparison isolation and version binding", () => {
  it("includes an exact confirmed report and hashes all its source fields", async () => {
    const stored = comparison();
    deps.comparison.mockResolvedValue(stored);
    const result = await prepareListingResearchSelection({ ...scope, analysisIds: [22, 11] });
    expect(result.confirmedComparison).toEqual(stored); expect(result.confirmedComparison).not.toBe(stored);
    expect((await assertListingResearchSelection(JSON.parse(JSON.stringify(result.binding)), scope)).binding).toEqual(result.binding);
  });
  it.each([{ projectId: 6 }, { workspaceId: 8 }])("rejects an explicit foreign comparison %j", async patch => {
    deps.comparison.mockResolvedValue(comparison(patch));
    await expect(prepareListingResearchSelection({ ...scope, analysisIds: [11, 22] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("retains legacy NULL comparison scope only after parent admission", async () => {
    deps.comparison.mockResolvedValue(comparison({ workspaceId: null }));
    expect((await prepareListingResearchSelection({ ...scope, analysisIds: [11, 22] })).confirmedComparison?.workspaceId).toBeNull();
  });
  it.each([{ analysisIds: "[11,33]" }, { analysisIds: "[11,22,33]" }, { analysisIds: "[11,11]" },
    { analysisIds: "invalid" }, { analysisIds: '["11",22]' }, { selectionKey: "11-33" }])("refuses comparison membership/key corruption %j", async patch => {
    deps.comparison.mockResolvedValue(comparison(patch));
    await expect(prepareListingResearchSelection({ ...scope, analysisIds: [11, 22] })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
  });
  it("a draft is not a confirmed comparison and its edits cannot enter the binding", async () => {
    deps.comparison.mockResolvedValue(comparison({ status: "draft" }));
    const result = await prepareListingResearchSelection({ ...scope, analysisIds: [11, 22] });
    expect(result.confirmedComparison).toBeNull();
    deps.comparison.mockResolvedValue(comparison({ status: "draft", summary: "changed draft" }));
    expect((await assertListingResearchSelection(result.binding, scope)).binding).toEqual(result.binding);
    deps.comparison.mockResolvedValue(comparison());
    await expect(assertListingResearchSelection(result.binding, scope)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it.each([{ id: 91 }, { userId: 3 }, { version: 2 }, { summary: "changed" }, { aiSummary: "changed" },
    { sellingPointRows: "[]" }, { analyzedAsins: "[]" }, { confirmedBy: 3 }, { confirmedAt: new Date(stamp.getTime() + 1000) },
    { updatedAt: new Date(stamp.getTime() + 1000) }, { status: "draft" }])("rejects confirmed comparison drift %j", async patch => {
    deps.comparison.mockResolvedValue(comparison());
    const { binding } = await prepareListingResearchSelection({ ...scope, analysisIds: [11, 22] });
    deps.comparison.mockResolvedValue(comparison(patch as Partial<CompetitorComparisonReport>));
    await expect(assertListingResearchSelection(binding, scope)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("a deleted formerly confirmed report invalidates the persisted source", async () => {
    deps.comparison.mockResolvedValue(comparison());
    const { binding } = await prepareListingResearchSelection({ ...scope, analysisIds: [11, 22] });
    deps.comparison.mockResolvedValue(null);
    await expect(assertListingResearchSelection(binding, scope)).rejects.toMatchObject({ code: "CONFLICT" });
  });
});
