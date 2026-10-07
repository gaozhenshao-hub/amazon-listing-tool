import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ runSkill: vi.fn(), getFiles: vi.fn(), getProject: vi.fn(), loadEnriched: vi.fn(),
  getAnalyses: vi.fn(), buildContext: vi.fn(), listJobs: vi.fn(), progress: vi.fn(), syncRunning: vi.fn(),
  validateBullets: vi.fn() }));

vi.mock("./domains/listing/routerContext", () => ({
  MAX_RETRIES: 2, buildProductContext: mocks.buildContext, loadEnrichedData: mocks.loadEnriched,
  safeParseJSON: JSON.parse, validateBullets: mocks.validateBullets, validateTitles: vi.fn(),
}));
vi.mock("./domains/listing/repository", () => ({ getProjectByIdAdmin: mocks.getProject,
  getCompetitorAnalysesByProject: mocks.getAnalyses, getProjectFilesByProject: mocks.getFiles }));
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
    input: { projectId: 1, nodeId: "G1", scopeKey: "bullet-0", ...input } } as any;
}
const handler = { signal: new AbortController().signal } as any;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getProject.mockResolvedValue(project);
  mocks.getAnalyses.mockResolvedValue([]);
  mocks.validateBullets.mockReturnValue({ valid: true, issues: [] });
  mocks.getFiles.mockResolvedValue([{ fileType: "product_attributes", status: "completed", rawContent: "Power: 1200W (example)\nFeature: Padded shell",
    analysisResult: JSON.stringify({ coreSpecs: [{ attribute: "Power", value: 1200 }], uniqueSellingPoints: ["Padded shell"] }) }]);
  mocks.loadEnriched.mockResolvedValue({ productAttributes: { coreSpecs: [{ attribute: "Power", value: 1200 }] } });
  mocks.buildContext.mockImplementation((p: unknown, _analyses: unknown, e: unknown) => JSON.stringify({ project: p, enrichedData: e }));
  mocks.listJobs.mockImplementation(async () => [makeJob({ operation: "sellingPoints" }), makeJob({ operation: "singleBullet", sellingPoint: core })]);
  mocks.runSkill.mockImplementation(async (call: { skillSlug: string }) => ({ parsed: call.skillSlug === "listing.sellingpoints.generate"
    ? { sellingPoints: [core] } : bullet }));
});

