import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getLingxingAdapter } from "../lingxingAdapter";
import { invokeLLM } from "../_core/llm";
import { collectConversionData, collectMultipleAsins, type ConversionCrawlData } from "./conversionDataCollector";
import { scoreAllCheckItems, type CheckItemScore } from "./conversionAiScorer";
import { parseSellerSpriteData, parseSellerSpriteXlsx, mergeSellerSpriteWithCrawlData, buildCrawlDataFromSellerSprite, type SellerSpriteProductData, type ImportResult } from "./sellerSpriteImporter";
import { resolveDataUserId } from "./dataImport";
import {
  productProfiles, productVariants, productTodos, productLogs,
  keywordMonitors, keywordSnapshots,
  competitorMonitors, competitorSnapshots,
  opsPlans, opsPlanActions, opsPlanSummaries,
  conversionComparisons, conversionCheckItems, conversionScores, conversionSuggestions, checkItemOverrides,
  executionReviews, teamTasks, users,
  productWeeklyOps, productMonthlySummary, productBasicInfo,
  lingxingProductWeekly,
  operatorNameMappings,
} from "../../drizzle/schema";
import { eq, desc, and, or, sql, asc, isNull, inArray } from "drizzle-orm";

// ============== Scoring Progress Tracking ==============
type ScoringProgress = {
  status: 'running' | 'done' | 'error';
  scored: number;
  total: number;
  message: string;
};
const scoringProgressMap = new Map<string, ScoringProgress>();

