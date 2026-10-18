import { beforeEach, describe, expect, it, vi } from "vitest";

// These are actual consumer wiring tests, not artifact-provenance or native DB
// acceptance. The independently verified loader has its own contract tests.
const mocks = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  active: new Map<number, any>(),
  invoke: vi.fn(), resolve: vi.fn(), use: vi.fn(),
  getProjectById: vi.fn(), getKeywordsByProject: vi.fn(),
  createAdStructure: vi.fn(), updateAdStructure: vi.fn(),
  createReviewAggregation: vi.fn(), updateReviewAggregation: vi.fn(),
  getReviewAggregationByProject: vi.fn(),
}));
vi.mock("./services/competitorActiveResearch", async importOriginal => ({
  ...await importOriginal<typeof import("./services/competitorActiveResearch")>(),
  readActiveCompetitorResearch: (row: { id: number }) => mocks.active.get(row.id) ?? { status: "legacy" },
  renderActiveCompetitorResearchContext: (row: { id: number }) => mocks.active.get(row.id)?.status === "adopted_deep"
    ? `CURRENT_DEEP_ONLY:${row.id}:external_research:sample_not_market`
    : "UNAVAILABLE_CURRENT_RESEARCH:no_legacy_fallback",
}));
vi.mock("./domains/ai_os/services/businessSkillGateway", () => ({ invokeBusinessSkill: mocks.invoke }));
vi.mock("./domains/ai_os/services/businessArtifactRegistry", () => ({
  resolveCurrentBusinessArtifact: mocks.resolve, recordBusinessArtifactUse: mocks.use,
  hydrateLockedImageWorkflowAplusSubmodules: vi.fn(), hydrateImageWorkflowSessionFromArtifacts: vi.fn(),
}));
vi.mock("./repositories", () => ({
  getProjectById: mocks.getProjectById,
  getCompetitorAnalysesByProject: vi.fn(async () => mocks.rows),
  getKeywordsByProject: mocks.getKeywordsByProject,
  createAdStructure: mocks.createAdStructure, updateAdStructure: mocks.updateAdStructure,
  getAdStructuresByProject: vi.fn(), getAdStructureById: vi.fn(), deleteAdStructure: vi.fn(),
  getReviewAggregationByProject: mocks.getReviewAggregationByProject,
  createReviewAggregation: mocks.createReviewAggregation, updateReviewAggregation: mocks.updateReviewAggregation,
}));
vi.mock("./domains/image/repository", () => ({
  getProjectsByUser: vi.fn(async () => []), getCompetitorAnalysesByProject: vi.fn(async () => mocks.rows),
  getProjectFilesByProject: vi.fn(async () => []), getReviewAggregationByProject: mocks.getReviewAggregationByProject,
  getKeywordsByProject: mocks.getKeywordsByProject, getActiveListingByProject: vi.fn(async () => null),
  devDb: { getDevProductProfile: vi.fn(async () => null) }, kbDb: {},
}));
import { adStructureRouter } from "./routers/adStructure";
import { reviewAggregationRouter } from "./routers/reviewAggregation";
import { buildImageWorkflowContext } from "./domains/image/routerContext";

const ctx = { user: { id: 7, role: "admin", defaultWorkspaceId: 9 }, workspaceId: 9,
  req: { headers: {}, header: () => undefined }, res: { locals: {} } } as any;
const row = (id = 10) => ({ id, projectId: 1, asin: `B0000000${String(id).padStart(2, "0")}`, title: "Saved listing title",
  price: "$20", rating: "4.2", reviewCount: "30", bulletPoints: '["Saved bullet"]',
  keywords: '{"core":["OLD_KEYWORD_MUST_NOT_REVIVE"]}',
  reviewAnalysis: '{"painPoints":[{"issue":"OLD_PAIN_MUST_NOT_REVIVE","point":"OLD_PAIN_MUST_NOT_REVIVE"}]}',
  rawData: '{"advantages":["OLD_ADVANTAGE_MUST_NOT_REVIVE"]}' });
function adopted(id = 10, available = true) {
  mocks.active.set(id, { status: "adopted_deep", identity: { userId: 7, workspaceId: 9, projectId: 1, analysisId: id, asin: row(id).asin },
    ref: { artifactId: "current-artifact", resultHash: "current-result", evidenceHash: "current-evidence" },
    result: { deepAnalysis: { coverage: { reviews: { status: available ? "available" : "unavailable", total: available ? 6 : null,
      scope: available ? "complete_file_not_market_total" : null } },
      buyers: { groups: [{ entryId: "group:1", name: "Validated sample theme", sentiment: "negative", count: 2, percentage: 100 / 3, denominator: 6,
        themeIds: ["theme:1"], evidence: [], evidenceSelection: { shownCount: 0, matchingReviewCount: 2, omittedCount: 2 } }],
      concerns: [{ entryId: "concern:1", question: "Derived concern, not real Q&A", status: "证据不足", explanation: "Only a sample theme", themeIds: ["theme:1"] }] } } } });
}
function userPrompt() { return String(mocks.invoke.mock.calls.at(-1)?.[0]?.messages.find((m: { role: string }) => m.role === "user")?.content); }

