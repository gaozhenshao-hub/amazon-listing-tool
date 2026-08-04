import { z, invokeLLM, protectedProcedure, router, getDb, eq, desc, and, sql, budgetTracking, ClassificationThresholds, DEFAULT_THRESHOLDS, TWELVE_CATEGORIES, classifySearchTerm, anonymizeForAI, deAnonymizeResults, _queryCache, CACHE_TTL, getCached, setCache, parallelBatch, getDateNDaysAgo, getDatesInRange, resolveDateRange, getAllSellerSids, MARKETPLACE_MAP, filterSidsByMarketplace } from "./context";

export const diagnosticsProcedures = {
// ─── Ad Diagnosis (6-Dimension Health Score) ──────────────────
  getAdDiagnosis: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(), // Multi-campaign filter
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      days: z.number().optional().default(30),
    }))
    .mutation(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);

      // Collect campaign data for diagnosis
      let totalImpressions = 0, totalClicks = 0, totalCost = 0, totalSales = 0, totalOrders = 0;
      let campaignCount = 0;
      
      for (const sid of sidsToQuery) {
        for (let d = 1; d <= Math.min(input.days || 30, 30); d++) {
          try {
            const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
            const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
            for (const item of items) {
              totalImpressions += Number(item.impressions) || 0;
              totalClicks += Number(item.clicks) || 0;
              totalCost += Number(item.cost) || 0;
              totalSales += Number(item.sales) || 0;
              totalOrders += Number(item.orders) || 0;
              campaignCount++;
            }
          } catch {}
        }
      }

      const metrics = {
        acos: totalSales > 0 ? Math.round(totalCost / totalSales * 10000) / 100 : 0,
        ctr: totalImpressions > 0 ? Math.round(totalClicks / totalImpressions * 10000) / 100 : 0,
        cvr: totalClicks > 0 ? Math.round(totalOrders / totalClicks * 10000) / 100 : 0,
        cpc: totalClicks > 0 ? Math.round(totalCost / totalClicks * 100) / 100 : 0,
        roas: totalCost > 0 ? Math.round(totalSales / totalCost * 100) / 100 : 0,
        totalCost: Math.round(totalCost * 100) / 100,
        totalSales: Math.round(totalSales * 100) / 100,
        totalOrders,
        totalImpressions,
        totalClicks,
      };

      // AI diagnosis - Emperor Skill 优先，降级到内置 LLM
      try {
        const emperorContext = `广告诊断数据（${input.days}天汇总，数据已脱敏）：\n${JSON.stringify(metrics)}`;
      } catch (emperorErr) {
      }

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是亚马逊广告诊断专家。基于广告整体数据，从6个维度评估广告健康度并给出诊断建议。
6个维度：花费效率(ACoS/ROAS)、流量质量(CTR)、转化能力(CVR)、出价合理性(CPC)、预算利用率、广告结构合理性。
每个维度评分0-100分，并给出具体问题和改进建议。输出严格JSON格式。`
          },
          {
            role: "user",
            content: `诊断以下广告数据（${input.days}天汇总，数据已脱敏）：

${JSON.stringify(metrics)}

