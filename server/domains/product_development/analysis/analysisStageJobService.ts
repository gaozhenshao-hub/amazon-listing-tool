import { eq } from "drizzle-orm";
import { z } from "zod";
import { devProjectTagCategories, devProjectTagItems } from "../../../../drizzle/schema";
import * as devDb from "../../../devDb";
import {
  ATTRIBUTE_ANALYSIS_PROMPT,
  BRAND_COMPETITION_PROMPT,
  DECISION_DASHBOARD_PROMPT,
  MARKET_OVERVIEW_PROMPT,
  PRICE_ANALYSIS_PROMPT,
  REVIEW_KANO_PROMPT,
  TAG_CROSS_ANALYSIS_PROMPT,
} from "../../../devAnalysisPrompts";
import {
  calcBrandCompetition,
  calcCrossAnalysis,
  calcMarketOverview,
  calcPriceSegmentsEnhanced,
  calcReviewStats,
  calcSingleDimensionStats,
  type ProductData,
  type ReviewData,
  type TagData,
} from "../../../devStatsEngine";
import { getDb } from "../../../repositories/dbClient";
import {
  cancelAiJob,
  generateAiJobRunId,
  getAiJobRun,
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../../ai_os/services/jobRunner";
import {
  recordBusinessArtifactUse,
  resolveCurrentDevAnalysisArtifact,
} from "../../ai_os/services/businessArtifactRegistry";
import { runEmperorSkill, safeParseSkillJSON } from "../../ai_os/services/skillRunner";
import { mapToProductData } from "./dataHelpers";
import { normalizeParentMarketMetrics } from "../panorama/marketMetrics";
import { validateInformationSummaryForConfirmation } from "./informationSummary";
import {
  completeDevAnalysisStageRunConsistently,
  StaleDevAnalysisRunError,
  type DevAnalysisStageType,
} from "./stageConsistency";
import { buildProductAnalysisContextPackage } from "./stageContextBuilder";
import {
  syncProductAnalysisNodeCompleted,
  syncProductAnalysisNodeFailure,
  syncProductAnalysisNodeProgress,
  syncProductAnalysisNodeQueued,
  syncProductAnalysisNodeRunning,
  syncProductAnalysisCancel,
} from "./productAnalysisAgent";

export const PRODUCT_ANALYSIS_JOB_KIND = "dev.analysis.stage";
export const PRODUCT_ANALYSIS_STALE_MS = 12 * 60_000;

export const productAnalysisJobStages = [
  "market_overview",
  "attribute_cross",
  "price_analysis",
  "brand_competition",
  "review_kano",
  "tag_cross",
  "decision_dashboard",
] as const;

export type ProductAnalysisJobStage = typeof productAnalysisJobStages[number];

const jobInputSchema = z.object({
  projectId: z.number().int().positive(),
  stage: z.enum(productAnalysisJobStages),
  dim1Name: z.string().max(200).optional(),
  dim2Name: z.string().max(200).optional(),
  dim1CategoryId: z.number().int().positive().optional(),
  dim2CategoryId: z.number().int().positive().optional(),
  agentRunId: z.string().max(80).optional(),
  agentNodeId: z.string().max(80).optional(),
});

type QueueInput = z.infer<typeof jobInputSchema> & {
  userId: number;
  workspaceId?: number | null;
};

type StageEvidence = {
  result: Record<string, unknown>;
  evidence: unknown;
  provenance: Array<{ source: string; recordCount?: number; artifactRef?: string; confirmed?: boolean }>;
};

const stageConfig: Record<ProductAnalysisJobStage, {
  dbStage: DevAnalysisStageType;
  skillSlug: string;
  prompt: string;
  timeoutSeconds: number;
}> = {
  market_overview: {
    dbStage: "market_overview",
    skillSlug: "dev.analysis.market_overview",
    prompt: MARKET_OVERVIEW_PROMPT,
    timeoutSeconds: 240,
  },
  attribute_cross: {
    dbStage: "attribute_cross",
    skillSlug: "dev.analysis.attribute_cross",
    prompt: ATTRIBUTE_ANALYSIS_PROMPT,
    timeoutSeconds: 300,
  },
  price_analysis: {
    dbStage: "price_analysis",
    skillSlug: "dev.analysis.price_analysis",
    prompt: PRICE_ANALYSIS_PROMPT,
    timeoutSeconds: 240,
  },
  brand_competition: {
    dbStage: "brand_competition",
    skillSlug: "dev.analysis.brand_competition",
    prompt: BRAND_COMPETITION_PROMPT,
    timeoutSeconds: 240,
  },
  review_kano: {
    dbStage: "review_kano",
    skillSlug: "dev.analysis.review_kano",
    prompt: REVIEW_KANO_PROMPT,
    timeoutSeconds: 360,
  },
  tag_cross: {
    dbStage: "attribute_cross",
    skillSlug: "dev.analysis.tag_cross",
    prompt: TAG_CROSS_ANALYSIS_PROMPT,
    timeoutSeconds: 300,
  },
  decision_dashboard: {
    dbStage: "decision_dashboard",
    skillSlug: "dev.analysis.decision_dashboard",
    prompt: DECISION_DASHBOARD_PROMPT,
    timeoutSeconds: 300,
  },
};

export function getProductAnalysisStageConfig(stage: ProductAnalysisJobStage) {
  return stageConfig[stage];
}

function serializeRunError(error: unknown) {
  return (error instanceof Error ? error.message : String(error || "产品分析失败")).slice(0, 1_000);
}

function toTagData(tags: Awaited<ReturnType<typeof devDb.getDevProductTags>>): TagData[] {
  return tags.map((tag) => ({
    asin: tag.asin || "",
    dimensionName: tag.dimensionName || "",
    dimensionValue: tag.dimensionValue || "",
  }));
}

function toReviewData(reviews: Awaited<ReturnType<typeof devDb.getDevReviewsByProject>>): ReviewData[] {
  return reviews.map((review) => ({
    asin: review.asin || "",
    rating: review.rating,
    content: review.content,
    title: review.title,
    reviewDate: review.reviewDate,
    isVP: review.isVP,
    isVine: review.isVine,
    variant: review.variant,
    helpfulCount: review.helpfulCount,
    hasImage: review.hasImage,
    hasVideo: review.hasVideo,
  }));
}

async function buildTagCrossEvidence(
  input: z.infer<typeof jobInputSchema>,
  products: ProductData[],
): Promise<StageEvidence> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const [categories, allItems, productTags] = await Promise.all([
    db.select().from(devProjectTagCategories).where(eq(devProjectTagCategories.projectId, input.projectId)),
    db.select().from(devProjectTagItems).where(eq(devProjectTagItems.projectId, input.projectId)),
    devDb.getDevProductTags(input.projectId),
  ]);
  const confirmedCategories = categories.filter((category) => category.confirmed === 1);
  if (confirmedCategories.length < 2) {
    throw new Error("至少需要2个已确认的标签分类才能进行交叉分析");
  }

  const tagData = toTagData(productTags);
  const dimensionNames = Array.from(new Set(tagData.map((tag) => tag.dimensionName).filter(Boolean)));
  const categoryNameById = new Map<number, string>(
    confirmedCategories.map((category) => [category.id, category.categoryName]),
  );
  const categoryNames = Array.from(categoryNameById.values());
  const singleDimStats = dimensionNames.map((dimension) => calcSingleDimensionStats(products, tagData, dimension));
  const projectTagSummary = confirmedCategories.map((category) => ({
    category: category.categoryName,
    categoryKey: category.categoryKey,
    tags: allItems
      .filter((item) => item.categoryId === category.id)
      .map((item) => ({ name: item.tagName, value: item.tagValue || "" })),
  }));

  let dim1Name = input.dim1CategoryId ? categoryNameById.get(input.dim1CategoryId) || "" : "";
  let dim2Name = input.dim2CategoryId ? categoryNameById.get(input.dim2CategoryId) || "" : "";
  const matchingDimensions = dimensionNames.filter((dimension) => (
    categoryNames.some((category) => category === dimension || dimension.includes(category) || category.includes(dimension))
  ));
  if (!dim1Name) dim1Name = matchingDimensions[0] || dimensionNames[0] || "";
  if (!dim2Name) dim2Name = matchingDimensions[1] || matchingDimensions[0] || dimensionNames[1] || dimensionNames[0] || "";
  const crossResult = dim1Name && dim2Name
    ? calcCrossAnalysis(products, tagData, dim1Name, dim2Name)
    : null;

  const result = {
    singleDimStats,
    crossResult,
    dimensionNames,
    projectTagSummary,
    confirmedCategories: confirmedCategories.map((category) => ({
      id: category.id,
      name: category.categoryName,
      key: category.categoryKey,
    })),
    selectedDims: { dim1: dim1Name, dim2: dim2Name },
  };
  return {
    result,
    evidence: result,
    provenance: [
      { source: "dev_products", recordCount: products.length },
      { source: "dev_product_tags", recordCount: productTags.length },
      { source: "dev_project_tag_categories.confirmed", recordCount: confirmedCategories.length, confirmed: true },
      { source: "dev_project_tag_items", recordCount: allItems.length },
    ],
  };
}

