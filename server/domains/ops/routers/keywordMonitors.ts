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

export const opsKeywordMonitorProcedures = {


  // ─── Keyword Monitors ───

  getKeywordMonitors: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      const monitors = await db!.select().from(keywordMonitors)
        .where(eq(keywordMonitors.productId, input.productId))
        .orderBy(desc(keywordMonitors.createdAt));

      // Get latest snapshot for each monitor
      const enriched = await Promise.all(monitors.map(async (m) => {
        const snapshots = await db!.select().from(keywordSnapshots)
          .where(eq(keywordSnapshots.keywordMonitorId, m.id))
          .orderBy(desc(keywordSnapshots.snapshotDate))
          .limit(7);
        return { ...m, recentSnapshots: snapshots.reverse() };
      }));
      return enriched;
    }),


  addKeywordMonitor: protectedProcedure
    .input(z.object({
      productId: z.number(),
      keyword: z.string().min(1),
      keywordCn: z.string().optional(),
      targetAsin: z.string().optional(),
      marketplace: z.string().optional().default("US"),
      matchType: z.enum(["exact", "phrase", "broad"]).optional().default("exact"),
      monitorFrequency: z.enum(["daily", "weekly", "manual"]).optional().default("daily"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(keywordMonitors).values({
        productId: input.productId,
        userId: ctx.user.id,
        keyword: input.keyword,
        keywordCn: input.keywordCn,
        targetAsin: input.targetAsin,
        marketplace: input.marketplace,
        matchType: input.matchType,
        monitorFrequency: input.monitorFrequency,
      });
      return { id: result.insertId };
    }),


  removeKeywordMonitor: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db!.delete(keywordSnapshots).where(eq(keywordSnapshots.keywordMonitorId, input.id));
      await db!.delete(keywordMonitors).where(eq(keywordMonitors.id, input.id));
      return { deleted: true };
    }),


  addKeywordSnapshot: protectedProcedure
    .input(z.object({
      keywordMonitorId: z.number(),
      snapshotDate: z.string(),
      organicRank: z.number().nullable().optional(),
      adRank: z.number().nullable().optional(),
      searchVolume: z.number().nullable().optional(),
      pageNumber: z.number().nullable().optional(),
      totalResults: z.number().nullable().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [result] = await db!.insert(keywordSnapshots).values({
        keywordMonitorId: input.keywordMonitorId,
        snapshotDate: input.snapshotDate,
        organicRank: input.organicRank,
        adRank: input.adRank,
        searchVolume: input.searchVolume,
        pageNumber: input.pageNumber,
        totalResults: input.totalResults,
      });
      return { id: result.insertId };
    }),
};