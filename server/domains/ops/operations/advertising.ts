import { z, TRPCError, protectedProcedure, router, getDb, invokeLLM, inventoryConfig, inventorySnapshots, profitSnapshots, profitAlertRules, adAnalysisTasks, adAutomationRules, searchTermActions, competitorMonitors, competitorSnapshots, competitorReports, lingxingApiLogs, userSettings, asinStatusCache, asinPermissions, asinTagDefinitions, asinTagAssignments, productProfiles, productVariants, lingxingProductWeekly, operatorNameMappings, eq, desc, and, sql, gte, lte, or, MANAGER_ROLES, resolveDataUserId, CacheEntry, adCache, cacheGet, cacheSet, getCacheAge, getDateRange, MARKETPLACE_MAP, filterSidsByMarketplace, getAllSellerSids, getToday, getYesterday, getDateNDaysAgo } from "./context";
import { opsWorkspaceCondition, withOpsWorkspace, workspaceIdFromContext } from "./context";

export const advertisingProcedures = {
// ============== Ads Module ==============
  getAdCampaigns: protectedProcedure
    .input(z.object({
      sid: z.number().optional(),
      reportDate: z.string().optional(), // Single date YYYY-MM-DD, matches Lingxing hour data API
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      marketplace: z.string().optional(),
      adState: z.enum(['all', 'enabled', 'paused', 'archived']).optional().default('all'),
    }))
    .query(async ({ input }) => {
      // Get real SIDs filtered by marketplace
      const { sids: allSids, sellers } = await getAllSellerSids();
      const filteredSids = filterSidsByMarketplace(sellers, input.marketplace);
      let realSid = input.sid || (filteredSids.length > 0 ? Number(filteredSids[0]) : 1);
      const sidsToQuery = input.sid ? [input.sid] : filteredSids.map(Number);
      const marketplaceKey = input.marketplace || 'ALL';
      console.log(`[AdCampaigns] Querying ad campaigns across ${sidsToQuery.length} sids, marketplace=${marketplaceKey}`);
      
      // ─── Cache: Check campaign list cache ─────────────────────────
      const campaignListCacheKey = `ad_campaigns_list_${marketplaceKey}_${input.adState}`;
      const cachedCampaignData = cacheGet<{
        portfolioNameMap: Record<string, any>;
        campaignNameMap: Record<string, any>;
        allCampaignList: any[];
        uniqueCampaignIds: string[];
      }>(campaignListCacheKey);
      const campaignListCacheAge = getCacheAge(campaignListCacheKey);
      let usedCampaignCache = false;
      
      // ─── Step 0: Fetch real portfolios from Lingxing API ───────────
      const portfolioNameMap: Record<string, { name: string; budget: any; state: string; serving_status: string }> = {};
      for (const sid of sidsToQuery) {
        try {
          let offset = 0;
          let hasMore = true;
          while (hasMore) {
            const portfolioRes = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
            const rawPortfolios = portfolioRes.data || [];
            const portfolioList = Array.isArray(rawPortfolios) ? rawPortfolios : (rawPortfolios as any).records || (rawPortfolios as any).list || [];
            console.log(`[AdCampaigns] sid=${sid}: Got ${portfolioList.length} portfolios (offset=${offset})`);
            for (const p of portfolioList) {
              const pid = String(p.portfolio_id);
              if (!portfolioNameMap[pid]) {
                portfolioNameMap[pid] = {
                  name: p.name || `Portfolio ${pid}`,
                  budget: p.budget,
                  state: p.state || 'enabled',
                  serving_status: p.serving_status || '',
                };
              }
            }
            hasMore = portfolioList.length >= 100;
            offset += 100;
          }
        } catch (err: any) {
          console.warn(`[AdCampaigns] sid=${sid}: Failed to get portfolios: ${err.message}`);
        }
      }
      console.log(`[AdCampaigns] Total portfolios found: ${Object.keys(portfolioNameMap).length}`);
      
      // ─── Step 1: Fetch SP + SB + SD campaigns from all stores ──────
      const campaignNameMap: Record<string, any> = {};
      const allCampaignList: any[] = [];
      
      // Helper to fetch campaigns from one API path for all sids
      const fetchCampaignsFromApi = async (
        apiPath: string,
        adType: string,
        extraHeaders?: Record<string, string>,
      ) => {
        for (const sid of sidsToQuery) {
          try {
            let offset = 0;
            let hasMore = true;
            while (hasMore && offset < 2000) {
              const res = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
              const rawCampaigns = res.data || [];
              const campaigns = Array.isArray(rawCampaigns) ? rawCampaigns : (rawCampaigns as any).records || (rawCampaigns as any).list || [];
              console.log(`[AdCampaigns] ${adType} sid=${sid}: Got ${campaigns.length} campaigns (offset=${offset})`);
              for (const c of campaigns) {
                const cid = String(c.campaign_id);
                // Determine budget: SP uses daily_budget, SB/SD use budget
                const dailyBudget = c.daily_budget || c.budget || 0;
                // Determine campaign_type label
                let campaignType = c.campaign_type || '';
                if (adType === 'SP') campaignType = campaignType || 'sponsoredProducts';
                else if (adType === 'SB') campaignType = 'sponsoredBrands';
                else if (adType === 'SD') campaignType = 'sponsoredDisplay';
                
                const portfolioId = c.portfolio_id ? String(c.portfolio_id) : '';
                const portfolioInfo = portfolioId ? portfolioNameMap[portfolioId] : null;
                
                campaignNameMap[cid] = {
                  name: c.name || c.campaign_name || '',
                  daily_budget: dailyBudget,
                  state: c.state || c.status || 'unknown',
                  serving_status: c.serving_status || '',
                  targeting_type: c.targeting_type || (adType === 'SD' ? c.tactic : '') || '',
                  campaign_type: campaignType,
                  start_date: c.start_date || '',
                  portfolio_id: portfolioId,
                  portfolio_name: portfolioInfo?.name || '',
                  ad_type: adType,
                  sid,
                };
                allCampaignList.push({ ...c, campaign_type: campaignType, ad_type: adType, sid });
              }
              hasMore = campaigns.length >= 100;
              offset += 100;
            }
          } catch (err: any) {
            console.warn(`[AdCampaigns] ${adType} sid=${sid}: Failed: ${err.message}`);
          }
        }
      };
      
      // Fetch SP, SB, SD campaigns in parallel (or use cache)
      if (cachedCampaignData) {
        usedCampaignCache = true;
        Object.assign(portfolioNameMap, cachedCampaignData.portfolioNameMap);
        Object.assign(campaignNameMap, cachedCampaignData.campaignNameMap);
        allCampaignList.push(...cachedCampaignData.allCampaignList);
        console.log(`[AdCampaigns] Using cached campaign list (age=${campaignListCacheAge}s): ${allCampaignList.length} campaigns`);
      } else {
        await Promise.allSettled([
          fetchCampaignsFromApi("/pb/openapi/newad/spCampaigns", "SP"),
          fetchCampaignsFromApi("/pb/openapi/newad/hsaCampaigns", "SB"),
          fetchCampaignsFromApi("/pb/openapi/newad/sdCampaigns", "SD", { "X-API-VERSION": "2" }),
        ]);
        // Cache the campaign list for 10 minutes
        cacheSet(campaignListCacheKey, {
          portfolioNameMap: { ...portfolioNameMap },
          campaignNameMap: { ...campaignNameMap },
          allCampaignList: [...allCampaignList],
          uniqueCampaignIds: Array.from(new Set(allCampaignList.map((c: any) => String(c.campaign_id)))),
        }, 10 * 60 * 1000);
        console.log(`[AdCampaigns] Fetched & cached campaign list: ${allCampaignList.length} campaigns`);
      }
      
      console.log(`[AdCampaigns] Total campaigns from SP+SB+SD: ${allCampaignList.length} (SP=${allCampaignList.filter(c=>c.ad_type==='SP').length}, SB=${allCampaignList.filter(c=>c.ad_type==='SB').length}, SD=${allCampaignList.filter(c=>c.ad_type==='SD').length})`);
      
      // ─── Step 2: Get campaign hour data with multi-date range support ─
      let queryDates: string[];
      if (input.startDate && input.endDate) {
        queryDates = getDateRange(input.startDate, input.endDate);
      } else {
        const queryDate = input.reportDate || getDateNDaysAgo(1);
        queryDates = [queryDate];
      }
      // Limit to max 31 days to avoid excessive API calls
      if (queryDates.length > 31) queryDates = queryDates.slice(-31);
      console.log(`[AdCampaigns] Querying hour data for ${queryDates.length} day(s): ${queryDates[0]}${queryDates.length > 1 ? ` to ${queryDates[queryDates.length-1]}` : ''}`);
      const reportMap: Record<string, any> = {};
      const campaignProfileMap: Record<string, string> = {};
      
      const allCampaignIdsForReport = allCampaignList.map((c: any) => String(c.campaign_id));
      const uniqueCampaignIds = Array.from(new Set(allCampaignIdsForReport));
      
      // Query hourly data for top campaigns
      // Prioritize enabled campaigns so they always have data
      const TOP_N_CAMPAIGNS = 100;
      const enabledIds = new Set(allCampaignList.filter((c: any) => c.state === 'enabled').map((c: any) => String(c.campaign_id)));
      const sortedCampaignIds = [
        ...uniqueCampaignIds.filter(id => enabledIds.has(id)),
        ...uniqueCampaignIds.filter(id => !enabledIds.has(id)),
      ];
      const topCampaignIds = sortedCampaignIds.slice(0, TOP_N_CAMPAIGNS);
      console.log(`[AdCampaigns] TOP${TOP_N_CAMPAIGNS} optimization: querying ${topCampaignIds.length} of ${uniqueCampaignIds.length} total campaigns`);
      
      // Batch by date - scale MAX_REPORT_TASKS with date range
      const MAX_REPORT_TASKS = Math.min(topCampaignIds.length * queryDates.length, 2000);
      const reportTasks: { campaignId: string; reportDate: string; adType: string }[] = [];
      let hourCacheHits = 0;
      for (const cid of topCampaignIds) {
        const info = campaignNameMap[cid];
        const adType = info?.ad_type || 'SP';
        for (const reportDate of queryDates) {
          // Check hour data cache first
          const hourCacheKey = `ad_hour_${cid}_${reportDate}`;
          const cachedHour = cacheGet<any>(hourCacheKey);
          if (cachedHour) {
            // Merge cached hour data directly into reportMap
            hourCacheHits++;
            const cid2 = String(cachedHour.campaign_id || cid);
            if (cachedHour.profile_id) campaignProfileMap[cid2] = String(cachedHour.profile_id);
            if (reportMap[cid2]) {
              reportMap[cid2].impressions += cachedHour.impressions || 0;
              reportMap[cid2].clicks += cachedHour.clicks || 0;
              reportMap[cid2].cost += cachedHour.cost || 0;
              reportMap[cid2].sales += cachedHour.sales || 0;
              reportMap[cid2].orders += cachedHour.orders || 0;
            } else {
              reportMap[cid2] = { ...cachedHour };
            }
          } else {
            reportTasks.push({ campaignId: cid, reportDate, adType });
          }
          if (reportTasks.length >= MAX_REPORT_TASKS) break;
        }
        if (reportTasks.length >= MAX_REPORT_TASKS) break;
      }
      console.log(`[AdCampaigns] Hour data: ${hourCacheHits} cache hits, ${reportTasks.length} API tasks needed`);
      
      // Execute in batches of 30 to respect rate limits
      const BATCH_SIZE = 30;
      let rejectedCount = 0;
      let fulfilledCount = 0;
      let totalReportRows = 0;
      let debugCount = 0;
      
      // Map ad_type to hourly data API path
      const hourDataApiPath = (adType: string) => {
        if (adType === 'SB') return '/pb/openapi/newad/sbCampaignHourData';
        if (adType === 'SD') return '/pb/openapi/newad/sdCampaignHourData';
        return '/pb/openapi/newad/spCampaignHourData';
      };
      
      for (let batchStart = 0; batchStart < reportTasks.length; batchStart += BATCH_SIZE) {
        const batch = reportTasks.slice(batchStart, batchStart + BATCH_SIZE);
        const reportResults = await Promise.allSettled(
          batch.map(({ campaignId, reportDate, adType }) => {
            const body = { campaign_id: Number(campaignId), report_date: reportDate };
            const apiPath = hourDataApiPath(adType);
            if (debugCount < 3) {
              debugCount++;
              console.log(`[AdCampaigns] DEBUG HourData request #${debugCount}: path=${apiPath}, body=${JSON.stringify(body)}`);
            }
            return Promise.resolve({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }).then(res => {
              return { campaignId, reportDate, res };
            }).catch(err => {
              console.error(`[AdCampaigns] HourData ERROR cid=${campaignId}: ${err.message}`);
              throw err;
            });
          })
        );
        
        for (const result of reportResults) {
          if (result.status === 'rejected') {
            rejectedCount++;
            continue;
          }
          fulfilledCount++;
          const { campaignId, reportDate, res } = result.value;
          let rawReport = res.data || [];
          // Auto-unwrap nested data: if res.data is {code, data:[...]} instead of array
          if (!Array.isArray(rawReport) && rawReport && Array.isArray((rawReport as any).data)) {
            rawReport = (rawReport as any).data;
          }
          const reportData = Array.isArray(rawReport) ? rawReport : (rawReport as any).records || (rawReport as any).list || [];
          
          // Debug: log first successful response
          if (fulfilledCount === 1 && reportData.length > 0) {
            const sample = reportData[0];
            console.log(`[AdCampaigns] HourData sample keys: ${Object.keys(sample).join(', ')}`);
            console.log(`[AdCampaigns] HourData sample: cost=${sample.cost}, clicks=${sample.clicks}, impressions=${sample.impressions}, sales=${sample.sales}, orders=${sample.orders}`);
          }
          
          // Aggregate hourly data into campaign totals per date
          const perDateAgg: Record<string, any> = {};
          for (const r of reportData) {
            const cid = String(r.campaign_id || campaignId);
            if (r.profile_id) campaignProfileMap[cid] = String(r.profile_id);
            totalReportRows++;
            if (reportMap[cid]) {
              reportMap[cid].impressions += Number(r.impressions) || 0;
              reportMap[cid].clicks += Number(r.clicks) || 0;
              reportMap[cid].cost += Number(r.cost) || 0;
              reportMap[cid].sales += Number(r.sales) || 0;
              reportMap[cid].orders += Number(r.orders) || 0;
            } else {
              reportMap[cid] = {
                impressions: Number(r.impressions) || 0,
                clicks: Number(r.clicks) || 0,
                cost: Number(r.cost) || 0,
                sales: Number(r.sales) || 0,
                orders: Number(r.orders) || 0,
                units: Number(r.units) || 0,
              };
            }
            // Track per-date aggregation for caching
            if (!perDateAgg[cid]) {
              perDateAgg[cid] = { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, units: 0, profile_id: '' };
            }
            perDateAgg[cid].impressions += Number(r.impressions) || 0;
            perDateAgg[cid].clicks += Number(r.clicks) || 0;
            perDateAgg[cid].cost += Number(r.cost) || 0;
            perDateAgg[cid].sales += Number(r.sales) || 0;
            perDateAgg[cid].orders += Number(r.orders) || 0;
            if (r.profile_id) perDateAgg[cid].profile_id = String(r.profile_id);
          }
          // Cache per-campaign per-date aggregated data (30 min TTL)
          for (const [cid, agg] of Object.entries(perDateAgg)) {
            const hourCacheKey = `ad_hour_${cid}_${reportDate}`;
            cacheSet(hourCacheKey, { campaign_id: cid, ...agg }, 30 * 60 * 1000);
          }
        }
      }
      
      console.log(`[AdCampaigns] HourData fetch complete: fulfilled=${fulfilledCount}, rejected=${rejectedCount}, totalHourRows=${totalReportRows}`);
      const reportMapEntries = Object.entries(reportMap);
      console.log(`[AdCampaigns] reportMap has ${reportMapEntries.length} campaigns with data`);
      if (reportMapEntries.length > 0) {
        const [sampleCid, sampleData] = reportMapEntries[0];
        console.log(`[AdCampaigns] reportMap sample cid=${sampleCid}: cost=${sampleData.cost}, sales=${sampleData.sales}, clicks=${sampleData.clicks}, impressions=${sampleData.impressions}`);
      }
      
      // No mock data fallback - only show real data
      // Campaigns without hourly data will show $0 (which is accurate for the queried date)
      const campaignsWithoutData = uniqueCampaignIds.filter(cid => !reportMap[cid]);
      if (campaignsWithoutData.length > 0) {
        console.log(`[AdCampaigns] ${campaignsWithoutData.length} campaigns have no hourly data for ${queryDates.join(',')} (of ${uniqueCampaignIds.length} total)`);
        for (const cid of campaignsWithoutData) {
          reportMap[cid] = {
            impressions: 0,
            clicks: 0,
            cost: 0,
            sales: 0,
            orders: 0,
            units: 0,
          };
        }
      }
      
      // 2.5 Find campaigns in reports that are missing names, try to fetch by profile_id
      const missingCampaignIds = Object.keys(reportMap).filter(cid => !campaignNameMap[cid]);
      if (missingCampaignIds.length > 0) {
        // Use profile_ids collected during report query (no re-query needed)
        const missingProfileIds = new Set<string>();
        for (const cid of missingCampaignIds) {
          const pid = campaignProfileMap[cid];
          if (pid) missingProfileIds.add(pid);
        }
        
        // Query spCampaigns by profile_id for missing campaigns
        for (const profileId of Array.from(missingProfileIds)) {
          try {
            console.log(`[AdCampaigns] Fetching campaigns by profile_id=${profileId} for ${missingCampaignIds.length} missing names`);
            const profileRes = ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } });
            const profileCampaigns = profileRes.data || [];
            const campaigns2 = Array.isArray(profileCampaigns) ? profileCampaigns : (profileCampaigns as any).records || (profileCampaigns as any).list || [];
            console.log(`[AdCampaigns] profile_id=${profileId}: Got ${campaigns2.length} campaigns`);
            for (const c of campaigns2) {
              const cid = String(c.campaign_id);
              if (!campaignNameMap[cid]) {
                campaignNameMap[cid] = {
                  name: c.name || c.campaign_name || '',
                  daily_budget: c.daily_budget || 0,
                  state: c.state || c.status || 'unknown',
                  serving_status: c.serving_status || '',
                  targeting_type: c.targeting_type || '',
                  campaign_type: c.campaign_type || '',
                  start_date: c.start_date || '',
                  portfolio_id: c.portfolio_id || '',
                  portfolio_name: c.portfolio_name || '',
                  sid: 0,
                };
              }
            }
          } catch (err: any) {
            console.warn(`[AdCampaigns] profile_id=${profileId}: Failed: ${err.message}`);
          }
        }
        
        const stillMissing = missingCampaignIds.filter(cid => !campaignNameMap[cid]);
        console.log(`[AdCampaigns] After profile_id lookup: ${missingCampaignIds.length - stillMissing.length} names resolved, ${stillMissing.length} still missing`);
      }
      
      // 3. Merge: start from all unique campaign IDs
      const allCampaignIds = Array.from(new Set([
        ...allCampaignList.map((c: any) => String(c.campaign_id)),
        ...Object.keys(reportMap),
      ]));
      
      const campaigns: any[] = [];
      for (const cid of allCampaignIds) {
        const info = campaignNameMap[cid] || {};
        const report = reportMap[cid] || {};
        const spend = report.cost || 0;
        const sales = report.sales || 0;
        const clicks = report.clicks || 0;
        const impressions = report.impressions || 0;
        const acos = sales > 0 ? Math.round(spend / sales * 10000) / 100 : 0;
        const roas = spend > 0 ? Math.round(sales / spend * 100) / 100 : 0;
        const ctr = impressions > 0 ? Math.round(clicks / impressions * 10000) / 100 : 0;
        const cpc = clicks > 0 ? Math.round(spend / clicks * 100) / 100 : 0;
        
        campaigns.push({
          campaign_id: cid,
          campaign_name: info.name || `Campaign ${cid}`,
          campaign_type: info.campaign_type || 'sponsoredProducts',
          targeting_type: info.targeting_type || '',
          daily_budget: info.daily_budget || 0,
          state: info.state || 'unknown',
          serving_status: info.serving_status || '',
          portfolio_id: info.portfolio_id || '',
          portfolio_name: info.portfolio_name || '',
          impressions,
          clicks,
          spend,
          sales,
          orders: report.orders || 0,
          acos,
          roas,
          ctr,
          cpc,
        });
      }
      
      // Filter by adState if specified
      let filteredCampaigns = campaigns;
      if (input.adState && input.adState !== 'all') {
        filteredCampaigns = campaigns.filter(c => c.state === input.adState);
      }
      
      // Sort by spend descending
      filteredCampaigns.sort((a, b) => b.spend - a.spend);
      
      // Build Portfolio+Campaign two-level structure
      // Use portfolioNameMap (from portfolios API) for authoritative names
      const portfolioMap: Record<string, { id: string; name: string; campaigns: any[]; impressions: number; clicks: number; spend: number; sales: number; orders: number }> = {};
      for (const c of filteredCampaigns) {
        const pid = c.portfolio_id || 'ungrouped';
        // Resolve portfolio name: 1) from portfolios API, 2) from campaign data, 3) fallback
        const pname = (pid !== 'ungrouped' && portfolioNameMap[pid]?.name) || c.portfolio_name || (pid === 'ungrouped' ? '未分组' : `Portfolio ${pid}`);
        if (!portfolioMap[pid]) {
          portfolioMap[pid] = { id: pid, name: pname, campaigns: [], impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
        }
        portfolioMap[pid].campaigns.push(c);
        portfolioMap[pid].impressions += c.impressions;
        portfolioMap[pid].clicks += c.clicks;
        portfolioMap[pid].spend += c.spend;
        portfolioMap[pid].sales += c.sales;
        portfolioMap[pid].orders += c.orders;
      }
      // Convert to array and compute portfolio-level metrics
      const portfolios = Object.values(portfolioMap).map(p => ({
        ...p,
        acos: p.sales > 0 ? Math.round(p.spend / p.sales * 10000) / 100 : 0,
        roas: p.spend > 0 ? Math.round(p.sales / p.spend * 100) / 100 : 0,
        ctr: p.impressions > 0 ? Math.round(p.clicks / p.impressions * 10000) / 100 : 0,
        cpc: p.clicks > 0 ? Math.round(p.spend / p.clicks * 100) / 100 : 0,
        campaignCount: p.campaigns.length,
      })).sort((a, b) => b.spend - a.spend);
      
      // Debug: show merge result
      const withData = filteredCampaigns.filter(c => c.spend > 0);
      const withoutData = filteredCampaigns.filter(c => c.spend === 0);
      console.log(`[AdCampaigns] Final: ${filteredCampaigns.length} campaigns in ${portfolios.length} portfolios (state=${input.adState}), ${withData.length} with spend data, ${withoutData.length} with $0`);
      if (withData.length > 0) {
        console.log(`[AdCampaigns] Sample campaign with data: cid=${withData[0].campaign_id}, name=${withData[0].campaign_name}, spend=${withData[0].spend}`);
      }
      if (withoutData.length > 0) {
        console.log(`[AdCampaigns] Sample campaign WITHOUT data: cid=${withoutData[0].campaign_id}, name=${withoutData[0].campaign_name}`);
        // Check if this campaign_id exists in reportMap
        const sampleCid = withoutData[0].campaign_id;
        console.log(`[AdCampaigns] reportMap[${sampleCid}] = ${JSON.stringify(reportMap[sampleCid])}`);
      }
      return {
        campaigns: filteredCampaigns,
        allCampaigns: campaigns,
        portfolios,
        isMock: true,
        dateRange: { startDate: queryDates[0], endDate: queryDates[queryDates.length - 1], days: queryDates.length },
        cacheInfo: {
          campaignListCached: usedCampaignCache,
          campaignListCacheAge: campaignListCacheAge,
          hourDataCacheHits: hourCacheHits,
          hourDataApiCalls: reportTasks.length,
        },
      };
    }),

