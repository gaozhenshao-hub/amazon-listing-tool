import { currentOpsWorkspaceId } from "../workspaceContext";
import { requireOpsDb } from "../legacy/repository";
import { runOpsSkill } from "../legacy/service";
import { opsWorkspaceCondition } from "../../../repositories/ops";
import * as shared from "../routerContext";
import type { CheckItemScore, ConversionCrawlData, ImportResult, ScoringProgress, SellerSpriteProductData } from "../routerContext";

const {
  MARKETPLACE_MID_MAP,
  SELLER_CACHE_TTL,
  TRPCError,
  _productOpsSellerCache,
  and,
  asc,
  buildCrawlDataFromSellerSprite,
  checkItemOverrides,
  collectConversionData,
  collectMultipleAsins,
  competitorMonitors,
  competitorSnapshots,
  conversionCheckItems,
  conversionComparisons,
  conversionScores,
  conversionSuggestions,
  desc,
  eq,
  executionReviews,
  findMatchedSid,
  generateMockCrawlData,
  getCachedSellers,
  getDateNDaysAgo,
  getDefault129CheckItems,
  getToday,
  getYesterday,
  inArray,
  invokeBusinessSkill,
  isNull,
  keywordMonitors,
  keywordSnapshots,
  lingxingProductWeekly,
  mergeSellerSpriteWithCrawlData,
  operatorNameMappings,
  opsImportHistory,
  opsPlanActions,
  opsPlanSummaries,
  opsPlans,
  or,
  parseSellerSpriteData,
  parseSellerSpriteXlsx,
  productBasicInfo,
  productLogs,
  productMonthlySummary,
  productProfiles,
  productTodos,
  productVariants,
  productWeeklyOps,
  protectedProcedure,
  resolveDataUserId,
  round2,
  router,
  scoreAllCheckItems,
  scoringProgressMap,
  sql,
  teamTasks,
  users,
  z,
} = shared;

