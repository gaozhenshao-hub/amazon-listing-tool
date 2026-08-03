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
  invokeLLM,
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
const getDb = (...args: Parameters<typeof shared.getDb>) => shared.getDb(...args);

export const opsPlanProcedures = {

  // ═══════════════════════════════════════════════════════
  // ─── Operations Plan CRUD ───
  // ═══════════════════════════════════════════════════════

  listPlans: protectedProcedure.input(z.object({ productProfileId: z.number(), parentAsin: z.string().optional() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    const { MANAGER_ROLES } = await import("../../../../shared/const");
    const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
    const conditions: any[] = [];
    if (!isManager) {
      conditions.push(eq(opsPlans.userId, ctx.user.id));
    }
    // Prefer parentAsin filter (works for both import and system mode)
    if (input.parentAsin) {
      conditions.push(eq(opsPlans.parentAsin, input.parentAsin));
    } else if (input.productProfileId > 0) {
      conditions.push(eq(opsPlans.productProfileId, input.productProfileId));
    } else {
      // productProfileId=0 and no parentAsin: return empty to prevent cross-product data leak
      return [];
    }
    return db!.select().from(opsPlans)
      .where(and(...conditions))
      .orderBy(desc(opsPlans.updatedAt));
  }),


  getPlan: protectedProcedure.input(z.object({ planId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    const { MANAGER_ROLES } = await import("../../../../shared/const");
    const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
    const conditions = [eq(opsPlans.id, input.planId)];
    if (!isManager) {
      conditions.push(eq(opsPlans.userId, ctx.user.id));
    }
    const [plan] = await db!.select().from(opsPlans).where(and(...conditions));
    if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "Plan not found" });
    return plan;
  }),


  createPlan: protectedProcedure.input(z.object({
    productProfileId: z.number(),
    parentAsin: z.string().min(1, "父ASIN不能为空"),
    planName: z.string().min(1),
    planPeriod: z.string().optional(),
    projectManager: z.string().optional(),
    projectMembers: z.string().optional(),
    gamePlanner: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const [result] = await db!.insert(opsPlans).values({
      userId: ctx.user.id,
      productProfileId: input.productProfileId,
      parentAsin: input.parentAsin || null,
      planName: input.planName,
      planPeriod: input.planPeriod || null,
      projectManager: input.projectManager || null,
      projectMembers: input.projectMembers || null,
      gamePlanner: input.gamePlanner || null,
    });
    return { id: result.insertId };
  }),


  updatePlan: protectedProcedure.input(z.object({
    planId: z.number(),
    planName: z.string().optional(),
    planPeriod: z.string().optional(),
    projectManager: z.string().optional(),
    projectMembers: z.string().optional(),
    gamePlanner: z.string().optional(),
    status: z.enum(["draft", "active", "completed", "archived"]).optional(),
    // 基期数据 (周维度)
    baselineWeekLabel: z.string().optional(),
    baselineSales: z.string().optional(),
    baselineSubcategoryRank: z.number().optional(),
    baselineProfitRate: z.string().optional(),
    baselineConvRate: z.string().optional(),
    baselineOrganicOrders: z.number().optional(),
    baselineAdOrders: z.number().optional(),
    baselineRatingScore: z.string().optional(),
    baselineRatingCount: z.number().optional(),
    // 当期数据 (周维度)
    currentWeekLabel: z.string().optional(),
    currentSales: z.string().optional(),
    currentSubcategoryRank: z.number().optional(),
    currentProfitRate: z.string().optional(),
    currentConvRate: z.string().optional(),
    currentOrganicOrders: z.number().optional(),
    currentAdOrders: z.number().optional(),
    currentRatingScore: z.string().optional(),
    currentRatingCount: z.number().optional(),
    // 目标数据
    targetSales: z.string().optional(),
    targetSubcategoryRank: z.number().optional(),
    targetProfitRate: z.string().optional(),
    targetConvRate: z.string().optional(),
    targetOrganicOrders: z.number().optional(),
    targetAdOrders: z.number().optional(),
    targetRatingScore: z.string().optional(),
    targetRatingCount: z.number().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const { planId, ...updates } = input;
    const cleanUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) cleanUpdates[k] = v;
    }
    const { MANAGER_ROLES } = await import("../../../../shared/const");
    const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
    const updateConditions = [eq(opsPlans.id, planId)];
    if (!isManager) updateConditions.push(eq(opsPlans.userId, ctx.user.id));
    await db!.update(opsPlans).set(cleanUpdates).where(and(...updateConditions));
    return { success: true };
  }),


  deletePlan: protectedProcedure.input(z.object({ planId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const { MANAGER_ROLES } = await import("../../../../shared/const");
    const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
    await db!.delete(opsPlanActions).where(eq(opsPlanActions.planId, input.planId));
    await db!.delete(opsPlanSummaries).where(eq(opsPlanSummaries.planId, input.planId));
    const delConditions = [eq(opsPlans.id, input.planId)];
    if (!isManager) delConditions.push(eq(opsPlans.userId, ctx.user.id));
    await db!.delete(opsPlans).where(and(...delConditions));
    return { success: true };
  }),


  // ─── Plan Actions CRUD (with todo linkage) ───

  listPlanActions: protectedProcedure.input(z.object({ planId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    const actions = await db!.select().from(opsPlanActions)
      .where(eq(opsPlanActions.planId, input.planId))
      .orderBy(asc(opsPlanActions.sortOrder));
    // Enrich with linked todo status
    const enriched = await Promise.all(actions.map(async (a) => {
      let todoStatus = null;
      if (a.linkedTodoId) {
        const [todo] = await db!.select().from(productTodos).where(eq(productTodos.id, a.linkedTodoId));
        todoStatus = todo?.status || null;
      }
      return { ...a, todoStatus };
    }));
    return enriched;
  }),


  createPlanAction: protectedProcedure.input(z.object({
    planId: z.number(),
    dimension: z.string().min(1),
    currentStatus: z.string().optional(),
    targetAction: z.string().optional(),
    priority: z.enum(["high", "medium", "low"]).optional(),
    plannedDate: z.string().optional(),
    assignee: z.string().optional(),
    autoCreateTodo: z.boolean().optional(),
    productProfileId: z.number().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    let linkedTodoId: number | null = null;

    // Auto-create linked todo if requested
    if (input.autoCreateTodo && input.productProfileId) {
      const todoTitle = `[运营计划] ${input.dimension}${input.targetAction ? " - " + input.targetAction : ""}`;
      const priorityMap: Record<string, string> = { high: "high", medium: "medium", low: "low" };
      const [todoResult] = await db!.insert(productTodos).values({
        productId: input.productProfileId,
        userId: ctx.user.id,
        title: todoTitle,
        priority: (priorityMap[input.priority || "medium"] || "medium") as any,
        dueDate: input.plannedDate || null,
        status: "pending" as any,
      });
      linkedTodoId = todoResult.insertId;
    }

    const [result] = await db!.insert(opsPlanActions).values({
      planId: input.planId,
      userId: ctx.user.id,
      dimension: input.dimension,
      currentStatus: input.currentStatus || null,
      targetAction: input.targetAction || null,
      priority: (input.priority || "medium") as any,
      plannedDate: input.plannedDate || null,
      assignee: input.assignee || null,
      linkedTodoId,
    });
    return { id: result.insertId, linkedTodoId };
  }),


  updatePlanAction: protectedProcedure.input(z.object({
    actionId: z.number(),
    dimension: z.string().optional(),
    currentStatus: z.string().optional(),
    targetAction: z.string().optional(),
    priority: z.enum(["high", "medium", "low"]).optional(),
    plannedDate: z.string().optional(),
    assignee: z.string().optional(),
    status: z.enum(["not_started", "in_progress", "completed", "delayed"]).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const { actionId, ...updates } = input;
    const cleanUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) cleanUpdates[k] = v;
    }
    await db!.update(opsPlanActions).set(cleanUpdates).where(eq(opsPlanActions.id, actionId));

    // Sync status to linked todo
    if (input.status) {
      const [action] = await db!.select().from(opsPlanActions).where(eq(opsPlanActions.id, actionId));
      if (action?.linkedTodoId) {
        const todoStatusMap: Record<string, string> = {
          not_started: "pending", in_progress: "in_progress", completed: "completed", delayed: "pending"
        };
        await db!.update(productTodos).set({ status: todoStatusMap[input.status] as any })
          .where(eq(productTodos.id, action.linkedTodoId));
      }
    }
    return { success: true };
  }),


  deletePlanAction: protectedProcedure.input(z.object({ actionId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    await db!.delete(opsPlanActions).where(eq(opsPlanActions.id, input.actionId));
    return { success: true };
  }),


  // ─── Plan Summaries CRUD ───

  listPlanSummaries: protectedProcedure.input(z.object({ planId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    return db!.select().from(opsPlanSummaries)
      .where(eq(opsPlanSummaries.planId, input.planId))
      .orderBy(desc(opsPlanSummaries.createdAt));
  }),


  createPlanSummary: protectedProcedure.input(z.object({
    planId: z.number(),
    period: z.string().optional(),
    achievementSummary: z.string().optional(),
    plannerFeedback: z.string().optional(),
    rating: z.enum(["excellent", "good", "needs_improvement"]).optional(),
    actualIndustryConvRate: z.string().optional(),
    actualSearchConvRate: z.string().optional(),
    actualOrderConvRate: z.string().optional(),
    actualAdConvRate: z.string().optional(),
    actualSales: z.string().optional(),
    actualProfit: z.string().optional(),
    actualProfitRate: z.string().optional(),
    actualRanking: z.number().optional(),
    actualRating: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const [result] = await db!.insert(opsPlanSummaries).values({
      planId: input.planId,
      userId: ctx.user.id,
      period: input.period || null,
      achievementSummary: input.achievementSummary || null,
      plannerFeedback: input.plannerFeedback || null,
      rating: (input.rating || null) as any,
      actualIndustryConvRate: input.actualIndustryConvRate || null,
      actualSearchConvRate: input.actualSearchConvRate || null,
      actualOrderConvRate: input.actualOrderConvRate || null,
      actualAdConvRate: input.actualAdConvRate || null,
      actualSales: input.actualSales || null,
      actualProfit: input.actualProfit || null,
      actualProfitRate: input.actualProfitRate || null,
      actualRanking: input.actualRanking || null,
      actualRating: input.actualRating || null,
    });
    return { id: result.insertId };
  }),


  updatePlanSummary: protectedProcedure.input(z.object({
    summaryId: z.number(),
    achievementSummary: z.string().optional(),
    plannerFeedback: z.string().optional(),
    rating: z.enum(["excellent", "good", "needs_improvement"]).optional(),
    actualIndustryConvRate: z.string().optional(),
    actualSearchConvRate: z.string().optional(),
    actualOrderConvRate: z.string().optional(),
    actualAdConvRate: z.string().optional(),
    actualSales: z.string().optional(),
    actualProfit: z.string().optional(),
    actualProfitRate: z.string().optional(),
    actualRanking: z.number().optional(),
    actualRating: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const { summaryId, ...updates } = input;
    const cleanUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) cleanUpdates[k] = v;
    }
    await db!.update(opsPlanSummaries).set(cleanUpdates).where(eq(opsPlanSummaries.id, summaryId));
    return { success: true };
  }),


  // ─── 获取当期数据（从已导入的周度数据中查询，支持多周聚合） ───
  syncPlanCurrentData: protectedProcedure
    .input(z.object({
      planId: z.number(),
      parentAsin: z.string(),
      weekCount: z.number().default(1), // 1=最近1周, 2=最近2周, 4=最近4周(约1个月)
    }))
      .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [plan] = await db!.select().from(opsPlans).where(eq(opsPlans.id, input.planId));
      if (!plan) throw new TRPCError({ code: 'NOT_FOUND', message: '计划不存在' });
      // Use resolveDataUserId to handle non-admin users querying admin-imported data
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      // 从已导入的lingxing_product_weekly表中查询该产品的周度数据
      const weeklyRows = await db!.select().from(lingxingProductWeekly)
        .where(and(
          eq(lingxingProductWeekly.userId, effectiveUserId),
          eq(lingxingProductWeekly.parentAsin, input.parentAsin),
        ))
        .orderBy(desc(lingxingProductWeekly.weekStartDate));

      // 按周分组（去重）
      const weekMap = new Map<string, typeof weeklyRows>();
      for (const row of weeklyRows) {
        const key = `${row.weekStartDate}_${row.weekEndDate}`;
        if (!weekMap.has(key)) weekMap.set(key, []);
        weekMap.get(key)!.push(row);
      }
      const sortedWeeks = Array.from(weekMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

      if (sortedWeeks.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '暂无已导入的周度数据，请先在数据导入中心导入数据' });
      }

      // 取最近N周的数据进行聚合
      const weeksToAggregate = Math.min(input.weekCount, sortedWeeks.length);
      const selectedWeeks = sortedWeeks.slice(0, weeksToAggregate);

      // 格式化周标签
      const lastWeek = selectedWeeks[selectedWeeks.length - 1];
      const firstWeek = selectedWeeks[0];
      const [, lastEnd] = firstWeek[0].split('_');
      const [lastStart] = lastWeek[0].split('_');
      const s = new Date(lastStart + 'T00:00:00');
      const e = new Date(lastEnd + 'T00:00:00');
      const weekLabel = weeksToAggregate === 1
        ? `${(s.getMonth()+1).toString().padStart(2,'0')}/${s.getDate().toString().padStart(2,'0')}-${(e.getMonth()+1).toString().padStart(2,'0')}/${e.getDate().toString().padStart(2,'0')}`
        : `${(s.getMonth()+1).toString().padStart(2,'0')}/${s.getDate().toString().padStart(2,'0')}-${(e.getMonth()+1).toString().padStart(2,'0')}/${e.getDate().toString().padStart(2,'0')} (${weeksToAggregate}周)`;

      // 聚合多周数据
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
          // 使用最新一周的排名/评分
          if (!subcategoryRank && row.bsrSub) subcategoryRank = row.bsrSub;
          if (ratingScore === '0' && row.rating) ratingScore = row.rating;
          if (ratingCount === 0 && row.reviewCount) ratingCount = Number(row.reviewCount);
          if (row.orderProfitMargin) { profitMarginSum += Number(row.orderProfitMargin); profitMarginCount++; }
          if (row.cvr) { convRateSum += Number(row.cvr); convRateCount++; }
        }
      }

      // 利润率和转化率取平均值
      const avgProfitMargin = profitMarginCount > 0 ? profitMarginSum / profitMarginCount : 0;
      const avgConvRate = convRateCount > 0 ? convRateSum / convRateCount : 0;

      // 解析小类排名
      let rankNum: number | null = null;
      if (subcategoryRank) {
        const match = subcategoryRank.match(/(\d+)/);
        if (match) rankNum = parseInt(match[1]);
      }

      const currentData = {
        currentWeekLabel: weekLabel,
        currentSales: String(round2(totalSales)),
        currentSubcategoryRank: rankNum,
        currentProfitRate: String(round2(avgProfitMargin)),
        currentConvRate: String(round2(avgConvRate)),
        currentOrganicOrders: organicOrders,
        currentAdOrders: adOrders,
        currentRatingScore: ratingScore,
        currentRatingCount: ratingCount,
      };

      // Update the plan with current data
      await db!.update(opsPlans).set({
        currentWeekLabel: currentData.currentWeekLabel,
        currentSales: currentData.currentSales,
        currentSubcategoryRank: currentData.currentSubcategoryRank,
        currentProfitRate: currentData.currentProfitRate,
        currentConvRate: currentData.currentConvRate,
        currentOrganicOrders: currentData.currentOrganicOrders,
        currentAdOrders: currentData.currentAdOrders,
        currentRatingScore: currentData.currentRatingScore,
        currentRatingCount: currentData.currentRatingCount,
        updatedAt: new Date(),
      }).where(eq(opsPlans.id, input.planId));

      // 返回可用周列表供前端下拉选择
      const availableWeeks = sortedWeeks.map(([key], idx) => {
        const [ws, we] = key.split('_');
        const sd = new Date(ws + 'T00:00:00');
        const ed = new Date(we + 'T00:00:00');
        return {
          index: idx,
          label: `${(sd.getMonth()+1).toString().padStart(2,'0')}/${sd.getDate().toString().padStart(2,'0')}-${(ed.getMonth()+1).toString().padStart(2,'0')}/${ed.getDate().toString().padStart(2,'0')}`,
          weekStart: ws,
          weekEnd: we,
        };
      });

      return { synced: true, data: currentData, weekLabel, availableWeeks, totalWeeks: sortedWeeks.length };
    }),


  // ─── 基期数据：按多选周度自动聚合加载 ───
  syncPlanBaselineData: protectedProcedure
    .input(z.object({
      planId: z.number(),
      parentAsin: z.string(),
      weekIndices: z.array(z.number()).min(1), // 选中的周度索引（0=最近一周，1=上上周...）
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [plan] = await db!.select().from(opsPlans).where(eq(opsPlans.id, input.planId));
      if (!plan) throw new TRPCError({ code: 'NOT_FOUND', message: '计划不存在' });
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      // 查询该产品所有周度数据
      const weeklyRows = await db!.select().from(lingxingProductWeekly)
        .where(and(
          eq(lingxingProductWeekly.userId, effectiveUserId),
          eq(lingxingProductWeekly.parentAsin, input.parentAsin),
        ))
        .orderBy(desc(lingxingProductWeekly.weekStartDate));

      // 按周分组
      const weekMap = new Map<string, typeof weeklyRows>();
      for (const row of weeklyRows) {
        const key = `${row.weekStartDate}_${row.weekEndDate}`;
        if (!weekMap.has(key)) weekMap.set(key, []);
        weekMap.get(key)!.push(row);
      }
      const sortedWeeks = Array.from(weekMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));

      if (sortedWeeks.length === 0) {
        throw new TRPCError({ code: 'NOT_FOUND', message: '暂无已导入的周度数据，请先在数据导入中心导入数据' });
      }

      // 根据选中的索引获取对应周度
      const selectedWeeks = input.weekIndices
        .filter(i => i >= 0 && i < sortedWeeks.length)
        .sort((a, b) => a - b)
        .map(i => sortedWeeks[i]);

      if (selectedWeeks.length === 0) {
        throw new TRPCError({ code: 'BAD_REQUEST', message: '所选周度不存在' });
      }

      // 生成周标签（多选时显示范围）
      const lastWeek = selectedWeeks[selectedWeeks.length - 1];
      const firstWeek = selectedWeeks[0];
      const fmtDate = (d: string) => {
        const dt = new Date(d + 'T00:00:00');
        return `${(dt.getMonth()+1).toString().padStart(2,'0')}/${dt.getDate().toString().padStart(2,'0')}`;
      };
      const labels = selectedWeeks.map(([key]) => {
        const [ws, we] = key.split('_');
        return `${fmtDate(ws)}-${fmtDate(we)}`;
      });
      const weekLabel = labels.length <= 2 ? labels.join(', ') : `${labels[labels.length - 1]}~${labels[0]} (${labels.length}周)`;

      // 聚合多周数据
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

      const baselineData = {
        baselineWeekLabel: weekLabel,
        baselineSales: String(round2(totalSales)),
        baselineSubcategoryRank: rankNum,
        baselineProfitRate: String(round2(avgProfitMargin)),
        baselineConvRate: String(round2(avgConvRate)),
        baselineOrganicOrders: organicOrders,
        baselineAdOrders: adOrders,
        baselineRatingScore: ratingScore,
        baselineRatingCount: ratingCount,
      };

      await db!.update(opsPlans).set({
        ...baselineData,
        updatedAt: new Date(),
      }).where(eq(opsPlans.id, input.planId));

      return { synced: true, data: baselineData, weekLabel };
    }),


  // ─── 获取可用周列表（不更新数据，仅查询） ───
  getAvailableWeeks: protectedProcedure
    .input(z.object({
      parentAsin: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      // Use resolveDataUserId to handle non-admin users querying admin-imported data
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);
      const weeklyRows = await db!.selectDistinct({
        weekStartDate: lingxingProductWeekly.weekStartDate,
        weekEndDate: lingxingProductWeekly.weekEndDate,
      })
        .from(lingxingProductWeekly)
        .where(and(
          eq(lingxingProductWeekly.userId, effectiveUserId),
          eq(lingxingProductWeekly.parentAsin, input.parentAsin),
        ))
        .orderBy(desc(lingxingProductWeekly.weekStartDate));

      return weeklyRows.map((w, idx) => {
        const sd = new Date(w.weekStartDate + 'T00:00:00');
        const ed = new Date(w.weekEndDate + 'T00:00:00');
        return {
          index: idx,
          label: `${(sd.getMonth()+1).toString().padStart(2,'0')}/${sd.getDate().toString().padStart(2,'0')}-${(ed.getMonth()+1).toString().padStart(2,'0')}/${ed.getDate().toString().padStart(2,'0')}`,
          weekStart: w.weekStartDate,
          weekEnd: w.weekEndDate,
        };
      });
    }),
};