describe("G1 v7事实保护实际Job Handler（所有外部依赖mock）", () => {
  it("上游卖点核心的重点强调若含模板示例，模型调用次数保持0", async () => {
    await expect(runListingGenerationJob(makeJob({ operation: "sellingPoints", emphasis: "Power: [e.g. 1200W]" }), handler))
      .rejects.toThrow(/重点强调含空白或示例/);
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });
  it("旧整套批量入口的G1阶段同样拦截重点强调示例", async () => {
    const batchJob = makeJob({ operation: "batch", emphasis: "Power: [e.g. 1200W]" });
    mocks.listJobs.mockResolvedValueOnce([batchJob]);
    await expect(runListingGenerationJob(batchJob, handler)).rejects.toThrow(/重点强调含空白或示例/);
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });
  it("旧批量入口的G1阶段仍使用完整原表与分析结果交叉过滤", async () => {
    const batchJob = makeJob({ operation: "batch" });
    mocks.listJobs.mockResolvedValue([batchJob]);
    mocks.runSkill.mockImplementation(async ({ skillSlug }: { skillSlug: string }) => {
      if (skillSlug !== "listing.sellingpoints.generate") throw new Error("STOP_AFTER_G1_TEST");
      return { parsed: { sellingPoints: [core] } };
    });
    await expect(runListingGenerationJob(batchJob, handler)).rejects.toThrow("STOP_AFTER_G1_TEST");
    const call = mocks.runSkill.mock.calls[0][0];
    expect(call.skillSlug).toBe("listing.sellingpoints.generate");
    expect(JSON.stringify(call.variables)).not.toContain("1200W");
    expect(JSON.stringify(call.variables)).not.toContain('"value":1200');
  });
  it("旧批量入口G1的第二阶段整套五点也看不到示例参数", async () => {
    const batchJob = makeJob({ operation: "batch" });
    mocks.listJobs.mockResolvedValue([batchJob]);
    mocks.runSkill.mockImplementation(async ({ skillSlug }: { skillSlug: string }) => {
      if (skillSlug === "listing.sellingpoints.generate") return { parsed: { sellingPoints: [core] } };
      if (skillSlug === "listing.bullets.generate") return { parsed: { bulletPoints: [bullet] } };
      throw new Error("STOP_AFTER_BULLETS_TEST");
    });
    await expect(runListingGenerationJob(batchJob, handler)).rejects.toThrow("STOP_AFTER_BULLETS_TEST");
    const g1Calls = mocks.runSkill.mock.calls.slice(0, 2).map(([call]) => call);
    expect(g1Calls.map((call) => call.skillSlug)).toEqual(["listing.sellingpoints.generate", "listing.bullets.generate"]);
    for (const call of g1Calls) {
      expect(JSON.stringify(call.variables)).not.toContain("1200W");
      expect(JSON.stringify(call.variables)).not.toContain('"value":1200');
    }
  });
  it("G1提案自行编造出原表示例值时整批失败关闭，不交给五点Skill", async () => {
    const batchJob = makeJob({ operation: "batch" });
    mocks.listJobs.mockResolvedValue([batchJob]);
    mocks.runSkill.mockResolvedValue({ parsed: { sellingPoints: [{ ...core, description: "1200W motor" }] } });
    await expect(runListingGenerationJob(batchJob, handler)).rejects.toThrow(/生成结果引用了原始产品属性表的示例值/);
    expect(mocks.runSkill).toHaveBeenCalledOnce();
  });
  it("整套五点首次候选无示例但格式重试带回示例时，第二次仍失败关闭且不流转后续节点", async () => {
    const batchJob = makeJob({ operation: "batch" });
    mocks.listJobs.mockResolvedValue([batchJob]);
    mocks.validateBullets.mockReturnValueOnce({ valid: false, issues: ["格式"] });
    mocks.runSkill.mockImplementation(async ({ skillSlug }: { skillSlug: string }) => ({ parsed:
      skillSlug === "listing.sellingpoints.generate" ? { sellingPoints: [core] }
        : mocks.runSkill.mock.calls.filter(([call]) => call.skillSlug === "listing.bullets.generate").length >= 2
          ? { bulletPoints: [{ ...bullet, fullText: "1200W motor" }] }
          : { bulletPoints: [bullet] },
    }));
    await expect(runListingGenerationJob(batchJob, handler)).rejects.toThrow(/五点重试结果引用了原始产品属性表的示例值/);
    expect(mocks.runSkill).toHaveBeenCalledTimes(3);
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
    await expect(runListingGenerationJob(makeJob({ operation: "singleBullet", sellingPoint: withExample }), handler))
      .rejects.toThrow(/原始属性表的示例值/);
    expect(mocks.runSkill).not.toHaveBeenCalled();
  });
  it("逐条输入只保留确认核心和产品身份，不把分析/竞品资料混入Skill上下文", async () => {
    mocks.runSkill.mockResolvedValueOnce({ parsed: bullet, modelSlug: "synthetic/test-model", fallbackCount: 1, skillVersion: "7" });
    const result = await runListingGenerationJob(makeJob({ operation: "singleBullet", sellingPoint: core }), handler);
    const call = mocks.runSkill.mock.calls[0][0];
    expect(call.skillSlug).toBe("listing.bullet.step.generate");
    expect(call.executionPreset).toBe("quality_first");
    expect(result.executionAudit).toMatchObject({ modelSlug: "synthetic/test-model", fallbackCount: 1, skillVersion: "7" });
    expect(call.variables.sellingPoint).toMatchObject(core);
    expect(call.variables.enrichedData).toBeUndefined();
    expect(call.variables.analyses).toBeUndefined();
    expect(call.context).not.toContain("1200W");
  });
});
