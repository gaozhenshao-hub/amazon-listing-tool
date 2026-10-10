import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createJob: vi.fn(),
  getProject: vi.fn(),
  listJobs: vi.fn(),
  progress: vi.fn(),
  resolveFacts: vi.fn(),
  runSkill: vi.fn(),
  schedule: vi.fn(),
  syncRunning: vi.fn(),
  getAnalyses: vi.fn(), getReviews: vi.fn(), getKeywords: vi.fn(), getQuestions: vi.fn(), getComparison: vi.fn(),
  buildContext: vi.fn(), loadEnriched: vi.fn(),
  validateTitles: vi.fn(),
}));

vi.mock("./domains/listing/routerContext", () => ({
  MAX_RETRIES: 2,
  buildProductContext: mocks.buildContext,
  loadEnrichedData: mocks.loadEnriched,
  safeParseJSON: JSON.parse,
  validateBullets: vi.fn(() => ({ valid: true, issues: [] })),
  validateTitles: mocks.validateTitles,
}));
vi.mock("./domains/listing/repository", () => ({
  getProjectByIdAdmin: mocks.getProject,
  getCompetitorAnalysesByProject: mocks.getAnalyses,
  getReviewAggregationByProject: mocks.getReviews,
  getKeywordsByProject: mocks.getKeywords,
  getActiveBuyerQuestionsByProject: mocks.getQuestions,
  getLatestConfirmedCompetitorComparisonReport: mocks.getComparison,
  getProjectFilesByProject: vi.fn(),
}));
vi.mock("./domains/listing/service", () => ({ runEmperorSkill: mocks.runSkill }));
vi.mock("./domains/listing/services/listingFactSource", () => ({
  resolveCurrentConfirmedListingFacts: mocks.resolveFacts,
}));
vi.mock("./domains/listing/services/listingConfirmedCore", () => ({ resolveConfirmedListingCore: vi.fn() }));
vi.mock("./domains/listing/services/listingCandidateProvenance", () => ({ persistGeneratedBulletCandidate: vi.fn() }));
vi.mock("./domains/ai_os/services/jobRunner", () => ({
  cancelAiJob: vi.fn(),
  createAiJobRun: mocks.createJob,
  listAiJobRunsForUser: mocks.listJobs,
  registerAiJobHandler: vi.fn(),
  scheduleAiJobRun: mocks.schedule,
  updateAiJobProgress: mocks.progress,
}));
vi.mock("./domains/listing/listingAgentBridge", () => ({
  LISTING_GENERATION_NODE_MAP: { sellingPoints: "G1", title: "G2", description: "G3", searchTerms: "G4", qa: "G5" },
  syncListingNodeJobFailed: vi.fn(),
  syncListingNodeJobQueued: vi.fn(),
  syncListingNodeJobRunning: mocks.syncRunning,
  syncListingNodeJobWaitingHuman: vi.fn(),
  syncListingPreparationNodeConfirmed: vi.fn(),
}));

import {
  runListingGenerationJob,
  startListingGenerationJob,
} from "./domains/listing/services/generationJob";

const rawHash = "a".repeat(64);
const changedHash = "b".repeat(64);
const currentFacts = {
  source: { fileId: 71, rawHash },
  facts: [{ id: 41, attributeKey: "Material", value: "ABS plastic", confirmedBy: 7, confirmedAt: new Date() }],
};
const project = {
  id: 3,
  workspaceId: 9,
  productName: "Safe Product",
  brand: "Safe Brand",
  category: "Storage",
  targetMarket: "US",
  // These values must never enter a fact-bound model prompt.
  productSpecs: JSON.stringify({ capacity: "999 L" }),
};
const binding = { sourceFileId: 71, rawHash, factRevisionIds: [41] };

function parsedFor(operation: string) {
  if (operation === "sellingPoints") return {
    sellingPoints: Array.from({ length: 7 }, (_, index) => ({
      index: index + 1, theme: `Planning angle ${index + 1}`, themeZh: `策划方向 ${index + 1}`,
      description: "Research needed before promising a benefit.", descriptionZh: "待补证，不能承诺本品效果。",
      fabeDirection: { feature: "ABS plastic", advantage: "Evidence gap", benefit: "Evidence gap", evidence: "Confirmed fact 41: ABS plastic" },
      targetKeywords: [], addressesGap: "Review evidence is not supplied; investigate buyer concerns.", checkListTargets: [],
    })),
    overallStrategy: "Only material is confirmed; the remaining directions require research and evidence.",
    checkListCoverage: { B4_order: "Put the supported material direction first; later angles are pending evidence, not review consensus." },
  };
  if (operation === "title") return { titles: [{ title: "Safe Product", itemHighlights: "ABS Plastic Storage" }] };
  if (operation === "description") return { description: "ABS plastic storage.", htmlDescription: "ABS plastic storage." };
  if (operation === "searchTerms") return { searchTerms: "storage organizer", categories: { synonyms: [], relatedTerms: [], alternateSpellings: [], useCases: [] } };
  return { qaItems: [{ question: "What is it made of?", answer: "It uses ABS plastic.", category: "category_standard", priority: "high" }] };
}

