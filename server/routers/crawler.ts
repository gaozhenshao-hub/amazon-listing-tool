import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  competitorMonitors, competitorSnapshots,
  keywordMonitors, keywordSnapshots,
  systemSettings,
} from "../../drizzle/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  crawlCompetitorData, crawlKeywordRank,
  executeCrawlBatch, getSchedulerStatus,
  startScheduler, stopScheduler,
  type CrawlJob,
} from "../crawlerEngine";

function getToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export const crawlerRouter = router({

  // ─── Manual Crawl: Single Competitor ───
  crawlCompetitor: protectedProcedure
    .input(z.object({ monitorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [monitor] = await db!.select().from(competitorMonitors)
        .where(and(
          eq(competitorMonitors.id, input.monitorId),
          eq(competitorMonitors.userId, ctx.user.id)
        ));
      if (!monitor) return { success: false, error: "Monitor not found" };

      const result = await crawlCompetitorData(monitor.competitorAsin, monitor.marketplace || "US");

      if (result.success && result.data) {
        const d = result.data;
        // Save snapshot
        await db!.insert(competitorSnapshots).values({
          monitorId: monitor.id,
          snapshotDate: getToday(),
          price: d.price?.toString() ?? null,
          bsrRank: d.bsrRank,
          bsrCategory: d.bsrCategory,
          reviewCount: d.reviewCount,
          rating: d.rating?.toString() ?? null,
          isInStock: d.isInStock ? 1 : 0,
          couponInfo: d.couponInfo,
          dealInfo: d.dealInfo,
          mainImageUrl: d.mainImageUrl,
          bulletPoints: d.bulletPoints,
        });

        // Update monitor last checked
        await db!.update(competitorMonitors)
          .set({
            lastCheckedAt: new Date(),
            competitorTitle: d.title || monitor.competitorTitle,
          })
          .where(eq(competitorMonitors.id, monitor.id));
      }

      return {
        success: result.success,
        data: result.data,
        error: result.error,
        duration: result.duration,
        usedProxy: result.usedProxy,
      };
    }),

  // ─── Manual Crawl: Single Keyword ───
  crawlKeyword: protectedProcedure
    .input(z.object({ keywordMonitorId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const [monitor] = await db!.select().from(keywordMonitors)
        .where(and(
          eq(keywordMonitors.id, input.keywordMonitorId),
          eq(keywordMonitors.userId, ctx.user.id)
        ));
      if (!monitor) return { success: false, error: "Keyword monitor not found" };

      const targetAsin = monitor.targetAsin || "";
      const result = await crawlKeywordRank(monitor.keyword, targetAsin, monitor.marketplace || "US");

      if (result.success && result.data) {
        const d = result.data;
        await db!.insert(keywordSnapshots).values({
          keywordMonitorId: monitor.id,
          snapshotDate: getToday(),
          organicRank: d.organicRank,
          adRank: d.adRank,
          pageNumber: d.pageNumber,
          totalResults: d.totalResults,
        });

        await db!.update(keywordMonitors)
          .set({ lastCheckedAt: new Date() })
          .where(eq(keywordMonitors.id, monitor.id));
      }

      return {
        success: result.success,
        data: result.data,
        error: result.error,
        duration: result.duration,
        usedProxy: result.usedProxy,
      };
    }),

  // ─── Batch Crawl: All Active Competitors for User ───
  crawlAllCompetitors: protectedProcedure.mutation(async ({ ctx }) => {
    const db = await getDb();
    const monitors = await db!.select().from(competitorMonitors)
      .where(and(
        eq(competitorMonitors.userId, ctx.user.id),
        eq(competitorMonitors.isActive, 1)
      ));

    if (monitors.length === 0) return { success: true, total: 0, results: [] };

    const jobs: CrawlJob[] = monitors.map(m => ({
      type: "competitor" as const,
      id: m.id,
      asin: m.competitorAsin,
      marketplace: m.marketplace || "US",
    }));

    const results = await executeCrawlBatch(jobs);

    // Save results to DB
    for (const jr of results) {
      if (jr.result.success && jr.result.data) {
        const d = jr.result.data;
        await db!.insert(competitorSnapshots).values({
          monitorId: jr.id,
          snapshotDate: getToday(),
          price: d.price?.toString() ?? null,
          bsrRank: d.bsrRank,
          bsrCategory: d.bsrCategory,
          reviewCount: d.reviewCount,
          rating: d.rating?.toString() ?? null,
          isInStock: d.isInStock ? 1 : 0,
          couponInfo: d.couponInfo,
          dealInfo: d.dealInfo,
          mainImageUrl: d.mainImageUrl,
          bulletPoints: d.bulletPoints,
        });

        await db!.update(competitorMonitors)
          .set({ lastCheckedAt: new Date(), competitorTitle: d.title || undefined })
          .where(eq(competitorMonitors.id, jr.id));
      }
    }

    return {
      success: true,
      total: results.length,
      successCount: results.filter(r => r.result.success).length,
      failedCount: results.filter(r => !r.result.success).length,
      results: results.map(r => ({
        monitorId: r.id,
        asin: r.asin,
        success: r.result.success,
        error: r.result.error,
        duration: r.result.duration,
      })),
    };
  }),

  // ─── Batch Crawl: All Active Keywords for a Product ───
  crawlAllKeywords: protectedProcedure
    .input(z.object({ productId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const monitors = await db!.select().from(keywordMonitors)
        .where(and(
          eq(keywordMonitors.userId, ctx.user.id),
          eq(keywordMonitors.productId, input.productId),
          eq(keywordMonitors.isActive, 1)
        ));

      if (monitors.length === 0) return { success: true, total: 0, results: [] };

      const jobs: CrawlJob[] = monitors.map(m => ({
        type: "keyword" as const,
        id: m.id,
        keyword: m.keyword,
        targetAsin: m.targetAsin || "",
        marketplace: m.marketplace || "US",
      }));

      const results = await executeCrawlBatch(jobs);

      // Save results to DB
      for (const jr of results) {
        if (jr.result.success && jr.result.data) {
          const d = jr.result.data;
          await db!.insert(keywordSnapshots).values({
            keywordMonitorId: jr.id,
            snapshotDate: getToday(),
            organicRank: d.organicRank,
            adRank: d.adRank,
            pageNumber: d.pageNumber,
            totalResults: d.totalResults,
          });

          await db!.update(keywordMonitors)
            .set({ lastCheckedAt: new Date() })
            .where(eq(keywordMonitors.id, jr.id));
        }
      }

      return {
        success: true,
        total: results.length,
        successCount: results.filter(r => r.result.success).length,
        failedCount: results.filter(r => !r.result.success).length,
        results: results.map(r => ({
          monitorId: r.id,
          keyword: r.keyword,
          success: r.result.success,
          error: r.result.error,
          duration: r.result.duration,
        })),
      };
    }),

  // ─── Scheduler Control ───
  getSchedulerStatus: protectedProcedure.query(() => {
    return getSchedulerStatus();
  }),

  startScheduler: protectedProcedure
    .input(z.object({
      intervalHours: z.number().min(1).max(168).default(24),
    }))
    .mutation(async ({ ctx }) => {
      const db = await getDb();
      const intervalMs = 24 * 60 * 60 * 1000; // default daily

      startScheduler(intervalMs, async () => {
        // Get all active competitor monitors
        const compMonitors = await db!.select().from(competitorMonitors)
          .where(eq(competitorMonitors.isActive, 1));

        // Get all active keyword monitors
        const kwMonitors = await db!.select().from(keywordMonitors)
          .where(eq(keywordMonitors.isActive, 1));

        const jobs: CrawlJob[] = [
          ...compMonitors.map(m => ({
            type: "competitor" as const,
            id: m.id,
            asin: m.competitorAsin,
            marketplace: m.marketplace || "US",
          })),
          ...kwMonitors.map(m => ({
            type: "keyword" as const,
            id: m.id,
            keyword: m.keyword,
            targetAsin: m.targetAsin || "",
            marketplace: m.marketplace || "US",
          })),
        ];

        return jobs;
      });

      return { success: true, message: "Scheduler started" };
    }),

  stopScheduler: protectedProcedure.mutation(() => {
    stopScheduler();
    return { success: true, message: "Scheduler stopped" };
  }),

  // ─── Crawl Logs / History ───
  getCrawlHistory: protectedProcedure
    .input(z.object({
      monitorId: z.number(),
      type: z.enum(["competitor", "keyword"]),
      limit: z.number().min(1).max(100).default(30),
    }))
    .query(async ({ input }) => {
      const db = await getDb();
      if (input.type === "competitor") {
        return db!.select().from(competitorSnapshots)
          .where(eq(competitorSnapshots.monitorId, input.monitorId))
          .orderBy(desc(competitorSnapshots.snapshotDate))
          .limit(input.limit);
      } else {
        return db!.select().from(keywordSnapshots)
          .where(eq(keywordSnapshots.keywordMonitorId, input.monitorId))
          .orderBy(desc(keywordSnapshots.snapshotDate))
          .limit(input.limit);
      }
    }),
});
