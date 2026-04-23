/**
 * Ad Keyword Tracking Router
 * - ASIN ↔ Portfolio mapping management
 * - Ad report Excel import
 * - Keyword tracking data query (for product detail page)
 * - Keyword metadata (monthly search volume) management
 */
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  adPortfolioMappings,
  adReportImports,
  adKeywordWeekly,
  adKeywordMeta,
  adCompetitorRanks,
  productProfiles,
} from "../../drizzle/schema";
import { eq, desc, and, inArray, sql, like } from "drizzle-orm";
import { parseAdReportBuffer } from "../adReportParser";
import { storagePut } from "../storage";

export const adTrackingRouter = router({
  // ═══════════════════════════════════════════
  // Portfolio Mapping CRUD
  // ═══════════════════════════════════════════

  /** List all portfolio mappings for current user */
  listMappings: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
    const mappings = await db.select().from(adPortfolioMappings)
      .where(eq(adPortfolioMappings.userId, ctx.user.id))
      .orderBy(desc(adPortfolioMappings.createdAt));
    return mappings;
  }),

  /** Create a new portfolio mapping */
  createMapping: protectedProcedure
    .input(z.object({
      productId: z.number(),
      parentAsin: z.string(),
      portfolioName: z.string().min(1),
      storeName: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const [result] = await db.insert(adPortfolioMappings).values({
        userId: ctx.user.id,
        productId: input.productId,
        parentAsin: input.parentAsin,
        portfolioName: input.portfolioName,
        storeName: input.storeName || null,
        notes: input.notes || null,
      });
      return { id: result.insertId };
    }),

  /** Update a portfolio mapping */
  updateMapping: protectedProcedure
    .input(z.object({
      id: z.number(),
      productId: z.number().optional(),
      parentAsin: z.string().optional(),
      portfolioName: z.string().optional(),
      storeName: z.string().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      const { id, ...updates } = input;
      const cleanUpdates: Record<string, any> = {};
      if (updates.productId !== undefined) cleanUpdates.productId = updates.productId;
      if (updates.parentAsin !== undefined) cleanUpdates.parentAsin = updates.parentAsin;
      if (updates.portfolioName !== undefined) cleanUpdates.portfolioName = updates.portfolioName;
      if (updates.storeName !== undefined) cleanUpdates.storeName = updates.storeName;
      if (updates.notes !== undefined) cleanUpdates.notes = updates.notes;
      await db.update(adPortfolioMappings)
        .set(cleanUpdates)
        .where(and(eq(adPortfolioMappings.id, id), eq(adPortfolioMappings.userId, ctx.user.id)));
      return { success: true };
    }),

  /** Delete a portfolio mapping */
  deleteMapping: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.delete(adPortfolioMappings)
        .where(and(eq(adPortfolioMappings.id, input.id), eq(adPortfolioMappings.userId, ctx.user.id)));
      return { success: true };
    }),

  /** Batch create mappings */
  batchCreateMappings: protectedProcedure
    .input(z.object({
      mappings: z.array(z.object({
        productId: z.number(),
        parentAsin: z.string(),
        portfolioName: z.string().min(1),
        storeName: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      if (input.mappings.length === 0) return { created: 0 };
      const values = input.mappings.map(m => ({
        userId: ctx.user.id,
        productId: m.productId,
        parentAsin: m.parentAsin,
        portfolioName: m.portfolioName,
        storeName: m.storeName || null,
        notes: null,
      }));
      await db.insert(adPortfolioMappings).values(values);
      return { created: values.length };
    }),

  /** Get all products for mapping dropdown */
  listProductsForMapping: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    const products = await db.select({
      id: productProfiles.id,
      parentAsin: productProfiles.parentAsin,
      title: productProfiles.title,
      storeName: productProfiles.storeName,
      chineseName: productProfiles.chineseName,
    }).from(productProfiles)
      .where(eq(productProfiles.userId, ctx.user.id))
      .orderBy(productProfiles.parentAsin);
    return products;
  }),

  // ═══════════════════════════════════════════
  // Ad Report Import
  // ═══════════════════════════════════════════

  /** Upload and parse ad report Excel */
  uploadAdReport: protectedProcedure
    .input(z.object({
      fileName: z.string(),
      fileData: z.string(), // base64
      weekStartDate: z.string(), // YYYY-MM-DD
      weekEndDate: z.string(),   // YYYY-MM-DD
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      const buffer = Buffer.from(input.fileData, "base64");

      // Parse the Excel
      const parseResult = parseAdReportBuffer(buffer);
      if (parseResult.errors.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `解析错误: ${parseResult.errors.join(", ")}` });
      }

      // Upload to S3
      const suffix = Math.random().toString(36).substring(2, 8);
      const fileKey = `ad-reports/${ctx.user.id}/${Date.now()}-${suffix}.xlsx`;
      const { url: fileUrl } = await storagePut(fileKey, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      // Load portfolio mappings to determine which rows can be mapped
      const mappings = await db.select().from(adPortfolioMappings)
        .where(eq(adPortfolioMappings.userId, ctx.user.id));
      const portfolioToProduct = new Map<string, { productId: number; parentAsin: string }>();
      for (const m of mappings) {
        portfolioToProduct.set(m.portfolioName, { productId: m.productId, parentAsin: m.parentAsin });
      }

      // Determine mapped vs unmapped
      const unmappedPortfolios = new Set<string>();
      let mappedCount = 0;
      for (const row of parseResult.rows) {
        if (portfolioToProduct.has(row.portfolioName)) {
          mappedCount++;
        } else if (row.portfolioName) {
          unmappedPortfolios.add(row.portfolioName);
        }
      }

      // Create import record
      const [importRecord] = await db.insert(adReportImports).values({
        userId: ctx.user.id,
        fileName: input.fileName,
        fileUrl,
        weekStartDate: input.weekStartDate,
        weekEndDate: input.weekEndDate,
        totalRows: parseResult.totalRows,
        keywordRows: parseResult.keywordRows,
        productTargetRows: parseResult.productTargetRows,
        mappedRows: mappedCount,
        unmappedPortfolios: JSON.stringify([...unmappedPortfolios]),
        status: "previewing",
      });

      return {
        importId: importRecord.insertId,
        totalRows: parseResult.totalRows,
        keywordRows: parseResult.keywordRows,
        productTargetRows: parseResult.productTargetRows,
        mappedRows: mappedCount,
        unmappedPortfolios: [...unmappedPortfolios],
        uniquePortfolios: parseResult.uniquePortfolios,
        uniqueAdTypes: parseResult.uniqueAdTypes,
        uniqueStores: parseResult.uniqueStores,
        preview: parseResult.rows.slice(0, 20), // First 20 rows for preview
      };
    }),

  /** Confirm and import ad report data */
  confirmAdImport: protectedProcedure
    .input(z.object({
      importId: z.number(),
      fileName: z.string(),
      fileData: z.string(), // base64 - re-send for import
      weekStartDate: z.string(),
      weekEndDate: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Update status to importing
      await db.update(adReportImports)
        .set({ status: "importing" })
        .where(and(eq(adReportImports.id, input.importId), eq(adReportImports.userId, ctx.user.id)));

      try {
        const buffer = Buffer.from(input.fileData, "base64");
        const parseResult = parseAdReportBuffer(buffer);

        // Load portfolio mappings
        const mappings = await db.select().from(adPortfolioMappings)
          .where(eq(adPortfolioMappings.userId, ctx.user.id));
        const portfolioToProduct = new Map<string, { productId: number; parentAsin: string }>();
        for (const m of mappings) {
          portfolioToProduct.set(m.portfolioName, { productId: m.productId, parentAsin: m.parentAsin });
        }

        // Delete existing data for the same week to allow re-import
        await db.delete(adKeywordWeekly)
          .where(and(
            eq(adKeywordWeekly.userId, ctx.user.id),
            eq(adKeywordWeekly.weekStartDate, input.weekStartDate),
            eq(adKeywordWeekly.weekEndDate, input.weekEndDate),
          ));

        // Insert rows in batches
        const BATCH_SIZE = 100;
        let imported = 0;
        for (let i = 0; i < parseResult.rows.length; i += BATCH_SIZE) {
          const batch = parseResult.rows.slice(i, i + BATCH_SIZE);
          const values = batch.map(row => {
            const mapping = portfolioToProduct.get(row.portfolioName);
            return {
              importId: input.importId,
              userId: ctx.user.id,
              productId: mapping?.productId || null,
              parentAsin: mapping?.parentAsin || null,
              weekStartDate: input.weekStartDate,
              weekEndDate: input.weekEndDate,
              storeName: row.storeName,
              country: row.country,
              adType: row.adType,
              portfolioName: row.portfolioName,
              campaignName: row.campaignName,
              adGroupName: row.adGroupName,
              keyword: row.keyword,
              matchType: row.matchType,
              targetingType: row.targetingType,
              status: row.status,
              bid: row.bid ? String(row.bid) : null,
              defaultBid: row.defaultBid ? String(row.defaultBid) : null,
              impressions: row.impressions,
              impressionShare: row.impressionShare,
              clicks: row.clicks,
              ctr: row.ctr != null ? String(row.ctr) : null,
              cpc: row.cpc != null ? String(row.cpc) : null,
              spend: row.spend != null ? String(row.spend) : null,
              sales: row.sales != null ? String(row.sales) : null,
              directSales: row.directSales != null ? String(row.directSales) : null,
              indirectSales: row.indirectSales != null ? String(row.indirectSales) : null,
              acos: row.acos != null ? String(row.acos) : null,
              roas: row.roas != null ? String(row.roas) : null,
              orders: row.orders,
              directOrders: row.directOrders,
              indirectOrders: row.indirectOrders,
              cvr: row.cvr != null ? String(row.cvr) : null,
              adSalesQty: row.adSalesQty,
              directSalesQty: row.directSalesQty,
              indirectSalesQty: row.indirectSalesQty,
              brandNewOrders: row.brandNewOrders,
              brandNewSales: row.brandNewSales != null ? String(row.brandNewSales) : null,
              brandSearchCount: row.brandSearchCount,
            };
          });
          await db.insert(adKeywordWeekly).values(values);
          imported += batch.length;
        }

        // Update import record
        await db.update(adReportImports)
          .set({ status: "completed", importedRows: imported } as any)
          .where(eq(adReportImports.id, input.importId));

        return { success: true, imported };
      } catch (err: any) {
        await db.update(adReportImports)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(adReportImports.id, input.importId));
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `导入失败: ${err.message}` });
      }
    }),

  /** List ad report import history */
  listAdImports: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) return [];
    return db.select().from(adReportImports)
      .where(eq(adReportImports.userId, ctx.user.id))
      .orderBy(desc(adReportImports.createdAt));
  }),

  /** Delete an ad report import and its data */
  deleteAdImport: protectedProcedure
    .input(z.object({ importId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });
      await db.delete(adKeywordWeekly)
        .where(and(eq(adKeywordWeekly.importId, input.importId), eq(adKeywordWeekly.userId, ctx.user.id)));
      await db.delete(adReportImports)
        .where(and(eq(adReportImports.id, input.importId), eq(adReportImports.userId, ctx.user.id)));
      return { success: true };
    }),

  // ═══════════════════════════════════════════
  // Keyword Tracking Data (for product detail)
  // ═══════════════════════════════════════════

  /** Get keyword tracking data for a specific product */
  getProductKeywords: protectedProcedure
    .input(z.object({
      productId: z.number(),
      parentAsin: z.string().optional(),
      targetingType: z.enum(["keyword", "product", "all"]).default("keyword"),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return { keywords: [], weeks: [], meta: {} };

      // Get all keyword data for this product, ordered by week desc
      const conditions = [eq(adKeywordWeekly.userId, ctx.user.id)];
      if (input.productId > 0) {
        conditions.push(eq(adKeywordWeekly.productId, input.productId));
      } else if (input.parentAsin) {
        conditions.push(eq(adKeywordWeekly.parentAsin, input.parentAsin));
      }
      if (input.targetingType !== "all") {
        conditions.push(eq(adKeywordWeekly.targetingType, input.targetingType));
      }

      const data = await db.select().from(adKeywordWeekly)
        .where(and(...conditions))
        .orderBy(desc(adKeywordWeekly.weekStartDate));

      // Get keyword metadata (monthly search volume, etc.)
      const metaConditions = [eq(adKeywordMeta.userId, ctx.user.id)];
      if (input.productId > 0) {
        metaConditions.push(eq(adKeywordMeta.productId, input.productId));
      }
      const metaRows = await db.select().from(adKeywordMeta)
        .where(and(...metaConditions));

      // Build meta lookup: keyword → meta
      const metaMap: Record<string, any> = {};
      for (const m of metaRows) {
        metaMap[m.keyword] = {
          monthlySearchVolume: m.monthlySearchVolume,
          notes: m.notes,
          isTracked: m.isTracked,
        };
      }

      // Group by keyword+matchType+adType → weekly data
      const keywordGroups = new Map<string, {
        keyword: string;
        matchType: string;
        adType: string;
        campaignName: string;
        adGroupName: string;
        portfolioName: string;
        targetingType: string;
        weeks: any[];
      }>();

      const allWeeks = new Set<string>();

      for (const row of data) {
        const key = `${row.keyword}||${row.matchType}||${row.adType}`;
        allWeeks.add(`${row.weekStartDate}~${row.weekEndDate}`);

        if (!keywordGroups.has(key)) {
          keywordGroups.set(key, {
            keyword: row.keyword,
            matchType: row.matchType,
            adType: row.adType,
            campaignName: row.campaignName || "",
            adGroupName: row.adGroupName || "",
            portfolioName: row.portfolioName || "",
            targetingType: row.targetingType,
            weeks: [],
          });
        }

        keywordGroups.get(key)!.weeks.push({
          weekStartDate: row.weekStartDate,
          weekEndDate: row.weekEndDate,
          impressions: row.impressions,
          clicks: row.clicks,
          ctr: row.ctr ? Number(row.ctr) : null,
          cpc: row.cpc ? Number(row.cpc) : null,
          spend: row.spend ? Number(row.spend) : null,
          sales: row.sales ? Number(row.sales) : null,
          acos: row.acos ? Number(row.acos) : null,
          roas: row.roas ? Number(row.roas) : null,
          orders: row.orders,
          cvr: row.cvr ? Number(row.cvr) : null,
          adSalesQty: row.adSalesQty,
          directSales: row.directSales ? Number(row.directSales) : null,
          indirectSales: row.indirectSales ? Number(row.indirectSales) : null,
          directOrders: row.directOrders,
          indirectOrders: row.indirectOrders,
          bid: row.bid ? Number(row.bid) : null,
          status: row.status,
          impressionShare: row.impressionShare,
          brandNewOrders: row.brandNewOrders,
          brandNewSales: row.brandNewSales ? Number(row.brandNewSales) : null,
          brandSearchCount: row.brandSearchCount,
        });
      }

      // Sort weeks descending
      const sortedWeeks = [...allWeeks].sort().reverse();

      // Convert to array and sort by latest week impressions desc
      const keywordsArr = [...keywordGroups.values()].map(g => ({
        ...g,
        meta: metaMap[g.keyword] || null,
        latestImpressions: g.weeks[0]?.impressions || 0,
        latestSpend: g.weeks[0]?.spend || 0,
      })).sort((a, b) => b.latestSpend - a.latestSpend || b.latestImpressions - a.latestImpressions);

      return {
        keywords: keywordsArr,
        weeks: sortedWeeks,
        meta: metaMap,
      };
    }),

  /** Get competitor rank data for a product's keywords */
  getProductCompetitorRanks: protectedProcedure
    .input(z.object({
      productId: z.number(),
      keyword: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) return [];
      const conditions = [
        eq(adCompetitorRanks.userId, ctx.user.id),
        eq(adCompetitorRanks.productId, input.productId),
      ];
      if (input.keyword) {
        conditions.push(eq(adCompetitorRanks.keyword, input.keyword));
      }
      return db.select().from(adCompetitorRanks)
        .where(and(...conditions))
        .orderBy(desc(adCompetitorRanks.weekStartDate));
    }),

  // ═══════════════════════════════════════════
  // Keyword Metadata Management
  // ═══════════════════════════════════════════

  /** Update monthly search volume for a keyword */
  updateKeywordMeta: protectedProcedure
    .input(z.object({
      productId: z.number(),
      parentAsin: z.string().optional(),
      keyword: z.string(),
      monthlySearchVolume: z.number().nullable(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      // Check if meta exists
      const existing = await db.select().from(adKeywordMeta)
        .where(and(
          eq(adKeywordMeta.userId, ctx.user.id),
          eq(adKeywordMeta.productId, input.productId),
          eq(adKeywordMeta.keyword, input.keyword),
        ))
        .limit(1);

      if (existing.length > 0) {
        await db.update(adKeywordMeta)
          .set({
            monthlySearchVolume: input.monthlySearchVolume,
            searchVolumeUpdatedAt: new Date(),
            notes: input.notes !== undefined ? input.notes : undefined,
          })
          .where(eq(adKeywordMeta.id, existing[0].id));
      } else {
        await db.insert(adKeywordMeta).values({
          userId: ctx.user.id,
          productId: input.productId,
          parentAsin: input.parentAsin || null,
          keyword: input.keyword,
          monthlySearchVolume: input.monthlySearchVolume,
          searchVolumeUpdatedAt: new Date(),
          notes: input.notes || null,
        });
      }

      return { success: true };
    }),

  /** Batch update keyword metadata */
  batchUpdateKeywordMeta: protectedProcedure
    .input(z.object({
      productId: z.number(),
      parentAsin: z.string().optional(),
      updates: z.array(z.object({
        keyword: z.string(),
        monthlySearchVolume: z.number().nullable(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Database not available" });

      for (const update of input.updates) {
        const existing = await db.select().from(adKeywordMeta)
          .where(and(
            eq(adKeywordMeta.userId, ctx.user.id),
            eq(adKeywordMeta.productId, input.productId),
            eq(adKeywordMeta.keyword, update.keyword),
          ))
          .limit(1);

        if (existing.length > 0) {
          await db.update(adKeywordMeta)
            .set({
              monthlySearchVolume: update.monthlySearchVolume,
              searchVolumeUpdatedAt: new Date(),
            })
            .where(eq(adKeywordMeta.id, existing[0].id));
        } else {
          await db.insert(adKeywordMeta).values({
            userId: ctx.user.id,
            productId: input.productId,
            parentAsin: input.parentAsin || null,
            keyword: update.keyword,
            monthlySearchVolume: update.monthlySearchVolume,
            searchVolumeUpdatedAt: new Date(),
          });
        }
      }

      return { success: true, updated: input.updates.length };
    }),
});
