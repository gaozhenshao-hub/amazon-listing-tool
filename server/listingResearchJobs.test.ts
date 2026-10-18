import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CompetitorAnalysis, CompetitorComparisonReport } from "../drizzle/schema/project";
import type { AiJobHandlerContext, AiJobSnapshot } from "./domains/ai_os/services/jobRunner";
import type { ListingGenerationJobInput } from "./domains/listing/services/generationJob";

// Keep the route, context permissions, selection/binding service, fact-source
// validation and planning projection real. Only persistence and external/model
// boundaries below are in memory; no DB, HTTP, Agent execution or provider runs.
const mocks = vi.hoisted(() => ({
  getProject: vi.fn(), getOwnedProject: vi.fn(), getAnalyses: vi.fn(), getComparison: vi.fn(),
  getLatestComparison: vi.fn(), getReviews: vi.fn(), getKeywords: vi.fn(), getQuestions: vi.fn(),
  getFiles: vi.fn(), getDb: vi.fn(), factRows: vi.fn(),
  getListing: vi.fn(), createListing: vi.fn(), updateListing: vi.fn(), ensureAgent: vi.fn(),
  syncPreparation: vi.fn(), syncQueued: vi.fn(), syncRunning: vi.fn(), syncWaiting: vi.fn(), syncFailed: vi.fn(),
  createJob: vi.fn(), listJobs: vi.fn(), schedule: vi.fn(), progress: vi.fn(), cancel: vi.fn(),
  runSkill: vi.fn(), forbiddenIo: vi.fn(),
  handler: { current: null as null | {
    handler: (job: AiJobSnapshot, context: AiJobHandlerContext) => Promise<unknown>;
  } },
}));

vi.mock("./domains/listing/repository", () => ({
  getProjectByIdAdmin: mocks.getProject, getProjectById: mocks.getOwnedProject,
  getCompetitorAnalysesByProject: mocks.getAnalyses,
  getLatestCompetitorComparisonReport: mocks.getComparison,
  getLatestConfirmedCompetitorComparisonReport: mocks.getLatestComparison,
  getReviewAggregationByProject: mocks.getReviews,
  getKeywordsByProject: mocks.getKeywords, getActiveBuyerQuestionsByProject: mocks.getQuestions,
  getProjectFilesByProject: mocks.getFiles, getDb: mocks.getDb,
  getActiveListingByProject: mocks.getListing,
  createListing: mocks.createListing, updateListing: mocks.updateListing,
}));
vi.mock("./domains/listing/service", () => ({
  runEmperorSkill: mocks.runSkill,
  buildListingContext: mocks.forbiddenIo, checkDataReadiness: mocks.forbiddenIo,
  contextToPromptText: mocks.forbiddenIo,
}));
vi.mock("./domains/listing/listingAgentBridge", () => ({
  LISTING_GENERATION_NODE_MAP: { sellingPoints: "G1", singleBullet: "G1", title: "G2", description: "G3", searchTerms: "G4", qa: "G5" },
  ensureListingAgentRun: mocks.ensureAgent,
  syncListingPreparationNodeConfirmed: mocks.syncPreparation,
  syncListingNodeJobQueued: mocks.syncQueued, syncListingNodeJobRunning: mocks.syncRunning,
  syncListingNodeJobWaitingHuman: mocks.syncWaiting, syncListingNodeJobFailed: mocks.syncFailed,
  syncGenerationToAgent: mocks.forbiddenIo, syncListingPreviewConfirmed: mocks.forbiddenIo,
  syncListingPreviewWaitingHuman: mocks.forbiddenIo, syncStepLockToAgent: mocks.forbiddenIo,
  syncStepUnlockToAgent: mocks.forbiddenIo,
}));
vi.mock("./domains/ai_os/services/jobRunner", () => ({
  cancelAiJob: mocks.cancel, createAiJobRun: mocks.createJob,
  listAiJobRunsForUser: mocks.listJobs, scheduleAiJobRun: mocks.schedule,
  updateAiJobProgress: mocks.progress,
  registerAiJobHandler: (handler: NonNullable<typeof mocks.handler.current>) => { mocks.handler.current = handler; },
}));
vi.mock("./domains/ai_os/services/agentRunner/artifactStore", () => ({ listAgentArtifacts: mocks.forbiddenIo }));
vi.mock("./domains/ai_os/services/agentRunner/checkpointStore", () => ({ getCheckpoint: mocks.forbiddenIo }));
vi.mock("./domains/knowledge/claimLedgerService", () => ({ resolveWorkflowGuidance: mocks.forbiddenIo }));
vi.mock("./domains/ai_os/services/businessSkillGateway", () => ({ invokeBusinessSkill: mocks.forbiddenIo }));
vi.mock("./storage", () => ({ parseStorageUri: mocks.forbiddenIo, storageGet: mocks.forbiddenIo }));
vi.mock("./infrastructure/http/safeHttpClient", () => ({ safeHttpRequest: mocks.forbiddenIo }));
vi.mock("./repositories/dbClient", () => ({ getDb: mocks.forbiddenIo }));

