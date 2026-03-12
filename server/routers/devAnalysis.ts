import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import { callDataApi } from "../_core/dataApi";
import * as devDb from "../devDb";

const REPORT_TYPES = [
  "market_overview", "product_analysis", "price_analysis", "brand_analysis",
  "competitor_analysis", "review_analysis", "external_analysis", "ai_summary",
  "review_analysis_recent_2y",
] as const;

export const devAnalysisRouter = router({
  // ─── Analysis Reports ──────────────────────────────────────
  generateReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      reportType: z.enum(REPORT_TYPES),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await devDb.getDevProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const products = await devDb.getDevProductsByProject(input.projectId);
      const reviewStats = await devDb.getDevReviewStats(input.projectId);

      // Build context data for the report
      const contextData = buildReportContext(input.reportType, products, reviewStats, project);

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个资深的亚马逊产品开发分析专家。请根据提供的数据生成专业的分析报告。
返回JSON格式，包含summary(文字总结,markdown格式)和chartData(图表数据,数组格式)两个字段。`,
          },
          { role: "user", content: contextData },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "analysis_report",
            strict: true,
            schema: {
              type: "object",
              properties: {
                summary: { type: "string", description: "Markdown格式的分析总结" },
                chartData: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      chartType: { type: "string", description: "bar/pie/line/radar" },
                      title: { type: "string" },
                      data: {
                        type: "array",
                        items: {
                          type: "object",
                          properties: {
                            name: { type: "string" },
                            value: { type: "number" },
                          },
                          required: ["name", "value"],
                          additionalProperties: false,
                        },
                      },
                    },
                    required: ["chartType", "title", "data"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["summary", "chartData"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      const parsed = content ? JSON.parse(content as string) : { summary: "", chartData: [] };

      await devDb.upsertDevReport({
        projectId: input.projectId,
        userId: ctx.user.id,
        reportType: input.reportType,
        title: getReportTitle(input.reportType),
        content: JSON.stringify(parsed),
      });

      return parsed;
    }),

  getReports: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevReports(input.projectId);
    }),

  getReport: protectedProcedure
    .input(z.object({ projectId: z.number(), reportType: z.string() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevReport(input.projectId, input.reportType);
    }),

  updateReport: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      reportType: z.string(),
      content: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      await devDb.upsertDevReport({
        projectId: input.projectId,
        userId: ctx.user.id,
        reportType: input.reportType as any,
        title: getReportTitle(input.reportType),
        content: input.content,
        status: "completed",
      });
      return { success: true };
    }),

  // ─── Review Analysis ───────────────────────────────────────
  reviewStats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevReviewStats(input.projectId);
    }),

  contentStats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const reviews = await devDb.getDevReviewsByProject(input.projectId);
      if (reviews.length === 0) return { positiveTopics: [], negativeTopics: [] };

      const positiveReviews = reviews.filter(r => (r.rating ?? 0) >= 4).slice(0, 100);
      const negativeReviews = reviews.filter(r => (r.rating ?? 0) <= 2).slice(0, 100);

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个亚马逊产品评论分析专家。请分析以下评论数据，提取好评和差评中的具体内容主题。
对于每个主题，需要：
1. 主题名称（简短描述，如"易于安装"、"材质差"等）
2. 出现次数（根据评论内容估算）
3. 代表性评论摘要`,
          },
          {
            role: "user",
            content: `总评论数: ${reviews.length}, 好评: ${positiveReviews.length}, 差评: ${negativeReviews.length}

好评样本:\n${positiveReviews.map(r => `[${r.rating}★] ${(r.content || "").substring(0, 300)}`).join("\n")}

差评样本:\n${negativeReviews.map(r => `[${r.rating}★] ${(r.content || "").substring(0, 300)}`).join("\n")}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "review_content_stats",
            strict: true,
            schema: {
              type: "object",
              properties: {
                positiveTopics: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      topic: { type: "string" },
                      count: { type: "number" },
                      example: { type: "string" },
                    },
                    required: ["topic", "count", "example"],
                    additionalProperties: false,
                  },
                },
                negativeTopics: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      topic: { type: "string" },
                      count: { type: "number" },
                      example: { type: "string" },
                    },
                    required: ["topic", "count", "example"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["positiveTopics", "negativeTopics"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      const parsed = content ? JSON.parse(content as string) : { positiveTopics: [], negativeTopics: [] };

      // Calculate percentages
      const totalPositive = positiveReviews.length || 1;
      const totalNegative = negativeReviews.length || 1;
      const totalAll = reviews.length || 1;

      for (const t of parsed.positiveTopics) {
        t.percentOfCategory = Math.round((t.count / totalPositive) * 100);
        t.percentOfTotal = Math.round((t.count / totalAll) * 100);
      }
      for (const t of parsed.negativeTopics) {
        t.percentOfCategory = Math.round((t.count / totalNegative) * 100);
        t.percentOfTotal = Math.round((t.count / totalAll) * 100);
      }

      return parsed;
    }),

  wordCloud: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const reviews = await devDb.getDevReviewsByProject(input.projectId);
      if (reviews.length === 0) return { positiveWords: [], negativeWords: [] };

      const positiveReviews = reviews.filter(r => (r.rating ?? 0) >= 4).slice(0, 100);
      const negativeReviews = reviews.filter(r => (r.rating ?? 0) <= 2).slice(0, 100);

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一个亚马逊产品评论分析专家。请从好评和差评中分别提取高频关键词/短语。
要求：
1. 每类提取20-30个关键词
2. 关键词应该是有意义的产品相关词汇（不要提取"the"、"is"等无意义词）
3. 为每个关键词估算出现频次（权重）
4. 关键词用英文原文（因为是英文评论），但可以附带中文翻译
5. 按频次从高到低排序`,
          },
          {
            role: "user",
            content: `好评样本(${positiveReviews.length}条):\n${positiveReviews.map(r => (r.content || "").substring(0, 200)).join("\n")}\n\n差评样本(${negativeReviews.length}条):\n${negativeReviews.map(r => (r.content || "").substring(0, 200)).join("\n")}`,
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "word_cloud",
            strict: true,
            schema: {
              type: "object",
              properties: {
                positiveWords: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      word: { type: "string" },
                      translation: { type: "string" },
                      weight: { type: "number" },
                    },
                    required: ["word", "translation", "weight"],
                    additionalProperties: false,
                  },
                },
                negativeWords: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      word: { type: "string" },
                      translation: { type: "string" },
                      weight: { type: "number" },
                    },
                    required: ["word", "translation", "weight"],
                    additionalProperties: false,
                  },
                },
              },
              required: ["positiveWords", "negativeWords"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content;
      return content ? JSON.parse(content as string) : { positiveWords: [], negativeWords: [] };
    }),

  // ─── External Data ─────────────────────────────────────────
  fetchYouTube: protectedProcedure
    .input(z.object({ projectId: z.number(), keyword: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rawData = await callDataApi("Youtube/search", {
        query: { gl: "US", hl: "en", q: input.keyword },
      });

      const aiSummary = await generateExternalSummary(
        rawData,
        "分析该产品在YouTube上的KOL推广情况，包括热门视频、内容趋势、KOL影响力"
      );

      await devDb.createDevExternalData({
        projectId: input.projectId,
        userId: ctx.user.id,
        dataType: "youtube_kol",
        rawData: JSON.stringify(rawData),
        aiSummary,
      });

      return { rawData, aiSummary };
    }),

  fetchTikTok: protectedProcedure
    .input(z.object({ projectId: z.number(), keyword: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rawData = await callDataApi("Tiktok/search_tiktok_video_general", {
        query: { keyword: input.keyword },
      });

      const aiSummary = await generateExternalSummary(
        rawData,
        "分析该产品在TikTok上的推广情况和内容趋势"
      );

      await devDb.createDevExternalData({
        projectId: input.projectId,
        userId: ctx.user.id,
        dataType: "tiktok_kol",
        rawData: JSON.stringify(rawData),
        aiSummary,
      });

      return { rawData, aiSummary };
    }),

  fetchCompetitorSite: protectedProcedure
    .input(z.object({ projectId: z.number(), domain: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const rawData = await callDataApi("SimilarWeb/get_visits_total", {
        query: { domain: input.domain },
      });

      const aiSummary = await generateExternalSummary(
        rawData,
        "分析该竞品独立站的流量情况和推广策略"
      );

      await devDb.createDevExternalData({
        projectId: input.projectId,
        userId: ctx.user.id,
        dataType: "competitor_site",
        rawData: JSON.stringify(rawData),
        aiSummary,
      });

      return { rawData, aiSummary };
    }),

  fetchAIAnalysis: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keyword: z.string(),
      dataType: z.enum(["google_trends", "facebook_ads", "crowdfunding"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const promptMap: Record<string, string> = {
        google_trends: "分析关键词在Google Trends上的搜索趋势，包括热度变化、季节性、地区分布",
        facebook_ads: "分析相关产品在Facebook上的广告推广情况，包括广告形式、受众画像、投放策略",
        crowdfunding: "分析相关产品在Kickstarter/Indiegogo等众筹平台上的趋势",
      };

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是一个跨境电商市场分析专家。" },
          { role: "user", content: `关键词: ${input.keyword}\n\n${promptMap[input.dataType]}` },
        ],
      });

      const aiSummary = (response.choices?.[0]?.message?.content as string) || "";

      await devDb.createDevExternalData({
        projectId: input.projectId,
        userId: ctx.user.id,
        dataType: input.dataType,
        rawData: JSON.stringify({ keyword: input.keyword }),
        aiSummary,
      });

      return { aiSummary };
    }),

  getExternalData: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      return devDb.getDevExternalData(input.projectId);
    }),
});