function job(
  operation: "sellingPoints" | "title" | "description" | "searchTerms" | "qa",
  factBinding: typeof binding | null = binding,
) {
  const nodeId = operation === "sellingPoints" ? "G1" : operation === "title" ? "G2"
    : operation === "description" ? "G3" : operation === "searchTerms" ? "G4" : "G5";
  return {
    runId: `job-${operation}`,
    attempt: 1,
    maxAttempts: 1,
    projectId: 3,
    userId: 7,
    workspaceId: 9,
    input: { projectId: 3, operation, nodeId, scopeKey: "main", ...(factBinding ? { factBinding } : {}) },
  } as any;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.getProject.mockResolvedValue(project);
  mocks.listJobs.mockResolvedValue([]);
  mocks.resolveFacts.mockResolvedValue(currentFacts);
  mocks.getAnalyses.mockResolvedValue([]);
  mocks.getReviews.mockResolvedValue(null);
  mocks.getKeywords.mockResolvedValue([]);
  mocks.getQuestions.mockResolvedValue([]);
  mocks.getComparison.mockResolvedValue(null);
  mocks.validateTitles.mockReturnValue({ valid: true, issues: [] });
  mocks.runSkill.mockImplementation(async ({ skillSlug }: { skillSlug: string }) => ({
    parsed: parsedFor(skillSlug.replace("listing.", "").replace(".generate", "").replace("searchterms", "searchTerms").replace("sellingpoints", "sellingPoints")),
  }));
  mocks.createJob.mockResolvedValue({ runId: "new-job", progress: 5 });
  mocks.schedule.mockResolvedValue(undefined);
});