getSearchTerms: protectedProcedure
    .input(z.object({
      sid: z.number().optional(),
      campaignId: z.number().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      days: z.number().optional(), // aggregate over N days (default 7)
      marketplace: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const { sids: allSids, sellers } = await getAllSellerSids();
      const filteredSids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = input.sid ? [input.sid] : filteredSids.map(Number);
      const days = input.days || 7;
      
      // Aggregate search terms over multiple days for more reliable data
      const termAggMap: Record<string, {
        query: string;
        target_text: string;
        match_type: string;
        campaign_id: string;
        ad_group_id: string;
        impressions: number;
        clicks: number;
        cost: number;
        sales: number;
        orders: number;
        units: number;
        days_seen: number;
      }> = {};
      
      // Parallel: build all sid+day combos and fetch concurrently
      const termTasks = sidsToQuery.flatMap(sid =>
        Array.from({ length: days }, (_, i) => ({ sid, reportDate: getDateNDaysAgo(i + 1) }))
      );
      console.log(`[SearchTerms] Fetching ${termTasks.length} search term tasks in parallel (${sidsToQuery.length} sids x ${days} days)`);
      const termResults = await Promise.allSettled(
        termTasks.map(({ sid, reportDate }) =>
          Promise.resolve({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }).then(res => ({ sid, reportDate, res }))
        )
      );
      for (const result of termResults) {
        if (result.status === 'rejected') continue;
        const { res } = result.value;
        const rawData = res.data || [];
        const items = Array.isArray(rawData) ? rawData : (rawData as any).records || (rawData as any).list || [];
        for (const item of items) {
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
      console.log(`[SearchTerms] Parallel fetch complete: ${termResults.filter(r => r.status === 'fulfilled').length}/${termTasks.length} succeeded`);
      
      // Convert to array and compute derived metrics
      const searchTerms = Object.values(termAggMap).map(t => {
        const acos = t.sales > 0 ? Math.round(t.cost / t.sales * 10000) / 100 : (t.cost > 0 ? 999 : 0);
        const ctr = t.impressions > 0 ? Math.round(t.clicks / t.impressions * 10000) / 100 : 0;
        const cpc = t.clicks > 0 ? Math.round(t.cost / t.clicks * 100) / 100 : 0;
        const convRate = t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : 0;
        
        // Auto-classify search terms
        let category: 'high_performer' | 'low_performer' | 'potential' | 'waste' | 'new_term' = 'new_term';
        if (t.clicks < 3 && t.cost < 2) {
          category = 'new_term'; // Too little data
        } else if (t.orders > 0 && acos <= 25) {
          category = 'high_performer';
        } else if (t.orders > 0 && acos > 25 && acos <= 50) {
          category = 'potential';
        } else if (t.cost >= 5 && t.orders === 0) {
          category = 'waste';
        } else if (acos > 50) {
          category = 'low_performer';
        } else {
          category = 'potential';
        }
        
        return {
          ...t,
          acos,
          ctr,
          cpc,
          convRate,
          category,
        };
      });
      
      // Sort by cost descending (highest spend first)
      searchTerms.sort((a, b) => b.cost - a.cost);
      
      // Compute category stats
      const categoryStats = {
        high_performer: searchTerms.filter(t => t.category === 'high_performer').length,
        potential: searchTerms.filter(t => t.category === 'potential').length,
        low_performer: searchTerms.filter(t => t.category === 'low_performer').length,
        waste: searchTerms.filter(t => t.category === 'waste').length,
        new_term: searchTerms.filter(t => t.category === 'new_term').length,
        total: searchTerms.length,
      };
      
      console.log(`[SearchTerms] Aggregated ${searchTerms.length} unique terms over ${days} days. Categories: ${JSON.stringify(categoryStats)}`);
      return { searchTerms, categoryStats, days, isMock: true };
    }),

aiSearchTermAnalysis: protectedProcedure
    .input(z.object({
      searchTerms: z.array(z.record(z.string(), z.unknown())).max(100),
    }))
    .mutation(async ({ input }) => {

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是亚马逊PPC广告优化AI专家。分析搜索词数据并给出操作建议。输出严格JSON格式。" },
          { role: "user", content: `分析以下搜索词数据（已按花费降序排列），为每个搜索词给出操作建议。

搜索词数据（包含关键指标）：
${JSON.stringify(input.searchTerms.map(t => ({
  query: (t as any).query,
  impressions: (t as any).impressions,
  clicks: (t as any).clicks,
  cost: (t as any).cost,
  sales: (t as any).sales,
  orders: (t as any).orders,
  acos: (t as any).acos,
  ctr: (t as any).ctr,
  convRate: (t as any).convRate,
  category: (t as any).category,
  match_type: (t as any).match_type,
})))}

对每个搜索词，结合其分类(category)和关键指标，判断应该执行的操作：
- add_exact: 高转化词，建议添加为精确匹配关键词
- add_phrase: 相关性好的词，建议添加为词组匹配
- negate_exact: 无关词，建议否定精确匹配
- negate_phrase: 无关词组，建议否定词组匹配
- increase_bid: 表现好但曝光不足，建议提高出价
- decrease_bid: ACoS过高，建议降低出价
- keep: 表现正常，保持不变
- monitor: 数据不足，继续观察

判断标准：
- category=high_performer (ACoS≤25%且有转化) → add_exact 或 increase_bid
- category=potential (ACoS 25-50%有转化) → keep 或 decrease_bid
- category=low_performer (ACoS>50%) → decrease_bid 或 negate
- category=waste (花费>$5无转化) → negate_exact
- category=new_term (数据不足) → monitor
- 特别注意：花费最高的词需要重点分析，给出具体的出价调整建议

请同时给出整体分析总结和核心机会点。` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "search_term_analysis",
            strict: true,
            schema: {
              type: "object",
              properties: {
                analysis: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      search_term: { type: "string" },
                      suggested_action: { type: "string" },
                      reason: { type: "string" },
                      confidence: { type: "string" },
                      estimated_impact: { type: "string" },
                    },
                    required: ["search_term", "suggested_action", "reason", "confidence", "estimated_impact"],
                    additionalProperties: false,
                  },
                },
                summary: { type: "string" },
                topOpportunities: {
                  type: "array",
                  items: { type: "string" },
                },
              },
              required: ["analysis", "summary", "topOpportunities"],
              additionalProperties: false,
            },
          },
        },
      });

      const content = response.choices?.[0]?.message?.content as string;
      return JSON.parse(content);
    }),