describe("current adopted research in real advertising, aggregation and image consumers", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.rows = [row()]; mocks.active.clear();
    mocks.getProjectById.mockResolvedValue({ id: 1, userId: 7, workspaceId: 9, name: "Synthetic product" });
    mocks.getKeywordsByProject.mockResolvedValue([]); mocks.createAdStructure.mockResolvedValue({ id: 30 });
    mocks.createReviewAggregation.mockResolvedValue({ id: 31 }); mocks.getReviewAggregationByProject.mockResolvedValue(null);
    mocks.updateReviewAggregation.mockImplementation(async (id, data) => ({ id, ...data }));
    mocks.resolve.mockResolvedValue(null); mocks.use.mockResolvedValue(undefined);
    mocks.invoke.mockResolvedValue({ choices: [{ message: { content: '{"adStructure":{"campaigns":[]},"painPoints":[],"itchPoints":[],"delightPoints":[]}' } }] });
  });
  it("advertising generation consumes current typed research without consulting an older whole-row competitor artifact", async () => {
    adopted();
    await adStructureRouter.createCaller(ctx).generate({ projectId: 1 });
    expect(userPrompt()).toContain("CURRENT_DEEP_ONLY:10");
    expect(userPrompt()).not.toContain("OLD_");
    expect(mocks.resolve.mock.calls.every(([input]) => input.artifactKey !== "listing.competitor_analysis.B000000010")).toBe(true);
    expect(mocks.use).not.toHaveBeenCalled();
  });
  it("advertising unavailable proof has no retained AI fallback", async () => {
    mocks.active.set(10, { status: "unavailable", reasonCode: "SOURCE_CHANGED" });
    await adStructureRouter.createCaller(ctx).generate({ projectId: 1 });
    expect(userPrompt()).toContain("UNAVAILABLE_CURRENT_RESEARCH"); expect(userPrompt()).not.toContain("OLD_");
  });
  it("legacy advertising input and artifact reads retain their original path", async () => {
    await adStructureRouter.createCaller(ctx).generate({ projectId: 1 });
    expect(userPrompt()).toContain("OLD_PAIN_MUST_NOT_REVIVE");
    expect(mocks.resolve.mock.calls.some(([input]) => input.artifactKey === "listing.competitor_analysis.B000000010")).toBe(true);
  });
  it("targeting does not relabel deep sample themes as legacy Kano pain/delight or reuse old keywords", async () => {
    adopted();
    const result = await adStructureRouter.createCaller(ctx).estimateTargeting({ projectId: 1 });
    expect(result.estimates[0]).toMatchObject({ painPoints: [], delightPoints: [], sharedKeywords: [], researchSource: { status: "adopted_deep" } });
    expect(JSON.stringify(result)).not.toContain("OLD_");
  });
  it("aggregation passes exact deep sample groups/denominators/derived concerns, never retained legacy reviews", async () => {
    adopted();
    await reviewAggregationRouter.createCaller(ctx).analyze({ projectId: 1 });
    expect(userPrompt()).toContain("adopted_competitor_review_sample/v1"); expect(userPrompt()).toContain('"denominator":6');
    expect(userPrompt()).toContain("not real Q&A"); expect(userPrompt()).not.toContain("OLD_");
  });
  it.each(["unavailable", "missing_reviews"])("aggregation refuses %s before a model or mutable aggregation is created", async status => {
    if (status === "unavailable") mocks.active.set(10, { status: "unavailable", reasonCode: "SOURCE_CHANGED" }); else adopted(10, false);
    await expect(reviewAggregationRouter.createCaller(ctx).analyze({ projectId: 1 })).rejects.toThrow("暂无竞品评论数据");
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.createReviewAggregation).not.toHaveBeenCalled();
  });
  it("image context uses current research and excludes unbound project-wide aggregation and older competitor artifacts", async () => {
    adopted(); mocks.getReviewAggregationByProject.mockResolvedValue({ status: "completed", painPoints: '["OLD_PROJECT_AGGREGATION"]' });
    const context = await buildImageWorkflowContext(1, { userId: 7, workspaceId: 9 });
    expect(context).toContain("CURRENT_DEEP_ONLY:10"); expect(context).not.toContain("OLD_");
    expect(mocks.getReviewAggregationByProject).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled();
  });
  it("image context also excludes legacy data when adoption proof is unavailable", async () => {
    mocks.active.set(10, { status: "unavailable", reasonCode: "SOURCE_CHANGED" });
    const context = await buildImageWorkflowContext(1);
    expect(context).toContain("UNAVAILABLE_CURRENT_RESEARCH"); expect(context).not.toContain("OLD_");
  });
  it.each(["ad-generation", "ad-targeting", "aggregation", "image"])("%s rejects a different effective workspace before consuming private adopted research", async consumer => {
    adopted(); mocks.getProjectById.mockResolvedValue({ id: 1, userId: 7, workspaceId: null });
    const otherWorkspace = { ...ctx, workspaceId: 8 };
    const run = consumer === "ad-generation" ? () => adStructureRouter.createCaller(otherWorkspace).generate({ projectId: 1 })
      : consumer === "ad-targeting" ? () => adStructureRouter.createCaller(otherWorkspace).estimateTargeting({ projectId: 1 })
      : consumer === "aggregation" ? () => reviewAggregationRouter.createCaller(otherWorkspace).analyze({ projectId: 1 })
      : () => buildImageWorkflowContext(1, { userId: 7, workspaceId: 8 });
    await expect(run()).rejects.toThrow("DEEP_ADOPTION_SOURCE_SCOPE_CHANGED");
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.createReviewAggregation).not.toHaveBeenCalled();
  });
  it("missing image scope or a different actor never grants an adopted private job source", async () => {
    adopted();
    await expect(buildImageWorkflowContext(1)).rejects.toThrow("DEEP_ADOPTION_SOURCE_SCOPE_CHANGED");
    await expect(buildImageWorkflowContext(1, { userId: 8, workspaceId: 9 })).rejects.toThrow("DEEP_ADOPTION_SOURCE_SCOPE_CHANGED");
  });
});
