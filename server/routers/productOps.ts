import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getLingxingAdapter } from "../lingxingAdapter";
import {
  productProfiles, productVariants, productTodos, productLogs,
  keywordMonitors, keywordSnapshots,
  competitorMonitors, competitorSnapshots,
} from "../../drizzle/schema";
import { eq, desc, and, sql, asc } from "drizzle-orm";

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
        brand: input.brand,
        category: input.category,
        marketplace: input.marketplace,
        imageUrl: input.imageUrl,
        budgetRevenue: input.budgetRevenue,
        budgetProfit: input.budgetProfit,
        budgetAcos: input.budgetAcos,
        notes: input.notes,
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
        path: "/erp/sc/data/profit/list",
        body: { start_date: getDateNDaysAgo(30), end_date: getToday(), parent_asin: product.parentAsin },
      });

      const profitData = profitRes.data || [];
      const items = Array.isArray(profitData) ? profitData : (profitData as Record<string, unknown>).list ? ((profitData as Record<string, unknown>).list as unknown[]) : [profitData];

      // Calculate aggregated profit summary
      let totalRevenue = 0, totalProductCost = 0, totalAdSpend = 0;
      let totalFbaFee = 0, totalReferralFee = 0, totalOtherFee = 0, totalProfit = 0;
      let totalOrders = 0, totalUnits = 0;

      for (const item of items) {
        const i = item as Record<string, number>;
        totalRevenue += i.revenue || i.product_amount || 0;
        totalProductCost += i.product_cost || i.purchase_cost || 0;
        totalAdSpend += i.ad_spend || i.ads_cost || 0;
        totalFbaFee += i.fba_fee || i.fba_fees || 0;
        totalReferralFee += i.referral_fee || i.amazon_commission || 0;
        totalOtherFee += i.other_fee || i.storage_fee || 0;
        totalProfit += i.profit || 0;
        totalOrders += i.order_count || i.orders || 0;
        totalUnits += i.unit_count || i.units || 0;
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
          shippingCost: 0,
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
        path: "/erp/sc/routing/storage/fbaInventory",
        body: { sid: 1 },
      });

      const invList = Array.isArray(invRes.data) ? invRes.data : [];

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
        path: "/erp/sc/data/ad_manage/campaign/list",
        body: {},
      });

      const campaigns = Array.isArray(adRes.data) ? adRes.data : [];

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
});

// Helper functions
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
