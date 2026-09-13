import { createHash } from "node:crypto";
import { z } from "zod";

export const COMPETITOR_GALLERY_SKILL_VERSION = "image-step0-gallery-v1";

const nonEmptyText = z.string().trim().min(1).max(1200);

export const CompetitorImageFactSchema = z.object({
  imagePurpose: nonEmptyText,
  imageType: z.enum(["main", "scene", "feature", "comparison", "data", "aplus", "brand_story", "other"]),
  sellingPoints: z.array(nonEmptyText).min(1).max(6),
  expressionMethod: nonEmptyText,
  composition: nonEmptyText,
  visualStyle: nonEmptyText,
  copyStrategy: z.string().trim().max(1200),
  proofType: z.enum(["visual_demo", "data", "comparison", "scenario", "testimonial_like", "none"]),
  targetAudience: z.string().trim().max(800),
  emotionalTone: z.string().trim().max(800),
  strengths: z.array(nonEmptyText).max(8),
  risks: z.array(nonEmptyText).max(8),
  summary: nonEmptyText,
  confidence: z.number().min(0).max(1),
}).strict();

const strategyItem = z.object({
  title: nonEmptyText,
  description: nonEmptyText,
  evidenceAssetIds: z.array(z.number().int().positive()).min(1).max(30),
}).strict();

export const CompetitorGalleryAnalysisSchema = z.object({
  positioning: nonEmptyText,
  targetAudience: nonEmptyText,
  narrativeStrategy: nonEmptyText,
  sequenceLogic: z.array(strategyItem).min(1).max(20),
  visualSystem: z.object({
    palette: z.array(nonEmptyText).max(12),
    typography: z.array(nonEmptyText).max(12),
    compositionPatterns: z.array(nonEmptyText).max(20),
    productPresentation: z.array(nonEmptyText).max(20),
    consistency: nonEmptyText,
  }).strict(),
  sellingPointArchitecture: z.array(z.object({
    sellingPoint: nonEmptyText,
    assetCount: z.number().int().min(1),
    expressionMethods: z.array(nonEmptyText).min(1).max(12),
    proofTypes: z.array(nonEmptyText).max(12),
    evidenceAssetIds: z.array(z.number().int().positive()).min(1).max(30),
  }).strict()).min(1).max(30),
  strengths: z.array(strategyItem).max(20),
  weaknesses: z.array(strategyItem).max(20),
  risks: z.array(strategyItem).max(20),
  reusablePrinciples: z.array(strategyItem).max(20),
  avoidPatterns: z.array(strategyItem).max(20),
  differentiationOpportunities: z.array(strategyItem).max(20),
  overallConclusion: nonEmptyText,
}).strict();

export type CompetitorImageFact = z.infer<typeof CompetitorImageFactSchema>;
export type CompetitorGalleryAnalysis = z.infer<typeof CompetitorGalleryAnalysisSchema>;

export function buildCompetitorGalleryInputHash(input: {
  subjectId: number;
  confirmedSnapshotId: number;
  assets: Array<{ id: number; contentHash?: string | null; role: string; positionIndex: number }>;
}) {
  return createHash("sha256").update(JSON.stringify({
    subjectId: input.subjectId,
    confirmedSnapshotId: input.confirmedSnapshotId,
    assets: [...input.assets]
      .sort((a, b) => a.positionIndex - b.positionIndex || a.id - b.id)
      .map((asset) => ({ id: asset.id, contentHash: asset.contentHash || "", role: asset.role, positionIndex: asset.positionIndex })),
  })).digest("hex");
}

export function assertSinglePrimarySubject(input: Array<{ id?: number; role: string }>) {
  const primaryCount = input.filter((subject) => subject.role === "primary").length;
  if (primaryCount > 1) throw new Error("每个项目只能设置一个主要竞争对手");
}

export function confirmEvidenceBackedAnalysis(input: {
  analysis: CompetitorGalleryAnalysis;
  allowedAssetIds: number[];
}) {
  const allowed = new Set(input.allowedAssetIds);
  const evidenceIds = [
    ...input.analysis.sequenceLogic,
    ...input.analysis.sellingPointArchitecture,
    ...input.analysis.strengths,
    ...input.analysis.weaknesses,
    ...input.analysis.risks,
    ...input.analysis.reusablePrinciples,
    ...input.analysis.avoidPatterns,
    ...input.analysis.differentiationOpportunities,
  ].flatMap((item) => item.evidenceAssetIds);
  if (evidenceIds.some((id) => !allowed.has(id))) throw new Error("分析引用了未确认或不属于该竞品的图片证据");
  return input.analysis;
}
