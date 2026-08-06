import { failUnavailableDataSource } from "@shared/_core/errors";
import { z, invokeBusinessSkill, protectedProcedure, router, getDb, eq, desc, and, sql, budgetTracking, ClassificationThresholds, DEFAULT_THRESHOLDS, TWELVE_CATEGORIES, classifySearchTerm, anonymizeForAI, deAnonymizeResults, _queryCache, CACHE_TTL, getCached, setCache, parallelBatch, getDateNDaysAgo, getDatesInRange, resolveDateRange, getAllSellerSids, MARKETPLACE_MAP, filterSidsByMarketplace } from "./context";

export const placementAndHourlyProcedures = {
// ─── Ad Placement Analysis ────────────────────────────────────
  getAdPlacementData: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      days: z.number().optional().default(3),
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(), // Multi-campaign filter
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
      const placementApiPath = adType === 'SB'
        ? '/pb/openapi/newad/hsaCampaignPlacementReports'
        : adType === 'SD'
          ? '/pb/openapi/newad/sdCampaignReports'
          : '/pb/openapi/newad/campaignPlacementReports';

      // Resolve effective campaign IDs
      const effectiveCampaignIds_p = (input.campaignIds && input.campaignIds.length > 0)
        ? input.campaignIds
        : (input.campaignId ? [input.campaignId] : []);
      const campaignIdSet_p = new Set(effectiveCampaignIds_p);
      const hasCampaignFilter_p = effectiveCampaignIds_p.length > 0;

      const placementAgg: Record<string, {
        placement: string; impressions: number; clicks: number;
        cost: number; sales: number; orders: number;
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
          return failUnavailableDataSource();
        }));
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const res = result.value;
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
          for (const item of items) {
            // Filter by selected campaign IDs
            if (hasCampaignFilter_p && item.campaign_id && !campaignIdSet_p.has(String(item.campaign_id))) continue;
            const placement = item.placement_type || item.placement || 'Other';
            if (!placementAgg[placement]) {
              placementAgg[placement] = { placement, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
            }
            placementAgg[placement].impressions += Number(item.impressions) || 0;
            placementAgg[placement].clicks += Number(item.clicks) || 0;
            placementAgg[placement].cost += Number(item.cost) || 0;
            placementAgg[placement].sales += Number(item.sales) || 0;
            placementAgg[placement].orders += Number(item.orders) || 0;
          }
        }
      }

      const placements = Object.values(placementAgg).map(p => ({
        ...p,
        acos: p.sales > 0 ? Math.round(p.cost / p.sales * 10000) / 100 : 0,
        ctr: p.impressions > 0 ? Math.round(p.clicks / p.impressions * 10000) / 100 : 0,
        cvr: p.clicks > 0 ? Math.round(p.orders / p.clicks * 10000) / 100 : 0,
        cpc: p.clicks > 0 ? Math.round(p.cost / p.clicks * 100) / 100 : 0,
        roas: p.cost > 0 ? Math.round(p.sales / p.cost * 100) / 100 : 0,
      }));

      return { placements, days: datesToQuery.length, adType, isMock: true };
    }),

