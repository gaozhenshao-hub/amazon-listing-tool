import { AppError, APP_ERROR_CODES } from "@shared/_core/errors";
import { callDataApi } from "../../_core/dataApi";
import { productStageGatedError } from "../../_core/domainError";
import { invokeBusinessSkill } from "../ai_os/services/businessSkillGateway";
import { queueInformationSummaryGeneration } from "./analysis/informationSummaryService";
import { validateInformationSummaryForConfirmation } from "./analysis/informationSummary";
import { buildReportContext, getReportTitle } from "./analysis/reportContext";
import { checkStageGating, STAGE_TYPES, type GatingResult } from "./analysis/stageGating";
import { generateExternalSummary } from "./analysis/dataHelpers";
import {
  cancelProductAnalysisStage,
  queueProductAnalysisStage,
} from "./analysis/analysisStageJobService";
import {
  confirmDevAnalysisStageConsistently,
  editDevAnalysisStageConsistently,
  unlockDevAnalysisStageConsistently,
} from "./analysis/stageConsistency";
import {
  syncProductAnalysisConfirmation,
  syncProductAnalysisDraft,
} from "./analysis/productAnalysisAgent";
import {
  recordProductDevelopmentAudit,
  resolveDevProjectAccess,
} from "./security/productDevelopmentAccess";
import { productDevelopmentRepository as repository } from "./repository";
import type {
  ExternalAnalysisType,
  ProductAnalysisStageType,
  ProductDevelopmentContext,
  ProductReportType,
  ProductStageRunOptions,
  QueuedProductAnalysisStage,
} from "./types";

function parseAnalysisOutput(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function projectNotFound(projectId: number) {
  return new AppError({
    code: APP_ERROR_CODES.RESOURCE_NOT_FOUND,
    statusCode: 404,
    message: "产品开发项目不存在",
    details: { projectId },
  });
}

async function requireProject(ctx: ProductDevelopmentContext, projectId: number) {
  const project = await resolveDevProjectAccess(projectId, ctx);
  if (!project) throw projectNotFound(projectId);
  return project;
}

async function requireStageGate(projectId: number, stage: ProductAnalysisStageType) {
  const gating = await checkStageGating(projectId, stage);
  if (!gating.canRun) {
    throw productStageGatedError(stage, gating.reason || "前置条件未满足", { missingPrereqs: gating.missingPrereqs });
  }
  return gating;
}

async function recordStageAudit(
  ctx: ProductDevelopmentContext,
  projectId: number,
  stageType: string,
  operation: "run" | "edit" | "confirm" | "unlock",
) {
  await recordProductDevelopmentAudit({
    ctx,
    action: `product_development.stage.${operation}`,
    projectId,
    resourceType: "dev_analysis_stage",
    resourceId: `${projectId}:${stageType}`,
    resourceName: stageType,
    riskLevel: operation === "confirm" || operation === "unlock" ? "high" : "medium",
    metadata: { stageType },
  });
}

async function runStage(
  ctx: ProductDevelopmentContext,
  projectId: number,
  stage: QueuedProductAnalysisStage,
  options: ProductStageRunOptions = {},
) {
  await requireProject(ctx, projectId);
  await requireStageGate(projectId, stage);
  await recordStageAudit(ctx, projectId, stage, "run");
  return queueProductAnalysisStage({
    projectId,
    stage,
    userId: ctx.user.id,
    workspaceId: ctx.workspaceId,
    ...options,
  });
}

const reportResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "analysis_report",
    strict: true,
    schema: {
      type: "object",
      properties: {
        summary: { type: "string", description: "Markdown格式的分析总结" },
        chartData: {
          type: "array",
          items: {
            type: "object",
            properties: {
              chartType: { type: "string", description: "bar/pie/line/radar" },
              title: { type: "string" },
              data: {
                type: "array",
                items: {
                  type: "object",
                  properties: { name: { type: "string" }, value: { type: "number" } },
                  required: ["name", "value"],
                  additionalProperties: false,
                },
              },
            },
            required: ["chartType", "title", "data"],
            additionalProperties: false,
          },
        },
      },
      required: ["summary", "chartData"],
      additionalProperties: false,
    },
  },
};

const reviewTopicsResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "review_content_stats",
    strict: true,
    schema: {
      type: "object",
      properties: {
        positiveTopics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              count: { type: "number" },
              example: { type: "string" },
            },
            required: ["topic", "count", "example"],
            additionalProperties: false,
          },
        },
        negativeTopics: {
          type: "array",
          items: {
            type: "object",
            properties: {
              topic: { type: "string" },
              count: { type: "number" },
              example: { type: "string" },
            },
            required: ["topic", "count", "example"],
            additionalProperties: false,
          },
        },
      },
      required: ["positiveTopics", "negativeTopics"],
      additionalProperties: false,
    },
  },
};

