import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { callDataApi } from "../_core/dataApi";
import * as devDb from "../devDb";
import { getDb } from "../db";
import { devProjectTagCategories, devProjectTagItems, devPanoramaStatus } from "../../drizzle/schema";
import { eq, and, asc } from "drizzle-orm";
import {
  calcMarketOverview,
  calcPriceSegments,
  calcPriceSegmentsEnhanced,
  calcBrandCompetition,
  calcSingleDimensionStats,
  calcCrossAnalysis,
  calcReviewStats,
  type ProductData,
  type TagData,
  type ReviewData,
} from "../devStatsEngine";
import {
  MARKET_OVERVIEW_PROMPT,
  ATTRIBUTE_ANALYSIS_PROMPT,
  PRICE_ANALYSIS_PROMPT,
  BRAND_COMPETITION_PROMPT,
  REVIEW_KANO_PROMPT,
  DECISION_DASHBOARD_PROMPT,
} from "../devAnalysisPrompts";

const REPORT_TYPES = [
  "market_overview", "product_analysis", "price_analysis", "brand_analysis",
  "competitor_analysis", "review_analysis", "external_analysis", "ai_summary",
  "review_analysis_recent_2y",
] as const;

const STAGE_TYPES = [
  "attribute_tagging", "market_overview", "attribute_cross",
  "price_analysis", "brand_competition", "review_kano", "decision_dashboard",
] as const;

// ─── Stage Gating: Define prerequisites for each stage ─────────
type StageType = typeof STAGE_TYPES[number];

interface GatingResult {
  canRun: boolean;
  reason: string | null;
  missingPrereqs: string[];
}

async function isPanoramaConfirmed(projectId: number): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select().from(devPanoramaStatus).where(eq(devPanoramaStatus.projectId, projectId)).limit(1);
  return rows.length > 0 && rows[0].confirmed === 1;
}

async function areProductTagsConfirmed(projectId: number): Promise<boolean> {
  const tags = await devDb.getDevProductTags(projectId);
  if (tags.length === 0) return false;
  return tags.every(t => t.confirmed === 1);
}

async function checkStageGating(projectId: number, stageType: StageType): Promise<GatingResult> {
  const stages = await devDb.getDevAnalysisStages(projectId);
  const stageMap = new Map(stages.map(s => [s.stageType, s]));
  const dataStatus = await devDb.getDataConfirmationStatus(projectId);

  const isStageConfirmed = (st: string) => stageMap.get(st as any)?.status === "confirmed";
  const isStageCompleted = (st: string) => {
    const s = stageMap.get(st as any);
    return s?.status === "confirmed" || s?.status === "completed" || s?.status === "generated" || s?.status === "editing";
  };
  // Type-safe data status access
  const ds = dataStatus as Record<string, { confirmed: boolean; confirmedAt: Date | null; fileCount: number; totalRows: number }>;

  const missing: string[] = [];
  let reason: string | null = null;

  switch (stageType) {
    case "attribute_tagging":
      // Kept for backward compat - now handled by separate tab
      if (!ds.sales?.confirmed) {
        missing.push("销量数据未确认");
        reason = "请先在数据管理中上传并确认销量表格数据";
      }
      break;

    case "market_overview": {
      // Needs: product tags confirmed (from separate tab) + panorama confirmed
      const tagsOk1 = await areProductTagsConfirmed(projectId);
      if (!tagsOk1) {
        missing.push("属性标注未确认（请在“属性标注”tab中完成并确认）");
      }
      const panoramaOk1 = await isPanoramaConfirmed(projectId);
      if (!panoramaOk1) {
        missing.push("竞品全景分析表未确认");
      }
      if (missing.length > 0) {
        reason = `请先完成: ${missing.join("、")}`;
      }
      break;
    }

    case "attribute_cross": {
      // Needs: product tags confirmed (from separate tab) + panorama confirmed
      const tagsOk2 = await areProductTagsConfirmed(projectId);
      if (!tagsOk2) {
        missing.push("属性标注未确认（请在“属性标注”tab中完成并确认）");
      }
      const panoramaOk2 = await isPanoramaConfirmed(projectId);
      if (!panoramaOk2) {
        missing.push("竞品全景分析表未确认");
      }
      if (missing.length > 0) {
        reason = `请先完成: ${missing.join("、")}`;
      }
      break;
    }

    case "price_analysis": {
      // Needs: market_overview confirmed + panorama confirmed
      if (!isStageConfirmed("market_overview")) {
        missing.push("市场大盘未确认");
      }
      const panoramaOk3 = await isPanoramaConfirmed(projectId);
      if (!panoramaOk3) {
        missing.push("竞品全景分析表未确认");
      }
      if (missing.length > 0) {
        reason = `请先完成: ${missing.join("、")}`;
      }
      break;
    }

    case "brand_competition": {
      // Needs: market_overview confirmed + panorama confirmed
      if (!isStageConfirmed("market_overview")) {
        missing.push("市场大盘未确认");
      }
      const panoramaOk4 = await isPanoramaConfirmed(projectId);
      if (!panoramaOk4) {
        missing.push("竞品全景分析表未确认");
      }
      if (missing.length > 0) {
        reason = `请先完成: ${missing.join("、")}`;
      }
      break;
    }

    case "review_kano":
      // Needs: reviews data confirmed
      if (!ds.reviews?.confirmed) {
        missing.push("评论数据未确认");
        reason = "请先在数据管理中上传并确认评论文件数据";
      }
      break;

    case "decision_dashboard":
      // Needs: ALL previous 5 stages confirmed (except review_kano which is optional if no reviews)
      // Check product tags confirmed (from separate tab)
      const tagsOkD = await areProductTagsConfirmed(projectId);
      if (!tagsOkD) {
        missing.push("属性标注未确认");
      }
      const requiredStages: StageType[] = ["market_overview", "attribute_cross", "price_analysis", "brand_competition"];
      for (const rs of requiredStages) {
        if (!isStageConfirmed(rs)) {
          const labelMap: Record<string, string> = {
            market_overview: "市场大盘",
            attribute_cross: "属性交叉",
            price_analysis: "价格分析",
            brand_competition: "品牌竞争",
          };
          missing.push(`${labelMap[rs] || rs}未确认`);
        }
      }
      if (missing.length > 0) {
        reason = `请先完成并确认以下阶段: ${missing.join("、")}`;
      }
      break;
  }

  return {
    canRun: missing.length === 0,
    reason,
    missingPrereqs: missing,
  };
}


