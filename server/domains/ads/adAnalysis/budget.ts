import { failUnavailableDataSource } from "@shared/_core/errors";
import { z, invokeLLM, protectedProcedure, router, getDb, eq, desc, and, sql, budgetTracking, ClassificationThresholds, DEFAULT_THRESHOLDS, TWELVE_CATEGORIES, classifySearchTerm, anonymizeForAI, deAnonymizeResults, _queryCache, CACHE_TTL, getCached, setCache, parallelBatch, getDateNDaysAgo, getDatesInRange, resolveDateRange, getAllSellerSids, MARKETPLACE_MAP, filterSidsByMarketplace } from "./context";
import { opsWorkspaceCondition, withOpsWorkspace, workspaceIdFromContext } from "./context";

export const budgetProcedures = {
// ─── AI预算智能分配 ──────────────────────────────────────────
  aiBudgetAllocation: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      reportDate: z.string().optional(),
      startDate: z.string().optional(),
      endDate: z.string().optional(),
      totalBudget: z.number().optional(),
      targetAcos: z.number().optional().default(25),
    }))
    .mutation(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 5);

      const datesToQuery = resolveDateRange({
        startDate: input.startDate,
        endDate: input.endDate,
        days: 7,
      });

      // Fetch SP campaigns
      const campaigns: any[] = [];
      for (const sid of sidsToQuery) {
        try {
          const res = failUnavailableDataSource();
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
          campaigns.push(...items.map((c: any) => ({ ...c, sid })));
        } catch (err: any) {
          console.warn(`[BudgetAlloc] SP campaigns sid=${sid}: ${err.message}`);
        }
      }

      // Get ASIN mapping
      const mapping = getCached<any>('spProductAds_mapping');
      const asinToCampaigns: Record<string, string[]> = mapping?.asinToCampaigns || {};

      // Build campaign perf map
      const campaignPerf: Record<string, {
        name: string; budget: number; status: string;
        impressions: number; clicks: number; cost: number; sales: number; orders: number;
        asin: string;
      }> = {};

      for (const c of campaigns) {
        const cid = String(c.campaign_id || c.id || '');
        const isPaused = ['paused', 'archived', 'suspended'].includes((c.status || c.state || '').toLowerCase());
        campaignPerf[cid] = {
          name: c.name || c.campaign_name || '',
          budget: Number(c.daily_budget || c.budget || 0),
          status: isPaused ? 'paused' : 'active',
          impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0,
          asin: '',
        };
      }

      for (const [asin, cids] of Object.entries(asinToCampaigns)) {
        for (const cid of cids) {
          if (campaignPerf[cid]) campaignPerf[cid].asin = asin;
        }
      }

      // Fetch hour data
      const campaignIds = Object.keys(campaignPerf).slice(0, 100);
      const BATCH = 20;
      for (let i = 0; i < campaignIds.length; i += BATCH) {
        const batch = campaignIds.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.flatMap(cid =>
            datesToQuery.slice(0, 3).map(reportDate =>
              Promise.resolve(failUnavailableDataSource()).then(res => ({ cid, res })).catch(() => null)
            )
          )
        );
        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const { cid, res } = r.value;
          const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
          for (const item of items) {
            if (!campaignPerf[cid]) continue;
            campaignPerf[cid].impressions += Number(item.impressions) || 0;
            campaignPerf[cid].clicks += Number(item.clicks) || 0;
            campaignPerf[cid].cost += Number(item.cost) || 0;
            campaignPerf[cid].sales += Number(item.sales) || 0;
            campaignPerf[cid].orders += Number(item.orders) || 0;
          }
        }
      }

      // Build summaries for AI
      const campaignSummaries = Object.entries(campaignPerf)
        .filter(([_, c]) => c.status === 'active')
        .map(([cid, c]) => {
          const acos = c.sales > 0 ? Math.round(c.cost / c.sales * 10000) / 100 : (c.cost > 0 ? 999 : 0);
          const roas = c.cost > 0 ? Math.round(c.sales / c.cost * 100) / 100 : 0;
          return { campaignId: cid, name: c.name, asin: c.asin, currentBudget: c.budget, cost: Math.round(c.cost * 100) / 100, sales: Math.round(c.sales * 100) / 100, orders: c.orders, impressions: c.impressions, clicks: c.clicks, acos, roas };
        })
        .sort((a, b) => b.cost - a.cost)
        .slice(0, 30);

      const totalCurrentBudget = campaignSummaries.reduce((s, c) => s + c.currentBudget, 0);
      const totalCost = campaignSummaries.reduce((s, c) => s + c.cost, 0);
      const totalSales = campaignSummaries.reduce((s, c) => s + c.sales, 0);
      const overallAcos = totalSales > 0 ? Math.round(totalCost / totalSales * 10000) / 100 : 0;

      try {
        // Emperor Skill 优先 - 预算分配
        const budgetCtx = `总预算:$${totalCurrentBudget}/天 | 总花费:$${totalCost} | 总销售:$${totalSales} | ACoS:${overallAcos}% | 目标ACoS:${input.targetAcos}%\n各活动：\n${campaignSummaries.map((c, i) => `${i+1}. [${c.name}] 预算:$${c.currentBudget}/天 | 花费:$${c.cost} | 销售:$${c.sales} | ACoS:${c.acos}% | ROAS:${c.roas}x`).join('\n')}`;
      } catch (emperorBudgetErr) {
      }

      try {
        const llmRes = await invokeLLM({
          messages: [
            { role: 'system', content: '你是亚马逊广告预算优化AI助手。请严格按JSON格式输出分析结果。' },
            { role: 'user', content: `你是资深亚马逊广告优化专家。基于以下数据提供预算调整建议。\n\n总预算:$${totalCurrentBudget}/天 | 总花费:$${totalCost} | 总销售:$${totalSales} | ACoS:${overallAcos}% | 目标ACoS:${input.targetAcos}%\n\n各活动:\n${campaignSummaries.map((c, i) => `${i+1}. [${c.name}] ASIN:${c.asin||'未知'} | 预算:$${c.currentBudget}/天 | 花费:$${c.cost} | 销售:$${c.sales} | ACoS:${c.acos}% | ROAS:${c.roas}x | 订单:${c.orders}`).join('\n')}\n\n调整原则：1.ACoS低且出单好→加预算 2.ACoS远超目标→减预算或暂停 3.数据不足→维持观察 4.总预算变动控制在±20%` },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'budget_allocation',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  overall_analysis: { type: 'string' },
                  total_suggested_budget: { type: 'number' },
                  campaigns: { type: 'array', items: { type: 'object', properties: { campaignId: { type: 'string' }, name: { type: 'string' }, action: { type: 'string' }, currentBudget: { type: 'number' }, suggestedBudget: { type: 'number' }, changePercent: { type: 'number' }, reason: { type: 'string' }, priority: { type: 'string' }, expectedAcos: { type: 'number' } }, required: ['campaignId', 'name', 'action', 'currentBudget', 'suggestedBudget', 'changePercent', 'reason', 'priority', 'expectedAcos'], additionalProperties: false } },
                  key_insights: { type: 'array', items: { type: 'string' } },
                },
                required: ['overall_analysis', 'total_suggested_budget', 'campaigns', 'key_insights'],
                additionalProperties: false,
              },
            },
          },
        });

        const result = JSON.parse(String(llmRes.choices[0].message.content) || '{}');
        return {
          allocation: result,
          campaignData: campaignSummaries,
          totals: { totalCurrentBudget, totalCost, totalSales, overallAcos },
          dateRange: { start: datesToQuery[0], end: datesToQuery[datesToQuery.length - 1], days: datesToQuery.length },
          isMock: true,
        };
      } catch (err: any) {
        console.error('[BudgetAlloc] AI error:', err.message);
        return {
          allocation: null,
          campaignData: campaignSummaries,
          totals: { totalCurrentBudget, totalCost, totalSales, overallAcos },
          dateRange: { start: datesToQuery[0], end: datesToQuery[datesToQuery.length - 1], days: datesToQuery.length },
          isMock: true,
          error: 'AI分析暂时不可用，请稍后重试',
        };
      }
    }),

