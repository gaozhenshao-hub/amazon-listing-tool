import { z, invokeLLM, protectedProcedure, router, getDb, eq, desc, and, sql, budgetTracking, ClassificationThresholds, DEFAULT_THRESHOLDS, TWELVE_CATEGORIES, classifySearchTerm, anonymizeForAI, deAnonymizeResults, _queryCache, CACHE_TTL, getCached, setCache, parallelBatch, getDateNDaysAgo, getDatesInRange, resolveDateRange, getAllSellerSids, MARKETPLACE_MAP, filterSidsByMarketplace } from "./context";

export const searchTermsProcedures = {
// ─── Get ASIN List for Selection ──────────────────────────────
  getProductAsins: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 5);
      
      const asinSet = new Map<string, any>();
      for (const sid of sidsToQuery) {
        try {
          // Get product list with ASIN info
          const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
          for (const item of items) {
            const asin = item.asin || item.asin1 || '';
            if (asin && !asinSet.has(asin)) {
              asinSet.set(asin, {
                asin,
                title: item.title || item.product_name || item.item_name || '',
                sku: item.seller_sku || item.sku || '',
                imageUrl: item.image_url || item.main_image || '',
                price: item.price || 0,
                status: item.status || 'active',
              });
            }
          }
        } catch (err: any) {
          console.warn(`[getProductAsins] sid=${sid}: ${err.message}`);
        }
      }
      
      return {
        asins: Array.from(asinSet.values()),
        isMock: true,
      };
    }),

// ─── 12-Category Search Term Classification ───────────────────
  getSearchTerms12Category: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(), // Multi-campaign filter
      marketplace: z.string().optional(),
      reportDate: z.string().optional(), // YYYY-MM-DD, single day query (legacy)
      startDate: z.string().optional(), // YYYY-MM-DD, date range start
      endDate: z.string().optional(), // YYYY-MM-DD, date range end
      days: z.number().optional().default(3), // Reduced from 7 to 3 for performance
      adType: z.enum(["SP", "SB"]).optional().default("SP"), // SP or SB (no SD search terms)
      thresholds: z.object({
        highImpressions: z.number().optional(),
        lowImpressions: z.number().optional(),
        highCTR: z.number().optional(),
        lowCTR: z.number().optional(),
        highCVR: z.number().optional(),
        lowCVR: z.number().optional(),
      }).optional(),
    }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3); // Reduced from 5 to 3 stores
      const datesToQuery = resolveDateRange({
        startDate: input.startDate,
        endDate: input.endDate,
        days: Math.min(input.days || 3, 14),
      });
      const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };

      const adType = input.adType || 'SP';
      const searchTermApiPath = adType === 'SB'
        ? '/pb/openapi/newad/hsaQueryWordReports'
        : '/pb/openapi/newad/queryWordReports';

      // Resolve effective campaign IDs (prefer campaignIds array over single campaignId)
      const effectiveCampaignIds = (input.campaignIds && input.campaignIds.length > 0)
        ? input.campaignIds
        : (input.campaignId ? [input.campaignId] : []);
      const campaignIdSet = new Set(effectiveCampaignIds);
      const hasCampaignFilter = effectiveCampaignIds.length > 0;

      // Check cache first (5-minute TTL)
      const cacheKey = `searchTerms_${effectiveCampaignIds.sort().join(',') || 'all'}_${input.marketplace || 'ALL'}_${datesToQuery.length}_${datesToQuery[0] || ''}_${adType}`;
      const cached = getCached<any>(cacheKey);
      if (cached) {
        console.log(`[SearchTerms] Cache HIT for key: ${cacheKey}`);
        return cached;
      }
      console.log(`[SearchTerms] Cache MISS, fetching ${sidsToQuery.length} stores x ${datesToQuery.length} days (parallel)...`);
      const startTime = Date.now();

      // Aggregate search terms over multiple days
      const termAggMap: Record<string, {
        query: string; target_text: string; match_type: string;
        campaign_id: string; ad_group_id: string;
        impressions: number; clicks: number; cost: number;
        sales: number; orders: number; units: number; days_seen: number;
      }> = {};

      // Helper to fetch one sid+date combination
      const fetchSidDay = async (sid: number, reportDate: string): Promise<any[]> => {
        const items: any[] = [];
        try {
          let offset = 0;
          let hasMore = true;
          while (hasMore && offset < 1000) {
            const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
            const rawData = res.data || [];
            const batch = Array.isArray(rawData) ? rawData : (rawData as any).records || [];
            items.push(...batch);
            hasMore = batch.length >= 200;
            offset += 200;
          }
        } catch (err: any) { /* skip */ }
        return items;
      };

      // Build all tasks and run in parallel (concurrency = 5)
      const tasks: (() => Promise<any[]>)[] = [];
      for (const sid of sidsToQuery) {
        for (const reportDate of datesToQuery) {
          tasks.push(() => fetchSidDay(sid, reportDate));
        }
      }
      const allResults = await parallelBatch(tasks, 5);

      // Merge all results into aggregation map
      for (const items of allResults) {
        for (const item of items) {
          if (hasCampaignFilter && item.campaign_id && !campaignIdSet.has(String(item.campaign_id))) continue;
          const key = `${item.query}||${item.campaign_id}||${item.match_type}`;
          if (termAggMap[key]) {
            termAggMap[key].impressions += Number(item.impressions) || 0;
            termAggMap[key].clicks += Number(item.clicks) || 0;
            termAggMap[key].cost += Number(item.cost) || 0;
            termAggMap[key].sales += Number(item.sales) || 0;
            termAggMap[key].orders += Number(item.orders) || 0;
            termAggMap[key].units += Number(item.units) || 0;
            termAggMap[key].days_seen += 1;
          } else {
            termAggMap[key] = {
              query: item.query || '',
              target_text: item.target_text || '',
              match_type: item.match_type || '',
              campaign_id: String(item.campaign_id || ''),
              ad_group_id: String(item.ad_group_id || ''),
              impressions: Number(item.impressions) || 0,
              clicks: Number(item.clicks) || 0,
              cost: Number(item.cost) || 0,
              sales: Number(item.sales) || 0,
              orders: Number(item.orders) || 0,
              units: Number(item.units) || 0,
              days_seen: 1,
            };
          }
        }
      }

      // Classify each term using 12-category system
      const searchTerms = Object.values(termAggMap).map(t => {
        const acos = t.sales > 0 ? Math.round(t.cost / t.sales * 10000) / 100 : (t.cost > 0 ? 999 : 0);
        const ctr = t.impressions > 0 ? Math.round(t.clicks / t.impressions * 10000) / 100 : 0;
        const cpc = t.clicks > 0 ? Math.round(t.cost / t.clicks * 100) / 100 : 0;
        const convRate = t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : 0;
        
        const { categoryId, categoryKey } = classifySearchTerm(
          t.impressions, t.clicks, t.orders, thresholds
        );
        
        return { ...t, acos, ctr, cpc, convRate, categoryId, categoryKey };
      });

      searchTerms.sort((a, b) => b.cost - a.cost);

      // Compute category stats
      const categoryStats: Record<number, number> = {};
      for (let i = 1; i <= 12; i++) categoryStats[i] = 0;
      for (const t of searchTerms) categoryStats[t.categoryId] = (categoryStats[t.categoryId] || 0) + 1;

      const result = {
        searchTerms,
        categoryStats,
        categories: TWELVE_CATEGORIES,
        thresholds,
        days: datesToQuery.length,
        adType,
        total: searchTerms.length,
        isMock: true,
      };

      // Cache the result for 5 minutes
      setCache(cacheKey, result);
      console.log(`[SearchTerms] Completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s, ${searchTerms.length} terms found`);
      return result;
    }),

