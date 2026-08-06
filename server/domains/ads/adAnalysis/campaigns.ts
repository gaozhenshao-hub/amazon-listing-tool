import { failUnavailableDataSource } from "@shared/_core/errors";
import { z, invokeBusinessSkill, protectedProcedure, router, getDb, eq, desc, and, sql, budgetTracking, ClassificationThresholds, DEFAULT_THRESHOLDS, TWELVE_CATEGORIES, classifySearchTerm, anonymizeForAI, deAnonymizeResults, _queryCache, CACHE_TTL, getCached, setCache, parallelBatch, getDateNDaysAgo, getDatesInRange, resolveDateRange, getAllSellerSids, MARKETPLACE_MAP, filterSidsByMarketplace } from "./context";

export const campaignsProcedures = {
// ─── Multi-Campaign Search Terms Aggregation ──────────────────
  getSearchTermsMultiCampaign: protectedProcedure
    .input(z.object({
      campaignIds: z.array(z.string()).min(1).max(100),
      campaignNames: z.record(z.string(), z.string()).optional(), // campaignId -> name mapping
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      days: z.number().optional().default(3),
      adType: z.enum(["SP", "SB"]).optional().default("SP"),
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
      const sidsToQuery = sids.map(Number).slice(0, 3);
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

      // Cache key includes sorted campaign IDs
      const sortedIds = [...input.campaignIds].sort().join(',');
      const cacheKey = `searchTermsMulti_${sortedIds}_${input.marketplace || 'ALL'}_${datesToQuery.length}_${datesToQuery[0] || ''}_${adType}`;
      const cached = getCached<any>(cacheKey);
      if (cached) {
        console.log(`[SearchTermsMulti] Cache HIT for ${input.campaignIds.length} campaigns`);
        return cached;
      }
      console.log(`[SearchTermsMulti] Fetching search terms for ${input.campaignIds.length} campaigns, ${sidsToQuery.length} stores x ${datesToQuery.length} days`);
      const startTime = Date.now();

      // Per-search-term aggregation with source campaign tracking
      const termAggMap: Record<string, {
        query: string; target_text: string; match_type: string;
        impressions: number; clicks: number; cost: number;
        sales: number; orders: number; units: number; days_seen: number;
        sourceCampaigns: Map<string, {
          campaignId: string; campaignName: string;
          impressions: number; clicks: number; cost: number;
          sales: number; orders: number;
        }>;
      }> = {};

      const campaignNameMap = input.campaignNames || {};

      // Fetch for each campaign in parallel
      const fetchSidDayCampaign = async (sid: number, reportDate: string, campaignId: string): Promise<any[]> => {
        const items: any[] = [];
        try {
          let offset = 0;
          let hasMore = true;
          while (hasMore && offset < 1000) {
            const res = failUnavailableDataSource();
            const rawData = res.data || [];
            const batch = Array.isArray(rawData) ? rawData : (rawData as any).records || [];
            items.push(...batch.map((b: any) => ({ ...b, _campaignId: campaignId })));
            hasMore = batch.length >= 200;
            offset += 200;
          }
        } catch (err: any) { /* skip */ }
        return items;
      };

      // Build tasks: for each campaign x sid x date
      const tasks: (() => Promise<any[]>)[] = [];
      for (const campaignId of input.campaignIds) {
        for (const sid of sidsToQuery) {
          for (const reportDate of datesToQuery) {
            tasks.push(() => fetchSidDayCampaign(sid, reportDate, campaignId));
          }
        }
      }

      // Run with concurrency limit
      const allResults = await parallelBatch(tasks, 8);

      // Merge all results
      for (const items of allResults) {
        for (const item of items) {
          const campaignId = String(item._campaignId || item.campaign_id || '');
          // Aggregate by search term query (across all campaigns)
          const key = `${item.query}||${item.match_type}`;
          const imp = Number(item.impressions) || 0;
          const clk = Number(item.clicks) || 0;
          const cst = Number(item.cost) || 0;
          const sls = Number(item.sales) || 0;
          const ord = Number(item.orders) || 0;
          const unt = Number(item.units) || 0;

          if (!termAggMap[key]) {
            termAggMap[key] = {
              query: item.query || '',
              target_text: item.target_text || '',
              match_type: item.match_type || '',
              impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0, days_seen: 0,
              sourceCampaigns: new Map(),
            };
          }
          const agg = termAggMap[key];
          agg.impressions += imp;
          agg.clicks += clk;
          agg.cost += cst;
          agg.sales += sls;
          agg.orders += ord;
          agg.units += unt;
          agg.days_seen += 1;

          // Track per-campaign contribution
          const existing = agg.sourceCampaigns.get(campaignId);
          if (existing) {
            existing.impressions += imp;
            existing.clicks += clk;
            existing.cost += cst;
            existing.sales += sls;
            existing.orders += ord;
          } else {
            agg.sourceCampaigns.set(campaignId, {
              campaignId,
              campaignName: campaignNameMap[campaignId] || `Campaign ${campaignId}`,
              impressions: imp, clicks: clk, cost: cst, sales: sls, orders: ord,
            });
          }
        }
      }

      // Classify and build result
      const searchTerms = Object.values(termAggMap).map(t => {
        const acos = t.sales > 0 ? Math.round(t.cost / t.sales * 10000) / 100 : (t.cost > 0 ? 999 : 0);
        const ctr = t.impressions > 0 ? Math.round(t.clicks / t.impressions * 10000) / 100 : 0;
        const cpc = t.clicks > 0 ? Math.round(t.cost / t.clicks * 100) / 100 : 0;
        const convRate = t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : 0;
        const { categoryId, categoryKey } = classifySearchTerm(t.impressions, t.clicks, t.orders, thresholds);

        // Convert sourceCampaigns Map to array for serialization
        const sources = Array.from(t.sourceCampaigns.values());

        return {
          query: t.query, target_text: t.target_text, match_type: t.match_type,
          impressions: t.impressions, clicks: t.clicks, cost: t.cost,
          sales: t.sales, orders: t.orders, units: t.units, days_seen: t.days_seen,
          acos, ctr, cpc, convRate, categoryId, categoryKey,
          sourceCampaigns: sources,
          campaignCount: sources.length,
        };
      });

      searchTerms.sort((a, b) => b.cost - a.cost);

      // Category stats
      const categoryStats: Record<number, number> = {};
      for (let i = 1; i <= 12; i++) categoryStats[i] = 0;
      for (const t of searchTerms) categoryStats[t.categoryId] = (categoryStats[t.categoryId] || 0) + 1;

      // Per-campaign summary
      const campaignSummaries: Record<string, { campaignId: string; campaignName: string; termCount: number; totalCost: number; totalSales: number; totalOrders: number }> = {};
      for (const t of searchTerms) {
        for (const src of t.sourceCampaigns) {
          if (!campaignSummaries[src.campaignId]) {
            campaignSummaries[src.campaignId] = {
              campaignId: src.campaignId,
              campaignName: src.campaignName,
              termCount: 0, totalCost: 0, totalSales: 0, totalOrders: 0,
            };
          }
          campaignSummaries[src.campaignId].termCount += 1;
          campaignSummaries[src.campaignId].totalCost += src.cost;
          campaignSummaries[src.campaignId].totalSales += src.sales;
          campaignSummaries[src.campaignId].totalOrders += src.orders;
        }
      }

      // Cross-campaign overlap stats
      const overlapTerms = searchTerms.filter(t => t.campaignCount > 1);
      const uniqueTerms = searchTerms.filter(t => t.campaignCount === 1);

      const result = {
        searchTerms,
        categoryStats,
        categories: TWELVE_CATEGORIES,
        thresholds,
        days: datesToQuery.length,
        adType,
        total: searchTerms.length,
        isMock: true,
        // Multi-campaign specific fields
        isMultiCampaign: true,
        campaignCount: input.campaignIds.length,
        campaignSummaries: Object.values(campaignSummaries),
        overlapStats: {
          overlapCount: overlapTerms.length,
          uniqueCount: uniqueTerms.length,
          overlapCost: overlapTerms.reduce((s, t) => s + t.cost, 0),
          overlapSales: overlapTerms.reduce((s, t) => s + t.sales, 0),
        },
        terms: searchTerms, // alias for compatibility
      };

      setCache(cacheKey, result);
      console.log(`[SearchTermsMulti] Completed in ${((Date.now() - startTime) / 1000).toFixed(1)}s, ${searchTerms.length} terms from ${input.campaignIds.length} campaigns`);
      return result;
    }),

// ─── SP广告商品同步（ASIN↔广告活动/广告组映射） ────────────────
  syncSpProductAds: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      state: z.enum(["enabled", "paused", "archived"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 5);

      // Collect all SP + SD product ads across stores
      const allAds: any[] = [];
      const adPaths = [
        { path: "/pb/openapi/newad/spProductAds", type: "SP" },
        { path: "/pb/openapi/newad/sdProductAds", type: "SD" },
      ];
      for (const sid of sidsToQuery) {
        for (const { path: adPath, type: adType } of adPaths) {
          try {
            let offset = 0;
            let hasMore = true;
            while (hasMore && offset < 5000) {
              const res = failUnavailableDataSource();
              const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
              for (const item of items) {
                allAds.push({
                  ...item,
                  sid,
                  adType,
                });
              }
              hasMore = items.length >= 100;
              offset += 100;
            }
          } catch (err: any) {
            console.warn(`[syncProductAds] ${adType} sid=${sid}: ${err.message}`);
          }
        }
      }

      // Build mapping: campaign_id -> { asin[], ad_group_ids[] }
      // and reverse: asin -> { campaign_ids[], ad_group_ids[] }
      const campaignToAsins: Record<string, Set<string>> = {};
      const adGroupToAsins: Record<string, Set<string>> = {};
      const asinToCampaigns: Record<string, Set<string>> = {};
      const asinToAdGroups: Record<string, Set<string>> = {};
      const asinDetails: Record<string, { asin: string; sku: string; state: string; servingStatus: string; adTypes: string[] }> = {};

      for (const ad of allAds) {
        const campaignId = String(ad.campaign_id || '');
        const adGroupId = String(ad.ad_group_id || '');
        const asin = String(ad.asin || '');
        const sku = String(ad.sku || '');
        const adType = ad.adType || 'SP';
        if (!asin) continue;

        // Campaign -> ASINs
        if (!campaignToAsins[campaignId]) campaignToAsins[campaignId] = new Set();
        campaignToAsins[campaignId].add(asin);

        // AdGroup -> ASINs
        if (!adGroupToAsins[adGroupId]) adGroupToAsins[adGroupId] = new Set();
        adGroupToAsins[adGroupId].add(asin);

        // ASIN -> Campaigns
        if (!asinToCampaigns[asin]) asinToCampaigns[asin] = new Set();
        asinToCampaigns[asin].add(campaignId);

        // ASIN -> AdGroups
        if (!asinToAdGroups[asin]) asinToAdGroups[asin] = new Set();
        asinToAdGroups[asin].add(adGroupId);

        // ASIN details (track which ad types this ASIN appears in)
        if (!asinDetails[asin]) {
          asinDetails[asin] = { asin, sku, state: ad.state || '', servingStatus: ad.serving_status || '', adTypes: [adType] };
        } else if (!asinDetails[asin].adTypes.includes(adType)) {
          asinDetails[asin].adTypes.push(adType);
        }
      }

      // Store in cache for quick lookup
      const mapping = {
        campaignToAsins: Object.fromEntries(
          Object.entries(campaignToAsins).map(([k, v]) => [k, Array.from(v)])
        ),
        adGroupToAsins: Object.fromEntries(
          Object.entries(adGroupToAsins).map(([k, v]) => [k, Array.from(v)])
        ),
        asinToCampaigns: Object.fromEntries(
          Object.entries(asinToCampaigns).map(([k, v]) => [k, Array.from(v)])
        ),
        asinToAdGroups: Object.fromEntries(
          Object.entries(asinToAdGroups).map(([k, v]) => [k, Array.from(v)])
        ),
        asinDetails,
        totalAds: allAds.length,
        totalAsins: Object.keys(asinDetails).length,
        totalCampaigns: Object.keys(campaignToAsins).length,
        totalAdGroups: Object.keys(adGroupToAsins).length,
        syncedAt: Date.now(),
      };

      // Cache for 30 minutes
      setCache('spProductAds_mapping', mapping);

      return {
        success: true,
        totalAds: allAds.length,
        totalAsins: Object.keys(asinDetails).length,
        totalCampaigns: Object.keys(campaignToAsins).length,
        totalAdGroups: Object.keys(adGroupToAsins).length,
        isMock: true,
        mapping,
      };
    }),

// ─── 获取ASIN↔广告活动映射关系 ────────────────────────────
  getAsinCampaignMapping: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      forceRefresh: z.boolean().optional(),
    }))
    .query(async ({ input }) => {
      // Try cache first
      if (!input.forceRefresh) {
        const cached = getCached<any>('spProductAds_mapping');
        if (cached) {
          return { ...cached, fromCache: true, isMock: false };
        }
      }

      // Auto-sync if no cache - fetch both SP and SD product ads
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 5);

      const allAds: any[] = [];
      const adPaths = [
        { path: "/pb/openapi/newad/spProductAds", type: "SP" },
        { path: "/pb/openapi/newad/sdProductAds", type: "SD" },
      ];
      for (const sid of sidsToQuery) {
        for (const { path: adPath, type: adType } of adPaths) {
          try {
            let offset = 0;
            let hasMore = true;
            while (hasMore && offset < 5000) {
              const res = failUnavailableDataSource();
              const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
              allAds.push(...items.map((item: any) => ({ ...item, sid, adType })));
              hasMore = items.length >= 100;
              offset += 100;
            }
          } catch (err: any) {
            console.warn(`[getAsinCampaignMapping] ${adType} sid=${sid}: ${err.message}`);
          }
        }
      }

      const campaignToAsins: Record<string, Set<string>> = {};
      const adGroupToAsins: Record<string, Set<string>> = {};
      const asinToCampaigns: Record<string, Set<string>> = {};
      const asinToAdGroups: Record<string, Set<string>> = {};
      const asinDetails: Record<string, { asin: string; sku: string; state: string; servingStatus: string; adTypes: string[] }> = {};

      for (const ad of allAds) {
        const campaignId = String(ad.campaign_id || '');
        const adGroupId = String(ad.ad_group_id || '');
        const asin = String(ad.asin || '');
        const adType = ad.adType || 'SP';
        if (!asin) continue;

        if (!campaignToAsins[campaignId]) campaignToAsins[campaignId] = new Set();
        campaignToAsins[campaignId].add(asin);
        if (!adGroupToAsins[adGroupId]) adGroupToAsins[adGroupId] = new Set();
        adGroupToAsins[adGroupId].add(asin);
        if (!asinToCampaigns[asin]) asinToCampaigns[asin] = new Set();
        asinToCampaigns[asin].add(campaignId);
        if (!asinToAdGroups[asin]) asinToAdGroups[asin] = new Set();
        asinToAdGroups[asin].add(adGroupId);
        if (!asinDetails[asin]) {
          asinDetails[asin] = { asin, sku: ad.sku || '', state: ad.state || '', servingStatus: ad.serving_status || '', adTypes: [adType] };
        } else if (!asinDetails[asin].adTypes.includes(adType)) {
          asinDetails[asin].adTypes.push(adType);
        }
      }

      const mapping = {
        campaignToAsins: Object.fromEntries(
          Object.entries(campaignToAsins).map(([k, v]) => [k, Array.from(v)])
        ),
        adGroupToAsins: Object.fromEntries(
          Object.entries(adGroupToAsins).map(([k, v]) => [k, Array.from(v)])
        ),
        asinToCampaigns: Object.fromEntries(
          Object.entries(asinToCampaigns).map(([k, v]) => [k, Array.from(v)])
        ),
        asinToAdGroups: Object.fromEntries(
          Object.entries(asinToAdGroups).map(([k, v]) => [k, Array.from(v)])
        ),
        asinDetails,
        totalAds: allAds.length,
        totalAsins: Object.keys(asinDetails).length,
        totalCampaigns: Object.keys(campaignToAsins).length,
        totalAdGroups: Object.keys(adGroupToAsins).length,
        syncedAt: Date.now(),
      };

      setCache('spProductAds_mapping', mapping);

      return { ...mapping, fromCache: false, isMock: true };
    }),