// ─── Ad Placement by Keyword Dimension ─────────────────
  getAdPlacementByKeyword: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      days: z.number().optional().default(7),
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
      searchKeyword: z.string().optional(),
      sortBy: z.enum(["impressions", "clicks", "cost", "sales", "acos", "ctr", "cvr", "orders"]).optional().default("impressions"),
      sortDir: z.enum(["asc", "desc"]).optional().default("desc"),
    }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);
      const datesToQuery = resolveDateRange({
        startDate: input.startDate,
        endDate: input.endDate,
        days: input.days || 7,
      });

      const effectiveCampaignIds = (input.campaignIds && input.campaignIds.length > 0)
        ? input.campaignIds
        : (input.campaignId ? [input.campaignId] : []);
      const campaignIdSet = new Set(effectiveCampaignIds);
      const hasCampaignFilter = effectiveCampaignIds.length > 0;

      // Step 1: Fetch keyword reports to get keyword-level data
      const keywordApiPath = input.adType === 'SB'
        ? '/pb/openapi/newad/hsaKeywordReports'
        : '/pb/openapi/newad/spKeywordReports';

      // Aggregate: keyword_text -> { placement -> metrics }
      type KwPlacementMetrics = {
        impressions: number; clicks: number; cost: number;
        sales: number; orders: number;
      };
      const kwMap: Record<string, {
        keyword_text: string; match_type: string;
        total: KwPlacementMetrics;
        byPlacement: Record<string, KwPlacementMetrics>;
      }> = {};

      // Step 2: Fetch search term reports which may have placement info
      const searchTermApiPath = '/pb/openapi/newad/spSearchTermReports';

      const tasks: Array<{ sid: number; date: string }> = [];
      for (const sid of sidsToQuery) {
        for (const date of datesToQuery) {
          tasks.push({ sid, date });
        }
      }

      // Fetch keyword reports
      const CONCURRENCY = 5;
      for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        const batch = tasks.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(async ({ sid, date }) => {
          return failUnavailableDataSource();
        }));
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const res = result.value;
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
          for (const item of items) {
            if (hasCampaignFilter && item.campaign_id && !campaignIdSet.has(String(item.campaign_id))) continue;
            const kwText = item.keyword_text || item.targeting || 'Unknown';
            const matchType = item.match_type || 'BROAD';
            if (!kwMap[kwText]) {
              kwMap[kwText] = {
                keyword_text: kwText,
                match_type: matchType,
                total: { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 },
                byPlacement: {},
              };
            }
            const kw = kwMap[kwText];
            kw.total.impressions += Number(item.impressions) || 0;
            kw.total.clicks += Number(item.clicks) || 0;
            kw.total.cost += Number(item.cost) || 0;
            kw.total.sales += Number(item.sales) || 0;
            kw.total.orders += Number(item.orders) || 0;
          }
        }
      }

      // Step 3: Fetch placement reports to get placement-level data per campaign
      // Then distribute keyword metrics proportionally across placements
      const placementApiPath = input.adType === 'SB'
        ? '/pb/openapi/newad/hsaCampaignPlacementReports'
        : '/pb/openapi/newad/campaignPlacementReports';

      const placementTotals: Record<string, KwPlacementMetrics> = {};
      let totalPlacementImpressions = 0;

      for (let i = 0; i < tasks.length; i += CONCURRENCY) {
        const batch = tasks.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(batch.map(async ({ sid, date }) => {
          return failUnavailableDataSource();
        }));
        for (const result of results) {
          if (result.status !== 'fulfilled') continue;
          const res = result.value;
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
          for (const item of items) {
            if (hasCampaignFilter && item.campaign_id && !campaignIdSet.has(String(item.campaign_id))) continue;
            const placement = item.placement_type || item.placement || 'Other';
            if (!placementTotals[placement]) {
              placementTotals[placement] = { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
            }
            placementTotals[placement].impressions += Number(item.impressions) || 0;
            placementTotals[placement].clicks += Number(item.clicks) || 0;
            placementTotals[placement].cost += Number(item.cost) || 0;
            placementTotals[placement].sales += Number(item.sales) || 0;
            placementTotals[placement].orders += Number(item.orders) || 0;
            totalPlacementImpressions += Number(item.impressions) || 0;
          }
        }
      }

      // Step 4: Distribute keyword metrics across placements proportionally
      const placementNames = Object.keys(placementTotals);
      for (const kwText of Object.keys(kwMap)) {
        const kw = kwMap[kwText];
        for (const pName of placementNames) {
          const pTotal = placementTotals[pName];
          const ratio = totalPlacementImpressions > 0 ? pTotal.impressions / totalPlacementImpressions : 0;
          kw.byPlacement[pName] = {
            impressions: Math.round(kw.total.impressions * ratio),
            clicks: Math.round(kw.total.clicks * ratio),
            cost: Math.round(kw.total.cost * ratio * 100) / 100,
            sales: Math.round(kw.total.sales * ratio * 100) / 100,
            orders: Math.round(kw.total.orders * ratio),
          };
        }
      }

      // Step 5: Build result array with computed metrics
      let keywords = Object.values(kwMap).map(kw => {
        const t = kw.total;
        const placementDetails = Object.entries(kw.byPlacement).map(([pName, m]) => ({
          placement: pName,
          ...m,
          acos: m.sales > 0 ? Math.round(m.cost / m.sales * 10000) / 100 : 0,
          ctr: m.impressions > 0 ? Math.round(m.clicks / m.impressions * 10000) / 100 : 0,
          cvr: m.clicks > 0 ? Math.round(m.orders / m.clicks * 10000) / 100 : 0,
          cpc: m.clicks > 0 ? Math.round(m.cost / m.clicks * 100) / 100 : 0,
        }));
        return {
          keyword_text: kw.keyword_text,
          match_type: kw.match_type,
          impressions: t.impressions,
          clicks: t.clicks,
          cost: Math.round(t.cost * 100) / 100,
          sales: Math.round(t.sales * 100) / 100,
          orders: t.orders,
          acos: t.sales > 0 ? Math.round(t.cost / t.sales * 10000) / 100 : 0,
          ctr: t.impressions > 0 ? Math.round(t.clicks / t.impressions * 10000) / 100 : 0,
          cvr: t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : 0,
          cpc: t.clicks > 0 ? Math.round(t.cost / t.clicks * 100) / 100 : 0,
          roas: t.cost > 0 ? Math.round(t.sales / t.cost * 100) / 100 : 0,
          placements: placementDetails,
        };
      });

      // Filter by search keyword
      if (input.searchKeyword) {
        const kw = input.searchKeyword.toLowerCase();
        keywords = keywords.filter(k => k.keyword_text.toLowerCase().includes(kw));
      }

      // Sort
      const sortKey = input.sortBy || 'impressions';
      const sortDir = input.sortDir || 'desc';
      keywords.sort((a, b) => {
        const va = (a as any)[sortKey] || 0;
        const vb = (b as any)[sortKey] || 0;
        return sortDir === 'desc' ? vb - va : va - vb;
      });

      return {
        keywords,
        placementNames,
        days: datesToQuery.length,
        adType: input.adType,
        isMock: true,
      };
    }),

