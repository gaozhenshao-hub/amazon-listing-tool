import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { kbListingCopywriting, kbProductInnovations } from "../../../drizzle/schema/knowledge";
import { COMPETITOR_ANALYSIS_PROMPT } from "../../prompts";
import * as projectDb from "../../repositories";
import { requireDb } from "../../repositories/dbClient";
import { formatCompetitorAnalysisSummary } from "../listing/competitorHumanReview";
import { runEmperorSkill, safeParseSkillJSON } from "../ai_os/services/skillRunner";
import { registerCompetitorAnalysisArtifact } from "../ai_os/services/businessArtifactRegistry";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../../services/aiJobRunner";
import {
  legacyConsumerAgentConfig,
  markLegacyConsumerAgentFailed,
  markLegacyConsumerAgentRunning,
  markLegacyConsumerAgentWaitingHuman,
  startLegacyConsumerAgentRun,
  type LegacyAnalysisConsumerType,
} from "./legacyConsumerAgent";
import { loadConfirmedSnapshotForConsumer, type LegacyConsumerProjection } from "./legacyConsumerProjection";

const ListingAnalysisSchema = z.object({
  titleAnalysis: z.object({ structure: z.string().default(""), keywords: z.string().default(""), score: z.coerce.number().min(0).max(10) }).passthrough(),
  bulletPointsAnalysis: z.object({ highlights: z.string().default(""), keywordDensity: z.string().default(""), structure: z.string().default(""), score: z.coerce.number().min(0).max(10) }).passthrough(),
  descriptionAnalysis: z.object({ storytelling: z.string().default(""), seoOptimization: z.string().default(""), score: z.coerce.number().min(0).max(10) }).passthrough(),
  keywordCoverage: z.object({ primaryKeywords: z.array(z.string()).default([]), missingKeywords: z.array(z.string()).default([]), score: z.coerce.number().min(0).max(10) }).passthrough(),
  conversionTips: z.array(z.string()).default([]),
  competitiveHighlights: z.array(z.string()).default([]),
  copywritingTechniques: z.array(z.string()).default([]),
  overallScore: z.coerce.number().min(0).max(100),
  summary: z.string().min(1),
}).passthrough();

const ProductAnalysisSchema = z.object({
  marketPositioning: z.string().min(1),
  functionalHighlights: z.string().min(1),
  designDifferentiation: z.string().min(1),
  painPointSolutions: z.string().min(1),
  pricingStrategy: z.string().min(1),
  competitiveAdvantages: z.string().min(1),
  inspiringElements: z.string().min(1),
  overallScore: z.coerce.number().min(0).max(10),
  summary: z.string().min(1),
}).passthrough();

const JobInputSchema = z.object({
  consumerType: z.enum(["kb_listing", "kb_product", "project_competitor"]),
  businessId: z.number().int().positive(),
  workspaceId: z.number().int().positive(),
  userId: z.number().int().positive(),
  asin: z.string().regex(/^[A-Z0-9]{10}$/),
  confirmedSnapshotId: z.number().int().positive(),
  agentRunId: z.string().min(1),
  agentNodeId: z.string().min(1),
});

