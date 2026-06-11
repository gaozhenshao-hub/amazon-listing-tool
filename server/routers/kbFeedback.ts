/**
 * kbFeedback Router — 知识库反馈闭环系统
 *
 * 功能：
 * 1. submitFeedback — 用户对AI回答中的引用条目提交反馈（helpful/irrelevant/wrong）
 * 2. getStats — 获取知识库调用统计（总调用次数、反馈分布、热门引用排行）
 * 3. getTopReferenced — 获取被引用最多的知识库条目（带标题和类型）
 * 4. getRecentFeedback — 获取最近的反馈记录
 * 5. getOverviewStats — 知识库概览统计面板数据
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  kbCallLogs,
  kbFeedback,
  kbBotConversations,
  kbBotMessages,
  kbIntelItems,
  kbIntelSources,
  kbOperationSkills,
  kbListingCopywriting,
  kbProductInnovations,
  kbImages,
  kbVideos as kbVideoTable,
} from "../../drizzle/schema";
import { eq, and, desc, sql, gte, count } from "drizzle-orm";
import {
  submitKbFeedback,
  getKbCallStats,
} from "../kbContextEngine";

export const kbFeedbackRouter = router({
  // ── 提交反馈 ─────────────────────────────────
  submitFeedback: protectedProcedure
    .input(
      z.object({
        callLogId: z.number().optional(),
        conversationMessageId: z.number().optional(),
        kbItemId: z.number(),
        kbItemType: z.string(),
        rating: z.enum(["helpful", "irrelevant", "wrong"]),
        comment: z.string().max(500).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const feedbackId = await submitKbFeedback({
        ...input,
        userId: ctx.user.id,
      });
      return { id: Number(feedbackId), success: true };
    }),

  // ── 获取调用统计 ─────────────────────────────
  getStats: protectedProcedure
    .input(
      z.object({
        scope: z.enum(["mine", "all"]).default("all"),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const userId = input?.scope === "mine" ? ctx.user.id : undefined;
      return getKbCallStats(userId);
    }),

  // ── 获取热门引用排行（带标题） ──────────────
  getTopReferenced: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(10),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const _d = await getDb();
      if (!_d) return [];

      const limit = input?.limit ?? 10;

      // Get top referenced items from call logs
      const topItems = await _d
        .select({
          kbItemId: kbCallLogs.kbItemId,
          kbItemType: kbCallLogs.kbItemType,
          callCount: sql<number>`count(*)`,
        })
        .from(kbCallLogs)
        .groupBy(kbCallLogs.kbItemId, kbCallLogs.kbItemType)
        .orderBy(desc(sql`count(*)`))
        .limit(limit);

      // Enrich with titles from respective tables
      const enriched = await Promise.all(
        topItems.map(async (item) => {
          let title = "未知条目";
          try {
            switch (item.kbItemType) {
              case "skill": {
                const [row] = await _d
                  .select({ title: kbOperationSkills.title })
                  .from(kbOperationSkills)
                  .where(eq(kbOperationSkills.id, item.kbItemId))
                  .limit(1);
                if (row) title = row.title;
                break;
              }
              case "listing": {
                const [row] = await _d
                  .select({ title: kbListingCopywriting.productTitle })
                  .from(kbListingCopywriting)
                  .where(eq(kbListingCopywriting.id, item.kbItemId))
                  .limit(1);
                if (row?.title) title = row.title;
                break;
              }
              case "product": {
                const [row] = await _d
                  .select({ title: kbProductInnovations.productTitle })
                  .from(kbProductInnovations)
                  .where(eq(kbProductInnovations.id, item.kbItemId))
                  .limit(1);
                if (row?.title) title = row.title;
                break;
              }
              case "image": {
                const [row] = await _d
                  .select({ id: kbImages.id })
                  .from(kbImages)
                  .where(eq(kbImages.id, item.kbItemId))
                  .limit(1);
                if (row) title = `图片知识 #${row.id}`;
                break;
              }
              case "video": {
                const [row] = await _d
                  .select({ videoTitle: kbVideoTable.videoTitle })
                  .from(kbVideoTable)
                  .where(eq(kbVideoTable.id, item.kbItemId))
                  .limit(1);
                if (row) title = row.videoTitle || `视频知识 #${item.kbItemId}`;
                break;
              }
            }
          } catch {
            // ignore lookup errors
          }
          return {
            ...item,
            title,
          };
        })
      );

      return enriched;
    }),

  // ── 获取最近反馈记录 ─────────────────────────
  getRecentFeedback: protectedProcedure
    .input(
      z.object({
        limit: z.number().min(1).max(50).default(20),
      }).optional()
    )
    .query(async ({ ctx, input }) => {
      const _d = await getDb();
      if (!_d) return [];

      const limit = input?.limit ?? 20;

      return _d
        .select()
        .from(kbFeedback)
        .orderBy(desc(kbFeedback.createdAt))
        .limit(limit);
    }),

  // ── 知识库概览统计面板数据 ───────────────────
  getOverviewStats: protectedProcedure.query(async ({ ctx }) => {
    const _d = await getDb();
    if (!_d) {
      return {
        totalKbItems: { skills: 0, listings: 0, products: 0, images: 0, videos: 0 },
        totalConversations: 0,
        totalMessages: 0,
        totalIntelItems: 0,
        totalIntelSources: 0,
        totalCallLogs: 0,
        feedbackDistribution: { helpful: 0, irrelevant: 0, wrong: 0 },
        recentActivity: [],
        topReferencedTypes: [],
      };
    }

    // Count KB items by type
    const [skillCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbOperationSkills);
    const [listingCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbListingCopywriting);
    const [productCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbProductInnovations);
    const [imageCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbImages);
    const [videoCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbVideoTable);

    // Conversation stats
    const [convoCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbBotConversations);
    const [msgCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbBotMessages);

    // Intel stats
    const [intelItemCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbIntelItems);
    const [intelSourceCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbIntelSources);

    // Call log stats
    const [callLogCount] = await _d.select({ count: sql<number>`count(*)` }).from(kbCallLogs);

    // Feedback distribution
    const feedbackRows = await _d
      .select({
        rating: kbFeedback.rating,
        count: sql<number>`count(*)`,
      })
      .from(kbFeedback)
      .groupBy(kbFeedback.rating);

    const feedbackDistribution: Record<string, number> = { helpful: 0, irrelevant: 0, wrong: 0 };
    feedbackRows.forEach((r) => {
      feedbackDistribution[r.rating] = r.count;
    });

    // Top referenced types (pie chart data)
    const topReferencedTypes = await _d
      .select({
        kbItemType: kbCallLogs.kbItemType,
        count: sql<number>`count(*)`,
      })
      .from(kbCallLogs)
      .groupBy(kbCallLogs.kbItemType)
      .orderBy(desc(sql`count(*)`));

    // Recent activity (last 7 days)
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
    const recentCalls = await _d
      .select({
        date: sql<string>`DATE(FROM_UNIXTIME(createdAt / 1000))`,
        count: sql<number>`count(*)`,
      })
      .from(kbCallLogs)
      .where(gte(kbCallLogs.createdAt, sevenDaysAgo))
      .groupBy(sql`DATE(FROM_UNIXTIME(createdAt / 1000))`)
      .orderBy(sql`DATE(FROM_UNIXTIME(createdAt / 1000))`);

    return {
      totalKbItems: {
        skills: skillCount?.count ?? 0,
        listings: listingCount?.count ?? 0,
        products: productCount?.count ?? 0,
        images: imageCount?.count ?? 0,
        videos: videoCount?.count ?? 0,
      },
      totalConversations: convoCount?.count ?? 0,
      totalMessages: msgCount?.count ?? 0,
      totalIntelItems: intelItemCount?.count ?? 0,
      totalIntelSources: intelSourceCount?.count ?? 0,
      totalCallLogs: callLogCount?.count ?? 0,
      feedbackDistribution,
      recentActivity: recentCalls,
      topReferencedTypes,
    };
  }),
});