// ─── ASIN维度广告汇总看板 ────────────────────────────────────
  getAsinAdSummary: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 5);

      // 1. Get ASIN mapping (from cache or fresh)
      let mapping = getCached<any>('spProductAds_mapping');
      if (!mapping) {
        // Auto-sync
        const allAds: any[] = [];
        const adPaths = [
          { path: "/pb/openapi/newad/spProductAds", type: "SP" },
          { path: "/pb/openapi/newad/sdProductAds", type: "SD" },
        ];
        for (const sid of sidsToQuery) {
          for (const { path: adPath, type: adType } of adPaths) {
            try {
              const res = failUnavailableDataSource();
              const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
              allAds.push(...items.map((item: any) => ({ ...item, sid, adType })));
            } catch (err: any) {
              console.warn(`[AsinAdSummary] ${adType} sid=${sid}: ${err.message}`);
            }
          }
        }
        // Build mapping
        const asinToCampaigns: Record<string, Set<string>> = {};
        const asinDetails: Record<string, { asin: string; sku: string; adTypes: string[] }> = {};
        for (const ad of allAds) {
          const campaignId = String(ad.campaign_id || '');
          const asin = String(ad.asin || '');
          const adType = ad.adType || 'SP';
          if (!asin) continue;
          if (!asinToCampaigns[asin]) asinToCampaigns[asin] = new Set();
          asinToCampaigns[asin].add(campaignId);
          if (!asinDetails[asin]) {
            asinDetails[asin] = { asin, sku: ad.sku || '', adTypes: [adType] };
          } else if (!asinDetails[asin].adTypes.includes(adType)) {
            asinDetails[asin].adTypes.push(adType);
          }
        }
        mapping = {
          asinToCampaigns: Object.fromEntries(
            Object.entries(asinToCampaigns).map(([k, v]) => [k, Array.from(v)])
          ),
          asinDetails,
        };
      }

      // 2. Get campaign hour data for aggregation
      const datesToQuery = resolveDateRange({
        startDate: input.startDate,
        endDate: input.endDate,
        days: 3,
      });

      // Collect all unique campaign IDs from mapping
      const allCampaignIds = new Set<string>();
      for (const cids of Object.values(mapping.asinToCampaigns as Record<string, string[]>)) {
        for (const cid of cids) allCampaignIds.add(cid);
      }

      // Fetch hour data for these campaigns
      const campaignMetrics: Record<string, { impressions: number; clicks: number; cost: number; sales: number; orders: number }> = {};
      const campaignIds = Array.from(allCampaignIds).slice(0, 200);

      // Batch fetch
      const BATCH = 30;
      for (let i = 0; i < campaignIds.length; i += BATCH) {
        const batch = campaignIds.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.flatMap(cid =>
            datesToQuery.map(reportDate =>
              Promise.resolve(failUnavailableDataSource()).then(res => ({ cid, res })).catch(() => null)
            )
          )
        );
        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const { cid, res } = r.value;
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
          for (const item of items) {
            if (!campaignMetrics[cid]) {
              campaignMetrics[cid] = { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
            }
            campaignMetrics[cid].impressions += Number(item.impressions) || 0;
            campaignMetrics[cid].clicks += Number(item.clicks) || 0;
            campaignMetrics[cid].cost += Number(item.cost) || 0;
            campaignMetrics[cid].sales += Number(item.sales) || 0;
            campaignMetrics[cid].orders += Number(item.orders) || 0;
          }
        }
      }

      // 3. Aggregate by ASIN
      const asinSummaries: Array<{
        asin: string; sku: string; adTypes: string[];
        impressions: number; clicks: number; cost: number; sales: number; orders: number;
        acos: number; roas: number; ctr: number; cvr: number; cpc: number;
        campaignCount: number;
      }> = [];

      for (const [asin, detail] of Object.entries(mapping.asinDetails as Record<string, { asin: string; sku: string; adTypes: string[] }>)) {
        const campaignIdsForAsin = (mapping.asinToCampaigns as Record<string, string[]>)[asin] || [];
        let impressions = 0, clicks = 0, cost = 0, sales = 0, orders = 0;
        for (const cid of campaignIdsForAsin) {
          const m = campaignMetrics[cid];
          if (m) {
            impressions += m.impressions;
            clicks += m.clicks;
            cost += m.cost;
            sales += m.sales;
            orders += m.orders;
          }
        }
        const acos = sales > 0 ? Math.round(cost / sales * 10000) / 100 : 0;
        const roas = cost > 0 ? Math.round(sales / cost * 100) / 100 : 0;
        const ctr = impressions > 0 ? Math.round(clicks / impressions * 10000) / 100 : 0;
        const cvr = clicks > 0 ? Math.round(orders / clicks * 10000) / 100 : 0;
        const cpc = clicks > 0 ? Math.round(cost / clicks * 100) / 100 : 0;

        asinSummaries.push({
          asin: detail.asin,
          sku: detail.sku,
          adTypes: detail.adTypes,
          impressions, clicks, cost, sales, orders,
          acos, roas, ctr, cvr, cpc,
          campaignCount: campaignIdsForAsin.length,
        });
      }

      // Sort by cost descending
      asinSummaries.sort((a, b) => b.cost - a.cost);

      // Compute totals
      const totals = asinSummaries.reduce((acc, s) => {
        acc.impressions += s.impressions;
        acc.clicks += s.clicks;
        acc.cost += s.cost;
        acc.sales += s.sales;
        acc.orders += s.orders;
        return acc;
      }, { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 });

      return {
        asins: asinSummaries,
        totals: {
          ...totals,
          acos: totals.sales > 0 ? Math.round(totals.cost / totals.sales * 10000) / 100 : 0,
          roas: totals.cost > 0 ? Math.round(totals.sales / totals.cost * 100) / 100 : 0,
        },
        dateRange: { start: datesToQuery[0], end: datesToQuery[datesToQuery.length - 1], days: datesToQuery.length },
        isMock: true,
      };
    }),