function snapshotContext(data: Awaited<ReturnType<typeof loadConfirmedSnapshotForConsumer>>["data"]) {
  return [
    `ASIN: ${data.asin}`,
    data.title ? `Title: ${data.title}` : null,
    data.brand ? `Brand: ${data.brand}` : null,
    data.category ? `Category: ${data.category}` : null,
    data.price ? `Price: ${data.price.value} ${data.price.currency}` : null,
    data.rating ? `Rating: ${data.rating}` : null,
    data.reviewCount !== null ? `Review Count: ${data.reviewCount}` : null,
    data.bulletPoints.length ? `Bullet Points:\n${data.bulletPoints.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : null,
    data.description ? `Description: ${data.description}` : null,
  ].filter((item): item is string => Boolean(item)).join("\n\n");
}

async function runListingAnalysis(input: z.infer<typeof JobInputSchema>, context: string) {
  const result = await runEmperorSkill({
    skillSlug: "listing.competitor.analyze",
    userId: input.userId,
    workspaceId: input.workspaceId,
    context,
    variables: { context },
    legacySystemPrompt: `你是资深亚马逊Listing文案分析专家。分析标题结构、五点卖点、描述、关键词覆盖、转化建议与可借鉴技巧。只返回JSON。`,
    migrationSource: "server/domains/acquisition/legacyConsumerAnalysisJob.ts",
    validate: content => ListingAnalysisSchema.parse(safeParseSkillJSON(content)),
  });
  return result.parsed;
}

async function runProductAnalysis(input: z.infer<typeof JobInputSchema>, context: string) {
  const result = await runEmperorSkill({
    skillSlug: "analysis.competitor.single",
    userId: input.userId,
    workspaceId: input.workspaceId,
    context,
    variables: { context },
    legacySystemPrompt: `你是资深亚马逊产品创意分析专家。分析市场定位、功能亮点、设计差异、痛点方案、定价策略、竞争优势与可借鉴要素。只返回JSON。`,
    migrationSource: "server/domains/acquisition/legacyConsumerAnalysisJob.ts",
    validate: content => ProductAnalysisSchema.parse(safeParseSkillJSON(content)),
  });
  return result.parsed;
}

async function runProjectCompetitorAnalysis(input: z.infer<typeof JobInputSchema>, context: string) {
  const result = await runEmperorSkill<Record<string, unknown>>({
    skillSlug: "listing.competitor.analyze",
    userId: input.userId,
    workspaceId: input.workspaceId,
    context: `Analyze this competitor product from a human-confirmed Amazon snapshot:\n\n${context}`,
    variables: { context },
    legacySystemPrompt: COMPETITOR_ANALYSIS_PROMPT,
    migrationSource: "server/domains/acquisition/legacyConsumerAnalysisJob.ts",
    validate: content => {
      const parsed = safeParseSkillJSON<Record<string, unknown>>(content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || Object.keys(parsed).length === 0) {
        throw new Error("竞品分析Skill返回空或非结构化JSON");
      }
      return parsed;
    },
  });
  return result.parsed;
}

async function executeLegacyConsumerAnalysis(job: AiJobSnapshot) {
  const input = JobInputSchema.parse(job.input);
  const db = await requireDb("Amazon confirmed snapshot consumer analysis");
  await markLegacyConsumerAgentRunning({ consumerType: input.consumerType, agentRunId: input.agentRunId, aiJobRunId: job.runId, attempt: job.attempt });
  try {
    const snapshot = await loadConfirmedSnapshotForConsumer({ db, workspaceId: input.workspaceId, confirmedSnapshotId: input.confirmedSnapshotId });
    if (snapshot.confirmed.asin !== input.asin) throw new Error("confirmed snapshot ASIN mismatch");
    const context = snapshotContext(snapshot.data);
    await updateAiJobProgress(job.runId, 35);
    let output: unknown;

    if (input.consumerType === "kb_listing") {
      const analysis = await runListingAnalysis(input, context);
      await db.update(kbListingCopywriting).set({
        aiAnalysis: JSON.stringify(analysis),
        overallScore: Math.round(analysis.overallScore),
        status: "pending_review",
      }).where(and(
        eq(kbListingCopywriting.workspaceId, input.workspaceId),
        eq(kbListingCopywriting.id, input.businessId),
        eq(kbListingCopywriting.remoteId, input.confirmedSnapshotId),
      ));
      output = { consumerType: input.consumerType, recordId: input.businessId, analysis };
    } else if (input.consumerType === "kb_product") {
      const analysis = await runProductAnalysis(input, context);
      await db.update(kbProductInnovations).set({
        aiAnalysis: JSON.stringify(analysis),
        overallScore: Math.round(analysis.overallScore),
        status: "pending_review",
      }).where(and(
        eq(kbProductInnovations.workspaceId, input.workspaceId),
        eq(kbProductInnovations.id, input.businessId),
        eq(kbProductInnovations.remoteId, input.confirmedSnapshotId),
      ));
      output = { consumerType: input.consumerType, recordId: input.businessId, analysis };
    } else {
      const analysis = await runProjectCompetitorAnalysis(input, context);
      const gallery = snapshot.assets
        .filter((asset: any) => asset.role === "main" || asset.role === "secondary")
        .sort((a: any, b: any) => a.positionIndex - b.positionIndex)
        .map((asset: any) => asset.storageKey);
      const summary = formatCompetitorAnalysisSummary(analysis);
      const saved = await projectDb.upsertCompetitorAnalysis({
        projectId: input.businessId,
        asin: input.asin,
        title: snapshot.data.title,
        bulletPoints: JSON.stringify(snapshot.data.bulletPoints),
        imageUrls: JSON.stringify(gallery),
        price: snapshot.data.price ? `${snapshot.data.price.value} ${snapshot.data.price.currency}` : null,
        rating: snapshot.data.rating,
        reviewCount: snapshot.data.reviewCount === null ? null : String(snapshot.data.reviewCount),
        reviewAnalysis: null,
        keywords: Array.isArray((analysis as any).keywords) ? JSON.stringify((analysis as any).keywords) : null,
        rawData: JSON.stringify({
          analysis,
          source: "unified_amazon_acquisition",
          confirmedSnapshotId: input.confirmedSnapshotId,
          contentHash: snapshot.confirmed.contentHash,
        }),
        aiSummary: summary,
        summary,
        summaryStatus: "draft",
      });
      await registerCompetitorAnalysisArtifact(saved.id, "ai_output");
      output = { consumerType: input.consumerType, projectId: input.businessId, analysisId: saved.id, analysis };
    }
    await updateAiJobProgress(job.runId, 90);
    await markLegacyConsumerAgentWaitingHuman({
      consumerType: input.consumerType,
      agentRunId: input.agentRunId,
      aiJobRunId: job.runId,
      attempt: job.attempt,
      output,
    });
    return output;
  } catch (error) {
    await markLegacyConsumerAgentFailed({
      consumerType: input.consumerType,
      agentRunId: input.agentRunId,
      aiJobRunId: job.runId,
      attempt: job.attempt,
      finalAttempt: job.attempt >= job.maxAttempts,
      error,
    }).catch(() => null);
    throw error;
  }
}

export async function startLegacyConsumerAnalysisJob(projection: LegacyConsumerProjection) {
  if (projection.consumerType === "conversion_collector") return null;
  const consumerType: LegacyAnalysisConsumerType = projection.consumerType;
  const businessId = projection.consumerType === "project_competitor"
    ? projection.projectId
    : projection.recordId;
  const agent = await startLegacyConsumerAgentRun({
    consumerType,
    businessId,
    workspaceId: projection.workspaceId,
    userId: projection.userId,
    confirmedSnapshotId: projection.confirmedSnapshotId,
    asin: projection.asin,
  });
  const item = legacyConsumerAgentConfig(consumerType);
  return startRegisteredAiJob({
    kind: `amazon.consumer.${consumerType}.analyze`,
    module: consumerType === "kb_product" ? "productDevelopment" : "listing",
    procedure: "amazonAcquisition.confirmReview",
    workspaceId: projection.workspaceId,
    userId: projection.userId,
    projectId: businessId,
    skillSlug: item.skillSlug,
    input: {
      consumerType,
      businessId,
      workspaceId: projection.workspaceId,
      userId: projection.userId,
      asin: projection.asin,
      confirmedSnapshotId: projection.confirmedSnapshotId,
      agentRunId: agent.agentRunId,
      agentNodeId: agent.agentNodeId,
    },
    queueName: "analysis",
    maxAttempts: 2,
    timeoutSeconds: 600,
  });
}

registerAiJobHandler({
  id: "amazon-confirmed-snapshot-consumer-analysis-v1",
  match: job => job.kind.startsWith("amazon.consumer.") && job.kind.endsWith(".analyze"),
  handler: executeLegacyConsumerAnalysis,
});