import { listingFactRevisions } from "../drizzle/schema/listingRevisions";
import { router } from "./_core/trpc";
import { listingJobControlProcedures, startListingJobForContext } from "./domains/listing/routers/jobControl";
import { prepareListingResearchSelection } from "./domains/listing/services/listingResearchSelection";
import { runListingGenerationJob, startListingGenerationJob, syncListingPreparationNodes } from "./domains/listing/services/generationJob";
import { issueActiveCompetitorResearch } from "./services/competitorActiveResearch";
import { competitorRevision } from "./repositories/project/competitorWritePolicy";

const stamp = new Date("2026-10-16T00:00:00.000Z");
const rawText = "Material: ABS plastic";
const rawHash = createHash("sha256").update(JSON.stringify(rawText)).digest("hex");
const factBinding = { sourceFileId: 71, rawHash, factRevisionIds: [41] };
const project = { id: 3, userId: 7, workspaceId: 9, productName: "Research-bound product", brand: "Synthetic",
  category: "Storage", targetMarket: "US", productSpecs: '{"forbiddenUnreviewedClaim":"999 L"}' };
const file = { id: 71, projectId: 3, workspaceId: 9, fileType: "product_attributes", status: "completed",
  lifecycleState: "active", rawContent: rawText, rawContentHash: rawHash, rawStorageUri: null,
  analysisResult: null, createdAt: stamp };
const facts = [{ id: 41, workspaceId: 9, projectId: 3, sourceFileId: 71, rawHash,
  status: "confirmed", attributeKey: "Material", value: "ABS plastic", confirmedBy: 7, confirmedAt: stamp }];

function analysis(id: number, patch: Partial<CompetitorAnalysis> = {}): CompetitorAnalysis {
  return {
    id, projectId: 3, asin: `B${String(id).padStart(9, "0")}`, title: `Selected research ${id}`,
    bulletPoints: JSON.stringify([`External claim ${id}`]), imageUrls: "[]", price: "0", rating: "0", reviewCount: "0",
    reviewAnalysis: JSON.stringify({ painPoints: [{ point: `Per-ASIN concern ${id}`, frequency: 0 }] }),
    keywords: "[]", rawData: '{"count":0,"enabled":false}', aiSummary: `Unconfirmed research ${id}`,
    summary: null, summaryStatus: "draft", summaryVersion: 1, summaryConfirmedBy: null, summaryConfirmedAt: null,
    createdAt: stamp, updatedAt: stamp, ...patch,
  };
}
function comparison(ids = [11], patch: Partial<CompetitorComparisonReport> = {}): CompetitorComparisonReport {
  return {
    id: 90, projectId: 3, workspaceId: 9, userId: 7, selectionKey: [...ids].sort((a, b) => a - b).join("-"),
    analysisIds: JSON.stringify(ids), analyzedAsins: JSON.stringify(ids.map(id => analysis(id).asin)),
    aiSummary: "Untrusted comparison", summary: "Exact-selected reviewed comparison",
    sellingPointRows: '[{"selected":true,"theme":"Source-bound comparison","humanNote":"Reviewed external research"}]',
    status: "confirmed", version: 1, confirmedBy: 7, confirmedAt: stamp, createdAt: stamp, updatedAt: stamp, ...patch,
  };
}
function validPlan() {
  return {
    sellingPoints: Array.from({ length: 7 }, (_, index) => ({
      index: index + 1, theme: `Planning angle ${index + 1}`, themeZh: `策划方向 ${index + 1}`,
      description: "Research needed before promising a benefit.", descriptionZh: "待补证，不能承诺本品效果。",
      fabeDirection: { feature: "ABS plastic", advantage: "Evidence gap", benefit: "Evidence gap", evidence: "Confirmed fact 41: ABS plastic" },
      targetKeywords: [], addressesGap: "Only based on confirmed product facts; evidence gap.", checkListTargets: [],
    })),
    overallStrategy: "Only material is confirmed; remaining directions require evidence.",
    checkListCoverage: { B4_order: "Material first; all later angles are pending evidence." },
  };
}
let rows: CompetitorAnalysis[];
let report: CompetitorComparisonReport | null;
let stored: AiJobSnapshot[];
type Start = Parameters<typeof startListingGenerationJob>[0];
const startInput = (patch: Partial<Start> = {}): Start => ({
  projectId: 3, userId: 7, workspaceId: 9, operation: "sellingPoints", nodeId: "G1", scopeKey: "main", analysisIds: [11], ...patch,
});
const context = (): AiJobHandlerContext => ({ signal: new AbortController().signal } as AiJobHandlerContext);
const api = router(listingJobControlProcedures);
function caller(userPatch: Record<string, unknown> = {}, workspaceId: number | null = 9) {
  return api.createCaller({ user: { id: 7, role: "ops_specialist", defaultWorkspaceId: workspaceId, ...userPatch },
    workspaceId, requestId: "synthetic-selection-test", req: {}, res: {} } as Parameters<typeof api.createCaller>[0]);
}
const publicInput = (patch: Record<string, unknown> = {}) => ({
  projectId: 3, operation: "sellingPoints" as const, nodeId: "G1" as const, analysisIds: [11], ...patch,
});
async function boundJob(...args: [] | [number[] | undefined]) {
  const analysisIds = args.length ? args[0] : [11];
  const { binding } = await prepareListingResearchSelection({ projectId: 3, workspaceId: 9, analysisIds });
  const job = {
    runId: "restored-job", userId: 7, workspaceId: 9, projectId: 3, status: "running", progress: 5,
    module: "listing", procedure: "listing.startGenerationJob", attempt: 1, maxAttempts: 3,
    input: { ...startInput(), analysisIds: binding.analysisIds, researchBinding: binding, factBinding },
  } as AiJobSnapshot;
  stored = [job];
  return job;
}
function noWritesOrModels() {
  for (const fn of [mocks.ensureAgent, mocks.createListing, mocks.updateListing, mocks.createJob,
    mocks.syncPreparation, mocks.syncQueued, mocks.schedule, mocks.runSkill]) expect(fn).not.toHaveBeenCalled();
}