async function buildStageEvidence(
  input: z.infer<typeof jobInputSchema>,
  project: { id: number; name?: string | null; targetMarket?: string | null; keywords?: string | null },
  consumerRunId: string,
): Promise<StageEvidence> {
  if (input.stage === "decision_dashboard") {
    const informationStage = await devDb.getDevAnalysisStage(input.projectId, "information_summary");
    if (!informationStage || informationStage.status !== "confirmed") {
      throw new Error("信息汇总尚未确认锁定");
    }
    const artifact = await resolveCurrentDevAnalysisArtifact(informationStage.id);
    if (!artifact?.content) throw new Error("已确认的信息汇总 Artifact 不可用，请解锁后重新确认");
    await recordBusinessArtifactUse({
      artifact,
      consumerDomain: "project",
      consumerType: "ai_job",
      consumerId: consumerRunId,
      projectId: input.projectId,
      runId: consumerRunId,
      nodeId: "decision_dashboard",
      metadata: { stageType: "information_summary" },
    });
    const informationSummary = validateInformationSummaryForConfirmation(artifact.content);
    return {
      result: {},
      evidence: { informationSummary },
      provenance: [{ source: "artifact", artifactRef: artifact.ref, confirmed: true }],
    };
  }

  const products = await devDb.getDevProductsByProject(input.projectId);
  if (products.length === 0) throw new Error("未找到竞品数据，请先上传并解析数据");
  const productData = normalizeParentMarketMetrics(products.map(mapToProductData));

  if (input.stage === "market_overview") {
    const stats = calcMarketOverview(productData);
    return {
      result: { stats },
      evidence: { stats },
      provenance: [{ source: "dev_products", recordCount: products.length }],
    };
  }

  if (input.stage === "brand_competition") {
    const brandStats = calcBrandCompetition(productData);
    return {
      result: { brandStats },
      evidence: { brandStats },
      provenance: [{ source: "dev_products", recordCount: products.length }],
    };
  }

  if (input.stage === "review_kano") {
    const reviews = await devDb.getDevReviewsByProject(input.projectId);
    if (reviews.length === 0) throw new Error("未找到评论数据，请先导入评论");
    const stats = calcReviewStats(toReviewData(reviews));
    const samples = {
      positive: reviews.filter((review) => Number(review.rating || 0) >= 4).slice(0, 80)
        .map((review) => ({ rating: review.rating, content: review.content || "" })),
      negative: reviews.filter((review) => Number(review.rating || 0) <= 2).slice(0, 80)
        .map((review) => ({ rating: review.rating, content: review.content || "" })),
      neutral: reviews.filter((review) => Number(review.rating || 0) === 3).slice(0, 30)
        .map((review) => ({ rating: review.rating, content: review.content || "" })),
    };
    return {
      result: { stats },
      evidence: { stats, samples },
      provenance: [
        { source: "dev_reviews", recordCount: reviews.length },
        { source: "dev_reviews.sample", recordCount: samples.positive.length + samples.negative.length + samples.neutral.length },
      ],
    };
  }

  if (input.stage === "tag_cross") {
    return buildTagCrossEvidence(input, productData);
  }

  const tags = await devDb.getDevProductTags(input.projectId);
  const tagData = toTagData(tags);
  if (input.stage === "price_analysis") {
    const priceSegments = calcPriceSegmentsEnhanced(productData, tagData);
    const evidence = {
      priceSegments: priceSegments.map(({ asins: _asins, ...segment }) => segment),
    };
    return {
      result: { priceSegments },
      evidence,
      provenance: [
        { source: "dev_products", recordCount: products.length },
        { source: "dev_product_tags", recordCount: tags.length },
      ],
    };
  }

  const dimensionNames = Array.from(new Set(tagData.map((tag) => tag.dimensionName).filter(Boolean)));
  const singleDimStats = dimensionNames.map((dimension) => calcSingleDimensionStats(productData, tagData, dimension));
  const dim1 = input.dim1Name || dimensionNames[0] || "";
  const dim2 = input.dim2Name || dimensionNames[1] || dimensionNames[0] || "";
  const crossResult = dim1 && dim2 ? calcCrossAnalysis(productData, tagData, dim1, dim2) : null;
  const result = { singleDimStats, crossResult, dimensionNames };
  return {
    result,
    evidence: result,
    provenance: [
      { source: "dev_products", recordCount: products.length },
      { source: "dev_product_tags", recordCount: tags.length },
    ],
  };
}