const wordCloudResponseFormat = {
  type: "json_schema" as const,
  json_schema: {
    name: "word_cloud",
    strict: true,
    schema: {
      type: "object",
      properties: {
        positiveWords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              word: { type: "string" },
              translation: { type: "string" },
              weight: { type: "number" },
            },
            required: ["word", "translation", "weight"],
            additionalProperties: false,
          },
        },
        negativeWords: {
          type: "array",
          items: {
            type: "object",
            properties: {
              word: { type: "string" },
              translation: { type: "string" },
              weight: { type: "number" },
            },
            required: ["word", "translation", "weight"],
            additionalProperties: false,
          },
        },
      },
      required: ["positiveWords", "negativeWords"],
      additionalProperties: false,
    },
  },
};

export const productDevelopmentService = {
  getStages: (projectId: number) => repository.getStages(projectId),

  async getStageGating(projectId: number) {
    const result: Record<string, GatingResult> = {};
    for (const stage of STAGE_TYPES) result[stage] = await checkStageGating(projectId, stage);
    return result;
  },

  getStage: (projectId: number, stageType: ProductAnalysisStageType) => repository.getStage(projectId, stageType),

  runMarketOverview: (ctx: ProductDevelopmentContext, projectId: number) => runStage(ctx, projectId, "market_overview"),
  runAttributeCross: (ctx: ProductDevelopmentContext, projectId: number, options: ProductStageRunOptions) => (
    runStage(ctx, projectId, "attribute_cross", options)
  ),
  runPriceAnalysis: (ctx: ProductDevelopmentContext, projectId: number) => runStage(ctx, projectId, "price_analysis"),
  runBrandCompetition: (ctx: ProductDevelopmentContext, projectId: number) => runStage(ctx, projectId, "brand_competition"),
  runReviewKano: (ctx: ProductDevelopmentContext, projectId: number) => runStage(ctx, projectId, "review_kano"),
  runDecisionDashboard: (ctx: ProductDevelopmentContext, projectId: number) => runStage(ctx, projectId, "decision_dashboard"),

  async runInformationSummary(ctx: ProductDevelopmentContext, projectId: number) {
    await requireProject(ctx, projectId);
    await requireStageGate(projectId, "information_summary");
    const queued = await queueInformationSummaryGeneration({
      projectId,
      userId: ctx.user.id,
      workspaceId: ctx.workspaceId,
      ownerName: (ctx.user as { name?: string }).name || "",
    });
    await recordStageAudit(ctx, projectId, "information_summary", "run");
    return queued;
  },

  async cancelStage(ctx: ProductDevelopmentContext, projectId: number, stageType: ProductAnalysisStageType) {
    await requireProject(ctx, projectId);
    const result = await cancelProductAnalysisStage({
      projectId,
      stageType,
      userId: ctx.user.id,
      workspaceId: ctx.workspaceId,
    });
    await recordProductDevelopmentAudit({
      ctx,
      action: "product_development.stage.cancel",
      projectId,
      resourceType: "dev_analysis_stage",
      resourceId: `${projectId}:${stageType}`,
      resourceName: stageType,
      riskLevel: "medium",
      metadata: { stageType, canceled: result.canceled },
    });
    return result;
  },

  async confirmStage(
    ctx: ProductDevelopmentContext,
    projectId: number,
    stageType: ProductAnalysisStageType,
    editedResult?: string,
  ) {
    await requireProject(ctx, projectId);
    let normalized = editedResult;
    if (stageType === "information_summary") {
      const current = await repository.getStage(projectId, stageType);
      const raw = normalized ?? current?.editedResult ?? current?.rawResult;
      if (!raw) {
        throw new AppError({
          code: APP_ERROR_CODES.PRECONDITION_FAILED,
          statusCode: 412,
          message: "请先生成信息汇总",
          details: { projectId, stageType },
        });
      }
      try {
        normalized = JSON.stringify(validateInformationSummaryForConfirmation(JSON.parse(raw)));
      } catch (cause) {
        throw new AppError({
          code: APP_ERROR_CODES.VALIDATION_FAILED,
          statusCode: 400,
          message: "信息汇总内容格式不正确",
          details: { projectId, stageType },
          cause,
        });
      }
    }
    const result = await confirmDevAnalysisStageConsistently({ projectId, stageType, editedResult: normalized });
    await syncProductAnalysisConfirmation({
      projectId,
      stageType,
      userId: ctx.user.id,
      workspaceId: ctx.workspaceId,
      output: parseAnalysisOutput(result.stage?.editedResult || result.stage?.rawResult || normalized || null),
      invalidated: result.invalidated,
    });
    await recordStageAudit(ctx, projectId, stageType, "confirm");
    return { success: true, idempotent: result.idempotent, invalidated: result.invalidated };
  },

  async editStage(ctx: ProductDevelopmentContext, projectId: number, stageType: ProductAnalysisStageType, editedResult: string) {
    await requireProject(ctx, projectId);
    const result = await editDevAnalysisStageConsistently({ projectId, stageType, editedResult });
    await syncProductAnalysisDraft({
      projectId,
      stageType,
      userId: ctx.user.id,
      workspaceId: ctx.workspaceId,
      output: parseAnalysisOutput(result.stage?.editedResult || editedResult),
      invalidated: result.invalidated,
    });
    await recordStageAudit(ctx, projectId, stageType, "edit");
    return { success: true, idempotent: result.idempotent, invalidated: result.invalidated };
  },

  async unlockStage(ctx: ProductDevelopmentContext, projectId: number, stageType: ProductAnalysisStageType) {
    await requireProject(ctx, projectId);
    const result = await unlockDevAnalysisStageConsistently({ projectId, stageType });
    await syncProductAnalysisDraft({
      projectId,
      stageType,
      userId: ctx.user.id,
      workspaceId: ctx.workspaceId,
      output: parseAnalysisOutput(result.stage?.editedResult || result.stage?.rawResult || null),
      invalidated: result.invalidated,
    });
    await recordStageAudit(ctx, projectId, stageType, "unlock");
    return { success: true, idempotent: result.idempotent, invalidated: result.invalidated };
  },

  async generateReport(ctx: ProductDevelopmentContext, projectId: number, reportType: ProductReportType) {
    const project = await requireProject(ctx, projectId);
    const [products, reviewStats] = await Promise.all([
      repository.getProducts(projectId),
      repository.getReviewStats(projectId),
    ]);
    const response = await invokeBusinessSkill({
      messages: [
        {
          role: "system",
          content: "你是一个资深的亚马逊产品开发分析专家。请根据提供的数据生成专业的分析报告。返回JSON格式，包含summary和chartData。",
        },
        { role: "user", content: buildReportContext(reportType, products, reviewStats, project) },
      ],
      response_format: reportResponseFormat,
    });
    const content = response.choices?.[0]?.message?.content;
    const parsed = content ? JSON.parse(content as string) : { summary: "", chartData: [] };
    await repository.upsertReport({
      projectId,
      userId: ctx.user.id,
      reportType,
      title: getReportTitle(reportType),
      content: JSON.stringify(parsed),
    });
    return parsed;
  },

  getReports: (projectId: number) => repository.getReports(projectId),
  getReport: (projectId: number, reportType: string) => repository.getReport(projectId, reportType),

  async updateReport(ctx: ProductDevelopmentContext, projectId: number, reportType: string, content: string) {
    await repository.upsertReport({
      projectId,
      userId: ctx.user.id,
      reportType: reportType as ProductReportType,
      title: getReportTitle(reportType),
      content,
      status: "completed",
    });
    return { success: true };
  },

  reviewStats: (projectId: number) => repository.getReviewStats(projectId),

  async contentStats(projectId: number) {
    const reviews = await repository.getReviews(projectId);
    if (reviews.length === 0) return { positiveTopics: [], negativeTopics: [] };
    const positiveReviews = reviews.filter((review) => (review.rating ?? 0) >= 4).slice(0, 100);
    const negativeReviews = reviews.filter((review) => (review.rating ?? 0) <= 2).slice(0, 100);
    const response = await invokeBusinessSkill({
      messages: [
        {
          role: "system",
          content: "你是一个亚马逊产品评论分析专家。提取好评和差评的内容主题、出现次数和代表性摘要。",
        },
        {
          role: "user",
          content: `总评论数: ${reviews.length}\n好评样本:\n${positiveReviews.map((review) => `[${review.rating}★] ${(review.content || "").slice(0, 300)}`).join("\n")}\n\n差评样本:\n${negativeReviews.map((review) => `[${review.rating}★] ${(review.content || "").slice(0, 300)}`).join("\n")}`,
        },
      ],
      response_format: reviewTopicsResponseFormat,
    });
    const content = response.choices?.[0]?.message?.content;
    const parsed = content ? JSON.parse(content as string) : { positiveTopics: [], negativeTopics: [] };
    const totalPositive = positiveReviews.length || 1;
    const totalNegative = negativeReviews.length || 1;
    const totalAll = reviews.length || 1;
    for (const topic of parsed.positiveTopics) {
      topic.percentOfCategory = Math.round((topic.count / totalPositive) * 100);
      topic.percentOfTotal = Math.round((topic.count / totalAll) * 100);
    }
    for (const topic of parsed.negativeTopics) {
      topic.percentOfCategory = Math.round((topic.count / totalNegative) * 100);
      topic.percentOfTotal = Math.round((topic.count / totalAll) * 100);
    }
    return parsed;
  },

  async wordCloud(projectId: number) {
    const reviews = await repository.getReviews(projectId);
    if (reviews.length === 0) return { positiveWords: [], negativeWords: [] };
    const positive = reviews.filter((review) => (review.rating ?? 0) >= 4).slice(0, 100);
    const negative = reviews.filter((review) => (review.rating ?? 0) <= 2).slice(0, 100);
    const response = await invokeBusinessSkill({
      messages: [
        {
          role: "system",
          content: "从好评和差评中分别提取20-30个有意义的产品关键词，保留英文原文、中文翻译和频次权重，并按频次降序。",
        },
        {
          role: "user",
          content: `好评样本:\n${positive.map((review) => (review.content || "").slice(0, 200)).join("\n")}\n\n差评样本:\n${negative.map((review) => (review.content || "").slice(0, 200)).join("\n")}`,
        },
      ],
      response_format: wordCloudResponseFormat,
    });
    const content = response.choices?.[0]?.message?.content;
    return content ? JSON.parse(content as string) : { positiveWords: [], negativeWords: [] };
  },

  async fetchExternal(
    ctx: ProductDevelopmentContext,
    projectId: number,
    source: "youtube" | "tiktok" | "competitor_site",
    value: string,
  ) {
    const config = {
      youtube: {
        api: "Youtube/search",
        query: { gl: "US", hl: "en", q: value },
        dataType: "youtube_kol" as const,
        instruction: "分析该产品在YouTube上的KOL推广情况，包括热门视频、内容趋势、KOL影响力",
      },
      tiktok: {
        api: "Tiktok/search_tiktok_video_general",
        query: { keyword: value },
        dataType: "tiktok_kol" as const,
        instruction: "分析该产品在TikTok上的推广情况和内容趋势",
      },
      competitor_site: {
        api: "SimilarWeb/get_visits_total",
        query: { domain: value },
        dataType: "competitor_site" as const,
        instruction: "分析该竞品独立站的流量情况和推广策略",
      },
    }[source];
    const rawData = await callDataApi(config.api, { query: config.query });
    const aiSummary = await generateExternalSummary(rawData, config.instruction);
    await repository.createExternalData({
      projectId,
      userId: ctx.user.id,
      dataType: config.dataType,
      rawData: JSON.stringify(rawData),
      aiSummary,
    });
    return { rawData, aiSummary };
  },

  async fetchAIAnalysis(
    ctx: ProductDevelopmentContext,
    projectId: number,
    keyword: string,
    dataType: ExternalAnalysisType,
  ) {
    const promptMap: Record<ExternalAnalysisType, string> = {
      google_trends: "分析关键词在Google Trends上的搜索趋势，包括热度变化、季节性、地区分布",
      facebook_ads: "分析相关产品在Facebook上的广告推广情况，包括广告形式、受众画像、投放策略",
      crowdfunding: "分析相关产品在Kickstarter/Indiegogo等众筹平台上的趋势",
    };
    const response = await invokeBusinessSkill({
      messages: [
        { role: "system", content: "你是一个跨境电商市场分析专家。" },
        { role: "user", content: `关键词: ${keyword}\n\n${promptMap[dataType]}` },
      ],
    });
    const aiSummary = (response.choices?.[0]?.message?.content as string) || "";
    await repository.createExternalData({
      projectId,
      userId: ctx.user.id,
      dataType,
      rawData: JSON.stringify({ keyword }),
      aiSummary,
    });
    return { aiSummary };
  },

  getExternalData: (projectId: number) => repository.getExternalData(projectId),
  getConfirmedProjectTags: (projectId: number) => repository.getConfirmedProjectTags(projectId),

  async runTagCrossAnalysis(
    ctx: ProductDevelopmentContext,
    projectId: number,
    options: ProductStageRunOptions,
  ) {
    await requireProject(ctx, projectId);
    await requireStageGate(projectId, "attribute_cross");
    await recordStageAudit(ctx, projectId, "attribute_cross", "run");
    return queueProductAnalysisStage({
      projectId,
      stage: "tag_cross",
      userId: ctx.user.id,
      workspaceId: ctx.workspaceId,
      dim1CategoryId: options.dim1CategoryId,
      dim2CategoryId: options.dim2CategoryId,
    });
  },
};
