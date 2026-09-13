import { describe, expect, it } from "vitest";
import {
  ExpressionGroupAnalysisSchema,
  Step0SynthesisSchema,
  assertExpressionEvidence,
  assertSynthesisSelection,
  buildExpressionSelectionHash,
  chunkExpressionAssets,
  uniquePositiveIds,
} from "./expressionLinkageContracts";

const evidence = { id: "item-1", title: "数据对比", description: "使用前后数据对比强化功能卖点", evidenceAssetIds: [11, 12] };

describe("expression linkage contracts", () => {
  it("拒绝同一Selection Version重复选择同一资产", () => {
    expect(() => uniquePositiveIds([11, 11])).toThrow("重复选择");
  });

  it("选择哈希与输入顺序无关且包含筛选条件", () => {
    const filters = { sellingPoint: "耐用", expressionMethod: "数据对比", subjectIds: [], subjectRoles: [], assetRoles: [], proofTypes: [], minConfidence: 0.7 };
    expect(buildExpressionSelectionHash({ groupId: 1, assetIds: [12, 11], filters }))
      .toBe(buildExpressionSelectionHash({ groupId: 1, assetIds: [11, 12], filters }));
  });

  it("超过30张时分批覆盖全部图片", () => {
    const values = Array.from({ length: 67 }, (_, index) => index + 1);
    const chunks = chunkExpressionAssets(values);
    expect(chunks.map((chunk) => chunk.length)).toEqual([30, 30, 7]);
    expect(chunks.flat()).toEqual(values);
  });

  it("表达方式分析只能引用当前选择版本资产", () => {
    const analysis = ExpressionGroupAnalysisSchema.parse({
      expressionName: "数据展示",
      imageCount: 2,
      subjectCount: 2,
      coverageSummary: "覆盖两个竞品",
      commonPatterns: [evidence],
      differences: [], strengths: [], risks: [], recommendedPrinciples: [], avoidPatterns: [],
      overallConclusion: "以数据证据增强可信度",
    });
    expect(assertExpressionEvidence({ analysis, selectedAssetIds: [11, 12] })).toBe(analysis);
    expect(() => assertExpressionEvidence({ analysis, selectedAssetIds: [11] })).toThrow("未选择");
  });

  it("综合结论只允许人工选择合法且有证据的决策", () => {
    const analysis = Step0SynthesisSchema.parse({
      positioningSummary: "主要竞品强调可靠性",
      primaryCompetitorTakeaways: [evidence],
      expressionStrategyPriorities: [], differentiationOpportunities: [], conflicts: [],
      downstreamRecommendations: [{ ...evidence, id: "downstream-1", target: "selling_points" }],
      overallConclusion: "优先使用可验证的数据表达",
    });
    expect(assertSynthesisSelection({ analysis, selectedDecisionIds: ["downstream-1"], allowedAssetIds: [11, 12] })).toEqual(["downstream-1"]);
    expect(() => assertSynthesisSelection({ analysis, selectedDecisionIds: [], allowedAssetIds: [11, 12] })).toThrow("至少选择");
  });
});
