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
}));

vi.mock("./domains/listing/routerContext", () => ({
  MAX_RETRIES: 2,
  buildProductContext: vi.fn(),
  loadEnrichedData: vi.fn(),
  safeParseJSON: JSON.parse,
  validateBullets: vi.fn(() => ({ valid: true, issues: [] })),
  validateTitles: vi.fn(() => ({ valid: true, issues: [] })),
}));
vi.mock("./domains/listing/repository", () => ({
  getProjectByIdAdmin: mocks.getProject,
  getCompetitorAnalysesByProject: vi.fn(),
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
  if (operation === "sellingPoints") return { sellingPoints: [{ index: 1, theme: "Material", description: "ABS plastic" }] };
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
  mocks.runSkill.mockImplementation(async ({ skillSlug }: { skillSlug: string }) => ({
    parsed: parsedFor(skillSlug.replace("listing.", "").replace(".generate", "").replace("searchterms", "searchTerms")),
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
});
