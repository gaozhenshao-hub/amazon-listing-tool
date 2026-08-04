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

export const opsTeamTaskProcedures = {


  // ═══════════════════════════════════════════════════════
  // ─── Team Tasks (团队协作看板) ───
  // ═══════════════════════════════════════════════════════

  listTeamTasks: protectedProcedure
    .input(z.object({ productProfileId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      return db!.select().from(teamTasks)
        .where(eq(teamTasks.productProfileId, input.productProfileId))
        .orderBy(asc(teamTasks.sortOrder), desc(teamTasks.createdAt));
    }),


  createTeamTask: protectedProcedure
    .input(z.object({
      productProfileId: z.number(),
      title: z.string().min(1),
      description: z.string().optional(),
      status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional().default("todo"),
      priority: z.enum(["urgent", "high", "medium", "low"]).optional().default("medium"),
      category: z.string().optional(),
      assigneeName: z.string().optional(),
      assigneeId: z.number().optional(),
      startDate: z.string().optional(),
      dueDate: z.string().optional(),
      estimatedHours: z.string().optional(),
      linkedTodoId: z.number().optional(),
      linkedPlanActionId: z.number().optional(),
      tags: z.string().optional(),
      reminderDays: z.string().optional(),
      reminderEnabled: z.number().optional().default(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(teamTasks).values({
        ...input, userId: ctx.user.id,
      });
      return { id: result.insertId };
    }),


  updateTeamTask: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      status: z.enum(["backlog", "todo", "in_progress", "review", "done"]).optional(),
      priority: z.enum(["urgent", "high", "medium", "low"]).optional(),
      category: z.string().optional(),
      assigneeName: z.string().nullable().optional(),
      assigneeId: z.number().nullable().optional(),
      startDate: z.string().nullable().optional(),
      dueDate: z.string().nullable().optional(),
      estimatedHours: z.string().nullable().optional(),
      actualHours: z.string().nullable().optional(),
      sortOrder: z.number().optional(),
      tags: z.string().nullable().optional(),
      reminderDays: z.string().nullable().optional(),
      reminderEnabled: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const { taskId, ...updates } = input;
      const clean: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) clean[k] = v;
      }
      if (input.status === "done") {
        clean.completedAt = new Date();
      }
      if (Object.keys(clean).length > 0) {
        await db!.update(teamTasks).set(clean).where(eq(teamTasks.id, taskId));
      }
      return { updated: true };
    }),


  deleteTeamTask: protectedProcedure
    .input(z.object({ taskId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db!.delete(teamTasks).where(eq(teamTasks.id, input.taskId));
      return { deleted: true };
    }),


  moveTeamTask: protectedProcedure
    .input(z.object({
      taskId: z.number(),
      newStatus: z.enum(["backlog", "todo", "in_progress", "review", "done"]),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const updates: Record<string, unknown> = { status: input.newStatus };
      if (input.newStatus === "done") updates.completedAt = new Date();
      await db!.update(teamTasks).set(updates).where(eq(teamTasks.id, input.taskId));
      return { moved: true };
    }),


  getTeamTaskStats: protectedProcedure
    .input(z.object({ productProfileId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const tasks = await db!.select().from(teamTasks)
        .where(eq(teamTasks.productProfileId, input.productProfileId));

      const byStatus: Record<string, number> = { backlog: 0, todo: 0, in_progress: 0, review: 0, done: 0 };
      const byAssignee: Record<string, { total: number; done: number; inProgress: number }> = {};
      const byCategory: Record<string, number> = {};

      for (const t of tasks) {
        byStatus[t.status] = (byStatus[t.status] || 0) + 1;
        const assignee = t.assigneeName || "未分配";
        if (!byAssignee[assignee]) byAssignee[assignee] = { total: 0, done: 0, inProgress: 0 };
        byAssignee[assignee].total++;
        if (t.status === "done") byAssignee[assignee].done++;
        if (t.status === "in_progress") byAssignee[assignee].inProgress++;
        if (t.category) byCategory[t.category] = (byCategory[t.category] || 0) + 1;
      }

      const overdue = tasks.filter(t => t.dueDate && t.status !== "done" && new Date(t.dueDate) < new Date()).length;

      return { total: tasks.length, byStatus, byAssignee, byCategory, overdue };
    }),
};