// Save search term actions (after user reviews AI suggestions)
  saveSearchTermActions: protectedProcedure
    .input(z.object({
      actions: z.array(z.object({
        searchTerm: z.string(),
        keywordText: z.string().optional(),
        matchType: z.string().optional(),
        suggestedAction: z.enum(["add_exact", "add_phrase", "negate_exact", "negate_phrase", "increase_bid", "decrease_bid", "keep", "monitor"]),
        aiReason: z.string().optional(),
        metrics: z.record(z.string(), z.unknown()).optional(),
        userDecision: z.enum(["accepted", "rejected", "modified", "pending"]).optional(),
        userNotes: z.string().optional(),
      })),
      analysisTaskId: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      const values = input.actions.map(a => withOpsWorkspace(workspaceIdFromContext(ctx), {
        userId: ctx.user.id,
        analysisTaskId: input.analysisTaskId,
        searchTerm: a.searchTerm,
        keywordText: a.keywordText,
        matchType: a.matchType,
        suggestedAction: a.suggestedAction,
        aiReason: a.aiReason,
        metrics: a.metrics,
        userDecision: a.userDecision || ("pending" as const),
        userNotes: a.userNotes,
      }));

      for (const v of values) {
        await db!.insert(searchTermActions).values(v);
      }
      return { saved: values.length };
    }),

// Ad automation rules CRUD
  getAdRules: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    return db!.select().from(adAutomationRules)
      .where(opsWorkspaceCondition(adAutomationRules, workspaceIdFromContext(ctx), eq(adAutomationRules.userId, ctx.user.id)))
      .orderBy(desc(adAutomationRules.createdAt));
  }),

