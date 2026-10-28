import { projects, competitorAnalyses } from "../../../drizzle/schema/project";
import { competitorRevision } from "../../repositories/project/competitorWritePolicy";
import { analyzeCompetitorDeep } from '../listing/competitorDeepAnalysis';
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { kbListingCopywriting, kbProductInnovations } from "../../../drizzle/schema/knowledge";
import * as projectDb from "../../repositories";
import { requireDb } from "../../repositories/dbClient";
import { runEmperorSkill, safeParseSkillJSON } from "../ai_os/services/skillRunner";
import { registerCompetitorAnalysisArtifact } from "../ai_os/services/businessArtifactRegistry";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
  type AiJobHandlerContext,
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
import { readJson } from '../../../shared/competitorPresentation';
import { loadSupplementalReviews } from '../listing/supplementalReviews';

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
  analysisId: z.number().int().positive().optional(),
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
    data.research ? `Supplementary evidence: ${JSON.stringify(data.research)}\nReview excerpts are a non-representative product-page sample; do not infer sentiment percentages or exact variant sales. customersSay is Amazon-generated AI review summary, not buyer review text; aspect mention counts are not independent review counts or sentiment percentages. Missing values mean unknown. Date First Available is the page's date, not a verified launch date.` : null,
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

async function executeLegacyConsumerAnalysis(job: AiJobSnapshot, jobContext: AiJobHandlerContext) {
  const input = JobInputSchema.parse(job.input);
  const db = await requireDb("Amazon confirmed snapshot consumer analysis");
  await markLegacyConsumerAgentRunning({ consumerType: input.consumerType, agentRunId: input.agentRunId, aiJobRunId: job.runId, attempt: job.attempt });
  try {
    const snapshot = await loadConfirmedSnapshotForConsumer({ db, workspaceId: input.workspaceId, confirmedSnapshotId: input.confirmedSnapshotId });
    if (snapshot.confirmed.asin !== input.asin) throw new Error("confirmed snapshot ASIN mismatch");
    if (input.consumerType === "project_competitor" && !input.analysisId) {
      await projectDb.assertLegacyCompetitorAcquisitionWritable(input.businessId, input.asin, { userId: input.userId, workspaceId: input.workspaceId, rejectCapturedSource: true });
    }
    const previousRecord = input.consumerType === 'project_competitor' ? await db.transaction(async tx => {
      const [parent] = await tx.select().from(projects).where(and(
        eq(projects.id, input.businessId), eq(projects.userId, input.userId), eq(projects.workspaceId, input.workspaceId),
      )).limit(1).for('update');
      if (!parent) throw new Error('项目不可访问');
      const [record] = await tx.select().from(competitorAnalyses).where(and(
        eq(competitorAnalyses.projectId, input.businessId), eq(competitorAnalyses.asin, input.asin),
        input.analysisId ? eq(competitorAnalyses.id, input.analysisId) : undefined,
      )).limit(1).for('update');
      if (input.analysisId && readJson(record?.rawData)?.presentationJobRunId !== job.runId) {
        throw new Error('分析任务尚未提交或已被替换，请重新分析');
      }
      return record;
    }) : null;
    const previousRaw = readJson(previousRecord?.rawData) || {};
    if (input.consumerType === "project_competitor" && input.analysisId) {
      const parent = await projectDb.getProjectById(input.businessId, input.userId, input.workspaceId);
      if (!parent || !previousRecord || previousRecord.id !== input.analysisId || previousRecord.summaryStatus === "confirmed"
        || previousRaw.confirmedSnapshotId !== input.confirmedSnapshotId) throw new Error("竞品资料或确认状态已变化，请重新分析");
    }
    const imported = previousRaw.supplementalReviewCount ? await loadSupplementalReviews(input.businessId,input.asin) : [];
    const context = snapshotContext(snapshot.data) + (previousRaw.manualSales ? `\nUser-calibrated monthly total sales for this ASIN and its variants: ${previousRaw.manualSales.value}. Use this total instead of the scraped purchase badges. Do not distribute it to variants without evidence.` : '') + (imported.length ? `\nUploaded reviews: ${imported.length}. Initial excerpts (the dedicated review stage analyzes all uploaded reviews in batches): ${JSON.stringify(imported.slice(0,30))}` : '');
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
      const deepAnalysis = await analyzeCompetitorDeep({userId:input.userId,workspaceId:input.workspaceId,data:snapshot.data,raw:previousRaw,assets:snapshot.assets,imported,signal:jobContext.signal,onProgress:n=>updateAiJobProgress(job.runId,n)});
      const analysis = {marketPositioning:deepAnalysis.summary.positioning,advantages:deepAnalysis.summary.advantages,weaknesses:deepAnalysis.summary.weaknesses,summary:deepAnalysis.summary.positioning};
      const gallery = snapshot.assets
        .filter((asset: any) => asset.role === "main" || asset.role === "secondary")
        .sort((a: any, b: any) => a.positionIndex - b.positionIndex)
        .map((asset: any) => asset.storageKey);
      const summary = [deepAnalysis.summary.positioning,...['advantages','weaknesses','learnings','opportunities'].map(k=>`${({advantages:'优势',weaknesses:'劣势',learnings:'可借鉴',opportunities:'可超越'} as any)[k]}：${(deepAnalysis.summary as any)[k].join('；')}`)].join('\n');
      const resultData = {
        projectId: input.businessId,
        asin: input.asin,
        title: snapshot.data.title,
        bulletPoints: JSON.stringify(snapshot.data.bulletPoints),
        imageUrls: JSON.stringify(gallery),
        price: snapshot.data.price ? `${snapshot.data.price.value} ${snapshot.data.price.currency}` : null,
        rating: snapshot.data.rating,
        reviewCount: snapshot.data.reviewCount === null ? null : String(snapshot.data.reviewCount),
        reviewAnalysis: null,
        keywords: (analysis as any).keywords ? JSON.stringify((analysis as any).keywords) : null,
        rawData: JSON.stringify({
          ...previousRaw,
          deepAnalysis,
          subtitle: snapshot.data.subtitle || null,
          manualSales: previousRaw.manualSales,
          imageAssets: snapshot.assets.map(a=>({role:a.role,storageKey:a.storageKey})),
          supplementalReviewCount: previousRaw.supplementalReviewCount,
          productQuestions: previousRaw.productQuestions,
          supplementalReviewRevision: previousRaw.supplementalReviewRevision,
          analysis,
          brand: snapshot.data.brand,
          description: snapshot.data.description,
          captureOnly: false,
          analysisStale: false,
          research: snapshot.data.research,
          presentationJobRunId: job.runId,
          source: "unified_amazon_acquisition",
          confirmedSnapshotId: input.confirmedSnapshotId,
          contentHash: snapshot.confirmed.contentHash,
        }),
        aiSummary: summary,
        summary,
        summaryStatus: "draft" as const,
      };
      const saved = input.analysisId && previousRecord
        ? await projectDb.saveCollectedCompetitorAnalysis(previousRecord.id, resultData, { projectId: input.businessId, userId: input.userId, workspaceId: input.workspaceId, expectedRevision: competitorRevision(previousRecord) })
        : await projectDb.upsertCompetitorAnalysis(resultData, { userId: input.userId, workspaceId: input.workspaceId, rejectCapturedSource: true });
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
  if (projection.consumerType === "conversion_collector" || (projection.consumerType === "project_competitor" && projection.captureOnly)) return null;
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
      ...(projection.consumerType === "project_competitor" && projection.analysisId ? { analysisId: projection.analysisId } : {}),
      agentRunId: agent.agentRunId,
      agentNodeId: agent.agentNodeId,
    },
    queueName: "analysis",
    maxAttempts: 2,
    timeoutSeconds: 3600,
  });
}

registerAiJobHandler({
  id: "amazon-confirmed-snapshot-consumer-analysis-v1",
  match: job => job.kind.startsWith("amazon.consumer.") && job.kind.endsWith(".analyze"),
  handler: executeLegacyConsumerAnalysis,
});
