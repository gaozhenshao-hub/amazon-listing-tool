import { failUnavailableDataSource } from "@shared/_core/errors";
import { requireOpsDb } from "../legacy/repository";
import { runOpsSkill } from "../legacy/service";
import { currentOpsWorkspaceId } from "../workspaceContext";
import { opsWorkspaceCondition } from "../../../repositories/ops";
import * as shared from "../routerContext";
import type { CheckItemScore, ConversionCrawlData, ImportResult, ScoringProgress, SellerSpriteProductData } from "../routerContext";
import { buildParentWeeklyOverview } from "../productOverview/parentWeeklyOverview";
import { opsInventoryOwnerAssignments } from "../../../../drizzle/schema/ops";

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

export const opsWeeklyProcedures = {


  // ═══════════════════════════════════════════════════════
  // Product Weekly Ops & Monthly Summary & Basic Info
  // ═══════════════════════════════════════════════════════

  // Get product basic info (售价/平手价/毛利润等)
  getProductBasicInfo: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const [info] = await db!.select().from(productBasicInfo)
        .where(opsWorkspaceCondition(productBasicInfo, currentOpsWorkspaceId(), and(eq(productBasicInfo.productId, input.productId), eq(productBasicInfo.userId, ctx.user.id))));
      return info || null;
    }),


  // Upsert product basic info
  upsertProductBasicInfo: protectedProcedure
    .input(z.object({
      productId: z.number(),
      sellingPrice: z.string().optional(),
      breakEvenPrice: z.string().optional(),
      grossProfit: z.string().optional(),
      grossMargin: z.string().optional(),
      returnRate: z.string().optional(),
      rating: z.string().optional(),
      reviewCount: z.number().optional(),
      productCost: z.string().optional(),
      shippingCost: z.string().optional(),
      fbaFee: z.string().optional(),
      referralFee: z.string().optional(),
      currentStock: z.number().optional(),
      inTransitStock: z.number().optional(),
      packingQty: z.number().optional(),
      weightKg: z.string().optional(),
      shippingUnitPrice: z.string().optional(),
      lastMonthProfit: z.string().optional(),
      trackingSheetUrl: z.string().optional(),
      listingDate: z.string().optional(),
      asin: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const [existing] = await db!.select().from(productBasicInfo)
        .where(opsWorkspaceCondition(productBasicInfo, currentOpsWorkspaceId(), and(eq(productBasicInfo.productId, input.productId), eq(productBasicInfo.userId, ctx.user.id))));
      const { productId, ...data } = input;
      if (existing) {
        await db!.update(productBasicInfo).set(data as any).where(opsWorkspaceCondition(productBasicInfo, currentOpsWorkspaceId(), eq(productBasicInfo.id, existing.id)));
        return { id: existing.id };
      } else {
        const [result] = await db!.insert(productBasicInfo).values({ ...data as any, productId, userId: ctx.user.id });
        return { id: result.insertId };
      }
    }),


  // Get weekly ops data for a product (paginated, sorted by date desc)
  getWeeklyOpsData: protectedProcedure
    .input(z.object({
      productId: z.number(),
      limit: z.number().default(52),
      offset: z.number().default(0),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const rows = await db!.select().from(productWeeklyOps)
        .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(eq(productWeeklyOps.productId, input.productId), eq(productWeeklyOps.userId, ctx.user.id))))
        .orderBy(desc(productWeeklyOps.weekStartDate))
        .limit(input.limit)
        .offset(input.offset);
      return rows;
    }),


  // Upsert a weekly ops record
  upsertWeeklyOps: protectedProcedure
    .input(z.object({
      productId: z.number(),
      weekStartDate: z.string(),
      weekEndDate: z.string(),
      salesTrend: z.enum(["up", "down", "stable"]).optional(),
      salesQty: z.number().optional(),
      orderQty: z.number().optional(),
      salesAmount: z.string().optional(),
      orderProfit: z.string().optional(),
      orderProfitMargin: z.string().optional(),
      sessionTotal: z.number().optional(),
      totalCvr: z.string().optional(),
      adCvr: z.string().optional(),
      organicCvr: z.string().optional(),
      adOrders: z.number().optional(),
      organicOrders: z.number().optional(),
      adClicks: z.number().optional(),
      organicClicks: z.number().optional(),
      ctr: z.string().optional(),
      adImpressions: z.number().optional(),
      cpc: z.string().optional(),
      adSpend: z.string().optional(),
      adSales: z.string().optional(),
      acos: z.string().optional(),
      rating: z.string().optional(),
      reviewCount: z.number().optional(),
      returnRate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const [existing] = await db!.select().from(productWeeklyOps)
        .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(
          eq(productWeeklyOps.productId, input.productId),
          eq(productWeeklyOps.userId, ctx.user.id),
          eq(productWeeklyOps.weekStartDate, input.weekStartDate),
        )));
      const { productId, ...data } = input;
      if (existing) {
        await db!.update(productWeeklyOps).set(data as any).where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), eq(productWeeklyOps.id, existing.id)));
        return { id: existing.id };
      } else {
        const [result] = await db!.insert(productWeeklyOps).values({ ...data as any, productId, userId: ctx.user.id });
        return { id: result.insertId };
      }
    }),


  // Delete a weekly ops record
  deleteWeeklyOps: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      await db!.delete(productWeeklyOps)
        .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(eq(productWeeklyOps.id, input.id), eq(productWeeklyOps.userId, ctx.user.id))));
      return { success: true };
    }),


  // Get monthly summaries for a product
  getMonthlySummaries: protectedProcedure
    .input(z.object({
      productId: z.number(),
      limit: z.number().default(12),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const rows = await db!.select().from(productMonthlySummary)
        .where(opsWorkspaceCondition(productMonthlySummary, currentOpsWorkspaceId(), and(eq(productMonthlySummary.productId, input.productId), eq(productMonthlySummary.userId, ctx.user.id))))
        .orderBy(desc(productMonthlySummary.yearMonth))
        .limit(input.limit);
      return rows;
    }),


  // Upsert a monthly summary
  upsertMonthlySummary: protectedProcedure
    .input(z.object({
      productId: z.number(),
      yearMonth: z.string(),
      financialProfit: z.string().optional(),
      orderProfitTotal: z.string().optional(),
      totalSalesQty: z.number().optional(),
      totalOrderQty: z.number().optional(),
      totalSalesAmount: z.string().optional(),
      totalAdSpend: z.string().optional(),
      avgAcos: z.string().optional(),
      avgRating: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const [existing] = await db!.select().from(productMonthlySummary)
        .where(opsWorkspaceCondition(productMonthlySummary, currentOpsWorkspaceId(), and(
          eq(productMonthlySummary.productId, input.productId),
          eq(productMonthlySummary.userId, ctx.user.id),
          eq(productMonthlySummary.yearMonth, input.yearMonth),
        )));
      const { productId, ...data } = input;
      if (existing) {
        await db!.update(productMonthlySummary).set(data as any).where(opsWorkspaceCondition(productMonthlySummary, currentOpsWorkspaceId(), eq(productMonthlySummary.id, existing.id)));
        return { id: existing.id };
      } else {
        const [result] = await db!.insert(productMonthlySummary).values({ ...data as any, productId, userId: ctx.user.id });
        return { id: result.insertId };
      }
    }),


  // Get weekly ops summary for product list (for product overview page)
  getProductsWeeklySummary: protectedProcedure
    .input(z.object({
      productIds: z.array(z.number()),
    }))
    .query(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      if (input.productIds.length === 0) return [];

      // For each product, get the latest weekly ops record
      const results: Array<{
        productId: number;
        weekStartDate: string | null;
        salesQty: number;
        orderProfit: string;
        acos: string;
        salesAmount: string;
        adSpend: string;
        salesTrend: string;
      }> = [];

      for (const pid of input.productIds) {
        const [latest] = await db!.select().from(productWeeklyOps)
          .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(
            eq(productWeeklyOps.productId, pid),
            eq(productWeeklyOps.userId, ctx.user.id),
          )))
          .orderBy(desc(productWeeklyOps.weekStartDate))
          .limit(1);

        results.push({
          productId: pid,
          weekStartDate: latest?.weekStartDate || null,
          salesQty: latest?.salesQty || 0,
          orderProfit: String(latest?.orderProfit || "0"),
          acos: String(latest?.acos || "0"),
          salesAmount: String(latest?.salesAmount || "0"),
          adSpend: String(latest?.adSpend || "0"),
          salesTrend: latest?.salesTrend || "stable",
        });
      }

      return results;
    }),
  getProductOverviewWithWeeks: protectedProcedure.input(z.object({ marketplace: z.string().default("US"), statusFilter: z.enum(["active","inactive","discontinued","all"]).default("active"), weeks: z.number().int().min(1).max(26).default(4) }).optional()).query(async ({ctx,input}) => {
    const { dataImportRouter } = await import("../../../routers/dataImport");
    return dataImportRouter.createCaller(ctx).getProductOverviewFromImport({sourceType:"saihu", consolidateNorthAmerica:true, marketplace:"US", weeks:input?.weeks ?? 4});
  }),
};