// ─── 搜索词趋势对比 ──────────────────────────────────────────
  getSearchTermTrend: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      campaignIds: z.array(z.string()).optional(),
      marketplace: z.string().optional(),
      periods: z.array(z.object({
        label: z.string(),
        startDate: z.string(),
        endDate: z.string(),
      })).min(2).max(4),
      adType: z.enum(['SP', 'SB']).optional().default('SP'),
      topN: z.number().optional().default(20),
    }))
    .query(async ({ input }) => {
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);

      const effectiveCampaignIds = (input.campaignIds && input.campaignIds.length > 0)
        ? input.campaignIds
        : (input.campaignId ? [input.campaignId] : []);
      const campaignIdSet = new Set(effectiveCampaignIds);
      const hasCampaignFilter = effectiveCampaignIds.length > 0;

      const searchTermApiPath = input.adType === 'SB'
        ? '/pb/openapi/newad/hsaQueryWordReports'
        : '/pb/openapi/newad/queryWordReports';

      const periodResults: Array<{
        label: string; startDate: string; endDate: string;
        terms: Record<string, { query: string; impressions: number; clicks: number; cost: number; sales: number; orders: number }>;
      }> = [];

      for (const period of input.periods) {
        const dates = getDatesInRange(period.startDate, period.endDate);
        const termMap: Record<string, { query: string; impressions: number; clicks: number; cost: number; sales: number; orders: number }> = {};

        const tasks: (() => Promise<any[]>)[] = [];
        for (const sid of sidsToQuery) {
          for (const reportDate of dates.slice(0, 7)) {
            tasks.push(async () => {
              try {
                const res = failUnavailableDataSource();
                return Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
              } catch { return []; }
            });
          }
        }

        const allResults = await parallelBatch(tasks, 5);
        for (const items of allResults) {
          for (const item of items) {
            if (hasCampaignFilter && item.campaign_id && !campaignIdSet.has(String(item.campaign_id))) continue;
            const q = (item.query || '').toLowerCase().trim();
            if (!q) continue;
            if (termMap[q]) {
              termMap[q].impressions += Number(item.impressions) || 0;
              termMap[q].clicks += Number(item.clicks) || 0;
              termMap[q].cost += Number(item.cost) || 0;
              termMap[q].sales += Number(item.sales) || 0;
              termMap[q].orders += Number(item.orders) || 0;
            } else {
              termMap[q] = { query: item.query || '', impressions: Number(item.impressions) || 0, clicks: Number(item.clicks) || 0, cost: Number(item.cost) || 0, sales: Number(item.sales) || 0, orders: Number(item.orders) || 0 };
            }
          }
        }

        periodResults.push({ label: period.label, startDate: period.startDate, endDate: period.endDate, terms: termMap });
      }

      // Find top N terms by total cost
      const allTermCosts: Record<string, number> = {};
      for (const pr of periodResults) {
        for (const [q, t] of Object.entries(pr.terms)) {
          allTermCosts[q] = (allTermCosts[q] || 0) + t.cost;
        }
      }
      const topTerms = Object.entries(allTermCosts).sort((a, b) => b[1] - a[1]).slice(0, input.topN).map(([q]) => q);

      // Build comparison
      const trendData = topTerms.map(q => {
        const periods = periodResults.map(pr => {
          const t = pr.terms[q];
          if (!t) return { label: pr.label, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, acos: 0, ctr: 0, cvr: 0 };
          const acos = t.sales > 0 ? Math.round(t.cost / t.sales * 10000) / 100 : (t.cost > 0 ? 999 : 0);
          const ctr = t.impressions > 0 ? Math.round(t.clicks / t.impressions * 10000) / 100 : 0;
          const cvr = t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : 0;
          return { label: pr.label, impressions: t.impressions, clicks: t.clicks, cost: Math.round(t.cost * 100) / 100, sales: Math.round(t.sales * 100) / 100, orders: t.orders, acos, ctr, cvr };
        });
        const first = periods[0];
        const last = periods[periods.length - 1];
        const costChange = first.cost > 0 ? Math.round((last.cost - first.cost) / first.cost * 10000) / 100 : 0;
        const salesChange = first.sales > 0 ? Math.round((last.sales - first.sales) / first.sales * 10000) / 100 : 0;
        const impressionChange = first.impressions > 0 ? Math.round((last.impressions - first.impressions) / first.impressions * 10000) / 100 : 0;
        return { query: q, periods, trends: { costChange, salesChange, impressionChange } };
      });

      const periodTotals = periodResults.map(pr => {
        let impressions = 0, clicks = 0, cost = 0, sales = 0, orders = 0;
        for (const t of Object.values(pr.terms)) { impressions += t.impressions; clicks += t.clicks; cost += t.cost; sales += t.sales; orders += t.orders; }
        const acos = sales > 0 ? Math.round(cost / sales * 10000) / 100 : 0;
        return { label: pr.label, startDate: pr.startDate, endDate: pr.endDate, impressions, clicks, cost: Math.round(cost * 100) / 100, sales: Math.round(sales * 100) / 100, orders, acos, termCount: Object.keys(pr.terms).length };
      });

      return { trendData, periodTotals, topTerms, isMock: true };
    }),

