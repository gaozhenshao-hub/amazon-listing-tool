import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireDb: vi.fn(),
  getExpressionGroupForProject: vi.fn(),
  getLatestExpressionSelection: vi.fn(),
  listExpressionSelectionLinks: vi.fn(),
  getLatestExpressionAnalysis: vi.fn(),
  listCompetitorGallerySubjects: vi.fn(),
  supersedeExpressionSelections: vi.fn(),
  supersedeExpressionAnalyses: vi.fn(),
  supersedeStep0Synthesis: vi.fn(),
  supersedeStep0Artifacts: vi.fn(),
  nextExpressionSelectionVersion: vi.fn(),
  createExpressionSelectionVersion: vi.fn(),
  createExpressionAssetLinks: vi.fn(),
}));

vi.mock("../../repositories/dbClient", () => ({ requireDb: mocks.requireDb }));
vi.mock("./competitorGalleryService", () => ({ listCompetitorGallerySubjects: mocks.listCompetitorGallerySubjects }));
vi.mock("./competitorGalleryRepository", () => ({
  createStep0Artifact: vi.fn(),
  nextStep0ArtifactVersion: vi.fn(),
  supersedeStep0Artifacts: mocks.supersedeStep0Artifacts,
}));
vi.mock("./repository", () => ({ getExpressionGroupsByProject: vi.fn(), getImageWorkflowSessionByProject: vi.fn() }));
vi.mock("./expressionLinkageRepository", () => ({
  confirmExpressionSelection: vi.fn(),
  countConfirmedSelectionsWithoutAnalysis: vi.fn(),
  createExpressionAnalysisVersion: vi.fn(),
  createExpressionAssetLinks: mocks.createExpressionAssetLinks,
  createExpressionSelectionVersion: mocks.createExpressionSelectionVersion,
  createStep0SynthesisVersion: vi.fn(),
  getExpressionGroupForProject: mocks.getExpressionGroupForProject,
  getExpressionSelectionById: vi.fn(),
  getLatestConfirmedStep0Artifact: vi.fn(),
  getLatestExpressionAnalysis: mocks.getLatestExpressionAnalysis,
  getLatestExpressionSelection: mocks.getLatestExpressionSelection,
  getLatestStep0Synthesis: vi.fn(),
  listConfirmedExpressionAnalyses: vi.fn(),
  listExpressionSelectionLinks: mocks.listExpressionSelectionLinks,
  nextExpressionAnalysisVersion: vi.fn(),
  nextExpressionSelectionVersion: mocks.nextExpressionSelectionVersion,
  nextStep0SynthesisVersion: vi.fn(),
  supersedeExpressionAnalyses: mocks.supersedeExpressionAnalyses,
  supersedeExpressionSelections: mocks.supersedeExpressionSelections,
  supersedeStep0Synthesis: mocks.supersedeStep0Synthesis,
  updateExpressionAnalysis: vi.fn(),
  updateStep0Synthesis: vi.fn(),
}));

import { listExpressionAssetCandidates, saveExpressionSelection } from "./expressionLinkageService";

const confirmedFact = {
  status: "confirmed",
  confidence: "0.8",
  aiFacts: { sellingPoints: ["快速安装"], expressionMethod: "步骤图示", proofType: "data", confidence: 0.8 },
};

describe("expressionLinkageService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    const db = { transaction: vi.fn(async (callback) => callback(db)) };
    mocks.requireDb.mockResolvedValue(db);
    mocks.getExpressionGroupForProject.mockResolvedValue({ id: 11, projectId: 7, expressionName: "快速安装" });
    mocks.getLatestExpressionSelection.mockResolvedValue(null);
    mocks.listExpressionSelectionLinks.mockResolvedValue([]);
    mocks.getLatestExpressionAnalysis.mockResolvedValue(null);
    mocks.nextExpressionSelectionVersion.mockResolvedValue(2);
    mocks.createExpressionSelectionVersion.mockResolvedValue(91);
    mocks.listCompetitorGallerySubjects.mockResolvedValue([
      {
        id: 21, status: "confirmed", role: "primary", displayName: "竞品A", asin: "REDACTED-A",
        assets: [
          { id: 101, role: "main", positionIndex: 0, imageUrl: "https://example.test/101", fact: confirmedFact },
          { id: 102, role: "main", positionIndex: 1, imageUrl: "https://example.test/102", fact: { ...confirmedFact, status: "review_required" } },
        ],
      },
      { id: 22, status: "review_required", role: "benchmark", displayName: "竞品B", asin: "REDACTED-B", assets: [{ id: 201, fact: confirmedFact }] },
    ]);
  });

  it("只返回已确认Subject中的已确认逐图事实资产", async () => {
    const result = await listExpressionAssetCandidates({ workspaceId: 3, projectId: 7, groupId: 11 });
    expect(result.candidates.map((item) => item.assetId)).toEqual([101]);
    expect(result.candidates[0]).toMatchObject({ subjectId: 21, recommended: true });
  });

  it("表达组不属于当前项目时失败关闭", async () => {
    mocks.getExpressionGroupForProject.mockResolvedValueOnce(null);
    await expect(listExpressionAssetCandidates({ workspaceId: 3, projectId: 999, groupId: 11 })).rejects.toThrow("表达方向不存在");
  });

  it("拒绝重复资产并保持同一Selection内唯一", async () => {
    await expect(saveExpressionSelection({ workspaceId: 3, projectId: 7, sessionId: 5, groupId: 11, userId: 9, selectedAssetIds: [101, 101] })).rejects.toThrow("重复");
    expect(mocks.createExpressionAssetLinks).not.toHaveBeenCalled();
  });

  it("选择变更会失效旧分析与Composite，并保留AI推荐来源", async () => {
    const result = await saveExpressionSelection({
      workspaceId: 3, projectId: 7, sessionId: 5, groupId: 11, userId: 9,
      selectedAssetIds: [101], aiRecommendedAssetIds: [101],
    });
    expect(result).toMatchObject({ id: 91, version: 2, status: "draft" });
    expect(mocks.supersedeExpressionSelections).toHaveBeenCalled();
    expect(mocks.supersedeExpressionAnalyses).toHaveBeenCalled();
    expect(mocks.supersedeStep0Synthesis).toHaveBeenCalled();
    expect(mocks.supersedeStep0Artifacts).toHaveBeenCalledWith(expect.anything(), 3, 7, "composite");
    expect(mocks.createExpressionAssetLinks).toHaveBeenCalledWith(expect.anything(), [expect.objectContaining({ acquisitionAssetId: 101, source: "ai_recommended" })]);
  });
});