async function runProductAnalysisStage(job: AiJobSnapshot, signal: AbortSignal) {
  const input = jobInputSchema.parse(job.input);
  const config = stageConfig[input.stage];
  let agentRunId = input.agentRunId || "";
  const updateProgress = async (progress: number, runError: string | null = null) => {
    const stage = await devDb.updateDevAnalysisStageForRun(input.projectId, config.dbStage, job.runId, {
      status: "running",
      runProgress: progress,
      runError,
      runCompletedAt: null,
    });
    if (!stage) return false;
    await updateAiJobProgress(job.runId, progress, {
      expectedWorkerId: job.lockedBy || undefined,
      expectedAttempt: job.attempt,
    });
    if (agentRunId) {
      await syncProductAnalysisNodeProgress({
        agentRunId,
        stageType: config.dbStage,
        aiJobRunId: job.runId,
        aiJobAttempt: job.attempt,
        progress,
        errorMessage: runError,
      });
    }
    return true;
  };

  try {
    if (!agentRunId) {
      const linked = await syncProductAnalysisNodeRunning({
        projectId: input.projectId,
        stageType: config.dbStage,
        userId: job.userId,
        workspaceId: job.workspaceId,
        aiJobRunId: job.runId,
      });
      agentRunId = linked?.agentRunId || "";
    }
    if (!await updateProgress(15)) return { skipped: true, reason: "阶段任务已被新的运行替代" };
    const project = await devDb.getDevProjectByWorkspace(input.projectId, job.workspaceId, job.userId);
    if (!project) throw new Error("产品开发项目不存在或当前工作区无权访问");

    const stageEvidence = await buildStageEvidence(input, project, job.runId);
    if (!await updateProgress(45)) return { skipped: true, reason: "阶段任务已被新的运行替代" };
    const context = buildProductAnalysisContextPackage({
      stageType: input.stage,
      project,
      evidence: stageEvidence.evidence,
      provenance: stageEvidence.provenance,
    });

    const skillResult = await runEmperorSkill<Record<string, unknown>>({
      skillSlug: config.skillSlug,
      userId: job.userId,
      workspaceId: job.workspaceId,
      context: context.serialized,
      variables: {
        schemaVersion: "1.0",
        stageType: input.stage,
        contextCompression: context.package.compression,
      },
      legacySystemPrompt: config.prompt,
      migrationSource: "drizzle/0126_product_analysis_stage_jobs.sql",
      maxModelAttempts: 1,
      signal,
      validate: (content) => {
        const parsed = safeParseSkillJSON<Record<string, unknown>>(content);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || "raw" in parsed) {
          throw new Error(`皇帝 Skill ${config.skillSlug} 未返回有效 JSON`);
        }
        return parsed;
      },
    });
    if (!await updateProgress(85)) return { skipped: true, reason: "阶段任务已被新的运行替代" };

    const result = { ...stageEvidence.result, ai: skillResult.parsed };
    try {
      const completed = await completeDevAnalysisStageRunConsistently({
        projectId: input.projectId,
        stageType: config.dbStage,
        runId: job.runId,
        rawResult: JSON.stringify(result),
      });
      if (agentRunId) {
        await syncProductAnalysisNodeCompleted({
          agentRunId,
          projectId: input.projectId,
          stageType: config.dbStage,
          aiJobRunId: job.runId,
          aiJobAttempt: job.attempt,
          output: result,
          invalidated: completed.invalidated,
        });
      }
      return {
        stageId: completed.stage.id,
        stageType: config.dbStage,
        skillSlug: config.skillSlug,
        contextCompression: context.package.compression,
        agentRunId: agentRunId || null,
      };
    } catch (error) {
      if (error instanceof StaleDevAnalysisRunError) {
        return { skipped: true, reason: "阶段任务完成前已被新的运行替代" };
      }
      throw error;
    }
  } catch (error) {
    const abortReason = signal.aborted ? String(signal.reason || "") : "";
    const retryableTimeout = /timed?\s*out|timeout/i.test(abortReason);
    const finalAttempt = job.attempt >= job.maxAttempts || (signal.aborted && !retryableTimeout);
    if (finalAttempt) {
      await devDb.failDevAnalysisStageRun(input.projectId, config.dbStage, job.runId, error);
    } else {
      await devDb.updateDevAnalysisStageForRun(input.projectId, config.dbStage, job.runId, {
        status: "running",
        runProgress: 15,
        runError: `本次调用失败，后台将自动重试（${job.attempt}/${job.maxAttempts}）：${serializeRunError(error)}`,
        runCompletedAt: null,
      });
    }
    if (agentRunId) {
      await syncProductAnalysisNodeFailure({
        agentRunId,
        stageType: config.dbStage,
        aiJobRunId: job.runId,
        aiJobAttempt: job.attempt,
        finalAttempt,
        error,
        failureKind: signal.aborted ? (retryableTimeout ? "timeout" : "cancel") : "error",
      }).catch((syncError) => console.warn("[Product Analysis Agent] Failed to sync node failure", syncError));
    }
    throw error;
  }
}