// ─── Hourly Ad Data (for Dayparting Strategy) ─────────────────
  getAdHourlyData: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      days: z.number().optional().default(7),
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(), // Multi-campaign filter
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
    }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);
      const datesToQuery = resolveDateRange({
        startDate: input.startDate,
        endDate: input.endDate,
        days: input.days || 7,
      });
      const adType = input.adType || 'SP';
      const hourlyApiPath = adType === 'SB'
        ? '/pb/openapi/newad/sbCampaignHourData'
        : adType === 'SD'
          ? '/pb/openapi/newad/sdCampaignHourData'
          : '/pb/openapi/newad/spCampaignHourData';

      // Resolve effective campaign IDs
      const effectiveCampaignIds_h = (input.campaignIds && input.campaignIds.length > 0)
        ? input.campaignIds
        : (input.campaignId ? [input.campaignId] : []);
      const campaignIdSet_h = new Set(effectiveCampaignIds_h);
      const hasCampaignFilter_h = effectiveCampaignIds_h.length > 0;

      // Aggregate hourly data
      const hourlyAgg: Record<number, {
        hour: number; impressions: number; clicks: number;
        cost: number; sales: number; orders: number;
      }> = {};
      for (let h = 0; h < 24; h++) {
        hourlyAgg[h] = { hour: h, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
      }

      for (const sid of sidsToQuery) {
        for (const reportDate of datesToQuery) {
          try {
            const body: any = { report_date: reportDate };
            // For single campaign, pass campaign_id directly to API; for multi, fetch all and filter
            if (hasCampaignFilter_h && effectiveCampaignIds_h.length === 1) body.campaign_id = Number(effectiveCampaignIds_h[0]);
            else body.sid = sid;
            
            const res = failUnavailableDataSource();
            const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
            for (const item of items) {
              // Filter by campaign IDs when multiple selected
              if (hasCampaignFilter_h && effectiveCampaignIds_h.length > 1 && item.campaign_id && !campaignIdSet_h.has(String(item.campaign_id))) continue;
              const hour = Number(item.hour) || 0;
              if (hour >= 0 && hour < 24) {
                hourlyAgg[hour].impressions += Number(item.impressions) || 0;
                hourlyAgg[hour].clicks += Number(item.clicks) || 0;
                hourlyAgg[hour].cost += Number(item.cost) || 0;
                hourlyAgg[hour].sales += Number(item.sales) || 0;
                hourlyAgg[hour].orders += Number(item.orders) || 0;
              }
            }
          } catch (err: any) {
            // Skip
          }
        }
      }

      const hourlyData = Object.values(hourlyAgg).map(h => ({
        ...h,
        acos: h.sales > 0 ? Math.round(h.cost / h.sales * 10000) / 100 : 0,
        ctr: h.impressions > 0 ? Math.round(h.clicks / h.impressions * 10000) / 100 : 0,
        cvr: h.clicks > 0 ? Math.round(h.orders / h.clicks * 10000) / 100 : 0,
        cpc: h.clicks > 0 ? Math.round(h.cost / h.clicks * 100) / 100 : 0,
      }));

      return { hourlyData, days: datesToQuery.length, adType, isMock: true };
    }),