// ─── AI-Enhanced Classification Advice ────────────────────────
  aiSearchTermAdvice: protectedProcedure
    .input(z.object({
      searchTerms: z.array(z.record(z.string(), z.unknown())).max(50),
      categoryId: z.number(),
      campaignId: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const category = TWELVE_CATEGORIES.find(c => c.id === input.categoryId);
      if (!category) throw new Error("Invalid category ID");

      // Anonymize ASIN data
      const asinMap = new Map<string, string>();
      const anonymizedTerms = input.searchTerms.map((t: any, idx: number) => {
        const anonId = `Product_${String(idx + 1).padStart(3, '0')}`;
        if (t.asin) asinMap.set(anonId, t.asin);
        const { asin, advertised_asin, sku, campaign_id, ad_group_id, ...metrics } = t;
        return { ...metrics, product_id: anonId };
      });

      // ─── Emperor Skill 优先，降级到内置 LLM ───────────────────
      try {
        const emperorContext = `分类：${category.label}\n特征：${category.condition}\n问题分析：${category.problemAnalysis}\n广告目的：${category.adPurpose}\n广告策略：${category.adStrategy}\n预期结果：${category.expectedResult}\n\n搜索词数据：\n${JSON.stringify(anonymizedTerms)}`;
      } catch (emperorErr) {
      }

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是亚马逊PPC广告优化专家。你正在分析属于"${category.label}"分类的搜索词数据。

该分类的特征：${category.condition}
标准问题分析：${category.problemAnalysis}
标准广告目的：${category.adPurpose}
标准广告策略：${category.adStrategy}
标准预期结果：${category.expectedResult}

请基于以上标准建议和实际数据指标，为每个搜索词生成个性化的四段式建议。注意：数据中不包含任何产品标识信息，请勿猜测产品身份。输出严格JSON格式。`
          },
          {
            role: "user",
            content: `分析以下${category.label}分类的搜索词数据，为每个搜索词生成个性化建议：

${JSON.stringify(anonymizedTerms)}

请为每个搜索词输出：
1. problem_analysis: 基于该词具体数据的问题分析
2. ad_purpose: 针对该词的广告目的
3. ad_strategy: 具体可执行的广告策略（至少3条）
4. expected_result: 调整后的预期结果
5. priority: 优先级(high/medium/low)
6. suggested_action: 建议操作(keep/increase_bid/decrease_bid/negate_exact/negate_phrase/add_exact/add_phrase/monitor/pause)`
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "search_term_advice",
            strict: true,
            schema: {
              type: "object",
              properties: {
                advice: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      search_term: { type: "string" },
                      problem_analysis: { type: "string" },
                      ad_purpose: { type: "string" },
                      ad_strategy: { type: "string" },
                      expected_result: { type: "string" },
                      priority: { type: "string" },
                      suggested_action: { type: "string" },
                    },
                    required: ["search_term", "problem_analysis", "ad_purpose", "ad_strategy", "expected_result", "priority", "suggested_action"],
                    additionalProperties: false,
                  },
                },
                category_summary: { type: "string" },
                top_actions: { type: "array", items: { type: "string" } },
              },
              required: ["advice", "category_summary", "top_actions"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    })
};
