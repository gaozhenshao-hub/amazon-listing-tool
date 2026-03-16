import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { devProducts, devPanoramaStatus, devProjectTagCategories, devProjectTagItems, devProductTags } from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";

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

      return {
        products,
        tagMap,
        tagCategories: tagCategoryNames,
        tagItems,
        status,
        historyCols,
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
          projectId: input.projectId,
          userId: ctx.user.id,
          confirmed: 1,
          confirmedAt: new Date(),
          lastMergedAt: new Date(),
          totalProducts: total,
        });
      }
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

  // Export panorama as CSV
  exportCsv: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const products = await db.select().from(devProducts)
        .where(eq(devProducts.projectId, input.projectId))
        .orderBy(devProducts.searchRank);

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
        "价格($)", "FBA费用($)", "毛利率",
        "月销量", "月销量增长率", "月销售额($)", "子体销量", "子体销售额($)", "变体数",
        "评分数", "月新增评分数", "评分", "留评率", "LQS", "卖家数", "配送方式", "上架时间", "上架天数",
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
          p.price, p.fbaFee, p.grossMargin,
          p.monthlySales, p.monthlySalesGrowth, p.monthlyRevenue, p.childSales, p.childRevenue, p.variantCount,
          p.reviewCount, p.monthlyNewReviews, p.rating, p.reviewRate, p.lqs, p.sellerCount, p.fulfillment, p.listingDate, p.listingDays,
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