// ─── Order Hourly Heatmap (ASIN360) ───────────────────────────
  getOrderHourlyHeatmap: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(), // Multi-campaign filter
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      days: z.number().optional().default(7),
    }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsStr = sids.slice(0, 5).join(',');
      const dateEnd = input.endDate || getDateNDaysAgo(1);
      const dateStart = input.startDate || getDateNDaysAgo(input.days || 7);
      try {
        const body: any = {
          sids: sidsStr,
          date_start: dateStart,
          date_end: dateEnd,
          summary_field: "campaign",
        };
        // Use first campaignId from campaignIds array, or single campaignId
        const heatmapCampaignId = (input.campaignIds && input.campaignIds.length > 0)
          ? input.campaignIds[0]
          : input.campaignId;
        if (heatmapCampaignId) body.summary_field_value = heatmapCampaignId;

        const res = failUnavailableDataSource();
        const list = (res.data as any)?.list || res.data || [];
        
        // Build 24h × 7day heatmap
        const heatmapData: { hour: number; day: string; orders: number; sales: number; volume: number }[] = [];
        if (Array.isArray(list)) {
          for (const item of list) {
            const rDate = item.r_date || '';
            // Parse hour from r_date (format may vary)
            const hourMatch = rDate.match(/(\d{1,2}):00/);
            const hour = hourMatch ? Number(hourMatch[1]) : 0;
            const day = rDate.split(' ')[0] || rDate;
            heatmapData.push({
              hour,
              day,
              orders: Number(item.order_items) || 0,
              sales: Number(item.amount) || 0,
              volume: Number(item.volume) || 0,
            });
          }
        }

        return { heatmapData, isMock: true };
      } catch (err: any) {
        console.warn(`[OrderHeatmap] Error: ${err.message}`);
        return { heatmapData: [], isMock: true };
      }
    }),

// ─── AI Dayparting Strategy ───────────────────────────────────
  aiDaypartingStrategy: protectedProcedure
    .input(z.object({
      hourlyData: z.array(z.record(z.string(), z.unknown())),
      currentBid: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const response = await invokeBusinessSkill({
        messages: [
          {
            role: "system",
            content: `你是亚马逊PPC广告分时竞价策略专家。基于24小时广告数据，生成分时竞价调整建议。
注意：数据已脱敏，不包含任何产品标识信息。输出严格JSON格式。`
          },
          {
            role: "user",
            content: `基于以下24小时广告数据，生成分时竞价策略：

${JSON.stringify(input.hourlyData)}

当前基础出价: $${input.currentBid || 1.0}

请为每个小时段给出：
1. bid_multiplier: 出价倍数(0.5-2.0)
2. strategy: 策略说明
3. tier: 时段等级(peak/normal/low/off)

同时给出整体策略总结和预期效果。`
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "dayparting_strategy",
            strict: true,
            schema: {
              type: "object",
              properties: {
                hourly_strategy: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      hour: { type: "integer" },
                      bid_multiplier: { type: "number" },
                      strategy: { type: "string" },
                      tier: { type: "string" },
                    },
                    required: ["hour", "bid_multiplier", "strategy", "tier"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
                expected_savings: { type: "string" },
                peak_hours: { type: "array", items: { type: "string" } },
              },
              required: ["hourly_strategy", "summary", "expected_savings", "peak_hours"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    })
};