export const opsExecutionReviewProcedures = {


  // ═══════════════════════════════════════════════════════
  // ─── Execution Reviews (执行复盘) ───
  // ═══════════════════════════════════════════════════════

  listExecutionReviews: protectedProcedure
    .input(z.object({ productProfileId: z.number(), parentAsin: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const { MANAGER_ROLES } = await import("../../../../shared/const");
      const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      const conditions: any[] = [];
      if (!isManager) {
        conditions.push(eq(executionReviews.userId, ctx.user.id));
      }
      if (input.parentAsin) {
        conditions.push(eq(executionReviews.parentAsin, input.parentAsin));
      } else {
        conditions.push(eq(executionReviews.productProfileId, input.productProfileId));
      }
      return db!.select().from(executionReviews)
        .where(opsWorkspaceCondition(executionReviews, currentOpsWorkspaceId(), and(...conditions)))
        .orderBy(desc(executionReviews.createdAt));
    }),


  createExecutionReview: protectedProcedure
    .input(z.object({
      productProfileId: z.number(),
      parentAsin: z.string().min(1, "父ASIN不能为空"),
      planId: z.number().optional(),
      period: z.string().min(1),
      periodType: z.enum(["weekly", "monthly", "quarterly"]).optional().default("weekly"),
      // 基线数据：支持多选周度自动拓取
      baselineWeeks: z.array(z.object({
        weekStart: z.string(),
        weekEnd: z.string(),
      })).optional(),
      // 目标数据：支持多选周度自动拓取
      targetWeeks: z.array(z.object({
        weekStart: z.string(),
        weekEnd: z.string(),
      })).optional(),
      // 向后兼容旧字段
      baselineWeekStart: z.string().optional(),
      baselineWeekEnd: z.string().optional(),
      targetWeekStart: z.string().optional(),
      targetWeekEnd: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const { baselineWeeks, targetWeeks, baselineWeekStart, baselineWeekEnd, targetWeekStart, targetWeekEnd, ...rest } = input;

      // Resolve baseline weeks: prefer new multi-select array, fallback to old single pair
      const effectiveBaselineWeeks = (baselineWeeks && baselineWeeks.length > 0)
        ? baselineWeeks
        : (baselineWeekStart && baselineWeekEnd ? [{ weekStart: baselineWeekStart, weekEnd: baselineWeekEnd }] : []);

      // Auto-fetch baseline data from imported weekly data (multi-week aggregation)
      let baselineData: Record<string, any> = {};
      if (effectiveBaselineWeeks.length > 0 && input.parentAsin) {
        const effectiveUserId = await resolveDataUserId(db!, ctx.user);
        let allRows: any[] = [];
        for (const wk of effectiveBaselineWeeks) {
          const weeklyRows = await db!.select().from(lingxingProductWeekly)
            .where(opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), and(
              eq(lingxingProductWeekly.userId, effectiveUserId),
              eq(lingxingProductWeekly.parentAsin, input.parentAsin),
              eq(lingxingProductWeekly.weekStartDate, wk.weekStart),
              eq(lingxingProductWeekly.weekEndDate, wk.weekEnd),
            )));
          allRows.push(...weeklyRows);
        }

        if (allRows.length > 0) {
          let totalSales = 0, organicOrders = 0, adOrders = 0;
          let ratingScore = '0', ratingCount = 0;
          let subcategoryRank: number | null = null;
          let profitMarginSum = 0, convRateSum = 0;
          let profitMarginCount = 0, convRateCount = 0;

          for (const row of allRows) {
            totalSales += Number(row.salesAmount || 0);
            organicOrders += Number(row.organicOrders || 0);
            adOrders += Number(row.adOrders || 0);
            if (!subcategoryRank && row.bsrSub) {
              const match = row.bsrSub.match(/(\d+)/);
              if (match) subcategoryRank = parseInt(match[1]);
            }
            if (ratingScore === '0' && row.rating) ratingScore = row.rating;
            if (ratingCount === 0 && row.reviewCount) ratingCount = Number(row.reviewCount);
            if (row.orderProfitMargin) { profitMarginSum += Number(row.orderProfitMargin); profitMarginCount++; }
            if (row.cvr) { convRateSum += Number(row.cvr); convRateCount++; }
          }

          // Build week label from all selected weeks
          const weekLabels = effectiveBaselineWeeks.map(wk => {
            const s = new Date(wk.weekStart + 'T00:00:00');
            const e = new Date(wk.weekEnd + 'T00:00:00');
            return `${(s.getMonth()+1).toString().padStart(2,'0')}/${s.getDate().toString().padStart(2,'0')}-${(e.getMonth()+1).toString().padStart(2,'0')}/${e.getDate().toString().padStart(2,'0')}`;
          });
          const weekLabel = weekLabels.join(', ');

          baselineData = {
            baselineSales: String(round2(totalSales)),
            baselineProfitRate: profitMarginCount > 0 ? String(round2(profitMarginSum / profitMarginCount)) : undefined,
            baselineSubcategoryRank: subcategoryRank,
            baselineConvRate: convRateCount > 0 ? String(round2(convRateSum / convRateCount)) : undefined,
            baselineOrganicOrders: organicOrders,
            baselineAdOrders: adOrders,
            baselineRatingScore: ratingScore !== '0' ? ratingScore : undefined,
            baselineRatingCount: ratingCount > 0 ? ratingCount : undefined,
            baselineWeekLabel: weekLabel,
          };
        }
      }

      // Resolve target weeks: prefer new multi-select array, fallback to old single pair
      const effectiveTargetWeeks = (targetWeeks && targetWeeks.length > 0)
        ? targetWeeks
        : (targetWeekStart && targetWeekEnd ? [{ weekStart: targetWeekStart, weekEnd: targetWeekEnd }] : []);

      // Auto-fetch target data from imported weekly data (multi-week aggregation)
      let targetData: Record<string, any> = {};
      if (effectiveTargetWeeks.length > 0 && input.parentAsin) {
        const effectiveUserId2 = await resolveDataUserId(db!, ctx.user);
        let allTargetRows: any[] = [];
        for (const wk of effectiveTargetWeeks) {
          const targetRows = await db!.select().from(lingxingProductWeekly)
            .where(opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), and(
              eq(lingxingProductWeekly.userId, effectiveUserId2),
              eq(lingxingProductWeekly.parentAsin, input.parentAsin),
              eq(lingxingProductWeekly.weekStartDate, wk.weekStart),
              eq(lingxingProductWeekly.weekEndDate, wk.weekEnd),
            )));
          allTargetRows.push(...targetRows);
        }

        if (allTargetRows.length > 0) {
          let tSales = 0, tOrgOrders = 0, tAdOrders = 0;
          let tRatingScore = '0', tRatingCount = 0;
          let tSubcategoryRank: number | null = null;
          let tConvRateSum = 0, tConvRateCount = 0;

          for (const row of allTargetRows) {
            tSales += Number(row.salesAmount || 0);
            tOrgOrders += Number(row.organicOrders || 0);
            tAdOrders += Number(row.adOrders || 0);
            if (!tSubcategoryRank && row.bsrSub) {
              const match = row.bsrSub.match(/(\d+)/);
              if (match) tSubcategoryRank = parseInt(match[1]);
            }
            if (tRatingScore === '0' && row.rating) tRatingScore = row.rating;
            if (tRatingCount === 0 && row.reviewCount) tRatingCount = Number(row.reviewCount);
            if (row.cvr) { tConvRateSum += Number(row.cvr); tConvRateCount++; }
          }

          const targetWeekLabels = effectiveTargetWeeks.map(wk => {
            const ts = new Date(wk.weekStart + 'T00:00:00');
            const te = new Date(wk.weekEnd + 'T00:00:00');
            return `${(ts.getMonth()+1).toString().padStart(2,'0')}/${ts.getDate().toString().padStart(2,'0')}-${(te.getMonth()+1).toString().padStart(2,'0')}/${te.getDate().toString().padStart(2,'0')}`;
          });
          const targetWeekLabel = targetWeekLabels.join(', ');

          targetData = {
            targetSales: String(round2(tSales)),
            targetSubcategoryRank: tSubcategoryRank,
            targetConvRate: tConvRateCount > 0 ? String(round2(tConvRateSum / tConvRateCount)) : undefined,
            targetOrganicOrders: tOrgOrders,
            targetAdOrders: tAdOrders,
            targetRatingScore: tRatingScore !== '0' ? tRatingScore : undefined,
            targetRatingCount: tRatingCount > 0 ? tRatingCount : undefined,
            targetWeekLabel: targetWeekLabel,
          };
        }
      }

      const [result] = await db!.insert(executionReviews).values({
        ...rest, ...baselineData, ...targetData, userId: ctx.user.id,
      });
      return { id: result.insertId, baselineData, targetData };
    }),


  updateExecutionReview: protectedProcedure
    .input(z.object({
      reviewId: z.number(),
      // 实际数据
      actualSales: z.string().optional(),
      actualSubcategoryRank: z.number().optional(),
      actualProfitRate: z.string().optional(),
      actualConvRate: z.string().optional(),
      actualOrganicOrders: z.number().optional(),
      actualAdOrders: z.number().optional(),
      actualRatingScore: z.string().optional(),
      actualRatingCount: z.number().optional(),
      actualWeekLabel: z.string().optional(),
      actualWeekCount: z.number().optional(),
      // 文本字段
      achievementSummary: z.string().optional(), keyActions: z.string().optional(),
      lessonsLearned: z.string().optional(), nextPeriodPlan: z.string().optional(),
      strategistFeedback: z.string().optional(),
      strategistRating: z.enum(["S", "A", "B", "C", "D"]).optional(),
      status: z.enum(["draft", "submitted", "reviewed"]).optional(),
      aiAnalysis: z.string().optional(), aiAnalysisLocked: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const { MANAGER_ROLES } = await import("../../../../shared/const");
      const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      const { reviewId, ...updates } = input;
      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length > 0) {
        const conds = [eq(executionReviews.id, reviewId)];
        if (!isManager) conds.push(eq(executionReviews.userId, ctx.user.id));
        await db!.update(executionReviews).set(clean).where(opsWorkspaceCondition(executionReviews, currentOpsWorkspaceId(), and(...conds)));
      }
      return { updated: true };
    }),


  deleteExecutionReview: protectedProcedure
    .input(z.object({ reviewId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const { MANAGER_ROLES } = await import("../../../../shared/const");
      const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      const conds = [eq(executionReviews.id, input.reviewId)];
      if (!isManager) conds.push(eq(executionReviews.userId, ctx.user.id));
      await db!.delete(executionReviews).where(opsWorkspaceCondition(executionReviews, currentOpsWorkspaceId(), and(...conds)));
      return { deleted: true };
    }),


  aiReviewAnalysis: protectedProcedure
    .input(z.object({ reviewId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await requireOpsDb();
      const [review] = await db!.select().from(executionReviews).where(opsWorkspaceCondition(executionReviews, currentOpsWorkspaceId(), eq(executionReviews.id, input.reviewId)));
      if (!review) throw new TRPCError({ code: "NOT_FOUND" });
      if (review.aiAnalysisLocked) return { analysis: review.aiAnalysis };

      const prompt = `你是一位资深亚马逊运营分析师。请基于以下数据进行运营复盘分析：

【复盘周期】${review.period}

【基线数据（计划起始）】
销售额: $${review.baselineSales || 0} | 小类排名: #${review.baselineSubcategoryRank || '-'} | 利润率: ${review.baselineProfitRate || 0}%
转化率: ${review.baselineConvRate || 0}% | 自然单: ${review.baselineOrganicOrders || 0} | 广告单: ${review.baselineAdOrders || 0}
评分: ${review.baselineRatingScore || '-'} | Rating数量: ${review.baselineRatingCount || 0}

【目标数据】
销售额: $${review.targetSales || 0} | 小类排名: #${review.targetSubcategoryRank || '-'}
转化率: ${review.targetConvRate || 0}% | 自然单: ${review.targetOrganicOrders || 0} | 广告单: ${review.targetAdOrders || 0}
评分: ${review.targetRatingScore || '-'} | Rating数量: ${review.targetRatingCount || 0}

【实际数据（当前）】
销售额: $${review.actualSales || 0} | 小类排名: #${review.actualSubcategoryRank || '-'} | 利润率: ${review.actualProfitRate || 0}%
转化率: ${review.actualConvRate || 0}% | 自然单: ${review.actualOrganicOrders || 0} | 广告单: ${review.actualAdOrders || 0}
评分: ${review.actualRatingScore || '-'} | Rating数量: ${review.actualRatingCount || 0}

【运营总结】${review.achievementSummary || '无'}
【关键动作】${review.keyActions || '无'}

请输出JSON格式的分析结果：
{
  "achievementSummary": "整体达成情况概述（2-3句话）",
  "keyFindings": [
    { "metric": "指标名", "status": "达标/未达标/超额", "detail": "具体分析" }
  ],
  "problems": [
    { "issue": "问题描述", "possibleCause": "可能原因", "severity": "high/medium/low" }
  ],
  "recommendations": [
    { "action": "具体建议", "priority": "high/medium/low", "expectedImpact": "预期效果" }
  ],
  "nextPeriodFocus": ["下期重点1", "下期重点2"]
}`;

      const resp = await runOpsSkill({
        messages: [
          { role: "system", content: "你是一位资深亚马逊运营分析师，擅长数据分析和运营策略。请始终输出有效的JSON格式。" },
          { role: "user", content: prompt }
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "review_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                achievementSummary: { type: "string", description: "整体达成情况概述" },
                keyFindings: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      metric: { type: "string" },
                      status: { type: "string" },
                      detail: { type: "string" }
                    },
                    required: ["metric", "status", "detail"],
                    additionalProperties: false
                  }
                },
                problems: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      issue: { type: "string" },
                      possibleCause: { type: "string" },
                      severity: { type: "string" }
                    },
                    required: ["issue", "possibleCause", "severity"],
                    additionalProperties: false
                  }
                },
                recommendations: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      action: { type: "string" },
                      priority: { type: "string" },
                      expectedImpact: { type: "string" }
                    },
                    required: ["action", "priority", "expectedImpact"],
                    additionalProperties: false
                  }
                },
                nextPeriodFocus: {
                  type: "array",
                  items: { type: "string" }
                }
              },
              required: ["achievementSummary", "keyFindings", "problems", "recommendations", "nextPeriodFocus"],
              additionalProperties: false
            }
          }
        }
      });
      const analysis = (resp.choices?.[0]?.message?.content as string) || '{"achievementSummary":"AI分析暂不可用","keyFindings":[],"problems":[],"recommendations":[],"nextPeriodFocus":[]}';
      await db!.update(executionReviews).set({ aiAnalysis: analysis }).where(opsWorkspaceCondition(executionReviews, currentOpsWorkspaceId(), eq(executionReviews.id, input.reviewId)));
      return { analysis };
    }),


  // ─── 复盘数据从导入数据查询 ───
  syncReviewFromImportedData: protectedProcedure
    .input(z.object({
      reviewId: z.number(),
      parentAsin: z.string(),
      weekCount: z.number().default(1),
      syncTarget: z.enum(["baseline", "actual", "both"]).default("actual"),
      planId: z.number().optional(), // 可选：从运营计划自动带入基线和目标
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();

      const [review] = await db!.select().from(executionReviews).where(opsWorkspaceCondition(executionReviews, currentOpsWorkspaceId(), eq(executionReviews.id, input.reviewId)));
      if (!review) throw new TRPCError({ code: 'NOT_FOUND', message: '复盘记录不存在' });

      const updates: Record<string, any> = { parentAsin: input.parentAsin };

      // 从导入的周度数据中查询实际数据
      if (input.syncTarget === 'actual' || input.syncTarget === 'both') {
        // Use resolveDataUserId to handle non-admin users querying admin-imported data
        const effectiveUserId = await resolveDataUserId(db!, ctx.user);
        const weeklyRows = await db!.select().from(lingxingProductWeekly)
          .where(opsWorkspaceCondition(lingxingProductWeekly, currentOpsWorkspaceId(), and(
            eq(lingxingProductWeekly.userId, effectiveUserId),
            eq(lingxingProductWeekly.parentAsin, input.parentAsin),
          )))
          .orderBy(desc(lingxingProductWeekly.weekStartDate));

        const weekMap = new Map<string, typeof weeklyRows>();
        for (const row of weeklyRows) {
          const key = `${row.weekStartDate}_${row.weekEndDate}`;
          if (!weekMap.has(key)) weekMap.set(key, []);
          weekMap.get(key)!.push(row);
        }
        const sortedWeeks = Array.from(weekMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

        if (sortedWeeks.length > 0) {
          const weeksToAggregate = Math.min(input.weekCount, sortedWeeks.length);
          const selectedWeeks = sortedWeeks.slice(0, weeksToAggregate);

          let totalSales = 0, organicOrders = 0, adOrders = 0;
          let ratingScore = '0', ratingCount = 0;
          let subcategoryRank: string | null = null;
          let profitMarginSum = 0, convRateSum = 0;
          let profitMarginCount = 0, convRateCount = 0;

          for (const [, rows] of selectedWeeks) {
            for (const row of rows) {
              totalSales += Number(row.salesAmount || 0);
              organicOrders += Number(row.organicOrders || 0);
              adOrders += Number(row.adOrders || 0);
              if (!subcategoryRank && row.bsrSub) subcategoryRank = row.bsrSub;
              if (ratingScore === '0' && row.rating) ratingScore = row.rating;
              if (ratingCount === 0 && row.reviewCount) ratingCount = Number(row.reviewCount);
              if (row.orderProfitMargin) { profitMarginSum += Number(row.orderProfitMargin); profitMarginCount++; }
              if (row.cvr) { convRateSum += Number(row.cvr); convRateCount++; }
            }
          }

          const avgProfitMargin = profitMarginCount > 0 ? profitMarginSum / profitMarginCount : 0;
          const avgConvRate = convRateCount > 0 ? convRateSum / convRateCount : 0;

          let rankNum: number | null = null;
          if (subcategoryRank) {
            const match = subcategoryRank.match(/(\d+)/);
            if (match) rankNum = parseInt(match[1]);
          }

          // 生成周标签
          const lastWeek = selectedWeeks[selectedWeeks.length - 1];
          const firstWeek = selectedWeeks[0];
          const [, lastEnd] = firstWeek[0].split('_');
          const [lastStart] = lastWeek[0].split('_');
          const s = new Date(lastStart + 'T00:00:00');
          const e = new Date(lastEnd + 'T00:00:00');
          const weekLabel = weeksToAggregate === 1
            ? `${(s.getMonth()+1).toString().padStart(2,'0')}/${s.getDate().toString().padStart(2,'0')}-${(e.getMonth()+1).toString().padStart(2,'0')}/${e.getDate().toString().padStart(2,'0')}`
            : `${(s.getMonth()+1).toString().padStart(2,'0')}/${s.getDate().toString().padStart(2,'0')}-${(e.getMonth()+1).toString().padStart(2,'0')}/${e.getDate().toString().padStart(2,'0')} (${weeksToAggregate}周)`;

          updates.actualSales = String(round2(totalSales));
          updates.actualProfitRate = String(round2(avgProfitMargin));
          updates.actualSubcategoryRank = rankNum;
          updates.actualConvRate = String(round2(avgConvRate));
          updates.actualOrganicOrders = organicOrders;
          updates.actualAdOrders = adOrders;
          updates.actualRatingScore = ratingScore;
          updates.actualRatingCount = ratingCount;
          updates.actualWeekLabel = weekLabel;
          updates.actualWeekCount = weeksToAggregate;
        }
      }

      // 从运营计划自动带入基线和目标数据
      if (input.planId && (input.syncTarget === 'baseline' || input.syncTarget === 'both')) {
        const [plan] = await db!.select().from(opsPlans).where(opsWorkspaceCondition(opsPlans, currentOpsWorkspaceId(), eq(opsPlans.id, input.planId)));
        if (plan) {
          updates.baselineSales = plan.baselineSales;
          updates.baselineProfitRate = plan.baselineProfitRate;
          updates.baselineSubcategoryRank = plan.baselineSubcategoryRank;
          updates.baselineConvRate = plan.baselineConvRate;
          updates.baselineOrganicOrders = plan.baselineOrganicOrders;
          updates.baselineAdOrders = plan.baselineAdOrders;
          updates.baselineRatingScore = plan.baselineRatingScore;
          updates.baselineRatingCount = plan.baselineRatingCount;
          updates.baselineWeekLabel = plan.baselineWeekLabel;
          // 目标数据
          updates.targetSales = plan.targetSales;
          updates.targetSubcategoryRank = plan.targetSubcategoryRank;
          updates.targetConvRate = plan.targetConvRate;
          updates.targetOrganicOrders = plan.targetOrganicOrders;
          updates.targetAdOrders = plan.targetAdOrders;
          updates.targetRatingScore = plan.targetRatingScore;
          updates.targetRatingCount = plan.targetRatingCount;
        }
      }

      if (Object.keys(updates).length > 0) {
        await db!.update(executionReviews).set(updates).where(opsWorkspaceCondition(executionReviews, currentOpsWorkspaceId(), eq(executionReviews.id, input.reviewId)));
      }

      return { synced: true, updates };
    }),


  // ─── AI复盘分析 ───
  generateReviewAiAnalysis: protectedProcedure
    .input(z.object({
      reviewId: z.number(),
      productTitle: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      // invokeBusinessSkill already imported at top of file

      const [review] = await db!.select().from(executionReviews).where(opsWorkspaceCondition(executionReviews, currentOpsWorkspaceId(), eq(executionReviews.id, input.reviewId)));
      if (!review) throw new TRPCError({ code: 'NOT_FOUND', message: '复盘记录不存在' });

      const prompt = `你是一位资深亚马逊运营分析师。请基于以下数据进行运营复盘分析：

【产品信息】${input.productTitle || review.parentAsin || '未知产品'}
【复盘周期】${review.actualWeekLabel || review.period}

【基线数据（计划起始）】
销售额: $${review.baselineSales || '--'} | 小类排名: #${review.baselineSubcategoryRank || '--'} | 利润率: ${review.baselineProfitRate || '--'}%
转化率: ${review.baselineConvRate || '--'}% | 自然单: ${review.baselineOrganicOrders ?? '--'} | 广告单: ${review.baselineAdOrders ?? '--'}
评分: ${review.baselineRatingScore || '--'} | Rating数量: ${review.baselineRatingCount ?? '--'}

【实际数据（当前）】
销售额: $${review.actualSales || '--'} | 小类排名: #${review.actualSubcategoryRank || '--'} | 利润率: ${review.actualProfitRate || '--'}%
转化率: ${review.actualConvRate || '--'}% | 自然单: ${review.actualOrganicOrders ?? '--'} | 广告单: ${review.actualAdOrders ?? '--'}
评分: ${review.actualRatingScore || '--'} | Rating数量: ${review.actualRatingCount ?? '--'}

【目标数据】
销售额: $${review.targetSales || '--'} | 小类排名: #${review.targetSubcategoryRank || '--'}
转化率: ${review.targetConvRate || '--'}% | 自然单: ${review.targetOrganicOrders ?? '--'} | 广告单: ${review.targetAdOrders ?? '--'}
评分: ${review.targetRatingScore || '--'} | Rating数量: ${review.targetRatingCount ?? '--'}

请输出JSON格式的分析结果：
{
  "achievementSummary": "整体达成情况概述（2-3句话）",
  "keyFindings": [
    { "metric": "指标名", "status": "达标/未达标/超额", "detail": "具体分析", "changeRate": "变化率%" }
  ],
  "problems": [
    { "issue": "问题描述", "possibleCause": "可能原因", "severity": "high/medium/low" }
  ],
  "recommendations": [
    { "action": "具体建议", "priority": "high/medium/low", "expectedImpact": "预期效果" }
  ],
  "nextPeriodFocus": ["下期重点1", "下期重点2"]
}`;

      try {
      // [Emperor] 优先调用 Emperor Skill: ops.searchterm.advice





        const response = await runOpsSkill({
          messages: [
            { role: 'system', content: '你是一位资深亚马逊运营分析师，擅长数据分析和运营策略。请始终输出有效的JSON格式。' },
            { role: 'user', content: prompt },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'review_analysis',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  achievementSummary: { type: 'string', description: '整体达成情况概述' },
                  keyFindings: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        metric: { type: 'string' },
                        status: { type: 'string' },
                        detail: { type: 'string' },
                        changeRate: { type: 'string' },
                      },
                      required: ['metric', 'status', 'detail', 'changeRate'],
                      additionalProperties: false,
                    },
                  },
                  problems: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        issue: { type: 'string' },
                        possibleCause: { type: 'string' },
                        severity: { type: 'string' },
                      },
                      required: ['issue', 'possibleCause', 'severity'],
                      additionalProperties: false,
                    },
                  },
                  recommendations: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        action: { type: 'string' },
                        priority: { type: 'string' },
                        expectedImpact: { type: 'string' },
                      },
                      required: ['action', 'priority', 'expectedImpact'],
                      additionalProperties: false,
                    },
                  },
                  nextPeriodFocus: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
                required: ['achievementSummary', 'keyFindings', 'problems', 'recommendations', 'nextPeriodFocus'],
                additionalProperties: false,
              },
            },
          },
        });

        const aiResult = JSON.parse(String(response.choices[0].message.content) || '{}');

        // 保存AI分析结果
        await db!.update(executionReviews).set({
          aiAnalysis: JSON.stringify(aiResult),
          achievementSummary: aiResult.achievementSummary,
          updatedAt: new Date(),
        }).where(opsWorkspaceCondition(executionReviews, currentOpsWorkspaceId(), eq(executionReviews.id, input.reviewId)));

        return { success: true, analysis: aiResult };
      } catch (err: any) {
        console.error('[AI Review] Error:', err.message);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI分析失败: ' + err.message });
            }
    }),
};