beforeEach(() => {
  vi.resetAllMocks();
  rows = [analysis(11), analysis(22, { title: "UNSELECTED_COMPETITOR_SECRET", aiSummary: "UNSELECTED_SUMMARY_SECRET" })];
  report = null;
  stored = [];
  mocks.forbiddenIo.mockImplementation(() => { throw new Error("Unexpected external/persistence boundary"); });
  mocks.getProject.mockImplementation(async () => structuredClone(project));
  mocks.getOwnedProject.mockImplementation(async (_id, actorId, workspaceId) =>
    actorId === 7 && workspaceId === 9 ? structuredClone(project) : undefined);
  mocks.getAnalyses.mockImplementation(async () => structuredClone(rows));
  mocks.getComparison.mockImplementation(async () => structuredClone(report));
  mocks.getLatestComparison.mockResolvedValue(comparison([22], { summary: "UNBOUND_COMPARISON_SECRET" }));
  mocks.getReviews.mockResolvedValue({ id: 52, projectId: 3, status: "completed",
    painPoints: '[{"point":"UNBOUND_AGGREGATE_SECRET","frequency":999}]' });
  mocks.getKeywords.mockResolvedValue([]);
  mocks.getQuestions.mockResolvedValue([]);
  mocks.getFiles.mockImplementation(async () => [structuredClone(file)]);
  mocks.factRows.mockImplementation(async () => structuredClone(facts));
  mocks.getDb.mockResolvedValue({ select: () => ({ from: (table: unknown) => {
    expect(table).toBe(listingFactRevisions);
    return { where: mocks.factRows };
  } }) });
  mocks.getListing.mockResolvedValue(undefined);
  mocks.createListing.mockImplementation(async value => ({ id: 80, ...value }));
  mocks.ensureAgent.mockResolvedValue("synthetic-agent");
  mocks.listJobs.mockImplementation(async () => stored);
  mocks.createJob.mockImplementation(async value => {
    const job = { ...value, input: JSON.parse(JSON.stringify(value.input)), runId: `job-${stored.length + 1}`,
      status: "queued", attempt: 1, maxAttempts: 3 } as AiJobSnapshot;
    stored.unshift(job);
    return job;
  });
  mocks.runSkill.mockImplementation(async ({ validate }) => ({ parsed: validate(JSON.stringify(validPlan())), runId: "mock-model-run" }));
});

