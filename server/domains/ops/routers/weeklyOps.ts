import { failUnavailableDataSource } from "@shared/_core/errors";
import { requireOpsDb } from "../legacy/repository";
import { runOpsSkill } from "../legacy/service";
import { currentOpsWorkspaceId } from "../workspaceContext";
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


  // ─── Sync weekly ops from Lingxing asinList API (unified data source) ───
  syncWeeklyOpsFromLingxing: protectedProcedure
    .input(z.object({
      productId: z.number(),
      months: z.number().default(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const [product] = await db!.select().from(productProfiles)
        .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(eq(productProfiles.id, input.productId), eq(productProfiles.userId, ctx.user.id))));
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });
      const parentAsin = product.parentAsin;

      // Get matched SID and MID for this product
      const { matchedSid, matchedMid, sellers } = await findMatchedSid(null as any, product);
      // Collect all SIDs for the same marketplace
      const marketplaceMids = MARKETPLACE_MID_MAP[product.marketplace || 'US'] || [1];
      const allSids = sellers
        .filter((s: any) => marketplaceMids.includes(s.mid))
        .map((s: any) => s.sid);
      const sidArray = allSids.length > 0 ? allSids : [matchedSid];

      console.log(`[syncWeeklyOps] Product ${parentAsin}, mid=${matchedMid}, sids=${JSON.stringify(sidArray)}`);

      // Calculate date range - split into weekly chunks for weekly granularity
      const now = new Date();
      const globalStart = new Date(now.getTime() - input.months * 30 * 86400000);

      // Helper: get Monday of a date
      const getWeekMonday = (dateStr: string): string => {
        const d = new Date(dateStr);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(d.setDate(diff)).toISOString().split('T')[0];
      };

      // Generate weekly date ranges
      const weekRanges: Array<{ start: string; end: string }> = [];
      let cur = new Date(globalStart);
      // Align to Monday
      const curDay = cur.getDay();
      const mondayDiff = curDay === 0 ? -6 : 1 - curDay;
      cur.setDate(cur.getDate() + mondayDiff);

      while (cur < now) {
        const weekEnd = new Date(cur.getTime() + 6 * 86400000);
        weekRanges.push({
          start: cur.toISOString().split('T')[0],
          end: weekEnd.toISOString().split('T')[0],
        });
        cur = new Date(cur.getTime() + 7 * 86400000);
      }

      // Fetch data from asinList API for each week
      let synced = 0;
      let totalItemCount = 0;
      let operatorName = '';
      let productNameFromApi = '';

      for (const week of weekRanges) {
        try {
          // Fetch all products for this store/week, then match by parent_asin in code
          // (search_field/search_value doesn't work reliably for parent_asin searches)
          let allItems: any[] = [];
          let offset = 0;
          const pageSize = 100;
          while (true) {
            const res = failUnavailableDataSource();
            const raw = res.data || [];
            const pageItems = Array.isArray(raw) ? raw : (raw as any).records || (raw as any).list || [];
            allItems.push(...pageItems);
            const total = (raw as any).total || 0;
            if (offset + pageSize >= total || pageItems.length === 0) break;
            offset += pageSize;
            // Rate limit delay between pages
            await new Promise(r => setTimeout(r, 2000));
          }

          // Filter to match our target parent ASIN
          const items = allItems.filter(item => {
            const itemParentAsin = item.parent_asins?.[0]?.parent_asin || '';
            return itemParentAsin.toUpperCase() === parentAsin.toUpperCase();
          });
          if (items.length === 0) continue;
          totalItemCount += items.length;

          // Aggregate all items for this week (may have multiple child ASINs)
          let totalSales = 0, totalOrders = 0, totalRevenue = 0, totalProfit = 0;
          let totalAdSpend = 0, totalAdSales = 0, totalAdOrders = 0;
          let totalImpressions = 0, totalClicks = 0;
          let totalSessions = 0, totalReturnRate = 0, returnCount = 0;
          let latestRating = 0, latestReviewCount = 0;

          for (const item of items) {
            totalSales += Number(item.volume || 0);
            totalOrders += Number(item.order_items || 0);
            totalRevenue += Number(item.amount || 0);
            totalProfit += Number(item.gross_profit || 0);
            totalAdSpend += Number(item.spend || 0);
            totalAdSales += Number(item.ad_sales_amount || 0);
            totalAdOrders += Number(item.ad_order_quantity || 0);
            totalImpressions += Number(item.impressions || 0);
            totalClicks += Number(item.clicks || 0);
            totalSessions += Number(item.sessions_total || 0);
            if (item.return_rate != null && Number(item.return_rate) > 0) {
              totalReturnRate += Number(item.return_rate);
              returnCount++;
            }
            // Take the latest rating/review
            if (Number(item.avg_star || 0) > 0) latestRating = Number(item.avg_star);
            if (Number(item.reviews_count || 0) > 0) latestReviewCount = Number(item.reviews_count);
            // Capture operator name
            if (item.principal_names && !operatorName) {
              operatorName = Array.isArray(item.principal_names) ? item.principal_names.join(', ') : String(item.principal_names);
            }
            // Capture product name (品名) - field is item_name in asinList API
            if ((item.item_name || item.local_name) && !productNameFromApi) {
              productNameFromApi = String(item.local_name || item.item_name);
            }
          }

          const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
          // ACOS = ad spend / ad sales (NOT total sales)
          const acos = totalAdSales > 0 ? (totalAdSpend / totalAdSales * 100) : 0;
          const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) : 0;
          const cpc = totalClicks > 0 ? (totalAdSpend / totalClicks) : 0;
          const adCvr = totalClicks > 0 ? (totalAdOrders / totalClicks * 100) : 0;
          const totalCvr = totalSessions > 0 ? (totalOrders / totalSessions * 100) : 0;
          const organicOrders = Math.max(0, totalOrders - totalAdOrders);
          const organicClicks = Math.max(0, totalSessions - totalClicks);
          const organicCvr = organicClicks > 0 ? (organicOrders / organicClicks * 100) : 0;
          const avgReturnRate = returnCount > 0 ? (totalReturnRate / returnCount) : 0;

          // Determine trend by comparing with previous week
          const prevWeekStart = new Date(new Date(week.start).getTime() - 7 * 86400000).toISOString().split('T')[0];
          const [prevRecord] = await db!.select().from(productWeeklyOps)
            .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(
              eq(productWeeklyOps.productId, input.productId),
              eq(productWeeklyOps.userId, ctx.user.id),
              eq(productWeeklyOps.weekStartDate, prevWeekStart),
            )));
          const prevSales = prevRecord?.salesQty || 0;
          const trend = totalSales > prevSales ? 'up' : totalSales < prevSales ? 'down' : 'stable';

          // Upsert
          const [existing] = await db!.select().from(productWeeklyOps)
            .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(
              eq(productWeeklyOps.productId, input.productId),
              eq(productWeeklyOps.userId, ctx.user.id),
              eq(productWeeklyOps.weekStartDate, week.start),
            )));

          const record = {
            salesTrend: trend as any,
            salesQty: totalSales,
            orderQty: totalOrders,
            salesAmount: totalRevenue.toFixed(2),
            orderProfit: totalProfit.toFixed(2),
            orderProfitMargin: profitMargin.toFixed(2),
            sessionTotal: totalSessions,
            totalCvr: totalCvr.toFixed(2),
            adCvr: adCvr.toFixed(2),
            organicCvr: organicCvr.toFixed(2),
            adOrders: totalAdOrders,
            organicOrders,
            adClicks: totalClicks,
            organicClicks,
            ctr: ctr.toFixed(4),
            adImpressions: totalImpressions,
            cpc: cpc.toFixed(2),
            adSpend: totalAdSpend.toFixed(2),
            adSales: totalAdSales.toFixed(2),
            acos: acos.toFixed(2),
            rating: latestRating.toFixed(1),
            reviewCount: latestReviewCount,
            returnRate: avgReturnRate.toFixed(2),
          };

          if (existing) {
            await db!.update(productWeeklyOps).set(record as any).where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), eq(productWeeklyOps.id, existing.id)));
          } else {
            await db!.insert(productWeeklyOps).values({
              ...record as any,
              productId: input.productId,
              userId: ctx.user.id,
              weekStartDate: week.start,
              weekEndDate: week.end,
            });
          }
          synced++;
        } catch (err: any) {
          console.warn(`[syncWeeklyOps] Week ${week.start}~${week.end} error: ${err.message}`);
        }
        // Rate limit: wait 1.5s between requests to avoid 103 error
        await new Promise(resolve => setTimeout(resolve, 1500));
      }

      // ── Update operator (principal_names) and product name on product profile ──
      const profileUpdates: Record<string, string> = {};
      if (operatorName && !product.operator) {
        profileUpdates.operator = operatorName;
      }
      if (productNameFromApi && !product.chineseName) {
        profileUpdates.chineseName = productNameFromApi;
      }
      if (Object.keys(profileUpdates).length > 0) {
        await db!.update(productProfiles)
          .set(profileUpdates as any)
          .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), eq(productProfiles.id, input.productId)));
      }

      // ── Auto-generate monthly summaries from weekly data ──
      const monthMap = new Map<string, { profit: number; orders: number; revenue: number; adSpend: number; adSales: number }>();
      const allWeeklyData = await db!.select().from(productWeeklyOps)
        .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(
          eq(productWeeklyOps.productId, input.productId),
          eq(productWeeklyOps.userId, ctx.user.id),
        )));
      for (const w of allWeeklyData) {
        const ym = w.weekStartDate.substring(0, 7);
        if (!monthMap.has(ym)) monthMap.set(ym, { profit: 0, orders: 0, revenue: 0, adSpend: 0, adSales: 0 });
        const m = monthMap.get(ym)!;
        m.orders += w.salesQty || 0;
        m.revenue += Number(w.salesAmount || 0);
        m.profit += Number(w.orderProfit || 0);
        m.adSpend += Number(w.adSpend || 0);
        m.adSales += Number(w.adSales || 0);
      }

      for (const [ym, data] of Array.from(monthMap.entries())) {
        const [existing] = await db!.select().from(productMonthlySummary)
          .where(opsWorkspaceCondition(productMonthlySummary, currentOpsWorkspaceId(), and(
            eq(productMonthlySummary.productId, input.productId),
            eq(productMonthlySummary.userId, ctx.user.id),
            eq(productMonthlySummary.yearMonth, ym),
          )));
        const record = {
          financialProfit: data.profit.toFixed(2),
          orderProfitTotal: data.profit.toFixed(2),
          totalSalesQty: data.orders,
          totalOrderQty: data.orders,
          totalSalesAmount: data.revenue.toFixed(2),
          totalAdSpend: data.adSpend.toFixed(2),
          avgAcos: data.adSales > 0 ? (data.adSpend / data.adSales * 100).toFixed(2) : '0',
          avgRating: '0',
        };
        if (existing) {
          await db!.update(productMonthlySummary).set(record as any).where(opsWorkspaceCondition(productMonthlySummary, currentOpsWorkspaceId(), eq(productMonthlySummary.id, existing.id)));
        } else {
          await db!.insert(productMonthlySummary).values({
            ...record as any,
            productId: input.productId,
            userId: ctx.user.id,
            yearMonth: ym,
          });
        }
      }

      return { syncedWeeks: synced, syncedMonths: monthMap.size, totalItemCount, dataSource: 'asinList' };
    }),


  // Auto-fill product basic info from Lingxing profit API
  autoFillBasicInfo: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const [product] = await db!.select().from(productProfiles)
        .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(eq(productProfiles.id, input.productId), eq(productProfiles.userId, ctx.user.id))));
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });
      const variants = await db!.select().from(productVariants)
        .where(opsWorkspaceCondition(productVariants, currentOpsWorkspaceId(), eq(productVariants.productId, input.productId)));
      const childAsins = variants.map(v => v.childAsin).filter(Boolean);
      const parentAsin = product.parentAsin;

      // Fetch 30-day profit data to compute averages
      let profitItems: any[] = [];
      try {
        const res = failUnavailableDataSource();
        const raw = res.data || [];
        profitItems = Array.isArray(raw) ? raw : (raw as any).records || (raw as any).list || [];
      } catch (err: any) {
        console.warn(`[autoFillBasicInfo] Profit fetch error: ${err.message}`);
      }

      // If no data from ASIN API, try parent ASIN
      if (profitItems.length === 0 && parentAsin) {
        try {
          const parentRes = failUnavailableDataSource();
          const raw = parentRes.data || [];
          profitItems = Array.isArray(raw) ? raw : (raw as any).records || (raw as any).list || [];
        } catch (err: any) {
          console.warn(`[autoFillBasicInfo] Parent ASIN fetch error: ${err.message}`);
        }
      }

      if (profitItems.length === 0) {
        return { filled: false, reason: "no_data" };
      }

      // Aggregate profit data
      let totalRevenue = 0, totalCost = 0, totalProfit = 0, totalUnits = 0;
      let totalFbaFee = 0, totalReferralFee = 0, totalShipping = 0;
      for (const item of profitItems) {
        totalRevenue += Number(item.totalSalesAmount || item.totalFbaAndFbmAmount || 0);
        totalCost += Math.abs(Number(item.cgPriceTotal || item.cgPriceAbsTotal || 0));
        totalProfit += Number(item.grossProfit || 0);
        totalUnits += Number(item.totalSalesQuantity || item.totalFbaAndFbmQuantity || 0);
        totalFbaFee += Math.abs(Number(item.totalFbaDeliveryFee || item.fbaDeliveryFee || 0));
        totalReferralFee += Math.abs(Number(item.platformExpense || item.platformFee || 0));
        totalShipping += Math.abs(Number(item.cgTransportCostsTotal || 0));
      }

      // Calculate per-unit metrics
      const avgPrice = totalUnits > 0 ? (totalRevenue / totalUnits) : 0;
      const avgCost = totalUnits > 0 ? (totalCost / totalUnits) : 0;
      const avgFba = totalUnits > 0 ? (totalFbaFee / totalUnits) : 0;
      const avgReferral = totalUnits > 0 ? (totalReferralFee / totalUnits) : 0;
      const avgShipping = totalUnits > 0 ? (totalShipping / totalUnits) : 0;
      const avgProfit = totalUnits > 0 ? (totalProfit / totalUnits) : 0;
      const grossMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
      // Break-even price = cost + fba + referral + shipping (per unit)
      const breakEven = avgCost + avgFba + avgReferral + avgShipping;

      // Get variant price as selling price
      const variantPrice = variants.length > 0 ? Number(variants[0].price || 0) : 0;
      const sellingPrice = variantPrice > 0 ? variantPrice : avgPrice;

      // Upsert basic info
      const data = {
        sellingPrice: sellingPrice.toFixed(2),
        breakEvenPrice: breakEven.toFixed(2),
        grossProfit: avgProfit.toFixed(2),
        grossMargin: grossMargin.toFixed(2),
        productCost: avgCost.toFixed(2),
        shippingCost: avgShipping.toFixed(2),
        fbaFee: avgFba.toFixed(2),
        referralFee: avgReferral.toFixed(2),
        asin: childAsins[0] || parentAsin || "",
        listingDate: "",
      };

      const [existing] = await db!.select().from(productBasicInfo)
        .where(opsWorkspaceCondition(productBasicInfo, currentOpsWorkspaceId(), and(eq(productBasicInfo.productId, input.productId), eq(productBasicInfo.userId, ctx.user.id))));
      if (existing) {
        await db!.update(productBasicInfo).set(data as any).where(opsWorkspaceCondition(productBasicInfo, currentOpsWorkspaceId(), eq(productBasicInfo.id, existing.id)));
      } else {
        await db!.insert(productBasicInfo).values({ ...data as any, productId: input.productId, userId: ctx.user.id });
      }

      return { filled: true, data };
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


  // ─── Batch sync weekly ops for all active products (using asinList API) ───
  batchSyncWeeklyOps: protectedProcedure
    .input(z.object({
      weeks: z.number().default(1),
    }).optional())
    .mutation(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const weeks = input?.weeks || 1;

      // Get all active US products for this user (avoid syncing too much data)
      const products = await db!.select()
        .from(productProfiles)
        .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(
          eq(productProfiles.userId, ctx.user.id),
          eq(productProfiles.status, 'active'),
          eq(productProfiles.marketplace, 'US'),
        )));

      if (products.length === 0) {
        return { total: 0, synced: 0, errors: 0, details: [] };
      }
      const results: Array<{ productId: number; parentAsin: string; syncedWeeks: number; error?: string }> = [];
      let totalSynced = 0;
      let totalErrors = 0;

      // Generate weekly date ranges
      const now = new Date();
      const getWeekMonday = (d: Date): Date => {
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        return new Date(new Date(d).setDate(diff));
      };

      const weekRanges: Array<{ start: string; end: string }> = [];
      let cur = getWeekMonday(new Date(now.getTime() - (weeks - 1) * 7 * 86400000));
      while (cur <= now) {
        const weekEnd = new Date(cur.getTime() + 6 * 86400000);
        weekRanges.push({
          start: cur.toISOString().split('T')[0],
          end: weekEnd.toISOString().split('T')[0],
        });
        cur = new Date(cur.getTime() + 7 * 86400000);
      }

      // Build a map of parent ASIN -> product for quick lookup
      const productByParentAsin = new Map<string, typeof products[0]>();
      for (const product of products) {
        if (product.parentAsin) {
          productByParentAsin.set(product.parentAsin.toUpperCase(), product);
        }
      }

      // Get all US SIDs
      const { sellers } = await findMatchedSid(null as any, products[0]);
      const marketplaceMids = MARKETPLACE_MID_MAP['US'] || [1];
      const allUsSids = sellers
        .filter((s: any) => marketplaceMids.includes(s.mid))
        .map((s: any) => s.sid);
      const matchedMid = marketplaceMids[0];

      // For each week, fetch ALL products from API in one batch, then match to DB products
      for (const week of weekRanges) {
        try {
          // Paginate through all API products for this week
          let allApiItems: any[] = [];
          let offset = 0;
          const pageSize = 100;
          while (true) {
            const res = failUnavailableDataSource();
            const raw = res.data || [];
            const pageItems = Array.isArray(raw) ? raw : (raw as any).records || (raw as any).list || [];
            allApiItems.push(...pageItems);
            const total = (raw as any).total || 0;
            if (offset + pageSize >= total || pageItems.length === 0) break;
            offset += pageSize;
            // Rate limit delay between pages
            await new Promise(r => setTimeout(r, 3000));
          }

          console.log(`[batchSync] Week ${week.start}: fetched ${allApiItems.length} API items, matching against ${products.length} DB products`);

          // Match API items to DB products and upsert
          for (const apiItem of allApiItems) {
            const itemParentAsin = (apiItem.parent_asins?.[0]?.parent_asin || '').toUpperCase();
            const product = productByParentAsin.get(itemParentAsin);
            if (!product) continue; // Not in our DB, skip

            try {
              const totalSales = Number(apiItem.volume || 0);
              const totalOrders = Number(apiItem.order_items || 0);
              const totalRevenue = Number(apiItem.amount || 0);
              const totalProfit = Number(apiItem.gross_profit || 0);
              const totalAdSpend = Number(apiItem.spend || 0);
              const totalAdSales = Number(apiItem.ad_sales_amount || 0);
              const totalAdOrders = Number(apiItem.ad_order_quantity || 0);
              const totalImpressions = Number(apiItem.impressions || 0);
              const totalClicks = Number(apiItem.clicks || 0);
              const totalSessions = Number(apiItem.sessions_total || 0);
              const latestRating = Number(apiItem.avg_star || 0);
              const latestReviewCount = Number(apiItem.reviews_count || 0);
              const avgReturnRate = Number(apiItem.return_rate || 0);

              const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
              const acos = totalAdSales > 0 ? (totalAdSpend / totalAdSales * 100) : 0;
              const ctr = totalImpressions > 0 ? (totalClicks / totalImpressions) : 0;
              const cpc = totalClicks > 0 ? (totalAdSpend / totalClicks) : 0;
              const adCvr = totalClicks > 0 ? (totalAdOrders / totalClicks * 100) : 0;
              const totalCvr = totalSessions > 0 ? (totalOrders / totalSessions * 100) : 0;
              const organicOrders = Math.max(0, totalOrders - totalAdOrders);
              const organicClicks = Math.max(0, totalSessions - totalClicks);
              const organicCvr = organicClicks > 0 ? (organicOrders / organicClicks * 100) : 0;

              // Trend
              const prevWeekStart = new Date(new Date(week.start).getTime() - 7 * 86400000).toISOString().split('T')[0];
              const [prevRecord] = await db!.select().from(productWeeklyOps)
                .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(
                  eq(productWeeklyOps.productId, product.id),
                  eq(productWeeklyOps.userId, ctx.user.id),
                  eq(productWeeklyOps.weekStartDate, prevWeekStart),
                )));
              const prevSales = prevRecord?.salesQty || 0;
              const trend = totalSales > prevSales ? 'up' : totalSales < prevSales ? 'down' : 'stable';

              const [existing] = await db!.select().from(productWeeklyOps)
                .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(
                  eq(productWeeklyOps.productId, product.id),
                  eq(productWeeklyOps.userId, ctx.user.id),
                  eq(productWeeklyOps.weekStartDate, week.start),
                )));

              const record = {
                salesTrend: trend as any,
                salesQty: totalSales,
                orderQty: totalOrders,
                salesAmount: totalRevenue.toFixed(2),
                orderProfit: totalProfit.toFixed(2),
                orderProfitMargin: profitMargin.toFixed(2),
                sessionTotal: totalSessions,
                totalCvr: totalCvr.toFixed(2),
                adCvr: adCvr.toFixed(2),
                organicCvr: organicCvr.toFixed(2),
                adOrders: totalAdOrders,
                organicOrders,
                adClicks: totalClicks,
                organicClicks,
                ctr: ctr.toFixed(4),
                adImpressions: totalImpressions,
                cpc: cpc.toFixed(2),
                adSpend: totalAdSpend.toFixed(2),
                adSales: totalAdSales.toFixed(2),
                acos: acos.toFixed(2),
                rating: latestRating.toFixed(1),
                reviewCount: latestReviewCount,
                returnRate: avgReturnRate.toFixed(2),
              };

              if (existing) {
                await db!.update(productWeeklyOps).set(record as any).where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), eq(productWeeklyOps.id, existing.id)));
              } else {
                await db!.insert(productWeeklyOps).values({
                  ...record as any,
                  productId: product.id,
                  userId: ctx.user.id,
                  weekStartDate: week.start,
                  weekEndDate: week.end,
                });
              }

              // Track results per product
              const existingResult = results.find(r => r.productId === product.id);
              if (existingResult) {
                existingResult.syncedWeeks++;
              } else {
                results.push({ productId: product.id, parentAsin: product.parentAsin, syncedWeeks: 1 });
              }
              totalSynced++;

              // Update operator and product name if found
              const operatorName = apiItem.principal_names
                ? (Array.isArray(apiItem.principal_names) ? apiItem.principal_names.join(', ') : String(apiItem.principal_names))
                : '';
              const productNameFromApi = apiItem.local_name || apiItem.item_name || '';
              const batchProfileUpdates: Record<string, string> = {};
              if (operatorName && !product.operator) {
                batchProfileUpdates.operator = operatorName;
              }
              if (productNameFromApi && !product.chineseName) {
                batchProfileUpdates.chineseName = productNameFromApi;
              }
              if (Object.keys(batchProfileUpdates).length > 0) {
                await db!.update(productProfiles)
                  .set(batchProfileUpdates as any)
                  .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), eq(productProfiles.id, product.id)));
              }
            } catch (itemErr: any) {
              console.warn(`[batchSync] Product ${itemParentAsin} week ${week.start} error: ${itemErr.message}`);
            }
          }
        } catch (weekErr: any) {
          console.warn(`[batchSync] Week ${week.start} fetch error: ${weekErr.message}`);
          totalErrors++;
        }
        // Rate limit: wait 3s between weeks
        await new Promise(resolve => setTimeout(resolve, 3000));
      }

      // Add products that weren't found in API
      for (const product of products) {
        if (!results.find(r => r.productId === product.id)) {
          results.push({ productId: product.id, parentAsin: product.parentAsin, syncedWeeks: 0 });
        }
      }

      return { total: products.length, synced: totalSynced, errors: totalErrors, details: results };
    }),


  // ─── Trigger manual auto-sync (admin only) ───
  triggerAutoSync: protectedProcedure
    .mutation(async ({ ctx }) => {
      // Only allow admin/super_admin to trigger manual sync
      if (ctx.user.role !== 'admin' && ctx.user.role !== 'super_admin') {
        throw new TRPCError({ code: 'FORBIDDEN', message: '仅管理员可触发自动同步' });
      }
      const { triggerManualSync } = await import('../service');
      await triggerManualSync();
      return { success: true, message: '自动同步已触发' };
    }),


  // ─── Product Overview with 4-week data (参考表格样式) ───
  getProductOverviewWithWeeks: protectedProcedure
    .input(z.object({
      marketplace: z.string().default("US"),
      statusFilter: z.enum(["active", "inactive", "discontinued", "all"]).default("active"),
      weeks: z.number().default(4), // how many weeks to show
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireOpsDb();
      const marketplace = input?.marketplace || "US";
      const statusFilter = input?.statusFilter || "active";
      const weeksToShow = input?.weeks || 4;

      // Build where conditions
      const conditions = [eq(productProfiles.userId, ctx.user.id)];
      if (marketplace !== "all") {
        conditions.push(eq(productProfiles.marketplace, marketplace));
      }
      if (statusFilter !== "all") {
        conditions.push(eq(productProfiles.status, statusFilter as any));
      }

      const products = await db!.select().from(productProfiles)
        .where(opsWorkspaceCondition(productProfiles, currentOpsWorkspaceId(), and(...conditions)))
        .orderBy(desc(productProfiles.updatedAt));

      // For each product, get basic info + last N weeks + monthly summaries
      const result = await Promise.all(products.map(async (p) => {
        // Get variants, basic info
        const [variants, basicInfoArr, weeklyData, monthlySummaries] = await Promise.all([
          db!.select().from(productVariants)
            .where(opsWorkspaceCondition(productVariants, currentOpsWorkspaceId(), eq(productVariants.productId, p.id))),
          db!.select().from(productBasicInfo)
            .where(opsWorkspaceCondition(productBasicInfo, currentOpsWorkspaceId(), and(eq(productBasicInfo.productId, p.id), eq(productBasicInfo.userId, ctx.user.id))))
            .limit(1),
          db!.select().from(productWeeklyOps)
            .where(opsWorkspaceCondition(productWeeklyOps, currentOpsWorkspaceId(), and(
              eq(productWeeklyOps.productId, p.id),
              eq(productWeeklyOps.userId, ctx.user.id),
            )))
            .orderBy(desc(productWeeklyOps.weekStartDate))
            .limit(weeksToShow + 1), // +1 for previous week comparison
          db!.select().from(productMonthlySummary)
            .where(opsWorkspaceCondition(productMonthlySummary, currentOpsWorkspaceId(), and(
              eq(productMonthlySummary.productId, p.id),
              eq(productMonthlySummary.userId, ctx.user.id),
            )))
            .orderBy(desc(productMonthlySummary.yearMonth))
            .limit(3),
        ]);

        const basicInfo = basicInfoArr[0] || null;
        const skus = variants.map(v => v.sku).filter(Boolean);

        // Build weekly rows with WoW (week-over-week) comparison
        const weeksWithComparison = weeklyData.slice(0, weeksToShow).map((week, idx) => {
          const prevWeek = weeklyData[idx + 1] || null; // previous week for comparison

          function calcChange(current: number, previous: number | null): { value: number; pct: number | null } {
            if (previous === null || previous === 0) return { value: current, pct: null };
            const pct = ((current - previous) / Math.abs(previous)) * 100;
            return { value: current, pct: Math.round(pct * 100) / 100 };
          }

          const salesQty = week.salesQty || 0;
          const orderQty = week.orderQty || 0;
          const salesAmount = parseFloat(String(week.salesAmount || "0"));
          const orderProfit = parseFloat(String(week.orderProfit || "0"));
          const profitMargin = parseFloat(String(week.orderProfitMargin || "0"));
          const sessionTotal = week.sessionTotal || 0;
          const totalCvr = parseFloat(String(week.totalCvr || "0"));
          const adCvr = parseFloat(String(week.adCvr || "0"));
          const organicCvr = parseFloat(String(week.organicCvr || "0"));
          const adOrders = week.adOrders || 0;
          const organicOrders = week.organicOrders || 0;
          const adClicks = week.adClicks || 0;
          const ctr = parseFloat(String(week.ctr || "0"));
          const adImpressions = week.adImpressions || 0;
          const cpc = parseFloat(String(week.cpc || "0"));
          const adSpend = parseFloat(String(week.adSpend || "0"));
          const adSales = parseFloat(String((week as any).adSales || "0"));
          const acos = parseFloat(String(week.acos || "0"));
          const rating = parseFloat(String(week.rating || "0"));
          const reviewCount = week.reviewCount || 0;
          const returnRate = parseFloat(String(week.returnRate || "0"));

          return {
            id: week.id,
            weekStartDate: week.weekStartDate,
            weekEndDate: week.weekEndDate,
            salesTrend: week.salesTrend,
            // Core metrics
            salesQty,
            orderQty,
            salesAmount,
            orderProfit,
            profitMargin,
            // Session & CVR
            sessionTotal,
            totalCvr,
            adCvr,
            organicCvr,
            // Orders breakdown
            adOrders,
            organicOrders,
            // Ad metrics
            adClicks,
            ctr,
            adImpressions,
            cpc,
            adSpend,
            adSales,
            acos,
            // Quality
            rating,
            reviewCount,
            returnRate,
            // Week-over-week changes
            wow: prevWeek ? {
              salesQty: calcChange(salesQty, prevWeek.salesQty || 0),
              salesAmount: calcChange(salesAmount, parseFloat(String(prevWeek.salesAmount || "0"))),
              orderProfit: calcChange(orderProfit, parseFloat(String(prevWeek.orderProfit || "0"))),
              sessionTotal: calcChange(sessionTotal, prevWeek.sessionTotal || 0),
              adSpend: calcChange(adSpend, parseFloat(String(prevWeek.adSpend || "0"))),
              acos: calcChange(acos, parseFloat(String(prevWeek.acos || "0"))),
            } : null,
          };
        });

        return {
          // Product info
          id: p.id,
          parentAsin: p.parentAsin,
          title: p.title,
          chineseName: p.chineseName,
          brand: p.brand,
          category: p.category,
          marketplace: p.marketplace,
          imageUrl: p.imageUrl,
          status: p.status,
          operator: p.operator,
          storeName: p.storeName,
          variantCount: variants.length,
          skus,
          // Basic info (pricing/margins)
          basicInfo: basicInfo ? {
            sellingPrice: basicInfo.sellingPrice,
            breakEvenPrice: basicInfo.breakEvenPrice,
            grossProfit: basicInfo.grossProfit,
            grossMargin: basicInfo.grossMargin,
            returnRate: basicInfo.returnRate,
            rating: basicInfo.rating,
            reviewCount: basicInfo.reviewCount,
            listingDate: basicInfo.listingDate,
            currentStock: basicInfo.currentStock,
            inTransitStock: basicInfo.inTransitStock,
          } : null,
          // Weekly data (most recent N weeks)
          weeks: weeksWithComparison,
          // Monthly summaries
          monthlySummaries: monthlySummaries.map(m => ({
            yearMonth: m.yearMonth,
            financialProfit: m.financialProfit,
            orderProfitTotal: m.orderProfitTotal,
            totalSalesQty: m.totalSalesQty,
            totalOrderQty: m.totalOrderQty,
            totalSalesAmount: m.totalSalesAmount,
            totalAdSpend: m.totalAdSpend,
            avgAcos: m.avgAcos,
          })),
        };
      }));

      return result;
    }),
};
