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

export const opsTodoLogProcedures = {


  // ─── Product Todos ───

  getTodos: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      return db!.select().from(productTodos)
        .where(eq(productTodos.productId, input.productId))
        .orderBy(asc(productTodos.sortOrder), desc(productTodos.createdAt));
    }),


  createTodo: protectedProcedure
    .input(z.object({
      productId: z.number(),
      title: z.string().min(1),
      description: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).optional().default("medium"),
      dueDate: z.string().optional(),
      assignee: z.string().optional(),
      reminderDays: z.string().optional(), // JSON array e.g. "[1,3,7]"
      reminderEnabled: z.number().optional().default(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(productTodos).values({
        productId: input.productId,
        userId: ctx.user.id,
        title: input.title,
        description: input.description,
        priority: input.priority,
        dueDate: input.dueDate,
        assignee: input.assignee,
        reminderDays: input.reminderDays,
        reminderEnabled: input.reminderEnabled,
      });
      return { id: result.insertId };
    }),


  updateTodo: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      description: z.string().optional(),
      priority: z.enum(["high", "medium", "low"]).optional(),
      status: z.enum(["pending", "in_progress", "completed"]).optional(),
      dueDate: z.string().nullable().optional(),
      assignee: z.string().nullable().optional(),
      sortOrder: z.number().optional(),
      reminderDays: z.string().nullable().optional(), // JSON array
      reminderEnabled: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const { id, ...updates } = input;
      const cleanUpdates: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(updates)) {
        if (v !== undefined) cleanUpdates[k] = v;
      }
      if (input.status === "completed") {
        cleanUpdates.completedAt = new Date();
      }
      if (Object.keys(cleanUpdates).length > 0) {
        await db!.update(productTodos).set(cleanUpdates).where(eq(productTodos.id, id));
      }
      return { updated: true };
    }),


  deleteTodo: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db!.delete(productTodos).where(eq(productTodos.id, input.id));
      return { deleted: true };
    }),


  // ─── Product Logs ───

  getLogs: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      return db!.select().from(productLogs)
        .where(eq(productLogs.productId, input.productId))
        .orderBy(desc(productLogs.createdAt));
    }),


  createLog: protectedProcedure
    .input(z.object({
      productId: z.number(),
      content: z.string().min(1),
      logType: z.enum(["operation", "note", "issue", "decision", "milestone"]).optional().default("note"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(productLogs).values({
        productId: input.productId,
        userId: ctx.user.id,
        content: input.content,
        logType: input.logType,
        createdBy: ctx.user.name || "Unknown",
      });
      return { id: result.insertId };
    }),


  deleteLog: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db!.delete(productLogs).where(eq(productLogs.id, input.id));
      return { deleted: true };
    }),
};