// ─── ASIN映射自动预热（静默后台执行） ─────────────────────────
  warmupAsinMapping: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }))
    .mutation(async ({ input }) => {
      const cacheKey = `asin_mapping_${input.marketplace || 'all'}`;
      const cached = getCached(cacheKey);
      if (cached) {
        return { status: 'cached', asinCount: Object.keys((cached as any).mapping || {}).length };
      }

      // Trigger mapping build in background (same logic as syncSpProductAds)
      try {
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
              const res = failUnavailableDataSource();
              const raw = res.data || [];
              const records = Array.isArray(raw) ? raw : (raw as any).records || (raw as any).list || [];
              records.forEach((r: any) => { r._adType = adType; r._sid = sid; });
              allAds.push(...records);
            } catch { /* skip */ }
          }
        }

        // Build mapping
        const mapping: Record<string, { campaignIds: string[]; adTypes: string[] }> = {};
        for (const ad of allAds) {
          const asin = String(ad.asin || ad.advertised_asin || '').trim();
          const campaignId = String(ad.campaign_id || '');
          const adType = ad._adType || 'SP';
          if (!asin || !campaignId) continue;
          if (!mapping[asin]) mapping[asin] = { campaignIds: [], adTypes: [] };
          if (!mapping[asin].campaignIds.includes(campaignId)) mapping[asin].campaignIds.push(campaignId);
          if (!mapping[asin].adTypes.includes(adType)) mapping[asin].adTypes.push(adType);
        }

        setCache(cacheKey, { mapping, totalAds: allAds.length, sidsQueried: sidsToQuery.length });

        return { status: 'refreshed', asinCount: Object.keys(mapping).length, totalAds: allAds.length };
      } catch (err: any) {
        console.warn('[WarmupAsinMapping] Failed:', err.message);
        return { status: 'error', asinCount: 0, error: err.message };
      }
    }),