saveAdRule: protectedProcedure
    .input(z.object({
      id: z.number().optional(),
      ruleName: z.string().min(1),
      ruleType: z.enum(["negate_keyword", "add_keyword", "adjust_bid", "pause_campaign", "enable_campaign", "adjust_budget", "custom"]),
      condition: z.record(z.string(), z.unknown()),
      action: z.record(z.string(), z.unknown()),
      scope: z.record(z.string(), z.unknown()).optional(),
      isActive: z.number().optional().default(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (input.id) {
        await db!.update(adAutomationRules)
          .set({
            ruleName: input.ruleName,
            ruleType: input.ruleType,
            condition: input.condition,
            action: input.action,
            scope: input.scope,
            isActive: input.isActive,
          })
          .where(opsWorkspaceCondition(adAutomationRules, workspaceIdFromContext(ctx), and(eq(adAutomationRules.id, input.id), eq(adAutomationRules.userId, ctx.user.id))));
        return { id: input.id, updated: true };
      } else {
        const [result] = await db!.insert(adAutomationRules).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
          userId: ctx.user.id,
          ruleName: input.ruleName,
          ruleType: input.ruleType,
          condition: input.condition,
          action: input.action,
          scope: input.scope,
          isActive: input.isActive,
        }));
        return { id: result.insertId, updated: false };
      }
    }),

deleteAdRule: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      await db!.delete(adAutomationRules)
        .where(opsWorkspaceCondition(adAutomationRules, workspaceIdFromContext(ctx), and(eq(adAutomationRules.id, input.id), eq(adAutomationRules.userId, ctx.user.id))));
      return { deleted: true };
    })
};