describe("G1 public admission and server-owned persisted selection", () => {
  it("accepts public IDs, sorts them and persists the server-derived source binding", async () => {
    const result = await caller().startGenerationJob(publicInput({ analysisIds: [22, 11] }));
    expect(result.input).toMatchObject({ analysisIds: [11, 22], researchBinding: {
      version: 1, projectId: 3, workspaceId: 9, mode: "explicit", analysisIds: [11, 22], sourceHash: expect.stringMatching(/^[a-f0-9]{64}$/u),
    }, factBinding });
    expect(mocks.getOwnedProject).toHaveBeenCalledWith(3, 7, 9);
    expect(mocks.getComparison).toHaveBeenCalledWith(3, "11-22");
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });

  it("the public schema cannot choose a browser-supplied binding", async () => {
    const result = await caller().startGenerationJob(publicInput({ researchBinding: {
      version: 1, projectId: 3, workspaceId: 9, mode: "legacy_all", analysisIds: [22], sourceHash: "f".repeat(64),
    } }) as never);
    const expected = await prepareListingResearchSelection({ projectId: 3, workspaceId: 9, analysisIds: [11] });
    expect((result.input as ListingGenerationJobInput).researchBinding).toEqual(expected.binding);
    expect((result.input as ListingGenerationJobInput).researchBinding?.sourceHash).not.toBe("f".repeat(64));
  });

  it("the standalone service ignores a supplied hash and derives its own snapshot", async () => {
    const result = await startListingGenerationJob(startInput({ researchBinding: {
      version: 1, projectId: 3, workspaceId: 9, mode: "legacy_all", analysisIds: [22], sourceHash: "f".repeat(64),
    } }));
    const expected = await prepareListingResearchSelection({ projectId: 3, workspaceId: 9, analysisIds: [11] });
    expect((result.input as ListingGenerationJobInput).researchBinding).toEqual(expected.binding);
  });

  it("an omitted selection freezes legacy_all, not a future all-project query", async () => {
    const result = await caller().startGenerationJob(publicInput({ analysisIds: undefined }));
    expect(result.input).toMatchObject({ analysisIds: [11, 22], researchBinding: { mode: "legacy_all", analysisIds: [11, 22] } });
  });

  it("an explicit empty selection stays empty instead of falling back to all", async () => {
    const result = await caller().startGenerationJob(publicInput({ analysisIds: [] }));
    expect(result.input).toMatchObject({ analysisIds: [], researchBinding: { mode: "explicit", analysisIds: [] } });
  });

  it("preparation checkpoints receive the same selected research, not project-wide fallback", async () => {
    report = comparison();
    await caller().startGenerationJob(publicInput());
    const prepared = mocks.syncPreparation.mock.calls.map(([value]) => value);
    expect(prepared.find(value => value.nodeId === "N1").output.map((row: { id: number }) => row.id)).toEqual([11]);
    expect(prepared.find(value => value.nodeId === "N2").output).toMatchObject({ id: 90, selectionKey: "11" });
    expect(prepared.find(value => value.nodeId === "N5").output).toMatchObject({
      projectAggregationExcluded: true, records: [{ analysisId: 11, asin: "B000000011" }],
    });
    for (const marker of ["UNSELECTED_COMPETITOR_SECRET", "UNBOUND_COMPARISON_SECRET", "UNBOUND_AGGREGATE_SECRET"])
      expect(JSON.stringify(prepared)).not.toContain(marker);
  });

  it("revalidates a route-prepared binding before enqueue if a preparation write awaits a source change", async () => {
    mocks.syncPreparation.mockImplementationOnce(async () => { rows[0].price = "9"; });
    await expect(caller().startGenerationJob(publicInput())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.ensureAgent).toHaveBeenCalledTimes(1);
    expect(mocks.createJob).not.toHaveBeenCalled();
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });

  it.each([[11, 11], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1], Array.from({ length: 1001 }, (_, i) => i + 1)].map(ids => ({ ids })))(
    "rejects malformed public IDs before any creation (%#)", async ({ ids }) => {
      await expect(caller().startGenerationJob(publicInput({ analysisIds: ids }))).rejects.toMatchObject({ code: "BAD_REQUEST" });
      noWritesOrModels();
    },
  );

  it.each(["missing", "foreign-analysis", "foreign-comparison", "foreign-parent"])(
    "rejects %s before Agent, Listing, job or model side effects", async kind => {
      if (kind === "missing") rows = [];
      if (kind === "foreign-analysis") rows[0].projectId = 4;
      if (kind === "foreign-comparison") report = comparison([11], { workspaceId: 10 });
      if (kind === "foreign-parent") mocks.getProject.mockResolvedValue({ ...project, workspaceId: 10 });
      await expect(caller().startGenerationJob(publicInput())).rejects.toThrow();
      noWritesOrModels();
    },
  );

  it("retains the real context's owner/designer access check", async () => {
    await expect(caller({ id: 8 }).startGenerationJob(publicInput())).rejects.toThrow();
    await expect(caller({ id: 8, role: "designer" }).startGenerationJob(publicInput())).rejects.toThrow();
    noWritesOrModels();
  });

  it("fails before side effects when the authenticated workspace cannot supply current facts", async () => {
    await expect(startListingJobForContext(startInput({ workspaceId: null }))).rejects.toThrow();
    noWritesOrModels();
  });

  it("rejects expected-workspace drift before project reads, Agent, Listing or jobs", async () => {
    await expect(caller().startGenerationJob(publicInput({ expectedWorkspaceId: 10 }))).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getOwnedProject).not.toHaveBeenCalled();
    expect(mocks.getProject).not.toHaveBeenCalled();
    noWritesOrModels();
  });

  it("rejects listGenerationRuns workspace drift before project or job reads", async () => {
    await expect(caller().listGenerationRuns({ projectId: 3, expectedWorkspaceId: 10 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getOwnedProject).not.toHaveBeenCalled();
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.listJobs).not.toHaveBeenCalled();
    noWritesOrModels();
  });

  it("the standalone entry also rejects missing selected research before creating a job", async () => {
    await expect(startListingGenerationJob(startInput({ analysisIds: [999] }))).rejects.toMatchObject({ code: "NOT_FOUND" });
    noWritesOrModels();
  });
});