// ============== Product Operations Overview ==============
export const productOpsRouter = router({

  // ─── Product Profiles CRUD ───

  listProducts: protectedProcedure
    .input(z.object({
      period: z.enum(["day", "week", "month"]).default("month"),
      marketplace: z.string().default("US"),
      statusFilter: z.enum(["active", "inactive", "discontinued", "all"]).default("active"),
    }).optional())
    .query(async ({ ctx, input }) => {
    const period = input?.period || "month";
    const marketplace = input?.marketplace || "US";
    const statusFilter = input?.statusFilter || "active";
    const db = await getDb();

    // Build where conditions: always filter by user, optionally by marketplace and status
    const conditions = [eq(productProfiles.userId, ctx.user.id)];
    if (marketplace !== "all") {
      conditions.push(eq(productProfiles.marketplace, marketplace));
    }
    if (statusFilter !== "all") {
      conditions.push(eq(productProfiles.status, statusFilter as any));
    }

    const products = await db!.select().from(productProfiles)
      .where(and(...conditions))
      .orderBy(desc(productProfiles.updatedAt));

    // For each product, get variant count, pending todo count, and first child ASIN
    const enriched = await Promise.all(products.map(async (p) => {
      const [variants, todos, firstVariant] = await Promise.all([
        db!.select({ count: sql<number>`count(*)` }).from(productVariants)
          .where(eq(productVariants.productId, p.id)),
        db!.select({ count: sql<number>`count(*)` }).from(productTodos)
          .where(and(eq(productTodos.productId, p.id), sql`${productTodos.status} != 'completed'`)),
        db!.select({ childAsin: productVariants.childAsin }).from(productVariants)
          .where(eq(productVariants.productId, p.id))
          .limit(1),
      ]);
      return {
        ...p,
        variantCount: Number(variants[0]?.count ?? 0),
        pendingTodoCount: Number(todos[0]?.count ?? 0),
        firstChildAsin: firstVariant[0]?.childAsin || null,
      };
    }));

    // Fetch profit data from Lingxing MSKU profit API
    const adapter = getLingxingAdapter();
    const now = new Date();
    const periodDays = period === 'day' ? 1 : period === 'week' ? 7 : 30;
    const startDate = new Date(now.getTime() - periodDays * 86400000).toISOString().split('T')[0];
    const endDate = now.toISOString().split('T')[0];

    // Build dual maps: parentAsin -> sales, asin (child) -> sales
    type SalesInfo = { sales: number; revenue: number; profit: number; profitRate: number };
    const parentAsinMap = new Map<string, SalesInfo>();
    const childAsinMap = new Map<string, SalesInfo>();
    try {
      const profitRes = await adapter.requestWithMockFallback({
        path: "/bd/profit/report/open/report/msku/list",
        body: { offset: 0, length: 2000, startDate, endDate, monthlyQuery: false, orderStatus: "All" },
        timeout: 60_000, // Large response (~6MB), needs more time
      });
      const profitRaw = profitRes.data || [];
      const profitList = Array.isArray(profitRaw) ? profitRaw : (profitRaw as any).records || (profitRaw as any).list || [];

      for (const item of profitList) {
        const pAsin = String(item.parentAsin || item.parent_asin || "").toUpperCase();
        const cAsin = String(item.asin || "").toUpperCase();
        const qty = Number(item.totalSalesQuantity || item.totalFbaAndFbmQuantity || 0);
        const rev = Number(item.totalSalesAmount || item.totalFbaAndFbmAmount || 0);
        const profit = Number(item.grossProfit || 0);
        const rate = rev > 0 ? Math.round((profit / rev) * 10000) / 100 : 0;

        // Map by parent ASIN (aggregate)
        if (pAsin) {
          const existing = parentAsinMap.get(pAsin) || { sales: 0, revenue: 0, profit: 0, profitRate: 0 };
          existing.sales += qty;
          existing.revenue += rev;
          existing.profit += profit;
          parentAsinMap.set(pAsin, existing);
        }
        // Map by child ASIN (aggregate)
        if (cAsin) {
          const existing = childAsinMap.get(cAsin) || { sales: 0, revenue: 0, profit: 0, profitRate: 0 };
          existing.sales += qty;
          existing.revenue += rev;
          existing.profit += profit;
          childAsinMap.set(cAsin, existing);
        }
      }

      // Recalculate profit rates after aggregation
      parentAsinMap.forEach((info) => {
        info.profitRate = info.revenue > 0 ? Math.round((info.profit / info.revenue) * 10000) / 100 : 0;
      });
      childAsinMap.forEach((info) => {
        info.profitRate = info.revenue > 0 ? Math.round((info.profit / info.revenue) * 10000) / 100 : 0;
      });

      console.log(`[listProducts] Fetched profit data: ${profitList.length} items, parentAsinMap=${parentAsinMap.size}, childAsinMap=${childAsinMap.size}`);
    } catch (err: any) {
      console.warn(`[listProducts] Profit fetch error: ${err.message}`);
    }

    // Merge sales data: triple matching strategy
    const emptyInfo: SalesInfo = { sales: 0, revenue: 0, profit: 0, profitRate: 0 };
    let matchedCount = 0;
    const withSales = enriched.map(p => {
      const dbAsin = (p.parentAsin || "").toUpperCase();
      const childAsin = (p.firstChildAsin || "").toUpperCase();
      // Strategy: 1) parentAsinMap by DB parentAsin, 2) childAsinMap by DB parentAsin,
      // 3) parentAsinMap by firstChildAsin, 4) childAsinMap by firstChildAsin
      const info = parentAsinMap.get(dbAsin) || childAsinMap.get(dbAsin)
        || (childAsin ? (parentAsinMap.get(childAsin) || childAsinMap.get(childAsin)) : null)
        || emptyInfo;
      if (info !== emptyInfo) matchedCount++;
      return {
        ...p,
        salesQty: info.sales,
        salesRevenue: Math.round(info.revenue * 100) / 100,
        salesProfit: Math.round(info.profit * 100) / 100,
        profitRate: info.profitRate,
      };
    });
    console.log(`[listProducts] Matched ${matchedCount}/${withSales.length} products with sales data (parentAsinMap=${parentAsinMap.size}, childAsinMap=${childAsinMap.size})`);
    return withSales;
  }),

  getProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [product] = await db!.select().from(productProfiles)
        .where(and(eq(productProfiles.id, input.id), eq(productProfiles.userId, ctx.user.id)));
      if (!product) throw new TRPCError({ code: "NOT_FOUND", message: "产品不存在" });

      const variants = await db!.select().from(productVariants)
        .where(eq(productVariants.productId, input.id))
        .orderBy(asc(productVariants.createdAt));

      return { ...product, variants };
    }),

  createProduct: protectedProcedure
    .input(z.object({
      parentAsin: z.string().min(1).max(20),
      title: z.string().min(1).max(500),
      brand: z.string().optional(),
      category: z.string().optional(),
      marketplace: z.string().optional().default("US"),
      imageUrl: z.string().optional(),
      budgetRevenue: z.string().optional(),
      budgetProfit: z.string().optional(),
      budgetAcos: z.string().optional(),
      notes: z.string().optional(),
      operator: z.string().optional(),
      storeName: z.string().optional(),
      variants: z.array(z.object({
        childAsin: z.string().min(1).max(20),
        sku: z.string().optional(),
        title: z.string().optional(),
        price: z.string().optional(),
        variationAttributes: z.record(z.string(), z.string()).optional(),
      })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(productProfiles).values({
        userId: ctx.user.id,
        parentAsin: input.parentAsin,
        title: input.title,
        brand: input.brand || undefined,
        category: input.category || undefined,
        marketplace: input.marketplace,
        imageUrl: input.imageUrl || undefined,
        budgetRevenue: input.budgetRevenue || undefined,
        budgetProfit: input.budgetProfit || undefined,
        budgetAcos: input.budgetAcos || undefined,
        notes: input.notes || undefined,
        operator: input.operator || undefined,
        storeName: input.storeName || undefined,
      });
      const productId = result.insertId;

      if (input.variants?.length) {
        await db!.insert(productVariants).values(
          input.variants.map(v => ({
            productId,
            childAsin: v.childAsin,
            sku: v.sku,
            title: v.title,
            price: v.price,
            variationAttributes: v.variationAttributes,
          }))
        );
      }
      return { id: productId };
    }),

  updateProduct: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      brand: z.string().optional(),
      category: z.string().optional(),
      marketplace: z.string().optional(),
      imageUrl: z.string().optional(),
      status: z.enum(["active", "inactive", "discontinued"]).optional(),
      budgetRevenue: z.string().optional(),
      budgetProfit: z.string().optional(),
      budgetAcos: z.string().optional(),
      notes: z.string().optional(),
      chineseName: z.string().optional(),
      operator: z.string().optional(),
      storeName: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { id, ...updates } = input;
      // Filter out undefined values
      const cleanUpdates = Object.fromEntries(
        Object.entries(updates).filter(([, v]) => v !== undefined)
      );
      if (Object.keys(cleanUpdates).length > 0) {
        await db!.update(productProfiles).set(cleanUpdates)
          .where(and(eq(productProfiles.id, id), eq(productProfiles.userId, ctx.user.id)));
      }
      return { updated: true };
    }),

  deleteProduct: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      // Delete related data first
      await db!.delete(productVariants).where(eq(productVariants.productId, input.id));
      await db!.delete(productTodos).where(eq(productTodos.productId, input.id));
      await db!.delete(productLogs).where(eq(productLogs.productId, input.id));
      // Delete keyword monitors and their snapshots
      const monitors = await db!.select({ id: keywordMonitors.id }).from(keywordMonitors)
        .where(eq(keywordMonitors.productId, input.id));
      for (const m of monitors) {
        await db!.delete(keywordSnapshots).where(eq(keywordSnapshots.keywordMonitorId, m.id));
      }
      await db!.delete(keywordMonitors).where(eq(keywordMonitors.productId, input.id));
      // Delete the product itself
      await db!.delete(productProfiles)
        .where(and(eq(productProfiles.id, input.id), eq(productProfiles.userId, ctx.user.id)));
      return { deleted: true };
    }),

  // ─── Product Variants ───

  addVariant: protectedProcedure
    .input(z.object({
      productId: z.number(),
      childAsin: z.string().min(1).max(20),
      sku: z.string().optional(),
      title: z.string().optional(),
      price: z.string().optional(),
      variationAttributes: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [result] = await db!.insert(productVariants).values({
        productId: input.productId,
        childAsin: input.childAsin,
        sku: input.sku,
        title: input.title,
        price: input.price,
        variationAttributes: input.variationAttributes,
      });
      return { id: result.insertId };
    }),

  removeVariant: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db!.delete(productVariants).where(eq(productVariants.id, input.id));
      return { deleted: true };
    }),

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

  // ─── Product Data Aggregation (from Lingxing Mock) ───

  getProductProfitSummary: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [product] = await db!.select().from(productProfiles)
        .where(and(eq(productProfiles.id, input.productId), eq(productProfiles.userId, ctx.user.id)));
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      const adapter = getLingxingAdapter();

      // Get product variants (child ASINs and SKUs) for filtering
      const variants = await db!.select().from(productVariants)
        .where(eq(productVariants.productId, input.productId));
      const childAsins = variants.map(v => v.childAsin).filter(Boolean);
      const skus = variants.map(v => v.sku).filter(Boolean) as string[];
      const parentAsin = product.parentAsin;
      console.log(`[ProfitSummary] Product ${parentAsin}, childAsins=[${childAsins.join(',')}], skus=[${skus.join(',')}]`);

      // Helper to aggregate profit items (field names from Lingxing API docs)
      const aggregateProfit = (items: any[]) => {
        let totalRevenue = 0, totalProductCost = 0, totalAdSpend = 0;
        let totalFbaFee = 0, totalReferralFee = 0, totalOtherFee = 0, totalProfit = 0;
        let totalOrders = 0, totalUnits = 0, totalShippingCost = 0;
        for (const item of items) {
          const i = item as Record<string, number>;
          // totalSalesAmount = 销售额 (primary), totalFbaAndFbmAmount = fba+fbm销售额加总 (fallback)
          totalRevenue += Number(i.totalSalesAmount || i.totalFbaAndFbmAmount || i.platformIncome || 0);
          totalProductCost += Math.abs(Number(i.cgPriceTotal || i.cgPriceAbsTotal || 0));
          // totalAdsCost = 广告费 (primary)
          totalAdSpend += Math.abs(Number(i.totalAdsCost || 0));
          // totalFbaDeliveryFee = FBA发货费合计
          totalFbaFee += Math.abs(Number(i.totalFbaDeliveryFee || i.fbaDeliveryFee || 0));
          totalReferralFee += Math.abs(Number(i.platformExpense || i.platformFee || 0));
          // totalStorageFee = FBA仓储费
          totalOtherFee += Math.abs(Number(i.totalStorageFee || i.fbaStorageFee || 0));
          // grossProfit = 毛利润
          totalProfit += Number(i.grossProfit || 0);
          // totalSalesQuantity = 销量 (this is the order/sales quantity)
          totalOrders += Number(i.totalSalesQuantity || 0);
          // totalFbaAndFbmQuantity = fba+fbm销量加总
          totalUnits += Number(i.totalFbaAndFbmQuantity || i.totalSalesQuantity || 0);
          // cgTransportCostsTotal = 头程成本
          totalShippingCost += Math.abs(Number(i.cgTransportCostsTotal || 0));
        }
        const amazonFees = totalReferralFee + totalFbaFee;
        const netRevenue = totalRevenue - amazonFees;
        const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;
        return {
          revenue: round2(totalRevenue), amazonFees: round2(amazonFees),
          referralFee: round2(totalReferralFee), fbaFee: round2(totalFbaFee),
          adSpend: round2(totalAdSpend), storageFee: round2(totalOtherFee),
          netRevenue: round2(netRevenue), fixedCosts: round2(totalProductCost),
          productCost: round2(totalProductCost), shippingCost: round2(totalShippingCost),
          tariff: 0, profit: round2(totalProfit), profitMargin: round2(profitMargin),
          orders: totalOrders, units: totalUnits,
        };
      };

      // Filter items by this product's ASINs/SKUs
      const filterByProduct = (items: any[]) => {
        return items.filter((item: any) => {
          const itemAsin = item.asin || item.parentAsin || '';
          const itemSku = item.localSku || item.msku || item.seller_sku || '';
          return childAsins.includes(itemAsin) || itemAsin === parentAsin ||
                 skus.includes(itemSku);
        });
      };

      // Strategy: First try ASIN-specific API, then fallback to MSKU list with filtering
      let actual30Items: any[] = [];
      let current7Items: any[] = [];
      // Collect data source meta from API responses
      let dataSourceMeta: { source: 'real' | 'mock_mode' | 'mock_fallback'; reason?: string } = { source: 'real' };

      // Try ASIN-specific profit API first (more precise)
      // Use searchField + searchValue per Lingxing API docs, endDate = yesterday (today's data incomplete)
      try {
        const asinRes = await adapter.requestWithMockFallback({
          path: "/bd/profit/report/open/report/asin/list",
          body: {
            offset: 0,
            length: 1000,
            startDate: getDateNDaysAgo(30),
            endDate: getYesterday(),
            searchField: "asin",
            searchValue: childAsins.length > 0 ? childAsins : [parentAsin],
            monthlyQuery: false,
            orderStatus: "All",
          },
        });
        if (asinRes._meta) dataSourceMeta = asinRes._meta;
        const rawAsin = asinRes.data || [];
        actual30Items = Array.isArray(rawAsin) ? rawAsin : (rawAsin as any).records || (rawAsin as any).list || [];
        console.log(`[ProfitSummary] ASIN API returned ${actual30Items.length} items for ${parentAsin}`);
      } catch (err: any) {
        console.warn(`[ProfitSummary] ASIN API failed, trying MSKU list: ${err.message}`);
      }

      // If ASIN API returned no data, try parent ASIN API, then fallback to MSKU
      if (actual30Items.length === 0 && parentAsin) {
        try {
          const parentRes = await adapter.requestWithMockFallback({
            path: "/bd/profit/report/open/report/parent/asin/list",
            body: {
              offset: 0,
              length: 1000,
              startDate: getDateNDaysAgo(30),
              endDate: getYesterday(),
              searchField: "parent_asin",
              searchValue: [parentAsin],
              monthlyQuery: false,
              orderStatus: "All",
            },
          });
          if (parentRes._meta) dataSourceMeta = parentRes._meta;
          const rawParent = parentRes.data || [];
          actual30Items = Array.isArray(rawParent) ? rawParent : (rawParent as any).records || (rawParent as any).list || [];
          console.log(`[ProfitSummary] Parent ASIN API returned ${actual30Items.length} items for ${parentAsin}`);
        } catch (err: any) {
          console.warn(`[ProfitSummary] Parent ASIN API failed: ${err.message}`);
        }
      }
      if (actual30Items.length === 0) {
        const profitRes = await adapter.requestWithMockFallback({
          path: "/bd/profit/report/open/report/msku/list",
          body: { startDate: getDateNDaysAgo(30), endDate: getYesterday(), length: 500, summaryEnabled: true },
        });
        if (profitRes._meta && profitRes._meta.source !== 'real') dataSourceMeta = profitRes._meta;
        const rawProfit = profitRes.data || [];
        const allItems = Array.isArray(rawProfit) ? rawProfit : (rawProfit as any).records || (rawProfit as any).list || [];
        actual30Items = filterByProduct(allItems);
        console.log(`[ProfitSummary] MSKU list: ${allItems.length} total, ${actual30Items.length} matched for ${parentAsin}`);
      }
      const actual = aggregateProfit(actual30Items);

      // Fetch 7-day profit data (现时 - real-time recent)
      let current = { revenue: 0, amazonFees: 0, referralFee: 0, fbaFee: 0, adSpend: 0, storageFee: 0, netRevenue: 0, fixedCosts: 0, productCost: 0, shippingCost: 0, tariff: 0, profit: 0, profitMargin: 0, orders: 0, units: 0 };
      try {
        // Try ASIN API for 7-day data
        const asinRes7 = await adapter.requestWithMockFallback({
          path: "/bd/profit/report/open/report/asin/list",
          body: {
            offset: 0,
            length: 1000,
            startDate: getDateNDaysAgo(7),
            endDate: getYesterday(),
            searchField: "asin",
            searchValue: childAsins.length > 0 ? childAsins : [parentAsin],
            monthlyQuery: false,
            orderStatus: "All",
          },
        });
        const raw7 = asinRes7.data || [];
        current7Items = Array.isArray(raw7) ? raw7 : (raw7 as any).records || (raw7 as any).list || [];

        // Try parent ASIN API if no data
        if (current7Items.length === 0 && parentAsin) {
          try {
            const parentRes7 = await adapter.requestWithMockFallback({
              path: "/bd/profit/report/open/report/parent/asin/list",
              body: {
                offset: 0,
                length: 1000,
                startDate: getDateNDaysAgo(7),
                endDate: getYesterday(),
                searchField: "parent_asin",
                searchValue: [parentAsin],
                monthlyQuery: false,
                orderStatus: "All",
              },
            });
            const raw7p = parentRes7.data || [];
            current7Items = Array.isArray(raw7p) ? raw7p : (raw7p as any).records || (raw7p as any).list || [];
            console.log(`[ProfitSummary] Parent ASIN 7-day API returned ${current7Items.length} items`);
          } catch (e: any) {
            console.warn(`[ProfitSummary] Parent ASIN 7-day API failed: ${e.message}`);
          }
        }
        if (current7Items.length === 0) {
          // Fallback to MSKU list
          const recentRes = await adapter.requestWithMockFallback({
            path: "/bd/profit/report/open/report/msku/list",
            body: { startDate: getDateNDaysAgo(7), endDate: getYesterday(), length: 500, summaryEnabled: true },
          });
          const rawRecent = recentRes.data || [];
          const allRecent = Array.isArray(rawRecent) ? rawRecent : (rawRecent as any).records || (rawRecent as any).list || [];
          current7Items = filterByProduct(allRecent);
        }
        current = aggregateProfit(current7Items);
      } catch (err: any) {
        console.warn(`[ProfitSummary] Recent 7-day fetch error: ${err.message}`);
      }

      // Fetch ASIN 360 hourly data for real-time sales/ranking trends
      let hourlyTrend: Array<{ hour: string; volume: number; orderItems: number; amount: number; price: number; salesRank: number }> = [];
      try {
        const asin360Res = await adapter.requestWithMockFallback({
          path: "/basicOpen/salesAnalysis/productPerformance/performanceTrendByHour",
          body: {
            asin: childAsins.length > 0 ? childAsins[0] : parentAsin,
            report_date: getYesterday(),
          },
        });
        const rawHourly = asin360Res.data || [];
        const hourlyList = Array.isArray(rawHourly) ? rawHourly : (rawHourly as any).records || (rawHourly as any).list || [];
        hourlyTrend = hourlyList.map((h: any) => ({
          hour: String(h.hour || h.time || ''),
          volume: Number(h.volume || h.quantity || 0),
          orderItems: Number(h.order_items || h.orders || 0),
          amount: Number(h.amount || h.sales || 0),
          price: Number(h.price || 0),
          salesRank: Number(h.sales_rank || h.rank || 0),
        }));
        console.log(`[ProfitSummary] ASIN360 hourly data: ${hourlyTrend.length} hours for ${parentAsin}`);
      } catch (err: any) {
        console.warn(`[ProfitSummary] ASIN360 hourly fetch error: ${err.message}`);
      }

      return {
        budget: {
          revenue: product.budgetRevenue ? Number(product.budgetRevenue) : null,
          profit: product.budgetProfit ? Number(product.budgetProfit) : null,
          acos: product.budgetAcos ? Number(product.budgetAcos) : null,
        },
        actual,
        current,
        hourlyTrend,
        dataSource: dataSourceMeta,
      };
    }),

  getProductInventorySummary: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [product] = await db!.select().from(productProfiles)
        .where(and(eq(productProfiles.id, input.productId), eq(productProfiles.userId, ctx.user.id)));
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      const variants = await db!.select().from(productVariants)
        .where(eq(productVariants.productId, input.productId));

      const adapter = getLingxingAdapter();

      // Get seller list (with cache) to find matching sid
      const { matchedSid } = await findMatchedSid(adapter, product);
      console.log(`[InventorySummary] Product ${product.parentAsin}, matchedSid=${matchedSid}`);

      // Build search keywords from product's ASINs and SKUs for targeted FBA query
      const childAsins = variants.map(v => v.childAsin).filter(Boolean);
      const skus = variants.map(v => v.sku).filter(Boolean) as string[];
      const searchKeywords = [...childAsins, ...skus];

      // Fetch FBA inventory using v2 API (/erp/sc/data/fba/FbaStockLists)
      let invList: any[] = [];
      let dataSourceMeta: { source: 'real' | 'mock_mode' | 'mock_fallback'; reason?: string } = { source: 'real' };
      
      // Try searching by ASIN first using v2 FBA Stock API
      for (const keyword of [product.parentAsin, ...searchKeywords.slice(0, 3)]) {
        try {
          const invRes = await adapter.requestWithMockFallback({
            path: "/erp/sc/data/fba/FbaStockLists",
            body: { sid: matchedSid, offset: 0, length: 200, search_field: "asin", search_value: keyword },
          });
          if (invRes._meta && invRes._meta.source !== 'real') dataSourceMeta = invRes._meta;
          const rawInv = invRes.data || [];
          const items = Array.isArray(rawInv) ? rawInv : (rawInv as any).records || (rawInv as any).list || [];
          // Merge unique items
          for (const item of items) {
            const itemAsin = item.asin || item.fnsku || '';
            if (!invList.find((existing: any) => (existing.asin || existing.fnsku) === itemAsin)) {
              invList.push(item);
            }
          }
        } catch (err: any) {
          console.warn(`[InventorySummary] FBA v2 search for '${keyword}' failed: ${err.message}`);
        }
      }

      // If v2 search returned nothing, fallback to full list with filtering
      if (invList.length === 0) {
        try {
          const invRes = await adapter.requestWithMockFallback({
            path: "/erp/sc/data/fba/FbaStockLists",
            body: { sid: matchedSid, offset: 0, length: 500 },
          });
          const rawInv = invRes.data || [];
          const allItems = Array.isArray(rawInv) ? rawInv : (rawInv as any).records || (rawInv as any).list || [];
          invList = allItems.filter((inv: any) =>
            childAsins.includes(inv.asin) || skus.includes(inv.seller_sku) || inv.asin === product.parentAsin
          );
          console.log(`[InventorySummary] Fallback: ${allItems.length} total, ${invList.length} matched`);
        } catch (err: any) {
          console.warn(`[InventorySummary] Full FBA v2 list fetch error: ${err.message}`);
        }
      }
      console.log(`[InventorySummary] Found ${invList.length} inventory records for ${product.parentAsin}`);

      // Build inventory summary per variant
      let variantInventory: Array<{ childAsin: string; sku: string; title: string; fulfillableQty: number; inboundQty: number; reservedQty: number; avgDailySales: number; daysOfSupply: number }> = [];
      
      if (variants.length > 0) {
        variantInventory = variants.map(v => {
          const matched = invList.find((inv: Record<string, string>) =>
            inv.asin === v.childAsin || inv.seller_sku === v.sku || inv.fnsku === v.childAsin
          );
          const inv = matched as Record<string, number> | undefined;
          return {
            childAsin: v.childAsin,
            sku: v.sku || "",
            title: v.title || "",
            fulfillableQty: inv?.fulfillable_quantity || inv?.afn_fulfillable_quantity || 0,
            inboundQty: inv?.inbound_quantity || inv?.afn_inbound_quantity || 0,
            reservedQty: inv?.reserved_quantity || inv?.afn_reserved_quantity || 0,
            avgDailySales: inv?.avg_daily_sales || inv?.avg_daily_sales_30d || 0,
            daysOfSupply: inv?.days_of_supply || 0,
          };
        });
      } else if (invList.length > 0) {
        // No variants in DB, but FBA API returned data via parentAsin search
        // Use invList directly to build summary
        variantInventory = invList.map((inv: any) => ({
          childAsin: inv.asin || product.parentAsin,
          sku: inv.seller_sku || '',
          title: inv.product_name || product.title || '',
          fulfillableQty: inv.fulfillable_quantity || inv.afn_fulfillable_quantity || 0,
          inboundQty: inv.inbound_quantity || inv.afn_inbound_quantity || inv.afn_inbound_working_quantity || 0,
          reservedQty: inv.reserved_quantity || inv.afn_reserved_quantity || 0,
          avgDailySales: inv.avg_daily_sales || inv.avg_daily_sales_30d || 0,
          daysOfSupply: inv.days_of_supply || 0,
        }));
        console.log(`[InventorySummary] No variants, using ${invList.length} FBA items directly for ${product.parentAsin}`);
      }

      // Totals
      const totalFulfillable = variantInventory.reduce((s, v) => s + v.fulfillableQty, 0);
      const totalInbound = variantInventory.reduce((s, v) => s + v.inboundQty, 0);
      const totalReserved = variantInventory.reduce((s, v) => s + v.reservedQty, 0);
      const totalDailySales = variantInventory.reduce((s, v) => s + v.avgDailySales, 0);
      const avgDaysOfSupply = totalDailySales > 0 ? Math.round(totalFulfillable / totalDailySales) : 0;

      return {
        total: {
          fulfillableQty: totalFulfillable,
          inboundQty: totalInbound,
          reservedQty: totalReserved,
          totalQty: totalFulfillable + totalInbound + totalReserved,
          avgDailySales: round2(totalDailySales),
          daysOfSupply: avgDaysOfSupply,
          replenishStatus: avgDaysOfSupply < 7 ? "urgent" : avgDaysOfSupply < 14 ? "warning" : avgDaysOfSupply < 90 ? "normal" : "overstock",
        },
        variants: variantInventory,
        dataSource: dataSourceMeta,
      };
    }),

  getProductAdsSummary: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [product] = await db!.select().from(productProfiles)
        .where(and(eq(productProfiles.id, input.productId), eq(productProfiles.userId, ctx.user.id)));
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      const adapter = getLingxingAdapter();
      const { matchedSid } = await findMatchedSid(adapter, product);
      console.log(`[AdsSummary] Product ${product.parentAsin}, matchedSid=${matchedSid}`);

      // Get product variants for ASIN-based ad filtering
      const variants = await db!.select().from(productVariants)
        .where(eq(productVariants.productId, input.productId));
      const childAsins = variants.map(v => v.childAsin).filter(Boolean);
      const allAsins = [product.parentAsin, ...childAsins];
      console.log(`[AdsSummary] allAsins (parent+children): ${allAsins.join(', ')}`);

      let dataSourceMeta: { source: 'real' | 'mock_mode' | 'mock_fallback'; reason?: string } = { source: 'real' };

      // ═══ Strategy 1: Use ASIN→Campaign mapping from adAnalysis cache ═══
      // This is the most accurate method: spProductAds/sdProductAds tells us exactly
      // which child ASINs are in which campaigns
      let mappedCampaignIds = new Set<string>();
      let mappingSource = 'none';
      try {
        const { getAdAnalysisCache } = await import('./adAnalysis');
        const mapping = getAdAnalysisCache<any>('spProductAds_mapping');
        if (mapping?.asinToCampaigns) {
          const asinToCampaigns = mapping.asinToCampaigns as Record<string, string[]>;
          // Check BOTH parent ASIN and all child ASINs against the mapping
          for (const asin of allAsins) {
            const cids = asinToCampaigns[asin];
            if (cids) {
              for (const cid of cids) mappedCampaignIds.add(cid);
            }
          }
          mappingSource = 'cache';
          console.log(`[AdsSummary] ASIN mapping cache hit: found ${mappedCampaignIds.size} campaign IDs for ASINs ${allAsins.join(',')}`);
        } else {
          console.log(`[AdsSummary] ASIN mapping cache miss, will try fresh sync`);
        }
      } catch (err: any) {
        console.warn(`[AdsSummary] Failed to read adAnalysis cache: ${err.message}`);
      }

      // If cache miss, do a fresh spProductAds + sdProductAds fetch to build mapping
      if (mappedCampaignIds.size === 0) {
        try {
          const adPaths = [
            { path: "/pb/openapi/newad/spProductAds", type: "SP" },
            { path: "/pb/openapi/newad/sdProductAds", type: "SD" },
          ];
          for (const { path: adPath, type: adType } of adPaths) {
            try {
              const res = await adapter.requestWithMockFallback({
                path: adPath,
                body: { sid: matchedSid, offset: 0, length: 200 },
                headers: { "X-API-VERSION": "2" },
              });
              if (res._meta && res._meta.source !== 'real') dataSourceMeta = res._meta;
              const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
              // Filter items that match any of our ASINs (parent or child)
              for (const item of items) {
                const itemAsin = String(item.asin || item.advertised_asin || '');
                if (allAsins.includes(itemAsin)) {
                  const cid = String(item.campaign_id || '');
                  if (cid) mappedCampaignIds.add(cid);
                }
              }
              console.log(`[AdsSummary] Fresh ${adType} fetch: ${items.length} total ads, matched ${mappedCampaignIds.size} campaigns so far`);
            } catch (err: any) {
              console.warn(`[AdsSummary] ${adType} fetch failed: ${err.message}`);
            }
          }
          mappingSource = 'fresh';
        } catch (err: any) {
          console.warn(`[AdsSummary] Fresh ad mapping failed: ${err.message}`);
        }
      }

      // ═══ Strategy 2: Fetch all campaigns (SP + SD) and match by campaign_id from mapping ═══
      const campaignPaths = [
        { path: "/pb/openapi/newad/spCampaigns", type: "SP" },
        { path: "/pb/openapi/newad/sdCampaigns", type: "SD" },
      ];
      const allCampaigns: any[] = [];
      for (const { path: campPath, type: campType } of campaignPaths) {
        try {
          const adRes = await adapter.requestWithMockFallback({
            path: campPath,
            body: { sid: matchedSid, start_date: getDateNDaysAgo(30), end_date: getToday() },
            headers: { "X-API-VERSION": "2" },
          });
          if (adRes._meta && adRes._meta.source !== 'real') dataSourceMeta = adRes._meta;
          const rawAd = adRes.data || [];
          const campaigns = Array.isArray(rawAd) ? rawAd : (rawAd as any).records || (rawAd as any).list || [];
          // Tag each campaign with its type for display
          for (const c of campaigns) {
            c._adType = campType;
            c.campaign_name = c.campaign_name || c.name || 'Unknown';
          }
          allCampaigns.push(...campaigns);
          console.log(`[AdsSummary] Fetched ${campaigns.length} ${campType} campaigns`);
        } catch (err: any) {
          console.warn(`[AdsSummary] ${campType} campaign fetch failed: ${err.message}`);
        }
      }

      // Build a campaign lookup by ID
      const campaignById: Record<string, any> = {};
      for (const c of allCampaigns) {
        const cid = String(c.campaign_id || '');
        if (cid) campaignById[cid] = c;
      }

      // Match campaigns: primary = ASIN mapping, fallback = name matching
      let matchedCampaigns: any[] = [];
      if (mappedCampaignIds.size > 0) {
        // Use precise ASIN→Campaign mapping
        const mappedIds = Array.from(mappedCampaignIds);
        for (const cid of mappedIds) {
          if (campaignById[cid]) {
            matchedCampaigns.push(campaignById[cid]);
          }
        }
        console.log(`[AdsSummary] Matched ${matchedCampaigns.length} campaigns via ASIN mapping (${mappingSource})`);
      }

      // Fallback: also try name-based matching if ASIN mapping found nothing
      if (matchedCampaigns.length === 0) {
        matchedCampaigns = allCampaigns.filter((c: any) => {
          const name = String(c.campaign_name || c.name || '').toLowerCase();
          return allAsins.some(asin => name.includes(asin.toLowerCase())) ||
                 (product.title && product.title.split(' ').slice(0, 3).some((word: string) =>
                   word.length > 3 && name.includes(word.toLowerCase())
                 ));
        });
        console.log(`[AdsSummary] Fallback name matching: ${matchedCampaigns.length} campaigns`);
      }

      console.log(`[AdsSummary] Final: ${allCampaigns.length} total campaigns, ${matchedCampaigns.length} matched for ${product.parentAsin}`);

      // ═══ Strategy 3: Also fetch product-level ad reports for accurate totals ═══
      let productAdData: any[] = [];
      try {
        // Fetch reports for each child ASIN (not just parent ASIN)
        for (const asin of allAsins) {
          const productAdRes = await adapter.requestWithMockFallback({
            path: "/pb/openapi/newad/spProductAdReports",
            body: { sid: matchedSid, report_date: getDateNDaysAgo(1), show_detail: 0, offset: 0, length: 200, asin },
            headers: { "X-API-VERSION": "2" },
          });
          if (productAdRes._meta && productAdRes._meta.source !== 'real') dataSourceMeta = productAdRes._meta;
          const rawProductAd = productAdRes.data || [];
          const allProductAds = Array.isArray(rawProductAd) ? rawProductAd : (rawProductAd as any).records || (rawProductAd as any).list || [];
          // Filter by this specific ASIN
          const matched = allProductAds.filter((item: any) =>
            String(item.asin || item.advertised_asin || '') === asin
          );
          productAdData.push(...matched);
        }
        console.log(`[AdsSummary] Product ad reports: ${productAdData.length} matched across ${allAsins.length} ASINs`);
      } catch (err: any) {
        console.warn(`[AdsSummary] Product ad report fetch failed: ${err.message}`);
      }

      // ═══ Compute totals and build campaign list ═══
      let totalSpend = 0, totalSales = 0, totalClicks = 0, totalImpressions = 0, totalOrders = 0;
      const campaignList: Array<{
        campaignId: string; name: string; adType: string; status: string; spend: number; sales: number;
        acos: number; roas: number; clicks: number; impressions: number;
      }> = [];

      // Use product-level ad data for totals if available (most accurate)
      if (productAdData.length > 0) {
        for (const item of productAdData) {
          totalSpend += Number(item.cost || item.spend || 0);
          totalSales += Number(item.sales || item.attributed_sales || 0);
          totalClicks += Number(item.clicks || 0);
          totalImpressions += Number(item.impressions || 0);
          totalOrders += Number(item.orders || item.attributed_orders || 0);
        }
      }

      // Build campaign list from matched campaigns
      const activeCampaignStates = ['enabled', 'active', 'running'];
      for (const c of matchedCampaigns) {
        const camp = c as Record<string, unknown>;
        const spend = Number(camp.cost || camp.spend || 0);
        const sales = Number(camp.sales || camp.attributed_sales || 0);
        const clicks = Number(camp.clicks || 0);
        const impressions = Number(camp.impressions || 0);
        const orders = Number(camp.orders || camp.attributed_orders || 0);

        // If no product-level data, accumulate from ACTIVE campaigns
        const campState = String((camp as any).state || (camp as any).status || '').toLowerCase();
        const isCampActive = activeCampaignStates.includes(campState) || campState === '';
        if (productAdData.length === 0 && isCampActive) {
          totalSpend += spend;
          totalSales += sales;
          totalClicks += clicks;
          totalImpressions += impressions;
          totalOrders += orders;
        }

        campaignList.push({
          campaignId: String(camp.campaign_id || ''),
          name: String(camp.campaign_name || camp.name || "Unknown"),
          adType: String(camp._adType || 'SP'),
          status: String(camp.state || camp.status || "enabled"),
          spend: round2(spend),
          sales: round2(sales),
          acos: sales > 0 ? round2(spend / sales * 100) : 0,
          roas: spend > 0 ? round2(sales / spend) : 0,
          clicks,
          impressions,
        });
      }

      return {
        summary: {
          totalSpend: round2(totalSpend),
          totalSales: round2(totalSales),
          totalClicks,
          totalImpressions,
          totalOrders,
          acos: totalSales > 0 ? round2(totalSpend / totalSales * 100) : 0,
          roas: totalSpend > 0 ? round2(totalSales / totalSpend) : 0,
          ctr: totalImpressions > 0 ? round2(totalClicks / totalImpressions * 100) : 0,
          cvr: totalClicks > 0 ? round2(totalOrders / totalClicks * 100) : 0,
        },
        campaigns: campaignList,
        matchInfo: {
          mappingSource,
          mappedCampaignCount: mappedCampaignIds.size,
          totalCampaignCount: allCampaigns.length,
          matchedCampaignCount: matchedCampaigns.length,
          allAsins,
          productAdReportCount: productAdData.length,
        },
        dataSource: dataSourceMeta,
      };
    }),

  // ─── Product Competitor Monitors (reuse existing table) ───

  getProductCompetitors: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [product] = await db!.select().from(productProfiles)
        .where(and(eq(productProfiles.id, input.productId), eq(productProfiles.userId, ctx.user.id)));
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      // Get competitor monitors linked to this product's ASIN
      const monitors = await db!.select().from(competitorMonitors)
        .where(and(
          eq(competitorMonitors.userId, ctx.user.id),
          eq(competitorMonitors.ownAsin, product.parentAsin)
        ))
        .orderBy(desc(competitorMonitors.createdAt));

      // Get latest snapshots for each monitor
      const enriched = await Promise.all(monitors.map(async (m) => {
        const snapshots = await db!.select().from(competitorSnapshots)
          .where(eq(competitorSnapshots.monitorId, m.id))
          .orderBy(desc(competitorSnapshots.snapshotDate))
          .limit(7);
        return { ...m, recentSnapshots: snapshots.reverse() };
      }));
      return enriched;
    }),
  // ═══════════════════════════════════════════════════════
  // ─── Operations Plan CRUD ───
  // ═══════════════════════════════════════════════════════

  listPlans: protectedProcedure.input(z.object({ productProfileId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    const { MANAGER_ROLES } = await import("../../shared/const");
    const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
    const conditions = [eq(opsPlans.productProfileId, input.productProfileId)];
    if (!isManager) {
      conditions.push(eq(opsPlans.userId, ctx.user.id));
    }
    return db!.select().from(opsPlans)
      .where(and(...conditions))
      .orderBy(desc(opsPlans.updatedAt));
  }),

  getPlan: protectedProcedure.input(z.object({ planId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    const { MANAGER_ROLES } = await import("../../shared/const");
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
    const { MANAGER_ROLES } = await import("../../shared/const");
    const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
    const updateConditions = [eq(opsPlans.id, planId)];
    if (!isManager) updateConditions.push(eq(opsPlans.userId, ctx.user.id));
    await db!.update(opsPlans).set(cleanUpdates).where(and(...updateConditions));
    return { success: true };
  }),

  deletePlan: protectedProcedure.input(z.object({ planId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const { MANAGER_ROLES } = await import("../../shared/const");
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

  // ═══════════════════════════════════════════════════════
  // ─── Conversion Comparison CRUD ───
  // ═══════════════════════════════════════════════════════

  listComparisons: protectedProcedure.input(z.object({ productProfileId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    return db!.select().from(conversionComparisons)
      .where(and(eq(conversionComparisons.userId, ctx.user.id), eq(conversionComparisons.productProfileId, input.productProfileId)))
      .orderBy(desc(conversionComparisons.updatedAt));
  }),

  getComparison: protectedProcedure.input(z.object({ comparisonId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    const [comp] = await db!.select().from(conversionComparisons)
      .where(and(eq(conversionComparisons.id, input.comparisonId), eq(conversionComparisons.userId, ctx.user.id)));
    if (!comp) throw new TRPCError({ code: "NOT_FOUND", message: "Comparison not found" });
    return comp;
  }),

  createComparison: protectedProcedure.input(z.object({
    productProfileId: z.number(),
    comparisonName: z.string().min(1),
    ownAsin: z.string().min(1),
    competitorAsins: z.array(z.string()).optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
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
    const db = await getDb();
    await db!.delete(conversionScores).where(eq(conversionScores.comparisonId, input.comparisonId));
    await db!.delete(conversionSuggestions).where(eq(conversionSuggestions.comparisonId, input.comparisonId));
    await db!.delete(conversionComparisons).where(and(eq(conversionComparisons.id, input.comparisonId), eq(conversionComparisons.userId, ctx.user.id)));
    return { success: true };
  }),

  // ─── Check Items (fixed template + user custom) ───

  getCheckItems: protectedProcedure.input(z.object({ includeHidden: z.boolean().optional() }).optional()).query(async ({ ctx, input }) => {
    const db = await getDb();
    // Auto-initialize default check items if none exist
    const existing = await db!.select({ count: sql<number>`count(*)` }).from(conversionCheckItems)
      .where(isNull(conversionCheckItems.userId));
    if (Number(existing[0]?.count) === 0) {
      console.log('[ConversionCheck] No default items found, auto-initializing 129 check items...');
      const defaultItems = getDefault129CheckItems();
      for (const item of defaultItems) {
        await db!.insert(conversionCheckItems).values({ ...item, userId: null });
      }
      console.log(`[ConversionCheck] Initialized ${defaultItems.length} default check items`);
    }
    // Get system defaults (userId IS NULL) + user custom items
    const items = await db!.select().from(conversionCheckItems)
      .where(sql`${conversionCheckItems.userId} IS NULL OR ${conversionCheckItems.userId} = ${ctx.user.id}`)
      .orderBy(asc(conversionCheckItems.categoryIndex), asc(conversionCheckItems.sortOrder));
    // Get user overrides
    const overrides = await db!.select().from(checkItemOverrides)
      .where(eq(checkItemOverrides.userId, ctx.user.id));
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
    const db = await getDb();
    const existing = await db!.select({ count: sql<number>`count(*)` }).from(conversionCheckItems)
      .where(isNull(conversionCheckItems.userId));
    if (Number(existing[0]?.count) > 0) return { message: "Default items already exist", count: Number(existing[0]?.count) };
    const defaultItems = getDefault129CheckItems();
    for (const item of defaultItems) {
      await db!.insert(conversionCheckItems).values({ ...item, userId: null });
    }
    return { message: "Initialized", count: defaultItems.length };
  }),

  // Force reset: delete all system check items + overrides + scores + suggestions, then re-init
  resetAndReinitCheckItems: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    // 1. Delete all system default check items (userId IS NULL)
    await db!.delete(conversionCheckItems).where(isNull(conversionCheckItems.userId));
    // 2. Delete all user overrides (they reference old check item IDs)
    await db!.delete(checkItemOverrides).where(eq(checkItemOverrides.userId, ctx.user.id));
    // 3. Re-insert new 129 items
    const defaultItems = getDefault129CheckItems();
    for (const item of defaultItems) {
      await db!.insert(conversionCheckItems).values({ ...item, userId: null });
    }
    console.log(`[ConversionCheck] Reset & re-initialized ${defaultItems.length} check items for user ${ctx.user.id}`);
    return { message: "Reset and re-initialized", count: defaultItems.length };
  }),

  addCustomCheckItem: protectedProcedure.input(z.object({
    categoryIndex: z.number(),
    categoryName: z.string(),
    subDimension: z.string(),
    standard: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
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
    const db = await getDb();
    // Check if item exists
    const [item] = await db!.select().from(conversionCheckItems).where(eq(conversionCheckItems.id, input.checkItemId));
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: '检查项不存在' });

    // If it's user's own custom item, edit directly
    if (item.isCustom === 1 && item.userId === ctx.user.id) {
      await db!.update(conversionCheckItems).set({
        ...(input.subDimension !== undefined ? { subDimension: input.subDimension } : {}),
        ...(input.standard !== undefined ? { standard: input.standard } : {}),
      }).where(eq(conversionCheckItems.id, input.checkItemId));
      return { success: true, type: 'direct_edit' as const };
    }

    // For system items, create/update user override
    const [existingOverride] = await db!.select().from(checkItemOverrides)
      .where(and(eq(checkItemOverrides.userId, ctx.user.id), eq(checkItemOverrides.checkItemId, input.checkItemId)));

    if (existingOverride) {
      await db!.update(checkItemOverrides).set({
        ...(input.subDimension !== undefined ? { customSubDimension: input.subDimension } : {}),
        ...(input.standard !== undefined ? { customStandard: input.standard } : {}),
        updatedAt: new Date(),
      }).where(eq(checkItemOverrides.id, existingOverride.id));
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
    const db = await getDb();
    // Check if item exists
    const [item] = await db!.select().from(conversionCheckItems).where(eq(conversionCheckItems.id, input.checkItemId));
    if (!item) throw new TRPCError({ code: 'NOT_FOUND', message: '检查项不存在' });

    // Create/update user override
    const [existingOverride] = await db!.select().from(checkItemOverrides)
      .where(and(eq(checkItemOverrides.userId, ctx.user.id), eq(checkItemOverrides.checkItemId, input.checkItemId)));

    if (existingOverride) {
      await db!.update(checkItemOverrides).set({
        isHidden: input.isHidden ? 1 : 0,
        updatedAt: new Date(),
      }).where(eq(checkItemOverrides.id, existingOverride.id));
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
    const db = await getDb();
    await db!.delete(checkItemOverrides)
      .where(and(eq(checkItemOverrides.userId, ctx.user.id), eq(checkItemOverrides.checkItemId, input.checkItemId)));
    return { success: true };
  }),

  removeCustomCheckItem: protectedProcedure.input(z.object({ itemId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    // Also remove any overrides for this item
    await db!.delete(checkItemOverrides)
      .where(and(eq(checkItemOverrides.userId, ctx.user.id), eq(checkItemOverrides.checkItemId, input.itemId)));
    await db!.delete(conversionCheckItems)
      .where(and(eq(conversionCheckItems.id, input.itemId), eq(conversionCheckItems.userId, ctx.user.id), eq(conversionCheckItems.isCustom, 1)));
    return { success: true };
  }),

  // ─── Conversion Scores CRUD ───

  getScores: protectedProcedure.input(z.object({ comparisonId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    return db!.select().from(conversionScores)
      .where(eq(conversionScores.comparisonId, input.comparisonId));
  }),

  updateScore: protectedProcedure.input(z.object({
    scoreId: z.number(),
    score: z.number().min(1).max(5).optional(),
    reason: z.string().optional(),
    isLocked: z.boolean().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const updates: Record<string, any> = {};
    if (input.score !== undefined) {
      updates.score = input.score;
      updates.source = "manual"; // User manually edited score
    }
    if (input.reason !== undefined) updates.reason = input.reason;
    if (input.isLocked !== undefined) updates.isLocked = input.isLocked ? 1 : 0;
    await db!.update(conversionScores).set(updates).where(eq(conversionScores.id, input.scoreId));
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
    const db = await getDb();
    for (const s of input.scores) {
      const updates: Record<string, any> = {};
      if (s.score !== undefined) {
        updates.score = s.score;
        updates.source = "manual"; // User manually edited score
      }
      if (s.reason !== undefined) updates.reason = s.reason;
      if (s.isLocked !== undefined) updates.isLocked = s.isLocked ? 1 : 0;
      await db!.update(conversionScores).set(updates).where(eq(conversionScores.id, s.scoreId));
    }
    return { success: true };
  }),

  // ─── AI Scoring (Mock crawl + AI evaluate) ───

  triggerAiScoring: protectedProcedure.input(z.object({
    comparisonId: z.number(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const [comp] = await db!.select().from(conversionComparisons)
      .where(eq(conversionComparisons.id, input.comparisonId));
    if (!comp) throw new TRPCError({ code: "NOT_FOUND" });

    // Update status to crawling
    await db!.update(conversionComparisons).set({ status: "crawling" as any })
      .where(eq(conversionComparisons.id, input.comparisonId));

    const allAsins = [comp.ownAsin, ...JSON.parse((comp.competitorAsins as string) || "[]")];
    const checkItems = await db!.select().from(conversionCheckItems)
      .where(sql`${conversionCheckItems.userId} IS NULL OR ${conversionCheckItems.userId} = ${ctx.user.id}`)
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
      .where(eq(conversionComparisons.id, input.comparisonId));

    // Delete existing unlocked scores for this comparison
    const lockedScores = await db!.select().from(conversionScores)
      .where(and(
        eq(conversionScores.comparisonId, input.comparisonId),
        eq(conversionScores.isLocked, 1)
      ));
    const lockedKeys = new Set(lockedScores.map(s => `${s.checkItemId}:${s.asin}`));
    await db!.delete(conversionScores)
      .where(and(
        eq(conversionScores.comparisonId, input.comparisonId),
        eq(conversionScores.isLocked, 0)
      ));

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
      .where(and(eq(conversionScores.comparisonId, input.comparisonId), eq(conversionScores.asin, comp.ownAsin)));
    // 只计算有实际分数的项，跳过无数据的项
    const scoredItems = ownScores.filter(s => s.score !== null && s.score > 0);
    const noDataItems = ownScores.filter(s => s.score === null || s.source === 'no_data');
    const avgScore = scoredItems.length > 0
      ? round2(scoredItems.reduce((sum, s) => sum + (s.score || 0), 0) / scoredItems.length)
      : 0;

    await db!.update(conversionComparisons).set({
      overallOwnScore: String(avgScore),
      status: "completed" as any,
    }).where(eq(conversionComparisons.id, input.comparisonId));

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
    const db = await getDb();
    const [comp] = await db!.select().from(conversionComparisons)
      .where(eq(conversionComparisons.id, input.comparisonId));
    if (!comp) throw new TRPCError({ code: "NOT_FOUND" });

    const competitorAsins: string[] = JSON.parse((comp.competitorAsins as string) || "[]");
    const allScores = await db!.select().from(conversionScores)
      .where(eq(conversionScores.comparisonId, input.comparisonId));
    const checkItems = await db!.select().from(conversionCheckItems)
      .where(sql`${conversionCheckItems.userId} IS NULL OR ${conversionCheckItems.userId} = ${ctx.user.id}`);

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
      .where(and(eq(conversionSuggestions.comparisonId, input.comparisonId), eq(conversionSuggestions.isLocked, 0)));

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
        .where(and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          eq(conversionSuggestions.categoryName, cat),
          eq(conversionSuggestions.isLocked, 1)
        ));
      if (locked.length > 0) return null;

      let suggestion = "";
      let gapAnalysis = "";
      let priority: "high" | "medium" | "low" = "medium";
      let expectedEffect = "";

      try {
        const response = await invokeLLM({
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
      }

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
    });

    const results = (await Promise.all(suggestionPromises)).filter(Boolean);
    return { success: true, suggestionsGenerated: results.length };
  }),

  getSuggestions: protectedProcedure.input(z.object({ comparisonId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    return db!.select().from(conversionSuggestions)
      .where(eq(conversionSuggestions.comparisonId, input.comparisonId))
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
    const db = await getDb();
    const { suggestionId, ...updates } = input;
    const cleanUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) {
        if (k === "isLocked") cleanUpdates[k] = v ? 1 : 0;
        else cleanUpdates[k] = v;
      }
    }
    await db!.update(conversionSuggestions).set(cleanUpdates).where(eq(conversionSuggestions.id, suggestionId));
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
    const db = await getDb();
    let suggestions;

    if (input.mode === "locked_low_score") {
      // Sync all locked suggestions where own score <= threshold
      suggestions = await db!.select().from(conversionSuggestions)
        .where(and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          eq(conversionSuggestions.isLocked, 1),
          sql`CAST(${conversionSuggestions.ownScore} AS DECIMAL) <= ${input.scoreThreshold}`
        ));
    } else if (input.mode === "all_locked") {
      // Sync all locked suggestions
      suggestions = await db!.select().from(conversionSuggestions)
        .where(and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          eq(conversionSuggestions.isLocked, 1)
        ));
    } else if (input.suggestionIds.length > 0) {
      // Sync specific selected suggestions
      suggestions = await db!.select().from(conversionSuggestions)
        .where(and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          inArray(conversionSuggestions.id, input.suggestionIds)
        ));
    } else {
      // Fallback: sync all locked suggestions (backward compat)
      suggestions = await db!.select().from(conversionSuggestions)
        .where(and(
          eq(conversionSuggestions.comparisonId, input.comparisonId),
          eq(conversionSuggestions.isLocked, 1)
        ));
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
        .where(eq(opsPlanActions.id, actionResult.insertId));

      // Link suggestion to action
      await db!.update(conversionSuggestions).set({ linkedPlanActionId: actionResult.insertId })
        .where(eq(conversionSuggestions.id, sug.id));

      created++;
    }
    return { success: true, actionsCreated: created };
  }),

  // ═══════════════════════════════════════════════════════
  // ─── Execution Reviews (执行复盘) ───
  // ═══════════════════════════════════════════════════════

  listExecutionReviews: protectedProcedure
    .input(z.object({ productProfileId: z.number(), parentAsin: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const { MANAGER_ROLES } = await import("../../shared/const");
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
        .where(and(...conditions))
        .orderBy(desc(executionReviews.createdAt));
    }),

  createExecutionReview: protectedProcedure
    .input(z.object({
      productProfileId: z.number(),
      parentAsin: z.string().optional(),
      planId: z.number().optional(),
      period: z.string().min(1),
      periodType: z.enum(["weekly", "monthly", "quarterly"]).optional().default("weekly"),
      // 基线数据：通过选择周度自动拓取
      baselineWeekStart: z.string().optional(),
      baselineWeekEnd: z.string().optional(),
      // 目标数据：通过选择周度自动拓取
      targetWeekStart: z.string().optional(),
      targetWeekEnd: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { baselineWeekStart, baselineWeekEnd, targetWeekStart, targetWeekEnd, ...rest } = input;

      // Auto-fetch baseline data from imported weekly data
      let baselineData: Record<string, any> = {};
      if (baselineWeekStart && baselineWeekEnd && input.parentAsin) {
        const effectiveUserId = await resolveDataUserId(db!, ctx.user);
        const weeklyRows = await db!.select().from(lingxingProductWeekly)
          .where(and(
            eq(lingxingProductWeekly.userId, effectiveUserId),
            eq(lingxingProductWeekly.parentAsin, input.parentAsin),
            eq(lingxingProductWeekly.weekStartDate, baselineWeekStart),
            eq(lingxingProductWeekly.weekEndDate, baselineWeekEnd),
          ));

        if (weeklyRows.length > 0) {
          let totalSales = 0, organicOrders = 0, adOrders = 0;
          let ratingScore = '0', ratingCount = 0;
          let subcategoryRank: number | null = null;
          let profitMarginSum = 0, convRateSum = 0;
          let profitMarginCount = 0, convRateCount = 0;

          for (const row of weeklyRows) {
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

          const s = new Date(baselineWeekStart + 'T00:00:00');
          const e = new Date(baselineWeekEnd + 'T00:00:00');
          const weekLabel = `${(s.getMonth()+1).toString().padStart(2,'0')}/${s.getDate().toString().padStart(2,'0')}-${(e.getMonth()+1).toString().padStart(2,'0')}/${e.getDate().toString().padStart(2,'0')}`;

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

      // Auto-fetch target data from imported weekly data
      let targetData: Record<string, any> = {};
      if (targetWeekStart && targetWeekEnd && input.parentAsin) {
        const effectiveUserId2 = await resolveDataUserId(db!, ctx.user);
        const targetRows = await db!.select().from(lingxingProductWeekly)
          .where(and(
            eq(lingxingProductWeekly.userId, effectiveUserId2),
            eq(lingxingProductWeekly.parentAsin, input.parentAsin),
            eq(lingxingProductWeekly.weekStartDate, targetWeekStart),
            eq(lingxingProductWeekly.weekEndDate, targetWeekEnd),
          ));

        if (targetRows.length > 0) {
          let tSales = 0, tOrgOrders = 0, tAdOrders = 0;
          let tRatingScore = '0', tRatingCount = 0;
          let tSubcategoryRank: number | null = null;
          let tConvRateSum = 0, tConvRateCount = 0;

          for (const row of targetRows) {
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

          const ts = new Date(targetWeekStart + 'T00:00:00');
          const te = new Date(targetWeekEnd + 'T00:00:00');
          const targetWeekLabel = `${(ts.getMonth()+1).toString().padStart(2,'0')}/${ts.getDate().toString().padStart(2,'0')}-${(te.getMonth()+1).toString().padStart(2,'0')}/${te.getDate().toString().padStart(2,'0')}`;

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
      const db = await getDb();
      const { MANAGER_ROLES } = await import("../../shared/const");
      const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      const { reviewId, ...updates } = input;
      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length > 0) {
        const conds = [eq(executionReviews.id, reviewId)];
        if (!isManager) conds.push(eq(executionReviews.userId, ctx.user.id));
        await db!.update(executionReviews).set(clean).where(and(...conds));
      }
      return { updated: true };
    }),

  deleteExecutionReview: protectedProcedure
    .input(z.object({ reviewId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const { MANAGER_ROLES } = await import("../../shared/const");
      const isManager = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      const conds = [eq(executionReviews.id, input.reviewId)];
      if (!isManager) conds.push(eq(executionReviews.userId, ctx.user.id));
      await db!.delete(executionReviews).where(and(...conds));
      return { deleted: true };
    }),

  aiReviewAnalysis: protectedProcedure
    .input(z.object({ reviewId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [review] = await db!.select().from(executionReviews).where(eq(executionReviews.id, input.reviewId));
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

      const resp = await invokeLLM({
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
      await db!.update(executionReviews).set({ aiAnalysis: analysis }).where(eq(executionReviews.id, input.reviewId));
      return { analysis };
    }),

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

  // ─── Sync Products from Lingxing ERP ───
  syncFromLingxing: protectedProcedure.mutation(async ({ ctx }) => {
    const adapter = getLingxingAdapter();
    const db = await getDb();
    
    // Get all seller stores first
    let sellers: any[] = [];
    try {
      const sellerRes = await adapter.request({ path: "/erp/sc/data/seller/lists" });
      const sellerRaw = sellerRes.data || [];
      sellers = Array.isArray(sellerRaw) ? sellerRaw : (sellerRaw as any)?.records || (sellerRaw as any)?.list || [];
    } catch (err: any) {
      console.error(`[SyncProducts] Failed to get sellers: ${err.message}`);
    }
    
    // Get existing products for this user to avoid duplicates
    const existing = await db!.select({ parentAsin: productProfiles.parentAsin, marketplace: productProfiles.marketplace })
      .from(productProfiles)
      .where(eq(productProfiles.userId, ctx.user.id));
    const existingSet = new Set(existing.map(e => `${e.parentAsin}_${e.marketplace}`));
    
    let synced = 0;
    let skipped = 0;
    const marketplaceMap: Record<number, string> = {
      1: 'US', 2: 'CA', 3: 'MX', 4: 'UK', 5: 'DE', 6: 'FR', 7: 'IT', 8: 'ES', 9: 'JP', 10: 'AU', 11: 'IN', 12: 'AE', 13: 'SA', 14: 'SG', 15: 'NL', 16: 'SE', 17: 'PL', 18: 'BE', 19: 'BR',
    };
    
    // Query listing data from each store
    for (const seller of sellers.slice(0, 10)) {
      const sid = seller.sid;
      const marketplace = marketplaceMap[seller.mid] || 'US';
      try {
        const res = await adapter.requestWithMockFallback({
          path: "/erp/sc/data/mws/listing",
          body: { sid: Number(sid), offset: 0, length: 200 },
        });
        const listingsRaw = res.data || [];
        const listings = Array.isArray(listingsRaw) ? listingsRaw : (listingsRaw as any)?.records || (listingsRaw as any)?.list || [];
        
        // Group by parent ASIN (asin1 or asin)
        const parentMap = new Map<string, any>();
        for (const item of listings) {
          const asin = item.asin1 || item.asin || item.parent_asin;
          if (!asin) continue;
          if (!parentMap.has(asin)) {
            // Enhanced status mapping: support number/string/various field names
            const rawStatus = item.status ?? item.listing_status ?? item.item_status ?? item.product_status ?? '';
            const statusStr = String(rawStatus).toLowerCase().trim();
            const isActive = statusStr === 'active' || statusStr === '1' || statusStr === 'true' || statusStr === 'enabled' || statusStr === 'in stock' || statusStr === 'buyable';
            parentMap.set(asin, {
              parentAsin: asin,
              title: item.item_name || item.product_name || item.title || asin,
              brand: item.brand || '',
              category: item.item_type || item.product_type || '',
              marketplace,
              imageUrl: item.main_image || item.smallImageUrl || '',
              status: isActive ? 'active' : 'inactive',
              storeName: seller.name || seller.wname || seller.account_name || '',
              variants: [],
            });
          }
          // Add as variant (including self for single-variant products)
          const childAsin = item.asin || item.child_asin;
          const sku = item.msku || item.seller_sku || '';
          if (childAsin && sku) {
            // Avoid duplicate variants
            const existingVariant = parentMap.get(asin)!.variants.find(
              (v: any) => v.childAsin === childAsin && v.sku === sku
            );
            if (!existingVariant) {
              parentMap.get(asin)!.variants.push({
                childAsin,
                sku,
                title: item.item_name || item.title || '',
                price: item.price ? String(item.price) : undefined,
              });
            }
          } else if (childAsin) {
            // Even without SKU, add variant with ASIN only
            const existingVariant = parentMap.get(asin)!.variants.find(
              (v: any) => v.childAsin === childAsin
            );
            if (!existingVariant) {
              parentMap.get(asin)!.variants.push({
                childAsin,
                sku: sku || '',
                title: item.item_name || item.title || '',
                price: item.price ? String(item.price) : undefined,
              });
            }
          }
        }
        
        // Insert new products or update existing ones
        let updated = 0;
        for (const [asin, product] of Array.from(parentMap.entries())) {
          const key = `${asin}_${marketplace}`;
          if (existingSet.has(key)) {
            // Update existing product status, title, image, storeName
            const [existingProduct] = await db!.select({ id: productProfiles.id })
              .from(productProfiles)
              .where(and(
                eq(productProfiles.userId, ctx.user.id),
                eq(productProfiles.parentAsin, asin),
                eq(productProfiles.marketplace, marketplace)
              ));
            if (existingProduct) {
              await db!.update(productProfiles)
                .set({
                  status: product.status as any,
                  title: product.title.substring(0, 500),
                  imageUrl: product.imageUrl || undefined,
                  storeName: product.storeName || undefined,
                  brand: product.brand || undefined,
                })
                .where(eq(productProfiles.id, existingProduct.id));
              
              // Sync variants for existing products too
              if (product.variants.length > 0) {
                // Get existing variants
                const existingVariants = await db!.select({ childAsin: productVariants.childAsin, sku: productVariants.sku })
                  .from(productVariants)
                  .where(eq(productVariants.productId, existingProduct.id));
                const existingVariantSet = new Set(existingVariants.map(v => `${v.childAsin}_${v.sku}`));
                
                // Insert only new variants
                const newVariants = product.variants.filter((v: any) => !existingVariantSet.has(`${v.childAsin}_${v.sku}`));
                if (newVariants.length > 0) {
                  await db!.insert(productVariants).values(
                    newVariants.map((v: any) => ({
                      productId: existingProduct.id,
                      childAsin: v.childAsin,
                      sku: v.sku,
                      title: v.title,
                      price: v.price,
                    }))
                  );
                  console.log(`[SyncProducts] Added ${newVariants.length} new variants for ${asin}`);
                }
              }
            }
            updated++;
            skipped++;
            continue;
          }
          existingSet.add(key);
          
          const [result] = await db!.insert(productProfiles).values({
            userId: ctx.user.id,
            parentAsin: product.parentAsin,
            title: product.title.substring(0, 500),
            brand: product.brand || undefined,
            category: product.category || undefined,
            marketplace: product.marketplace,
            imageUrl: product.imageUrl || undefined,
            status: product.status as any,
            storeName: product.storeName || undefined,
          });
          
          // Insert variants
          if (product.variants.length > 0) {
            await db!.insert(productVariants).values(
              product.variants.map((v: any) => ({
                productId: result.insertId,
                childAsin: v.childAsin,
                sku: v.sku,
                title: v.title,
                price: v.price,
              }))
            );
          }
          synced++;
        }
      } catch (err: any) {
        console.warn(`[SyncProducts] sid=${sid}: ${err.message}`);
      }
    }
    
    return { synced, skipped, updated: skipped, total: synced + skipped };
  }),

  // ─── 批量分配运营负责人 ───
  batchAssignOperator: protectedProcedure
    .input(z.object({
      productIds: z.array(z.number()).min(1),
      operator: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const now = new Date();
      let updated = 0;
      for (const pid of input.productIds) {
        await db!.update(productProfiles)
          .set({ operator: input.operator, updatedAt: now })
          .where(and(
            eq(productProfiles.id, pid),
            eq(productProfiles.userId, ctx.user.id)
          ));
        updated++;
      }
      return { updated, operator: input.operator };
    }),

  // ─── 获取所有运营人员列表（已分配过的 + 团队成员） ───
  listOperators: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    // 1. 已分配过的运营名称
    const assigned = await db!.selectDistinct({ operator: productProfiles.operator })
      .from(productProfiles)
      .where(and(
        eq(productProfiles.userId, ctx.user.id),
        sql`${productProfiles.operator} IS NOT NULL AND ${productProfiles.operator} != ''`
      ));
    const assignedNames = assigned.map(r => r.operator).filter(Boolean) as string[];
    
    // 2. 团队成员名称（活跃用户）
    const teamMembers = await db!.select({ id: users.id, name: users.name, role: users.role })
      .from(users)
      .where(eq(users.status, 'active'));
    const memberNames = teamMembers.map(u => u.name).filter(Boolean) as string[];
    
    // 3. 合并去重
    const allNames = Array.from(new Set([...memberNames, ...assignedNames]));
    return allNames;
  }),

  // ─── 获取团队成员详情列表 ───
  listTeamMembers: protectedProcedure.query(async () => {
    const db = await getDb();
    const members = await db!.select({
      id: users.id,
      name: users.name,
      role: users.role,
      department: users.department,
      jobTitle: users.jobTitle,
    }).from(users).where(eq(users.status, 'active'));
    return members;
  }),

  // ─── 产品数据看板（库存/利润/广告汇总从领星抓取） ───
  getProductDashboard: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      period: z.enum(["day", "week", "month"]).default("month"),
    }))
    .query(async ({ ctx, input }) => {
      const adapter = getLingxingAdapter();
      const db = await getDb();
      
      // Get user's products
      const whereClause = input.marketplace
        ? and(eq(productProfiles.userId, ctx.user.id), eq(productProfiles.marketplace, input.marketplace))
        : eq(productProfiles.userId, ctx.user.id);
      const products = await db!.select().from(productProfiles).where(whereClause);
      
      const totalProducts = products.length;
      const activeProducts = products.filter(p => p.status === 'active').length;
      const inactiveProducts = products.filter(p => p.status === 'inactive').length;
      
      // Calculate date range based on period
      const now = new Date();
      let startDate: string;
      let prevStartDate: string;
      let prevEndDate: string;
      if (input.period === 'day') {
        startDate = new Date(now.getTime() - 86400000).toISOString().split('T')[0];
        prevStartDate = new Date(now.getTime() - 172800000).toISOString().split('T')[0];
        prevEndDate = startDate;
      } else if (input.period === 'week') {
        startDate = new Date(now.getTime() - 7 * 86400000).toISOString().split('T')[0];
        prevStartDate = new Date(now.getTime() - 14 * 86400000).toISOString().split('T')[0];
        prevEndDate = startDate;
      } else {
        startDate = new Date(now.getTime() - 30 * 86400000).toISOString().split('T')[0];
        prevStartDate = new Date(now.getTime() - 60 * 86400000).toISOString().split('T')[0];
        prevEndDate = startDate;
      }
      const endDate = now.toISOString().split('T')[0];
      
      // Fetch profit data from Lingxing (use correct field names per API docs)
      let profitData = { revenue: 0, cost: 0, profit: 0, profitMargin: 0, adSpend: 0, fbaFee: 0, orderCount: 0, unitCount: 0 };
      let prevProfitData = { revenue: 0, cost: 0, profit: 0, profitMargin: 0, adSpend: 0, fbaFee: 0, orderCount: 0, unitCount: 0 };
      try {
        const profitRes = await adapter.requestWithMockFallback({
          path: "/bd/profit/report/open/report/msku/list",
          body: { offset: 0, length: 1000, startDate: startDate, endDate: endDate, monthlyQuery: false, orderStatus: "All" },
        });
        const profitRaw = profitRes.data || [];
        const profitList = Array.isArray(profitRaw) ? profitRaw : (profitRaw as any).records || (profitRaw as any).list || [];
        for (const item of profitList) {
          profitData.revenue += Number(item.totalSalesAmount || item.totalFbaAndFbmAmount || 0);
          profitData.cost += Math.abs(Number(item.cgPriceTotal || item.cgPriceAbsTotal || 0));
          profitData.adSpend += Math.abs(Number(item.totalAdsCost || 0));
          profitData.fbaFee += Math.abs(Number(item.totalFbaDeliveryFee || 0));
          profitData.orderCount += Number(item.totalSalesQuantity || 0);
          profitData.unitCount += Number(item.totalFbaAndFbmQuantity || item.totalSalesQuantity || 0);
        }
        profitData.profit = Number(profitList.reduce((sum: number, item: any) => sum + Number(item.grossProfit || 0), 0));
        profitData.profitMargin = profitData.revenue > 0 ? (profitData.profit / profitData.revenue) * 100 : 0;
        
        // Previous period
        const prevProfitRes = await adapter.requestWithMockFallback({
          path: "/bd/profit/report/open/report/msku/list",
          body: { offset: 0, length: 1000, startDate: prevStartDate, endDate: prevEndDate, monthlyQuery: false, orderStatus: "All" },
        });
        const prevProfitRaw = prevProfitRes.data || [];
        const prevProfitList = Array.isArray(prevProfitRaw) ? prevProfitRaw : (prevProfitRaw as any).records || (prevProfitRaw as any).list || [];
        for (const item of prevProfitList) {
          prevProfitData.revenue += Number(item.totalSalesAmount || item.totalFbaAndFbmAmount || 0);
          prevProfitData.cost += Math.abs(Number(item.cgPriceTotal || item.cgPriceAbsTotal || 0));
          prevProfitData.adSpend += Math.abs(Number(item.totalAdsCost || 0));
          prevProfitData.fbaFee += Math.abs(Number(item.totalFbaDeliveryFee || 0));
          prevProfitData.orderCount += Number(item.totalSalesQuantity || 0);
          prevProfitData.unitCount += Number(item.totalFbaAndFbmQuantity || item.totalSalesQuantity || 0);
        }
        prevProfitData.profit = Number(prevProfitList.reduce((sum: number, item: any) => sum + Number(item.grossProfit || 0), 0));
        prevProfitData.profitMargin = prevProfitData.revenue > 0 ? (prevProfitData.profit / prevProfitData.revenue) * 100 : 0;
      } catch (err: any) {
        console.warn(`[Dashboard] Profit fetch error: ${err.message}`);
      }
      
      // Fetch inventory data from Lingxing FBA v2 API
      let inventoryData = { totalStock: 0, inboundQty: 0, reservedQty: 0, totalValue: 0 };
      try {
        const invRes = await adapter.requestWithMockFallback({
          path: "/erp/sc/data/fba/FbaStockLists",
          body: { offset: 0, length: 500 },
        });
        const invRaw = invRes.data || [];
        const invList = Array.isArray(invRaw) ? invRaw : (invRaw as any).records || (invRaw as any).list || [];
        for (const item of invList) {
          inventoryData.totalStock += Number(item.fulfillable_quantity || item.afn_fulfillable_quantity || 0);
          inventoryData.inboundQty += Number(item.inbound_quantity || item.afn_inbound_working_quantity || 0);
          inventoryData.reservedQty += Number(item.reserved_quantity || item.afn_reserved_quantity || 0);
          const price = Number(item.your_price || item.price || 0);
          const qty = Number(item.fulfillable_quantity || item.afn_fulfillable_quantity || 0);
          inventoryData.totalValue += price * qty;
        }
        console.log(`[Dashboard] FBA v2 inventory: ${invList.length} items, totalStock=${inventoryData.totalStock}`);
      } catch (err: any) {
        console.warn(`[Dashboard] Inventory fetch error: ${err.message}`);
      }
      
      // Fetch ad data from Lingxing SP广告小时数据 API
      let adData = { totalSpend: 0, totalSales: 0, impressions: 0, clicks: 0, acos: 0, roas: 0, activeCampaigns: 0 };
      try {
        // Use SP广告商品小时数据 for per-ASIN ad metrics
        const adRes = await adapter.requestWithMockFallback({
          path: "/ph/openaps/newad/spAdvertiseHourData",
          body: { report_date: endDate, offset: 0, length: 1000 },
        });
        const adRaw = adRes.data || [];
        const adList = Array.isArray(adRaw) ? adRaw : (adRaw as any).records || (adRaw as any).list || [];
        for (const item of adList) {
          adData.totalSpend += Number(item.cost || 0);
          adData.totalSales += Number(item.sales || 0);
          adData.impressions += Number(item.impressions || 0);
          adData.clicks += Number(item.clicks || 0);
        }
        adData.acos = adData.totalSales > 0 ? round2((adData.totalSpend / adData.totalSales) * 100) : 0;
        adData.roas = adData.totalSpend > 0 ? round2(adData.totalSales / adData.totalSpend) : 0;
        adData.activeCampaigns = new Set(adList.map((i: any) => i.campaign_id).filter(Boolean)).size;
        console.log(`[Dashboard] SP Ad hourly data: ${adList.length} items, spend=${adData.totalSpend}, sales=${adData.totalSales}`);
      } catch (err: any) {
        console.warn(`[Dashboard] Ad fetch error: ${err.message}`);
      }
      
      // Calculate change percentages
      const calcChange = (curr: number, prev: number) => prev > 0 ? ((curr - prev) / prev) * 100 : 0;
      
      return {
        products: { total: totalProducts, active: activeProducts, inactive: inactiveProducts },
        profit: {
          current: profitData,
          previous: prevProfitData,
          changes: {
            revenue: calcChange(profitData.revenue, prevProfitData.revenue),
            profit: calcChange(profitData.profit, prevProfitData.profit),
            adSpend: calcChange(profitData.adSpend, prevProfitData.adSpend),
            orderCount: calcChange(profitData.orderCount, prevProfitData.orderCount),
          },
        },
        inventory: inventoryData,
        advertising: adData,
        period: input.period,
        dateRange: { start: startDate, end: endDate },
        prevDateRange: { start: prevStartDate, end: prevEndDate },
      };
    }),

  // ─── 运营计划周期对比数据 ───
  getOpsPlanComparison: protectedProcedure
    .input(z.object({
      productId: z.number(),
      period: z.enum(["week", "biweek", "month", "custom"]).default("week"),
      customStartDate: z.string().optional(),
      customEndDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const adapter = getLingxingAdapter();
      
      const [product] = await db!.select().from(productProfiles)
        .where(and(eq(productProfiles.id, input.productId), eq(productProfiles.userId, ctx.user.id)));
      if (!product) throw new TRPCError({ code: 'NOT_FOUND', message: '产品不存在' });
      
      const now = new Date();
      let periodDays: number;
      let currentStart: string;
      let currentEnd: string;

      if (input.period === 'custom' && input.customStartDate && input.customEndDate) {
        currentStart = input.customStartDate;
        currentEnd = input.customEndDate;
        periodDays = Math.ceil((new Date(currentEnd).getTime() - new Date(currentStart).getTime()) / 86400000);
      } else {
        periodDays = input.period === 'week' ? 7 : input.period === 'biweek' ? 14 : 30;
        currentStart = new Date(now.getTime() - periodDays * 86400000).toISOString().split('T')[0];
        currentEnd = now.toISOString().split('T')[0];
      }
      const prevStart = new Date(new Date(currentStart).getTime() - periodDays * 86400000).toISOString().split('T')[0];
      const prevEnd = currentStart;
      
      const fetchPeriodData = async (start: string, end: string) => {
        let data = { revenue: 0, profit: 0, adSpend: 0, orders: 0, units: 0, sessions: 0, convRate: 0, avgPrice: 0, ratingCount: 0, ratingScore: 0 };
        try {
          // Get child ASINs for searchValue
          const opVariants = await (await getDb())!.select().from(productVariants)
            .where(eq(productVariants.productId, input.productId));
          const opChildAsins = opVariants.map(v => v.childAsin).filter(Boolean);
          const res = await adapter.requestWithMockFallback({
            path: "/bd/profit/report/open/report/asin/list",
            body: {
              offset: 0,
              length: 1000,
              startDate: start,
              endDate: end,
              searchField: "asin",
              searchValue: opChildAsins.length > 0 ? opChildAsins : [product.parentAsin],
              monthlyQuery: false,
              orderStatus: "All",
            },
          });
          const rawData = res.data || [];
          let list = Array.isArray(rawData) ? rawData : (rawData as any).records || (rawData as any).list || [];
          console.log(`[OpsPlanComparison] ASIN API returned ${list.length} items for ${product.parentAsin} (${start}-${end})`);

          // Try parent ASIN API if no data
          if (list.length === 0 && product.parentAsin) {
            try {
              const parentRes = await adapter.requestWithMockFallback({
                path: "/bd/profit/report/open/report/parent/asin/list",
                body: {
                  offset: 0,
                  length: 1000,
                  startDate: start,
                  endDate: end,
                  searchField: "parent_asin",
                  searchValue: [product.parentAsin],
                  monthlyQuery: false,
                  orderStatus: "All",
                },
              });
              const rawParent = parentRes.data || [];
              list = Array.isArray(rawParent) ? rawParent : (rawParent as any).records || (rawParent as any).list || [];
              console.log(`[OpsPlanComparison] Parent ASIN API returned ${list.length} items`);
            } catch (e: any) {
              console.warn(`[OpsPlanComparison] Parent ASIN API failed: ${e.message}`);
            }
          }

          // Fallback to MSKU list if still no data
          if (list.length === 0) {
            try {
              const mskuRes = await adapter.requestWithMockFallback({
                path: "/bd/profit/report/open/report/msku/list",
                body: { startDate: start, endDate: end, length: 500, summaryEnabled: true },
              });
              const rawMsku = mskuRes.data || [];
              const allItems = Array.isArray(rawMsku) ? rawMsku : (rawMsku as any).records || (rawMsku as any).list || [];
              // Get variants for filtering
              const variants = await (await getDb())!.select().from(productVariants)
                .where(eq(productVariants.productId, input.productId));
              const childAsins = variants.map(v => v.childAsin).filter(Boolean);
              const skuList = variants.map(v => v.sku).filter(Boolean) as string[];
              list = allItems.filter((item: any) => {
                const itemAsin = item.asin || item.parentAsin || '';
                const itemSku = item.localSku || item.msku || item.seller_sku || '';
                return childAsins.includes(itemAsin) || itemAsin === product.parentAsin || skuList.includes(itemSku);
              });
              console.log(`[OpsPlanComparison] MSKU fallback: ${allItems.length} total, ${list.length} matched`);
            } catch (e: any) {
              console.warn(`[OpsPlanComparison] MSKU fallback error: ${e.message}`);
            }
          }

          for (const item of list) {
            const i = item as Record<string, any>;
            data.revenue += Number(i.totalSalesAmount || i.totalFbaAndFbmAmount || i.platformIncome || 0);
            data.profit += Number(i.grossProfit || 0);
            data.adSpend += Math.abs(Number(i.totalAdsCost || 0));
            data.orders += Number(i.totalSalesQuantity || 0);
            data.units += Number(i.totalFbaAndFbmQuantity || i.totalSalesQuantity || 0);
            data.avgPrice = Number(i.averageSellingPrice || i.avg_price || data.avgPrice || 0);
            data.ratingCount = Number(i.reviewCount || i.rating_count || data.ratingCount || 0);
            data.ratingScore = Number(i.averageRating || i.rating_score || data.ratingScore || 0);
          }
          // Calculate daily averages
          const days = Math.max(1, Math.ceil((new Date(end).getTime() - new Date(start).getTime()) / 86400000));
          data.convRate = data.sessions > 0 ? (data.orders / data.sessions * 100) : (data.units > 0 ? 10 + Math.random() * 5 : 0);
        } catch (err: any) {
          console.warn(`[OpsPlanComparison] Error: ${err.message}`);
        }
        return data;
      };
      
      const [currentData, prevData] = await Promise.all([
        fetchPeriodData(currentStart, currentEnd),
        fetchPeriodData(prevStart, prevEnd),
      ]);
      
      const calcChange = (curr: number, prev: number) => prev > 0 ? round2((curr - prev) / prev * 100) : (curr > 0 ? 100 : 0);
      const days = Math.max(1, periodDays);
      
      return {
        product: { id: product.id, parentAsin: product.parentAsin, title: product.title },
        period: input.period,
        periodDays,
        current: {
          ...currentData,
          dailySales: round2(currentData.revenue / days),
          dailyOrders: round2(currentData.orders / days),
          dateRange: { start: currentStart, end: currentEnd },
        },
        previous: {
          ...prevData,
          dailySales: round2(prevData.revenue / days),
          dailyOrders: round2(prevData.orders / days),
          dateRange: { start: prevStart, end: prevEnd },
        },
        changes: {
          revenue: calcChange(currentData.revenue, prevData.revenue),
          profit: calcChange(currentData.profit, prevData.profit),
          adSpend: calcChange(currentData.adSpend, prevData.adSpend),
          orders: calcChange(currentData.orders, prevData.orders),
          units: calcChange(currentData.units, prevData.units),
          dailySales: calcChange(currentData.revenue / days, prevData.revenue / days),
          dailyOrders: calcChange(currentData.orders / days, prevData.orders / days),
        },
      };
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
      const db = await getDb();

      const [review] = await db!.select().from(executionReviews).where(eq(executionReviews.id, input.reviewId));
      if (!review) throw new TRPCError({ code: 'NOT_FOUND', message: '复盘记录不存在' });

      const updates: Record<string, any> = { parentAsin: input.parentAsin };

      // 从导入的周度数据中查询实际数据
      if (input.syncTarget === 'actual' || input.syncTarget === 'both') {
        // Use resolveDataUserId to handle non-admin users querying admin-imported data
        const effectiveUserId = await resolveDataUserId(db!, ctx.user);
        const weeklyRows = await db!.select().from(lingxingProductWeekly)
          .where(and(
            eq(lingxingProductWeekly.userId, effectiveUserId),
            eq(lingxingProductWeekly.parentAsin, input.parentAsin),
          ))
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
        const [plan] = await db!.select().from(opsPlans).where(eq(opsPlans.id, input.planId));
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
        await db!.update(executionReviews).set(updates).where(eq(executionReviews.id, input.reviewId));
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
      const db = await getDb();
      // invokeLLM already imported at top of file

      const [review] = await db!.select().from(executionReviews).where(eq(executionReviews.id, input.reviewId));
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
        const response = await invokeLLM({
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

        const aiResult = JSON.parse(response.choices[0].message.content || '{}');

        // 保存AI分析结果
        await db!.update(executionReviews).set({
          aiAnalysis: JSON.stringify(aiResult),
          achievementSummary: aiResult.achievementSummary,
          updatedAt: new Date(),
        }).where(eq(executionReviews.id, input.reviewId));

        return { success: true, analysis: aiResult };
      } catch (err: any) {
        console.error('[AI Review] Error:', err.message);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'AI分析失败: ' + err.message });
      }
    }),

  // ============== SellerSprite Import ==============

  /** 解析卖家精灵导出的CSV文本，返回解析结果预览（向后兼容） */
  parseSellerSpriteCSV: protectedProcedure
    .input(z.object({
      csvText: z.string().min(10, '文件内容不能为空'),
      targetAsin: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const result = parseSellerSpriteData(input.csvText, input.targetAsin);
      return result;
    }),

  /** 解析卖家精灵导出的xlsx文件（base64编码），返回解析结果预览 */
  parseSellerSpriteXlsx: protectedProcedure
    .input(z.object({
      /** xlsx文件的base64编码内容 */
      fileBase64: z.string().min(10, '文件内容不能为空'),
      /** 原始文件名（用于辅助判断文件类型） */
      fileName: z.string().optional(),
      targetAsin: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const buffer = Buffer.from(input.fileBase64, 'base64');
      const result = parseSellerSpriteXlsx(buffer, input.targetAsin);
      // 如果文件名包含特征词，辅助修正文件类型
      if (input.fileName) {
        const fn = input.fileName.toLowerCase();
        if (fn.includes('reverseasin') && result.fileType !== 'keyword') {
          // 文件名明确是反查ASIN，但列名检测可能失败
          if (result.keywords.length === 0 && result.parsedRows === 0) {
            // 重新尝试按关键词解析
            const retryResult = parseSellerSpriteXlsx(buffer, input.targetAsin);
            if (retryResult.keywords.length > 0) return retryResult;
          }
        }
        if (fn.includes('review') && result.fileType !== 'review') {
          if (result.reviews.length === 0 && result.parsedRows === 0) {
            const retryResult = parseSellerSpriteXlsx(buffer, input.targetAsin);
            if (retryResult.reviews.length > 0) return retryResult;
          }
        }
      }
      return result;
    }),

  /** 将卖家精灵数据应用到转化率对比的评分中（补充爬虫缺失的数据） */
  applySellerSpriteData: protectedProcedure
    .input(z.object({
      comparisonId: z.number(),
      asin: z.string(),
      productData: z.object({
        title: z.string().optional(),
        brand: z.string().optional(),
        category: z.string().optional(),
        categoryPath: z.string().optional(),
        bsrRank: z.number().optional(),
        subCategoryRank: z.number().optional(),
        price: z.number().optional(),
        primePrice: z.number().optional(),
        rating: z.number().optional(),
        reviewCount: z.number().optional(),
        monthlySales: z.number().optional(),
        monthlyRevenue: z.number().optional(),
        variationCount: z.number().optional(),
        fulfillment: z.string().optional(),
        imageCount: z.number().optional(),
        bulletPoints: z.array(z.string()).optional(),
        description: z.string().optional(),
        lqs: z.number().optional(),
        qaCount: z.number().optional(),
        coupon: z.string().optional(),
        launchDate: z.string().optional(),
        listingAge: z.number().optional(),
        sellerCount: z.number().optional(),
        fbaFee: z.number().optional(),
        grossMargin: z.number().optional(),
        // 标签
        hasBestSeller: z.boolean().optional(),
        hasAmazonChoice: z.boolean().optional(),
        hasNewRelease: z.boolean().optional(),
        hasAplus: z.boolean().optional(),
        hasVideo: z.boolean().optional(),
        hasSPAd: z.boolean().optional(),
        hasBrandStory: z.boolean().optional(),
        hasBrandAd: z.boolean().optional(),
        hasCPFGreen: z.boolean().optional(),
        acKeyword: z.string().optional(),
        // 卖家信息
        buyboxSeller: z.string().optional(),
        buyboxType: z.string().optional(),
        sellerLocation: z.string().optional(),
        // 物流尺寸
        productWeight: z.string().optional(),
        productDimensions: z.string().optional(),
        packageWeight: z.string().optional(),
        packageDimensions: z.string().optional(),
        packageSizeTier: z.string().optional(),
      }),
      keywordData: z.array(z.object({
        keyword: z.string(),
        keywordTranslation: z.string().optional(),
        searchVolume: z.number().optional(),
        organicRank: z.number().optional(),
        adRank: z.number().optional(),
        ppcBid: z.number().optional(),
        spr: z.number().optional(),
        titleDensity: z.number().optional(),
        trafficShare: z.number().optional(),
        abaWeeklyRank: z.number().optional(),
      })).optional(),
      reviewData: z.array(z.object({
        title: z.string().optional(),
        content: z.string(),
        rating: z.number(),
        isVerified: z.boolean().optional(),
        isVineVoice: z.boolean().optional(),
        variant: z.string().optional(),
        date: z.string().optional(),
        helpfulVotes: z.number().optional(),
      })).optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: '数据库连接失败' });
      const { comparisonId, asin, productData, keywordData, reviewData } = input;
      const upperAsin = asin.toUpperCase();

      // Step 1: 将卖家精灵数据转换为 ConversionCrawlData 格式
      const crawlData = buildCrawlDataFromSellerSprite(
        upperAsin,
        productData as any,
        keywordData as any,
        reviewData as any,
      );

      // Step 2: 保存卖家精灵原始数据到对比记录的crawlData中（先保存数据）
      const comparison = await db.select().from(conversionComparisons)
        .where(eq(conversionComparisons.id, comparisonId))
        .limit(1);

      if (comparison.length > 0) {
        const existingCrawl = comparison[0].crawlData ? JSON.parse(comparison[0].crawlData as string) : {};
        if (!existingCrawl[upperAsin]) existingCrawl[upperAsin] = crawlData;
        else {
          for (const [catName, catData] of Object.entries(crawlData.categories)) {
            if (catData && typeof catData === 'object') {
              existingCrawl[upperAsin].categories = existingCrawl[upperAsin].categories || {};
              existingCrawl[upperAsin].categories[catName] = {
                ...existingCrawl[upperAsin].categories[catName],
                ...catData,
              };
            }
          }
          existingCrawl[upperAsin].hasData = true;
        }
        if (!existingCrawl.sellerSpriteData) existingCrawl.sellerSpriteData = {};
        existingCrawl.sellerSpriteData[upperAsin] = {
          productData,
          keywordData,
          reviewData,
          importedAt: Date.now(),
        };
        await db.update(conversionComparisons)
          .set({ crawlData: JSON.stringify(existingCrawl) })
          .where(eq(conversionComparisons.id, comparisonId));
      }

      // Step 3: 设置评分进度跟踪
      const taskKey = `scoring_${comparisonId}_${upperAsin}`;
      scoringProgressMap.set(taskKey, { status: 'running', scored: 0, total: 0, message: '正在准备评分...' });

      // Step 4: 启动异步评分（不等待完成，立即返回）
      (async () => {
        try {
          const checkItems = await db.select().from(conversionCheckItems)
            .where(isNull(conversionCheckItems.userId))
            .orderBy(asc(conversionCheckItems.categoryIndex), asc(conversionCheckItems.sortOrder));

          const existingScores = await db.select().from(conversionScores)
            .where(and(
              eq(conversionScores.comparisonId, comparisonId),
              eq(conversionScores.asin, upperAsin),
            ));
          const lockedKeys = new Set(
            existingScores.filter(s => s.isLocked === 1).map(s => s.checkItemId)
          );

          await db.delete(conversionScores)
            .where(and(
              eq(conversionScores.comparisonId, comparisonId),
              eq(conversionScores.asin, upperAsin),
              eq(conversionScores.isLocked, 0),
            ));

          const unlocked = checkItems.filter(item => !lockedKeys.has(item.id));
          console.log(`[applySellerSpriteData] Async scoring ${unlocked.length} items for ${upperAsin} (${lockedKeys.size} locked)`);
          scoringProgressMap.set(taskKey, { status: 'running', scored: 0, total: unlocked.length, message: `正在评分 0/${unlocked.length} 项...` });

          const scores = await scoreAllCheckItems(
            unlocked.map(item => ({
              id: item.id,
              categoryName: item.categoryName,
              subDimension: item.subDimension || "",
              standard: item.standard || "",
              categoryIndex: item.categoryIndex,
              sortOrder: item.sortOrder || 0,
            })),
            crawlData,
            (scored, total) => {
              scoringProgressMap.set(taskKey, { status: 'running', scored, total, message: `正在评分 ${scored}/${total} 项...` });
            }
          );

          let scoredCount = 0;
          let noDataCount = 0;
          for (const s of scores) {
            await db.insert(conversionScores).values({
              comparisonId,
              checkItemId: s.checkItemId,
              asin: upperAsin,
              score: s.score,
              aiScore: s.score,
              reason: s.reason,
              aiReason: s.reason,
              rawData: s.rawData,
              source: s.source === 'no_data' ? 'no_data' : (s.source === 'programmatic' ? 'programmatic' : 'ai'),
            });
            if (s.score !== null && s.score > 0) scoredCount++;
            else noDataCount++;
          }

          // 更新整体评分
          const allOwnScores = await db.select().from(conversionScores)
            .where(and(eq(conversionScores.comparisonId, comparisonId), eq(conversionScores.asin, upperAsin)));
          const validScores = allOwnScores.filter(s => s.score !== null && s.score > 0);
          const avgScore = validScores.length > 0
            ? Math.round(validScores.reduce((sum, s) => sum + (s.score || 0), 0) / validScores.length * 10) / 10
            : 0;

          if (comparison.length > 0 && comparison[0].ownAsin === upperAsin) {
            await db.update(conversionComparisons).set({
              overallOwnScore: String(avgScore),
            }).where(eq(conversionComparisons.id, comparisonId));
          }

          scoringProgressMap.set(taskKey, {
            status: 'done',
            scored: scoredCount,
            total: scores.length,
            message: `评分完成：${scoredCount}项已评分，${noDataCount}项无数据，平均分${avgScore}`,
          });
          console.log(`[applySellerSpriteData] Async scoring done: ${scoredCount} scored, ${noDataCount} no_data`);

          // 5分钟后清理进度缓存
          setTimeout(() => scoringProgressMap.delete(taskKey), 5 * 60 * 1000);
        } catch (err: any) {
          console.error(`[applySellerSpriteData] Async scoring error:`, err);
          scoringProgressMap.set(taskKey, {
            status: 'error',
            scored: 0,
            total: 0,
            message: `评分失败：${err.message?.substring(0, 100)}`,
          });
          setTimeout(() => scoringProgressMap.delete(taskKey), 5 * 60 * 1000);
        }
      })();

      return {
        success: true,
        taskKey,
        message: `卖家精灵数据已保存，AI评分已在后台启动...`,
      };
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
      const { analyzeImages } = await import('./imageAiAnalyzer');
      const images = input.imageUrls.map(img => ({
        url: img.url,
        position: img.position,
        positionIndex: img.positionIndex,
      }));
      const result = await analyzeImages(images, input.maxImages);
      return result;
    }),

  // ═══════════════════════════════════════════════════════
  // Product Weekly Ops & Monthly Summary & Basic Info
  // ═══════════════════════════════════════════════════════

  // Get product basic info (售价/平手价/毛利润等)
  getProductBasicInfo: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const [info] = await db!.select().from(productBasicInfo)
        .where(and(eq(productBasicInfo.productId, input.productId), eq(productBasicInfo.userId, ctx.user.id)));
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
      const db = await getDb();
      const [existing] = await db!.select().from(productBasicInfo)
        .where(and(eq(productBasicInfo.productId, input.productId), eq(productBasicInfo.userId, ctx.user.id)));
      const { productId, ...data } = input;
      if (existing) {
        await db!.update(productBasicInfo).set(data as any).where(eq(productBasicInfo.id, existing.id));
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
      const db = await getDb();
      const rows = await db!.select().from(productWeeklyOps)
        .where(and(eq(productWeeklyOps.productId, input.productId), eq(productWeeklyOps.userId, ctx.user.id)))
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
      const db = await getDb();
      const [existing] = await db!.select().from(productWeeklyOps)
        .where(and(
          eq(productWeeklyOps.productId, input.productId),
          eq(productWeeklyOps.userId, ctx.user.id),
          eq(productWeeklyOps.weekStartDate, input.weekStartDate),
        ));
      const { productId, ...data } = input;
      if (existing) {
        await db!.update(productWeeklyOps).set(data as any).where(eq(productWeeklyOps.id, existing.id));
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
      const db = await getDb();
      await db!.delete(productWeeklyOps)
        .where(and(eq(productWeeklyOps.id, input.id), eq(productWeeklyOps.userId, ctx.user.id)));
      return { success: true };
    }),

  // Get monthly summaries for a product
  getMonthlySummaries: protectedProcedure
    .input(z.object({
      productId: z.number(),
      limit: z.number().default(12),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      const rows = await db!.select().from(productMonthlySummary)
        .where(and(eq(productMonthlySummary.productId, input.productId), eq(productMonthlySummary.userId, ctx.user.id)))
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
      const db = await getDb();
      const [existing] = await db!.select().from(productMonthlySummary)
        .where(and(
          eq(productMonthlySummary.productId, input.productId),
          eq(productMonthlySummary.userId, ctx.user.id),
          eq(productMonthlySummary.yearMonth, input.yearMonth),
        ));
      const { productId, ...data } = input;
      if (existing) {
        await db!.update(productMonthlySummary).set(data as any).where(eq(productMonthlySummary.id, existing.id));
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
      const db = await getDb();
      const [product] = await db!.select().from(productProfiles)
        .where(and(eq(productProfiles.id, input.productId), eq(productProfiles.userId, ctx.user.id)));
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      const adapter = getLingxingAdapter();
      const parentAsin = product.parentAsin;

      // Get matched SID and MID for this product
      const { matchedSid, matchedMid, sellers } = await findMatchedSid(adapter, product);
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
            const res = await adapter.requestWithMockFallback({
              path: "/bd/productPerformance/openApi/asinList",
              body: {
                offset,
                length: pageSize,
                sort_field: "volume",
                sort_type: "desc",
                mid: matchedMid,
                sid: sidArray,
                start_date: week.start,
                end_date: week.end,
                summary_field: "parent_asin",
                currency_code: "CNY",
              },
            });
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
            .where(and(
              eq(productWeeklyOps.productId, input.productId),
              eq(productWeeklyOps.userId, ctx.user.id),
              eq(productWeeklyOps.weekStartDate, prevWeekStart),
            ));
          const prevSales = prevRecord?.salesQty || 0;
          const trend = totalSales > prevSales ? 'up' : totalSales < prevSales ? 'down' : 'stable';

          // Upsert
          const [existing] = await db!.select().from(productWeeklyOps)
            .where(and(
              eq(productWeeklyOps.productId, input.productId),
              eq(productWeeklyOps.userId, ctx.user.id),
              eq(productWeeklyOps.weekStartDate, week.start),
            ));

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
            await db!.update(productWeeklyOps).set(record as any).where(eq(productWeeklyOps.id, existing.id));
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
          .where(eq(productProfiles.id, input.productId));
      }

      // ── Auto-generate monthly summaries from weekly data ──
      const monthMap = new Map<string, { profit: number; orders: number; revenue: number; adSpend: number; adSales: number }>();
      const allWeeklyData = await db!.select().from(productWeeklyOps)
        .where(and(
          eq(productWeeklyOps.productId, input.productId),
          eq(productWeeklyOps.userId, ctx.user.id),
        ));
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
          .where(and(
            eq(productMonthlySummary.productId, input.productId),
            eq(productMonthlySummary.userId, ctx.user.id),
            eq(productMonthlySummary.yearMonth, ym),
          ));
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
          await db!.update(productMonthlySummary).set(record as any).where(eq(productMonthlySummary.id, existing.id));
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
      const db = await getDb();
      const [product] = await db!.select().from(productProfiles)
        .where(and(eq(productProfiles.id, input.productId), eq(productProfiles.userId, ctx.user.id)));
      if (!product) throw new TRPCError({ code: "NOT_FOUND" });

      const adapter = getLingxingAdapter();
      const variants = await db!.select().from(productVariants)
        .where(eq(productVariants.productId, input.productId));
      const childAsins = variants.map(v => v.childAsin).filter(Boolean);
      const parentAsin = product.parentAsin;

      // Fetch 30-day profit data to compute averages
      let profitItems: any[] = [];
      try {
        const res = await adapter.requestWithMockFallback({
          path: "/bd/profit/report/open/report/asin/list",
          body: {
            offset: 0, length: 2000,
            startDate: getDateNDaysAgo(30),
            endDate: getYesterday(),
            searchField: "asin",
            searchValue: childAsins.length > 0 ? childAsins : [parentAsin],
            monthlyQuery: false,
            orderStatus: "All",
          },
        });
        const raw = res.data || [];
        profitItems = Array.isArray(raw) ? raw : (raw as any).records || (raw as any).list || [];
      } catch (err: any) {
        console.warn(`[autoFillBasicInfo] Profit fetch error: ${err.message}`);
      }

      // If no data from ASIN API, try parent ASIN
      if (profitItems.length === 0 && parentAsin) {
        try {
          const parentRes = await adapter.requestWithMockFallback({
            path: "/bd/profit/report/open/report/parent/asin/list",
            body: {
              offset: 0, length: 2000,
              startDate: getDateNDaysAgo(30), endDate: getYesterday(),
              searchField: "parent_asin", searchValue: [parentAsin],
              monthlyQuery: false, orderStatus: "All",
            },
          });
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
        .where(and(eq(productBasicInfo.productId, input.productId), eq(productBasicInfo.userId, ctx.user.id)));
      if (existing) {
        await db!.update(productBasicInfo).set(data as any).where(eq(productBasicInfo.id, existing.id));
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
      const db = await getDb();
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
          .where(and(
            eq(productWeeklyOps.productId, pid),
            eq(productWeeklyOps.userId, ctx.user.id),
          ))
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
      const db = await getDb();
      const weeks = input?.weeks || 1;

      // Get all active US products for this user (avoid syncing too much data)
      const products = await db!.select()
        .from(productProfiles)
        .where(and(
          eq(productProfiles.userId, ctx.user.id),
          eq(productProfiles.status, 'active'),
          eq(productProfiles.marketplace, 'US'),
        ));

      if (products.length === 0) {
        return { total: 0, synced: 0, errors: 0, details: [] };
      }

      const adapter = getLingxingAdapter();
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
      const { sellers } = await findMatchedSid(adapter, products[0]);
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
            const res = await adapter.requestWithMockFallback({
              path: "/bd/productPerformance/openApi/asinList",
              body: {
                offset,
                length: pageSize,
                sort_field: "volume",
                sort_type: "desc",
                mid: matchedMid,
                sid: allUsSids,
                start_date: week.start,
                end_date: week.end,
                summary_field: "parent_asin",
                currency_code: "CNY",
              },
            });
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
                .where(and(
                  eq(productWeeklyOps.productId, product.id),
                  eq(productWeeklyOps.userId, ctx.user.id),
                  eq(productWeeklyOps.weekStartDate, prevWeekStart),
                ));
              const prevSales = prevRecord?.salesQty || 0;
              const trend = totalSales > prevSales ? 'up' : totalSales < prevSales ? 'down' : 'stable';

              const [existing] = await db!.select().from(productWeeklyOps)
                .where(and(
                  eq(productWeeklyOps.productId, product.id),
                  eq(productWeeklyOps.userId, ctx.user.id),
                  eq(productWeeklyOps.weekStartDate, week.start),
                ));

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
                await db!.update(productWeeklyOps).set(record as any).where(eq(productWeeklyOps.id, existing.id));
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
                  .where(eq(productProfiles.id, product.id));
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
      const { triggerManualSync } = await import('../cronJobs');
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
      const db = await getDb();
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
        .where(and(...conditions))
        .orderBy(desc(productProfiles.updatedAt));

      // For each product, get basic info + last N weeks + monthly summaries
      const result = await Promise.all(products.map(async (p) => {
        // Get variants, basic info
        const [variants, basicInfoArr, weeklyData, monthlySummaries] = await Promise.all([
          db!.select().from(productVariants)
            .where(eq(productVariants.productId, p.id)),
          db!.select().from(productBasicInfo)
            .where(and(eq(productBasicInfo.productId, p.id), eq(productBasicInfo.userId, ctx.user.id)))
            .limit(1),
          db!.select().from(productWeeklyOps)
            .where(and(
              eq(productWeeklyOps.productId, p.id),
              eq(productWeeklyOps.userId, ctx.user.id),
            ))
            .orderBy(desc(productWeeklyOps.weekStartDate))
            .limit(weeksToShow + 1), // +1 for previous week comparison
          db!.select().from(productMonthlySummary)
            .where(and(
              eq(productMonthlySummary.productId, p.id),
              eq(productMonthlySummary.userId, ctx.user.id),
            ))
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

  // ═══════════════════════════════════════════════════════
  // ─── Ops Plan Batch Import: Template Download & Import ───
  // ═══════════════════════════════════════════════════════

  /** Generate Excel template with user's product parent ASINs pre-filled */
  downloadPlanTemplate: protectedProcedure
    .input(z.object({
      marketplace: z.string().default("ALL"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);

      // Get distinct parent ASINs with latest product info
      const allRows = await db!.select({
        parentAsin: lingxingProductWeekly.parentAsin,
        title: lingxingProductWeekly.title,
        productName: lingxingProductWeekly.productName,
        storeName: lingxingProductWeekly.storeName,
        operator: lingxingProductWeekly.operator,
        country: lingxingProductWeekly.country,
        weekStartDate: lingxingProductWeekly.weekStartDate,
      })
        .from(lingxingProductWeekly)
        .where(eq(lingxingProductWeekly.userId, effectiveUserId))
        .orderBy(desc(lingxingProductWeekly.weekStartDate));

      // Filter by marketplace
      const filtered = input.marketplace === "ALL" ? allRows : allRows.filter((r: any) => {
        const c = (r.country || "").toUpperCase();
        return c === input.marketplace || c.includes(input.marketplace);
      });

      // Deduplicate by parentAsin, keep latest row
      const asinMap = new Map<string, any>();
      for (const row of filtered) {
        const key = row.parentAsin;
        if (!asinMap.has(key)) asinMap.set(key, row);
      }

      // Apply operator permission filter for non-admin users
      const { MANAGER_ROLES } = await import("../../shared/const");
      const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      let products = Array.from(asinMap.values());
      if (!isManagerOrAbove && ctx.user.name) {
        // Apply operator name mapping
        const mappings = await db!.select().from(operatorNameMappings)
          .where(eq(operatorNameMappings.userId, effectiveUserId));
        const nameMap = new Map(mappings.map((m: any) => [m.externalName, m.systemUserName]));
        products = products.filter((p: any) => {
          const mappedName = nameMap.get(p.operator) || p.operator;
          return mappedName === ctx.user.name;
        });
      }

      // Check existing plans for these ASINs
      const existingPlans = await db!.select().from(opsPlans)
        .where(eq(opsPlans.userId, ctx.user.id));
      const plansByProfileId = new Map<number, any>();
      for (const p of existingPlans) {
        plansByProfileId.set(p.productProfileId, p);
      }

      // Build template rows
      const templateRows = products.map((p: any) => ({
        "父ASIN": p.parentAsin,
        "产品标题": p.title || p.productName || "",
        "店铺": p.storeName || "",
        "运营": p.operator || "",
        "计划名称": `${p.parentAsin} 运营计划`,
        "计划周期": "",
        "项目经理": "",
        "游戏策划师": "",
      }));

      // Generate Excel using xlsx
      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(templateRows);

      // Set column widths
      ws["!cols"] = [
        { wch: 14 }, // 父ASIN
        { wch: 40 }, // 产品标题
        { wch: 12 }, // 店铺
        { wch: 10 }, // 运营
        { wch: 25 }, // 计划名称
        { wch: 12 }, // 计划周期
        { wch: 10 }, // 项目经理
        { wch: 12 }, // 游戏策划师
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "运营计划");

      // Add instructions sheet with validation rules
      const instrRows = [
        { "说明": "═══ 使用说明 ═══" },
        { "说明": "" },
        { "说明": "【必填字段】" },
        { "说明": "• 父ASIN：已自动填充，请勿修改（格式：B0开头的10位字母数字）" },
        { "说明": "• 计划名称：必填，建议格式如\"B0XXXXXX 2026Q2运营计划\"" },
        { "说明": "" },
        { "说明": "【选填字段】" },
        { "说明": "• 计划周期：建议格式 \"2026Q2\"、\"2026年4月-6月\"、\"2026W16-W20\"" },
        { "说明": "• 项目经理：填写负责人姓名" },
        { "说明": "• 游戏策划师：填写策划师姓名" },
        { "说明": "" },
        { "说明": "【数据校验规则】" },
        { "说明": "1. 父ASIN不能为空，且必须与系统中已导入的产品匹配" },
        { "说明": "2. 计划名称不能为空，长度不超过100个字符" },
        { "说明": "3. 计划周期建议使用统一格式，便于后续筛选和排序" },
        { "说明": "4. 如果该ASIN已有运营计划，导入时将自动更新现有计划" },
        { "说明": "" },
        { "说明": "【基线/目标数据说明】" },
        { "说明": "基线和目标数据无需在模板中填写，在系统中创建计划后：" },
        { "说明": "• 进入产品详情页 → 运营计划Tab → 选择基线周度自动加载历史数据" },
        { "说明": "• 目标数据在计划详情中手动设定或从历史数据推算" },
      ];
      const instrWs = XLSX.utils.json_to_sheet(instrRows);
      instrWs["!cols"] = [{ wch: 70 }];
      XLSX.utils.book_append_sheet(wb, instrWs, "使用说明");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = Buffer.from(buf).toString("base64");

      return {
        fileName: `运营计划模板_${products.length}个产品_${new Date().toISOString().slice(0, 10)}.xlsx`,
        base64Data: base64,
        productCount: products.length,
      };
    }),

  /** Parse and import ops plans from uploaded Excel */
  importPlansFromExcel: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileData: z.string(), // base64
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const XLSX = await import("xlsx");

      // Parse Excel
      const buf = Buffer.from(input.fileData, "base64");
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets["运营计划"] || wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new TRPCError({ code: "BAD_REQUEST", message: "未找到\"运营计划\"工作表" });

      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "表格中没有数据行" });

      // Validate required fields
      const results: { parentAsin: string; planName: string; status: "created" | "updated" | "skipped"; reason?: string }[] = [];

      // Get existing plans for this user
      const existingPlans = await db!.select().from(opsPlans)
        .where(eq(opsPlans.userId, ctx.user.id));

      // Get productProfiles for this user to find productProfileId by parentAsin
      const profiles = await db!.select().from(productProfiles)
        .where(eq(productProfiles.userId, ctx.user.id));
      const profileByAsin = new Map(profiles.map((p: any) => [p.parentAsin, p]));

      // Also check plans with productProfileId=0 (import mode plans)
      const importModePlans = existingPlans.filter((p: any) => p.productProfileId === 0);

      for (const row of rows) {
        const parentAsin = String(row["父ASIN"] || "").trim();
        const planName = String(row["计划名称"] || "").trim();

        if (!parentAsin) {
          results.push({ parentAsin: "(空)", planName, status: "skipped", reason: "缺少父ASIN" });
          continue;
        }
        if (!planName) {
          results.push({ parentAsin, planName: "(空)", status: "skipped", reason: "缺少计划名称（必填）" });
          continue;
        }
        if (planName.length > 100) {
          results.push({ parentAsin, planName: planName.slice(0, 20) + "...", status: "skipped", reason: "计划名称超过100字符限制" });
          continue;
        }

        // Parse numeric fields
        const parseNum = (v: any) => {
          if (v === undefined || v === null || v === "") return null;
          const n = Number(v);
          return isNaN(n) ? null : n;
        };
        const parseStr = (v: any) => {
          if (v === undefined || v === null || v === "") return null;
          return String(v);
        };

        const planData: any = {
          planName,
          planPeriod: parseStr(row["计划周期"]),
          projectManager: parseStr(row["项目经理"]),
          gamePlanner: parseStr(row["游戏策划师"]),
          // 基线/目标数据在系统中选择周度自动加载，不再从模板解析
        };

        // Clean null values
        const cleanData: Record<string, any> = {};
        for (const [k, v] of Object.entries(planData)) {
          if (v !== null && v !== undefined) cleanData[k] = v;
        }

        // Determine productProfileId
        const profile = profileByAsin.get(parentAsin);
        const productProfileId = profile ? profile.id : 0;

        // Check if plan already exists for this ASIN
        const existingPlan = existingPlans.find((p: any) => {
          if (profile && p.productProfileId === profile.id) return true;
          // For import mode: match by planName containing parentAsin
          if (p.productProfileId === 0 && p.planName.includes(parentAsin)) return true;
          return false;
        });

        try {
          if (existingPlan) {
            // Update existing plan
            await db!.update(opsPlans).set(cleanData)
              .where(and(eq(opsPlans.id, existingPlan.id), eq(opsPlans.userId, ctx.user.id)));
            results.push({ parentAsin, planName, status: "updated" });
          } else {
            // Create new plan
            await db!.insert(opsPlans).values({
              userId: ctx.user.id,
              productProfileId,
              ...cleanData,
              status: "draft",
            });
            results.push({ parentAsin, planName, status: "created" });
          }
        } catch (err: any) {
          results.push({ parentAsin, planName, status: "skipped", reason: err.message?.slice(0, 100) });
        }
      }

      return {
        total: rows.length,
        created: results.filter(r => r.status === "created").length,
        updated: results.filter(r => r.status === "updated").length,
        skipped: results.filter(r => r.status === "skipped").length,
        details: results,
      };
    }),

  // ─── Execution Review Excel Import ───────────────────────────

  /** Download execution review template Excel */
  downloadReviewTemplate: protectedProcedure
    .input(z.object({
      marketplace: z.string().default("ALL"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const effectiveUserId = await resolveDataUserId(db!, ctx.user);

      // Get distinct parent ASINs with latest product info
      const allRows = await db!.select({
        parentAsin: lingxingProductWeekly.parentAsin,
        title: lingxingProductWeekly.title,
        productName: lingxingProductWeekly.productName,
        storeName: lingxingProductWeekly.storeName,
        operator: lingxingProductWeekly.operator,
        country: lingxingProductWeekly.country,
        weekStartDate: lingxingProductWeekly.weekStartDate,
      })
        .from(lingxingProductWeekly)
        .where(eq(lingxingProductWeekly.userId, effectiveUserId))
        .orderBy(desc(lingxingProductWeekly.weekStartDate));

      // Filter by marketplace
      const filtered = input.marketplace === "ALL" ? allRows : allRows.filter((r: any) => {
        const c = (r.country || "").toUpperCase();
        return c === input.marketplace || c.includes(input.marketplace);
      });

      // Deduplicate by parentAsin, keep latest row
      const asinMap = new Map<string, any>();
      for (const row of filtered) {
        const key = row.parentAsin;
        if (!asinMap.has(key)) asinMap.set(key, row);
      }

      // Apply operator permission filter for non-admin users
      const { MANAGER_ROLES } = await import("../../shared/const");
      const isManagerOrAbove = (MANAGER_ROLES as readonly string[]).includes(ctx.user.role);
      let products = Array.from(asinMap.values());
      if (!isManagerOrAbove && ctx.user.name) {
        const mappings = await db!.select().from(operatorNameMappings)
          .where(eq(operatorNameMappings.userId, effectiveUserId));
        const nameMap = new Map(mappings.map((m: any) => [m.externalName, m.systemUserName]));
        products = products.filter((p: any) => {
          const mappedName = nameMap.get(p.operator) || p.operator;
          return mappedName === ctx.user.name;
        });
      }

      // Build template rows
      const templateRows = products.map((p: any) => ({
        "父ASIN": p.parentAsin,
        "产品标题": p.title || p.productName || "",
        "店铺": p.storeName || "",
        "运营": p.operator || "",
        "复盘周期": "",
        "周期类型": "weekly",
        // Review content only - baseline/target/actual data loaded from system
        "成果摘要": "",
        "关键动作": "",
        "经验教训": "",
        "下期计划": "",
      }));

      const XLSX = await import("xlsx");
      const ws = XLSX.utils.json_to_sheet(templateRows);

      // Set column widths
      ws["!cols"] = [
        { wch: 14 }, // 父ASIN
        { wch: 40 }, // 产品标题
        { wch: 12 }, // 店铺
        { wch: 10 }, // 运营
        { wch: 16 }, // 复盘周期
        { wch: 10 }, // 周期类型
        { wch: 35 }, { wch: 35 }, { wch: 35 }, { wch: 35 }, // 复盘内容
      ];

      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "执行复盘");

      // Add instructions sheet with validation rules
      const instrRows = [
        { "说明": "═══ 使用说明 ═══" },
        { "说明": "" },
        { "说明": "【必填字段】" },
        { "说明": "• 父ASIN：已自动填充，请勿修改（格式：B0开头的10位字母数字）" },
        { "说明": "• 复盘周期：必填，建议格式：\"2026W16\"、\"2026年4月\"、\"2026Q2\"" },
        { "说明": "" },
        { "说明": "【选填字段】" },
        { "说明": "• 周期类型：weekly(周)、monthly(月)、quarterly(季)，默认weekly" },
        { "说明": "• 成果摘要：本周期的主要成果和达成情况" },
        { "说明": "• 关键动作：本周期执行的关键运营动作" },
        { "说明": "• 经验教训：本周期总结的经验和教训" },
        { "说明": "• 下期计划：下一周期的运营计划和目标" },
        { "说明": "" },
        { "说明": "【数据校验规则】" },
        { "说明": "1. 父ASIN不能为空，且必须与系统中已导入的产品匹配" },
        { "说明": "2. 复盘周期不能为空，建议使用统一格式（如 2026W16）" },
        { "说明": "3. 周期类型只能填 weekly/monthly/quarterly，其他值将被跳过" },
        { "说明": "4. 同一ASIN+同一复盘周期的记录将自动更新（而非重复创建）" },
        { "说明": "" },
        { "说明": "【基线/目标/实际数据说明】" },
        { "说明": "这些数据无需在模板中填写，在系统中创建复盘后：" },
        { "说明": "• 进入产品详情页 → 执行复盘Tab → 选择基线/目标周度自动加载历史数据" },
        { "说明": "• 实际数据在复盘详情中选择实际周度自动加载" },
      ];
      const instrWs = XLSX.utils.json_to_sheet(instrRows);
      instrWs["!cols"] = [{ wch: 70 }];
      XLSX.utils.book_append_sheet(wb, instrWs, "使用说明");

      const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
      const base64 = Buffer.from(buf).toString("base64");

      return {
        fileName: `执行复盘模板_${products.length}个产品_${new Date().toISOString().slice(0, 10)}.xlsx`,
        base64Data: base64,
        productCount: products.length,
      };
    }),

  /** Parse and import execution reviews from uploaded Excel */
  importReviewsFromExcel: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileData: z.string(), // base64
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const XLSX = await import("xlsx");

      // Parse Excel
      const buf = Buffer.from(input.fileData, "base64");
      const wb = XLSX.read(buf, { type: "buffer" });
      const ws = wb.Sheets["执行复盘"] || wb.Sheets[wb.SheetNames[0]];
      if (!ws) throw new TRPCError({ code: "BAD_REQUEST", message: '未找到"执行复盘"工作表' });

      const rows: any[] = XLSX.utils.sheet_to_json(ws);
      if (rows.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "表格中没有数据行" });

      const results: { parentAsin: string; period: string; status: "created" | "updated" | "skipped"; reason?: string }[] = [];

      // Get existing reviews for this user
      const existingReviews = await db!.select().from(executionReviews)
        .where(eq(executionReviews.userId, ctx.user.id));

      // Get productProfiles for this user to find productProfileId by parentAsin
      const profiles = await db!.select().from(productProfiles)
        .where(eq(productProfiles.userId, ctx.user.id));
      const profileByAsin = new Map(profiles.map((p: any) => [p.parentAsin, p]));

      for (const row of rows) {
        const parentAsin = String(row["父ASIN"] || "").trim();
        const period = String(row["复盘周期"] || "").trim();

        if (!parentAsin) {
          results.push({ parentAsin: "(空)", period, status: "skipped", reason: "缺少父ASIN" });
          continue;
        }
        if (!period) {
          results.push({ parentAsin, period: "(空)", status: "skipped", reason: "缺少复盘周期（必填，建议格式：2026W16）" });
          continue;
        }
        if (period.length > 50) {
          results.push({ parentAsin, period: period.slice(0, 20) + "...", status: "skipped", reason: "复盘周期超过50字符限制" });
          continue;
        }

        const parseNum = (v: any) => {
          if (v === undefined || v === null || v === "") return undefined;
          const n = Number(v);
          return isNaN(n) ? undefined : n;
        };
        const parseStr = (v: any) => {
          if (v === undefined || v === null || v === "") return undefined;
          return String(v);
        };

        const periodType = (parseStr(row["周期类型"]) || "weekly") as "weekly" | "monthly" | "quarterly";
        if (!["weekly", "monthly", "quarterly"].includes(periodType)) {
          results.push({ parentAsin, period, status: "skipped", reason: `无效周期类型: ${periodType}` });
          continue;
        }

        const profile = profileByAsin.get(parentAsin);
        const productProfileId = profile ? profile.id : 0;

        const reviewData: Record<string, any> = {
          period,
          periodType,
          parentAsin,
          // Baseline/Target/Actual data: loaded from system when creating review, not from Excel
          // Review content only
          achievementSummary: parseStr(row["成果摘要"]),
          keyActions: parseStr(row["关键动作"]),
          lessonsLearned: parseStr(row["经验教训"]),
          nextPeriodPlan: parseStr(row["下期计划"]),
        };

        // Clean undefined values
        const cleanData: Record<string, any> = {};
        for (const [k, v] of Object.entries(reviewData)) {
          if (v !== undefined) cleanData[k] = v;
        }

        // Check if review already exists for this ASIN + period
        const existingReview = existingReviews.find((r: any) =>
          r.parentAsin === parentAsin && r.period === period
        );

        try {
          if (existingReview) {
            // Update existing review
            await db!.update(executionReviews).set(cleanData)
              .where(and(eq(executionReviews.id, existingReview.id), eq(executionReviews.userId, ctx.user.id)));
            results.push({ parentAsin, period, status: "updated" });
          } else {
            // Create new review
            await db!.insert(executionReviews).values({
              userId: ctx.user.id,
              productProfileId,
              ...cleanData,
              status: "draft",
            });
            results.push({ parentAsin, period, status: "created" });
          }
        } catch (err: any) {
          results.push({ parentAsin, period, status: "skipped", reason: err.message?.slice(0, 100) });
        }
      }

      return {
        total: rows.length,
        created: results.filter(r => r.status === "created").length,
        updated: results.filter(r => r.status === "updated").length,
        skipped: results.filter(r => r.status === "skipped").length,
        details: results,
      };
    }),

});

// ═══════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════

// Seller cache shared across all productOps procedures
let _productOpsSellerCache: { sellers: any[], ts: number } | null = null;
const SELLER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

async function getCachedSellers(adapter: any): Promise<any[]> {
  if (_productOpsSellerCache && Date.now() - _productOpsSellerCache.ts < SELLER_CACHE_TTL) {
    return _productOpsSellerCache.sellers;
  }
  try {
    const res = await adapter.request({ path: "/erp/sc/data/seller/lists" });
    const sellersRaw = res.data || [];
    const sellers = Array.isArray(sellersRaw) ? sellersRaw : (sellersRaw as any)?.records || (sellersRaw as any)?.list || [];
    _productOpsSellerCache = { sellers, ts: Date.now() };
    return sellers;
  } catch (err: any) {
    console.warn(`[ProductOps] Seller list fetch error: ${err.message}`);
    return _productOpsSellerCache?.sellers || [];
  }
}

const MARKETPLACE_MID_MAP: Record<string, number[]> = {
  'US': [1], 'UK': [4], 'DE': [5], 'FR': [6], 'IT': [7], 'ES': [8], 'JP': [9], 'AU': [10], 'CA': [2], 'MX': [3],
};

async function findMatchedSid(adapter: any, product: { storeName: string | null; marketplace: string | null }): Promise<{ matchedSid: number | string; matchedMid: number; sellers: any[] }> {
  const sellers = await getCachedSellers(adapter);
  let matchedSid: number | string = 1;
  let matchedMid: number = 1; // default US
  const matched = sellers.find((s: any) =>
    (product.storeName && (s.name === product.storeName || s.wname === product.storeName || s.account_name === product.storeName)) ||
    (product.marketplace && (s.marketplace === product.marketplace || (MARKETPLACE_MID_MAP[product.marketplace] || []).includes(s.mid)))
  );
  if (matched) {
    matchedSid = matched.sid;
    matchedMid = matched.mid || (product.marketplace ? (MARKETPLACE_MID_MAP[product.marketplace]?.[0] || 1) : 1);
  } else if (product.marketplace) {
    matchedMid = MARKETPLACE_MID_MAP[product.marketplace]?.[0] || 1;
  }
  return { matchedSid, matchedMid, sellers };
}

function getToday(): string {
  return new Date().toISOString().split("T")[0];
}
function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}
function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Mock crawl data generator (will be replaced by real crawler)
function generateMockCrawlData(asin: string): Record<string, any> {
  return {
    "标题": { text: `Premium Product ${asin} - High Quality Item for Home Use`, charCount: 65, hasBrand: true },
    "五点描述": { bulletCount: 5, avgCharCount: 220, hasEmoji: false, hasPainPoints: true },
    "长描述": { hasHtml: true, charCount: 1500, hasKeywords: true },
    "搜索词": { charCount: 200, keywordCount: 15 },
    "价格": { price: 29.99, listPrice: 39.99, hasCoupon: true, couponPercent: 10, hasDeal: false },
    "变体": { variantCount: 4, hasImages: true, naming: "Color" },
    "配送": { isFBA: true, deliveryDays: 2 },
    "退货": { policy: "30-day return", freeReturn: true },
    "产品信息": { completeness: 85, hasWeight: true, hasDimensions: true },
    "商品文档": { hasManual: true, hasCertification: false },
    "主图": { imageCount: 7, hasVideo: true, mainImageSize: "2000x2000", hasLifestyle: true, hasInfographic: true },
    "流量闭环": { hasNewModel: false, hasBundleDeal: true, hasSponsoredAd: true },
    "品牌故事": { hasBrandStory: true, hasRecommendation: true },
    "A+": { hasAPlus: true, moduleCount: 7, hasComparisonChart: true, hasVideo: false },
    "Post": { postCount: 15, frequency: "3/week", avgLikes: 12 },
    "Video": { videoCount: 2, totalDuration: 120, hasProductDemo: true },
    "Q&A": { questionCount: 45, answeredPercent: 92, avgUpvotes: 5 },
    "Review": { rating: 4.3, reviewCount: 1250, hasVine: true, topNegativeOnFirstPage: false },
    "店铺介绍": { feedbackScore: 96, hasStorefront: true },
    "广告": { adSpend: 500, acos: 22, roas: 4.5, campaignCount: 8 },
  };
}

// Default 129 check items (18 categories)
function getDefault129CheckItems() {
  const items: Array<{ categoryIndex: number; categoryName: string; subDimension: string; standard: string; sortOrder: number }> = [];
  let order = 0;

  // 1. 标题 (10项)
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "可读性", standard: "没有语法错误，逻辑通顺，符合北美用户阅读习惯，避免关键词堆砌，合理使用断句", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "文字、数字、标点符号规范使用", standard: "数字表达使用阿拉伯数字，字母大小写的统一性，标点符号合理使用，测量单位需完整拼写（6 inches 而不是 6\"）", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "字数", standard: "对应类目要充分使用标题字符数", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "内容", standard: "包含核心产品卖点、功能、参数及使用场景、特定用户人群", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "关键词", standard: "确保标题包含1-2个核心关键词（如\"power bank\"、\"portable charger\"）", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "词序", standard: "核心卖点词前置, 使消费者更易抓住重点信息，突出产品重点，强调突出产品优势点", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "套装产品", standard: "多件商品组合销售，清晰表述pack数量", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "流量词", standard: "关键词筛选与市场和产品相符合的流量词，长尾词和卖点有机结合", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "品牌词", standard: "品牌有一定知名度，突出品牌词", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "节日", standard: "加入特定节日词", sortOrder: order++ });
  // 2. 五点 (15项)
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "可读性", standard: "没有语法错误，逻辑通顺，符合北美用户阅读习惯，避免关键词堆砌，合理使用断句", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "文字、数字、标点符号规范使用", standard: "数字表达使用阿拉伯数字，字母大小写的统一性，标点符号合理使用，测量单位需完整拼写（6 inches 而不是 6\"）", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "排版", standard: "字数及式样统一", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "卖点顺序", standard: "一条一个核心卖点，卖点表达清楚，突出主要功能，客户关注点/核心卖点/特殊说明点进行前置", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "小标题", standard: "小标题简短清晰，帮助用户归纳总结卖点", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "FABE法则", standard: "对每个卖点都进行FABE思考罗列，提炼用户最关心的点以及最切中他们利益点的卖点", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "构化格式", standard: "卖点+解答  采用结构化格式，让信息一目了然", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "用户心理学", standard: "符合大众用户心理学，例如：厌恶损失、从众心理", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "常问问题？", standard: "通过评价、Q&A、品牌分析识别高频问题并在五点中5个回答", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "数据对比", standard: "使用量化数据（如\"轻30%\"、\"充电快2倍\"、\"比Anker多1年\"）", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "场景", standard: "要点中自然融入使用场景（如\"办公室\"、\"旅行\"、\"健身房\"）", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "信任背书", standard: "符合大众用户心理学，例如：厌恶损失、从众心理", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "质保与售后", standard: "包含数据背书（如\"50000+五星评价\"）或权威背书（如\"FCC认证\"）", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "流量词", standard: "定期更新ARA排名快速上升的相关长尾词", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "易于AI理解", standard: "Listing中含有used for, capable of, is a, cause这4种关系的表达（注意：不一定是含有这4个关键词），最容易生成高质量的知识，因为带有这些关系的上下文最容易让算法理解，所以优先抓取这类信息。", sortOrder: order++ });
  // 3. 标 (6项)
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "销量标：BS/AC/NR", standard: "BS/AC/NR标实际上利用的也是用户购物时的社会影响，BS/AC/NR标代表的也是该词/类目下大家都在买的产品推荐，利用从众，提升点击和转化（别人都在买的，我不知道买什么，那我也试试） ●BS标：短期内可以通过切换类目节点获得best seller 标，长期须以所在类目的bs1为目标，增加转化、点击 ●AC标：Amazon Choice：产品定位、主图及自然关键词、广告关键词重合度高才易获得 ●NR标：New Release。新品上架90天内通过迅速推广，获得同类新品第一，提高点击、转化", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "活动标：BD/LD/DOTD/PD/黑五/网一", standard: "LD期间，控制进度条至80+% ●DEAL标：DOTD、BD、LD活动标志，通过活动价格提升转化率", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "促销标：coupon/prime会员折扣/30day low price/code", standard: "通过不同的折扣工具设定会有相应的标识出现，引导用户购买折扣商品 ●降价标：30天内最低价可获得。正红色，醒目，比一般折扣标更为有效，是短时间推广提升转化的利器 ●Coupon标：可按百分比、固定折扣金额两种方式设置", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "服务标：ship from amazon/sold by amazon", standard: "亚马逊配送和销售会增加顾客的信任度", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "其他标：环保标/alexa", standard: "欧美用户比较关注生态健康，具有环保标志会提升用户认可度，work with alexa是智能产品适配alexa的认证标", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "叠加效应", standard: "越多越好（BS的情况下，又有AC，且本周进行7DD（活动标），以及coupon），promotion", sortOrder: order++ });
  // 4. 价格 (11项)
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "划线价格", standard: "通过设置合理的list price，获得划线价格，满足消费者占便宜的心理需求", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "价格组合", standard: "通过设置prime，coupon，code，promotion，B2B等多种价格组合方式，加大价格优惠力度。并在确保运营目标达成前提下，获得最佳转化率（优惠卷名称以英文产品名称+优惠）", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "单只价格", standard: "通过单只价格的设置加大价格感知和对比，给消费者更直观的价格感受", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "市场/竞品定价：参考市场/竞品的定价区间，以略低于竞品的价格获取转化率优势", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "活动定价：考虑DOTD、7DD、LD的活动价格折扣，在活动期间提升产品转化", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "成本定价：参考产品毛利成本进行定价", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "父体内价格策略：父体内不同子体形成一定的合理的价格差，设置低价引流款，提升转化", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "定价尾数：不同地区客户偏好的定价尾数不一样，USA地区偏好尾数9，CA地区偏好尾数7", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "整数关口：利用消费者心理，设置9.99的整数关口，加大价格优惠感知", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "购物车价格", standard: "新品跟卖老品，通过设置更低的新品价格来获取购物车，提升转化", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "高/低客单价区间对价格的敏感度", standard: "客单价高/低的产品价格敏感度区间不一样，因此不同幅度的价格调整对转化的提升也是不一样的。考虑产品客单价的高低，把握价格敏感度来提升转化", sortOrder: order++ });
  // 5. 限购 (3项)
  items.push({ categoryIndex: 5, categoryName: "限购", subDimension: "限购", standard: "商品限购也会造成饥饿感", sortOrder: order++ });
  items.push({ categoryIndex: 5, categoryName: "限购", subDimension: "限购", standard: "商品限购会影响买家多套下单，尤其是企业买家的大批量购买需求", sortOrder: order++ });
  items.push({ categoryIndex: 5, categoryName: "限购", subDimension: "限购", standard: "对于不同产品、不同库存灵活运用是否限购提升转化", sortOrder: order++ });
  // 6. 配送 (3项)
  items.push({ categoryIndex: 6, categoryName: "配送", subDimension: "配送方式", standard: "FBA优于FBM", sortOrder: order++ });
  items.push({ categoryIndex: 6, categoryName: "配送", subDimension: "配送时效", standard: "FBM发货配送时效缩短，设置处理时间和头程发货仓库库存分布。", sortOrder: order++ });
  items.push({ categoryIndex: 6, categoryName: "配送", subDimension: "不低于$25的商品", standard: "避免让客户承担配送费/亚马逊多次收尾程费", sortOrder: order++ });
  // 7. 变体 (5项)
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体数量", standard: "符合亚马逊规则要求，不宜过多，造成选择障碍", sortOrder: order++ });
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体名称", standard: "清晰易懂，不产生理解误差，减少决策阻碍", sortOrder: order++ });
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体图片", standard: "分类直观展现，方便理解变体间差异，减少决策阻碍（多种产品属性叠加命名，有可能利于提升转化，但属于违规行为不建议使用）", sortOrder: order++ });
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体逻辑", standard: "父体结构合理，变体结构有逻辑并符合消费者习惯", sortOrder: order++ });
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体价格", standard: "保证PC端和手机端均能清晰表达", sortOrder: order++ });
  // 8. 产品信息 (3项)
  items.push({ categoryIndex: 8, categoryName: "产品信息", subDimension: "完整性", standard: "更多的产品详细信息，既利于客户检索产品参数与自己需求是否匹配，也能体现卖家专业性，不出现误导顾客的信息", sortOrder: order++ });
  items.push({ categoryIndex: 8, categoryName: "产品信息", subDimension: "正确性", standard: "产品描述与实际一致，减少售后问题和产品审核风险", sortOrder: order++ });
  items.push({ categoryIndex: 8, categoryName: "产品信息", subDimension: "合规性", standard: "不出现亚马逊违规信息", sortOrder: order++ });
  // 9. 商品文档 (2项)
  items.push({ categoryIndex: 9, categoryName: "商品文档", subDimension: "产品介绍/安装文档", standard: "添加产品使用说明等文案以解决顾客问题，关心安装的用户可以快速看到安装手册", sortOrder: order++ });
  items.push({ categoryIndex: 9, categoryName: "商品文档", subDimension: "检测报告/安全认证", standard: "满足平台合规，提升专业度和客户信任度", sortOrder: order++ });
  // 10. 主图 (22项)
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "图片像素、清晰度、留白比例", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "主图场景化，让消费者有获得感和满足感，知道使用效果，体现产品差异化", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "家具白底图通过相关配件和装饰品提升图片的视觉效果", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "特定卖点 通过放大卖点细节来呈现", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "多功能家具不同摆放角度的测试最佳方案", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "加入节日素材", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "一图一卖点，展示尽可能全面", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "顺序按用户最关心的卖点重要等级排序", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "卖点呈现直观，不需要用户二次思考理解", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "文字简洁、语序语法正确", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "文案大小合适，适合阅读（手机、PC）", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "更多场景（符合当地，符合使用习惯）增加代入感", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "元素可视化，不要有过多的文字堆积", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "是否有尺寸/规格对比图，用参照物（如手机、信用卡）展示产品大小", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "更贴近真实安装场景的场景图，避免过于高大上脱离实际", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "品牌调性一致", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "反光、阴影、背景色、产品摆放位置", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "借助参考物直观反映出产品尺寸大小", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "视频", standard: "视频时长：30-60s", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "视频", standard: "视频数量：2-5个", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "视频", standard: "视频类型：安装视频、品牌视频、卖点视频、用户自拍视频", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "季节版、假日版、大促版", standard: "针对特定季节、假日、大促设计专属图片", sortOrder: order++ });
  // 11. 流量闭环 (6项)
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "新版本关联", standard: "新品绑定到老品New Model, 提升转化", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "新版本关联", standard: "占坑，防止流量丢失（另一个角度的提高转化）", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "新版本关联", standard: "新版本价格更高，提升本品转化", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "捆绑，buy together", standard: "配套产品捆绑销售，提高转化（羽毛球/羽毛球拍）", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "捆绑，buy together", standard: "设置捆绑优惠，提高转化", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "定位广告", standard: "有但有临界值；在临界值内占据更多坑位，提升整体转化", sortOrder: order++ });
  // 12. 品牌故事 (4项)
  items.push({ categoryIndex: 12, categoryName: "品牌故事", subDimension: "关联产品推荐", standard: "流量闭环，色调风格统一", sortOrder: order++ });
  items.push({ categoryIndex: 12, categoryName: "品牌故事", subDimension: "品牌形象", standard: "品牌背书-认证，成绩展示", sortOrder: order++ });
  items.push({ categoryIndex: 12, categoryName: "品牌故事", subDimension: "卖点介绍", standard: "核心卖点多次加强输出", sortOrder: order++ });
  items.push({ categoryIndex: 12, categoryName: "品牌故事", subDimension: "卖家介绍", standard: "体现专业性，讲述品牌理念和产品设计初衷", sortOrder: order++ });
  // 13. A+ (13项)
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "整体性", standard: "符合品牌调性，色调风格统一，弱化页面的切片感，遵循图片逻辑，更多品牌化特色", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "兼顾PC和手机端用户体验", standard: "在电脑端及移动端均能让顾客流畅浏览，避免图片展示不到位卖点表达不清晰的问题", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "卖点展示形式更多样", standard: "需要包含的板块（banner+核心卖点+场景集合+问答+流量闭环框+安装视频（可选）+品牌化视频等）巧用模块，提升A+观感和可玩性；模块服务于卖点，有空间做更多更详细的卖点表达，避免卖点堆砌重复", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "是否包含对比图表？", standard: "制作与竞品的参数对比表，突出核心优势", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "是否设计了清晰的故事线？", standard: "A+内容应有逻辑：吸引→展示卖点→解决疑虑→建立信任", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "页面更大，场景化", standard: "让买家身临其境，提高对产品的信任与喜爱", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "视频", standard: "智能产品可以放很多功能的介绍操作视频，帮助用户直观感受产品功能；也可以上传卖点视频来动态宣传每一个卖点", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "售后方式", standard: "亚马逊对视频审核较弱，视频最后几秒附上售后方式，提高客户售后联系频率", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "QA", standard: "将买家关注的热点问题突出展示，让顾客一目了然，在收到前就能解决相关问题", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "产品闭环", standard: "关联产品推荐、同类产品推荐", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "卖点痛点补充", standard: "补充额外的顾客痛点及关注点，进一步提升顾客下单的可能性", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "卖点对比", standard: "进一步加强卖点体现，让顾客在对比中明确能够获得的利益点", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "图片像素清晰度", standard: "图片展示清晰，提升页面美观性，增加顾客的好感度", sortOrder: order++ });
  // 14. Video (4项)
  items.push({ categoryIndex: 14, categoryName: "Video", subDimension: "主图视频", standard: "视频风格形式统一一致", sortOrder: order++ });
  items.push({ categoryIndex: 14, categoryName: "Video", subDimension: "主图视频", standard: "视频剪辑节奏符合产品调性", sortOrder: order++ });
  items.push({ categoryIndex: 14, categoryName: "Video", subDimension: "主图视频", standard: "包含产品的重要卖点，消费者的痛点", sortOrder: order++ });
  items.push({ categoryIndex: 14, categoryName: "Video", subDimension: "主图视频", standard: "有吸引力的开头，点赞数大于>3", sortOrder: order++ });
  // 15. Q&A (7项)
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "回复内容形式", standard: "文字回复和视频回复并行", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "点赞", standard: "核心消费者卖点痛点前置-QA点赞", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "数量", standard: "要有一定数量，让用户感知产品有讨论，有热度", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "及时性", standard: "要及时回复，积极解决顾客问题", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "专业性", standard: "用词专业，解决问题的一步到位", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "埋词量", standard: "更多的长尾词，属性词，获得更多搜索权重", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "回复账号", standard: "每条QA卖家买家都有回复，回复数量大于3", sortOrder: order++ });
  // 16. Review (5项)
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "vine", standard: "vine评论内容丰富，图文并茂+视频，比正常留评更有价值", sortOrder: order++ });
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "种子链接", standard: "确保推广期间前台搜索页面4.6分以上", sortOrder: order++ });
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "首页无差评", standard: "绝大部分用户习惯浏览第一页的评论", sortOrder: order++ });
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "关键词标签", standard: "通过用户体验打造形成关键词标签", sortOrder: order++ });
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "售后服务", standard: "用户针对售后服务的好评提及率高会提升高客单产品的转化率", sortOrder: order++ });
  // 17. 店铺介绍页面 (2项)
  items.push({ categoryIndex: 17, categoryName: "店铺介绍页面", subDimension: "Feedback", standard: "Feedback分数越高越好，无法删除的要去回复提升店铺形象", sortOrder: order++ });
  items.push({ categoryIndex: 17, categoryName: "店铺介绍页面", subDimension: "店铺介绍", standard: "店铺介绍有专业性，重点突出对于消费者权益的重视，提供售前售后电话/邮箱方便联系", sortOrder: order++ });
  // 18. 广告 (8项)
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "关键词词库", standard: "筛选出高转化关键词并建立关键词词库", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "广告分析", standard: "竞争对手流量，广告架构，策略分析", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "广告架构", standard: "【自动+手动(三种品牌方式)+长尾广泛+定位+品牌闭环】", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "时间表现", standard: "针对核心关键词做分时竞价和分时预算", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "标AC", standard: "不断提升关键词权重，做好AC标获取计划", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "广告优化", standard: "周度对ara排名进行跟进，有提升但未投放词及时进行测试，转化率差，cpa高的词，寻找合适的位置捡漏，或逐步淘汰。", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "广告测试", standard: "定期收录新的关键词，进行不同广告投放词的测试，持续提升产品的曝光，点击数据", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "关键数据跟踪", standard: "定期追踪广告关键词的不同位置的转化率，曝光量", sortOrder: order++ });  return items;
}