describe("0204 fact-bound Listing field jobs", () => {
  it.each(["sellingPoints", "title", "description", "searchTerms", "qa"] as const)(
    "%s snapshots only current confirmed fact IDs and raw-file hash at enqueue",
    async (operation) => {
      const queued = await startListingGenerationJob({
        projectId: 3,
        userId: 7,
        workspaceId: 9,
        operation,
        nodeId: job(operation).input.nodeId,
        factBinding: { sourceFileId: 999, rawHash: changedHash, factRevisionIds: [999] },
      });

      expect(queued).toMatchObject({ runId: "new-job" });
      expect(mocks.createJob).toHaveBeenCalledWith(expect.objectContaining({
        input: expect.objectContaining({ factBinding: binding }),
      }));
    },
  );

  it("fails closed before a provider call when a historical field job has no fact binding", async () => {
    await expect(runListingGenerationJob(job("title", null), { signal: new AbortController().signal } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getProject).toHaveBeenCalledWith(3, 9);
    expect(mocks.resolveFacts).not.toHaveBeenCalled();
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });

  it("rechecks the raw hash immediately before the model and stops when facts changed after queueing", async () => {
    mocks.resolveFacts.mockResolvedValueOnce(currentFacts).mockResolvedValueOnce({
      ...currentFacts,
      source: { fileId: 71, rawHash: changedHash },
    });

    await expect(runListingGenerationJob(job("description"), { signal: new AbortController().signal } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });

  it("模型结果晚到时再次核对已审事实，原始表变化不能作为当前候选返回", async () => {
    mocks.resolveFacts.mockResolvedValueOnce(currentFacts).mockResolvedValueOnce(currentFacts)
      .mockResolvedValueOnce({ ...currentFacts, source: { fileId: 71, rawHash: changedHash } });
    await expect(runListingGenerationJob(job("description"), { signal: new AbortController().signal } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.runSkill).toHaveBeenCalledOnce();
  });

  it("uses only service-resolved confirmed facts in a field-model prompt, never project specs", async () => {
    await runListingGenerationJob(job("qa"), { signal: new AbortController().signal } as any);

    const call = mocks.runSkill.mock.calls[0][0];
    expect(call.context).toContain("ABS plastic");
    expect(call.context).not.toContain("999 L");
    expect(JSON.stringify(call.variables)).toContain("ABS plastic");
    expect(JSON.stringify(call.variables)).not.toContain("999 L");
  });

  it("G1 passes same-project research separately from confirmed product facts, without loading extracted attributes", async () => {
    mocks.listJobs.mockResolvedValue([job("sellingPoints")]);
    mocks.getAnalyses.mockResolvedValue([{ id: 81, projectId: 3, asin: "B000000081", title: "Competitor 9000W product",
      bulletPoints: JSON.stringify(["Competitor lifetime warranty"]), rawData: "DO NOT PASS RAW UPLOAD",
      reviewAnalysis: JSON.stringify({ painPoints: [{ issue: "Difficult to carry", frequency: 12 }] }) }]);
    mocks.getKeywords.mockResolvedValue([{ id: 61, projectId: 3, keyword: "travel storage", monthlySearchVolume: 200,
      sceneTags: JSON.stringify(["travel"]), intentTag: "portable organization", isNegative: 0 }]);
    mocks.getQuestions.mockResolvedValue([{ id: 51, projectId: 3, question: "Is it easy to carry?", status: "active", priority: "high",
      source: "competitor_review", suggestedAnswer: "UNVERIFIED product promise" }]);
    const task = job("sellingPoints");
    task.input.emphasis = "Focus on travel buyers";
    const result = await runListingGenerationJob(task, { signal: new AbortController().signal } as any);
    const call = mocks.runSkill.mock.calls[0][0];
    expect(call.context).toContain("Difficult to carry");
    expect(call.context).toContain("Competitor 9000W product");
    expect(call.context).toContain("travel storage");
    expect(call.context).toContain("Is it easy to carry?");
    expect(call.context).toContain("Focus on travel buyers");
    expect(call.context).toContain("Only the current human-confirmed product facts above");
    expect(call.context).toContain("A competitor complaint is a buyer concern, not proof we solved it");
    expect(call.variables.confirmedFacts).toEqual([{ id: 41, attributeKey: "Material", value: "ABS plastic" }]);
    expect(call.variables.analyses).toBeUndefined();
    expect(call.variables.enrichedData).toBeUndefined();
    expect(call.context).not.toContain("DO NOT PASS RAW UPLOAD");
    expect(call.context).not.toContain("UNVERIFIED product promise");
    expect(call.context).not.toContain("999 L");
    expect(mocks.buildContext).not.toHaveBeenCalled();
    expect(mocks.loadEnriched).not.toHaveBeenCalled();
    for (const getter of [mocks.getAnalyses, mocks.getReviews, mocks.getKeywords, mocks.getQuestions, mocks.getComparison]) {
      expect(getter).toHaveBeenCalledWith(3);
    }
    expect(result.sellingPoints).toHaveLength(7);
    expect(result.researchLimitations).toContainEqual(expect.stringContaining("已确认竞品对比"));
    expect(result.researchLimitations).not.toContainEqual(expect.stringContaining("缺少可用评论洞察"));
  });

  it("G1 reports missing comments and competitors honestly and overrides model-provided source claims", async () => {
    mocks.listJobs.mockResolvedValue([job("sellingPoints")]);
    mocks.runSkill.mockResolvedValue({ parsed: { ...parsedFor("sellingPoints"), researchLimitations: [] } });
    const result = await runListingGenerationJob(job("sellingPoints"), { signal: new AbortController().signal } as any);
    const call = mocks.runSkill.mock.calls[0][0];
    expect(call.variables.planningResearch.competitors.status).toBe("missing");
    expect(call.variables.planningResearch.reviews.status).toBe("missing");
    expect(result.researchLimitations).toContainEqual(expect.stringContaining("缺少可用评论洞察"));
    expect(result.researchLimitations).toContainEqual(expect.stringContaining("缺少可用竞品资料"));
    expect(call.context).toContain("evidence gap");
  });

  it("G1 rejects incomplete direction count and ranking inside the model validator as well as the final return", async () => {
    await runListingGenerationJob(job("sellingPoints"), { signal: new AbortController().signal } as any);
    const call = mocks.runSkill.mock.calls[0][0];
    expect(call.maxModelAttempts).toBe(3);
    expect(() => call.validate(JSON.stringify({ sellingPoints: [{ index: 1 }] }))).toThrow(/7条/);
    expect(() => call.validate(JSON.stringify({ ...parsedFor("sellingPoints"), checkListCoverage: {} }))).toThrow(/排序逻辑/);
    expect(call.validate(JSON.stringify(parsedFor("sellingPoints"))).sellingPoints).toHaveLength(7);
    mocks.runSkill.mockResolvedValue({ parsed: { sellingPoints: [{ index: 1 }] } });
    await expect(runListingGenerationJob(job("sellingPoints"), { signal: new AbortController().signal } as any)).rejects.toThrow(/7条/);
  });

  it.each(["title", "description", "searchTerms", "qa"] as const)("%s keeps the original fact-only boundary", async operation => {
    await runListingGenerationJob(job(operation), { signal: new AbortController().signal } as any);
    const call = mocks.runSkill.mock.calls[0][0];
    expect(call.variables.planningResearch).toBeUndefined();
    expect(call.context).not.toContain("G1 SELLING-POINT PLANNING CONTRACT");
    expect(mocks.getAnalyses).not.toHaveBeenCalled();
    expect(mocks.getReviews).not.toHaveBeenCalled();
    expect(call.context).toContain("ABS plastic");
  });

  it("G1 still rejects a raw fact hash change while the provider is running", async () => {
    mocks.resolveFacts.mockResolvedValueOnce(currentFacts).mockResolvedValueOnce(currentFacts)
      .mockResolvedValueOnce({ ...currentFacts, source: { fileId: 71, rawHash: changedHash } });
    await expect(runListingGenerationJob(job("sellingPoints"), { signal: new AbortController().signal } as any))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.runSkill).toHaveBeenCalledOnce();
  });

  it("G1 does not relabel a research database failure as missing evidence", async () => {
    mocks.getReviews.mockRejectedValue(new Error("review database unavailable"));
    await expect(runListingGenerationJob(job("sellingPoints"), { signal: new AbortController().signal } as any)).rejects.toThrow("review database unavailable");
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });
});