// ─── 保存预算决策记录 ────────────────────────────────
  saveBudgetDecision: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional().default('US'),
      totalBudgetBefore: z.number(),
      totalBudgetAfter: z.number(),
      campaignCount: z.number(),
      baselineSpend: z.number(),
      baselineSales: z.number(),
      baselineAcos: z.number(),
      baselineRoas: z.number(),
      baselineOrders: z.number(),
      userDecision: z.enum(['accepted', 'modified', 'rejected', 'partial']),
      userNotes: z.string().optional(),
      campaignDecisions: z.array(z.object({
        campaignId: z.string(),
        campaignName: z.string(),
        action: z.string(),
        currentBudget: z.number(),
        suggestedBudget: z.number(),
        confirmedBudget: z.number(),
        reason: z.string(),
        priority: z.string(),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      const batchId = `BT_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      await db!.insert(budgetTracking).values(withOpsWorkspace(workspaceIdFromContext(ctx), {
        userId: ctx.user.id,
        marketplace: input.marketplace,
        batchId,
        totalBudgetBefore: String(input.totalBudgetBefore),
        totalBudgetAfter: String(input.totalBudgetAfter),
        campaignCount: input.campaignCount,
        baselineSpend: String(input.baselineSpend),
        baselineSales: String(input.baselineSales),
        baselineAcos: String(input.baselineAcos),
        baselineRoas: String(input.baselineRoas),
        baselineOrders: input.baselineOrders,
        userDecision: input.userDecision,
        userNotes: input.userNotes || null,
        campaignDecisions: JSON.stringify(input.campaignDecisions),
      }));
      return { success: true, batchId };
    }),

// ─── 查询预算追踪历史 ────────────────────────────────
  getBudgetTrackingHistory: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      limit: z.number().optional().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      let query = db!.select().from(budgetTracking)
        .where(opsWorkspaceCondition(budgetTracking, workspaceIdFromContext(ctx), eq(budgetTracking.userId, ctx.user.id)))
        .orderBy(desc(budgetTracking.createdAt))
        .limit(input.limit);
      const records = await query;
      return {
        records: records.map((r: any) => ({
          ...r,
          totalBudgetBefore: Number(r.totalBudgetBefore) || 0,
          totalBudgetAfter: Number(r.totalBudgetAfter) || 0,
          baselineSpend: Number(r.baselineSpend) || 0,
          baselineSales: Number(r.baselineSales) || 0,
          baselineAcos: Number(r.baselineAcos) || 0,
          baselineRoas: Number(r.baselineRoas) || 0,
          followupSpend: Number(r.followupSpend) || 0,
          followupSales: Number(r.followupSales) || 0,
          followupAcos: Number(r.followupAcos) || 0,
          followupRoas: Number(r.followupRoas) || 0,
          campaignDecisions: r.campaignDecisions ? JSON.parse(r.campaignDecisions as string) : [],
        })),
      };
    }),

// ─── 评估预算执行效果 ────────────────────────────────
  evaluateBudgetEffect: protectedProcedure
    .input(z.object({
      trackingId: z.number(),
      marketplace: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDb();
      // Get the tracking record
      const [record] = await db!.select().from(budgetTracking)
        .where(opsWorkspaceCondition(budgetTracking, workspaceIdFromContext(ctx), and(eq(budgetTracking.id, input.trackingId), eq(budgetTracking.userId, ctx.user.id))))
        .limit(1);
      if (!record) throw new Error('记录不存在');

      const decisions = record.campaignDecisions ? JSON.parse(record.campaignDecisions as string) : [];
      const campaignIds = decisions.map((d: any) => d.campaignId).filter(Boolean);
      if (campaignIds.length === 0) return { success: false, error: '无广告活动数据' };

      // Fetch current performance data for these campaigns
      let totalSpend = 0, totalSales = 0, totalOrders = 0;

      // Get recent 7 days data
      const dates = resolveDateRange({ days: 7 });
      const BATCH = 10;
      for (let i = 0; i < campaignIds.length; i += BATCH) {
        const batch = campaignIds.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.flatMap((cid: string) =>
            dates.slice(0, 3).map(reportDate =>
              Promise.resolve(failUnavailableDataSource()).then(res => ({ cid, res })).catch(() => null)
            )
          )
        );
        for (const r of results) {
          if (r.status !== 'fulfilled' || !r.value) continue;
          const items = Array.isArray(r.value.res.data) ? r.value.res.data : (r.value.res.data as any)?.records || [];
          for (const item of items) {
            totalSpend += Number(item.cost) || 0;
            totalSales += Number(item.sales) || 0;
            totalOrders += Number(item.orders) || 0;
          }
        }
      }

      const followupAcos = totalSales > 0 ? Math.round(totalSpend / totalSales * 10000) / 100 : 0;
      const followupRoas = totalSpend > 0 ? Math.round(totalSales / totalSpend * 100) / 100 : 0;

      // AI evaluate the effect
      const baseAcos = Number(record.baselineAcos) || 0;
      const baseRoas = Number(record.baselineRoas) || 0;
      const acosChange = baseAcos > 0 ? Math.round((followupAcos - baseAcos) / baseAcos * 100) : 0;
      const roasChange = baseRoas > 0 ? Math.round((followupRoas - baseRoas) / baseRoas * 100) : 0;

      let effectSummary = '';
      let effectScore = 50;
      try {
        // Emperor Skill 优先 - 广告诊断
        const effectCtx = `基线数据：花费$${Number(record.baselineSpend)||0} | 销售$${Number(record.baselineSales)||0} | ACoS:${baseAcos}% | ROAS:${baseRoas}x\n执行后：花费$${Math.round(totalSpend*100)/100} | 销售$${Math.round(totalSales*100)/100} | ACoS:${followupAcos}% | ROAS:${followupRoas}x\n变化：ACoS ${acosChange>0?'+':''}${acosChange}% | ROAS ${roasChange>0?'+':''}${roasChange}%`;
      } catch {
        effectSummary = `ACoS变化: ${acosChange>0?'+':''}${acosChange}%, ROAS变化: ${roasChange>0?'+':''}${roasChange}%`;
        effectScore = acosChange < 0 ? 70 : (acosChange > 10 ? 30 : 50);
      }

      // Update the tracking record
      await db!.update(budgetTracking)
        .set({
          followupSpend: String(Math.round(totalSpend * 100) / 100),
          followupSales: String(Math.round(totalSales * 100) / 100),
          followupAcos: String(followupAcos),
          followupRoas: String(followupRoas),
          followupOrders: totalOrders,
          followupEvaluatedAt: new Date(),
          effectSummary,
          effectScore,
        })
        .where(opsWorkspaceCondition(budgetTracking, workspaceIdFromContext(ctx), eq(budgetTracking.id, input.trackingId)));

      return {
        success: true,
        followup: {
          spend: Math.round(totalSpend * 100) / 100,
          sales: Math.round(totalSales * 100) / 100,
          acos: followupAcos,
          roas: followupRoas,
          orders: totalOrders,
        },
        baseline: {
          spend: Number(record.baselineSpend) || 0,
          sales: Number(record.baselineSales) || 0,
          acos: baseAcos,
          roas: baseRoas,
          orders: record.baselineOrders || 0,
        },
        changes: { acosChange, roasChange },
        effectSummary,
        effectScore,
      };
    })
};
