import { z } from "zod";
import { router } from "../_core/trpc";
import { protectedProcedure } from "../domains/product_development/security/productDevelopmentProcedure";
import {
  productDevelopmentWorkspaceId,
  recordProductDevelopmentAudit,
} from "../domains/product_development/security/productDevelopmentAccess";
import { getDb } from "../repositories/dbClient";
import { devProducts, devPanoramaStatus, devProjectTagCategories, devProjectTagItems, devProductTags } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  buildAdaptivePriceBands,
  normalizeParentMarketMetrics,
  sanitizePriceBands,
} from "../domains/product_development/panorama/marketMetrics";
import {
  cancelPanoramaMarketInsight,
  confirmPanoramaMarketInsight,
  getPanoramaMarketInsight,
  queuePanoramaMarketInsight,
  savePanoramaMarketInsight,
  unlockPanoramaMarketInsight,
} from "../domains/product_development/panorama/marketInsightService";
import { panoramaCompetitorAsinsSchema } from "../domains/product_development/panorama/marketInsightSchema";
import { addPanoramaProduct, deletePanoramaProduct } from "../domains/product_development/panorama/panoramaProductService";

// ═══════════════════════════════════════════════════════════════════
// ─── Panorama (竞品全景分析表) Router ────────────────────────────
// ═══════════════════════════════════════════════════════════════════

