/**
 * kbIntel Router — 外部情报采集引擎
 *
 * 功能：情报源管理（CRUD）、手动触发爬取、AI质量评估（5维度打分）、
 * AI格式化为标准SOP、用户审核（采纳/忽略/收藏）、采纳入库流程。
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { getDb } from "../db";
import {
  kbIntelSources,
  kbIntelItems,
  kbIntelCollectLogs,
  kbOperationSkills,
  kbListingCopywriting,
  kbProductInnovations,
} from "../../drizzle/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import { collectFromSource, updateSourceSchedule, calculateNextRunTime, intelScheduler } from "../intelAutoCollect";

// ─── DB Helper ──────────────────────────────────
async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// ─── AI Quality Evaluation Prompt ───────────────
function buildQualityEvalPrompt(title: string, source: string, content: string) {
  return `你是一位资深的亚马逊运营专家。请评估以下外部文章对亚马逊卖家的价值。

文章标题: ${title}
文章来源: ${source}
文章内容（前3000字）: ${content.slice(0, 3000)}

请从以下5个维度打分（1-10分），并给出简要理由：
1. 相关性（30%）：与亚马逊运营的相关程度
2. 实操性（25%）：是否包含可执行的操作步骤或方法论
3. 时效性（20%）：内容是否仍然有效
4. 深度（15%）：分析深度和信息密度
5. 独特性（10%）：与常见知识的差异度

同时请：
- 生成一段200字以内的摘要
- 判断该文章最适合录入哪个知识库：sop/listing/product/image/video

输出严格JSON格式：
{
  "scores": {
    "relevance": { "score": 8, "reason": "..." },
    "actionability": { "score": 7, "reason": "..." },
    "timeliness": { "score": 9, "reason": "..." },
    "depth": { "score": 6, "reason": "..." },
    "uniqueness": { "score": 7, "reason": "..." }
  },
  "weightedTotal": 7.6,
  "summary": "...",
  "suggestedType": "sop"
}`;
}

// ─── AI Format as SOP Prompt ────────────────────
function buildFormatSopPrompt(title: string, source: string, url: string, content: string) {
  return `你是一位亚马逊运营SOP编写专家。请将以下外部文章整理为标准SOP格式。

原文标题: ${title}
原文来源: ${source} (${url})
原文内容: ${content.slice(0, 5000)}

请按照以下标准SOP结构输出JSON：
{
  "title": "简洁明确的操作名称",
  "level": "L1/L2/L3/L4",
  "businessModule": "从以下选择：选品分析/Listing优化/广告投放/库存管理/定价策略/客户服务/品牌建设/合规风控/物流配送/数据分析/竞品分析/新品推广",
  "applicableScene": "什么情况下使用",
  "prerequisites": "执行前需要准备什么",
  "steps": [
    { "stepNo": 1, "title": "步骤标题", "description": "详细说明", "tips": "注意事项" }
  ],
  "keyMetrics": ["关键指标1", "关键指标2"],
  "faq": [
    { "question": "常见问题", "answer": "解答" }
  ],
  "referenceSource": "${source}",
  "referenceUrl": "${url}",
  "referenceAuthor": "原文作者（如可识别）"
}

级别说明：L1(初级-新手可执行)/L2(中级-需1年经验)/L3(高级-需3年经验)/L4(专家-需5年以上经验)`;
}

// ─── Router ─────────────────────────────────────
export const kbIntelRouter = router({
  // ── 情报源 CRUD ──────────────────────────────
  listSources: protectedProcedure.query(async ({ ctx }) => {
    const _d = await db();
    return _d.select().from(kbIntelSources)
      .where(eq(kbIntelSources.userId, ctx.user!.id))
      .orderBy(desc(kbIntelSources.createdAt));
  }),

  addSource: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(200),
      sourceType: z.enum(["amazon_news", "wearesellers", "media", "custom_url", "rss"]),
      url: z.string().url().max(1000),
      crawlFrequency: z.enum(["daily", "weekly", "manual"]).default("manual"),
      qualityThreshold: z.number().min(1).max(10).default(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const _d = await db();
      const now = Date.now();
      const [result] = await _d.insert(kbIntelSources).values({
        userId: ctx.user!.id,
        name: input.name,
        sourceType: input.sourceType,
        url: input.url,
        crawlFrequency: input.crawlFrequency,
        qualityThreshold: String(input.qualityThreshold),
        isActive: true,
        totalCrawled: 0,
        totalAdopted: 0,
        createdAt: now,
        updatedAt: now,
      });
      return { id: result.insertId };
    }),

  updateSource: protectedProcedure
    .input(z.object({
      id: z.number(),
      name: z.string().min(1).max(200).optional(),
      url: z.string().url().max(1000).optional(),
      crawlFrequency: z.enum(["daily", "weekly", "manual"]).optional(),
      qualityThreshold: z.number().min(1).max(10).optional(),
      isActive: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const _d = await db();
      const { id, ...updates } = input;
      const updateData: Record<string, unknown> = { updatedAt: Date.now() };
      if (updates.name !== undefined) updateData.name = updates.name;
      if (updates.url !== undefined) updateData.url = updates.url;
      if (updates.crawlFrequency !== undefined) updateData.crawlFrequency = updates.crawlFrequency;
      if (updates.qualityThreshold !== undefined) updateData.qualityThreshold = String(updates.qualityThreshold);
      if (updates.isActive !== undefined) updateData.isActive = updates.isActive;
      await _d.update(kbIntelSources).set(updateData)
        .where(and(eq(kbIntelSources.id, id), eq(kbIntelSources.userId, ctx.user!.id)));
      return { success: true };
    }),

  deleteSource: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const _d = await db();
      // Delete associated items first
      const source = await _d.select().from(kbIntelSources)
        .where(and(eq(kbIntelSources.id, input.id), eq(kbIntelSources.userId, ctx.user!.id)));
      if (source.length === 0) throw new Error("情报源不存在");
      await _d.delete(kbIntelItems).where(eq(kbIntelItems.sourceId, input.id));
      await _d.delete(kbIntelSources)
        .where(and(eq(kbIntelSources.id, input.id), eq(kbIntelSources.userId, ctx.user!.id)));
      return { success: true };
    }),

  // ── 手动触发爬取（模拟：用户粘贴内容） ──────
  triggerCrawl: protectedProcedure
    .input(z.object({
      sourceId: z.number(),
      // 由于实际爬取需要外部服务，这里支持手动粘贴内容
      articles: z.array(z.object({
        title: z.string().min(1),
        author: z.string().optional(),
        originalUrl: z.string().url(),
        publishedAt: z.number().optional(),
        rawContent: z.string().min(10),
      })).min(1).max(20),
    }))
    .mutation(async ({ ctx, input }) => {
      const _d = await db();
      // Verify source ownership
      const [source] = await _d.select().from(kbIntelSources)
        .where(and(eq(kbIntelSources.id, input.sourceId), eq(kbIntelSources.userId, ctx.user!.id)));
      if (!source) throw new Error("情报源不存在");

      const results: Array<{ title: string; id: number; qualityScore: number; status: string }> = [];

      for (const article of input.articles) {
        // AI quality evaluation
        let qualityScore = 0;
        let scoreDetails: Record<string, unknown> = {};
        let summary = "";
        let suggestedType: "sop" | "listing" | "product" | "image" | "video" = "sop";

        try {
          const evalResponse = await invokeLLM({
            messages: [
              { role: "system", content: "你是亚马逊运营内容质量评估专家。请严格输出JSON格式。" },
              { role: "user", content: buildQualityEvalPrompt(article.title, source.name, article.rawContent) },
            ],
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "quality_eval",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    scores: {
                      type: "object",
                      properties: {
                        relevance: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                        actionability: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                        timeliness: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                        depth: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                        uniqueness: { type: "object", properties: { score: { type: "number" }, reason: { type: "string" } }, required: ["score", "reason"], additionalProperties: false },
                      },
                      required: ["relevance", "actionability", "timeliness", "depth", "uniqueness"],
                      additionalProperties: false,
                    },
                    weightedTotal: { type: "number" },
                    summary: { type: "string" },
                    suggestedType: { type: "string", enum: ["sop", "listing", "product", "image", "video"] },
                  },
                  required: ["scores", "weightedTotal", "summary", "suggestedType"],
                  additionalProperties: false,
                },
              },
            },
          });
          const contentStr = typeof evalResponse.choices[0].message.content === 'string' ? evalResponse.choices[0].message.content : JSON.stringify(evalResponse.choices[0].message.content);
          const parsed = JSON.parse(contentStr || "{}");
          qualityScore = parsed.weightedTotal || 0;
          scoreDetails = parsed.scores || {};
          summary = parsed.summary || "";
          suggestedType = parsed.suggestedType || "sop";
        } catch {
          // If AI eval fails, default to medium score
          qualityScore = 5;
          summary = article.rawContent.slice(0, 200);
        }

        const threshold = parseFloat(source.qualityThreshold || "6");
        const status = qualityScore >= threshold ? "recommended" : "pending";

        const [insertResult] = await _d.insert(kbIntelItems).values({
          sourceId: input.sourceId,
          title: article.title,
          author: article.author || null,
          originalUrl: article.originalUrl,
          publishedAt: article.publishedAt || null,
          rawContent: article.rawContent,
          aiSummary: summary,
          aiQualityScore: String(qualityScore),
          aiScoreDetails: scoreDetails,
          aiSuggestedType: suggestedType,
          status,
          createdAt: Date.now(),
        });

        results.push({
          title: article.title,
          id: insertResult.insertId,
          qualityScore,
          status,
        });
      }

      // Update source stats
      await _d.update(kbIntelSources).set({
        lastCrawledAt: Date.now(),
        totalCrawled: sql`${kbIntelSources.totalCrawled} + ${input.articles.length}`,
        updatedAt: Date.now(),
      }).where(eq(kbIntelSources.id, input.sourceId));

      return { results, total: input.articles.length };
    }),

  // ── 情报条目列表（按状态筛选） ────────────────
  listItems: protectedProcedure
    .input(z.object({
      sourceId: z.number().optional(),
      status: z.enum(["pending", "recommended", "adopted", "ignored", "expired", "bookmarked"]).optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const _d = await db();
      const conditions = [];
      // Only show items from user's sources
      const userSources = await _d.select({ id: kbIntelSources.id })
        .from(kbIntelSources)
        .where(eq(kbIntelSources.userId, ctx.user!.id));
      const sourceIds = userSources.map(s => s.id);
      if (sourceIds.length === 0) return { items: [], total: 0 };

      conditions.push(inArray(kbIntelItems.sourceId, sourceIds));
      if (input.sourceId) conditions.push(eq(kbIntelItems.sourceId, input.sourceId));
      if (input.status) conditions.push(eq(kbIntelItems.status, input.status));

      const where = conditions.length > 0 ? and(...conditions) : undefined;
      const [countResult] = await _d.select({ count: sql<number>`count(*)` })
        .from(kbIntelItems).where(where);
      const items = await _d.select({
        item: kbIntelItems,
        sourceName: kbIntelSources.name,
        sourceType: kbIntelSources.sourceType,
      })
        .from(kbIntelItems)
        .leftJoin(kbIntelSources, eq(kbIntelItems.sourceId, kbIntelSources.id))
        .where(where)
        .orderBy(desc(kbIntelItems.createdAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      return {
        items: items.map(r => ({ ...r.item, sourceName: r.sourceName, sourceType: r.sourceType })),
        total: countResult?.count ?? 0,
      };
    }),

  // ── 获取单条情报详情 ─────────────────────────
  getItemDetail: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const _d = await db();
      const [item] = await _d.select({
        item: kbIntelItems,
        sourceName: kbIntelSources.name,
        sourceType: kbIntelSources.sourceType,
      })
        .from(kbIntelItems)
        .leftJoin(kbIntelSources, eq(kbIntelItems.sourceId, kbIntelSources.id))
        .where(eq(kbIntelItems.id, input.id));
      if (!item) throw new Error("情报条目不存在");
      return { ...item.item, sourceName: item.sourceName, sourceType: item.sourceType };
    }),

  // ── AI格式化为标准SOP ────────────────────────
  formatAsSop: protectedProcedure
    .input(z.object({ itemId: z.number() }))
    .mutation(async ({ input }) => {
      const _d = await db();
      const [item] = await _d.select({
        item: kbIntelItems,
        sourceName: kbIntelSources.name,
      })
        .from(kbIntelItems)
        .leftJoin(kbIntelSources, eq(kbIntelItems.sourceId, kbIntelSources.id))
        .where(eq(kbIntelItems.id, input.itemId));
      if (!item) throw new Error("情报条目不存在");

      const prompt = buildFormatSopPrompt(
        item.item.title,
        item.sourceName || "未知来源",
        item.item.originalUrl,
        item.item.rawContent,
      );

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊运营SOP编写专家。请严格输出JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "sop_format",
            strict: true,
            schema: {
              type: "object",
              properties: {
                title: { type: "string" },
                level: { type: "string" },
                businessModule: { type: "string" },
                applicableScene: { type: "string" },
                prerequisites: { type: "string" },
                steps: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      stepNo: { type: "number" },
                      title: { type: "string" },
                      description: { type: "string" },
                      tips: { type: "string" },
                    },
                    required: ["stepNo", "title", "description", "tips"],
                    additionalProperties: false,
                  },
                },
                keyMetrics: { type: "array", items: { type: "string" } },
                faq: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      question: { type: "string" },
                      answer: { type: "string" },
                    },
                    required: ["question", "answer"],
                    additionalProperties: false,
                  },
                },
                referenceSource: { type: "string" },
                referenceUrl: { type: "string" },
                referenceAuthor: { type: "string" },
              },
              required: ["title", "level", "businessModule", "applicableScene", "prerequisites", "steps", "keyMetrics", "faq", "referenceSource", "referenceUrl", "referenceAuthor"],
              additionalProperties: false,
            },
          },
        },
      });

      const rawContent = response.choices[0].message.content;
      const formatted = typeof rawContent === 'string' ? rawContent : JSON.stringify(rawContent);
      // Save formatted content to the item
      await _d.update(kbIntelItems).set({
        aiFormattedContent: formatted || "{}",
      }).where(eq(kbIntelItems.id, input.itemId));

      return JSON.parse(formatted || "{}");
    }),

  // ── 采纳入库 ─────────────────────────────────
  adoptItem: protectedProcedure
    .input(z.object({
      itemId: z.number(),
      targetKbType: z.enum(["sop", "listing", "product", "image", "video"]),
      // User can edit the formatted content before adopting
      editedContent: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const _d = await db();
      const [item] = await _d.select().from(kbIntelItems)
        .where(eq(kbIntelItems.id, input.itemId));
      if (!item) throw new Error("情报条目不存在");

      const content = input.editedContent
        ? JSON.parse(input.editedContent)
        : (item.aiFormattedContent ? JSON.parse(item.aiFormattedContent as string) : null);

      if (!content) throw new Error("请先进行AI格式化");

      let adoptedKbItemId: number | undefined;
      const now = Date.now();

      // Insert into the target knowledge base
      if (input.targetKbType === "sop") {
        const [result] = await _d.insert(kbOperationSkills).values({
          userId: ctx.user!.id,
          title: content.title,
          sourceType: "url",
          sourceUrl: item.originalUrl,
          extractedContent: JSON.stringify(content),
          aiSummary: JSON.stringify({ summary: item.aiSummary, formatted: content }),
          categories: JSON.stringify([content.businessModule || "其他"]),
          tags: JSON.stringify([content.businessModule, content.level, "外部采集"]),
          status: "pending_review",
          visibility: "private",
        });
        adoptedKbItemId = result.insertId;
      } else if (input.targetKbType === "listing") {
        const [result] = await _d.insert(kbListingCopywriting).values({
          userId: ctx.user!.id,
          asin: "",
          productTitle: content.title || item.title,
          category: content.businessModule || "通用",
          crawledData: JSON.stringify({ source: "external", originalUrl: item.originalUrl }),
          aiAnalysis: JSON.stringify(content),
          tags: JSON.stringify(["外部采集"]),
          status: "pending_review",
          visibility: "private",
        });
        adoptedKbItemId = result.insertId;
      } else if (input.targetKbType === "product") {
        const [result] = await _d.insert(kbProductInnovations).values({
          userId: ctx.user!.id,
          asin: "",
          productTitle: content.title || item.title,
          category: content.businessModule || "通用",
          crawledData: JSON.stringify({ source: "external", originalUrl: item.originalUrl }),
          aiAnalysis: JSON.stringify(content),
          tags: JSON.stringify(["外部采集"]),
          status: "pending_review",
          visibility: "private",
        });
        adoptedKbItemId = result.insertId;
      }
      // For image/video types, we just mark as adopted (they need different data structures)

      // Update the intel item status
      await _d.update(kbIntelItems).set({
        status: "adopted",
        adoptedKbType: input.targetKbType,
        adoptedKbItemId: adoptedKbItemId || null,
        reviewedBy: ctx.user!.id,
        reviewedAt: now,
      }).where(eq(kbIntelItems.id, input.itemId));

      // Update source stats
      await _d.update(kbIntelSources).set({
        totalAdopted: sql`${kbIntelSources.totalAdopted} + 1`,
        updatedAt: now,
      }).where(eq(kbIntelSources.id, item.sourceId));

      return { success: true, adoptedKbItemId, targetKbType: input.targetKbType };
    }),

  // ── 忽略条目 ─────────────────────────────────
  ignoreItem: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const _d = await db();
      await _d.update(kbIntelItems).set({
        status: "ignored",
        reviewedBy: ctx.user!.id,
        reviewedAt: Date.now(),
      }).where(eq(kbIntelItems.id, input.id));
      return { success: true };
    }),

  // ── 收藏待处理 ────────────────────────────────
  bookmarkItem: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      const _d = await db();
      await _d.update(kbIntelItems).set({
        status: "bookmarked",
      }).where(eq(kbIntelItems.id, input.id));
      return { success: true };
    }),

  // ── 批量操作 ──────────────────────────────────
  batchUpdateStatus: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()).min(1).max(50),
      status: z.enum(["ignored", "bookmarked"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const _d = await db();
      await _d.update(kbIntelItems).set({
        status: input.status,
        reviewedBy: ctx.user!.id,
        reviewedAt: Date.now(),
      }).where(inArray(kbIntelItems.id, input.ids));
      return { success: true, count: input.ids.length };
    }),

  // ── 采集统计 ──────────────────────────────────
  getStats: protectedProcedure.query(async ({ ctx }) => {
    const _d = await db();
    // Get user's sources
    const sources = await _d.select().from(kbIntelSources)
      .where(eq(kbIntelSources.userId, ctx.user!.id));
    const sourceIds = sources.map(s => s.id);
    if (sourceIds.length === 0) {
      return {
        totalSources: 0,
        activeSources: 0,
        totalCrawled: 0,
        totalAdopted: 0,
        totalRecommended: 0,
        totalPending: 0,
        totalIgnored: 0,
        totalBookmarked: 0,
        adoptionRate: 0,
        sourceBreakdown: [],
      };
    }

    // Count by status
    const statusCounts = await _d.select({
      status: kbIntelItems.status,
      count: sql<number>`count(*)`,
    })
      .from(kbIntelItems)
      .where(inArray(kbIntelItems.sourceId, sourceIds))
      .groupBy(kbIntelItems.status);

    const statusMap: Record<string, number> = {};
    statusCounts.forEach(s => { statusMap[s.status] = s.count; });

    const totalCrawled = sources.reduce((sum, s) => sum + (s.totalCrawled || 0), 0);
    const totalAdopted = statusMap["adopted"] || 0;

    return {
      totalSources: sources.length,
      activeSources: sources.filter(s => s.isActive).length,
      totalCrawled,
      totalAdopted,
      totalRecommended: statusMap["recommended"] || 0,
      totalPending: statusMap["pending"] || 0,
      totalIgnored: statusMap["ignored"] || 0,
      totalBookmarked: statusMap["bookmarked"] || 0,
      adoptionRate: totalCrawled > 0 ? Math.round((totalAdopted / totalCrawled) * 100) : 0,
      sourceBreakdown: sources.map(s => ({
        id: s.id,
        name: s.name,
        sourceType: s.sourceType,
        totalCrawled: s.totalCrawled || 0,
        totalAdopted: s.totalAdopted || 0,
        isActive: s.isActive,
        lastCrawledAt: s.lastCrawledAt,
      })),
    };
  }),

  // ══ 定时采集配置 ══════════════════════════════
  updateAutoCollect: protectedProcedure
    .input(z.object({
      sourceId: z.number(),
      autoCollectEnabled: z.boolean(),
      autoCollectInterval: z.enum(["every_6h", "every_12h", "daily", "weekly", "custom"]).optional(),
      autoCollectCron: z.string().max(100).optional(),
      autoEvaluateEnabled: z.boolean().optional(),
      autoCollectMaxItems: z.number().min(1).max(50).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const _d = await db();
      const [source] = await _d.select().from(kbIntelSources)
        .where(and(eq(kbIntelSources.id, input.sourceId), eq(kbIntelSources.userId, ctx.user!.id)));
      if (!source) throw new Error("情报源不存在");

      const updateData: Record<string, unknown> = {
        autoCollectEnabled: input.autoCollectEnabled,
        updatedAt: Date.now(),
      };
      if (input.autoCollectInterval !== undefined) updateData.autoCollectInterval = input.autoCollectInterval;
      if (input.autoCollectCron !== undefined) updateData.autoCollectCron = input.autoCollectCron;
      if (input.autoEvaluateEnabled !== undefined) updateData.autoEvaluateEnabled = input.autoEvaluateEnabled;
      if (input.autoCollectMaxItems !== undefined) updateData.autoCollectMaxItems = input.autoCollectMaxItems;

      // Calculate next run time if enabling
      if (input.autoCollectEnabled) {
        updateData.nextAutoCollectAt = calculateNextRunTime(
          input.autoCollectInterval || source.autoCollectInterval || "daily",
          input.autoCollectCron || source.autoCollectCron || null
        );
        updateData.consecutiveFailures = 0; // Reset failures when re-enabling
      } else {
        updateData.nextAutoCollectAt = null;
      }

      await _d.update(kbIntelSources).set(updateData)
        .where(eq(kbIntelSources.id, input.sourceId));

      return { success: true, nextAutoCollectAt: updateData.nextAutoCollectAt as number | null };
    }),

  // ══ 手动触发自动采集 ══════════════════════════
  triggerAutoCollect: protectedProcedure
    .input(z.object({ sourceId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const _d = await db();
      const [source] = await _d.select().from(kbIntelSources)
        .where(and(eq(kbIntelSources.id, input.sourceId), eq(kbIntelSources.userId, ctx.user!.id)));
      if (!source) throw new Error("情报源不存在");

      const result = await collectFromSource(
        {
          id: source.id,
          userId: source.userId,
          name: source.name,
          url: source.url,
          sourceType: source.sourceType,
          qualityThreshold: source.qualityThreshold,
          autoEvaluateEnabled: source.autoEvaluateEnabled,
          autoCollectMaxItems: source.autoCollectMaxItems,
        },
        "manual"
      );

      return result;
    }),

  // ══ 采集日志 ══════════════════════════════════
  getCollectLogs: protectedProcedure
    .input(z.object({
      sourceId: z.number().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(50).default(20),
    }))
    .query(async ({ ctx, input }) => {
      const _d = await db();
      // Get user's source IDs
      const userSources = await _d.select({ id: kbIntelSources.id })
        .from(kbIntelSources)
        .where(eq(kbIntelSources.userId, ctx.user!.id));
      const sourceIds = userSources.map(s => s.id);
      if (sourceIds.length === 0) return { logs: [], total: 0 };

      const conditions = [inArray(kbIntelCollectLogs.sourceId, sourceIds)];
      if (input.sourceId) conditions.push(eq(kbIntelCollectLogs.sourceId, input.sourceId));

      const where = and(...conditions);
      const [countResult] = await _d.select({ count: sql<number>`count(*)` })
        .from(kbIntelCollectLogs).where(where);

      const logs = await _d.select({
        log: kbIntelCollectLogs,
        sourceName: kbIntelSources.name,
      })
        .from(kbIntelCollectLogs)
        .leftJoin(kbIntelSources, eq(kbIntelCollectLogs.sourceId, kbIntelSources.id))
        .where(where)
        .orderBy(desc(kbIntelCollectLogs.startedAt))
        .limit(input.pageSize)
        .offset((input.page - 1) * input.pageSize);

      return {
        logs: logs.map(r => ({ ...r.log, sourceName: r.sourceName })),
        total: countResult?.count ?? 0,
      };
    }),

  // ══ 调度器状态 ════════════════════════════════
  getSchedulerStatus: protectedProcedure.query(async ({ ctx }) => {
    const _d = await db();
    // Get all auto-collect enabled sources for this user
    const sources = await _d.select().from(kbIntelSources)
      .where(and(
        eq(kbIntelSources.userId, ctx.user!.id),
        eq(kbIntelSources.autoCollectEnabled, true)
      ));

    return {
      isActive: intelScheduler.isActive(),
      activeCollections: intelScheduler.getActiveCollections(),
      scheduledSources: sources.map(s => ({
        id: s.id,
        name: s.name,
        interval: s.autoCollectInterval,
        cron: s.autoCollectCron,
        nextRunAt: s.nextAutoCollectAt,
        lastRunAt: s.lastAutoCollectAt,
        consecutiveFailures: s.consecutiveFailures || 0,
        autoEvaluateEnabled: s.autoEvaluateEnabled,
        maxItems: s.autoCollectMaxItems,
      })),
    };
  }),
});
