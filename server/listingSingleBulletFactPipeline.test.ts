import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runSkill: vi.fn(), getFiles: vi.fn(), getProject: vi.fn(), loadEnriched: vi.fn(),
  getAnalyses: vi.fn(), buildContext: vi.fn(), listJobs: vi.fn(), progress: vi.fn(), syncRunning: vi.fn(),
  validateBullets: vi.fn(), resolveCore: vi.fn(), persistCandidate: vi.fn(), resolveFacts: vi.fn() }));

vi.mock("./domains/listing/routerContext", () => ({
  MAX_RETRIES: 2, buildProductContext: mocks.buildContext, loadEnrichedData: mocks.loadEnriched,
  safeParseJSON: JSON.parse, validateBullets: mocks.validateBullets, validateTitles: vi.fn(),
}));
vi.mock("./domains/listing/repository", () => ({ getProjectByIdAdmin: mocks.getProject,
  getCompetitorAnalysesByProject: mocks.getAnalyses, getProjectFilesByProject: mocks.getFiles,
  getReviewAggregationByProject: vi.fn(async () => null), getKeywordsByProject: vi.fn(async () => []),
  getActiveBuyerQuestionsByProject: vi.fn(async () => []), getLatestConfirmedCompetitorComparisonReport: vi.fn(async () => null) }));
vi.mock("./domains/listing/service", () => ({ runEmperorSkill: mocks.runSkill }));
vi.mock("./domains/ai_os/services/jobRunner", () => ({
  registerAiJobHandler: vi.fn(), listAiJobRunsForUser: mocks.listJobs, updateAiJobProgress: mocks.progress,
  cancelAiJob: vi.fn(), createAiJobRun: vi.fn(), scheduleAiJobRun: vi.fn(),
}));
vi.mock("./domains/listing/listingAgentBridge", () => ({
  LISTING_GENERATION_NODE_MAP: {}, syncListingNodeJobRunning: mocks.syncRunning,
  syncListingNodeJobFailed: vi.fn(), syncListingNodeJobQueued: vi.fn(), syncListingNodeJobWaitingHuman: vi.fn(),
  syncListingPreparationNodeConfirmed: vi.fn(),
}));
vi.mock("./domains/listing/services/listingRawAttributeSource", () => ({
  readCompleteAttributeText: async (file: { rawContent: string }) => file.rawContent,
}));
vi.mock("./domains/listing/services/listingConfirmedCore", () => ({ resolveConfirmedListingCore: mocks.resolveCore }));
vi.mock("./domains/listing/services/listingCandidateProvenance", () => ({ persistGeneratedBulletCandidate: mocks.persistCandidate }));
vi.mock("./domains/listing/services/listingFactSource", async importOriginal => ({
  ...await importOriginal<typeof import("./domains/listing/services/listingFactSource")>(),
  resolveCurrentConfirmedListingFacts: mocks.resolveFacts,
}));

import { runListingGenerationJob } from "./domains/listing/services/generationJob";

const project = { id: 1, workspaceId: 9, productName: "Test Case", brand: "Example Brand",
  productFeatures: JSON.stringify(["Padded shell", "Power: [如：1200W]"]), productSpecs: JSON.stringify({ power: "[如：1200W]" }) };
const bullet = { subtitle: "Everyday Travel Protection:",
  fullText: "This portable case has a padded shell to help reduce surface contact as you carry a device during everyday travel, giving you one simple way to keep it separate from the other items in your bag while moving between stops",
  evidenceUsed: ["Padded shell"], keywordsUsed: ["portable case"], distinctFromPrevious: "Different angle",
  qualityAudit: { factsGrounded: true, lengthInRange: true, noKeywordStuffing: true, oneClearBenefit: true,
    subtitleBodyPunctuationCorrect: true, americanEnglishNatural: true, grammarAndParallelismCorrect: true,
    noUnsupportedClaims: true, distinctFromPrevious: true, amazonBulletStyleCompliant: true } };