export const devPanoramaRouter = router({
  // Get panorama data: all products + their tags for a project
  getData: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { products: [], tags: {}, status: null, historyCols: [] };

      // 1. Get all products
      const products = await db.select().from(devProducts)
        .where(eq(devProducts.projectId, input.projectId))
        .orderBy(devProducts.searchRank);

      // 2. Get all confirmed tag items for this project (from tag management)
      const tagItems = await db.select({
        id: devProjectTagItems.id,
        categoryId: devProjectTagItems.categoryId,
        tagName: devProjectTagItems.tagName,
        tagValue: devProjectTagItems.tagValue,
        projectId: devProjectTagItems.projectId,
      }).from(devProjectTagItems)
        .where(eq(devProjectTagItems.projectId, input.projectId));

      // 3. Get tag categories
      const tagCategories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId))
        .orderBy(devProjectTagCategories.sortOrder);

      // 4. Get product-level tags (devProductTags: asin → dimensionName → dimensionValue)
      const productTags = await db.select().from(devProductTags)
        .where(eq(devProductTags.projectId, input.projectId));

      // Build tag map: asin → { dimensionName: dimensionValue }
      const tagMap: Record<string, Record<string, string>> = {};
      for (const pt of productTags) {
        if (!tagMap[pt.asin]) tagMap[pt.asin] = {};
        tagMap[pt.asin][pt.dimensionName] = pt.dimensionValue;
      }

      // 5. Get panorama status
      const statusRows = await db.select().from(devPanoramaStatus)
        .where(and(
          eq(devPanoramaStatus.projectId, input.projectId),
          eq(devPanoramaStatus.userId, ctx.user.id)
        ));
      const status = statusRows[0] || null;

      // 6. Extract all unique history month columns
      const historyColSet = new Set<string>();
      for (const p of products) {
        if (p.monthlySalesHistory) {
          try {
            const h = JSON.parse(p.monthlySalesHistory as string);
            Object.keys(h).forEach(k => historyColSet.add(k));
          } catch {}
        }
      }
      // Sort history columns chronologically
      const historyCols = Array.from(historyColSet).sort((a, b) => {
        const parseDate = (s: string) => {
          const m = s.match(/(\d{4})[-/年](\d{1,2})/);
          return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
        };
        return parseDate(a) - parseDate(b);
      });

      // 7. Build tag category names for columns
      const tagCategoryNames = tagCategories.map(c => ({
        key: c.categoryKey,
        name: c.categoryName,
      }));

      const marketInsight = await getPanoramaMarketInsight(input.projectId).catch(() => null);
      const fallbackPriceBands = buildAdaptivePriceBands(products);
      const marketInsightInvalidated = Boolean(marketInsight?.runError?.includes("全景产品已"));
      const insightPriceBands = marketInsightInvalidated ? null : marketInsight?.result?.priceBands;
      const priceBands = sanitizePriceBands(insightPriceBands, fallbackPriceBands);
      const marketProducts = normalizeParentMarketMetrics(products, { priceBands });

      return {
        products: marketProducts,
        tagMap,
        tagCategories: tagCategoryNames,
        tagItems,
        status,
        historyCols,
        priceBands,
        priceBandSource: insightPriceBands
          ? (marketInsight?.status === "confirmed" ? "ai_confirmed" as const : "ai_draft" as const)
          : "adaptive" as const,
      };
    }),

  // Update a single product field (inline edit)
  updateProductField: protectedProcedure
    .input(z.object({
      productId: z.number(),
      field: z.string(),
      value: z.union([z.string(), z.number(), z.null()]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(devProducts)
        .set({ [input.field]: input.value })
        .where(eq(devProducts.id, input.productId));
      return { success: true };
    }),

  deleteProduct: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      productId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await deletePanoramaProduct(input);
      await recordProductDevelopmentAudit({
        ctx,
        action: "product_development.panorama.product.delete",
        projectId: input.projectId,
        resourceType: "dev_product",
        resourceId: input.productId,
        resourceName: result.asin || result.title || `product-${input.productId}`,
        riskLevel: "high",
        beforeSnapshot: { id: input.productId, asin: result.asin, title: result.title },
        afterSnapshot: {
          deleted: true,
          deletedTags: result.deletedTags,
          deletedReviews: result.deletedReviews,
          totalProducts: result.totalProducts,
          canceledRuns: result.canceledRuns,
        },
      });
      return result;
    }),

  addProduct: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      asin: z.string().trim().regex(/^[A-Za-z0-9]{10}$/, "ASIN 必须为 10 位字母或数字").transform((value) => value.toUpperCase()),
      parentAsin: z.string().trim().max(20).optional(),
      title: z.string().trim().min(1, "请填写商品标题").max(2000),
      brand: z.string().trim().max(255).optional(),
      price: z.string().trim().max(50).optional(),
      monthlySales: z.number().int().nonnegative().optional(),
      monthlyRevenue: z.number().nonnegative().optional(),
      rating: z.string().trim().max(10).optional(),
      reviewCount: z.number().int().nonnegative().optional(),
      listingDate: z.string().trim().max(50).optional(),
      imageUrl: z.string().trim().url("主图链接格式不正确").optional().or(z.literal("")),
      productLink: z.string().trim().url("商品链接格式不正确").optional().or(z.literal("")),
      category: z.string().trim().max(255).optional(),
      subcategory: z.string().trim().max(255).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const result = await addPanoramaProduct(input);
      await recordProductDevelopmentAudit({
        ctx,
        action: "product_development.panorama.product.add",
        projectId: input.projectId,
        resourceType: "dev_product",
        resourceId: result.productId,
        resourceName: result.asin,
        riskLevel: "medium",
        beforeSnapshot: null,
        afterSnapshot: {
          id: result.productId,
          asin: result.asin,
          title: result.title,
          totalProducts: result.totalProducts,
          canceledRuns: result.canceledRuns,
        },
      });
      return result;
    }),

  // Update product tag (set dimension value for an ASIN)
  updateProductTag: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      asin: z.string(),
      dimensionName: z.string(),
      dimensionValue: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      // Upsert: check if exists
      const existing = await db.select().from(devProductTags).where(and(
        eq(devProductTags.projectId, input.projectId),
        eq(devProductTags.asin, input.asin),
        eq(devProductTags.dimensionName, input.dimensionName),
      ));
      if (existing.length > 0) {
        await db.update(devProductTags)
          .set({ dimensionValue: input.dimensionValue })
          .where(eq(devProductTags.id, existing[0].id));
      } else {
        await db.insert(devProductTags).values({
          workspaceId: productDevelopmentWorkspaceId(ctx),
          projectId: input.projectId,
          asin: input.asin,
          dimensionName: input.dimensionName,
          dimensionValue: input.dimensionValue,
          source: "manual",
          confirmed: 1,
        });
      }
      return { success: true };
    }),

  // Confirm panorama table
  confirm: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const existing = await db.select().from(devPanoramaStatus).where(and(
        eq(devPanoramaStatus.projectId, input.projectId),
        eq(devPanoramaStatus.userId, ctx.user.id)
      ));
      const productCount = await db.select({ count: sql<number>`count(*)` })
        .from(devProducts).where(eq(devProducts.projectId, input.projectId));
      const total = Number(productCount[0]?.count || 0);
      if (existing.length > 0) {
        await db.update(devPanoramaStatus).set({
          confirmed: 1,
          confirmedAt: new Date(),
          totalProducts: total,
        }).where(eq(devPanoramaStatus.id, existing[0].id));
      } else {
        await db.insert(devPanoramaStatus).values({
          workspaceId: productDevelopmentWorkspaceId(ctx),
          projectId: input.projectId,
          userId: ctx.user.id,
          confirmed: 1,
          confirmedAt: new Date(),
          lastMergedAt: new Date(),
          totalProducts: total,
        });
      }
      await recordProductDevelopmentAudit({
        ctx,
        action: "product_development.panorama.confirm",
        projectId: input.projectId,
        resourceType: "dev_panorama",
        resourceId: input.projectId,
        afterSnapshot: { confirmed: true, totalProducts: total },
      });
      return { success: true };
    }),

  // Unlock panorama table
  unlock: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      await db.update(devPanoramaStatus).set({
        confirmed: 0,
        confirmedAt: null,
      }).where(and(
        eq(devPanoramaStatus.projectId, input.projectId),
        eq(devPanoramaStatus.userId, ctx.user.id)
      ));
      await recordProductDevelopmentAudit({
        ctx,
        action: "product_development.panorama.unlock",
        projectId: input.projectId,
        resourceType: "dev_panorama",
        resourceId: input.projectId,
        riskLevel: "high",
        afterSnapshot: { confirmed: false },
      });
      return { success: true };
    }),

  // Get panorama confirmation status (for gating downstream analyses)
  getStatus: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { confirmed: false };
      const rows = await db.select().from(devPanoramaStatus).where(and(
        eq(devPanoramaStatus.projectId, input.projectId),
        eq(devPanoramaStatus.userId, ctx.user.id)
      ));
      return { confirmed: rows[0]?.confirmed === 1, status: rows[0] || null };
    }),

  getMarketInsight: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(({ input }) => getPanoramaMarketInsight(input.projectId)),

  generateMarketInsight: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      competitorAsins: panoramaCompetitorAsinsSchema,
    }))
    .mutation(({ ctx, input }) => queuePanoramaMarketInsight({
      projectId: input.projectId,
      userId: ctx.user.id,
      workspaceId: productDevelopmentWorkspaceId(ctx),
      competitorAsins: input.competitorAsins,
    })),

  saveMarketInsight: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), result: z.unknown() }))
    .mutation(({ ctx, input }) => savePanoramaMarketInsight(input.projectId, ctx.user.id, input.result)),

  confirmMarketInsight: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive(), result: z.unknown() }))
    .mutation(async ({ ctx, input }) => {
      const result = await confirmPanoramaMarketInsight(input.projectId, ctx.user.id, input.result);
      await recordProductDevelopmentAudit({
        ctx,
        action: "product_development.panorama.market_insight.confirm",
        projectId: input.projectId,
        resourceType: "dev_panorama_market_insight",
        resourceId: result?.id || input.projectId,
        afterSnapshot: { status: "confirmed", version: result?.version },
      });
      return result;
    }),

  unlockMarketInsight: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const result = await unlockPanoramaMarketInsight(input.projectId, ctx.user.id);
      await recordProductDevelopmentAudit({
        ctx,
        action: "product_development.panorama.market_insight.unlock",
        projectId: input.projectId,
        resourceType: "dev_panorama_market_insight",
        resourceId: result?.id || input.projectId,
        riskLevel: "high",
        afterSnapshot: { status: "editing", version: result?.version },
      });
      return result;
    }),

  cancelMarketInsight: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .mutation(({ input }) => cancelPanoramaMarketInsight(input.projectId)),

  // Export panorama as CSV
  exportCsv: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const rawProducts = await db.select().from(devProducts)
        .where(eq(devProducts.projectId, input.projectId))
        .orderBy(devProducts.searchRank);
      const marketInsight = await getPanoramaMarketInsight(input.projectId).catch(() => null);
      const insightPriceBands = marketInsight?.runError?.includes("全景产品已")
        ? null
        : marketInsight?.result?.priceBands;
      const priceBands = sanitizePriceBands(
        insightPriceBands,
        buildAdaptivePriceBands(rawProducts),
      );
      const products = normalizeParentMarketMetrics(rawProducts, { priceBands });

      const tagCategories = await db.select().from(devProjectTagCategories)
        .where(eq(devProjectTagCategories.projectId, input.projectId))
        .orderBy(devProjectTagCategories.sortOrder);

      const productTags = await db.select().from(devProductTags)
        .where(eq(devProductTags.projectId, input.projectId));

      const tagMap: Record<string, Record<string, string>> = {};
      for (const pt of productTags) {
        if (!tagMap[pt.asin]) tagMap[pt.asin] = {};
        tagMap[pt.asin][pt.dimensionName] = pt.dimensionValue;
      }

      // Collect history columns
      const historyColSet = new Set<string>();
      for (const p of products) {
        if (p.monthlySalesHistory) {
          try {
            const h = JSON.parse(p.monthlySalesHistory as string);
            Object.keys(h).forEach(k => historyColSet.add(k));
          } catch {}
        }
      }
      const historyCols = Array.from(historyColSet).sort((a, b) => {
        const parseDate = (s: string) => {
          const m = s.match(/(\d{4})[-/年](\d{1,2})/);
          return m ? parseInt(m[1]) * 100 + parseInt(m[2]) : 0;
        };
        return parseDate(a) - parseDate(b);
      });

      // Build CSV headers
      const fixedHeaders = [
        "ASIN", "父ASIN", "SKU", "品牌", "商品链接", "主图链接",
        "大类目", "类目路径", "小类目", "大类BSR", "小类BSR", "大类BSR增长率",
        "商品标题", "产品卖点(五点)",
        "价格($)", "价格标签", "FBA费用($)", "毛利率",
        "月销量", "月销量增长率", "月销售额($)", "子体销量", "子体销售额($)", "变体数",
        "销量标签", "父体销量代表行", "评分数", "月新增评分数", "评分", "留评率", "LQS", "卖家数", "配送方式", "上架时间", "上架天数", "上架年份标签",
        "Buybox卖家", "BuyBox类型", "卖家所属地",
        "A+页面", "视频介绍", "品牌故事", "Amazon's Choice",
        "商品重量", "商品尺寸", "包装重量", "包装尺寸", "包装尺寸分段",
      ];
      const tagHeaders = tagCategories.map(c => c.categoryName);
      const allHeaders = [...fixedHeaders, ...historyCols, ...tagHeaders];

      const escCsv = (v: any) => {
        if (v === null || v === undefined) return "";
        const s = String(v);
        if (s.includes(",") || s.includes('"') || s.includes("\n")) {
          return '"' + s.replace(/"/g, '""') + '"';
        }
        return s;
      };

      const rows = ["\uFEFF" + allHeaders.map(escCsv).join(",")];
      for (const p of products) {
        const historyData: Record<string, number> = {};
        if (p.monthlySalesHistory) {
          try { Object.assign(historyData, JSON.parse(p.monthlySalesHistory as string)); } catch {}
        }
        const asinTags = tagMap[p.asin || ""] || {};
        const fixedValues = [
          p.asin, p.parentAsin, p.sku, p.brand, p.productLink, p.imageUrl,
          p.category, p.categoryPath, p.subcategory, p.bsrLarge, p.bsrSmall, p.bsrGrowthRate,
          p.title, p.bulletPoints,
          p.price, p.priceBandLabel, p.fbaFee, p.grossMargin,
          p.monthlySales, p.monthlySalesGrowth, p.monthlyRevenue, p.childSales, p.childRevenue, p.variantCount,
          p.salesTier, p.parentSalesRepresentative ? "是" : "否",
          p.reviewCount, p.monthlyNewReviews, p.rating, p.reviewRate, p.lqs, p.sellerCount, p.fulfillment, p.listingDate, p.listingDays, p.listingAgeLabel,
          p.buyboxSeller, p.buyboxType, p.sellerLocation,
          p.hasAPlus ? "是" : "否", p.hasVideo ? "是" : "否", p.hasBrandStory ? "是" : "否", p.hasAmazonChoice ? "是" : "否",
          p.productWeight, p.productSize, p.packageWeight, p.packageSize, p.packageSizeTier,
        ];
        const historyValues = historyCols.map(col => historyData[col] || "");
        const tagValues = tagCategories.map(c => asinTags[c.categoryName] || "");
        rows.push([...fixedValues, ...historyValues, ...tagValues].map(escCsv).join(","));
      }

      return { csv: rows.join("\n"), filename: `竞品全景分析表_${input.projectId}.csv` };
    }),
});