// Helper: resolve dev project access based on user role
async function resolveDevProjectAccess(projectId: number, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'designer') {
    const project = await devDb.getDevProjectByIdAdmin(projectId);
    if (!project) throw new Error("Project not found");
    return project;
  }
  const project = await devDb.getDevProjectById(projectId, user.id);
  if (!project) throw new Error("Project not found");
  return project;
}

export const devAnalysisRouter = router({
  // ═══════════════════════════════════════════════════════════════
  // Stage-based Analysis Flow with Gating
  // ═══════════════════════════════════════════════════════════════

  // ─── Get all stages for a project ─────────────────────────
  getStages: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const stages = await devDb.getDevAnalysisStages(input.projectId);
      return stages;
    }),

  // ─── Get gating status for all stages ────────────────────
  getStageGating: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const result: Record<string, GatingResult> = {};
      for (const st of STAGE_TYPES) {
        result[st] = await checkStageGating(input.projectId, st);
      }
      return result;
    }),

  getStage: protectedProcedure
    .input(z.object({ projectId: z.number(), stageType: z.enum(STAGE_TYPES) }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevAnalysisStage(input.projectId, input.stageType);
    }),

  // ─── Stage 1: Market Overview ─────────────────────────────────
  // NOTE: Attribute tagging (Stage 0) has been moved to devTagging router.
  // Use devTagging.startTagging / confirmAll / unlockAll instead.
  runMarketOverview: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      // Gate check
      const gating = await checkStageGating(input.projectId, "market_overview");
      if (!gating.canRun) throw new Error(`门控检查未通过: ${gating.reason}`);

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "market_overview",
        status: "running",
        rawResult: null,
        editedResult: null,
        confirmedAt: null,
      });

      const products = await devDb.getDevProductsByProject(input.projectId);
      const productData: ProductData[] = products.map(mapToProductData);

      // Step 1: Pure statistics
      const stats = calcMarketOverview(productData);

      // Step 2: AI interpretation
      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: MARKET_OVERVIEW_PROMPT },
          {
            role: "user",
            content: `品类: ${project.name}\n关键词: ${project.keywords}\n\n统计数据:\n${JSON.stringify(stats, null, 2)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "market_overview_ai",
            strict: true,
            schema: {
              type: "object",
              properties: {
                maturityLevel: { type: "string" },
                maturityReason: { type: "string" },
                growthTrend: { type: "string" },
                growthRate: { type: "string" },
                seasonality: {
                  type: "object",
                  properties: {
                    hasSeasonality: { type: "boolean" },
                    peakMonths: { type: "array", items: { type: "string" } },
                    lowMonths: { type: "array", items: { type: "string" } },
                    description: { type: "string" },
                  },
                  required: ["hasSeasonality", "peakMonths", "lowMonths", "description"],
                  additionalProperties: false,
                },
                marketCapacity: {
                  type: "object",
                  properties: {
                    level: { type: "string" },
                    monthlyRevenue: { type: "string" },
                    potential: { type: "string" },
                  },
                  required: ["level", "monthlyRevenue", "potential"],
                  additionalProperties: false,
                },
                entryTiming: {
                  type: "object",
                  properties: {
                    recommendation: { type: "string" },
                    bestEntryTime: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["recommendation", "bestEntryTime", "reason"],
                  additionalProperties: false,
                },
                summary: { type: "string" },
                risks: { type: "array", items: { type: "string" } },
                opportunities: { type: "array", items: { type: "string" } },
              },
              required: ["maturityLevel", "maturityReason", "growthTrend", "growthRate", "seasonality", "marketCapacity", "entryTiming", "summary", "risks", "opportunities"],
              additionalProperties: false,
            },
          },
        },
      });

      const aiContent = response.choices?.[0]?.message?.content;
      const aiResult = aiContent ? JSON.parse(aiContent as string) : {};

      const result = { stats, ai: aiResult };

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "market_overview",
        status: "completed",
        rawResult: JSON.stringify(result),
        editedResult: null,
        confirmedAt: null,
      });

      return result;
    }),

  // ─── Stage 2: Attribute Cross Analysis ────────────────────────
  runAttributeCross: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      dim1Name: z.string().optional(),
      dim2Name: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      // Gate check
      const gating = await checkStageGating(input.projectId, "attribute_cross");
      if (!gating.canRun) throw new Error(`门控检查未通过: ${gating.reason}`);

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "attribute_cross",
        status: "running",
        rawResult: null,
        editedResult: null,
        confirmedAt: null,
      });

      const products = await devDb.getDevProductsByProject(input.projectId);
      const tags = await devDb.getDevProductTags(input.projectId);
      const productData: ProductData[] = products.map(mapToProductData);
      const tagData: TagData[] = tags.map(t => ({
        asin: t.asin ?? "",
        dimensionName: t.dimensionName ?? "",
        dimensionValue: t.dimensionValue ?? "",
      }));

      // Get all dimension names
      const dimensionNames = Array.from(new Set(tagData.map(t => t.dimensionName)));

      // Single dimension stats for all dimensions
      const singleDimStats = dimensionNames.map(dim =>
        calcSingleDimensionStats(productData, tagData, dim)
      );

      // Cross analysis for selected dimensions (or top 2 by default)
      const dim1 = input.dim1Name || dimensionNames[0] || "";
      const dim2 = input.dim2Name || dimensionNames[1] || dimensionNames[0] || "";
      const crossResult = dim1 && dim2 ? calcCrossAnalysis(productData, tagData, dim1, dim2) : null;

      // AI interpretation
      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: ATTRIBUTE_ANALYSIS_PROMPT },
          {
            role: "user",
            content: `品类: ${project.name}\n\n各维度统计:\n${JSON.stringify(singleDimStats, null, 2)}\n\n交叉分析(${dim1} × ${dim2}):\n${JSON.stringify(crossResult, null, 2)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "attribute_analysis_ai",
            strict: true,
            schema: {
              type: "object",
              properties: {
                mainstreamProducts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      combo: { type: "string" },
                      salesShare: { type: "string" },
                      reason: { type: "string" },
                    },
                    required: ["combo", "salesShare", "reason"],
                    additionalProperties: false,
                  },
                },
                differentiationOpportunities: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      combo: { type: "string" },
                      competitionLevel: { type: "string" },
                      potential: { type: "string" },
                      reason: { type: "string" },
                    },
                    required: ["combo", "competitionLevel", "potential", "reason"],
                    additionalProperties: false,
                  },
                },
                recommendedDirections: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      direction: { type: "string" },
                      attributes: {
                        type: "object",
                        additionalProperties: { type: "string" },
                      },
                      estimatedPriceRange: { type: "string" },
                      targetAudience: { type: "string" },
                      reason: { type: "string" },
                      priority: { type: "number" },
                    },
                    required: ["direction", "attributes", "estimatedPriceRange", "targetAudience", "reason", "priority"],
                    additionalProperties: false,
                  },
                },
                redOceanWarnings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      combo: { type: "string" },
                      reason: { type: "string" },
                    },
                    required: ["combo", "reason"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
              },
              required: ["mainstreamProducts", "differentiationOpportunities", "recommendedDirections", "redOceanWarnings", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const aiContent = response.choices?.[0]?.message?.content;
      const aiResult = aiContent ? JSON.parse(aiContent as string) : {};

      const result = { singleDimStats, crossResult, dimensionNames, ai: aiResult };

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "attribute_cross",
        status: "completed",
        rawResult: JSON.stringify(result),
        editedResult: null,
        confirmedAt: null,
      });

      return result;
    }),

  // ─── Stage 3: Price Analysis ──────────────────────────────────
  runPriceAnalysis: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      // Gate check
      const gating = await checkStageGating(input.projectId, "price_analysis");
      if (!gating.canRun) throw new Error(`门控检查未通过: ${gating.reason}`);

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "price_analysis",
        status: "running",
        rawResult: null,
        editedResult: null,
        confirmedAt: null,
      });

      const products = await devDb.getDevProductsByProject(input.projectId);
      const tags = await devDb.getDevProductTags(input.projectId);
      const productData: ProductData[] = products.map(mapToProductData);
      const tagData: TagData[] = tags.map(t => ({
        asin: t.asin ?? "",
        dimensionName: t.dimensionName ?? "",
        dimensionValue: t.dimensionValue ?? "",
      }));
      const priceSegments = calcPriceSegmentsEnhanced(productData, tagData);

      // Build tag distribution summary for AI
      const tagDistSummary = priceSegments.map(seg => ({
        range: seg.range,
        competitorCount: seg.competitorCount,
        recentNewCount: seg.recentNewCount,
        recentNewPct: seg.recentNewPct,
        avgMonthlySales: seg.avgMonthlySales,
        tagDistribution: seg.tagDistribution,
      }));

      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: PRICE_ANALYSIS_PROMPT },
          {
            role: "user",
            content: `品类: ${project.name}\n\n价格段统计:\n${JSON.stringify(priceSegments.map(({ asins, ...rest }) => rest), null, 2)}\n\n各价格段标签分布与竞争数据:\n${JSON.stringify(tagDistSummary, null, 2)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "price_analysis_ai",
            strict: true,
            schema: {
              type: "object",
              properties: {
                bestPriceRange: {
                  type: "object",
                  properties: {
                    min: { type: "number" },
                    max: { type: "number" },
                    reason: { type: "string" },
                  },
                  required: ["min", "max", "reason"],
                  additionalProperties: false,
                },
                priceRatingCorrelation: { type: "string" },
                pricingStrategy: {
                  type: "object",
                  properties: {
                    type: { type: "string" },
                    suggestedPrice: {
                      type: "object",
                      properties: {
                        min: { type: "number" },
                        max: { type: "number" },
                      },
                      required: ["min", "max"],
                      additionalProperties: false,
                    },
                    reason: { type: "string" },
                  },
                  required: ["type", "suggestedPrice", "reason"],
                  additionalProperties: false,
                },
                priceInsights: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      insight: { type: "string" },
                      implication: { type: "string" },
                    },
                    required: ["insight", "implication"],
                    additionalProperties: false,
                  },
                },
                tagRecommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      priceRange: { type: "string" },
                      recommendedTags: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            dimension: { type: "string" },
                            value: { type: "string" },
                            reason: { type: "string" },
                          },
                          required: ["dimension", "value", "reason"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["priceRange", "recommendedTags"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
              },
              required: ["bestPriceRange", "priceRatingCorrelation", "pricingStrategy", "priceInsights", "tagRecommendations", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const aiContent = response.choices?.[0]?.message?.content;
      const aiResult = aiContent ? JSON.parse(aiContent as string) : {};

      const result = { priceSegments, ai: aiResult };

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "price_analysis",
        status: "completed",
        rawResult: JSON.stringify(result),
        editedResult: null,
        confirmedAt: null,
      });

      return result;
    }),

  // ─── Stage 4: Brand Competition ───────────────────────────────
  runBrandCompetition: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      // Gate check
      const gating = await checkStageGating(input.projectId, "brand_competition");
      if (!gating.canRun) throw new Error(`门控检查未通过: ${gating.reason}`);

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "brand_competition",
        status: "running",
        rawResult: null,
        editedResult: null,
        confirmedAt: null,
      });

      const products = await devDb.getDevProductsByProject(input.projectId);
      const productData: ProductData[] = products.map(mapToProductData);
      const brandStats = calcBrandCompetition(productData);

      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: BRAND_COMPETITION_PROMPT },
          {
            role: "user",
            content: `品类: ${project.name}\n\n品牌竞争统计:\n${JSON.stringify(brandStats, null, 2)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "brand_competition_ai",
            strict: true,
            schema: {
              type: "object",
              properties: {
                competitionPattern: { type: "string" },
                competitionPatternReason: { type: "string" },
                topBrandStrategies: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      brand: { type: "string" },
                      strategy: { type: "string" },
                      strengths: { type: "array", items: { type: "string" } },
                      weaknesses: { type: "array", items: { type: "string" } },
                    },
                    required: ["brand", "strategy", "strengths", "weaknesses"],
                    additionalProperties: false,
                  },
                },
                entryStrategy: {
                  type: "object",
                  properties: {
                    approach: { type: "string" },
                    targetSegment: { type: "string" },
                    differentiationPoint: { type: "string" },
                    estimatedInvestment: { type: "string" },
                    reason: { type: "string" },
                  },
                  required: ["approach", "targetSegment", "differentiationPoint", "estimatedInvestment", "reason"],
                  additionalProperties: false,
                },
                chinaSellerAnalysis: {
                  type: "object",
                  properties: {
                    share: { type: "string" },
                    trend: { type: "string" },
                    implication: { type: "string" },
                  },
                  required: ["share", "trend", "implication"],
                  additionalProperties: false,
                },
                summary: { type: "string" },
              },
              required: ["competitionPattern", "competitionPatternReason", "topBrandStrategies", "entryStrategy", "chinaSellerAnalysis", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const aiContent = response.choices?.[0]?.message?.content;
      const aiResult = aiContent ? JSON.parse(aiContent as string) : {};

      const result = { brandStats, ai: aiResult };

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "brand_competition",
        status: "completed",
        rawResult: JSON.stringify(result),
        editedResult: null,
        confirmedAt: null,
      });

      return result;
    }),

  // ─── Stage 5: Review KANO Analysis ────────────────────────────
  runReviewKano: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      // Gate check
      const gating = await checkStageGating(input.projectId, "review_kano");
      if (!gating.canRun) throw new Error(`门控检查未通过: ${gating.reason}`);

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "review_kano",
        status: "running",
        rawResult: null,
        editedResult: null,
        confirmedAt: null,
      });

      const reviews = await devDb.getDevReviewsByProject(input.projectId);
      const reviewData: ReviewData[] = reviews.map(r => ({
        asin: r.asin ?? "",
        rating: r.rating,
        content: r.content,
        title: r.title,
        reviewDate: r.reviewDate,
        isVP: r.isVP,
        isVine: r.isVine,
        variant: r.variant,
        helpfulCount: r.helpfulCount,
        hasImage: r.hasImage,
        hasVideo: r.hasVideo,
      }));

      // Step 1: Pure statistics
      const stats = calcReviewStats(reviewData);

      // Step 2: AI KANO analysis (sample reviews)
      const positiveReviews = reviews.filter(r => (r.rating ?? 0) >= 4).slice(0, 80);
      const negativeReviews = reviews.filter(r => (r.rating ?? 0) <= 2).slice(0, 80);
      const neutralReviews = reviews.filter(r => (r.rating ?? 0) === 3).slice(0, 30);

      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: REVIEW_KANO_PROMPT },
          {
            role: "user",
            content: `品类: ${project.name}\n\n评论统计:\n${JSON.stringify(stats, null, 2)}\n\n好评样本(${positiveReviews.length}条):\n${positiveReviews.map(r => `[${r.rating}★] ${(r.content || "").substring(0, 300)}`).join("\n")}\n\n差评样本(${negativeReviews.length}条):\n${negativeReviews.map(r => `[${r.rating}★] ${(r.content || "").substring(0, 300)}`).join("\n")}\n\n中评样本(${neutralReviews.length}条):\n${neutralReviews.map(r => `[${r.rating}★] ${(r.content || "").substring(0, 300)}`).join("\n")}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "review_kano_ai",
            strict: true,
            schema: {
              type: "object",
              properties: {
                kanoAnalysis: {
                  type: "object",
                  properties: {
                    painPoints: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          theme: { type: "string" },
                          frequency: { type: "string" },
                          severity: { type: "number" },
                          priority: { type: "number" },
                          description: { type: "string" },
                          representativeReviews: { type: "array", items: { type: "string" } },
                          improvementSuggestion: { type: "string" },
                        },
                        required: ["theme", "frequency", "severity", "priority", "description", "representativeReviews", "improvementSuggestion"],
                        additionalProperties: false,
                      },
                    },
                    itchPoints: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          theme: { type: "string" },
                          frequency: { type: "string" },
                          desireLevel: { type: "number" },
                          priority: { type: "number" },
                          description: { type: "string" },
                          representativeReviews: { type: "array", items: { type: "string" } },
                          improvementSuggestion: { type: "string" },
                        },
                        required: ["theme", "frequency", "desireLevel", "priority", "description", "representativeReviews", "improvementSuggestion"],
                        additionalProperties: false,
                      },
                    },
                    wowPoints: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          theme: { type: "string" },
                          frequency: { type: "string" },
                          impactLevel: { type: "number" },
                          description: { type: "string" },
                          representativeReviews: { type: "array", items: { type: "string" } },
                          implementationSuggestion: { type: "string" },
                        },
                        required: ["theme", "frequency", "impactLevel", "description", "representativeReviews", "implementationSuggestion"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["painPoints", "itchPoints", "wowPoints"],
                  additionalProperties: false,
                },
                overallSentiment: {
                  type: "object",
                  properties: {
                    positive: { type: "string" },
                    negative: { type: "string" },
                    neutral: { type: "string" },
                  },
                  required: ["positive", "negative", "neutral"],
                  additionalProperties: false,
                },
                productImprovementPriority: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      area: { type: "string" },
                      priority: { type: "number" },
                      expectedImpact: { type: "string" },
                      difficulty: { type: "string" },
                    },
                    required: ["area", "priority", "expectedImpact", "difficulty"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
              },
              required: ["kanoAnalysis", "overallSentiment", "productImprovementPriority", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const aiContent = response.choices?.[0]?.message?.content;
      const aiResult = aiContent ? JSON.parse(aiContent as string) : {};

      const result = { stats, ai: aiResult };

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "review_kano",
        status: "completed",
        rawResult: JSON.stringify(result),
        editedResult: null,
        confirmedAt: null,
      });

      return result;
    }),

  // ─── Stage 6: Decision Dashboard ──────────────────────────────
  runDecisionDashboard: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      // Gate check
      const gating = await checkStageGating(input.projectId, "decision_dashboard");
      if (!gating.canRun) throw new Error(`门控检查未通过: ${gating.reason}`);

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "decision_dashboard",
        status: "running",
        rawResult: null,
        editedResult: null,
        confirmedAt: null,
      });

      // Collect confirmed results from all previous stages with status info
      const stages = await devDb.getDevAnalysisStages(input.projectId);
      const confirmedData: Record<string, unknown> = {};
      const stageStatus: Record<string, string> = {};
      for (const stage of stages) {
        if (stage.stageType === "decision_dashboard") continue;
        stageStatus[stage.stageType ?? "unknown"] = stage.status ?? "pending";
        const data = stage.editedResult || stage.rawResult;
        if (data) {
          try {
            confirmedData[stage.stageType ?? "unknown"] = JSON.parse(data);
          } catch { /* skip */ }
        }
      }
      const confirmedStages = Object.entries(stageStatus).filter(([, s]) => s === "confirmed").map(([k]) => k);
      const unconfirmedStages = Object.entries(stageStatus).filter(([, s]) => s !== "confirmed" && s !== "pending").map(([k]) => k);

      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: DECISION_DASHBOARD_PROMPT },
          {
            role: "user",
            content: `品类: ${project.name}\n关键词: ${project.keywords}\n目标市场: ${project.targetMarket}\n\n已确认阶段: ${confirmedStages.join(", ") || "无"}\n未确认阶段: ${unconfirmedStages.join(", ") || "无"}\n\n各阶段分析数据:\n${JSON.stringify(confirmedData, null, 2)}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "decision_dashboard_ai",
            strict: true,
            schema: {
              type: "object",
              properties: {
                feasibilityScore: {
                  type: "object",
                  properties: {
                    overall: { type: "number" },
                    dimensions: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          name: { type: "string" },
                          score: { type: "number" },
                          reason: { type: "string" },
                        },
                        required: ["name", "score", "reason"],
                        additionalProperties: false,
                      },
                    },
                    recommendation: { type: "string" },
                  },
                  required: ["overall", "dimensions", "recommendation"],
                  additionalProperties: false,
                },
                productPositioning: {
                  type: "object",
                  properties: {
                    targetAttributes: {
                      type: "object",
                      additionalProperties: { type: "string" },
                    },
                    priceRange: {
                      type: "object",
                      properties: {
                        min: { type: "number" },
                        max: { type: "number" },
                      },
                      required: ["min", "max"],
                      additionalProperties: false,
                    },
                    differentiationDirection: { type: "string" },
                    targetAudience: { type: "string" },
                    uniqueSellingPoints: { type: "array", items: { type: "string" } },
                  },
                  required: ["targetAttributes", "priceRange", "differentiationDirection", "targetAudience", "uniqueSellingPoints"],
                  additionalProperties: false,
                },
                swotAnalysis: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      competitor: { type: "string" },
                      strengths: { type: "array", items: { type: "string" } },
                      weaknesses: { type: "array", items: { type: "string" } },
                      opportunities: { type: "array", items: { type: "string" } },
                      threats: { type: "array", items: { type: "string" } },
                    },
                    required: ["competitor", "strengths", "weaknesses", "opportunities", "threats"],
                    additionalProperties: false,
                  },
                },
                launchPlan: {
                  type: "object",
                  properties: {
                    specifications: { type: "string" },
                    targetPrice: { type: "number" },
                    bestLaunchMonth: { type: "string" },
                    initialOrderQuantity: { type: "number" },
                    targetMonthlySales: { type: "number" },
                    estimatedBreakEvenMonths: { type: "number" },
                    keyMilestones: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          month: { type: "number" },
                          milestone: { type: "string" },
                        },
                        required: ["month", "milestone"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["specifications", "targetPrice", "bestLaunchMonth", "initialOrderQuantity", "targetMonthlySales", "estimatedBreakEvenMonths", "keyMilestones"],
                  additionalProperties: false,
                },
                risks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      risk: { type: "string" },
                      probability: { type: "string" },
                      impact: { type: "string" },
                      mitigation: { type: "string" },
                    },
                    required: ["risk", "probability", "impact", "mitigation"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
              },
              required: ["feasibilityScore", "productPositioning", "swotAnalysis", "launchPlan", "risks", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const aiContent = response.choices?.[0]?.message?.content;
      const aiResult = aiContent ? JSON.parse(aiContent as string) : {};

      const result = { ai: aiResult };

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "decision_dashboard",
        status: "completed",
        rawResult: JSON.stringify(result),
        editedResult: null,
        confirmedAt: null,
      });

      return result;
    }),

  // ─── Confirm / Edit Stage ─────────────────────────────────────
  confirmStage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      stageType: z.enum(STAGE_TYPES),
      editedResult: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.confirmDevAnalysisStage(
        input.projectId,
        input.stageType,
        input.editedResult || ""
      );
      return { success: true };
    }),

  editStage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      stageType: z.enum(STAGE_TYPES),
      editedResult: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: input.stageType as any,
        status: "editing",
        rawResult: null, // keep existing rawResult via upsert
        editedResult: input.editedResult,
        confirmedAt: null,
      });
      return { success: true };
    }),

  // Unlock a confirmed stage so it can be re-analyzed or re-edited
  unlockStage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      stageType: z.enum(STAGE_TYPES),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.unlockDevAnalysisStage(input.projectId, input.stageType);
      return { success: true };
    }),

  // ═══════════════════════════════════════════════════════════════
  // LEGACY: Existing Analysis Reports (kept for backward compat)
  // ═══════════════════════════════════════════════════════════════

  generateReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      reportType: z.enum(REPORT_TYPES),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const reviewStats = await devDb.getDevReviewStats(input.projectId);

      const contextData = buildReportContext(input.reportType, products, reviewStats, project);

      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个资深的亚马逊产品开发分析专家。请根据提供的数据生成专业的分析报告。