describe("G1 active-job identity and research conflicts", () => {
  it("reuses an identical active binding without Agent/Listing/job writes", async () => {
    const active = await boundJob();
    active.status = "queued";
    expect(await caller().startGenerationJob(publicInput())).toBe(active);
    noWritesOrModels();
  });

  it.each(["ids", "mode", "source", "operation", "user"])(
    "does not reuse an active task with different %s", async kind => {
      if (kind === "mode") rows = [rows[0]];
      const active = await boundJob(kind === "ids" ? [22] : kind === "mode" ? undefined : [11]);
      active.status = "running";
      if (kind === "source") rows[0].price = "1";
      if (kind === "operation") (active.input as ListingGenerationJobInput).operation = "title";
      if (kind === "user") active.userId = 8;
      await expect(caller().startGenerationJob(publicInput())).rejects.toMatchObject({ code: "CONFLICT" });
      noWritesOrModels();
    },
  );

  it.each(["public", "standalone"])("%s enqueue does not reuse another workspace's active job", async entry => {
    const foreign = await boundJob();
    foreign.workspaceId = 10;
    (foreign.input as ListingGenerationJobInput).researchBinding!.workspaceId = 10;
    const queued = entry === "public" ? await caller().startGenerationJob(publicInput())
      : await startListingGenerationJob(startInput());
    expect(queued.runId).not.toBe(foreign.runId);
    expect(queued.workspaceId).toBe(9);
    expect(queued.input).toMatchObject({ researchBinding: { workspaceId: 9, analysisIds: [11] } });
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });

  it("does not reuse another scope's active task", async () => {
    const active = await boundJob();
    (active.input as ListingGenerationJobInput).scopeKey = "other";
    const queued = await caller().startGenerationJob(publicInput());
    expect(queued.runId).not.toBe(active.runId);
    expect(queued.input).toMatchObject({ scopeKey: "main" });
    expect(mocks.createJob).toHaveBeenCalledTimes(1);
  });

  it("the standalone enqueue rechecks conflicts even without the route preflight", async () => {
    await boundJob([22]);
    await expect(startListingGenerationJob(startInput())).rejects.toMatchObject({ code: "CONFLICT" });
    noWritesOrModels();
  });

  it("does not reuse an old active task that has no persisted selection binding", async () => {
    const active = await boundJob();
    delete (active.input as ListingGenerationJobInput).researchBinding;
    await expect(caller().startGenerationJob(publicInput())).rejects.toMatchObject({ code: "CONFLICT" });
    noWritesOrModels();
  });
});

