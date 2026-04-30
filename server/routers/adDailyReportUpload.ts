/**
 * Ad Daily Report Upload Router - Upload and query 5 types of daily reports
 * for the Ad Deep Optimization module (Phase 0 data foundation)
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  adReportUploads,
  adDailyPlacementReports,
  adDailySearchTermReports,
  adDailyImpressionShareReports,
  adDailySbBenchmarkReports,
  adDailyBusinessReports,
  adPortfolioMappings,
} from "../../drizzle/schema";
import { eq, and, inArray, gte, lte, desc, sql } from "drizzle-orm";
import {
  parseDailyPlacementReport,
  parseDailySearchTermReport,
  parseDailyImpressionShareReport,
  parseDailySbBenchmarkReport,
  parseDailyBusinessReport,
} from "./adDailyReportParsers";

async function getDbInstance() {
  const d = await getDb();
  if (!d) throw new Error("数据库未连接");
  return d;
}

async function resolveParentAsinFromPortfolio(userId: number, portfolioName: string): Promise<string | null> {
  if (!portfolioName) return null;
  const d = await getDbInstance();
  const mappings = await d
    .select()
    .from(adPortfolioMappings)
    .where(and(eq(adPortfolioMappings.userId, userId), eq(adPortfolioMappings.portfolioName, portfolioName)))
    .limit(1);
  return mappings[0]?.parentAsin || null;
}

async function batchInsert<T extends Record<string, any>>(table: any, rows: T[], chunkSize = 50): Promise<void> {
  const d = await getDbInstance();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await d.insert(table).values(chunk as any);
  }
}

export const adDailyReportUploadRouter = router({
  // ─── Upload Daily Placement Report ──────────────────────────
  uploadDailyPlacement: protectedProcedure
    .input(z.object({
      fileBase64: z.string(),
      fileName: z.string(),
      reportDateStart: z.string(),
      reportDateEnd: z.string(),
      isCSV: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const parsedRows = await parseDailyPlacementReport(buffer, input.isCSV);
      if (parsedRows.length === 0) throw new Error("文件中没有有效数据行");

      const storeName = parsedRows[0]?.storeName || "";
      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "daily_placement",
        fileName: input.fileName,
        weekStartDate: input.reportDateStart,
        weekEndDate: input.reportDateEnd,
        dateLabel: `${input.reportDateStart} ~ ${input.reportDateEnd}`,
        totalRows: parsedRows.length,
        storeName,
        status: "parsing",
      });
      const uploadId = (uploadResult as any).insertId;

      try {
        const dbRows = await Promise.all(
          parsedRows.map(async (r) => {
            const parentAsin = await resolveParentAsinFromPortfolio(ctx.user.id, r.portfolioName);
            return {
              uploadId,
              userId: ctx.user.id,
              parentAsin,
              reportDate: r.reportDate || input.reportDateStart,
              storeName: r.storeName,
              country: r.country,
              adType: r.adType,
              portfolioName: r.portfolioName,
              campaignName: r.campaignName,
              placement: r.placement,
              impressions: r.impressions,
              clicks: r.clicks,
              ctr: r.ctr,
              cpc: r.cpc,
              spend: r.spend,
              sales: r.sales,
              directSales: r.directSales,
              indirectSales: r.indirectSales,
              acos: r.acos,
              roas: r.roas,
              orders: r.orders,
              directOrders: r.directOrders,
              indirectOrders: r.indirectOrders,
              cvr: r.cvr,
              cpa: r.cpa,
              brandNewOrders: r.brandNewOrders,
              brandNewSales: r.brandNewSales,
              viewableImpressions: r.viewableImpressions,
              vtr: r.vtr,
              vctr: r.vctr,
            };
          })
        );
        await batchInsert(adDailyPlacementReports, dbRows);
        await d.update(adReportUploads).set({ status: "completed", importedRows: parsedRows.length }).where(eq(adReportUploads.id, uploadId));
        return { uploadId, totalRows: parsedRows.length, importedRows: parsedRows.length };
      } catch (err: any) {
        await d.update(adReportUploads).set({ status: "failed", errorMessage: err.message }).where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Upload Daily Search Term Report ────────────────────────
  uploadDailySearchTerm: protectedProcedure
    .input(z.object({
      fileBase64: z.string(),
      fileName: z.string(),
      reportDateStart: z.string(),
      reportDateEnd: z.string(),
      isCSV: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const parsedRows = await parseDailySearchTermReport(buffer, input.isCSV);
      if (parsedRows.length === 0) throw new Error("文件中没有有效数据行");

      const storeName = parsedRows[0]?.storeName || "";
      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "daily_search_term",
        fileName: input.fileName,
        weekStartDate: input.reportDateStart,
        weekEndDate: input.reportDateEnd,
        dateLabel: `${input.reportDateStart} ~ ${input.reportDateEnd}`,
        totalRows: parsedRows.length,
        storeName,
        status: "parsing",
      });
      const uploadId = (uploadResult as any).insertId;

      try {
        const dbRows = await Promise.all(
          parsedRows.map(async (r) => {
            const parentAsin = await resolveParentAsinFromPortfolio(ctx.user.id, r.portfolioName);
            return {
              uploadId,
              userId: ctx.user.id,
              parentAsin,
              reportDate: r.reportDate || input.reportDateStart,
              storeName: r.storeName,
              country: r.country,
              adType: r.adType,
              portfolioName: r.portfolioName,
              campaignName: r.campaignName,
              adGroupName: r.adGroupName,
              keyword: r.keyword,
              matchType: r.matchType,
              targeting: r.targeting,
              searchTerm: r.searchTerm,
              impressions: r.impressions,
              clicks: r.clicks,
              ctr: r.ctr,
              cpc: r.cpc,
              spend: r.spend,
              sales: r.sales,
              directSales: r.directSales,
              indirectSales: r.indirectSales,
              acos: r.acos,
              roas: r.roas,
              orders: r.orders,
              directOrders: r.directOrders,
              indirectOrders: r.indirectOrders,
              cvr: r.cvr,
              cpa: r.cpa,
              avgOrderValue: r.avgOrderValue,
            };
          })
        );
        await batchInsert(adDailySearchTermReports, dbRows);
        await d.update(adReportUploads).set({ status: "completed", importedRows: parsedRows.length }).where(eq(adReportUploads.id, uploadId));
        return { uploadId, totalRows: parsedRows.length, importedRows: parsedRows.length };
      } catch (err: any) {
        await d.update(adReportUploads).set({ status: "failed", errorMessage: err.message }).where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Upload Daily Impression Share Report ───────────────────
  uploadDailyImpressionShare: protectedProcedure
    .input(z.object({
      fileBase64: z.string(),
      fileName: z.string(),
      reportDateStart: z.string(),
      reportDateEnd: z.string(),
      isCSV: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const parsedRows = await parseDailyImpressionShareReport(buffer, input.isCSV);
      if (parsedRows.length === 0) throw new Error("文件中没有有效数据行");

      const storeName = parsedRows[0]?.storeName || "";
      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "daily_impression_share",
        fileName: input.fileName,
        weekStartDate: input.reportDateStart,
        weekEndDate: input.reportDateEnd,
        dateLabel: `${input.reportDateStart} ~ ${input.reportDateEnd}`,
        totalRows: parsedRows.length,
        storeName,
        status: "parsing",
      });
      const uploadId = (uploadResult as any).insertId;

      try {
        const dbRows = await Promise.all(
          parsedRows.map(async (r) => {
            const parentAsin = await resolveParentAsinFromPortfolio(ctx.user.id, r.portfolioName);
            return {
              uploadId,
              userId: ctx.user.id,
              parentAsin,
              reportDate: r.reportDate || input.reportDateStart,
              storeName: r.storeName,
              country: r.country,
              adType: r.adType,
              portfolioName: r.portfolioName,
              campaignName: r.campaignName,
              adGroupName: r.adGroupName,
              targeting: r.targeting,
              searchTerm: r.searchTerm,
              impressionShare: r.impressionShare,
              impressionRank: r.impressionRank,
              impressions: r.impressions,
              clicks: r.clicks,
              ctr: r.ctr,
              spend: r.spend,
              sales: r.sales,
              acos: r.acos,
              orders: r.orders,
              topCompetitorShare: r.topCompetitorShare,
              topCompetitorAsin: r.topCompetitorAsin,
            };
          })
        );
        await batchInsert(adDailyImpressionShareReports, dbRows);
        await d.update(adReportUploads).set({ status: "completed", importedRows: parsedRows.length }).where(eq(adReportUploads.id, uploadId));
        return { uploadId, totalRows: parsedRows.length, importedRows: parsedRows.length };
      } catch (err: any) {
        await d.update(adReportUploads).set({ status: "failed", errorMessage: err.message }).where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Upload Daily SB Benchmark Report ──────────────────────
  uploadDailySbBenchmark: protectedProcedure
    .input(z.object({
      fileBase64: z.string(),
      fileName: z.string(),
      reportDateStart: z.string(),
      reportDateEnd: z.string(),
      isCSV: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const parsedRows = await parseDailySbBenchmarkReport(buffer, input.isCSV);
      if (parsedRows.length === 0) throw new Error("文件中没有有效数据行");

      const storeName = parsedRows[0]?.storeName || "";
      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "daily_sb_benchmark",
        fileName: input.fileName,
        weekStartDate: input.reportDateStart,
        weekEndDate: input.reportDateEnd,
        dateLabel: `${input.reportDateStart} ~ ${input.reportDateEnd}`,
        totalRows: parsedRows.length,
        storeName,
        status: "parsing",
      });
      const uploadId = (uploadResult as any).insertId;

      try {
        const dbRows = parsedRows.map((r) => ({
          uploadId,
          userId: ctx.user.id,
          reportDate: r.reportDate || input.reportDateStart,
          storeName: r.storeName,
          country: r.country,
          campaignName: r.campaignName,
          adFormat: r.adFormat,
          impressions: r.impressions,
          clicks: r.clicks,
          ctr: r.ctr,
          cpc: r.cpc,
          spend: r.spend,
          sales: r.sales,
          acos: r.acos,
          roas: r.roas,
          orders: r.orders,
          dpv: r.dpv,
          newToBrandOrders: r.newToBrandOrders,
          newToBrandSales: r.newToBrandSales,
          newToBrandRate: r.newToBrandRate,
          benchmarkCtr: r.benchmarkCtr,
          benchmarkCpc: r.benchmarkCpc,
          benchmarkAcos: r.benchmarkAcos,
          benchmarkRoas: r.benchmarkRoas,
          benchmarkCvr: r.benchmarkCvr,
          benchmarkDpvRate: r.benchmarkDpvRate,
          benchmarkNewToBrandRate: r.benchmarkNewToBrandRate,
          ctrVsBenchmark: r.ctrVsBenchmark,
          cpcVsBenchmark: r.cpcVsBenchmark,
          acosVsBenchmark: r.acosVsBenchmark,
        }));
        await batchInsert(adDailySbBenchmarkReports, dbRows);
        await d.update(adReportUploads).set({ status: "completed", importedRows: parsedRows.length }).where(eq(adReportUploads.id, uploadId));
        return { uploadId, totalRows: parsedRows.length, importedRows: parsedRows.length };
      } catch (err: any) {
        await d.update(adReportUploads).set({ status: "failed", errorMessage: err.message }).where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Upload Daily Business Report ──────────────────────────
  uploadDailyBusiness: protectedProcedure
    .input(z.object({
      fileBase64: z.string(),
      fileName: z.string(),
      reportDateStart: z.string(),
      reportDateEnd: z.string(),
      isCSV: z.boolean().default(false),
    }))
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const parsedRows = await parseDailyBusinessReport(buffer, input.isCSV);
      if (parsedRows.length === 0) throw new Error("文件中没有有效数据行");

      const storeName = parsedRows[0]?.storeName || "";
      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "daily_business",
        fileName: input.fileName,
        weekStartDate: input.reportDateStart,
        weekEndDate: input.reportDateEnd,
        dateLabel: `${input.reportDateStart} ~ ${input.reportDateEnd}`,
        totalRows: parsedRows.length,
        storeName,
        status: "parsing",
      });
      const uploadId = (uploadResult as any).insertId;

      try {
        const dbRows = parsedRows.map((r) => ({
          uploadId,
          userId: ctx.user.id,
          parentAsin: r.parentAsin || null,
          childAsin: r.childAsin,
          reportDate: r.reportDate || input.reportDateStart,
          storeName: r.storeName,
          country: r.country,
          sku: r.sku,
          productName: r.productName,
          sessions: r.sessions,
          sessionPercentage: r.sessionPercentage,
          pageViews: r.pageViews,
          pageViewsPercentage: r.pageViewsPercentage,
          buyBoxPercentage: r.buyBoxPercentage,
          unitsOrdered: r.unitsOrdered,
          unitsOrderedB2b: r.unitsOrderedB2b,
          unitSessionPercentage: r.unitSessionPercentage,
          unitSessionPercentageB2b: r.unitSessionPercentageB2b,
          orderedProductSales: r.orderedProductSales,
          orderedProductSalesB2b: r.orderedProductSalesB2b,
          totalOrderItems: r.totalOrderItems,
          totalOrderItemsB2b: r.totalOrderItemsB2b,
        }));
        await batchInsert(adDailyBusinessReports, dbRows);
        await d.update(adReportUploads).set({ status: "completed", importedRows: parsedRows.length }).where(eq(adReportUploads.id, uploadId));
        return { uploadId, totalRows: parsedRows.length, importedRows: parsedRows.length };
      } catch (err: any) {
        await d.update(adReportUploads).set({ status: "failed", errorMessage: err.message }).where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Query: Get portfolios with daily data ──────────────────
  getDailyPortfolios: protectedProcedure.query(async ({ ctx }) => {
    const d = await getDbInstance();
    // Get distinct portfolios from all 5 daily tables
    const [p1, p2, p3] = await Promise.all([
      d.selectDistinct({ name: adDailyPlacementReports.portfolioName })
        .from(adDailyPlacementReports)
        .where(eq(adDailyPlacementReports.userId, ctx.user.id)),
      d.selectDistinct({ name: adDailySearchTermReports.portfolioName })
        .from(adDailySearchTermReports)
        .where(eq(adDailySearchTermReports.userId, ctx.user.id)),
      d.selectDistinct({ name: adDailyImpressionShareReports.portfolioName })
        .from(adDailyImpressionShareReports)
        .where(eq(adDailyImpressionShareReports.userId, ctx.user.id)),
    ]);
    const allNames = new Set<string>();
    [...p1, ...p2, ...p3].forEach((r) => { if (r.name) allNames.add(r.name); });
    return Array.from(allNames).sort();
  }),

  // ─── Query: Get date range for daily data ───────────────────
  getDailyDateRange: protectedProcedure.query(async ({ ctx }) => {
    const d = await getDbInstance();
    const [result] = await d.select({
      minDate: sql<string>`MIN(report_date)`,
      maxDate: sql<string>`MAX(report_date)`,
    }).from(adDailyPlacementReports).where(eq(adDailyPlacementReports.userId, ctx.user.id));
    return { minDate: result?.minDate || "", maxDate: result?.maxDate || "" };
  }),

  // ─── Query: Daily data overview (counts per table) ──────────
  getDailyDataOverview: protectedProcedure.query(async ({ ctx }) => {
    const d = await getDbInstance();
    const [c1] = await d.select({ count: sql<number>`COUNT(*)` }).from(adDailyPlacementReports).where(eq(adDailyPlacementReports.userId, ctx.user.id));
    const [c2] = await d.select({ count: sql<number>`COUNT(*)` }).from(adDailySearchTermReports).where(eq(adDailySearchTermReports.userId, ctx.user.id));
    const [c3] = await d.select({ count: sql<number>`COUNT(*)` }).from(adDailyImpressionShareReports).where(eq(adDailyImpressionShareReports.userId, ctx.user.id));
    const [c4] = await d.select({ count: sql<number>`COUNT(*)` }).from(adDailySbBenchmarkReports).where(eq(adDailySbBenchmarkReports.userId, ctx.user.id));
    const [c5] = await d.select({ count: sql<number>`COUNT(*)` }).from(adDailyBusinessReports).where(eq(adDailyBusinessReports.userId, ctx.user.id));
    return {
      placement: c1?.count || 0,
      searchTerm: c2?.count || 0,
      impressionShare: c3?.count || 0,
      sbBenchmark: c4?.count || 0,
      business: c5?.count || 0,
    };
  }),

  // ─── Query: Daily placement data for analysis ───────────────
  queryDailyPlacement: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const data = await d.select().from(adDailyPlacementReports).where(
        and(
          eq(adDailyPlacementReports.userId, ctx.user.id),
          inArray(adDailyPlacementReports.portfolioName, input.portfolioNames),
          gte(adDailyPlacementReports.reportDate, input.dateStart),
          lte(adDailyPlacementReports.reportDate, input.dateEnd),
        )
      ).orderBy(adDailyPlacementReports.reportDate);
      return data;
    }),

  // ─── Query: Daily search term data for analysis ─────────────
  queryDailySearchTerm: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const data = await d.select().from(adDailySearchTermReports).where(
        and(
          eq(adDailySearchTermReports.userId, ctx.user.id),
          inArray(adDailySearchTermReports.portfolioName, input.portfolioNames),
          gte(adDailySearchTermReports.reportDate, input.dateStart),
          lte(adDailySearchTermReports.reportDate, input.dateEnd),
        )
      ).orderBy(adDailySearchTermReports.reportDate);
      return data;
    }),

  // ─── Query: Daily impression share data for analysis ────────
  queryDailyImpressionShare: protectedProcedure
    .input(z.object({
      portfolioNames: z.array(z.string()).min(1),
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const data = await d.select().from(adDailyImpressionShareReports).where(
        and(
          eq(adDailyImpressionShareReports.userId, ctx.user.id),
          inArray(adDailyImpressionShareReports.portfolioName, input.portfolioNames),
          gte(adDailyImpressionShareReports.reportDate, input.dateStart),
          lte(adDailyImpressionShareReports.reportDate, input.dateEnd),
        )
      ).orderBy(adDailyImpressionShareReports.reportDate);
      return data;
    }),

  // ─── Query: Daily SB benchmark data for analysis ────────────
  queryDailySbBenchmark: protectedProcedure
    .input(z.object({
      dateStart: z.string(),
      dateEnd: z.string(),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const data = await d.select().from(adDailySbBenchmarkReports).where(
        and(
          eq(adDailySbBenchmarkReports.userId, ctx.user.id),
          gte(adDailySbBenchmarkReports.reportDate, input.dateStart),
          lte(adDailySbBenchmarkReports.reportDate, input.dateEnd),
        )
      ).orderBy(adDailySbBenchmarkReports.reportDate);
      return data;
    }),

  // ─── Query: Daily business data for analysis ────────────────
  queryDailyBusiness: protectedProcedure
    .input(z.object({
      dateStart: z.string(),
      dateEnd: z.string(),
      childAsins: z.array(z.string()).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions = [
        eq(adDailyBusinessReports.userId, ctx.user.id),
        gte(adDailyBusinessReports.reportDate, input.dateStart),
        lte(adDailyBusinessReports.reportDate, input.dateEnd),
      ];
      if (input.childAsins && input.childAsins.length > 0) {
        conditions.push(inArray(adDailyBusinessReports.childAsin, input.childAsins));
      }
      const data = await d.select().from(adDailyBusinessReports).where(and(...conditions)).orderBy(adDailyBusinessReports.reportDate);
      return data;
    }),

  // ─── List daily upload history ──────────────────────────────
  listDailyUploads: protectedProcedure
    .input(z.object({
      reportType: z.enum(["daily_placement", "daily_search_term", "daily_impression_share", "daily_sb_benchmark", "daily_business"]).optional(),
      limit: z.number().min(1).max(100).default(50),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adReportUploads.userId, ctx.user.id)];
      if (input.reportType) {
        conditions.push(eq(adReportUploads.reportType, input.reportType as any));
      } else {
        conditions.push(
          inArray(adReportUploads.reportType, ["daily_placement", "daily_search_term", "daily_impression_share", "daily_sb_benchmark", "daily_business"] as any)
        );
      }
      const uploads = await d.select().from(adReportUploads)
        .where(and(...conditions))
        .orderBy(desc(adReportUploads.createdAt))
        .limit(input.limit);
      return uploads;
    }),

  // ─── Delete daily upload and its data ───────────────────────
  deleteDailyUpload: protectedProcedure
    .input(z.object({ uploadId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      // Verify ownership
      const [upload] = await d.select().from(adReportUploads)
        .where(and(eq(adReportUploads.id, input.uploadId), eq(adReportUploads.userId, ctx.user.id)));
      if (!upload) throw new Error("上传记录不存在");

      // Delete data from corresponding table
      const tableMap: Record<string, any> = {
        daily_placement: adDailyPlacementReports,
        daily_search_term: adDailySearchTermReports,
        daily_impression_share: adDailyImpressionShareReports,
        daily_sb_benchmark: adDailySbBenchmarkReports,
        daily_business: adDailyBusinessReports,
      };
      const table = tableMap[upload.reportType];
      if (table) {
        await d.delete(table).where(eq(table.uploadId, input.uploadId));
      }
      await d.delete(adReportUploads).where(eq(adReportUploads.id, input.uploadId));
      return { success: true };
    }),
});