返回JSON格式，包含summary(文字总结,markdown格式)和chartData(图表数据,数组格式)两个字段。`,
          },
          { role: "user", content: contextData },
        ],
        response_format: {
          type: "json_schema",
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
                          properties: {
                            name: { type: "string" },
                            value: { type: "number" },
                          },
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
        },
      });

      const content = response.choices?.[0]?.message?.content;
      const parsed = content ? JSON.parse(content as string) : { summary: "", chartData: [] };

      await devDb.upsertDevReport({
        projectId: input.projectId,
        userId: ctx.user.id,
        reportType: input.reportType,
        title: getReportTitle(input.reportType),
        content: JSON.stringify(parsed),
      });

      return parsed;
    }),

  getReports: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevReports(input.projectId);
    }),

  getReport: protectedProcedure
    .input(z.object({ projectId: z.number(), reportType: z.string() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevReport(input.projectId, input.reportType);
    }),

  updateReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      reportType: z.string(),
      content: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.upsertDevReport({
        projectId: input.projectId,
        userId: ctx.user.id,
        reportType: input.reportType as any,
        title: getReportTitle(input.reportType),
        content: input.content,
        status: "completed",
      });
      return { success: true };
    }),

  // ─── Review Analysis (Legacy) ─────────────────────────────────
  reviewStats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevReviewStats(input.projectId);
    }),

  contentStats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const reviews = await devDb.getDevReviewsByProject(input.projectId);
      if (reviews.length === 0) return { positiveTopics: [], negativeTopics: [] };

      const positiveReviews = reviews.filter(r => (r.rating ?? 0) >= 4).slice(0, 100);
      const negativeReviews = reviews.filter(r => (r.rating ?? 0) <= 2).slice(0, 100);

      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个亚马逊产品评论分析专家。请分析以下评论数据，提取好评和差评中的具体内容主题。
对于每个主题，需要：
1. 主题名称（简短描述，如"易于安装"、"材质差"等）
2. 出现次数（根据评论内容估算）
3. 代表性评论摘要`,
          },
          {
            role: "user",
            content: `总评论数: ${reviews.length}, 好评: ${positiveReviews.length}, 差评: ${negativeReviews.length}

好评样本:\n${positiveReviews.map(r => `[${r.rating}★] ${(r.content || "").substring(0, 300)}`).join("\n")}

差评样本:\n${negativeReviews.map(r => `[${r.rating}★] ${(r.content || "").substring(0, 300)}`).join("\n")}`,
          },
        ],
        response_format: {
          type: "json_schema",
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
        },
      });

      const content = response.choices?.[0]?.message?.content;
      const parsed = content ? JSON.parse(content as string) : { positiveTopics: [], negativeTopics: [] };

      const totalPositive = positiveReviews.length || 1;
      const totalNegative = negativeReviews.length || 1;
      const totalAll = reviews.length || 1;

      for (const t of parsed.positiveTopics) {
        t.percentOfCategory = Math.round((t.count / totalPositive) * 100);
        t.percentOfTotal = Math.round((t.count / totalAll) * 100);
      }
      for (const t of parsed.negativeTopics) {
        t.percentOfCategory = Math.round((t.count / totalNegative) * 100);
        t.percentOfTotal = Math.round((t.count / totalAll) * 100);
      }

      return parsed;
    }),

  wordCloud: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const reviews = await devDb.getDevReviewsByProject(input.projectId);
      if (reviews.length === 0) return { positiveWords: [], negativeWords: [] };

      const positiveReviews = reviews.filter(r => (r.rating ?? 0) >= 4).slice(0, 100);
      const negativeReviews = reviews.filter(r => (r.rating ?? 0) <= 2).slice(0, 100);

      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个亚马逊产品评论分析专家。请从好评和差评中分别提取高频关键词/短语。