describe("legacy NULL-project history is isolated by the authenticated job workspace", () => {
  it.each([{ workspaceId: 10, userId: 7 }, { workspaceId: null, userId: 7 }, { workspaceId: 9, userId: 8 }])(
    "rejects privately adopted research before any N0-N5 preparation write: %j", async scope => {
      const row = analysis(11, { rawData: '{"deepAdoptionRef":{}}' });
      // A trusted-issuance boundary fixture isolates this consumer check. The
      // writer→loader→selection suite independently verifies real proof replay.
      issueActiveCompetitorResearch(row, { status: "adopted_deep", identity: { userId: 7, workspaceId: 9,
        sourceWorkspaceId: null, projectId: 3, analysisId: 11, asin: row.asin }, currentRevision: competitorRevision(row),
        ref: {} as never, result: {} as never, summary: "Private external research" });
      mocks.getProject.mockResolvedValue({ ...project, workspaceId: null });
      mocks.getAnalyses.mockResolvedValue([row]);
      await expect(syncListingPreparationNodes({ projectId: 3, ...scope, agentRunId: "synthetic-agent" }))
        .rejects.toThrow("DEEP_ADOPTION_SOURCE_SCOPE_CHANGED");
      noWritesOrModels();
    });
  async function mixedHistory() {
    const base = await boundJob();
    // Parent visibility is intentionally shared by the legacy NULL policy.
    // Repository/job-store mocks return mixed workspaces; real service filtering
    // must enforce isolation rather than relying on a mock to prefilter them.
    mocks.getOwnedProject.mockImplementation(async (_id, actorId) =>
      actorId === 7 ? { ...project, workspaceId: null } : undefined);
    mocks.getProject.mockResolvedValue({ ...project, workspaceId: null });
    stored = [10, null, 9].map(workspaceId => ({
      ...base, runId: `workspace-${workspaceId}`, workspaceId, status: "queued",
      input: { ...base.input as ListingGenerationJobInput,
        researchBinding: { ...(base.input as ListingGenerationJobInput).researchBinding!, workspaceId } },
    }));
    mocks.cancel.mockImplementation(async runId => ({ ...stored.find(job => job.runId === runId), status: "canceled" }));
  }

  it.each([9, 10, null])("list/get expose only exact workspace %s, including literal NULL", async workspaceId => {
    await mixedHistory();
    const client = caller({}, workspaceId);
    const list = await client.listGenerationRuns({ projectId: 3, expectedWorkspaceId: workspaceId });
    const filteredList = await client.listGenerationRuns({ projectId: 3, nodeId: "G1", expectedWorkspaceId: workspaceId });
    const latest = await client.getGenerationRun({ projectId: 3, nodeId: "G1", expectedWorkspaceId: workspaceId });
    expect(list.map(job => job.runId)).toEqual([`workspace-${workspaceId}`]);
    expect(filteredList.map(job => job.runId)).toEqual([`workspace-${workspaceId}`]);
    expect(latest?.runId).toBe(`workspace-${workspaceId}`);
    expect(mocks.getOwnedProject).toHaveBeenCalledWith(3, 7, workspaceId);
    expect(mocks.cancel).not.toHaveBeenCalled();
    noWritesOrModels();
  });

  it.each([9, 10, null])("cancel touches only exact workspace %s, never the first foreign job", async workspaceId => {
    await mixedHistory();
    const result = await caller({}, workspaceId).cancelGenerationJob({ projectId: 3, nodeId: "G1", expectedWorkspaceId: workspaceId });
    expect(result).toMatchObject({ runId: `workspace-${workspaceId}`, workspaceId, status: "canceled" });
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledWith(`workspace-${workspaceId}`, expect.any(String));
    expect(mocks.syncFailed).toHaveBeenCalledTimes(1);
    expect(mocks.syncFailed).toHaveBeenCalledWith(expect.objectContaining({
      workspaceId, aiJobRunId: `workspace-${workspaceId}`, failureKind: "cancel",
    }));
    noWritesOrModels();
  });

  it.each([9, null])("no own workspace %s job means empty history and no foreign cancellation", async workspaceId => {
    await mixedHistory();
    stored = stored.filter(job => job.workspaceId !== workspaceId);
    const client = caller({}, workspaceId);
    expect(await client.listGenerationRuns({ projectId: 3, expectedWorkspaceId: workspaceId })).toEqual([]);
    expect(await client.getGenerationRun({ projectId: 3, nodeId: "G1", expectedWorkspaceId: workspaceId })).toBeNull();
    expect(await client.cancelGenerationJob({ projectId: 3, nodeId: "G1", expectedWorkspaceId: workspaceId })).toBeNull();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.syncFailed).not.toHaveBeenCalled();
    noWritesOrModels();
  });

  it("legacy callers omitting expectedWorkspaceId still use authenticated NULL rather than all workspaces", async () => {
    await mixedHistory();
    const client = caller({}, null);
    expect((await client.listGenerationRuns({ projectId: 3 })).map(job => job.runId)).toEqual(["workspace-null"]);
    expect((await client.getGenerationRun({ projectId: 3, nodeId: "G1" }))?.runId).toBe("workspace-null");
    expect((await client.cancelGenerationJob({ projectId: 3, nodeId: "G1" }))?.runId).toBe("workspace-null");
    expect(mocks.cancel).toHaveBeenCalledTimes(1);
    expect(mocks.cancel).toHaveBeenCalledWith("workspace-null", expect.any(String));
  });

  it("get/cancel also reject expected-workspace drift before reading mixed jobs", async () => {
    await mixedHistory();
    mocks.getProject.mockClear();
    mocks.getOwnedProject.mockClear();
    await expect(caller().getGenerationRun({ projectId: 3, nodeId: "G1", expectedWorkspaceId: 10 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    await expect(caller().cancelGenerationJob({ projectId: 3, nodeId: "G1", expectedWorkspaceId: 10 }))
      .rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(mocks.getOwnedProject).not.toHaveBeenCalled();
    expect(mocks.listJobs).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    noWritesOrModels();
  });
});

describe("G1 worker source binding and actual model context", () => {
  it("uses selected per-ASIN research and exact confirmed comparison, not unselected rows or aggregation", async () => {
    report = comparison();
    const job = await boundJob();
    const output = await runListingGenerationJob(job, context());
    const request = mocks.runSkill.mock.calls[0][0];
    const research = request.variables.planningResearch;
    expect(research.competitors.records.map((row: { sourceId: string }) => row.sourceId)).toEqual(["competitorAnalyses:11"]);
    expect(research.reviews.records[0]).toMatchObject({ sourceId: "competitorAnalyses:11:reviewAnalysis:painPoints:1", frequency: 0, sourceAsins: ["B000000011"] });
    expect(research.comparison.records[0]).toMatchObject({ sourceId: "competitorComparisonReports:90", summary: "Exact-selected reviewed comparison" });
    expect(research.reviews.aggregationStatus).toBe("omitted_selection_binding");
    for (const marker of ["UNSELECTED_COMPETITOR_SECRET", "UNSELECTED_SUMMARY_SECRET", "UNBOUND_AGGREGATE_SECRET", "UNBOUND_COMPARISON_SECRET", "999 L"])
      expect(JSON.stringify(request)).not.toContain(marker);
    expect(output).toMatchObject({ sellingPoints: expect.any(Array), researchSelection: {
      ...(job.input as ListingGenerationJobInput).researchBinding, analyzedAsins: ["B000000011"],
    } });
    expect((output as { sellingPoints: unknown[] }).sellingPoints).toHaveLength(7);
    expect(mocks.runSkill).toHaveBeenCalledTimes(1);
    expect(mocks.forbiddenIo).not.toHaveBeenCalled();
  });

  it("does not use the latest all-project confirmed comparison when the exact set has none", async () => {
    const job = await boundJob();
    await runListingGenerationJob(job, context());
    expect(mocks.runSkill.mock.calls[0][0].variables.planningResearch.comparison.records).toEqual([]);
    expect(JSON.stringify(mocks.runSkill.mock.calls)).not.toContain("UNBOUND_COMPARISON_SECRET");
  });

  it("keeps selected IDs with missing ASINs but never fills output ASINs from embedded reviews", async () => {
    rows[0].asin = "";
    rows[1].asin = "   ";
    rows[0].reviewAnalysis = JSON.stringify({ painPoints: [{ point: "Research without an ASIN", frequency: 0,
      sourceAsins: ["B999999999"] }] });
    const job = await boundJob([11, 22]);
    const result = await runListingGenerationJob(job, context());
    expect(result).toMatchObject({ researchSelection: {
      ...(job.input as ListingGenerationJobInput).researchBinding, analysisIds: [11, 22], analyzedAsins: [],
    } });
    const research = mocks.runSkill.mock.calls[0][0].variables.planningResearch;
    expect(research.competitors.records.map((row: { sourceId: string }) => row.sourceId))
      .toEqual(["competitorAnalyses:11", "competitorAnalyses:22"]);
    expect(JSON.stringify(research)).not.toContain("B999999999");
    expect(mocks.runSkill).toHaveBeenCalledTimes(1);
  });

  it("deduplicates output ASINs without dropping distinct selected analysis IDs", async () => {
    rows[1].asin = rows[0].asin;
    const job = await boundJob([22, 11]);
    const result = await runListingGenerationJob(job, context());
    expect(result).toMatchObject({ researchSelection: {
      ...(job.input as ListingGenerationJobInput).researchBinding, analysisIds: [11, 22], analyzedAsins: ["B000000011"],
    } });
    expect(mocks.runSkill.mock.calls[0][0].variables.planningResearch.competitors.records)
      .toHaveLength(2);
    expect(mocks.runSkill).toHaveBeenCalledTimes(1);
  });

  it("worker ownership ignores a newer foreign-workspace job for the same legacy NULL project", async () => {
    mocks.getProject.mockResolvedValue({ ...project, workspaceId: null });
    const job = await boundJob();
    stored.unshift({ ...job, runId: "newer-foreign-job", workspaceId: 10 });
    const result = await runListingGenerationJob(job, context());
    expect(result).not.toHaveProperty("skipped");
    expect(result).toMatchObject({ researchSelection: { workspaceId: 9, analysisIds: [11] } });
    expect(mocks.runSkill).toHaveBeenCalledTimes(1);
  });

  it("keeps explicit [] empty across a persisted JSON restart", async () => {
    const queued = await startListingGenerationJob(startInput({ analysisIds: [] }));
    const restored = JSON.parse(JSON.stringify(queued)) as AiJobSnapshot;
    stored = [restored];
    rows.push(analysis(33));
    const output = await runListingGenerationJob(restored, context());
    const research = mocks.runSkill.mock.calls[0][0].variables.planningResearch;
    for (const section of [research.competitors, research.reviews, research.comparison]) expect(section.records).toEqual([]);
    expect(output).toMatchObject({ researchSelection: { mode: "explicit", analysisIds: [], analyzedAsins: [] } });
  });

  it.each(["explicit", "legacy_all"] as const)("JSON-restored %s keeps its frozen IDs after unrelated changes", async mode => {
    const queued = await startListingGenerationJob(startInput({ analysisIds: mode === "explicit" ? [11] : undefined }));
    const restored = JSON.parse(JSON.stringify(queued)) as AiJobSnapshot;
    stored = [restored];
    rows.push(analysis(33, { title: "NEW_UNSELECTED_ROW" }));
    if (mode === "explicit") rows[1].title = "CHANGED_UNSELECTED_ROW";
    const output = await runListingGenerationJob(restored, context());
    const ids = mode === "explicit" ? [11] : [11, 22];
    expect(output).toMatchObject({ researchSelection: { mode, analysisIds: ids,
      analyzedAsins: ids.map(id => analysis(id).asin) } });
    expect(JSON.stringify(mocks.runSkill.mock.calls)).not.toContain("NEW_UNSELECTED_ROW");
    expect(JSON.stringify(mocks.runSkill.mock.calls)).not.toContain("CHANGED_UNSELECTED_ROW");
  });

  it.each(["missing-binding", "missing-ids", "mismatched-ids", "job-project", "job-workspace", "binding-project"])(
    "rejects an invalid persisted job (%s) with zero model calls", async kind => {
      const job = await boundJob();
      const input = job.input as ListingGenerationJobInput;
      if (kind === "missing-binding") delete input.researchBinding;
      if (kind === "missing-ids") delete input.analysisIds;
      if (kind === "mismatched-ids") input.analysisIds = [22];
      if (kind === "job-project") job.projectId = 4;
      if (kind === "job-workspace") job.workspaceId = 10;
      if (kind === "binding-project") input.researchBinding!.projectId = 4;
      await expect(runListingGenerationJob(job, context())).rejects.toThrow();
      expect(mocks.runSkill).not.toHaveBeenCalled();
    },
  );

  it.each(["rawData", "price", "summaryVersion", "updatedAt", "deleted", "comparison"])(
    "rejects queued source drift (%s) before the model", async field => {
      report = comparison();
      const job = await boundJob();
      if (field === "rawData") rows[0].rawData = '{"count":0,"enabled":true}';
      if (field === "price") rows[0].price = "1";
      if (field === "summaryVersion") rows[0].summaryVersion++;
      if (field === "updatedAt") rows[0].updatedAt = new Date(stamp.getTime() + 1000);
      if (field === "deleted") rows = rows.filter(row => row.id !== 11);
      if (field === "comparison") report!.summary = "Changed confirmed comparison without changing version";
      await expect(runListingGenerationJob(job, context())).rejects.toThrow();
      expect(mocks.runSkill).not.toHaveBeenCalled();
    },
  );

  it("rechecks after building context and before invoking the model", async () => {
    const job = await boundJob();
    mocks.getKeywords.mockImplementation(async () => { rows[0].price = "2"; return []; });
    await expect(runListingGenerationJob(job, context())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });

  it("rejects a source change during the single model call rather than returning stale output", async () => {
    const job = await boundJob();
    mocks.runSkill.mockImplementation(async ({ validate }) => {
      const parsed = validate(JSON.stringify(validPlan()));
      rows[0].price = "3";
      return { parsed, runId: "mock-model-run" };
    });
    await expect(runListingGenerationJob(job, context())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.runSkill).toHaveBeenCalledTimes(1);
  });

  it("rechecks immediately before return, including drift during the final progress write", async () => {
    const job = await boundJob();
    mocks.progress.mockImplementation(async (_runId, progress) => {
      if (progress === 90) rows[0].price = "4";
    });
    await expect(runListingGenerationJob(job, context())).rejects.toMatchObject({ code: "CONFLICT" });
    expect(mocks.runSkill).toHaveBeenCalledTimes(1);
  });

  it("overwrites a model-forged researchSelection with the server binding", async () => {
    const job = await boundJob();
    mocks.runSkill.mockImplementation(async ({ validate }) => ({ parsed: validate(JSON.stringify({ ...validPlan(),
      researchSelection: { mode: "legacy_all", analysisIds: [999], analyzedAsins: ["B999999999"], sourceHash: "f".repeat(64) },
    })) }));
    const result = await runListingGenerationJob(job, context());
    expect(result).toMatchObject({ researchSelection: { ...(job.input as ListingGenerationJobInput).researchBinding,
      analyzedAsins: ["B000000011"] } });
    expect(JSON.stringify(result)).not.toContain("B999999999");
  });

  it("the registered worker never publishes a stale result to waiting-human", async () => {
    const job = await boundJob();
    rows[0].price = "5";
    await expect(mocks.handler.current!.handler(job, context())).rejects.toThrow();
    expect(mocks.runSkill).not.toHaveBeenCalled();
    expect(mocks.syncWaiting).not.toHaveBeenCalled();
  });
});
