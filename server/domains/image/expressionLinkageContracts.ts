import { createHash } from "node:crypto";
import { z } from "zod";

export const EXPRESSION_LINKAGE_SKILL_VERSION = "image-step0-expression-linkage-v1";
export const STEP0_SYNTHESIS_SKILL_VERSION = "image-step0-synthesis-v1";
export const EXPRESSION_ANALYSIS_BATCH_SIZE = 30;

const nonEmptyText = z.string().trim().min(1).max(1600);
const evidenceItem = z.object({
  id: z.string().trim().min(1).max(120),
  title: nonEmptyText,
  description: nonEmptyText,
  evidenceAssetIds: z.array(z.number().int().positive()).min(1).max(120),
}).strict();

export const ExpressionSelectionFilterSchema = z.object({
  sellingPoint: z.string().trim().max(512).default(""),
  expressionMethod: z.string().trim().max(512).default(""),
  subjectIds: z.array(z.number().int().positive()).max(100).default([]),
  subjectRoles: z.array(z.enum(["primary", "benchmark", "supplemental"])).max(3).default([]),
  assetRoles: z.array(z.string().trim().min(1).max(32)).max(16).default([]),
  proofTypes: z.array(z.string().trim().min(1).max(64)).max(16).default([]),
  minConfidence: z.number().min(0).max(1).default(0),
}).strict();

export const ExpressionGroupAnalysisSchema = z.object({
  expressionName: nonEmptyText,
  imageCount: z.number().int().positive(),
  subjectCount: z.number().int().positive(),
  coverageSummary: nonEmptyText,
  commonPatterns: z.array(evidenceItem).min(1).max(30),
  differences: z.array(evidenceItem).max(30),
  strengths: z.array(evidenceItem).max(30),
  risks: z.array(evidenceItem).max(30),
  recommendedPrinciples: z.array(evidenceItem).max(30),
  avoidPatterns: z.array(evidenceItem).max(30),
  overallConclusion: nonEmptyText,
}).strict();

export const Step0SynthesisSchema = z.object({
  positioningSummary: nonEmptyText,
  primaryCompetitorTakeaways: z.array(evidenceItem).max(30),
  expressionStrategyPriorities: z.array(evidenceItem.extend({
    expressionGroupId: z.number().int().positive(),
  })).max(40),
  differentiationOpportunities: z.array(evidenceItem).max(30),
  conflicts: z.array(evidenceItem).max(30),
  downstreamRecommendations: z.array(evidenceItem.extend({
    target: z.enum(["selling_points", "image_outline"]),
  })).min(1).max(40),
  overallConclusion: nonEmptyText,
}).strict();

export type ExpressionSelectionFilter = z.infer<typeof ExpressionSelectionFilterSchema>;
export type ExpressionGroupAnalysis = z.infer<typeof ExpressionGroupAnalysisSchema>;
export type Step0Synthesis = z.infer<typeof Step0SynthesisSchema>;

export function uniquePositiveIds(values: number[]) {
  const ids = values.filter((value) => Number.isInteger(value) && value > 0);
  if (new Set(ids).size !== ids.length) throw new Error("同一版本不能重复选择同一竞品图片");
  return ids;
}

export function buildExpressionSelectionHash(input: {
  groupId: number;
  assetIds: number[];
  filters: ExpressionSelectionFilter;
}) {
  return createHash("sha256").update(JSON.stringify({
    groupId: input.groupId,
    assetIds: [...uniquePositiveIds(input.assetIds)].sort((a, b) => a - b),
    filters: ExpressionSelectionFilterSchema.parse(input.filters),
  })).digest("hex");
}

export function chunkExpressionAssets<T>(items: T[], size = EXPRESSION_ANALYSIS_BATCH_SIZE) {
  if (!Number.isInteger(size) || size <= 0) throw new Error("分批大小必须为正整数");
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) chunks.push(items.slice(index, index + size));
  return chunks;
}

function collectEvidenceIds(analysis: ExpressionGroupAnalysis) {
  return [
    ...analysis.commonPatterns,
    ...analysis.differences,
    ...analysis.strengths,
    ...analysis.risks,
    ...analysis.recommendedPrinciples,
    ...analysis.avoidPatterns,
  ].flatMap((item) => item.evidenceAssetIds);
}

export function assertExpressionEvidence(input: { analysis: ExpressionGroupAnalysis; selectedAssetIds: number[] }) {
  const allowed = new Set(uniquePositiveIds(input.selectedAssetIds));
  if (collectEvidenceIds(input.analysis).some((assetId) => !allowed.has(assetId))) {
    throw new Error("表达方式分析引用了未选择或未确认的竞品图片证据");
  }
  return input.analysis;
}

export function collectSynthesisDecisionIds(analysis: Step0Synthesis) {
  return [
    ...analysis.primaryCompetitorTakeaways,
    ...analysis.expressionStrategyPriorities,
    ...analysis.differentiationOpportunities,
    ...analysis.conflicts,
    ...analysis.downstreamRecommendations,
  ].map((item) => item.id);
}

export function assertSynthesisSelection(input: {
  analysis: Step0Synthesis;
  selectedDecisionIds: string[];
  allowedAssetIds: number[];
}) {
  const decisionIds = collectSynthesisDecisionIds(input.analysis);
  if (new Set(decisionIds).size !== decisionIds.length) throw new Error("综合结论决策ID必须唯一");
  const allowedDecisions = new Set(decisionIds);
  const selected = input.selectedDecisionIds.map((value) => value.trim()).filter(Boolean);
  if (new Set(selected).size !== selected.length || selected.some((id) => !allowedDecisions.has(id))) {
    throw new Error("综合结论包含无效或重复的人工选择项");
  }
  if (selected.length === 0) throw new Error("请至少选择一项综合结论进入后续步骤");
  const allowedAssets = new Set(uniquePositiveIds(input.allowedAssetIds));
  const allItems = [
    ...input.analysis.primaryCompetitorTakeaways,
    ...input.analysis.expressionStrategyPriorities,
    ...input.analysis.differentiationOpportunities,
    ...input.analysis.conflicts,
    ...input.analysis.downstreamRecommendations,
  ];
  if (allItems.flatMap((item) => item.evidenceAssetIds).some((assetId) => !allowedAssets.has(assetId))) {
    throw new Error("综合结论引用了未确认的竞品图片证据");
  }
  return selected;
}