registerAiJobHandler({
  id: "productDevelopment.analysisStage",
  match: (job) => job.kind === PRODUCT_ANALYSIS_JOB_KIND,
  handler: (job, context) => runProductAnalysisStage(job, context.signal),
});

export async function queueProductAnalysisStage(input: QueueInput) {
  const parsed = jobInputSchema.parse(input);
  const config = stageConfig[parsed.stage];
  const current = await devDb.getDevAnalysisStage(parsed.projectId, config.dbStage);
  const currentAgeMs = current?.updatedAt
    ? Date.now() - new Date(current.updatedAt).getTime()
    : Number.POSITIVE_INFINITY;
  if ((current?.status === "running" || current?.status === "generating") && current.runId && currentAgeMs < PRODUCT_ANALYSIS_STALE_MS) {
    const currentJob = await getAiJobRun(current.runId).catch(() => null);
    const linked = currentJob?.status === "queued" ? await syncProductAnalysisNodeQueued({
      projectId: parsed.projectId,
      stageType: config.dbStage,
      userId: input.userId,
      workspaceId: input.workspaceId,
      aiJobRunId: current.runId,
      aiJobAttempt: currentJob.attempt,
      maxAttempts: currentJob.maxAttempts,
    }) : await syncProductAnalysisNodeRunning({
      projectId: parsed.projectId,
      stageType: config.dbStage,
      userId: input.userId,
      workspaceId: input.workspaceId,
      aiJobRunId: current.runId,
      aiJobAttempt: currentJob?.attempt,
    });
    return {
      runId: current.runId,
      agentRunId: linked?.agentRunId || null,
      status: currentJob?.status === "queued" ? "queued" as const : "running" as const,
      progress: current.runProgress || 0,
      alreadyRunning: true,
    };
  }
  if (current?.runId && (current.status === "running" || current.status === "generating")) {
    await cancelAiJob(current.runId, "产品分析任务已超时，由新的运行接管").catch(() => null);
  }

  const runId = generateAiJobRunId(`dev_${parsed.stage}`);
  const claim = await devDb.claimDevAnalysisStageRun({
    projectId: parsed.projectId,
    userId: input.userId,
    stageType: config.dbStage,
    runId,
    staleAfterSeconds: PRODUCT_ANALYSIS_STALE_MS / 1_000,
  });
  if (!claim.claimed) {
    return {
      runId: claim.runId || runId,
      status: "running" as const,
      progress: claim.runProgress || 0,
      alreadyRunning: true,
    };
  }

  let agentRunId = "";
  try {
    const linked = await syncProductAnalysisNodeQueued({
      projectId: parsed.projectId,
      stageType: config.dbStage,
      userId: input.userId,
      workspaceId: input.workspaceId,
      aiJobRunId: runId,
      aiJobAttempt: 0,
      maxAttempts: 3,
    });
    agentRunId = linked?.agentRunId || "";
    await startRegisteredAiJob({
      runId,
      kind: PRODUCT_ANALYSIS_JOB_KIND,
      module: "productDevelopment",
      procedure: `devAnalysis.${parsed.stage}`,
      workspaceId: input.workspaceId ?? null,
      userId: input.userId,
      projectId: parsed.projectId,
      skillSlug: config.skillSlug,
      input: { ...parsed, agentRunId: agentRunId || undefined, agentNodeId: config.dbStage },
      progress: 5,
      priority: 20,
      queueName: "analysis",
      maxAttempts: 3,
      timeoutSeconds: config.timeoutSeconds,
    });
  } catch (error) {
    await devDb.failDevAnalysisStageRun(parsed.projectId, config.dbStage, runId, error);
    if (agentRunId) {
      await syncProductAnalysisNodeFailure({
        agentRunId,
        stageType: config.dbStage,
        aiJobRunId: runId,
        aiJobAttempt: 0,
        finalAttempt: true,
        error,
      }).catch(() => null);
    }
    throw error;
  }
  return { runId, agentRunId: agentRunId || null, status: "queued" as const, progress: 5, alreadyRunning: false };
}

export async function cancelProductAnalysisStage(input: {
  projectId: number;
  stageType: DevAnalysisStageType;
  userId: number;
  workspaceId?: number | null;
  reason?: string;
}) {
  const stage = await devDb.getDevAnalysisStage(input.projectId, input.stageType);
  if (!stage?.runId || (stage.status !== "running" && stage.status !== "generating")) {
    return { canceled: false, reason: "当前阶段没有正在执行的任务" };
  }
  const reason = input.reason || "用户取消了产品分析任务";
  await cancelAiJob(stage.runId, reason);
  await devDb.failDevAnalysisStageRun(input.projectId, input.stageType, stage.runId, reason);
  await syncProductAnalysisCancel({
    projectId: input.projectId,
    stageType: input.stageType,
    userId: input.userId,
    workspaceId: input.workspaceId,
    aiJobRunId: stage.runId,
    reason,
  });
  return { canceled: true, runId: stage.runId };
}