// ─── Helper Functions ────────────────────────────────────────

async function generateExternalSummary(rawData: unknown, prompt: string): Promise<string> {
  const response = await invokeLLM({
    messages: [
      { role: "system", content: "你是一个跨境电商市场分析专家。请根据提供的数据进行分析总结。" },
      { role: "user", content: `数据:\n${JSON.stringify(rawData).substring(0, 3000)}\n\n${prompt}` },
    ],
  });
  return (response.choices?.[0]?.message?.content as string) || "";
}

function buildReportContext(reportType: string, products: any[], reviewStats: any, project: any): string {
  const productSummary = products.slice(0, 20).map(p =>
    `ASIN:${p.asin} | ${p.title} | ¥${p.price} | ${p.rating}★ | BSR:${p.bsr} | 月销:${p.monthlySales}`
  ).join("\n");

  const base = `项目: ${project.name}\n目标市场: ${project.targetMarket}\n关键词: ${project.keywords}\n\n产品数据(${products.length}个):\n${productSummary}\n\n评论统计: 总${reviewStats.total}条, 好评${reviewStats.positive}, 中评${reviewStats.neutral}, 差评${reviewStats.negative}`;

  const typePrompts: Record<string, string> = {
    market_overview: "请分析市场大盘：市场体量、均价、增速、头部集中度、成熟度",
    product_analysis: "请分析产品属性：属性维度分布、销售额占比、热门组合、差异化机会",
    price_analysis: "请分析价格段：价格段分布、最佳区间、价格与评分关系、定价建议",
    brand_analysis: "请分析品牌竞争：TOP品牌、集中度、中国vs非中国卖家、竞争格局",
    competitor_analysis: "请深度分析TOP5竞品：优劣势、定价策略、差异化特点",
    review_analysis: "请分析评论：评分分布、好评关键词、差评痛点、用户需求、改进建议",
    review_analysis_recent_2y: "请分析近两年评论：评分分布、好评关键词、差评痛点、用户需求、改进建议",
    external_analysis: "请分析站外数据：Google趋势、KOL推广、竞品站外策略、众筹趋势",
    ai_summary: "请生成AI总结报告：市场概况、产品机会、竞争格局、推荐定位、风险提示",
  };

  return `${base}\n\n${typePrompts[reportType] || "请生成分析报告"}`;
}

function getReportTitle(reportType: string): string {
  const titles: Record<string, string> = {
    market_overview: "市场大盘分析",
    product_analysis: "产品属性分析",
    price_analysis: "价格段分析",
    brand_analysis: "品牌竞争分析",
    competitor_analysis: "竞品深度分析",
    review_analysis: "评论分析",
    review_analysis_recent_2y: "近两年评论分析",
    external_analysis: "站外数据分析",
    ai_summary: "AI总结报告",
  };
  return titles[reportType] || "分析报告";
}
