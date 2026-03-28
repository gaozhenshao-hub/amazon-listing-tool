import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getLingxingAdapter } from "../lingxingAdapter";
import { invokeLLM } from "../_core/llm";

function getDateNDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export const competitorMonitorRouter = router({
  // 竞品列表（从领星获取竞品监控数据）
  getCompetitorList: protectedProcedure
    .input(z.object({
      sid: z.number().optional(),
      asin: z.string().optional(),
      offset: z.number().default(0),
      length: z.number().default(50),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.requestWithMockFallback({
        path: "/erp/sc/data/mws/competitorMonitor",
        body: { offset: input.offset, length: input.length, sid: input.sid, asin: input.asin },
      });
      const data = Array.isArray(res.data) ? res.data : (res.data as any)?.list || [];
      return {
        total: (res.data as any)?.total || data.length,
        list: data.map((item: any) => ({
          asin: item.asin || '',
          title: item.title || '',
          brand: item.brand || '',
          price: Number(item.price || item.current_price) || 0,
          rating: Number(item.rating) || 0,
          reviewCount: Number(item.review_count || item.reviewCount) || 0,
          bsr: Number(item.bsr || item.bsr_rank) || 0,
          category: item.category || '',
          imageUrl: item.image_url || item.imageUrl || '',
          lastUpdated: item.last_updated || item.lastUpdated || '',
          priceHistory: item.price_history || [],
          bsrHistory: item.bsr_history || [],
          reviewHistory: item.review_history || [],
        })),
      };
    }),

  // 竞品价格变动追踪
  getCompetitorPriceChanges: protectedProcedure
    .input(z.object({
      asin: z.string().optional(),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.requestWithMockFallback({
        path: "/erp/sc/data/mws/competitorMonitor",
        body: { offset: 0, length: 200, asin: input.asin },
      });
      const data = Array.isArray(res.data) ? res.data : (res.data as any)?.list || [];

      // Simulate price change detection
      const changes = data.filter((item: any) => {
        const history = item.price_history || [];
        if (history.length < 2) return false;
        const latest = Number(history[history.length - 1]?.price || 0);
        const prev = Number(history[history.length - 2]?.price || 0);
        return Math.abs(latest - prev) > 0.01;
      }).map((item: any) => {
        const history = item.price_history || [];
        const latest = Number(history[history.length - 1]?.price || 0);
        const prev = Number(history[history.length - 2]?.price || 0);
        return {
          asin: item.asin,
          title: item.title || '',
          brand: item.brand || '',
          oldPrice: prev,
          newPrice: latest,
          change: latest - prev,
          changePercent: prev > 0 ? ((latest - prev) / prev * 100) : 0,
          date: history[history.length - 1]?.date || '',
        };
      });

      return { changes, total: changes.length };
    }),

  // 竞品BSR排名趋势
  getCompetitorBsrTrend: protectedProcedure
    .input(z.object({
      asins: z.array(z.string()).max(10),
      days: z.number().default(30),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const results: any[] = [];

      for (const asin of input.asins) {
        const res = await adapter.requestWithMockFallback({
          path: "/erp/sc/data/mws/competitorMonitor",
          body: { offset: 0, length: 10, asin },
        });
        const data = Array.isArray(res.data) ? res.data : (res.data as any)?.list || [];
        const item = data[0];
        if (item) {
          results.push({
            asin,
            title: item.title || '',
            brand: item.brand || '',
            bsrHistory: item.bsr_history || [],
            currentBsr: Number(item.bsr || item.bsr_rank) || 0,
          });
        }
      }

      return { competitors: results };
    }),

  // 竞品Review变动监控
  getCompetitorReviewChanges: protectedProcedure
    .input(z.object({
      days: z.number().default(7),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const res = await adapter.requestWithMockFallback({
        path: "/erp/sc/data/mws/competitorMonitor",
        body: { offset: 0, length: 200 },
      });
      const data = Array.isArray(res.data) ? res.data : (res.data as any)?.list || [];

      const reviewChanges = data.filter((item: any) => {
        const history = item.review_history || [];
        return history.length >= 2;
      }).map((item: any) => {
        const history = item.review_history || [];
        const latest = history[history.length - 1] || {};
        const prev = history[history.length - 2] || {};
        return {
          asin: item.asin,
          title: item.title || '',
          brand: item.brand || '',
          currentRating: Number(item.rating) || 0,
          currentCount: Number(item.review_count || item.reviewCount) || 0,
          newReviews: (Number(latest.count) || 0) - (Number(prev.count) || 0),
          ratingChange: (Number(latest.rating) || 0) - (Number(prev.rating) || 0),
        };
      }).filter((c: any) => c.newReviews !== 0 || c.ratingChange !== 0);

      return { changes: reviewChanges, total: reviewChanges.length };
    }),

  // 产品属性对比
  getProductComparison: protectedProcedure
    .input(z.object({
      asins: z.array(z.string()).min(2).max(5),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const products: any[] = [];

      for (const asin of input.asins) {
        const res = await adapter.requestWithMockFallback({
          path: "/erp/sc/data/mws/competitorMonitor",
          body: { offset: 0, length: 10, asin },
        });
        const data = Array.isArray(res.data) ? res.data : (res.data as any)?.list || [];
        const item = data[0];
        if (item) {
          products.push({
            asin,
            title: item.title || '',
            brand: item.brand || '',
            price: Number(item.price || item.current_price) || 0,
            rating: Number(item.rating) || 0,
            reviewCount: Number(item.review_count || item.reviewCount) || 0,
            bsr: Number(item.bsr || item.bsr_rank) || 0,
            category: item.category || '',
            imageUrl: item.image_url || item.imageUrl || '',
            bulletPoints: item.bullet_points || [],
            features: item.features || [],
          });
        }
      }

      return { products };
    }),

  // AI竞品分析解读
  aiCompetitorInsight: protectedProcedure
    .input(z.object({
      competitorData: z.any(),
      focusArea: z.enum(['pricing', 'reviews', 'bsr', 'overall']).default('overall'),
    }))
    .mutation(async ({ input }) => {
      const focusLabels: Record<string, string> = {
        pricing: '价格策略',
        reviews: 'Review变动',
        bsr: 'BSR排名',
        overall: '综合分析',
      };

      const prompt = `你是一位资深的亚马逊竞品分析专家。请基于以下竞品监控数据，从"${focusLabels[input.focusArea]}"角度进行深度分析。

竞品数据：
${JSON.stringify(input.competitorData, null, 2)}

请输出JSON格式：
{
  "summary": "一句话总结竞品态势",
  "keyFindings": ["发现1", "发现2", "发现3"],
  "threats": [{"competitor": "竞品ASIN/品牌", "threat": "威胁描述", "severity": "high/medium/low"}],
  "opportunities": [{"opportunity": "机会描述", "action": "建议操作"}],
  "pricingInsight": "价格策略建议（如适用）",
  "actionPlan": [{"priority": "P0/P1/P2", "action": "具体操作", "timeline": "时间建议"}]
}`;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊竞品分析专家，输出严格JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "competitor_insight",
            strict: true,
            schema: {
              type: "object",
              properties: {
                summary: { type: "string" },
                keyFindings: { type: "array", items: { type: "string" } },
                threats: { type: "array", items: { type: "object", properties: { competitor: { type: "string" }, threat: { type: "string" }, severity: { type: "string" } }, required: ["competitor", "threat", "severity"], additionalProperties: false } },
                opportunities: { type: "array", items: { type: "object", properties: { opportunity: { type: "string" }, action: { type: "string" } }, required: ["opportunity", "action"], additionalProperties: false } },
                pricingInsight: { type: "string" },
                actionPlan: { type: "array", items: { type: "object", properties: { priority: { type: "string" }, action: { type: "string" }, timeline: { type: "string" } }, required: ["priority", "action", "timeline"], additionalProperties: false } },
              },
              required: ["summary", "keyFindings", "threats", "opportunities", "pricingInsight", "actionPlan"],
              additionalProperties: false,
            },
          },
        },
      });

      return JSON.parse(String(response.choices[0].message.content));
    }),
});
