import { describe, expect, it } from "vitest";
import {
  CompetitorGalleryAnalysisSchema,
  CompetitorImageFactSchema,
  assertSinglePrimarySubject,
  buildCompetitorGalleryInputHash,
  confirmEvidenceBackedAnalysis,
} from "./competitorGalleryContracts";

const fact = {
  imagePurpose: "展示核心功能",
  imageType: "feature" as const,
  sellingPoints: ["耐用"],
  expressionMethod: "功能特写",
  composition: "居中构图",
  visualStyle: "高对比",
  copyStrategy: "短标题",
  proofType: "visual_demo" as const,
  targetAudience: "家庭用户",
  emotionalTone: "可靠",
  strengths: ["主体清晰"],
  risks: [],
  summary: "通过特写证明耐用性",
  confidence: 0.9,
};

const analysis = {
  positioning: "专业可靠",
  targetAudience: "家庭用户",
  narrativeStrategy: "先认知再证明",
  sequenceLogic: [{ title: "认知", description: "先展示产品", evidenceAssetIds: [11] }],
  visualSystem: { palette: ["蓝色"], typography: ["粗体"], compositionPatterns: ["居中"], productPresentation: ["特写"], consistency: "统一" },
  sellingPointArchitecture: [{ sellingPoint: "耐用", assetCount: 1, expressionMethods: ["特写"], proofTypes: ["visual_demo"], evidenceAssetIds: [11] }],
  strengths: [{ title: "清晰", description: "主体明确", evidenceAssetIds: [11] }],
  weaknesses: [], risks: [], reusablePrinciples: [], avoidPatterns: [], differentiationOpportunities: [],
  overallConclusion: "证据链完整",
};

describe("competitor gallery contracts", () => {
  it("accepts strict per-image facts", () => {
    expect(CompetitorImageFactSchema.parse(fact).confidence).toBe(0.9);
  });

  it("builds a stable input hash independent of input order", () => {
    const left = buildCompetitorGalleryInputHash({ subjectId: 1, confirmedSnapshotId: 2, assets: [
      { id: 11, contentHash: "a", role: "main", positionIndex: 0 },
      { id: 12, contentHash: "b", role: "secondary", positionIndex: 1 },
    ] });
    const right = buildCompetitorGalleryInputHash({ subjectId: 1, confirmedSnapshotId: 2, assets: [
      { id: 12, contentHash: "b", role: "secondary", positionIndex: 1 },
      { id: 11, contentHash: "a", role: "main", positionIndex: 0 },
    ] });
    expect(left).toBe(right);
  });

  it("rejects more than one primary competitor", () => {
    expect(() => assertSinglePrimarySubject([{ role: "primary" }, { role: "primary" }])).toThrow("只能设置一个");
  });

  it("rejects evidence outside the confirmed subject gallery", () => {
    const parsed = CompetitorGalleryAnalysisSchema.parse(analysis);
    expect(() => confirmEvidenceBackedAnalysis({ analysis: parsed, allowedAssetIds: [99] })).toThrow("未确认");
    expect(confirmEvidenceBackedAnalysis({ analysis: parsed, allowedAssetIds: [11] }).positioning).toBe("专业可靠");
  });
});