请从6个维度评分并给出诊断：`
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ad_diagnosis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                overall_score: { type: "integer" },
                overall_assessment: { type: "string" },
                dimensions: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      name: { type: "string" },
                      score: { type: "integer" },
                      status: { type: "string" },
                      problems: { type: "array", items: { type: "string" } },
                      suggestions: { type: "array", items: { type: "string" } },
                    },
                    required: ["name", "score", "status", "problems", "suggestions"],
                    additionalProperties: false,
                  },
                },
                priority_actions: { type: "array", items: { type: "string" } },
              },
              required: ["overall_score", "overall_assessment", "dimensions", "priority_actions"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      const diagnosis = JSON.parse(content);
      return { ...diagnosis, metrics };
    }),

// ─── Get 12 Category Definitions ──────────────────────────────
  getCategoryDefinitions: protectedProcedure.query(async () => {
    return { categories: TWELVE_CATEGORIES, defaultThresholds: DEFAULT_THRESHOLDS };
  }),

// ─── Targeting Object 9-Category Analysis ─────────────────────
  getTargetingAnalysis: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(), // Multi-campaign filter
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      days: z.number().optional().default(3),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
    }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);
      const datesToQuery = resolveDateRange({
        startDate: input.startDate,
        endDate: input.endDate,
        days: input.days || 3,
      });
      const adType = input.adType || 'SP';
      const targetingApiPath = adType === 'SB'
        ? '/pb/openapi/newad/listHsaTargetingReport'
        : adType === 'SD'
          ? '/pb/openapi/newad/sdMatchTargetReports'
          : '/pb/openapi/newad/spKeywordReports';

      // Resolve effective campaign IDs
      const effectiveCampaignIds_t = (input.campaignIds && input.campaignIds.length > 0)
        ? input.campaignIds
        : (input.campaignId ? [input.campaignId] : []);
      const campaignIdSet_t = new Set(effectiveCampaignIds_t);
      const hasCampaignFilter_t = effectiveCampaignIds_t.length > 0;

      const targetAgg: Record<string, {
        target_id: string; targeting_type: string; targeting_expression: string;
        impressions: number; clicks: number; cost: number; sales: number; orders: number;
      }> = {};

      // Build all tasks for parallel execution
      const tasks: Array<{ sid: number; date: string }> = [];
      for (const sid of sidsToQuery) {
        for (const date of datesToQuery) {
          tasks.push({ sid, date });
        }
      }

      // Execute in parallel with concurrency limit of 5
      const CONCURRENCY = 5;
      for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        const batch = tasks.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(async ({ sid, date }) => {
          const body: any = {
            sid,
            report_date: date,
            show_detail: 1,
            offset: 0,
            length: 1000,
          };
          return ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
        }));
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const res = result.value;
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
          for (const item of items) {
            // Filter by selected campaign IDs
            if (hasCampaignFilter_t && item.campaign_id && !campaignIdSet_t.has(String(item.campaign_id))) continue;
            const key = `${item.keyword_id || item.targeting_id || item.target_id}||${item.keyword_text || item.targeting || item.targeting_expression}`;
            if (targetAgg[key]) {
              targetAgg[key].impressions += Number(item.impressions) || 0;
              targetAgg[key].clicks += Number(item.clicks) || 0;
              targetAgg[key].cost += Number(item.cost) || 0;
              targetAgg[key].sales += Number(item.sales) || 0;
              targetAgg[key].orders += Number(item.orders) || 0;
            } else {
              targetAgg[key] = {
                target_id: String(item.keyword_id || item.targeting_id || item.target_id || ''),
                targeting_type: item.match_type || item.targeting_type || '',
                targeting_expression: item.keyword_text || item.targeting || item.targeting_expression || '',
                impressions: Number(item.impressions) || 0,
                clicks: Number(item.clicks) || 0,
                cost: Number(item.cost) || 0,
                sales: Number(item.sales) || 0,
                orders: Number(item.orders) || 0,
              };
            }
          }
        }
      }

      // 9-category classification for targeting objects
      const targets = Object.values(targetAgg).map(t => {
        const cvr = t.clicks > 0 ? t.orders / t.clicks : 0;
        const acos = t.sales > 0 ? Math.round(t.cost / t.sales * 10000) / 100 : (t.cost > 0 ? 999 : 0);
        const ctr = t.impressions > 0 ? Math.round(t.clicks / t.impressions * 10000) / 100 : 0;
        
        let category = 'observe';
        if (cvr >= 0.10 && t.clicks >= 10) category = 'star';        // 高转化高点击
        else if (cvr >= 0.10 && t.clicks < 10) category = 'potential'; // 高转化低点击
        else if (cvr >= 0.03 && cvr < 0.10 && t.clicks >= 10) category = 'stable'; // 中转化高点击
        else if (cvr >= 0.03 && cvr < 0.10 && t.clicks < 10) category = 'test';    // 中转化低点击
        else if (cvr < 0.03 && t.clicks >= 20) category = 'waste';    // 低转化高点击
        else if (cvr < 0.03 && t.clicks >= 5) category = 'decline';   // 低转化中点击
        else if (t.cost > 5 && t.orders === 0) category = 'negate';   // 花费无转化
        else if (t.clicks < 3) category = 'new';                       // 数据不足
        else category = 'observe';                                      // 其他观察

        return { ...t, cvr: Math.round(cvr * 10000) / 100, acos, ctr, category };
      });

      targets.sort((a, b) => b.cost - a.cost);
      return { targets, days: datesToQuery.length, adType, isMock: true };
    }),

// ─── Word Frequency Attribute 6-Category Analysis (Tab 4) ────
  getWordFrequencyAnalysis: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(), // Multi-campaign filter
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      days: z.number().optional().default(7),
    }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 5);
      const days = input.days || 7;
      // Collect all search terms for this campaign
      // Resolve effective campaign IDs
      const effectiveCampaignIds_w = (input.campaignIds && input.campaignIds.length > 0)
        ? input.campaignIds
        : (input.campaignId ? [input.campaignId] : []);
      const campaignIdSet_w = new Set(effectiveCampaignIds_w);
      const hasCampaignFilter_w = effectiveCampaignIds_w.length > 0;

      const allTerms: Array<{
        query: string; impressions: number; clicks: number;
        cost: number; sales: number; orders: number;
      }> = [];

      for (const sid of sidsToQuery) {
        for (let d = 1; d <= Math.min(days, 30); d++) {
          try {
            const body: any = { sid, report_date: getDateNDaysAgo(d), offset: 0, length: 500 };
            // For single campaign, pass campaign_id to API; for multi, fetch all and filter
            if (hasCampaignFilter_w && effectiveCampaignIds_w.length === 1) body.campaign_id = effectiveCampaignIds_w[0];
            const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
            const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
            for (const item of items) {
              // Filter by campaign IDs when multiple selected
              if (hasCampaignFilter_w && effectiveCampaignIds_w.length > 1 && item.campaign_id && !campaignIdSet_w.has(String(item.campaign_id))) continue;
              allTerms.push({
                query: item.query || item.search_term || '',
                impressions: Number(item.impressions) || 0,
                clicks: Number(item.clicks) || 0,
                cost: Number(item.cost) || 0,
                sales: Number(item.sales) || 0,
                orders: Number(item.orders) || 0,
              });
            }
          } catch {}
        }
      }

      // Extract attribute words from search terms
      const wordAgg: Record<string, {
        word: string; impressions: number; clicks: number;
        cost: number; sales: number; orders: number; termCount: number;
      }> = {};

      for (const term of allTerms) {
        const words = term.query.toLowerCase().split(/[\s,;+\-_]+/).filter(w => w.length >= 2);
        for (const word of words) {
          // Skip common stop words and brand-like words
          if (['for', 'the', 'and', 'with', 'set', 'pack', 'pcs', 'inch', 'size', 'new', 'best', 'top'].includes(word)) continue;
          if (/^\d+$/.test(word)) continue;
          if (!wordAgg[word]) {
            wordAgg[word] = { word, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, termCount: 0 };
          }
          wordAgg[word].impressions += term.impressions;
          wordAgg[word].clicks += term.clicks;
          wordAgg[word].cost += term.cost;
          wordAgg[word].sales += term.sales;
          wordAgg[word].orders += term.orders;
          wordAgg[word].termCount++;
        }
      }

      // 6-category classification
      const attributes = Object.values(wordAgg).map(w => {
        const cvr = w.clicks > 0 ? w.orders / w.clicks : 0;
        const acos = w.sales > 0 ? Math.round(w.cost / w.sales * 10000) / 100 : (w.cost > 0 ? 999 : 0);
        const ctr = w.impressions > 0 ? Math.round(w.clicks / w.impressions * 10000) / 100 : 0;

        let category: number;
        if (cvr >= 0.10) category = 1;           // 高转化率 - 核心属性词
        else if (cvr >= 0.03) category = 2;      // 中转化率 - 基本属性词
        else if (cvr > 0 && cvr < 0.03) category = 3;  // 低转化率 - 弱属性词
        else if (w.orders === 0 && w.clicks >= 30) category = 4;  // 0转化_30次以上点击
        else if (w.orders === 0 && w.clicks >= 7) category = 5;   // 0转化_7-30次点击
        else category = 6;                        // 0转化_7次以下 - 低量属性

        return {
          ...w,
          cvr: Math.round(cvr * 10000) / 100,
          acos,
          ctr,
          category,
        };
      });

      // Sort by impressions descending
      attributes.sort((a, b) => b.impressions - a.impressions);

      // Category stats
      const categoryStats: Record<number, { count: number; impressions: number; clicks: number; orders: number; cost: number }> = {};
      for (let i = 1; i <= 6; i++) {
        categoryStats[i] = { count: 0, impressions: 0, clicks: 0, orders: 0, cost: 0 };
      }
      for (const attr of attributes) {
        const s = categoryStats[attr.category];
        if (s) {
          s.count++;
          s.impressions += attr.impressions;
          s.clicks += attr.clicks;
          s.orders += attr.orders;
          s.cost += attr.cost;
        }
      }

      return { attributes: attributes.slice(0, 200), categoryStats, totalWords: attributes.length, days, isMock: true };
    }),

// ─── Effective Converting Search Terms Discovery (Tab 8) ─────
  getEffectiveSearchTerms: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(), // Multi-campaign filter
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);
      const days = input.days || 30;

      // Resolve effective campaign IDs
      const effectiveCampaignIds_e = (input.campaignIds && input.campaignIds.length > 0)
        ? input.campaignIds
        : (input.campaignId ? [input.campaignId] : []);
      const campaignIdSet_e = new Set(effectiveCampaignIds_e);
      const hasCampaignFilter_e = effectiveCampaignIds_e.length > 0;

      // Step 1: Get all search terms with ad data
      const adTerms: Record<string, {
        query: string; impressions: number; clicks: number;
        cost: number; sales: number; orders: number; isAdvertised: boolean;
      }> = {};

      for (const sid of sidsToQuery) {
        for (let d = 1; d <= Math.min(days, 30); d++) {
          try {
            const body: any = { sid, report_date: getDateNDaysAgo(d), offset: 0, length: 500 };
            if (hasCampaignFilter_e && effectiveCampaignIds_e.length === 1) body.campaign_id = effectiveCampaignIds_e[0];
            const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
            const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
            for (const item of items) {
              // Filter by campaign IDs when multiple selected
              if (hasCampaignFilter_e && effectiveCampaignIds_e.length > 1 && item.campaign_id && !campaignIdSet_e.has(String(item.campaign_id))) continue;
              const q = (item.query || item.search_term || '').toLowerCase().trim();
              if (!q) continue;
              if (!adTerms[q]) {
                adTerms[q] = { query: q, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, isAdvertised: false };
              }
              adTerms[q].impressions += Number(item.impressions) || 0;
              adTerms[q].clicks += Number(item.clicks) || 0;
              adTerms[q].cost += Number(item.cost) || 0;
              adTerms[q].sales += Number(item.sales) || 0;
              adTerms[q].orders += Number(item.orders) || 0;
              if ((Number(item.cost) || 0) > 0) adTerms[q].isAdvertised = true;
            }
          } catch {}
        }
      }

      // Step 2: Get keyword reports (what we're actively targeting)
      const targetedKeywords = new Set<string>();
      for (const sid of sidsToQuery) {
        try {
          const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
          for (const item of items) {
            const kw = (item.keyword || item.keyword_text || '').toLowerCase().trim();
            if (kw) targetedKeywords.add(kw);
          }
        } catch {}
      }

      // Step 3: Find effective terms (have orders but not actively targeted)
      const effectiveTerms = Object.values(adTerms)
        .filter(t => t.orders > 0 && !targetedKeywords.has(t.query))
        .map(t => {
          const cvr = t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : 0;
          const acos = t.sales > 0 ? Math.round(t.cost / t.sales * 10000) / 100 : 0;
          // Value score: orders * cvr weight
          const valueScore = Math.min(10, Math.round((t.orders * 2 + cvr * 0.5) * 10) / 10);
          return {
            ...t,
            cvr,
            acos,
            valueScore,
            recommendedMatchType: cvr >= 10 ? 'exact' : cvr >= 5 ? 'phrase' : 'broad',
            recommendedBid: Math.round((t.clicks > 0 ? t.cost / t.clicks * 0.8 : 0.5) * 100) / 100,
          };
        })
        .sort((a, b) => b.orders - a.orders);

      // Also find organic-only terms (have impressions/clicks but zero cost)
      const organicOnlyTerms = Object.values(adTerms)
        .filter(t => t.orders > 0 && t.cost === 0)
        .map(t => {
          const cvr = t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : 0;
          return { ...t, cvr, valueScore: Math.min(10, t.orders * 3), isOrganic: true };
        })
        .sort((a, b) => b.orders - a.orders);

      return {
        effectiveTerms: effectiveTerms.slice(0, 100),
        organicOnlyTerms: organicOnlyTerms.slice(0, 50),
        totalAdTerms: Object.keys(adTerms).length,
        totalTargetedKeywords: targetedKeywords.size,
        days,
        isMock: true,
      };
    }),

// ─── AI Evaluate Search Term Value ───────────────────────────
  aiEvaluateSearchTerms: protectedProcedure
    .input(z.object({
      terms: z.array(z.record(z.string(), z.unknown())),
      targetAcos: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位亚马逊广告投放策略专家。请评估以下未投放广告的出单搜索词的投放价值。
注意：数据已脱敏，不包含任何产品标识信息。输出严格JSON格式。`
          },
          {
            role: "user",
            content: `评估以下搜索词的投放价值，目标ACOS: ${input.targetAcos || 25}%

${JSON.stringify(input.terms.slice(0, 20))}

请为每个词给出：
1. value_score: 投放价值评分(1-10)
2. recommended_match_type: 建议匹配类型(exact/phrase/broad)
3. recommended_bid: 建议竞价($)
4. reason: 推荐原因(30字以内)
5. priority: 优先级(P0/P1/P2)`
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "search_term_evaluation",
            strict: true,
            schema: {
              type: "object",
              properties: {
                evaluated_terms: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      term: { type: "string" },
                      value_score: { type: "number" },
                      recommended_match_type: { type: "string" },
                      recommended_bid: { type: "number" },
                      reason: { type: "string" },
                      priority: { type: "string" },
                    },
                    required: ["term", "value_score", "recommended_match_type", "recommended_bid", "reason", "priority"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
              },
              required: ["evaluated_terms", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    })
};