// ─── AI生成否定词列表和加词建议 ──────────────────────────────
  aiGenerateNegativeAndAddKeywords: protectedProcedure
    .input(z.object({
      searchTerms: z.array(z.record(z.string(), z.unknown())).max(200),
      targetAcos: z.number().optional().default(25),
      mode: z.enum(['negative', 'add', 'both']).optional().default('both'),
    }))
    .mutation(async ({ input }) => {
      // Separate terms into negative candidates and add candidates based on category
      const negCandidates: any[] = [];
      const addCandidates: any[] = [];

      for (const t of input.searchTerms) {
        const catId = Number(t.categoryId || t.category_id || 0);
        const cost = Number(t.cost || 0);
        const orders = Number(t.orders || 0);
        const impressions = Number(t.impressions || 0);
        const clicks = Number(t.clicks || 0);
        const acos = Number(t.sales) > 0 ? (cost / Number(t.sales)) * 100 : Infinity;

        // Negative candidates: categories 4,8,10,12 (low efficiency) or high ACoS
        if ([4, 8, 10, 12].includes(catId) || (acos > input.targetAcos * 2 && cost > 5)) {
          negCandidates.push(t);
        }
        // Add candidates: categories 1,3,5,7,9 (high conversion) or good performance
        if ([1, 3, 5, 7, 9].includes(catId) || (orders > 0 && acos < input.targetAcos)) {
          addCandidates.push(t);
        }
      }

      // Anonymize data
      const anonymize = (terms: any[]) => terms.map((t, i) => {
        const { asin, advertised_asin, sku, campaign_id, ad_group_id, ...rest } = t as any;
        return { ...rest, idx: i };
      });



      const response = await invokeBusinessSkill({
        messages: [
          {
            role: "system",
            content: `你是亚马逊PPC广告优化专家。请基于搜索词的12分类结果和数据表现，生成两份操作列表：
1. 否定词列表：需要否定的低效/无效搜索词
2. 加词建议列表：值得投放的高效/潜力搜索词

目标ACoS: ${input.targetAcos}%

对于否定词，请标注否定类型（精准否定 exact 或词组否定 phrase）和优先级。
对于加词，请标注建议匹配类型（exact/phrase/broad）、建议竞价和优先级。

输出严格JSON格式。`
          },
          {
            role: "user",
            content: `分析以下搜索词数据：

否定词候选(${negCandidates.length}个):
${JSON.stringify(anonymize(negCandidates.slice(0, 80)))}

加词候选(${addCandidates.length}个):
${JSON.stringify(anonymize(addCandidates.slice(0, 80)))}

请生成：
1. negative_keywords: 建议否定的搜索词列表
2. add_keywords: 建议投放的搜索词列表
3. summary: 整体操作建议摘要`
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "keyword_action_lists",
            strict: true,
            schema: {
              type: "object",
              properties: {
                negative_keywords: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      term: { type: "string", description: "搜索词" },
                      match_type: { type: "string", description: "否定匹配类型: exact 或 phrase" },
                      reason: { type: "string", description: "否定原因(30字以内)" },
                      priority: { type: "string", description: "优先级: P0/P1/P2" },
                      estimated_save: { type: "number", description: "预估月节省花费($)" },
                    },
                    required: ["term", "match_type", "reason", "priority", "estimated_save"],
                    additionalProperties: false,
                  },
                },
                add_keywords: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      term: { type: "string", description: "搜索词" },
                      match_type: { type: "string", description: "建议匹配类型: exact/phrase/broad" },
                      suggested_bid: { type: "number", description: "建议竞价($)" },
                      reason: { type: "string", description: "加词原因(30字以内)" },
                      priority: { type: "string", description: "优先级: P0/P1/P2" },
                      expected_acos: { type: "number", description: "预估ACoS(%)" },
                    },
                    required: ["term", "match_type", "suggested_bid", "reason", "priority", "expected_acos"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string", description: "整体操作建议摘要" },
              },
              required: ["negative_keywords", "add_keywords", "summary"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      const result = JSON.parse(content);
      return {
        ...result,
        stats: {
          totalTermsAnalyzed: input.searchTerms.length,
          negCandidates: negCandidates.length,
          addCandidates: addCandidates.length,
          negGenerated: result.negative_keywords?.length || 0,
          addGenerated: result.add_keywords?.length || 0,
        },
      };
    })
};