const core = { index: 1, theme: "Portable protection", description: "Padded shell",
  fabeDirection: { feature: "Padded shell", advantage: "", benefit: "", evidence: "Padded shell" },
  targetKeywords: ["portable case"] };
function makeJob(input: Record<string, unknown>) {
  return { runId: "job_test", attempt: 1, maxAttempts: 1, projectId: 1, userId: 7, workspaceId: 9,
    input: { projectId: 1, nodeId: "G1", scopeKey: "bullet-0",
      ...(input.operation === "sellingPoints" ? { factBinding: {
        sourceFileId: 11, rawHash: "b".repeat(64), factRevisionIds: [23],
      } } : {}),
      ...(input.operation === "singleBullet" ? { coreRevisionId: 12, coreInputHash: "a".repeat(64) } : {}), ...input } } as any;
}
const handler = { signal: new AbortController().signal } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProject.mockResolvedValue(project);
  mocks.getAnalyses.mockResolvedValue([]);
  mocks.validateBullets.mockReturnValue({ valid: true, issues: [] });
  mocks.resolveCore.mockImplementation(async () => ({ sellingPoint: core, factRevisions: [{ id: 23, attributeKey: "Feature", value: "Padded shell" }] }));
  mocks.persistCandidate.mockResolvedValue({ id: 61, candidateRevision: 1 });
  mocks.resolveFacts.mockResolvedValue({ source: { fileId: 11, rawHash: "b".repeat(64) },
    facts: [{ id: 23, attributeKey: "Feature", value: "Padded shell", status: "confirmed" }] });
  mocks.getFiles.mockResolvedValue([{ fileType: "product_attributes", status: "completed", rawContent: "Power: 1200W (example)\nFeature: Padded shell",
    analysisResult: JSON.stringify({ coreSpecs: [{ attribute: "Power", value: 1200 }], uniqueSellingPoints: ["Padded shell"] }) }]);
  mocks.loadEnriched.mockResolvedValue({ productAttributes: { coreSpecs: [{ attribute: "Power", value: 1200 }] } });
  mocks.buildContext.mockImplementation((p: unknown, _analyses: unknown, e: unknown) => JSON.stringify({ project: p, enrichedData: e }));
  mocks.listJobs.mockImplementation(async () => [makeJob({ operation: "sellingPoints" }), makeJob({ operation: "singleBullet", sellingPoint: core })]);
  mocks.runSkill.mockImplementation(async (call: { skillSlug: string }) => ({ runId: "skill_test", modelSlug: "quality-test-model", skillVersion: "7",
    parsed: call.skillSlug === "listing.sellingpoints.generate" ? {
      sellingPoints: Array.from({ length: 7 }, (_, index) => ({ ...core, index: index + 1,
        theme: `Planning angle ${index + 1}`, themeZh: `策划方向${index + 1}`, descriptionZh: "待补证的策划角度",
        fabeDirection: { feature: "Padded shell", advantage: "Evidence gap", benefit: "Evidence gap", evidence: "Confirmed fact 23: Padded shell" },
        addressesGap: "No review evidence supplied; research needed", checkListTargets: [] })),
      overallStrategy: "Only padded shell is supported; research is missing for other buyer angles.",
      checkListCoverage: { B4_order: "Supported facts first; other angles need evidence, not fabricated customer consensus." },
    } : bullet }));
});