要求：
1. 每类提取20-30个关键词
2. 关键词应该是有意义的产品相关词汇（不要提取"the"、"is"等无意义词）
3. 为每个关键词估算出现频次（权重）
4. 关键词用英文原文（因为是英文评论），但可以附带中文翻译
5. 按频次从高到低排序`,
          },
          {
            role: "user",
            content: `好评样本(${positiveReviews.length}条):\n${positiveReviews.map(r => (r.content || "").substring(0, 200)).join("\n")}\n\n差评样本(${negativeReviews.length}条):\n${negativeReviews.map(r => (r.content || "").substring(0, 200)).join("\n")}`,
          },
        ],
        response_format: {
          type: "json_schema",
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
        },
      });

      const content = response.choices?.[0]?.message?.content;
      return content ? JSON.parse(content as string) : { positiveWords: [], negativeWords: [] };
    }),

  // ─── External Data (Legacy) ───────────────────────────────────
  fetchYouTube: protectedProcedure
    .input(z.object({ projectId: z.number(), keyword: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rawData = await callDataApi("Youtube/search", {
        query: { gl: "US", hl: "en", q: input.keyword },
      });

      const aiSummary = await generateExternalSummary(
        rawData,
        "分析该产品在YouTube上的KOL推广情况，包括热门视频、内容趋势、KOL影响力"
      );

      await devDb.createDevExternalData({
        projectId: input.projectId,
        userId: ctx.user.id,
        dataType: "youtube_kol",
        rawData: JSON.stringify(rawData),
        aiSummary,
      });

      return { rawData, aiSummary };
    }),

  fetchTikTok: protectedProcedure
    .input(z.object({ projectId: z.number(), keyword: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rawData = await callDataApi("Tiktok/search_tiktok_video_general", {
        query: { keyword: input.keyword },
      });

      const aiSummary = await generateExternalSummary(
        rawData,
        "分析该产品在TikTok上的推广情况和内容趋势"
      );

      await devDb.createDevExternalData({
        projectId: input.projectId,
        userId: ctx.user.id,
        dataType: "tiktok_kol",
        rawData: JSON.stringify(rawData),
        aiSummary,
      });

      return { rawData, aiSummary };
    }),

  fetchCompetitorSite: protectedProcedure
    .input(z.object({ projectId: z.number(), domain: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rawData = await callDataApi("SimilarWeb/get_visits_total", {
        query: { domain: input.domain },
      });

      const aiSummary = await generateExternalSummary(
        rawData,
        "分析该竞品独立站的流量情况和推广策略"
      );

      await devDb.createDevExternalData({
        projectId: input.projectId,
        userId: ctx.user.id,
        dataType: "competitor_site",
        rawData: JSON.stringify(rawData),
        aiSummary,
      });

      return { rawData, aiSummary };
    }),

  fetchAIAnalysis: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keyword: z.string(),
      dataType: z.enum(["google_trends", "facebook_ads", "crowdfunding"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const promptMap: Record<string, string> = {
        google_trends: "分析关键词在Google Trends上的搜索趋势，包括热度变化、季节性、地区分布",
        facebook_ads: "分析相关产品在Facebook上的广告推广情况，包括广告形式、受众画像、投放策略",
        crowdfunding: "分析相关产品在Kickstarter/Indiegogo等众筹平台上的趋势",
      };

      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是一个跨境电商市场分析专家。" },
          { role: "user", content: `关键词: ${input.keyword}\n\n${promptMap[input.dataType]}` },
        ],
      });

      const aiSummary = (response.choices?.[0]?.message?.content as string) || "";

      await devDb.createDevExternalData({
        projectId: input.projectId,
        userId: ctx.user.id,
        dataType: input.dataType,
        rawData: JSON.stringify({ keyword: input.keyword }),
        aiSummary,
      });

      return { aiSummary };
    }),

  getExternalData: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevExternalData(input.projectId);
    }),

  // ═══════════════════════════════════════════════════════════════
  // Project-level Tag Cross Analysis Integration
  // ═══════════════════════════════════════════════════════════════

  // Get confirmed project-level tags grouped by category for analysis
  getConfirmedProjectTags: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const categories = await db.select().from(devProjectTagCategories)
        .where(and(
          eq(devProjectTagCategories.projectId, input.projectId),
          eq(devProjectTagCategories.confirmed, 1)
        ))
        .orderBy(asc(devProjectTagCategories.sortOrder));

      const items = await db.select().from(devProjectTagItems)
        .where(eq(devProjectTagItems.projectId, input.projectId))
        .orderBy(asc(devProjectTagItems.sortOrder));

      // Group items by category
      const result = categories.map((cat: any) => ({
        categoryId: cat.id,
        categoryKey: cat.categoryKey,
        categoryName: cat.categoryName,
        confirmed: cat.confirmed === 1,
        tags: items
          .filter((item: any) => item.categoryId === cat.id)
          .map((item: any) => ({
            id: item.id,
            tagName: item.tagName,
            tagValue: item.tagValue || "",
            source: item.source,
          })),
      }));

      // Also get tag status
      const allCategories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId));
      const total = allCategories.length;
      const confirmedCount = allCategories.filter((c: any) => c.confirmed === 1).length;

      return {
        categories: result,
        status: {
          total,
          confirmed: confirmedCount,
          allConfirmed: total > 0 && confirmedCount === total,
          initialized: total > 0,
        },
      };
    }),

  // Run cross analysis using project-level confirmed tags as dimensions
  runTagCrossAnalysis: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      dim1CategoryId: z.number().optional(),
      dim2CategoryId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveDevProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");

      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Check that tags are confirmed
      const allCats = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId));
      const confirmedCats = allCats.filter((c: any) => c.confirmed === 1);
      if (confirmedCats.length < 2) {
        throw new Error("至少需要2个已确认的标签分类才能进行交叉分析。请先在标签管理中确认标签。");
      }

      // Mark stage as running
      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "attribute_cross",
        status: "running",
        rawResult: null,
        editedResult: null,
        confirmedAt: null,
      });

      // Get products
      const products = await devDb.getDevProductsByProject(input.projectId);
      if (products.length === 0) throw new Error("No products found. Please upload data first.");
      const productData: ProductData[] = products.map(mapToProductData);

      // Get all tag items for confirmed categories
      const allItems = await db.select().from(devProjectTagItems)
        .where(eq(devProjectTagItems.projectId, input.projectId));

      // Build category name map
      const catNameMap = new Map(confirmedCats.map((c: any) => [c.id, c.categoryName]));

      // Get product-level tags (from devProductTags table, populated by AI tagging)
      const oldTags = await devDb.getDevProductTags(input.projectId);
      const oldTagData: TagData[] = oldTags.map((t: any) => ({
        asin: t.asin ?? "",
        dimensionName: t.dimensionName ?? "",
        dimensionValue: t.dimensionValue ?? "",
      }));

      console.log(`[CrossAnalysis] Project ${input.projectId}: ${products.length} products, ${oldTags.length} product tags, ${confirmedCats.length} confirmed categories, ${allItems.length} tag items`);

      // Build project-level tag summary for AI context
      const projectTagSummary = confirmedCats.map((cat: any) => {
        const catItems = allItems.filter((item: any) => item.categoryId === cat.id);
        return {
          category: cat.categoryName,
          categoryKey: cat.categoryKey,
          tags: catItems.map((item: any) => ({
            name: item.tagName,
            value: item.tagValue || "",
          })),
        };
      });

      // Get dimension names from product-level tags
      const dimensionNames = Array.from(new Set(oldTagData.map(t => t.dimensionName)));
      const categoryNames = Array.from(catNameMap.values());
      console.log(`[CrossAnalysis] dimensionNames from product tags: [${dimensionNames.join(", ")}]`);
      console.log(`[CrossAnalysis] categoryNames from confirmed cats: [${categoryNames.join(", ")}]`);

      // Single dimension stats using product-level tags
      const singleDimStats = dimensionNames.map(dim =>
        calcSingleDimensionStats(productData, oldTagData, dim)
      );

      // Determine cross dimensions: prefer user-selected, then auto-select
      let dim1Name = "";
      let dim2Name = "";

      if (input.dim1CategoryId) {
        dim1Name = catNameMap.get(input.dim1CategoryId) || "";
      }
      if (input.dim2CategoryId) {
        dim2Name = catNameMap.get(input.dim2CategoryId) || "";
      }

      // If not specified, auto-select the first 2 dimensions that exist in product tags
      if (!dim1Name || !dim2Name) {
        // Match confirmed category names to dimension names in product tags
        const matchingDims = dimensionNames.filter(d =>
          categoryNames.some(cn => cn === d || d.includes(cn) || cn.includes(d))
        );
        console.log(`[CrossAnalysis] matchingDims: [${matchingDims.join(", ")}]`);
        if (!dim1Name) dim1Name = matchingDims[0] || dimensionNames[0] || "";
        if (!dim2Name) dim2Name = matchingDims[1] || matchingDims[0] || dimensionNames[1] || dimensionNames[0] || "";
      }

      console.log(`[CrossAnalysis] Selected dims: dim1="${dim1Name}", dim2="${dim2Name}"`);

      // Cross analysis
      const crossResult = dim1Name && dim2Name ? calcCrossAnalysis(productData, oldTagData, dim1Name, dim2Name) : null;
      console.log(`[CrossAnalysis] crossResult: matrix=${crossResult?.matrix?.length || 0} cells, hot=${crossResult?.hotCombinations?.length || 0}, blue=${crossResult?.blueOcean?.length || 0}`);

      // AI interpretation with project-level tag context
      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

      try {

        const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

        if (_emperorRes.success && _emperorRes.output) {

          // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

        }

      } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: ATTRIBUTE_ANALYSIS_PROMPT },
          {
            role: "user",
            content: `品类: ${project.name}\n\n` +
              `【项目标签体系（已确认）】\n${JSON.stringify(projectTagSummary, null, 2)}\n\n` +
              `【各维度统计】\n${JSON.stringify(singleDimStats, null, 2)}\n\n` +
              `【交叉分析(${dim1Name} × ${dim2Name})】\n${JSON.stringify(crossResult, null, 2)}\n\n` +
              `请基于以上项目标签体系和产品数据，进行深度交叉分析。重点关注：\n` +
              `1. 项目标签中的各属性维度在市场中的分布情况\n` +
              `2. 不同属性组合的市场表现差异\n` +
              `3. 基于标签体系识别蓝海机会和差异化方向\n` +
              `4. 红海预警：哪些属性组合竞争过于激烈`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "tag_cross_analysis_ai",
            strict: true,
            schema: {
              type: "object",
              properties: {
                mainstreamProducts: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      combo: { type: "string" },
                      salesShare: { type: "string" },
                      reason: { type: "string" },
                    },
                    required: ["combo", "salesShare", "reason"],
                    additionalProperties: false,
                  },
                },
                differentiationOpportunities: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      combo: { type: "string" },
                      competitionLevel: { type: "string" },
                      potential: { type: "string" },
                      reason: { type: "string" },
                    },
                    required: ["combo", "competitionLevel", "potential", "reason"],
                    additionalProperties: false,
                  },
                },
                tagInsights: {
                  type: "array",
                  description: "基于项目标签体系的洞察",
                  items: {
                    type: "object",
                    properties: {
                      category: { type: "string" },
                      insight: { type: "string" },
                      recommendation: { type: "string" },
                    },
                    required: ["category", "insight", "recommendation"],
                    additionalProperties: false,
                  },
                },
                recommendedDirections: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      direction: { type: "string" },
                      attributes: {
                        type: "object",
                        additionalProperties: { type: "string" },
                      },
                      estimatedPriceRange: { type: "string" },
                      targetAudience: { type: "string" },
                      reason: { type: "string" },
                      priority: { type: "number" },
                    },
                    required: ["direction", "attributes", "estimatedPriceRange", "targetAudience", "reason", "priority"],
                    additionalProperties: false,
                  },
                },
                redOceanWarnings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      combo: { type: "string" },
                      reason: { type: "string" },
                    },
                    required: ["combo", "reason"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
              },
              required: ["mainstreamProducts", "differentiationOpportunities", "tagInsights", "recommendedDirections", "redOceanWarnings", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const aiContent = response.choices?.[0]?.message?.content;
      const aiResult = aiContent ? JSON.parse(aiContent as string) : {};

      const result = {
        singleDimStats,
        crossResult,
        dimensionNames,
        projectTagSummary,
        confirmedCategories: confirmedCats.map((c: any) => ({ id: c.id, name: c.categoryName, key: c.categoryKey })),
        selectedDims: { dim1: dim1Name, dim2: dim2Name },
        ai: aiResult,
      };

      await devDb.upsertDevAnalysisStage({
        projectId: input.projectId,
        userId: ctx.user.id,
        stageType: "attribute_cross",
        status: "completed",
        rawResult: JSON.stringify(result),
        editedResult: null,
        confirmedAt: null,
      });

      return result;
    }),
});

// ─── Helper Functions ────────────────────────────────────────

function mapToProductData(p: any): ProductData {
  // 优先使用子ASIN数据（childSales/childRevenue），如果存在则覆盖父ASIN数据
  // 这确保品牌竞争分析等统计使用更精确的子体级别数据
  const effectiveSales = (p.childSales != null && p.childSales > 0) ? p.childSales : p.monthlySales;
  const effectiveRevenue = (p.childRevenue != null && parseFloat(p.childRevenue) > 0)
    ? String(p.childRevenue)
    : p.monthlyRevenue;
  return {
    asin: p.asin ?? "",
    title: p.title,
    brand: p.brand,
    price: p.price,
    rating: p.rating,
    reviewCount: p.reviewCount,
    monthlySales: effectiveSales,
    bsr: p.bsr,
    monthlyRevenue: effectiveRevenue,
    listingDate: p.listingDate,
    fulfillment: p.fulfillment,
    sellerName: p.sellerName,
    sellerLocation: p.sellerLocation,
    variantCount: p.variantCount,
    category: p.category,
    monthlySalesHistory: p.monthlySalesHistory,
    monthlyRevenueHistory: p.monthlyRevenueHistory,
    imageUrl: p.imageUrl,
    searchRank: p.searchRank,
  };
}

async function generateExternalSummary(rawData: unknown, prompt: string): Promise<string> {
      // [Emperor] 优先调用 Emperor Skill: dev.analysis.product

  try {

    const _emperorRes = await runSkillViaEmperor("dev.analysis.product", { context: JSON.stringify(input).slice(0, 3000) });

    if (_emperorRes.success && _emperorRes.output) {

      // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

    }

  } catch (_e) { console.warn("[Emperor] devAnalysis.ts fallback:", _e); }

  const response = await invokeLLM({
    messages: [
      { role: "system", content: "你是一个跨境电商市场分析专家。请根据提供的数据进行分析总结。" },
      { role: "user", content: `数据:\n${JSON.stringify(rawData).substring(0, 3000)}\n\n${prompt}` },
    ],
  });
  return (response.choices?.[0]?.message?.content as string) || "";
}

function buildReportContext(reportType: string, products: any[], reviewStats: any, project: any): string {
  const productSummary = products.slice(0, 20).map(p =>
    `ASIN:${p.asin} | ${p.title} | ¥${p.price} | ${p.rating}★ | BSR:${p.bsr} | 月销:${p.monthlySales}`
  ).join("\n");

  const base = `项目: ${project.name}\n目标市场: ${project.targetMarket}\n关键词: ${project.keywords}\n\n产品数据(${products.length}个):\n${productSummary}\n\n评论统计: 总${reviewStats.total}条, 好评${reviewStats.positive}, 中评${reviewStats.neutral}, 差评${reviewStats.negative}`;

  const typePrompts: Record<string, string> = {
    market_overview: "请分析市场大盘：市场体量、均价、增速、头部集中度、成熟度",
    product_analysis: "请分析产品属性：属性维度分布、销售额占比、热门组合、差异化机会",
    price_analysis: "请分析价格段：价格段分布、最佳区间、价格与评分关系、定价建议",
    brand_analysis: "请分析品牌竞争：TOP品牌、集中度、中国vs非中国卖家、竞争格局",
    competitor_analysis: "请深度分析TOP5竞品：优劣势、定价策略、差异化特点",
    review_analysis: "请分析评论：评分分布、好评关键词、差评痛点、用户需求、改进建议",
    review_analysis_recent_2y: "请分析近两年评论：评分分布、好评关键词、差评痛点、用户需求、改进建议",
    external_analysis: "请分析站外数据：Google趋势、KOL推广、竞品站外策略、众筹趋势",
    ai_summary: "请生成AI总结报告：市场概况、产品机会、竞争格局、推荐定位、风险提示",
  };

  return `${base}\n\n${typePrompts[reportType] || "请生成分析报告"}`;
}

function getReportTitle(reportType: string): string {
  const titles: Record<string, string> = {
    market_overview: "市场大盘分析",
    product_analysis: "产品属性分析",
    price_analysis: "价格段分析",
    brand_analysis: "品牌竞争分析",
    competitor_analysis: "竞品深度分析",
    review_analysis: "评论分析",
    review_analysis_recent_2y: "近两年评论分析",
    external_analysis: "站外数据分析",
    ai_summary: "AI总结报告",
  };
  return titles[reportType] || "分析报告";
}
