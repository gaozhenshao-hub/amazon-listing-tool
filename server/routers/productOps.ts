import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getLingxingAdapter } from "../lingxingAdapter";
import { invokeLLM } from "../_core/llm";
import {
  productProfiles, productVariants, productTodos, productLogs,
  keywordMonitors, keywordSnapshots,
  competitorMonitors, competitorSnapshots,
  opsPlans, opsPlanActions, opsPlanSummaries,
  conversionComparisons, conversionCheckItems, conversionScores, conversionSuggestions,
  executionReviews, teamTasks,
} from "../../drizzle/schema";
import { eq, desc, and, sql, asc, isNull, inArray } from "drizzle-orm";

// ============== Product Operations Overview ==============
export const productOpsRouter = router({

  // ─── Product Profiles CRUD ───

  listProducts: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    const products = await db!.select().from(productProfiles)
      .where(eq(productProfiles.userId, ctx.user.id))
      .orderBy(desc(productProfiles.updatedAt));

    // For each product, get variant count, pending todo count
    const enriched = await Promise.all(products.map(async (p) => {
      const [variants, todos] = await Promise.all([
        db!.select({ count: sql<number>`count(*)` }).from(productVariants)
          .where(eq(productVariants.productId, p.id)),
        db!.select({ count: sql<number>`count(*)` }).from(productTodos)
          .where(and(eq(productTodos.productId, p.id), sql`${productTodos.status} != 'completed'`)),
      ]);
      return {
        ...p,
        variantCount: Number(variants[0]?.count ?? 0),
        pendingTodoCount: Number(todos[0]?.count ?? 0),
      };
    }));
    return enriched;
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
      const profitRes = await adapter.request({
        path: "/bd/profit/report/open/report/msku/list",
        body: { startDate: getDateNDaysAgo(30), endDate: getToday() },
      });

      // Normalize: profit API returns {records:[...]} or array
      const rawProfit = profitRes.data || [];
      const items = Array.isArray(rawProfit) ? rawProfit : (rawProfit as any).records || (rawProfit as any).list || [];

      // Calculate aggregated profit summary
      // Real API fields: totalFbaAndFbmAmount, productCost, adCost, fbaShippingFee, platformCommission, otherFee, totalProfit
      let totalRevenue = 0, totalProductCost = 0, totalAdSpend = 0;
      let totalFbaFee = 0, totalReferralFee = 0, totalOtherFee = 0, totalProfit = 0;
      let totalOrders = 0, totalUnits = 0;

      for (const item of items) {
        const i = item as Record<string, number>;
        // Real Lingxing fields: fees are negative, use Math.abs
        totalRevenue += i.totalFbaAndFbmAmount || i.platformIncome || i.revenue || 0;
        totalProductCost += Math.abs(i.cgPriceTotal || i.cgPriceAbsTotal || i.productCost || 0);
        totalAdSpend += Math.abs(i.totalAdsCost || i.adsSpCost || i.adCost || 0);
        totalFbaFee += Math.abs(i.totalFbaDeliveryFee || i.fbaDeliveryFee || i.fba_fee || 0);
        totalReferralFee += Math.abs(i.platformFee || i.platformCommission || i.referral_fee || 0);
        totalOtherFee += Math.abs(i.totalStorageFee || i.fbaStorageFee || i.otherFee || 0);
        totalProfit += i.grossProfit || i.totalProfit || i.profit || 0;
        totalOrders += i.totalSalesQuantity || i.order_count || i.orders || 0;
        totalUnits += i.totalFbaAndFbmQuantity || i.unit_count || i.units || 0;
      }

      const amazonFees = totalReferralFee + totalFbaFee;
      const netRevenue = totalRevenue - amazonFees;
      const fixedCosts = totalProductCost;
      const profitMargin = totalRevenue > 0 ? (totalProfit / totalRevenue * 100) : 0;

      return {
        // 预计 (budget targets)
        budget: {
          revenue: product.budgetRevenue ? Number(product.budgetRevenue) : null,
          profit: product.budgetProfit ? Number(product.budgetProfit) : null,
          acos: product.budgetAcos ? Number(product.budgetAcos) : null,
        },
        // 实况预测 (actual from Lingxing)
        actual: {
          revenue: round2(totalRevenue),
          amazonFees: round2(amazonFees),
          referralFee: round2(totalReferralFee),
          fbaFee: round2(totalFbaFee),
          adSpend: round2(totalAdSpend),
          storageFee: round2(totalOtherFee),
          netRevenue: round2(netRevenue),
          fixedCosts: round2(fixedCosts),
          productCost: round2(totalProductCost),
          shippingCost: round2(items.reduce((s: number, item: any) => s + Math.abs((item as any).cgTransportCostsTotal || 0), 0)),
          tariff: 0,
          profit: round2(totalProfit),
          profitMargin: round2(profitMargin),
          orders: totalOrders,
          units: totalUnits,
        },
        // 现时 (current period - partial month)
        current: {
          revenue: 0,
          profit: 0,
          orders: 0,
          units: 0,
        },
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
      const invRes = await adapter.request({
        path: "/erp/sc/routing/fba/fbaStock/fbaList",
        body: { sid: "1" },
      });

      // Normalize: FBA API returns {total, list:[...]} or array
      const rawInv = invRes.data || [];
      const invList = Array.isArray(rawInv) ? rawInv : (rawInv as any).list || [];

      // Build inventory summary per variant
      const variantInventory = variants.map(v => {
        const matched = invList.find((inv: Record<string, string>) =>
          inv.asin === v.childAsin || inv.seller_sku === v.sku
        );
        const inv = matched as Record<string, number> | undefined;
        return {
          childAsin: v.childAsin,
          sku: v.sku || "",
          title: v.title || "",
          fulfillableQty: inv?.fulfillable_quantity || inv?.afn_fulfillable_quantity || 0,
          inboundQty: inv?.inbound_quantity || inv?.afn_inbound_quantity || 0,
          reservedQty: inv?.reserved_quantity || inv?.afn_reserved_quantity || 0,
          avgDailySales: inv?.avg_daily_sales || 0,
          daysOfSupply: inv?.days_of_supply || 0,
        };
      });

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
      const adRes = await adapter.request({
        path: "/pb/openapi/newad/spCampaigns",
        body: { sid: 1 },
        headers: { "X-API-VERSION": "2" },
      });

      // Normalize: ad API may return array or {records/list}
      const rawAd = adRes.data || [];
      const campaigns = Array.isArray(rawAd) ? rawAd : (rawAd as any).records || (rawAd as any).list || [];

      let totalSpend = 0, totalSales = 0, totalClicks = 0, totalImpressions = 0, totalOrders = 0;
      const campaignList: Array<{
        name: string; status: string; spend: number; sales: number;
        acos: number; roas: number; clicks: number; impressions: number;
      }> = [];

      for (const c of campaigns) {
        const camp = c as Record<string, unknown>;
        const spend = Number(camp.cost || camp.spend || 0);
        const sales = Number(camp.sales || camp.attributed_sales || 0);
        const clicks = Number(camp.clicks || 0);
        const impressions = Number(camp.impressions || 0);
        const orders = Number(camp.orders || camp.attributed_orders || 0);

        totalSpend += spend;
        totalSales += sales;
        totalClicks += clicks;
        totalImpressions += impressions;
        totalOrders += orders;

        campaignList.push({
          name: String(camp.campaign_name || camp.name || "Unknown"),
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
    return db!.select().from(opsPlans)
      .where(and(eq(opsPlans.userId, ctx.user.id), eq(opsPlans.productProfileId, input.productProfileId)))
      .orderBy(desc(opsPlans.updatedAt));
  }),

  getPlan: protectedProcedure.input(z.object({ planId: z.number() })).query(async ({ ctx, input }) => {
    const db = await getDb();
    const [plan] = await db!.select().from(opsPlans)
      .where(and(eq(opsPlans.id, input.planId), eq(opsPlans.userId, ctx.user.id)));
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
    baselineDailySales: z.string().optional(),
    baselineDailyOrders: z.string().optional(),
    baselineAdConvRate: z.string().optional(),
    baselineIndustrySearchConvRate: z.string().optional(),
    baselineSearchConvRate: z.string().optional(),
    baselineCategorySearchConvRate: z.string().optional(),
    baselineAvgPrice: z.string().optional(),
    baselineRatingCount: z.number().optional(),
    baselineRatingScore: z.string().optional(),
    currentDailySales: z.string().optional(),
    currentDailyOrders: z.string().optional(),
    currentAdConvRate: z.string().optional(),
    currentIndustrySearchConvRate: z.string().optional(),
    currentSearchConvRate: z.string().optional(),
    currentCategorySearchConvRate: z.string().optional(),
    currentAvgPrice: z.string().optional(),
    currentRatingCount: z.number().optional(),
    currentRatingScore: z.string().optional(),
    targetSearchConvRate: z.string().optional(),
    targetOrderConvRate: z.string().optional(),
    targetAdConvRate: z.string().optional(),
    targetKeywordAdvantage: z.string().optional(),
  })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    const { planId, ...updates } = input;
    const cleanUpdates: Record<string, any> = {};
    for (const [k, v] of Object.entries(updates)) {
      if (v !== undefined) cleanUpdates[k] = v;
    }
    await db!.update(opsPlans).set(cleanUpdates).where(and(eq(opsPlans.id, planId), eq(opsPlans.userId, ctx.user.id)));
    return { success: true };
  }),

  deletePlan: protectedProcedure.input(z.object({ planId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
    await db!.delete(opsPlanActions).where(eq(opsPlanActions.planId, input.planId));
    await db!.delete(opsPlanSummaries).where(eq(opsPlanSummaries.planId, input.planId));
    await db!.delete(opsPlans).where(and(eq(opsPlans.id, input.planId), eq(opsPlans.userId, ctx.user.id)));
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

  getCheckItems: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    // Get system defaults (userId IS NULL) + user custom items
    const items = await db!.select().from(conversionCheckItems)
      .where(sql`${conversionCheckItems.userId} IS NULL OR ${conversionCheckItems.userId} = ${ctx.user.id}`)
      .orderBy(asc(conversionCheckItems.categoryIndex), asc(conversionCheckItems.sortOrder));
    return items;
  }),

  initDefaultCheckItems: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    // Check if defaults already exist
    const existing = await db!.select({ count: sql<number>`count(*)` }).from(conversionCheckItems)
      .where(isNull(conversionCheckItems.userId));
    if (Number(existing[0]?.count) > 0) return { message: "Default items already exist", count: Number(existing[0]?.count) };

    // Insert all 132 default check items
    const defaultItems = getDefault132CheckItems();
    for (const item of defaultItems) {
      await db!.insert(conversionCheckItems).values({ ...item, userId: null });
    }
    return { message: "Initialized", count: defaultItems.length };
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

  removeCustomCheckItem: protectedProcedure.input(z.object({ itemId: z.number() })).mutation(async ({ ctx, input }) => {
    const db = await getDb();
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
    if (input.score !== undefined) updates.score = input.score;
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
      if (s.score !== undefined) updates.score = s.score;
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

    // Generate mock crawl data for each ASIN
    const crawlData: Record<string, any> = {};
    for (const asin of allAsins) {
      crawlData[asin] = generateMockCrawlData(asin);
    }
    await db!.update(conversionComparisons).set({ crawlData, status: "scoring" as any })
      .where(eq(conversionComparisons.id, input.comparisonId));

    // Delete existing scores for this comparison
    await db!.delete(conversionScores).where(eq(conversionScores.comparisonId, input.comparisonId));

    // AI score each check item for each ASIN
    for (const asin of allAsins) {
      for (const item of checkItems) {
        // Check if already locked
        const existingLocked = await db!.select().from(conversionScores)
          .where(and(
            eq(conversionScores.comparisonId, input.comparisonId),
            eq(conversionScores.checkItemId, item.id),
            eq(conversionScores.asin, asin),
            eq(conversionScores.isLocked, 1)
          ));
        if (existingLocked.length > 0) continue;

        const mockScore = Math.floor(Math.random() * 5) + 1;
        const reasons = ["表现优秀，完全符合标准", "基本符合，有小幅提升空间", "一般水平，建议优化", "存在明显不足", "严重缺失，需要立即改进"];
        await db!.insert(conversionScores).values({
          comparisonId: input.comparisonId,
          checkItemId: item.id,
          asin,
          score: mockScore,
          aiScore: mockScore,
          reason: reasons[5 - mockScore],
          aiReason: reasons[5 - mockScore],
          rawData: JSON.stringify(crawlData[asin]?.[item.categoryName] || {}),
        });
      }
    }

    // Calculate overall score for own ASIN
    const ownScores = await db!.select().from(conversionScores)
      .where(and(eq(conversionScores.comparisonId, input.comparisonId), eq(conversionScores.asin, comp.ownAsin)));
    const avgScore = ownScores.length > 0
      ? round2(ownScores.reduce((sum, s) => sum + (s.score || 0), 0) / ownScores.length)
      : 0;

    await db!.update(conversionComparisons).set({
      overallOwnScore: String(avgScore),
      status: "completed" as any,
    }).where(eq(conversionComparisons.id, input.comparisonId));

    return { success: true, totalScores: ownScores.length, avgScore };
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
    .input(z.object({ productProfileId: z.number() }))
    .query(async ({ input }) => {
      const db = await getDb();
      return db!.select().from(executionReviews)
        .where(eq(executionReviews.productProfileId, input.productProfileId))
        .orderBy(desc(executionReviews.createdAt));
    }),

  createExecutionReview: protectedProcedure
    .input(z.object({
      productProfileId: z.number(),
      planId: z.number().optional(),
      period: z.string().min(1),
      periodType: z.enum(["weekly", "monthly", "quarterly"]).optional().default("monthly"),
      baselineSales: z.string().optional(), baselineProfit: z.string().optional(),
      baselineProfitRate: z.string().optional(), baselineOrderConvRate: z.string().optional(),
      baselineSearchConvRate: z.string().optional(), baselineAdConvRate: z.string().optional(),
      baselineRanking: z.number().optional(), baselineRating: z.string().optional(),
      targetSales: z.string().optional(), targetProfit: z.string().optional(),
      targetOrderConvRate: z.string().optional(), targetSearchConvRate: z.string().optional(),
      targetAdConvRate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [result] = await db!.insert(executionReviews).values({
        ...input, userId: ctx.user.id,
      });
      return { id: result.insertId };
    }),

  updateExecutionReview: protectedProcedure
    .input(z.object({
      reviewId: z.number(),
      actualSales: z.string().optional(), actualProfit: z.string().optional(),
      actualProfitRate: z.string().optional(), actualOrderConvRate: z.string().optional(),
      actualSearchConvRate: z.string().optional(), actualAdConvRate: z.string().optional(),
      actualRanking: z.number().optional(), actualRating: z.string().optional(),
      achievementSummary: z.string().optional(), keyActions: z.string().optional(),
      lessonsLearned: z.string().optional(), nextPeriodPlan: z.string().optional(),
      strategistFeedback: z.string().optional(),
      strategistRating: z.enum(["S", "A", "B", "C", "D"]).optional(),
      status: z.enum(["draft", "submitted", "reviewed"]).optional(),
      aiAnalysis: z.string().optional(), aiAnalysisLocked: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const { reviewId, ...updates } = input;
      const clean = Object.fromEntries(Object.entries(updates).filter(([, v]) => v !== undefined));
      if (Object.keys(clean).length > 0) {
        await db!.update(executionReviews).set(clean).where(eq(executionReviews.id, reviewId));
      }
      return { updated: true };
    }),

  deleteExecutionReview: protectedProcedure
    .input(z.object({ reviewId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      await db!.delete(executionReviews).where(eq(executionReviews.id, input.reviewId));
      return { deleted: true };
    }),

  aiReviewAnalysis: protectedProcedure
    .input(z.object({ reviewId: z.number() }))
    .mutation(async ({ input }) => {
      const db = await getDb();
      const [review] = await db!.select().from(executionReviews).where(eq(executionReviews.id, input.reviewId));
      if (!review) throw new TRPCError({ code: "NOT_FOUND" });
      if (review.aiAnalysisLocked) return { analysis: review.aiAnalysis };

      const prompt = `你是一位资深亚马逊运营游戏策划师，请基于以下复盘数据进行分析：\n\n期间：${review.period}\n基线数据：销售额${review.baselineSales}，利润${review.baselineProfit}，订单转化率${review.baselineOrderConvRate}%，搜索转化率${review.baselineSearchConvRate}%，广告转化率${review.baselineAdConvRate}%\n实际数据：销售额${review.actualSales}，利润${review.actualProfit}，订单转化率${review.actualOrderConvRate}%，搜索转化率${review.actualSearchConvRate}%，广告转化率${review.actualAdConvRate}%\n目标数据：销售额${review.targetSales}，利润${review.targetProfit}\n运营总结：${review.achievementSummary || '无'}\n关键动作：${review.keyActions || '无'}\n\n请从以下维度进行分析：\n1. 目标达成率评估（各指标达成百分比）\n2. 关键成功因素和不足之处\n3. 数据异常点分析\n4. 下一阶段优化建议（具体可执行的3-5条）\n5. 游戏策划师评语（激励性+指导性）`;

      const resp = await invokeLLM({ messages: [{ role: "user", content: prompt }] });
      const analysis = (resp.choices?.[0]?.message?.content as string) || "AI分析暂不可用";
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
      sellers = Array.isArray(sellerRes.data) ? sellerRes.data : (sellerRes.data as any)?.list || [];
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
        const res = await adapter.request({
          path: "/erp/sc/data/mws/listing",
          body: { sid: Number(sid), offset: 0, length: 200 },
        });
        const listings = Array.isArray(res.data) ? res.data : (res.data as any)?.list || [];
        
        // Group by parent ASIN (asin1 or asin)
        const parentMap = new Map<string, any>();
        for (const item of listings) {
          const asin = item.asin1 || item.asin || item.parent_asin;
          if (!asin) continue;
          if (!parentMap.has(asin)) {
            parentMap.set(asin, {
              parentAsin: asin,
              title: item.item_name || item.product_name || item.title || asin,
              brand: item.brand || '',
              category: item.item_type || item.product_type || '',
              marketplace,
              imageUrl: item.main_image || item.smallImageUrl || '',
              status: (item.status === 'Active' || item.status === 'active') ? 'active' : 'inactive',
              variants: [],
            });
          }
          // Add as variant if child ASIN is different
          const childAsin = item.asin || item.child_asin;
          if (childAsin && childAsin !== asin) {
            parentMap.get(asin)!.variants.push({
              childAsin,
              sku: item.msku || item.seller_sku || '',
              title: item.item_name || item.title || '',
              price: item.price ? String(item.price) : undefined,
            });
          }
        }
        
        // Insert new products
        for (const [asin, product] of Array.from(parentMap.entries())) {
          const key = `${asin}_${marketplace}`;
          if (existingSet.has(key)) {
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
    
    return { synced, skipped, total: synced + skipped };
  }),

});

// ═══════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════

function getToday(): string {
  return new Date().toISOString().split("T")[0];
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

// Default 132 check items
function getDefault132CheckItems() {
  const items: Array<{ categoryIndex: number; categoryName: string; subDimension: string; standard: string; sortOrder: number }> = [];
  let order = 0;

  // 1. 标题 (5项)
  const cat1 = ["可读性", "文字数字标点规范", "字数(≤200字符)", "内容(核心关键词+卖点)", "品牌名"];
  cat1.forEach(s => items.push({ categoryIndex: 1, categoryName: "标题", subDimension: s, standard: `检查标题${s}是否符合亚马逊规范`, sortOrder: order++ }));

  // 2. 五点 (7项)
  const cat2 = ["可读性", "字数(200-280字符/条)", "内容(功能+卖点)", "格式(统一格式)", "痛点覆盖", "场景描述", "用户人群定位"];
  cat2.forEach(s => items.push({ categoryIndex: 2, categoryName: "五点描述", subDimension: s, standard: `检查五点${s}`, sortOrder: order++ }));

  // 3. 长描述 (5项)
  const cat3 = ["可读性", "字数(≤2000字符)", "内容(品牌故事+产品详情)", "格式(HTML标签使用)", "关键词覆盖"];
  cat3.forEach(s => items.push({ categoryIndex: 3, categoryName: "长描述", subDimension: s, standard: `检查长描述${s}`, sortOrder: order++ }));

  // 4. 搜索词 (3项)
  const cat4 = ["字数(≤250字节)", "内容(无重复/无品牌词)", "关键词覆盖率"];
  cat4.forEach(s => items.push({ categoryIndex: 4, categoryName: "搜索词", subDimension: s, standard: `检查搜索词${s}`, sortOrder: order++ }));

  // 5. 价格 (5项)
  const cat5 = ["划线价设置", "优惠券", "促销活动", "会员折扣", "价格竞争力"];
  cat5.forEach(s => items.push({ categoryIndex: 5, categoryName: "价格", subDimension: s, standard: `检查${s}设置和竞争力`, sortOrder: order++ }));

  // 6. 变体 (3项)
  const cat6 = ["变体数量", "变体图片", "变体命名规范"];
  cat6.forEach(s => items.push({ categoryIndex: 6, categoryName: "变体", subDimension: s, standard: `检查${s}`, sortOrder: order++ }));

  // 7. 配送 (2项)
  const cat7 = ["配送方式(FBA/FBM)", "配送时效"];
  cat7.forEach(s => items.push({ categoryIndex: 7, categoryName: "配送", subDimension: s, standard: `检查${s}`, sortOrder: order++ }));

  // 8. 退货 (2项)
  const cat8 = ["退货政策", "退货率控制"];
  cat8.forEach(s => items.push({ categoryIndex: 8, categoryName: "退货", subDimension: s, standard: `检查${s}`, sortOrder: order++ }));

  // 9. 产品信息 (3项)
  const cat9 = ["信息完整性", "信息正确性", "合规性"];
  cat9.forEach(s => items.push({ categoryIndex: 9, categoryName: "产品信息", subDimension: s, standard: `检查产品信息${s}`, sortOrder: order++ }));

  // 10. 商品文档 (2项)
  const cat10 = ["产品介绍/安装文档", "检测报告/安全认证"];
  cat10.forEach(s => items.push({ categoryIndex: 10, categoryName: "商品文档", subDimension: s, standard: `检查是否上传${s}`, sortOrder: order++ }));

  // 11. 主图 (25项)
  const cat11 = [
    "首图-像素清晰度", "首图-白底纯净度", "首图-产品占比(≥85%)", "首图-角度选择", "首图-品牌调性", "首图-点击吸引力",
    "辅图-一图一卖点", "辅图-卖点排序逻辑", "辅图-文字大小适中", "辅图-场景化展示", "辅图-尺寸对比图", "辅图-使用步骤图",
    "辅图-包装内容展示", "辅图-认证/奖项展示", "辅图-人群匹配", "辅图-痛点解决展示", "辅图-细节放大图", "辅图-多角度展示",
    "视频-产品演示视频", "视频-使用场景视频", "视频-时长适中(30-60s)",
    "季节版主图", "假日版主图", "大促版主图", "A/B测试版本"
  ];
  cat11.forEach(s => items.push({ categoryIndex: 11, categoryName: "主图", subDimension: s, standard: `检查${s}`, sortOrder: order++ }));

  // 12. 流量闭环 (6项)
  const cat12 = ["新版本关联-升级款", "新版本关联-配件", "新版本关联-套装", "捆绑buy together-互补品", "捆绑buy together-同品类", "定位广告占位"];
  cat12.forEach(s => items.push({ categoryIndex: 12, categoryName: "流量闭环", subDimension: s, standard: `检查${s}设置`, sortOrder: order++ }));

  // 13. 品牌故事 (4项)
  const cat13 = ["关联产品推荐", "品牌形象展示", "卖点介绍", "卖家介绍"];
  cat13.forEach(s => items.push({ categoryIndex: 13, categoryName: "品牌故事", subDimension: s, standard: `检查品牌故事${s}`, sortOrder: order++ }));

  // 14. A+ (13项)
  const cat14 = ["整体性和连贯性", "PC和手机端兼顾", "卖点展示形式多样", "对比图表", "故事线逻辑", "场景化展示", "视频嵌入", "售后方式说明", "QA常见问题", "产品闭环推荐", "卖点痛点补充", "卖点对比(vs竞品)", "图片像素清晰度"];
  cat14.forEach(s => items.push({ categoryIndex: 14, categoryName: "A+", subDimension: s, standard: `检查A+${s}`, sortOrder: order++ }));

  // 15. Post (3项)
  const cat15 = ["发帖数量和频率", "图片质量-清晰度", "图片质量-吸引力"];
  cat15.forEach(s => items.push({ categoryIndex: 15, categoryName: "Post", subDimension: s, standard: `检查Post${s}`, sortOrder: order++ }));

  // 16. Video (4项)
  const cat16 = ["视频风格", "剪辑节奏", "卖点痛点呈现", "开头吸引力(前3秒)"];
  cat16.forEach(s => items.push({ categoryIndex: 16, categoryName: "Video", subDimension: s, standard: `检查视频${s}`, sortOrder: order++ }));

  // 17. Q&A (7项)
  const cat17 = ["回复内容形式", "点赞数量", "问答数量", "回复及时性", "回复专业性", "埋词量", "回复账号(官方/买家)"];
  cat17.forEach(s => items.push({ categoryIndex: 17, categoryName: "Q&A", subDimension: s, standard: `检查Q&A${s}`, sortOrder: order++ }));

  // 18. Review (5项)
  const cat18 = ["Vine计划", "种子链接", "首页无差评", "关键词标签", "售后服务响应"];
  cat18.forEach(s => items.push({ categoryIndex: 18, categoryName: "Review", subDimension: s, standard: `检查Review${s}`, sortOrder: order++ }));

  // 19. 店铺介绍 (2项)
  const cat19 = ["Feedback评分", "店铺介绍页面"];
  cat19.forEach(s => items.push({ categoryIndex: 19, categoryName: "店铺介绍", subDimension: s, standard: `检查${s}`, sortOrder: order++ }));

  // 20. 广告 (8项)
  const cat20 = ["关键词词库完整性", "广告数据分析", "广告架构合理性", "分时表现优化", "AC标获取", "广告优化频率", "广告A/B测试", "关键数据跟踪"];
  cat20.forEach(s => items.push({ categoryIndex: 20, categoryName: "广告", subDimension: s, standard: `检查广告${s}`, sortOrder: order++ }));

  return items;
}
