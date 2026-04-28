/**
 * Ad Report Upload Router - Upload, list, delete ad report files
 * Replaces Lingxing API calls with local database data from uploaded files
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  adReportUploads,
  adSearchTermReports,
  adCampaignReports,
  adPlacementReports,
  adHourlyReports,
  adOrderHourly,
  adPortfolioMappings,
} from "../../drizzle/schema";
import { eq, and, inArray, sql, desc } from "drizzle-orm";
import {
  parseSearchTermReport,
  parseCampaignReport,
  parsePlacementReport,
  parseHourlyReport,
  parseOrderReport,
} from "./adReportParsers";

// Helper: get db instance
async function getDbInstance() {
  const d = await getDb();
  if (!d) throw new Error("数据库未连接");
  return d;
}

// Helper: resolve parentAsin from portfolio name using ad_portfolio_mappings
async function resolveParentAsinFromPortfolio(
  userId: number,
  portfolioName: string
): Promise<string | null> {
  if (!portfolioName) return null;
  const d = await getDbInstance();
  const mappings = await d
    .select()
    .from(adPortfolioMappings)
    .where(
      and(
        eq(adPortfolioMappings.userId, userId),
        eq(adPortfolioMappings.portfolioName, portfolioName)
      )
    )
    .limit(1);
  return mappings[0]?.parentAsin || null;
}

// Helper: batch insert with chunking to avoid MySQL packet limits
async function batchInsert<T extends Record<string, any>>(
  table: any,
  rows: T[],
  chunkSize: number = 50
): Promise<void> {
  const d = await getDbInstance();
  for (let i = 0; i < rows.length; i += chunkSize) {
    const chunk = rows.slice(i, i + chunkSize);
    await d.insert(table).values(chunk as any);
  }
}

export const adReportUploadRouter = router({
  // ─── List upload history ─────────────────────────────────────
  listUploads: protectedProcedure
    .input(
      z.object({
        reportType: z.enum(["search_term", "campaign", "placement", "hourly", "order"]).optional(),
        limit: z.number().min(1).max(100).default(50),
        offset: z.number().min(0).default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const conditions = [eq(adReportUploads.userId, ctx.user.id)];
      if (input.reportType) {
        conditions.push(eq(adReportUploads.reportType, input.reportType));
      }
      const d = await getDbInstance();
      const uploads = await d
        .select()
        .from(adReportUploads)
        .where(and(...conditions))
        .orderBy(desc(adReportUploads.createdAt))
        .limit(input.limit)
        .offset(input.offset);
      return uploads;
    }),

  // ─── Upload search term report ───────────────────────────────
  uploadSearchTermReport: protectedProcedure
    .input(
      z.object({
        fileBase64: z.string(),
        fileName: z.string(),
        weekStartDate: z.string(),
        weekEndDate: z.string(),
        dateLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const parsedRows = await parseSearchTermReport(buffer);
      if (parsedRows.length === 0) {
        throw new Error("文件中没有有效数据行");
      }

      // Detect store name from first row
      const storeName = parsedRows[0]?.storeName || "";

      // Create upload record
      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "search_term",
        fileName: input.fileName,
        weekStartDate: input.weekStartDate,
        weekEndDate: input.weekEndDate,
        dateLabel: input.dateLabel || `${input.weekStartDate} ~ ${input.weekEndDate}`,
        totalRows: parsedRows.length,
        storeName,
        status: "parsing",
      });
      const uploadId = uploadResult.insertId;

      try {
        // Resolve parentAsin for each row via portfolio mapping
        const dbRows = await Promise.all(
          parsedRows.map(async (r) => {
            const parentAsin = await resolveParentAsinFromPortfolio(ctx.user.id, r.portfolioName);
            return {
              uploadId,
              userId: ctx.user.id,
              parentAsin,
              weekStartDate: input.weekStartDate,
              weekEndDate: input.weekEndDate,
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
              indirectOrderRatio: r.indirectOrderRatio,
              cpa: r.cpa,
              cvr: r.cvr,
              avgOrderValue: r.avgOrderValue,
              directAvgOrderValue: r.directAvgOrderValue,
              indirectAvgOrderValue: r.indirectAvgOrderValue,
            };
          })
        );

        await batchInsert(adSearchTermReports, dbRows);

        // Update upload status
        await d
          .update(adReportUploads)
          .set({ status: "completed", importedRows: parsedRows.length })
          .where(eq(adReportUploads.id, uploadId));

        return { uploadId, totalRows: parsedRows.length, importedRows: parsedRows.length };
      } catch (err: any) {
        await d
          .update(adReportUploads)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Upload campaign report ──────────────────────────────────
  uploadCampaignReport: protectedProcedure
    .input(
      z.object({
        fileBase64: z.string(),
        fileName: z.string(),
        weekStartDate: z.string(),
        weekEndDate: z.string(),
        dateLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const parsedRows = await parseCampaignReport(buffer);
      if (parsedRows.length === 0) throw new Error("文件中没有有效数据行");

      const storeName = parsedRows[0]?.storeName || "";
      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "campaign",
        fileName: input.fileName,
        weekStartDate: input.weekStartDate,
        weekEndDate: input.weekEndDate,
        dateLabel: input.dateLabel || `${input.weekStartDate} ~ ${input.weekEndDate}`,
        totalRows: parsedRows.length,
        storeName,
        status: "parsing",
      });
      const uploadId = uploadResult.insertId;

      try {
        const dbRows = await Promise.all(
          parsedRows.map(async (r) => {
            const parentAsin = await resolveParentAsinFromPortfolio(ctx.user.id, r.portfolioName);
            return {
              uploadId,
              userId: ctx.user.id,
              parentAsin,
              weekStartDate: input.weekStartDate,
              weekEndDate: input.weekEndDate,
              storeName: r.storeName,
              country: r.country,
              adType: r.adType,
              portfolioName: r.portfolioName,
              campaignName: r.campaignName,
              effectiveStatus: r.effectiveStatus,
              budget: r.budget,
              impressions: r.impressions,
              impressionShare: r.impressionShare,
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
              indirectOrderRatio: r.indirectOrderRatio,
              cpa: r.cpa,
              cvr: r.cvr,
              avgOrderValue: r.avgOrderValue,
              directAvgOrderValue: r.directAvgOrderValue,
              indirectAvgOrderValue: r.indirectAvgOrderValue,
              brandNewOrders: r.brandNewOrders,
              brandNewCvr: r.brandNewCvr,
              brandNewSales: r.brandNewSales,
              brandNewSalesQty: r.brandNewSalesQty,
              adSalesQty: r.adSalesQty,
              directSalesQty: r.directSalesQty,
              indirectSalesQty: r.indirectSalesQty,
              vcpm: r.vcpm,
              viewableImpressions: r.viewableImpressions,
              dpv: r.dpv,
              fiveSecViews: r.fiveSecViews,
              fiveSecViewRate: r.fiveSecViewRate,
              videoQuarter: r.videoQuarter,
              videoHalf: r.videoHalf,
              videoThreeQuarter: r.videoThreeQuarter,
              videoComplete: r.videoComplete,
              videoUnmute: r.videoUnmute,
              vtr: r.vtr,
              vctr: r.vctr,
              brandSearchCount: r.brandSearchCount,
              avgReach: r.avgReach,
              cumulativeReach: r.cumulativeReach,
              tags: r.tags,
            };
          })
        );

        await batchInsert(adCampaignReports, dbRows);
        await d
          .update(adReportUploads)
          .set({ status: "completed", importedRows: parsedRows.length })
          .where(eq(adReportUploads.id, uploadId));

        return { uploadId, totalRows: parsedRows.length, importedRows: parsedRows.length };
      } catch (err: any) {
        await d
          .update(adReportUploads)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Upload placement report ─────────────────────────────────
  uploadPlacementReport: protectedProcedure
    .input(
      z.object({
        fileBase64: z.string(),
        fileName: z.string(),
        weekStartDate: z.string(),
        weekEndDate: z.string(),
        dateLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const parsedRows = await parsePlacementReport(buffer);
      if (parsedRows.length === 0) throw new Error("文件中没有有效数据行");

      const storeName = parsedRows[0]?.storeName || "";
      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "placement",
        fileName: input.fileName,
        weekStartDate: input.weekStartDate,
        weekEndDate: input.weekEndDate,
        dateLabel: input.dateLabel || `${input.weekStartDate} ~ ${input.weekEndDate}`,
        totalRows: parsedRows.length,
        storeName,
        status: "parsing",
      });
      const uploadId = uploadResult.insertId;

      try {
        const dbRows = await Promise.all(
          parsedRows.map(async (r) => {
            const parentAsin = await resolveParentAsinFromPortfolio(ctx.user.id, r.portfolioName);
            return {
              uploadId,
              userId: ctx.user.id,
              parentAsin,
              weekStartDate: input.weekStartDate,
              weekEndDate: input.weekEndDate,
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
              indirectOrderRatio: r.indirectOrderRatio,
              cpa: r.cpa,
              cvr: r.cvr,
              avgOrderValue: r.avgOrderValue,
              directAvgOrderValue: r.directAvgOrderValue,
              indirectAvgOrderValue: r.indirectAvgOrderValue,
              brandNewOrders: r.brandNewOrders,
              brandNewCvr: r.brandNewCvr,
              brandNewSales: r.brandNewSales,
              brandNewSalesQty: r.brandNewSalesQty,
              adSalesQty: r.adSalesQty,
              directSalesQty: r.directSalesQty,
              indirectSalesQty: r.indirectSalesQty,
              viewableImpressions: r.viewableImpressions,
              dpv: r.dpv,
              fiveSecViews: r.fiveSecViews,
              fiveSecViewRate: r.fiveSecViewRate,
              videoQuarter: r.videoQuarter,
              videoHalf: r.videoHalf,
              videoThreeQuarter: r.videoThreeQuarter,
              videoComplete: r.videoComplete,
              videoUnmute: r.videoUnmute,
              vtr: r.vtr,
              vctr: r.vctr,
              brandSearchCount: r.brandSearchCount,
            };
          })
        );

        await batchInsert(adPlacementReports, dbRows);
        await d
          .update(adReportUploads)
          .set({ status: "completed", importedRows: parsedRows.length })
          .where(eq(adReportUploads.id, uploadId));

        return { uploadId, totalRows: parsedRows.length, importedRows: parsedRows.length };
      } catch (err: any) {
        await d
          .update(adReportUploads)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Upload hourly report (Amazon CSV) ───────────────────────
  uploadHourlyReport: protectedProcedure
    .input(
      z.object({
        csvText: z.string(),
        fileName: z.string(),
        reportDate: z.string().optional(), // YYYY-MM-DD
        dateLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const parsedRows = parseHourlyReport(input.csvText);
      if (parsedRows.length === 0) throw new Error("文件中没有有效数据行");

      const accountName = parsedRows[0]?.accountName || "";
      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "hourly",
        fileName: input.fileName,
        weekStartDate: input.reportDate,
        dateLabel: input.dateLabel || input.reportDate || "小时报告",
        totalRows: parsedRows.length,
        storeName: accountName,
        status: "parsing",
      });
      const uploadId = uploadResult.insertId;

      try {
        const dbRows = parsedRows.map((r) => ({
          uploadId,
          userId: ctx.user.id,
          parentAsin: r.promotedAsin || null,
          hour: r.hour,
          reportDate: input.reportDate,
          currency: r.currency,
          accountName: r.accountName,
          portfolioName: r.portfolioName,
          campaignName: r.campaignName,
          campaignId: r.campaignId,
          adGroupName: r.adGroupName,
          adGroupId: r.adGroupId,
          targetingValue: r.targetingValue,
          searchTerm: r.searchTerm,
          promotedSku: r.promotedSku,
          promotedAsin: r.promotedAsin,
          placementName: r.placementName,
          placementClassification: r.placementClassification,
          impressions: r.impressions,
          invalidImpressions: r.invalidImpressions,
          clicks: r.clicks,
          invalidClicks: r.invalidClicks,
          ctr: r.ctr,
          cpc: r.cpc,
          cpm: r.cpm,
          vcpm: r.vcpm,
          vctr: r.vctr,
          spend: r.spend,
          purchases: r.purchases,
          sales: r.sales,
          costPerPurchase: r.costPerPurchase,
          purchaseRate: r.purchaseRate,
          roas: r.roas,
          clickPurchases: r.clickPurchases,
          clickRoas: r.clickRoas,
        }));

        await batchInsert(adHourlyReports, dbRows);
        await d
          .update(adReportUploads)
          .set({ status: "completed", importedRows: parsedRows.length })
          .where(eq(adReportUploads.id, uploadId));

        return { uploadId, totalRows: parsedRows.length, importedRows: parsedRows.length };
      } catch (err: any) {
        await d
          .update(adReportUploads)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Upload order report (Lingxing SC export) ────────────────
  uploadOrderReport: protectedProcedure
    .input(
      z.object({
        fileBase64: z.string(),
        fileName: z.string(),
        timezoneOffset: z.number().default(-7), // PST=-7, EST=-4
        dateLabel: z.string().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.fileBase64, "base64");
      const parsedRows = await parseOrderReport(buffer, input.timezoneOffset);
      if (parsedRows.length === 0) throw new Error("文件中没有有效数据行");

      const storeName = parsedRows[0]?.storeName || "";
      // Determine date range from data
      const dates = parsedRows.map((r) => r.orderDateStr).sort();
      const weekStartDate = dates[0];
      const weekEndDate = dates[dates.length - 1];

      const d = await getDbInstance();
      const [uploadResult] = await d.insert(adReportUploads).values({
        userId: ctx.user.id,
        reportType: "order",
        fileName: input.fileName,
        weekStartDate,
        weekEndDate,
        dateLabel: input.dateLabel || `${weekStartDate} ~ ${weekEndDate}`,
        totalRows: parsedRows.length,
        storeName,
        status: "parsing",
      });
      const uploadId = uploadResult.insertId;

      try {
        // Resolve parentAsin from ASIN via product_profiles
        const dbRows = parsedRows.map((r) => ({
          uploadId,
          userId: ctx.user.id,
          parentAsin: null as string | null, // Will be resolved below
          orderId: r.orderId,
          orderStatus: r.orderStatus,
          orderType: r.orderType,
          orderDate: r.orderDate,
          orderHour: r.orderHour,
          orderDayOfWeek: r.orderDayOfWeek,
          orderDateStr: r.orderDateStr,
          storeName: r.storeName,
          country: r.country,
          asin: r.asin,
          sku: r.sku,
          msku: r.msku,
          productName: r.productName,
          quantity: r.quantity,
          unitPrice: r.unitPrice,
          salesRevenue: r.salesRevenue,
          itemPrice: r.itemPrice,
          currency: r.currency,
        }));

        await batchInsert(adOrderHourly, dbRows);
        await d
          .update(adReportUploads)
          .set({ status: "completed", importedRows: parsedRows.length })
          .where(eq(adReportUploads.id, uploadId));

        return {
          uploadId,
          totalRows: parsedRows.length,
          importedRows: parsedRows.length,
          dateRange: { start: weekStartDate, end: weekEndDate },
        };
      } catch (err: any) {
        await d
          .update(adReportUploads)
          .set({ status: "failed", errorMessage: err.message })
          .where(eq(adReportUploads.id, uploadId));
        throw err;
      }
    }),

  // ─── Delete upload and cascade delete data ───────────────────
  deleteUpload: protectedProcedure
    .input(z.object({ uploadId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const d = await getDbInstance();
      // Get upload record
      const [upload] = await d
        .select()
        .from(adReportUploads)
        .where(
          and(eq(adReportUploads.id, input.uploadId), eq(adReportUploads.userId, ctx.user.id))
        );
      if (!upload) throw new Error("上传记录不存在");

      // Cascade delete based on report type
      const tableMap: Record<string, any> = {
        search_term: adSearchTermReports,
        campaign: adCampaignReports,
        placement: adPlacementReports,
        hourly: adHourlyReports,
        order: adOrderHourly,
      };
      const table = tableMap[upload.reportType];
      if (table) {
        await d.delete(table).where(eq(table.uploadId, input.uploadId));
      }

      // Delete upload record
      await d.delete(adReportUploads).where(eq(adReportUploads.id, input.uploadId));

      return { success: true, deletedType: upload.reportType };
    }),

  // ─── Query search term data (for analysis tabs) ──────────────
  querySearchTerms: protectedProcedure
    .input(
      z.object({
        parentAsin: z.string().optional(),
        weekStartDate: z.string().optional(),
        weekEndDate: z.string().optional(),
        adType: z.string().optional(),
        portfolioName: z.string().optional(),
        campaignName: z.string().optional(),
        limit: z.number().default(500),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions = [eq(adSearchTermReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adSearchTermReports.parentAsin, input.parentAsin));
      if (input.weekStartDate) conditions.push(eq(adSearchTermReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(eq(adSearchTermReports.weekEndDate, input.weekEndDate));
      if (input.adType) conditions.push(eq(adSearchTermReports.adType, input.adType));
      if (input.portfolioName) conditions.push(eq(adSearchTermReports.portfolioName, input.portfolioName));
      if (input.campaignName) conditions.push(eq(adSearchTermReports.campaignName, input.campaignName));

      const data = await d
        .select()
        .from(adSearchTermReports)
        .where(and(...conditions))
        .limit(input.limit)
        .offset(input.offset);

      return data;
    }),

  // ─── Query campaign data ─────────────────────────────────────
  queryCampaigns: protectedProcedure
    .input(
      z.object({
        parentAsin: z.string().optional(),
        weekStartDate: z.string().optional(),
        weekEndDate: z.string().optional(),
        adType: z.string().optional(),
        portfolioName: z.string().optional(),
        limit: z.number().default(200),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions = [eq(adCampaignReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adCampaignReports.parentAsin, input.parentAsin));
      if (input.weekStartDate) conditions.push(eq(adCampaignReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(eq(adCampaignReports.weekEndDate, input.weekEndDate));
      if (input.adType) conditions.push(eq(adCampaignReports.adType, input.adType));
      if (input.portfolioName) conditions.push(eq(adCampaignReports.portfolioName, input.portfolioName));

      return d
        .select()
        .from(adCampaignReports)
        .where(and(...conditions))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // ─── Query placement data ────────────────────────────────────
  queryPlacements: protectedProcedure
    .input(
      z.object({
        parentAsin: z.string().optional(),
        weekStartDate: z.string().optional(),
        weekEndDate: z.string().optional(),
        adType: z.string().optional(),
        portfolioName: z.string().optional(),
        campaignName: z.string().optional(),
        limit: z.number().default(200),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions = [eq(adPlacementReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adPlacementReports.parentAsin, input.parentAsin));
      if (input.weekStartDate) conditions.push(eq(adPlacementReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(eq(adPlacementReports.weekEndDate, input.weekEndDate));
      if (input.adType) conditions.push(eq(adPlacementReports.adType, input.adType));
      if (input.portfolioName) conditions.push(eq(adPlacementReports.portfolioName, input.portfolioName));
      if (input.campaignName) conditions.push(eq(adPlacementReports.campaignName, input.campaignName));

      return d
        .select()
        .from(adPlacementReports)
        .where(and(...conditions))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // ─── Query hourly data ───────────────────────────────────────
  queryHourlyData: protectedProcedure
    .input(
      z.object({
        parentAsin: z.string().optional(),
        promotedAsin: z.string().optional(),
        reportDate: z.string().optional(),
        campaignName: z.string().optional(),
        limit: z.number().default(1000),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions = [eq(adHourlyReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adHourlyReports.parentAsin, input.parentAsin));
      if (input.promotedAsin) conditions.push(eq(adHourlyReports.promotedAsin, input.promotedAsin));
      if (input.reportDate) conditions.push(eq(adHourlyReports.reportDate, input.reportDate));
      if (input.campaignName) conditions.push(eq(adHourlyReports.campaignName, input.campaignName));

      return d
        .select()
        .from(adHourlyReports)
        .where(and(...conditions))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // ─── Query order hourly data (for dayparting pivot) ──────────
  queryOrderHourly: protectedProcedure
    .input(
      z.object({
        parentAsin: z.string().optional(),
        asin: z.string().optional(),
        storeName: z.string().optional(),
        startDate: z.string().optional(), // YYYY-MM-DD
        endDate: z.string().optional(),
        limit: z.number().default(2000),
        offset: z.number().default(0),
      })
    )
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions = [eq(adOrderHourly.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adOrderHourly.parentAsin, input.parentAsin));
      if (input.asin) conditions.push(eq(adOrderHourly.asin, input.asin));
      if (input.storeName) conditions.push(eq(adOrderHourly.storeName, input.storeName));

      return d
        .select()
        .from(adOrderHourly)
        .where(and(...conditions))
        .limit(input.limit)
        .offset(input.offset);
    }),

  // ─── Get available date ranges per report type ───────────────
  getAvailableDateRanges: protectedProcedure
    .input(z.object({ reportType: z.enum(["search_term", "campaign", "placement", "hourly", "order"]) }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const uploads = await d
        .select({
          id: adReportUploads.id,
          weekStartDate: adReportUploads.weekStartDate,
          weekEndDate: adReportUploads.weekEndDate,
          dateLabel: adReportUploads.dateLabel,
          storeName: adReportUploads.storeName,
          importedRows: adReportUploads.importedRows,
          createdAt: adReportUploads.createdAt,
        })
        .from(adReportUploads)
        .where(
          and(
            eq(adReportUploads.userId, ctx.user.id),
            eq(adReportUploads.reportType, input.reportType),
            eq(adReportUploads.status, "completed")
          )
        )
        .orderBy(desc(adReportUploads.createdAt));

      return uploads;
    }),
});