describe("G1 v7事实保护实际Job Handler（所有外部依赖mock）", () => {
  it("上游卖点核心的重点强调若含模板示例，模型调用次数保持0", async () => {
    await expect(runListingGenerationJob(makeJob({ operation: "sellingPoints", emphasis: "Power: [e.g. 1200W]" }), handler))
      .rejects.toThrow(/重点强调含空白或示例/);
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });
  it.each(["batch", "bullets"])("历史%s任务不再使用整套模型流程，旧队列在模型前拒绝", async operation => {
    await expect(runListingGenerationJob(makeJob({ operation, emphasis: "Power: [e.g. 1200W]" }), handler))
      .rejects.toThrow(/Worker拒绝执行模型调用/);
    expect(mocks.getProject).not.toHaveBeenCalled();
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });
  it("上游G1从原表移除被AI剥去示例标签的裸数字，同时保留真实Padded shell", async () => {
    await runListingGenerationJob(makeJob({ operation: "sellingPoints" }), handler);
    expect(mocks.getProject).toHaveBeenCalledWith(1, 9);
    expect(mocks.runSkill).toHaveBeenCalledOnce();
    const call = mocks.runSkill.mock.calls[0][0];
    expect(call.skillSlug).toBe("listing.sellingpoints.generate");
    expect(JSON.stringify(call.variables)).not.toContain("1200W");
    expect(JSON.stringify(call.variables)).not.toContain('"value":1200');
    expect(call.context).toContain("Padded shell");
  });
  it("项目在排队后不再属于原工作空间时停止执行，也不读取上传或调用模型", async () => {
    mocks.getProject.mockResolvedValueOnce(null);
    await expect(runListingGenerationJob(makeJob({ operation: "sellingPoints" }), handler)).rejects.toThrow(/项目不存在/);
    expect(mocks.getProject).toHaveBeenCalledWith(1, 9);
    expect(mocks.getFiles).not.toHaveBeenCalled();
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });
  it("逐条输入参考了原始模板的数值时，在入模前失败关闭", async () => {
    const withExample = { ...core, description: "1200W motor" };
    mocks.resolveCore.mockResolvedValueOnce({ sellingPoint: withExample });
    await expect(runListingGenerationJob(makeJob({ operation: "singleBullet", sellingPoint: withExample }), handler))
      .rejects.toThrow(/原始属性表的示例值/);
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });
  it("逐条输入只保留确认核心和产品身份，不把分析/竞品资料混入Skill上下文", async () => {
    mocks.runSkill.mockResolvedValueOnce({ runId: "skill_test", parsed: bullet, modelSlug: "synthetic/test-model", fallbackCount: 1, skillVersion: "7" });
    const result = await runListingGenerationJob(makeJob({ operation: "singleBullet", sellingPoint: core }), handler);
    const call = mocks.runSkill.mock.calls[0][0];
    expect(call.skillSlug).toBe("listing.bullet.step.generate");
    expect(call.executionPreset).toBe("quality_first");
    expect(result.executionAudit).toMatchObject({ modelSlug: "synthetic/test-model", fallbackCount: 1, skillVersion: "7" });
    expect(result).toMatchObject({ candidateId: 61, candidateRevision: 1 });
    expect(mocks.persistCandidate).toHaveBeenCalledWith(expect.objectContaining({
      coreRevisionId: 12, workspaceId: 9, jobRunId: "job_test",
      execution: expect.objectContaining({ runId: "skill_test", modelSlug: "synthetic/test-model" }),
      factRevisions: [expect.objectContaining({ id: 23, value: "Padded shell" })],
    }));
    expect(call.variables.sellingPoint).toMatchObject(core);
    expect(call.variables.enrichedData).toBeUndefined();
    expect(call.variables.analyses).toBeUndefined();
    expect(call.context).not.toContain("1200W");
    expect(mocks.resolveCore).toHaveBeenCalledWith(expect.objectContaining({ coreRevisionId: 12, workspaceId: 9 }));
  });
  it("逐条请求即使伪造描述字段，Worker仍只用服务端确认事实，成功后再核对一次版本", async () => {
    await runListingGenerationJob(makeJob({ operation: "singleBullet", sellingPoint: { ...core, description: "Invented certification" } }), handler);
    expect(JSON.stringify(mocks.runSkill.mock.calls[0][0].variables.sellingPoint)).not.toContain("Invented certification");
    expect(mocks.resolveCore).toHaveBeenCalledTimes(2);
  });
});
