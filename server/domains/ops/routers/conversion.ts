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

export const opsConversionProcedures = {


  // ═══════════════════════════════════════════════════════
  // ─── Conversion Comparison CRUD ───
  // ═══════════════════════════════════════════════════════

  listComparisons: protectedProcedure.input(z.object({ productProfileId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    return db!.select().from(conversionComparisons)
      .where(opsWorkspaceCondition(conversionComparisons, currentOpsWorkspaceId(), and(eq(conversionComparisons.userId, ctx.user.id), eq(conversionComparisons.productProfileId, input.productProfileId))))
      .orderBy(desc(conversionComparisons.updatedAt));
  }),


  getComparison: protectedProcedure.input(z.object({ comparisonId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    const [comp] = await db!.select().from(conversionComparisons)
      .where(opsWorkspaceCondition(conversionComparisons, currentOpsWorkspaceId(), and(eq(conversionComparisons.id, input.comparisonId), eq(conversionComparisons.userId, ctx.user.id))));
    if (!comp) throw new TRPCError({ code: "NOT_FOUND", message: "Comparison not found" });
    return comp;
  }),


  createComparison: protectedProcedure.input(z.object({
    productProfileId: z.number(),
    comparisonName: z.string().min(1),
    ownAsin: z.string().min(1),
    competitorAsins: z.array(z.string()).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    const [result] = await db!.insert(conversionComparisons).values({
      userId: ctx.user.id,
      productProfileId: input.productProfileId,
      comparisonName: input.comparisonName,
      ownAsin: input.ownAsin,
      competitorAsins: JSON.stringify(input.competitorAsins || []),
    });
    return { id: result.insertId };
  }),


  deleteComparison: protectedProcedure.input(z.object({ comparisonId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    await db!.delete(conversionScores).where(opsWorkspaceCondition(conversionScores, currentOpsWorkspaceId(), eq(conversionScores.comparisonId, input.comparisonId)));
    await db!.delete(conversionSuggestions).where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), eq(conversionSuggestions.comparisonId, input.comparisonId)));
    await db!.delete(conversionComparisons).where(opsWorkspaceCondition(conversionComparisons, currentOpsWorkspaceId(), and(eq(conversionComparisons.id, input.comparisonId), eq(conversionComparisons.userId, ctx.user.id))));
    return { success: true };
  }),


  // ─── Check Items (fixed template + user custom) ───

  getCheckItems: protectedProcedure.input(z.object({ includeHidden: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    // Auto-initialize default check items if none exist
    const existing = await db!.select({ count: sql<number>`count(*)` }).from(conversionCheckItems)
      .where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), isNull(conversionCheckItems.userId)));
    if (Number(existing[0]?.count) === 0) {
      const defaultItems = getDefault129CheckItems();
      for (const item of defaultItems) {
        await db!.insert(conversionCheckItems).values({ ...item, userId: null });
      }
    }
    // Get system defaults (userId IS NULL) + user custom items
    const items = await db!.select().from(conversionCheckItems)
      .where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), sql`${conversionCheckItems.userId} IS NULL OR ${conversionCheckItems.userId} = ${ctx.user.id}`))
      .orderBy(asc(conversionCheckItems.categoryIndex), asc(conversionCheckItems.sortOrder));
    // Get user overrides
    const overrides = await db!.select().from(checkItemOverrides)
      .where(opsWorkspaceCondition(checkItemOverrides, currentOpsWorkspaceId(), eq(checkItemOverrides.userId, ctx.user.id)));
    const overrideMap = new Map(overrides.map(o => [o.checkItemId, o]));
    // Merge items with overrides
    const merged = items.map(item => {
      const override = overrideMap.get(item.id);
      return {
        ...item,
        subDimension: override?.customSubDimension || item.subDimension,
        standard: override?.customStandard !== undefined && override?.customStandard !== null ? override.customStandard : item.standard,
        isHidden: override?.isHidden === 1 ? true : false,
        hasOverride: !!override,
        originalSubDimension: override?.customSubDimension ? item.subDimension : null,
        originalStandard: override?.customStandard !== undefined && override?.customStandard !== null ? item.standard : null,
      };
    });
    // Filter hidden items unless includeHidden is true
    if (!input?.includeHidden) {
      return merged.filter(item => !item.isHidden);
    }
    return merged;
  }),


  initDefaultCheckItems: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await requireOpsDb();
    const existing = await db!.select({ count: sql<number>`count(*)` }).from(conversionCheckItems)
      .where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), isNull(conversionCheckItems.userId)));
    if (Number(existing[0]?.count) > 0) return { message: "Default items already exist", count: Number(existing[0]?.count) };
    const defaultItems = getDefault129CheckItems();
    for (const item of defaultItems) {
      await db!.insert(conversionCheckItems).values({ ...item, userId: null });
    }
    return { message: "Initialized", count: defaultItems.length };
  }),


  // Force reset: delete all system check items + overrides + scores + suggestions, then re-init
  resetAndReinitCheckItems: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await requireOpsDb();
    // 1. Delete all system default check items (userId IS NULL)
    await db!.delete(conversionCheckItems).where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), isNull(conversionCheckItems.userId)));
    // 2. Delete all user overrides (they reference old check item IDs)
    await db!.delete(checkItemOverrides).where(opsWorkspaceCondition(checkItemOverrides, currentOpsWorkspaceId(), eq(checkItemOverrides.userId, ctx.user.id)));
    // 3. Re-insert new 129 items
    const defaultItems = getDefault129CheckItems();
    for (const item of defaultItems) {
      await db!.insert(conversionCheckItems).values({ ...item, userId: null });
    }
    return { message: "Reset and re-initialized", count: defaultItems.length };
  }),


  addCustomCheckItem: protectedProcedure.input(z.object({
    categoryIndex: z.number(),
    categoryName: z.string(),
    subDimension: z.string(),
    standard: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    const [result] = await db!.insert(conversionCheckItems).values({
      userId: ctx.user.id,
      categoryIndex: input.categoryIndex,
      categoryName: input.categoryName,
      subDimension: input.subDimension,
      standard: input.standard || null,
      isCustom: 1,
    });
    return { id: result.insertId };
  }),


  editCheckItem: protectedProcedure.input(z.object({
    checkItemId: z.number(),
    subDimension: z.string().optional(),
    standard: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    // Check if item exists
    const [item] = await db!.select().from(conversionCheckItems).where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), eq(conversionCheckItems.id, input.checkItemId)));
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: '检查项不存在' });

    // If it's user's own custom item, edit directly
    if (item.isCustom === 1 && item.userId === ctx.user.id) {
      await db!.update(conversionCheckItems).set({
        ...(input.subDimension !== undefined ? { subDimension: input.subDimension } : {}),
        ...(input.standard !== undefined ? { standard: input.standard } : {}),
      }).where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), eq(conversionCheckItems.id, input.checkItemId)));
      return { success: true, type: 'direct_edit' as const };
    }

    // For system items, create/update user override
    const [existingOverride] = await db!.select().from(checkItemOverrides)
      .where(opsWorkspaceCondition(checkItemOverrides, currentOpsWorkspaceId(), and(eq(checkItemOverrides.userId, ctx.user.id), eq(checkItemOverrides.checkItemId, input.checkItemId))));

    if (existingOverride) {
      await db!.update(checkItemOverrides).set({
        ...(input.subDimension !== undefined ? { customSubDimension: input.subDimension } : {}),
        ...(input.standard !== undefined ? { customStandard: input.standard } : {}),
        updatedAt: new Date(),
      }).where(opsWorkspaceCondition(checkItemOverrides, currentOpsWorkspaceId(), eq(checkItemOverrides.id, existingOverride.id)));
    } else {
      await db!.insert(checkItemOverrides).values({
        userId: ctx.user.id,
        checkItemId: input.checkItemId,
        customSubDimension: input.subDimension || null,
        customStandard: input.standard || null,
      });
    }
    return { success: true, type: 'override' as const };
  }),


  toggleCheckItemHidden: protectedProcedure.input(z.object({
    checkItemId: z.number(),
    isHidden: z.boolean(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    // Check if item exists
    const [item] = await db!.select().from(conversionCheckItems).where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), eq(conversionCheckItems.id, input.checkItemId)));
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: '检查项不存在' });

    // Create/update user override
    const [existingOverride] = await db!.select().from(checkItemOverrides)
      .where(opsWorkspaceCondition(checkItemOverrides, currentOpsWorkspaceId(), and(eq(checkItemOverrides.userId, ctx.user.id), eq(checkItemOverrides.checkItemId, input.checkItemId))));

    if (existingOverride) {
      await db!.update(checkItemOverrides).set({
        isHidden: input.isHidden ? 1 : 0,
        updatedAt: new Date(),
      }).where(opsWorkspaceCondition(checkItemOverrides, currentOpsWorkspaceId(), eq(checkItemOverrides.id, existingOverride.id)));
    } else {
      await db!.insert(checkItemOverrides).values({
        userId: ctx.user.id,
        checkItemId: input.checkItemId,
        isHidden: input.isHidden ? 1 : 0,
      });
    }
    return { success: true, isHidden: input.isHidden };
  }),


  resetCheckItemOverride: protectedProcedure.input(z.object({
    checkItemId: z.number(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    await db!.delete(checkItemOverrides)
      .where(opsWorkspaceCondition(checkItemOverrides, currentOpsWorkspaceId(), and(eq(checkItemOverrides.userId, ctx.user.id), eq(checkItemOverrides.checkItemId, input.checkItemId))));
    return { success: true };
  }),


  removeCustomCheckItem: protectedProcedure.input(z.object({ itemId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    // Also remove any overrides for this item
    await db!.delete(checkItemOverrides)
      .where(opsWorkspaceCondition(checkItemOverrides, currentOpsWorkspaceId(), and(eq(checkItemOverrides.userId, ctx.user.id), eq(checkItemOverrides.checkItemId, input.itemId))));
    await db!.delete(conversionCheckItems)
      .where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), and(eq(conversionCheckItems.id, input.itemId), eq(conversionCheckItems.userId, ctx.user.id), eq(conversionCheckItems.isCustom, 1))));
    return { success: true };
  }),


  // ─── Conversion Scores CRUD ───

  getScores: protectedProcedure.input(z.object({ comparisonId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    return db!.select().from(conversionScores)
      .where(opsWorkspaceCondition(conversionScores, currentOpsWorkspaceId(), eq(conversionScores.comparisonId, input.comparisonId)));
  }),


  updateScore: protectedProcedure.input(z.object({
    scoreId: z.number(),
    score: z.number().min(1).max(5).optional(),
    reason: z.string().optional(),
    isLocked: z.boolean().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    const updates: Record<string, any> = {};
    if (input.score !== undefined) {
      updates.score = input.score;
      updates.source = "manual"; // User manually edited score
    }
    if (input.reason !== undefined) updates.reason = input.reason;
    if (input.isLocked !== undefined) updates.isLocked = input.isLocked ? 1 : 0;
    await db!.update(conversionScores).set(updates).where(opsWorkspaceCondition(conversionScores, currentOpsWorkspaceId(), eq(conversionScores.id, input.scoreId)));
    return { success: true };
  }),


  batchUpdateScores: protectedProcedure.input(z.object({
    scores: z.array(z.object({
      scoreId: z.number(),
      score: z.number().min(1).max(5).optional(),
      reason: z.string().optional(),
      isLocked: z.boolean().optional(),
    })),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    for (const s of input.scores) {
      const updates: Record<string, any> = {};
      if (s.score !== undefined) {
        updates.score = s.score;
        updates.source = "manual"; // User manually edited score
      }
      if (s.reason !== undefined) updates.reason = s.reason;
      if (s.isLocked !== undefined) updates.isLocked = s.isLocked ? 1 : 0;
      await db!.update(conversionScores).set(updates).where(opsWorkspaceCondition(conversionScores, currentOpsWorkspaceId(), eq(conversionScores.id, s.scoreId)));
    }
    return { success: true };
  }),


  // ─── AI Scoring (Mock crawl + AI evaluate) ───

  triggerAiScoring: protectedProcedure.input(z.object({
    comparisonId: z.number(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    const [comp] = await db!.select().from(conversionComparisons)
      .where(opsWorkspaceCondition(conversionComparisons, currentOpsWorkspaceId(), eq(conversionComparisons.id, input.comparisonId)));
    if (!comp) throw new TRPCError({ code: "NOT_FOUND" });

    // Update status to crawling
    await db!.update(conversionComparisons).set({ status: "crawling" as any })
      .where(opsWorkspaceCondition(conversionComparisons, currentOpsWorkspaceId(), eq(conversionComparisons.id, input.comparisonId)));

    const allAsins = [comp.ownAsin, ...JSON.parse((comp.competitorAsins as string) || "[]")];
    const checkItems = await db!.select().from(conversionCheckItems)
      .where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), sql`${conversionCheckItems.userId} IS NULL OR ${conversionCheckItems.userId} = ${ctx.user.id}`))
      .orderBy(asc(conversionCheckItems.categoryIndex), asc(conversionCheckItems.sortOrder));

    // ═══ Step 1: 真实数据采集（爬虫 + 领星API） ═══
    let crawlData: Record<string, any> = {};
    const failedAsins: string[] = [];
    try {
      crawlData = await collectMultipleAsins(allAsins, { skipAds: false });
      // 记录采集失败的ASIN
      for (const asin of allAsins) {
        if (!crawlData[asin]) failedAsins.push(asin);
      }
    } catch (err: any) {
      console.error(`[triggerAiScoring] Data collection completely failed: ${err.message}`);
      // 全部失败，不生成任何假数据
      failedAsins.push(...allAsins);
    }
    await db!.update(conversionComparisons).set({ crawlData, status: "scoring" as any })
      .where(opsWorkspaceCondition(conversionComparisons, currentOpsWorkspaceId(), eq(conversionComparisons.id, input.comparisonId)));

    // Delete existing unlocked scores for this comparison
    const lockedScores = await db!.select().from(conversionScores)
      .where(opsWorkspaceCondition(conversionScores, currentOpsWorkspaceId(), and(
        eq(conversionScores.comparisonId, input.comparisonId),
        eq(conversionScores.isLocked, 1)
      )));
    const lockedKeys = new Set(lockedScores.map(s => `${s.checkItemId}:${s.asin}`));
    await db!.delete(conversionScores)
      .where(opsWorkspaceCondition(conversionScores, currentOpsWorkspaceId(), and(
        eq(conversionScores.comparisonId, input.comparisonId),
        eq(conversionScores.isLocked, 0)
      )));

    // ═══ Step 2: AI + 程序化评分 ═══
    for (const asin of allAsins) {
      const asinData = crawlData[asin] as ConversionCrawlData | undefined;

      // 过滤掉已锁定的检查项
      const unlocked = checkItems.filter(item => !lockedKeys.has(`${item.id}:${asin}`));

      if (asinData && asinData.hasData && asinData.categories) {
        // 有真实数据，使用AI评分引擎
        const scores = await scoreAllCheckItems(
          unlocked.map(item => ({
            id: item.id,
            categoryName: item.categoryName,
            subDimension: item.subDimension || "",
            standard: item.standard || "",
            categoryIndex: item.categoryIndex,
            sortOrder: item.sortOrder || 0,
          })),
          asinData
        );

        // 批量插入评分（区分有数据和无数据的情况）
        for (const s of scores) {
          await db!.insert(conversionScores).values({
            comparisonId: input.comparisonId,
            checkItemId: s.checkItemId,
            asin,
            score: s.score,       // 可能为null（无数据）
            aiScore: s.score,
            reason: s.reason,
            aiReason: s.reason,
            rawData: s.rawData,
            source: s.source || "ai",
          });
        }
      } else {
        // 无数据：插入空评分记录，score=null，明确标记为无数据
        for (const item of unlocked) {
          await db!.insert(conversionScores).values({
            comparisonId: input.comparisonId,
            checkItemId: item.id,
            asin,
            score: null,
            aiScore: null,
            reason: "数据采集失败，无法自动评分，请手动评分",
            aiReason: null,
            rawData: JSON.stringify({ error: "no_data", failedSources: failedAsins.includes(asin) ? "all" : "partial" }),
            source: "no_data",
          });
        }
      }
    }

    // Calculate overall score for own ASIN
    const ownScores = await db!.select().from(conversionScores)
      .where(opsWorkspaceCondition(conversionScores, currentOpsWorkspaceId(), and(eq(conversionScores.comparisonId, input.comparisonId), eq(conversionScores.asin, comp.ownAsin))));
    // 只计算有实际分数的项，跳过无数据的项
    const scoredItems = ownScores.filter(s => s.score !== null && s.score > 0);
    const noDataItems = ownScores.filter(s => s.score === null || s.source === 'no_data');
    const avgScore = scoredItems.length > 0
      ? round2(scoredItems.reduce((sum, s) => sum + (s.score || 0), 0) / scoredItems.length)
      : 0;

    await db!.update(conversionComparisons).set({
      overallOwnScore: String(avgScore),
      status: "completed" as any,
    }).where(opsWorkspaceCondition(conversionComparisons, currentOpsWorkspaceId(), eq(conversionComparisons.id, input.comparisonId)));

    return {
      success: true,
      totalScores: ownScores.length,
      scoredCount: scoredItems.length,
      noDataCount: noDataItems.length,
      avgScore,
    };
  }),


  // ─── AI Optimization Suggestions ───

  generateSuggestions: protectedProcedure.input(z.object({
    comparisonId: z.number(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    const [comp] = await db!.select().from(conversionComparisons)
      .where(opsWorkspaceCondition(conversionComparisons, currentOpsWorkspaceId(), eq(conversionComparisons.id, input.comparisonId)));
    if (!comp) throw new TRPCError({ code: "NOT_FOUND" });

    const competitorAsins: string[] = JSON.parse((comp.competitorAsins as string) || "[]");
    const allScores = await db!.select().from(conversionScores)
      .where(opsWorkspaceCondition(conversionScores, currentOpsWorkspaceId(), eq(conversionScores.comparisonId, input.comparisonId)));
    const checkItems = await db!.select().from(conversionCheckItems)
      .where(opsWorkspaceCondition(conversionCheckItems, currentOpsWorkspaceId(), sql`${conversionCheckItems.userId} IS NULL OR ${conversionCheckItems.userId} = ${ctx.user.id}`));

    // Group scores by category
    const categoryScores: Record<string, { own: number[]; competitors: number[] }> = {};
    for (const score of allScores) {
      const item = checkItems.find(ci => ci.id === score.checkItemId);
      if (!item) continue;
      const cat = item.categoryName;
      if (!categoryScores[cat]) categoryScores[cat] = { own: [], competitors: [] };
      if (score.asin === comp.ownAsin) {
        categoryScores[cat].own.push(score.score || 0);
      } else {
        categoryScores[cat].competitors.push(score.score || 0);
      }
    }

    // Delete existing unlocked suggestions
    await db!.delete(conversionSuggestions)
      .where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), and(eq(conversionSuggestions.comparisonId, input.comparisonId), eq(conversionSuggestions.isLocked, 0))));

    // Generate AI suggestions per category
    const categories = Object.keys(categoryScores);
    const suggestionPromises = categories.map(async (cat) => {
      const data = categoryScores[cat];
      const ownAvg = data.own.length > 0 ? round2(data.own.reduce((a, b) => a + b, 0) / data.own.length) : 0;
      const compMax = data.competitors.length > 0 ? Math.max(...data.competitors) : 0;
      const compAvg = data.competitors.length > 0 ? round2(data.competitors.reduce((a, b) => a + b, 0) / data.competitors.length) : 0;
      const gap = round2(compAvg - ownAvg);

      // Check if locked suggestion exists
      const locked = await db!.select().from(conversionSuggestions)
        .where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          eq(conversionSuggestions.categoryName, cat),
          eq(conversionSuggestions.isLocked, 1)
        )));
      if (locked.length > 0) return null;

      let suggestion = "";
      let gapAnalysis = "";
      let priority: "high" | "medium" | "low" = "medium";
      let expectedEffect = "";

      try {
      // [Emperor] 优先调用 Emperor Skill: ops.searchterm.advice





        const response = await runOpsSkill({
          messages: [
            { role: "system", content: `你是一位资深亚马逊运营专家和转化率优化顾问（游戏策划师角色）。请根据己品和竞品在"${cat}"维度的评分数据，给出专业的优化建议。

要求：
1. 差距分析：简明扼要分析己品与竞品的差距原因
2. 优化建议：给出3-5条具体可执行的优化动作
3. 优先级：根据差距大小和对转化率的影响程度判断（高/中/低）
4. 预期效果：预估优化后对转化率的提升幅度

请用JSON格式返回：{"gapAnalysis": "...", "suggestion": "...", "priority": "high|medium|low", "expectedEffect": "..."}` },
            { role: "user", content: `维度：${cat}\n己品平均分：${ownAvg}/5\n竞品平均分：${compAvg}/5\n竞品最高分：${compMax}/5\n差距：${gap}分` }
          ],
          response_format: {
            type: "json_schema",
            json_schema: {
              name: "suggestion",
              strict: true,
              schema: {
                type: "object",
                properties: {
                  gapAnalysis: { type: "string" },
                  suggestion: { type: "string" },
                  priority: { type: "string", enum: ["high", "medium", "low"] },
                  expectedEffect: { type: "string" },
                },
                required: ["gapAnalysis", "suggestion", "priority", "expectedEffect"],
                additionalProperties: false,
              },
            },
          },
        });
        const rawContent = response.choices[0]?.message?.content;
        const contentStr = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
        const parsed = JSON.parse(contentStr || "{}");
        gapAnalysis = parsed.gapAnalysis || "";
        suggestion = parsed.suggestion || "";
        priority = parsed.priority || "medium";
        expectedEffect = parsed.expectedEffect || "";
      } catch (e) {
        gapAnalysis = `己品平均${ownAvg}分，竞品平均${compAvg}分，差距${gap}分`;
        suggestion = gap > 1 ? "建议重点优化此维度" : "当前表现尚可，持续关注";
        priority = gap > 1.5 ? "high" : gap > 0.5 ? "medium" : "low";
        expectedEffect = `预计可提升${Math.abs(gap * 2).toFixed(0)}%转化率`;

      await db!.insert(conversionSuggestions).values({
        comparisonId: input.comparisonId,
        userId: ctx.user.id,
        categoryName: cat,
        ownScore: String(ownAvg),
        bestCompetitorScore: String(compMax),
        gapAnalysis,
        suggestion,
        priority: priority as any,
        expectedEffect,
      });
      return { cat, ownAvg, compAvg, gap };
            }
    });

    const results = (await Promise.all(suggestionPromises)).filter(Boolean);
    return { success: true, suggestionsGenerated: results.length };
  }),


  getSuggestions: protectedProcedure.input(z.object({ comparisonId: z.number() })).query(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    return db!.select().from(conversionSuggestions)
      .where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), eq(conversionSuggestions.comparisonId, input.comparisonId)))
      .orderBy(asc(conversionSuggestions.categoryName));
  }),


  updateSuggestion: protectedProcedure.input(z.object({
    suggestionId: z.number(),
    suggestion: z.string().optional(),
    gapAnalysis: z.string().optional(),
    priority: z.enum(["high", "medium", "low"]).optional(),
    expectedEffect: z.string().optional(),
    isLocked: z.boolean().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    const { suggestionId, ...updates } = input;
    const cleanUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) {
        if (k === "isLocked") cleanUpdates[k] = v ? 1 : 0;
        else cleanUpdates[k] = v;
      }
    }
    await db!.update(conversionSuggestions).set(cleanUpdates).where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), eq(conversionSuggestions.id, suggestionId)));
    return { success: true };
  }),


  // ─── Sync Suggestions to Plan Actions ───

  syncSuggestionsToPlan: protectedProcedure.input(z.object({
    comparisonId: z.number(),
    planId: z.number(),
    productProfileId: z.number(),
    suggestionIds: z.array(z.number()),
    mode: z.enum(["selected", "locked_low_score", "all_locked"]).optional().default("selected"),
    scoreThreshold: z.number().optional().default(3),
  })).mutation(async ({ ctx, input }) => {
    const db = await requireOpsDb();
    let suggestions;

    if (input.mode === "locked_low_score") {
      // Sync all locked suggestions where own score <= threshold
      suggestions = await db!.select().from(conversionSuggestions)
        .where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          eq(conversionSuggestions.isLocked, 1),
          sql`CAST(${conversionSuggestions.ownScore} AS DECIMAL) <= ${input.scoreThreshold}`
        )));
    } else if (input.mode === "all_locked") {
      // Sync all locked suggestions
      suggestions = await db!.select().from(conversionSuggestions)
        .where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          eq(conversionSuggestions.isLocked, 1)
        )));
    } else if (input.suggestionIds.length > 0) {
      // Sync specific selected suggestions
      suggestions = await db!.select().from(conversionSuggestions)
        .where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          inArray(conversionSuggestions.id, input.suggestionIds)
        )));
    } else {
      // Fallback: sync all locked suggestions (backward compat)
      suggestions = await db!.select().from(conversionSuggestions)
        .where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          eq(conversionSuggestions.isLocked, 1)
        )));
    }

    let created = 0;
    for (const sug of suggestions) {
      // Skip if already linked
      if (sug.linkedPlanActionId) continue;

      // Create plan action
      const [actionResult] = await db!.insert(opsPlanActions).values({
        planId: input.planId,
        userId: ctx.user.id,
        dimension: sug.categoryName,
        currentStatus: sug.gapAnalysis || null,
        targetAction: sug.suggestion || null,
        priority: sug.priority as any,
      });

      // Create linked todo
      const todoTitle = `[转化率优化] ${sug.categoryName} - ${(sug.suggestion || "").substring(0, 50)}`;
      const [todoResult] = await db!.insert(productTodos).values({
        productId: input.productProfileId,
        userId: ctx.user.id,
        title: todoTitle,
        priority: sug.priority as any,
        status: "pending" as any,
      });

      // Link action to todo
      await db!.update(opsPlanActions).set({ linkedTodoId: todoResult.insertId })
        .where(opsWorkspaceCondition(opsPlanActions, currentOpsWorkspaceId(), eq(opsPlanActions.id, actionResult.insertId)));

      // Link suggestion to action
      await db!.update(conversionSuggestions).set({ linkedPlanActionId: actionResult.insertId })
        .where(opsWorkspaceCondition(conversionSuggestions, currentOpsWorkspaceId(), eq(conversionSuggestions.id, sug.id)));

      created++;
    }
    return { success: true, actionsCreated: created };
  }),


  // ─── Scoring Progress Query ───
  getScoringProgress: protectedProcedure
    .input(z.object({ taskKey: z.string() }))
    .query(({ input }) => {
      const progress = scoringProgressMap.get(input.taskKey);
      if (!progress) return { status: 'unknown' as const, scored: 0, total: 0, message: '未找到评分任务' };
      return progress;
    }),


  // ─── Image AI Analysis ───
  analyzeProductImages: protectedProcedure
    .input(z.object({
      comparisonId: z.number(),
      asin: z.string(),
      imageUrls: z.array(z.object({
        url: z.string(),
        position: z.enum(["main", "secondary", "aplus", "brand_story"]),
        positionIndex: z.number(),
      })),
      maxImages: z.number().optional().default(10),
    }))
    .mutation(async ({ input }) => {
      const { analyzeImages } = await import('../service');
      const images = input.imageUrls.map(img => ({
        url: img.url,
        position: img.position,
        positionIndex: img.positionIndex,
      }));
      const result = await analyzeImages(images, input.maxImages);
      return result;
    }),
};
