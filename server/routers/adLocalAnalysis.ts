/**
 * Ad Local Analysis Router
 * Reads from local uploaded ad report data (DB tables) and returns data
 * in the SAME shape as the Lingxing API-based procedures in adAnalysis.ts.
 * This allows the frontend to switch data sources seamlessly.
 */
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import {
  adSearchTermReports,
  adCampaignReports,
  adPlacementReports,
  adHourlyReports,
  adOrderHourly,
  budgetTracking,
  adDspReports,
} from "../../drizzle/schema";
import { eq, and, inArray, gte, lte, desc, sql } from "drizzle-orm";
import { invokeLLM } from "../_core/llm";

// ─── Helpers ────────────────────────────────────────────────────
async function getDbInstance() {
  const d = await getDb();
  if (!d) throw new Error("数据库未连接");
  return d;
}

/** Generate a stable numeric-like ID from campaign name */
function campaignNameToId(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  }
  return String(Math.abs(hash));
}

function n(v: any): number { return Number(v) || 0; }
function safePct(num: number, den: number): number {
  return den > 0 ? Math.round(num / den * 10000) / 100 : 0;
}
function safeDiv(num: number, den: number): number {
  return den > 0 ? Math.round(num / den * 100) / 100 : 0;
}

// ─── 12-Category Classification (same as adAnalysis.ts) ─────────
interface ClassificationThresholds {
  highImpressions: number;
  lowImpressions: number;
  highCTR: number;
  lowCTR: number;
  highCVR: number;
  lowCVR: number;
}
const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  highImpressions: 1000,
  lowImpressions: 100,
  highCTR: 0.005,
  lowCTR: 0.0015,
  highCVR: 0.10,
  lowCVR: 0.03,
};

// ─── Percentile-based dynamic threshold calculation ─────────
function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(idx);
  const upper = Math.ceil(idx);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (idx - lower);
}

/**
 * Calculate dynamic thresholds based on actual data distribution.
 * Uses P33/P67 percentiles to split data into 3 tiers (low/mid/high).
 * Falls back to DEFAULT_THRESHOLDS if data is insufficient (<5 items).
 */
function computeDynamicThresholds(data: { impressions: number; clicks: number; orders: number }[]): ClassificationThresholds {
  if (data.length < 5) return DEFAULT_THRESHOLDS;
  const impressions = data.map(d => d.impressions).filter(v => v > 0);
  const ctrs = data.filter(d => d.impressions > 0).map(d => d.clicks / d.impressions);
  const cvrs = data.filter(d => d.clicks > 0).map(d => d.orders / d.clicks);
  return {
    highImpressions: impressions.length >= 3 ? percentile(impressions, 67) : DEFAULT_THRESHOLDS.highImpressions,
    lowImpressions: impressions.length >= 3 ? percentile(impressions, 33) : DEFAULT_THRESHOLDS.lowImpressions,
    highCTR: ctrs.length >= 3 ? percentile(ctrs, 67) : DEFAULT_THRESHOLDS.highCTR,
    lowCTR: ctrs.length >= 3 ? percentile(ctrs, 33) : DEFAULT_THRESHOLDS.lowCTR,
    highCVR: cvrs.length >= 3 ? percentile(cvrs, 67) : DEFAULT_THRESHOLDS.highCVR,
    lowCVR: cvrs.length >= 3 ? percentile(cvrs, 33) : DEFAULT_THRESHOLDS.lowCVR,
  };
}

const TWELVE_CATEGORIES = [
  { id: 1, key: "high_imp_high_ctr_high_cvr", label: "高曝光_高点击率_高转化", shortLabel: "核心大词" },
  { id: 2, key: "high_imp_high_ctr_low_cvr", label: "高曝光_高点击率_低转化", shortLabel: "流量漏斗词" },
  { id: 3, key: "high_imp_low_ctr_high_cvr", label: "高曝光_低点击率_高转化", shortLabel: "潜力优化词" },
  { id: 4, key: "high_imp_low_ctr_low_cvr", label: "高曝光_低点击率_低转化", shortLabel: "低效大词" },
  { id: 5, key: "mid_imp_high_ctr_high_cvr", label: "中曝光_高点击率_高转化", shortLabel: "稳定出单词" },
  { id: 6, key: "mid_imp_high_ctr_low_cvr", label: "中曝光_高点击率_低转化", shortLabel: "高点击低转化" },
  { id: 7, key: "mid_imp_low_ctr_high_cvr", label: "中曝光_低点击率_高转化", shortLabel: "隐藏宝藏词" },
  { id: 8, key: "mid_imp_low_ctr_low_cvr", label: "中曝光_低点击率_低转化", shortLabel: "观察淘汰词" },
  { id: 9, key: "low_imp_high_ctr_high_cvr", label: "低曝光_高点击率_高转化", shortLabel: "精准长尾词" },
  { id: 10, key: "low_imp_high_ctr_low_cvr", label: "低曝光_高点击率_低转化", shortLabel: "小众吸引词" },
  { id: 11, key: "low_imp_low_ctr_high_cvr", label: "低曝光_低点击率_高转化", shortLabel: "冷门精准词" },
  { id: 12, key: "low_imp_low_ctr_low_cvr", label: "低曝光_低点击率_低转化", shortLabel: "无效词" },
];

function classifySearchTerm(
  impressions: number, clicks: number, orders: number,
  thresholds: ClassificationThresholds
): { categoryId: number; categoryKey: string } {
  const ctr = impressions > 0 ? clicks / impressions : 0;
  const cvr = clicks > 0 ? orders / clicks : 0;
  const impLevel = impressions >= thresholds.highImpressions ? 'high'
    : impressions >= thresholds.lowImpressions ? 'mid' : 'low';
  const ctrLevel = ctr >= thresholds.highCTR ? 'high' : ctr < thresholds.lowCTR ? 'low' : 'high';
  const cvrLevel = cvr >= thresholds.highCVR ? 'high' : cvr < thresholds.lowCVR ? 'low' : 'high';
  const key = `${impLevel}_imp_${ctrLevel}_ctr_${cvrLevel}_cvr`;
  const cat = TWELVE_CATEGORIES.find(c => c.key === key);
  return cat ? { categoryId: cat.id, categoryKey: cat.key } : { categoryId: 12, categoryKey: "low_imp_low_ctr_low_cvr" };
}

// ═══════════════════════════════════════════════════════════════════
// ROUTER
// ═══════════════════════════════════════════════════════════════════
export const adLocalAnalysisRouter = router({

  // ─── 1. getAdCampaignsLocal ─────────────────────────────────────
  getAdCampaignsLocal: protectedProcedure
    .input(z.object({
      parentAsin: z.string().optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      adType: z.string().optional(),
      adState: z.enum(['all', 'enabled', 'paused', 'archived']).optional().default('all'),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adCampaignReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adCampaignReports.parentAsin, input.parentAsin));
      if (input.weekStartDate) conditions.push(gte(adCampaignReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adCampaignReports.weekEndDate, input.weekEndDate));
      if (input.adType && input.adType !== 'all') conditions.push(eq(adCampaignReports.adType, input.adType));

      const rows = await d.select().from(adCampaignReports).where(and(...conditions));

      // Aggregate by campaignName
      const campMap: Record<string, {
        campaign_name: string; campaign_type: string; targeting_type: string;
        daily_budget: number; state: string; serving_status: string;
        portfolio_id: string; portfolio_name: string;
        impressions: number; clicks: number; spend: number; sales: number; orders: number;
      }> = {};

      for (const r of rows) {
        const key = r.campaignName;
        if (!campMap[key]) {
          campMap[key] = {
            campaign_name: r.campaignName,
            campaign_type: r.adType || "SP",
            targeting_type: "",
            daily_budget: n(r.budget),
            state: r.effectiveStatus || "enabled",
            serving_status: r.effectiveStatus || "",
            portfolio_id: r.portfolioName ? campaignNameToId(r.portfolioName) : "ungrouped",
            portfolio_name: r.portfolioName || "未分组",
            impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0,
          };
        }
        campMap[key].impressions += n(r.impressions);
        campMap[key].clicks += n(r.clicks);
        campMap[key].spend += n(r.spend);
        campMap[key].sales += n(r.sales);
        campMap[key].orders += n(r.orders);
      }

      const campaigns = Object.entries(campMap).map(([name, c]) => ({
        ...c,
        campaign_id: campaignNameToId(name),
        acos: safePct(c.spend, c.sales),
        roas: safeDiv(c.sales, c.spend),
        ctr: safePct(c.clicks, c.impressions),
        cpc: safeDiv(c.spend, c.clicks),
      }));

      let filteredCampaigns = campaigns;
      if (input.adState && input.adState !== 'all') {
        filteredCampaigns = campaigns.filter(c => c.state === input.adState);
      }
      filteredCampaigns.sort((a, b) => b.spend - a.spend);

      // Build portfolio structure
      const portfolioMap: Record<string, {
        id: string; name: string; campaigns: any[];
        impressions: number; clicks: number; spend: number; sales: number; orders: number;
      }> = {};
      for (const c of filteredCampaigns) {
        const pid = c.portfolio_id;
        if (!portfolioMap[pid]) {
          portfolioMap[pid] = { id: pid, name: c.portfolio_name, campaigns: [], impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
        }
        portfolioMap[pid].campaigns.push(c);
        portfolioMap[pid].impressions += c.impressions;
        portfolioMap[pid].clicks += c.clicks;
        portfolioMap[pid].spend += c.spend;
        portfolioMap[pid].sales += c.sales;
        portfolioMap[pid].orders += c.orders;
      }
      const portfolios = Object.values(portfolioMap).map(p => ({
        ...p,
        acos: safePct(p.spend, p.sales),
        roas: safeDiv(p.sales, p.spend),
        ctr: safePct(p.clicks, p.impressions),
        cpc: safeDiv(p.spend, p.clicks),
        campaignCount: p.campaigns.length,
      })).sort((a, b) => b.spend - a.spend);

      const allDates = rows.map(r => r.weekStartDate).filter(Boolean);
      const allEndDates = rows.map(r => r.weekEndDate).filter(Boolean);
      const startDate = allDates.length > 0 ? allDates.sort()[0] : "";
      const endDate = allEndDates.length > 0 ? allEndDates.sort().reverse()[0] : "";

      return {
        campaigns: filteredCampaigns,
        allCampaigns: campaigns,
        portfolios,
        isMock: false,
        isLocalData: true,
        dateRange: { startDate, endDate, days: rows.length > 0 ? 7 : 0 },
        cacheInfo: { campaignListCached: false, campaignListCacheAge: 0, hourDataCacheHits: 0, hourDataApiCalls: 0 },
      };
    }),

  // ─── 2. getSearchTerms12CategoryLocal ───────────────────────────
  getSearchTerms12CategoryLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      parentAsin: z.string().optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
      thresholds: z.object({
        highImpressions: z.number().optional(),
        lowImpressions: z.number().optional(),
        highCTR: z.number().optional(),
        lowCTR: z.number().optional(),
        highCVR: z.number().optional(),
        lowCVR: z.number().optional(),
      }).optional(),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const adType = input.adType || "SP";

      const conditions: any[] = [eq(adSearchTermReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adSearchTermReports.parentAsin, input.parentAsin));
      if (adType) conditions.push(eq(adSearchTermReports.adType, adType));
      if (input.weekStartDate) conditions.push(gte(adSearchTermReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adSearchTermReports.weekEndDate, input.weekEndDate));
      if (input.campaignNames && input.campaignNames.length > 0) {
        conditions.push(inArray(adSearchTermReports.campaignName, input.campaignNames));
      }

      const rows = await d.select().from(adSearchTermReports).where(and(...conditions));

      // Aggregate by search term + campaign + match type
      const termAggMap: Record<string, {
        query: string; searchTerm: string; target_text: string; match_type: string;
        campaign_id: string; ad_group_id: string;
        impressions: number; clicks: number; cost: number;
        sales: number; orders: number; units: number; days_seen: number;
        sourceCampaigns: Map<string, { campaignId: string; campaignName: string; cost: number; sales: number; orders: number }>;
      }> = {};

      for (const r of rows) {
        const key = `${r.searchTerm}||${r.campaignName}||${r.matchType}`;
        const cid = campaignNameToId(r.campaignName || "");
        if (termAggMap[key]) {
          termAggMap[key].impressions += n(r.impressions);
          termAggMap[key].clicks += n(r.clicks);
          termAggMap[key].cost += n(r.spend);
          termAggMap[key].sales += n(r.sales);
          termAggMap[key].orders += n(r.orders);
          termAggMap[key].days_seen += 1;
        } else {
          termAggMap[key] = {
            query: r.searchTerm,
            searchTerm: r.searchTerm,
            target_text: r.keyword || r.targeting || "",
            match_type: r.matchType || "",
            campaign_id: cid,
            ad_group_id: campaignNameToId(r.adGroupName || ""),
            impressions: n(r.impressions),
            clicks: n(r.clicks),
            cost: n(r.spend),
            sales: n(r.sales),
            orders: n(r.orders),
            units: n(r.orders),
            days_seen: 1,
            sourceCampaigns: new Map(),
          };
        }
        const src = termAggMap[key].sourceCampaigns;
        if (src.has(cid)) {
          const s = src.get(cid)!;
          s.cost += n(r.spend);
          s.sales += n(r.sales);
          s.orders += n(r.orders);
        } else {
          src.set(cid, { campaignId: cid, campaignName: r.campaignName || "", cost: n(r.spend), sales: n(r.sales), orders: n(r.orders) });
        }
      }

      // Compute dynamic thresholds from aggregated data, then merge with user overrides
      const aggData = Object.values(termAggMap).map(t => ({ impressions: t.impressions, clicks: t.clicks, orders: t.orders }));
      const dynamicThresholds = computeDynamicThresholds(aggData);
      const thresholds: ClassificationThresholds = { ...dynamicThresholds, ...input.thresholds };

      const searchTerms = Object.values(termAggMap).map(t => {
        const acos = t.sales > 0 ? Math.round(t.cost / t.sales * 10000) / 100 : (t.cost > 0 ? 999 : 0);
        const ctr = t.impressions > 0 ? Math.round(t.clicks / t.impressions * 10000) / 100 : 0;
        const cpc = t.clicks > 0 ? Math.round(t.cost / t.clicks * 100) / 100 : 0;
        const convRate = t.clicks > 0 ? Math.round(t.orders / t.clicks * 10000) / 100 : 0;
        const { categoryId, categoryKey } = classifySearchTerm(t.impressions, t.clicks, t.orders, thresholds);
        const sources = Array.from(t.sourceCampaigns.values());
        return {
          query: t.query,
          searchTerm: t.searchTerm,
          target_text: t.target_text,
          match_type: t.match_type,
          campaign_id: t.campaign_id,
          ad_group_id: t.ad_group_id,
          impressions: t.impressions,
          clicks: t.clicks,
          cost: t.cost,
          sales: t.sales,
          orders: t.orders,
          units: t.units,
          days_seen: t.days_seen,
          acos, ctr, cpc, convRate,
          categoryId, categoryKey,
          categoryLabel: TWELVE_CATEGORIES.find(c => c.id === categoryId)?.shortLabel || "",
          sourceCampaigns: sources,
          campaignCount: sources.length,
        };
      });
      searchTerms.sort((a, b) => b.cost - a.cost);

      const categoryStats: Record<number, number> = {};
      for (let i = 1; i <= 12; i++) categoryStats[i] = 0;
      for (const t of searchTerms) categoryStats[t.categoryId] = (categoryStats[t.categoryId] || 0) + 1;

      const campaignSummaries: Record<string, { campaignId: string; campaignName: string; termCount: number; totalCost: number; totalSales: number; totalOrders: number }> = {};
      for (const t of searchTerms) {
        for (const src of t.sourceCampaigns) {
          if (!campaignSummaries[src.campaignId]) {
            campaignSummaries[src.campaignId] = { campaignId: src.campaignId, campaignName: src.campaignName, termCount: 0, totalCost: 0, totalSales: 0, totalOrders: 0 };
          }
          campaignSummaries[src.campaignId].termCount += 1;
          campaignSummaries[src.campaignId].totalCost += src.cost;
          campaignSummaries[src.campaignId].totalSales += src.sales;
          campaignSummaries[src.campaignId].totalOrders += src.orders;
        }
      }

      const overlapTerms = searchTerms.filter(t => t.campaignCount > 1);
      const isMulti = (input.campaignNames?.length || 0) > 1;

      return {
        searchTerms,
        categoryStats,
        categories: TWELVE_CATEGORIES,
        thresholds,
        days: rows.length > 0 ? 7 : 0,
        adType,
        total: searchTerms.length,
        isMock: false,
        isLocalData: true,
        isMultiCampaign: isMulti,
        campaignCount: Object.keys(campaignSummaries).length,
        campaignSummaries: Object.values(campaignSummaries),
        overlapStats: {
          overlapCount: overlapTerms.length,
          uniqueCount: searchTerms.length - overlapTerms.length,
          overlapCost: overlapTerms.reduce((s, t) => s + t.cost, 0),
          overlapSales: overlapTerms.reduce((s, t) => s + t.sales, 0),
        },
        terms: searchTerms,
      };
    }),

  // ─── 3. getAdPlacementDataLocal ─────────────────────────────────
  getAdPlacementDataLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      parentAsin: z.string().optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adPlacementReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adPlacementReports.parentAsin, input.parentAsin));
      if (input.adType) conditions.push(eq(adPlacementReports.adType, input.adType));
      if (input.weekStartDate) conditions.push(gte(adPlacementReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adPlacementReports.weekEndDate, input.weekEndDate));
      if (input.campaignNames && input.campaignNames.length > 0) {
        conditions.push(inArray(adPlacementReports.campaignName, input.campaignNames));
      }

      const rows = await d.select().from(adPlacementReports).where(and(...conditions));

      const placementMap: Record<string, {
        placement: string; impressions: number; clicks: number;
        cost: number; sales: number; orders: number;
      }> = {};

      for (const r of rows) {
        const p = r.placement || "OTHER";
        if (!placementMap[p]) {
          placementMap[p] = { placement: p, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
        }
        placementMap[p].impressions += n(r.impressions);
        placementMap[p].clicks += n(r.clicks);
        placementMap[p].cost += n(r.spend);
        placementMap[p].sales += n(r.sales);
        placementMap[p].orders += n(r.orders);
      }

      const placements = Object.values(placementMap).map(p => ({
        ...p,
        acos: safePct(p.cost, p.sales),
        roas: safeDiv(p.sales, p.cost),
        ctr: safePct(p.clicks, p.impressions),
        cpc: safeDiv(p.cost, p.clicks),
        cvr: safePct(p.orders, p.clicks),
      }));

      return { placements, days: 7, adType: input.adType || "SP", isMock: false, isLocalData: true };
    }),

  // ─── 4. getAdPlacementByKeywordLocal ────────────────────────────
  getAdPlacementByKeywordLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      parentAsin: z.string().optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
      searchKeyword: z.string().optional(),
      sortBy: z.string().optional().default("impressions"),
      sortDir: z.enum(["asc", "desc"]).optional().default("desc"),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();

      // Strategy: Use adHourlyReports which has both targetingValue (real keyword) and placementClassification
      // Fallback to adPlacementReports (by campaignName) if no hourly data exists
      const hourlyConditions: any[] = [eq(adHourlyReports.userId, ctx.user.id)];
      if (input.parentAsin) hourlyConditions.push(eq(adHourlyReports.parentAsin, input.parentAsin));
      if (input.campaignNames && input.campaignNames.length > 0) {
        hourlyConditions.push(inArray(adHourlyReports.campaignName, input.campaignNames));
      }

      const hourlyRows = await d.select().from(adHourlyReports).where(and(...hourlyConditions));

      // If hourly data exists, use real keywords (targetingValue) + placement breakdown
      if (hourlyRows.length > 0) {
        const kwMap: Record<string, {
          keyword: string; matchType: string; campaignName: string;
          placements: Record<string, { placement: string; impressions: number; clicks: number; cost: number; sales: number; orders: number }>;
          totalImpressions: number; totalClicks: number; totalCost: number; totalSales: number; totalOrders: number;
        }> = {};

        for (const r of hourlyRows) {
          // Extract real keyword from targetingValue field
          const rawKw = (r.targetingValue || r.searchTerm || r.adGroupName || "").trim();
          if (!rawKw) continue;
          const placement = r.placementClassification || r.placementName || "Other";
          if (input.searchKeyword && !rawKw.toLowerCase().includes(input.searchKeyword.toLowerCase())) continue;

          const key = rawKw;
          if (!kwMap[key]) {
            kwMap[key] = {
              keyword: rawKw, matchType: "", campaignName: r.campaignName || "",
              placements: {},
              totalImpressions: 0, totalClicks: 0, totalCost: 0, totalSales: 0, totalOrders: 0,
            };
          }
          if (!kwMap[key].placements[placement]) {
            kwMap[key].placements[placement] = { placement, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
          }
          kwMap[key].placements[placement].impressions += n(r.impressions);
          kwMap[key].placements[placement].clicks += n(r.clicks);
          kwMap[key].placements[placement].cost += n(r.spend);
          kwMap[key].placements[placement].sales += n(r.sales);
          kwMap[key].placements[placement].orders += n(r.purchases);
          kwMap[key].totalImpressions += n(r.impressions);
          kwMap[key].totalClicks += n(r.clicks);
          kwMap[key].totalCost += n(r.spend);
          kwMap[key].totalSales += n(r.sales);
          kwMap[key].totalOrders += n(r.purchases);
        }

        const keywords = Object.values(kwMap).map(kw => ({
          keyword: kw.keyword,
          matchType: kw.matchType,
          campaignName: kw.campaignName,
          placements: Object.values(kw.placements).map(p => ({
            ...p,
            acos: safePct(p.cost, p.sales),
            roas: safeDiv(p.sales, p.cost),
            ctr: safePct(p.clicks, p.impressions),
            cpc: safeDiv(p.cost, p.clicks),
            cvr: safePct(p.orders, p.clicks),
          })),
          totalImpressions: kw.totalImpressions,
          totalClicks: kw.totalClicks,
          totalCost: kw.totalCost,
          totalSales: kw.totalSales,
          totalOrders: kw.totalOrders,
          totalAcos: safePct(kw.totalCost, kw.totalSales),
          totalRoas: safeDiv(kw.totalSales, kw.totalCost),
        }));

        const sortKey = input.sortBy as string;
        keywords.sort((a, b) => {
          const av = (a as any)[`total${sortKey.charAt(0).toUpperCase() + sortKey.slice(1)}`] || 0;
          const bv = (b as any)[`total${sortKey.charAt(0).toUpperCase() + sortKey.slice(1)}`] || 0;
          return input.sortDir === "asc" ? av - bv : bv - av;
        });

        const placementNamesSet = new Set<string>();
        for (const kw of keywords) {
          for (const p of kw.placements) placementNamesSet.add(p.placement);
        }
        const placementNames = Array.from(placementNamesSet);

        return { keywords, placementNames, total: keywords.length, isMock: false, isLocalData: true, dataSource: "hourly" as const };
      }

      // Fallback: use adPlacementReports (by campaignName) if no hourly data
      const conditions: any[] = [eq(adPlacementReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adPlacementReports.parentAsin, input.parentAsin));
      if (input.adType) conditions.push(eq(adPlacementReports.adType, input.adType));
      if (input.weekStartDate) conditions.push(gte(adPlacementReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adPlacementReports.weekEndDate, input.weekEndDate));
      if (input.campaignNames && input.campaignNames.length > 0) {
        conditions.push(inArray(adPlacementReports.campaignName, input.campaignNames));
      }

      const rows = await d.select().from(adPlacementReports).where(and(...conditions));

      const kwMap: Record<string, {
        keyword: string; campaignName: string;
        placements: Record<string, { placement: string; impressions: number; clicks: number; cost: number; sales: number; orders: number }>;
        totalImpressions: number; totalClicks: number; totalCost: number; totalSales: number; totalOrders: number;
      }> = {};

      for (const r of rows) {
        const kw = r.campaignName;
        if (input.searchKeyword && !kw.toLowerCase().includes(input.searchKeyword.toLowerCase())) continue;
        if (!kwMap[kw]) {
          kwMap[kw] = {
            keyword: kw, campaignName: kw, placements: {},
            totalImpressions: 0, totalClicks: 0, totalCost: 0, totalSales: 0, totalOrders: 0,
          };
        }
        const p = r.placement || "OTHER";
        if (!kwMap[kw].placements[p]) {
          kwMap[kw].placements[p] = { placement: p, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
        }
        kwMap[kw].placements[p].impressions += n(r.impressions);
        kwMap[kw].placements[p].clicks += n(r.clicks);
        kwMap[kw].placements[p].cost += n(r.spend);
        kwMap[kw].placements[p].sales += n(r.sales);
        kwMap[kw].placements[p].orders += n(r.orders);
        kwMap[kw].totalImpressions += n(r.impressions);
        kwMap[kw].totalClicks += n(r.clicks);
        kwMap[kw].totalCost += n(r.spend);
        kwMap[kw].totalSales += n(r.sales);
        kwMap[kw].totalOrders += n(r.orders);
      }

      const keywords = Object.values(kwMap).map(kw => ({
        keyword: kw.keyword,
        campaignName: kw.campaignName,
        placements: Object.values(kw.placements).map(p => ({
          ...p,
          acos: safePct(p.cost, p.sales),
          roas: safeDiv(p.sales, p.cost),
          ctr: safePct(p.clicks, p.impressions),
          cpc: safeDiv(p.cost, p.clicks),
          cvr: safePct(p.orders, p.clicks),
        })),
        totalImpressions: kw.totalImpressions,
        totalClicks: kw.totalClicks,
        totalCost: kw.totalCost,
        totalSales: kw.totalSales,
        totalOrders: kw.totalOrders,
        totalAcos: safePct(kw.totalCost, kw.totalSales),
        totalRoas: safeDiv(kw.totalSales, kw.totalCost),
      }));

      const sortKey = input.sortBy as string;
      keywords.sort((a, b) => {
        const av = (a as any)[`total${sortKey.charAt(0).toUpperCase() + sortKey.slice(1)}`] || 0;
        const bv = (b as any)[`total${sortKey.charAt(0).toUpperCase() + sortKey.slice(1)}`] || 0;
        return input.sortDir === "asc" ? av - bv : bv - av;
      });

      // Collect unique placement names
      const placementNamesSet = new Set<string>();
      for (const kw of keywords) {
        for (const p of kw.placements) placementNamesSet.add(p.placement);
      }
      const placementNames = Array.from(placementNamesSet);

      return { keywords, placementNames, total: keywords.length, isMock: false, isLocalData: true, dataSource: "placement" as const };
    }),

  // ─── 5. getAdHourlyDataLocal ────────────────────────────────────
  getAdHourlyDataLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      parentAsin: z.string().optional(),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adHourlyReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adHourlyReports.parentAsin, input.parentAsin));
      if (input.campaignNames && input.campaignNames.length > 0) {
        conditions.push(inArray(adHourlyReports.campaignName, input.campaignNames));
      }

      const rows = await d.select().from(adHourlyReports).where(and(...conditions));

      const hourMap: Record<number, { hour: number; impressions: number; clicks: number; spend: number; sales: number; orders: number }> = {};
      for (let h = 0; h < 24; h++) {
        hourMap[h] = { hour: h, impressions: 0, clicks: 0, spend: 0, sales: 0, orders: 0 };
      }
      for (const r of rows) {
        const h = r.hour;
        if (h >= 0 && h < 24) {
          hourMap[h].impressions += n(r.impressions);
          hourMap[h].clicks += n(r.clicks);
          hourMap[h].spend += n(r.spend);
          hourMap[h].sales += n(r.sales);
          hourMap[h].orders += n(r.purchases);
        }
      }

      const hourlyData = Object.values(hourMap).map(h => ({
        ...h,
        acos: safePct(h.spend, h.sales),
        roas: safeDiv(h.sales, h.spend),
        ctr: safePct(h.clicks, h.impressions),
        cpc: safeDiv(h.spend, h.clicks),
      }));

      return { hourlyData, days: 1, isMock: false, isLocalData: true };
    }),

  // ─── 6. getOrderHourlyHeatmapLocal ──────────────────────────────
  getOrderHourlyHeatmapLocal: protectedProcedure
    .input(z.object({
      parentAsin: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adOrderHourly.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adOrderHourly.parentAsin, input.parentAsin));

      const rows = await d.select().from(adOrderHourly).where(and(...conditions));

      const heatmap: Record<string, { dayOfWeek: number; hour: number; orders: number; sales: number }> = {};
      for (let dow = 0; dow < 7; dow++) {
        for (let h = 0; h < 24; h++) {
          heatmap[`${dow}-${h}`] = { dayOfWeek: dow, hour: h, orders: 0, sales: 0 };
        }
      }
      for (const r of rows) {
        const key = `${r.orderDayOfWeek}-${r.orderHour}`;
        if (heatmap[key]) {
          heatmap[key].orders += n(r.quantity);
          heatmap[key].sales += n(r.salesRevenue);
        }
      }

      // Build heatmapData in the format frontend expects: array of 7 day objects, each with hours array
      const heatmapData: { day: string; hours: { hour: number; orders: number; sales: number; volume: number }[] }[] = [];
      const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
      for (let dow = 0; dow < 7; dow++) {
        const hours: { hour: number; orders: number; sales: number; volume: number }[] = [];
        for (let h = 0; h < 24; h++) {
          const cell = heatmap[`${dow}-${h}`];
          hours.push({ hour: h, orders: cell?.orders || 0, sales: cell?.sales || 0, volume: cell?.orders || 0 });
        }
        heatmapData.push({ day: dayNames[dow], hours });
      }
      return { heatmapData, isMock: false, isLocalData: true };
    }),

  // ─── 7. getTargetingAnalysisLocal ───────────────────────────────
  getTargetingAnalysisLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      parentAsin: z.string().optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adSearchTermReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adSearchTermReports.parentAsin, input.parentAsin));
      if (input.adType) conditions.push(eq(adSearchTermReports.adType, input.adType));
      if (input.weekStartDate) conditions.push(gte(adSearchTermReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adSearchTermReports.weekEndDate, input.weekEndDate));
      if (input.campaignNames && input.campaignNames.length > 0) {
        conditions.push(inArray(adSearchTermReports.campaignName, input.campaignNames));
      }

      const rows = await d.select().from(adSearchTermReports).where(and(...conditions));

      const targetMap: Record<string, {
        keyword: string; match_type: string;
        impressions: number; clicks: number; cost: number; sales: number; orders: number;
        searchTermCount: number;
      }> = {};

      for (const r of rows) {
        // Use non-empty targeting name: keyword > targeting > searchTerm
        const kw = (r.keyword && r.keyword.trim()) || (r.targeting && r.targeting.trim()) || (r.searchTerm && r.searchTerm.trim()) || "(unknown)";
        const key = `${kw}||${r.matchType}`;
        if (!targetMap[key]) {
          targetMap[key] = { keyword: kw, match_type: r.matchType || "", impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, searchTermCount: 0 };
        }
        targetMap[key].impressions += n(r.impressions);
        targetMap[key].clicks += n(r.clicks);
        targetMap[key].cost += n(r.spend);
        targetMap[key].sales += n(r.sales);
        targetMap[key].orders += n(r.orders);
        targetMap[key].searchTermCount += 1;
      }

      // Compute dynamic thresholds based on data distribution (P33/P67 percentiles)
      const targetValues = Object.values(targetMap);
      const targetAggData = targetValues.map(t => ({ impressions: t.impressions, clicks: t.clicks, orders: t.orders }));
      const thresholds = computeDynamicThresholds(targetAggData);

      const targets = targetValues.map(t => {
        const acos = safePct(t.cost, t.sales);
        const ctr = safePct(t.clicks, t.impressions);
        const cpc = safeDiv(t.cost, t.clicks);
        const cvr = safePct(t.orders, t.clicks);
        const { categoryId, categoryKey } = classifySearchTerm(t.impressions, t.clicks, t.orders, thresholds);
        return { ...t, acos, ctr, cpc, cvr, categoryId, categoryKey };
      });
      targets.sort((a, b) => b.cost - a.cost);

      // 9-grid categoryStats using relative percentile thresholds for clicks and CVR
      const clickValues = targetValues.map(t => t.clicks).filter(v => v > 0);
      const cvrValues = targetValues.filter(t => t.clicks > 0).map(t => t.orders / t.clicks);
      const clickP67 = clickValues.length >= 3 ? percentile(clickValues, 67) : 10;
      const clickP33 = clickValues.length >= 3 ? percentile(clickValues, 33) : 3;
      const cvrP67 = cvrValues.length >= 3 ? percentile(cvrValues, 67) : 0.10;
      const cvrP33 = cvrValues.length >= 3 ? percentile(cvrValues, 33) : 0.03;

      const categoryStats: Record<number, number> = {};
      for (let i = 1; i <= 9; i++) categoryStats[i] = 0;
      for (const t of targets) {
        const clickLevel = t.clicks >= clickP67 ? 'high' : t.clicks >= clickP33 ? 'mid' : 'low';
        const cvr = t.clicks > 0 ? t.orders / t.clicks : 0;
        const cvrLevel = cvr >= cvrP67 ? 'high' : cvr >= cvrP33 ? 'mid' : 'low';
        const catIdx = ({ high: 0, mid: 1, low: 2 } as any)[clickLevel] * 3 + ({ high: 0, mid: 1, low: 2 } as any)[cvrLevel] + 1;
        categoryStats[catIdx] = (categoryStats[catIdx] || 0) + 1;
      }

      return { targets, categoryStats, thresholds, total: targets.length, isMock: false, isLocalData: true };
    }),

  // ─── 8. getWordFrequencyLocal ───────────────────────────────────
  getWordFrequencyLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      parentAsin: z.string().optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adSearchTermReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adSearchTermReports.parentAsin, input.parentAsin));
      if (input.adType) conditions.push(eq(adSearchTermReports.adType, input.adType));
      if (input.weekStartDate) conditions.push(gte(adSearchTermReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adSearchTermReports.weekEndDate, input.weekEndDate));
      if (input.campaignNames && input.campaignNames.length > 0) {
        conditions.push(inArray(adSearchTermReports.campaignName, input.campaignNames));
      }

      const rows = await d.select().from(adSearchTermReports).where(and(...conditions));

      const wordMap: Record<string, {
        word: string; frequency: number;
        impressions: number; clicks: number; cost: number; sales: number; orders: number;
      }> = {};

      for (const r of rows) {
        const words = (r.searchTerm || "").toLowerCase().split(/\s+/).filter(w => w.length > 1);
        for (const w of words) {
          if (!wordMap[w]) {
            wordMap[w] = { word: w, frequency: 0, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
          }
          wordMap[w].frequency += 1;
          wordMap[w].impressions += n(r.impressions);
          wordMap[w].clicks += n(r.clicks);
          wordMap[w].cost += n(r.spend);
          wordMap[w].sales += n(r.sales);
          wordMap[w].orders += n(r.orders);
        }
      }

      const words = Object.values(wordMap).map(w => ({
        ...w,
        acos: safePct(w.cost, w.sales),
        ctr: safePct(w.clicks, w.impressions),
        cpc: safeDiv(w.cost, w.clicks),
        cvr: safePct(w.orders, w.clicks),
        avgImpressions: w.frequency > 0 ? Math.round(w.impressions / w.frequency) : 0,
      }));
      words.sort((a, b) => b.frequency - a.frequency);

      // Build categoryStats using relative thresholds based on data distribution
      // Compute percentile-based thresholds for clicks and CVR
      const wordsWithOrders = words.filter(w => w.orders > 0);
      const wordsWithClicks = words.filter(w => w.clicks > 0);
      const wordCvrValues = wordsWithOrders.filter(w => w.clicks > 0).map(w => w.orders / w.clicks);
      const wordClickValues = wordsWithClicks.map(w => w.clicks);
      // CVR tiers: P67 = high, P33 = medium boundary
      const wordCvrP67 = wordCvrValues.length >= 3 ? percentile(wordCvrValues, 67) : 0.1;
      const wordCvrP33 = wordCvrValues.length >= 3 ? percentile(wordCvrValues, 33) : 0.05;
      // Click tiers for zero-conversion words: P67 = high clicks, P33 = medium clicks
      const zeroConvWords = words.filter(w => w.orders === 0 && w.clicks > 0);
      const zeroConvClicks = zeroConvWords.map(w => w.clicks);
      const zeroClickP67 = zeroConvClicks.length >= 3 ? percentile(zeroConvClicks, 67) : 30;
      const zeroClickP33 = zeroConvClicks.length >= 3 ? percentile(zeroConvClicks, 33) : 7;

      const categoryStats: Record<number, { count: number; totalImpressions: number; totalClicks: number; totalCost: number; totalSales: number; totalOrders: number }> = {};
      for (const w of words) {
        let cat = 6; // default: 0 conversion, low clicks
        if (w.orders > 0) {
          const cvr = w.clicks > 0 ? w.orders / w.clicks : 0;
          if (cvr >= wordCvrP67) cat = 1; // high conversion (relative)
          else if (cvr >= wordCvrP33) cat = 2; // medium conversion (relative)
          else cat = 3; // low conversion (relative)
        } else if (w.clicks >= zeroClickP67) {
          cat = 4; // 0 conversion, high clicks (relative)
        } else if (w.clicks >= zeroClickP33) {
          cat = 5; // 0 conversion, medium clicks (relative)
        }
        // cat = 6: 0 conversion, low clicks (relative)
        if (!categoryStats[cat]) categoryStats[cat] = { count: 0, totalImpressions: 0, totalClicks: 0, totalCost: 0, totalSales: 0, totalOrders: 0 };
        categoryStats[cat].count++;
        categoryStats[cat].totalImpressions += w.impressions;
        categoryStats[cat].totalClicks += w.clicks;
        categoryStats[cat].totalCost += w.cost;
        categoryStats[cat].totalSales += w.sales;
        categoryStats[cat].totalOrders += w.orders;
      }

      // Return as "attributes" (matching original API field name)
      return { attributes: words.slice(0, 200), categoryStats, totalWords: words.length, isMock: false, isLocalData: true };
    }),

  // ─── 9. getEffectiveSearchTermsLocal ────────────────────────────
  getEffectiveSearchTermsLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      parentAsin: z.string().optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adSearchTermReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adSearchTermReports.parentAsin, input.parentAsin));
      if (input.adType) conditions.push(eq(adSearchTermReports.adType, input.adType));
      if (input.weekStartDate) conditions.push(gte(adSearchTermReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adSearchTermReports.weekEndDate, input.weekEndDate));
      if (input.campaignNames && input.campaignNames.length > 0) {
        conditions.push(inArray(adSearchTermReports.campaignName, input.campaignNames));
      }

      const rows = await d.select().from(adSearchTermReports).where(and(...conditions));

      const termMap: Record<string, {
        query: string; impressions: number; clicks: number;
        cost: number; sales: number; orders: number;
      }> = {};

      for (const r of rows) {
        const q = r.searchTerm;
        if (!termMap[q]) {
          termMap[q] = { query: q, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
        }
        termMap[q].impressions += n(r.impressions);
        termMap[q].clicks += n(r.clicks);
        termMap[q].cost += n(r.spend);
        termMap[q].sales += n(r.sales);
        termMap[q].orders += n(r.orders);
      }

      const effectiveTerms = Object.values(termMap)
        .filter(t => t.orders > 0)
        .map(t => ({
          ...t,
          acos: safePct(t.cost, t.sales),
          roas: safeDiv(t.sales, t.cost),
          ctr: safePct(t.clicks, t.impressions),
          cpc: safeDiv(t.cost, t.clicks),
          cvr: safePct(t.orders, t.clicks),
        }));
      effectiveTerms.sort((a, b) => b.orders - a.orders);

      const totalCost = effectiveTerms.reduce((s, t) => s + t.cost, 0);
      const totalSales = effectiveTerms.reduce((s, t) => s + t.sales, 0);
      const totalOrders = effectiveTerms.reduce((s, t) => s + t.orders, 0);

      // Also find organic-only terms (zero cost but with orders)
      const organicOnlyTerms = Object.values(termMap)
        .filter(t => t.orders > 0 && t.cost === 0)
        .map(t => ({
          ...t,
          cvr: safePct(t.orders, t.clicks),
          valueScore: Math.min(10, t.orders * 3),
          isOrganic: true,
        }));
      organicOnlyTerms.sort((a, b) => b.orders - a.orders);

      return {
        effectiveTerms: effectiveTerms.slice(0, 100),
        organicOnlyTerms: organicOnlyTerms.slice(0, 50),
        totalAdTerms: Object.keys(termMap).length,
        totalTargetedKeywords: 0,
        isMock: false,
        isLocalData: true,
      };
    }),

  // ─── 10. getAsinAdSummaryLocal ──────────────────────────────────
  getAsinAdSummaryLocal: protectedProcedure
    .input(z.object({
      parentAsin: z.string().optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const conditions: any[] = [eq(adCampaignReports.userId, ctx.user.id)];
      if (input.parentAsin) conditions.push(eq(adCampaignReports.parentAsin, input.parentAsin));
      if (input.weekStartDate) conditions.push(gte(adCampaignReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adCampaignReports.weekEndDate, input.weekEndDate));

      const rows = await d.select().from(adCampaignReports).where(and(...conditions));

      const asinMap: Record<string, {
        asin: string; adTypes: Set<string>;
        impressions: number; clicks: number; cost: number; sales: number; orders: number;
        campaigns: Set<string>;
      }> = {};

      for (const r of rows) {
        const asin = r.parentAsin || "unknown";
        if (!asinMap[asin]) {
          asinMap[asin] = { asin, adTypes: new Set(), impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0, campaigns: new Set() };
        }
        asinMap[asin].adTypes.add(r.adType);
        asinMap[asin].campaigns.add(r.campaignName);
        asinMap[asin].impressions += n(r.impressions);
        asinMap[asin].clicks += n(r.clicks);
        asinMap[asin].cost += n(r.spend);
        asinMap[asin].sales += n(r.sales);
        asinMap[asin].orders += n(r.orders);
      }

      const asins = Object.values(asinMap).map(a => ({
        asin: a.asin,
        adTypes: Array.from(a.adTypes),
        campaignCount: a.campaigns.size,
        impressions: a.impressions,
        clicks: a.clicks,
        cost: a.cost,
        sales: a.sales,
        orders: a.orders,
        acos: safePct(a.cost, a.sales),
        roas: safeDiv(a.sales, a.cost),
        ctr: safePct(a.clicks, a.impressions),
        cpc: safeDiv(a.cost, a.clicks),
        cvr: safePct(a.orders, a.clicks),
      }));
      asins.sort((a, b) => b.cost - a.cost);

      // Compute totals
      const totals = asins.reduce((acc, a) => {
        acc.impressions += a.impressions;
        acc.clicks += a.clicks;
        acc.cost += a.cost;
        acc.sales += a.sales;
        acc.orders += a.orders;
        return acc;
      }, { impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 });

      return {
        asins: asins.map(a => ({ ...a, sku: a.asin })),
        totals: {
          ...totals,
          acos: safePct(totals.cost, totals.sales),
          roas: safeDiv(totals.sales, totals.cost),
        },
        isMock: false,
        isLocalData: true,
      };
    }),

  // ─── 11. getSearchTermTrendLocal ────────────────────────────────
  getSearchTermTrendLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      parentAsin: z.string().optional(),
      adType: z.enum(["SP", "SB", "SD"]).optional().default("SP"),
      periods: z.array(z.object({
        label: z.string(),
        startDate: z.string(),
        endDate: z.string(),
      })).optional(),
      topN: z.number().optional().default(20),
    }))
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();

      if (!input.periods || input.periods.length === 0) {
        return { trendData: [], periodTotals: [], isMock: false, isLocalData: true };
      }

      const periodTotals: any[] = [];
      const trendData: any[] = [];

      for (const period of input.periods) {
        const conditions: any[] = [eq(adSearchTermReports.userId, ctx.user.id)];
        if (input.parentAsin) conditions.push(eq(adSearchTermReports.parentAsin, input.parentAsin));
        if (input.adType) conditions.push(eq(adSearchTermReports.adType, input.adType));
        conditions.push(gte(adSearchTermReports.weekStartDate, period.startDate));
        conditions.push(lte(adSearchTermReports.weekEndDate, period.endDate));
        if (input.campaignNames && input.campaignNames.length > 0) {
          conditions.push(inArray(adSearchTermReports.campaignName, input.campaignNames));
        }

        const rows = await d.select().from(adSearchTermReports).where(and(...conditions));

        let impressions = 0, clicks = 0, cost = 0, sales = 0, orders = 0;
        const termMap: Record<string, { query: string; impressions: number; clicks: number; cost: number; sales: number; orders: number }> = {};

        for (const r of rows) {
          impressions += n(r.impressions);
          clicks += n(r.clicks);
          cost += n(r.spend);
          sales += n(r.sales);
          orders += n(r.orders);

          const q = r.searchTerm;
          if (!termMap[q]) termMap[q] = { query: q, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
          termMap[q].impressions += n(r.impressions);
          termMap[q].clicks += n(r.clicks);
          termMap[q].cost += n(r.spend);
          termMap[q].sales += n(r.sales);
          termMap[q].orders += n(r.orders);
        }

        periodTotals.push({
          label: period.label,
          startDate: period.startDate,
          endDate: period.endDate,
          impressions, clicks, cost, sales, orders,
          acos: safePct(cost, sales),
          roas: safeDiv(sales, cost),
          ctr: safePct(clicks, impressions),
          cpc: safeDiv(cost, clicks),
          termCount: Object.keys(termMap).length,
        });

        const topTerms = Object.values(termMap)
          .map(t => ({
            ...t,
            acos: safePct(t.cost, t.sales),
            ctr: safePct(t.clicks, t.impressions),
            cpc: safeDiv(t.cost, t.clicks),
            cvr: safePct(t.orders, t.clicks),
          }))
          .sort((a, b) => b.cost - a.cost)
          .slice(0, 50);

        trendData.push({ label: period.label, terms: topTerms });
      }

      return { trendData, periodTotals, isMock: false, isLocalData: true };
    }),

  // ─── 12. getCategoryDefinitionsLocal ────────────────────────────
  getCategoryDefinitionsLocal: protectedProcedure
    .query(async () => {
      return { categories: TWELVE_CATEGORIES, defaultThresholds: DEFAULT_THRESHOLDS };
    }),

  // ═══════════════════════════════════════════════════════════════════
  // AI TAB LOCAL PROCEDURES
  // ═══════════════════════════════════════════════════════════════════

  // ─── 13. getAdDiagnosisLocal ────────────────────────────────────
  getAdDiagnosisLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbInstance();
      const conditions: any[] = [eq(adCampaignReports.userId, ctx.user.id)];
      if (input.campaignNames?.length) conditions.push(inArray(adCampaignReports.campaignName, input.campaignNames));
      if (input.weekStartDate) conditions.push(gte(adCampaignReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adCampaignReports.weekEndDate, input.weekEndDate));
      const rows = await db.select().from(adCampaignReports).where(and(...conditions));
      let totalImpressions = 0, totalClicks = 0, totalCost = 0, totalSales = 0, totalOrders = 0;
      for (const r of rows) {
        totalImpressions += n(r.impressions); totalClicks += n(r.clicks);
        totalCost += n(r.spend); totalSales += n(r.sales); totalOrders += n(r.orders);
      }
      const metrics = {
        acos: safePct(totalCost, totalSales), ctr: safePct(totalClicks, totalImpressions),
        cvr: safePct(totalOrders, totalClicks), cpc: safeDiv(totalCost, totalClicks),
        roas: safeDiv(totalSales, totalCost),
        totalCost: Math.round(totalCost * 100) / 100, totalSales: Math.round(totalSales * 100) / 100,
        totalOrders, totalImpressions, totalClicks,
      };
      const response = await invokeLLM({
        messages: [
          { role: "system", content: `你是亚马逊广告诊断专家。基于广告整体数据，从6个维度评估广告健康度并给出诊断建议。\n6个维度：花费效率(ACoS/ROAS)、流量质量(CTR)、转化能力(CVR)、出价合理性(CPC)、预算利用率、广告结构合理性。\n每个维度评分0-100分，并给出具体问题和改进建议。输出严格JSON格式。` },
          { role: "user", content: `诊断以下广告数据（本地上传数据汇总）：\n${JSON.stringify(metrics)}\n请从6个维度评分并给出诊断：` },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ad_diagnosis", strict: true,
            schema: {
              type: "object",
              properties: {
                overall_score: { type: "integer" },
                overall_assessment: { type: "string" },
                dimensions: { type: "array", items: { type: "object", properties: { name: { type: "string" }, score: { type: "integer" }, status: { type: "string" }, problems: { type: "array", items: { type: "string" } }, suggestions: { type: "array", items: { type: "string" } } }, required: ["name", "score", "status", "problems", "suggestions"], additionalProperties: false } },
                priority_actions: { type: "array", items: { type: "string" } },
              },
              required: ["overall_score", "overall_assessment", "dimensions", "priority_actions"],
              additionalProperties: false,
            },
          },
        },
      });
      const diagnosis = JSON.parse(response.choices?.[0]?.message?.content as string);
      return { ...diagnosis, metrics };
    }),

  // ─── 14. aiBudgetAllocationLocal ────────────────────────────────
  aiBudgetAllocationLocal: protectedProcedure
    .input(z.object({
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      totalBudget: z.number().optional(),
      targetAcos: z.number().optional().default(25),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbInstance();
      const conditions: any[] = [eq(adCampaignReports.userId, ctx.user.id)];
      if (input.weekStartDate) conditions.push(gte(adCampaignReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adCampaignReports.weekEndDate, input.weekEndDate));
      const rows = await db.select().from(adCampaignReports).where(and(...conditions));
      // Aggregate by campaign
      const campPerf: Record<string, { name: string; budget: number; status: string; asin: string; impressions: number; clicks: number; cost: number; sales: number; orders: number }> = {};
      for (const r of rows) {
        const cName = r.campaignName;
        if (!campPerf[cName]) {
          const isPaused = ['paused','archived','suspended'].includes((r.effectiveStatus||'').toLowerCase());
          campPerf[cName] = { name: cName, budget: n(r.budget), status: isPaused ? 'paused' : 'active', asin: r.parentAsin || '', impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
        }
        campPerf[cName].impressions += n(r.impressions); campPerf[cName].clicks += n(r.clicks);
        campPerf[cName].cost += n(r.spend); campPerf[cName].sales += n(r.sales); campPerf[cName].orders += n(r.orders);
      }
      const campaignSummaries = Object.entries(campPerf)
        .filter(([_, c]) => c.status === 'active')
        .map(([cName, c]) => ({ campaignId: cName, name: cName, asin: c.asin, currentBudget: c.budget, cost: Math.round(c.cost*100)/100, sales: Math.round(c.sales*100)/100, orders: c.orders, impressions: c.impressions, clicks: c.clicks, acos: safePct(c.cost, c.sales), roas: safeDiv(c.sales, c.cost) }))
        .sort((a,b) => b.cost - a.cost).slice(0, 30);
      const totalCurrentBudget = campaignSummaries.reduce((s,c) => s + c.currentBudget, 0);
      const totalCost = campaignSummaries.reduce((s,c) => s + c.cost, 0);
      const totalSales = campaignSummaries.reduce((s,c) => s + c.sales, 0);
      const overallAcos = safePct(totalCost, totalSales);
      const allStarts = rows.map(r => r.weekStartDate).filter(Boolean).sort();
      const allEnds = rows.map(r => r.weekEndDate).filter(Boolean).sort();
      const dateStart = allStarts[0] || ''; const dateEnd = allEnds[allEnds.length-1] || '';
      const uniqueWeeks = new Set(rows.map(r => `${r.weekStartDate}_${r.weekEndDate}`));
      try {
        const llmRes = await invokeLLM({
          messages: [
            { role: 'system', content: '你是亚马逊广告预算优化AI助手。请严格按JSON格式输出分析结果。' },
            { role: 'user', content: `你是资深亚马逊广告优化专家。基于以下本地上传数据提供预算调整建议。\n\n总预算:$${totalCurrentBudget}/天 | 总花费:$${totalCost} | 总销售:$${totalSales} | ACoS:${overallAcos}% | 目标ACoS:${input.targetAcos}%\n\n各活动:\n${campaignSummaries.map((c,i) => `${i+1}. [${c.name}] ASIN:${c.asin||'未知'} | 预算:$${c.currentBudget}/天 | 花费:$${c.cost} | 销售:$${c.sales} | ACoS:${c.acos}% | ROAS:${c.roas}x | 订单:${c.orders}`).join('\n')}\n\n调整原则：1.ACoS低且出单好→加预算 2.ACoS远超目标→减预算或暂停 3.数据不足→维持观察 4.总预算变动控制在±20%` },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'budget_allocation', strict: true,
              schema: {
                type: 'object',
                properties: {
                  overall_analysis: { type: 'string' },
                  total_suggested_budget: { type: 'number' },
                  campaigns: { type: 'array', items: { type: 'object', properties: { campaignId: { type: 'string' }, name: { type: 'string' }, action: { type: 'string' }, currentBudget: { type: 'number' }, suggestedBudget: { type: 'number' }, changePercent: { type: 'number' }, reason: { type: 'string' }, priority: { type: 'string' }, expectedAcos: { type: 'number' } }, required: ['campaignId','name','action','currentBudget','suggestedBudget','changePercent','reason','priority','expectedAcos'], additionalProperties: false } },
                  key_insights: { type: 'array', items: { type: 'string' } },
                },
                required: ['overall_analysis','total_suggested_budget','campaigns','key_insights'],
                additionalProperties: false,
              },
            },
          },
        });
        const result = JSON.parse(String(llmRes.choices[0].message.content) || '{}');
        return { allocation: result, campaignData: campaignSummaries, totals: { totalCurrentBudget, totalCost, totalSales, overallAcos }, dateRange: { start: dateStart, end: dateEnd, days: uniqueWeeks.size * 7 }, isMock: false, isLocalData: true };
      } catch (err: any) {
        console.error('[BudgetAllocLocal] AI error:', err.message);
        return { allocation: null, campaignData: campaignSummaries, totals: { totalCurrentBudget, totalCost, totalSales, overallAcos }, dateRange: { start: dateStart, end: dateEnd, days: uniqueWeeks.size * 7 }, isMock: false, isLocalData: true, error: 'AI分析暂时不可用，请稍后重试' };
      }
    }),

  // ─── 15. evaluateBudgetEffectLocal ──────────────────────────────
  evaluateBudgetEffectLocal: protectedProcedure
    .input(z.object({ trackingId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const db = await getDbInstance();
      const [record] = await db.select().from(budgetTracking)
        .where(and(eq(budgetTracking.id, input.trackingId), eq(budgetTracking.userId, ctx.user.id)))
        .limit(1);
      if (!record) throw new Error('记录不存在');
      const decisions = record.campaignDecisions ? JSON.parse(record.campaignDecisions as string) : [];
      const campaignNames = decisions.map((d: any) => d.campaignName).filter(Boolean);
      if (campaignNames.length === 0) return { success: false, error: '无广告活动数据' };
      const conditions: any[] = [eq(adCampaignReports.userId, ctx.user.id), inArray(adCampaignReports.campaignName, campaignNames)];
      const rows = await db.select().from(adCampaignReports).where(and(...conditions));
      let totalSpend = 0, totalSales = 0, totalOrders = 0;
      for (const r of rows) { totalSpend += n(r.spend); totalSales += n(r.sales); totalOrders += n(r.orders); }
      const followupAcos = safePct(totalSpend, totalSales);
      const followupRoas = safeDiv(totalSales, totalSpend);
      const baseAcos = Number(record.baselineAcos) || 0;
      const baseRoas = Number(record.baselineRoas) || 0;
      const acosChange = baseAcos > 0 ? Math.round((followupAcos - baseAcos) / baseAcos * 100) : 0;
      const roasChange = baseRoas > 0 ? Math.round((followupRoas - baseRoas) / baseRoas * 100) : 0;
      let effectSummary = ''; let effectScore = 50;
      try {
        const llmRes = await invokeLLM({
          messages: [
            { role: 'system', content: '你是亚马逊广告效果评估专家。请严格按JSON格式输出。' },
            { role: 'user', content: `请评估以下预算调整的执行效果（基于本地上传数据）：\n\n基线数据：花费$${Number(record.baselineSpend)||0} | 销售$${Number(record.baselineSales)||0} | ACoS:${baseAcos}% | ROAS:${baseRoas}x\n执行后：花费$${Math.round(totalSpend*100)/100} | 销售$${Math.round(totalSales*100)/100} | ACoS:${followupAcos}% | ROAS:${followupRoas}x\n变化：ACoS ${acosChange>0?'+':''}${acosChange}% | ROAS ${roasChange>0?'+':''}${roasChange}%\n活动数:${campaignNames.length} | 订单:${totalOrders}\n\n请给出简短评价(100字内)和评分(1-100)。` },
          ],
          response_format: { type: 'json_schema', json_schema: { name: 'budget_effect', strict: true, schema: { type: 'object', properties: { summary: { type: 'string' }, score: { type: 'integer' }, recommendation: { type: 'string' } }, required: ['summary','score','recommendation'], additionalProperties: false } } },
        });
        const parsed = JSON.parse(String(llmRes.choices[0].message.content) || '{}');
        effectSummary = `${parsed.summary}\n\n建议：${parsed.recommendation}`;
        effectScore = Math.max(1, Math.min(100, parsed.score || 50));
      } catch {
        effectSummary = `ACoS变化: ${acosChange>0?'+':''}${acosChange}%, ROAS变化: ${roasChange>0?'+':''}${roasChange}%`;
        effectScore = acosChange < 0 ? 70 : (acosChange > 10 ? 30 : 50);
      }
      await db.update(budgetTracking).set({
        followupSpend: String(Math.round(totalSpend * 100) / 100),
        followupSales: String(Math.round(totalSales * 100) / 100),
        followupAcos: String(followupAcos), followupRoas: String(followupRoas),
        followupOrders: totalOrders, followupEvaluatedAt: new Date(),
        effectSummary, effectScore,
      }).where(eq(budgetTracking.id, input.trackingId));
      return {
        success: true,
        followup: { spend: Math.round(totalSpend*100)/100, sales: Math.round(totalSales*100)/100, acos: followupAcos, roas: followupRoas, orders: totalOrders },
        baseline: { spend: Number(record.baselineSpend)||0, sales: Number(record.baselineSales)||0, acos: baseAcos, roas: baseRoas, orders: record.baselineOrders||0 },
        changes: { acosChange, roasChange }, effectSummary, effectScore,
      };
    }),

  // ─── 16. getCrossChannelDataLocal ──────────────────────────────
  getCrossChannelDataLocal: protectedProcedure
    .input(z.object({ weekStartDate: z.string().optional(), weekEndDate: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDbInstance();
      const conditions: any[] = [eq(adCampaignReports.userId, ctx.user.id)];
      if (input.weekStartDate) conditions.push(gte(adCampaignReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adCampaignReports.weekEndDate, input.weekEndDate));
      const rows = await db.select().from(adCampaignReports).where(and(...conditions));
      const channelMap: Record<string, { cost: number; sales: number; clicks: number; impressions: number; orders: number; count: number }> = {};
      const dailyMap: Record<string, Record<string, { cost: number; sales: number; orders: number; clicks: number; impressions: number }>> = {};
      for (const r of rows) {
        const ch = (r.adType || 'SP').toUpperCase();
        if (!channelMap[ch]) channelMap[ch] = { cost: 0, sales: 0, clicks: 0, impressions: 0, orders: 0, count: 0 };
        channelMap[ch].cost += n(r.spend); channelMap[ch].sales += n(r.sales);
        channelMap[ch].clicks += n(r.clicks); channelMap[ch].impressions += n(r.impressions);
        channelMap[ch].orders += n(r.orders); channelMap[ch].count++;
        const dateKey = r.weekStartDate;
        if (!dailyMap[dateKey]) dailyMap[dateKey] = {};
        if (!dailyMap[dateKey][ch]) dailyMap[dateKey][ch] = { cost: 0, sales: 0, orders: 0, clicks: 0, impressions: 0 };
        dailyMap[dateKey][ch].cost += n(r.spend); dailyMap[dateKey][ch].sales += n(r.sales);
        dailyMap[dateKey][ch].orders += n(r.orders); dailyMap[dateKey][ch].clicks += n(r.clicks);
        dailyMap[dateKey][ch].impressions += n(r.impressions);
      }
      const channelNames = ['SP','SB','SD','DSP'];
      const totalCost = Object.values(channelMap).reduce((s,c) => s + c.cost, 0);
      const totalSales = Object.values(channelMap).reduce((s,c) => s + c.sales, 0);
      const channels = channelNames.map(ch => {
        const d = channelMap[ch] || { cost:0, sales:0, clicks:0, impressions:0, orders:0, count:0 };
        return {
          channel: ch, cost: +d.cost.toFixed(2), sales: +d.sales.toFixed(2),
          clicks: d.clicks, impressions: d.impressions, orders: d.orders,
          acos: d.sales > 0 ? +((d.cost/d.sales)*100).toFixed(2) : 0,
          roas: d.cost > 0 ? +(d.sales/d.cost).toFixed(2) : 0,
          ctr: d.impressions > 0 ? +((d.clicks/d.impressions)*100).toFixed(4) : 0,
          cvr: d.clicks > 0 ? +((d.orders/d.clicks)*100).toFixed(2) : 0,
          cpc: d.clicks > 0 ? +(d.cost/d.clicks).toFixed(2) : 0,
          campaignCount: d.count,
          costShare: totalCost > 0 ? +((d.cost/totalCost)*100).toFixed(1) : 0,
          salesShare: totalSales > 0 ? +((d.sales/totalSales)*100).toFixed(1) : 0,
        };
      });
      const sortedDates = Object.keys(dailyMap).sort();
      const emptyDay = { cost:0, sales:0, orders:0, clicks:0, impressions:0 };
      const dailyBreakdown = sortedDates.map(date => {
        const dd = dailyMap[date] || {};
        return {
          date,
          SP: dd['SP'] || {...emptyDay}, SB: dd['SB'] || {...emptyDay},
          SD: dd['SD'] || {...emptyDay}, DSP: dd['DSP'] || {...emptyDay},
          total: {
            cost: +((dd['SP']?.cost||0)+(dd['SB']?.cost||0)+(dd['SD']?.cost||0)+(dd['DSP']?.cost||0)).toFixed(2),
            sales: +((dd['SP']?.sales||0)+(dd['SB']?.sales||0)+(dd['SD']?.sales||0)+(dd['DSP']?.sales||0)).toFixed(2),
            orders: (dd['SP']?.orders||0)+(dd['SB']?.orders||0)+(dd['SD']?.orders||0)+(dd['DSP']?.orders||0),
          },
        };
      });
      return {
        channels,
        total: { cost: +totalCost.toFixed(2), sales: +totalSales.toFixed(2), acos: totalSales>0 ? +((totalCost/totalSales)*100).toFixed(2) : 0, roas: totalCost>0 ? +(totalSales/totalCost).toFixed(2) : 0 },
        dailyBreakdown,
        dateRange: { startDate: sortedDates[0]||'', endDate: sortedDates[sortedDates.length-1]||'' },
        isLocalData: true,
      };
    }),

  // ─── 17. adChatBotLocal ────────────────────────────────────────
  adChatBotLocal: protectedProcedure
    .input(z.object({
      question: z.string().min(1).max(2000),
      campaignNames: z.array(z.string()).optional(),
      conversationHistory: z.array(z.object({ role: z.enum(["user","assistant"]), content: z.string() })).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      let contextData = "";
      if (input.campaignNames?.length) {
        const db = await getDbInstance();
        const rows = await db.select().from(adCampaignReports)
          .where(and(eq(adCampaignReports.userId, ctx.user.id), inArray(adCampaignReports.campaignName, input.campaignNames)));
        if (rows.length > 0) {
          let tc=0,ts=0,tck=0,ti=0,to=0;
          rows.forEach(d => { tc+=n(d.spend); ts+=n(d.sales); tck+=n(d.clicks); ti+=n(d.impressions); to+=n(d.orders); });
          contextData = `\n当前分析的广告活动: ${input.campaignNames.slice(0,5).join(', ')}\n本地上传广告数据汇总：\n- 花费: $${tc.toFixed(2)}\n- 销售额: $${ts.toFixed(2)}\n- ACoS: ${ts>0?((tc/ts)*100).toFixed(2):"N/A"}%\n- 点击: ${tck}\n- 曝光: ${ti}\n- CTR: ${ti>0?((tck/ti)*100).toFixed(2):"N/A"}%\n- CVR: ${tck>0?((to/tck)*100).toFixed(2):"N/A"}%\n- 订单: ${to}`;
        }
      }
      const AD_KB = `## 亚马逊广告类型\n### SP (Sponsored Products) 商品推广 - 最常用，按CPC付费\n### SB (Sponsored Brands) 品牌推广 - 仅限品牌注册卖家\n### SD (Sponsored Display) 展示型推广 - 支持站内外展示\n## 优化最佳实践\n- 新品期ACoS可接受30-50%，成长期20-30%，成熟期15-25%\n- 定期检查搜索词报告，否定不相关词\n- 核心词可使用Top of Search加价50-100%`;
      const messages: any[] = [{
        role: "system",
        content: `你是一位亚马逊广告运营AI助手，精通SP/SB/SD/DSP四种广告类型。\n你可以访问用户的本地上传广告数据来回答问题。\n## 角色定位\n- 基于数据回答，不编造数据\n- 给出具体可操作的建议\n- 回答简洁专业，控制在300字以内\n## 可用数据上下文\n${contextData || "（未选择具体广告活动，无法获取数据）"}\n## 亚马逊广告知识库摘要\n${AD_KB}\n## 输出格式（JSON）\n{\n  "answer": "回答内容（支持Markdown格式）",\n  "data_cards": [{"title": "卡片标题", "metrics": [{"label": "指标名", "value": "值"}]}],\n  "actionable_suggestions": [{"action": "可执行操作", "can_auto_execute": false}],\n  "related_questions": ["相关问题1", "相关问题2"]\n}`
      }];
      if (input.conversationHistory) {
        for (const msg of input.conversationHistory.slice(-6)) messages.push({ role: msg.role, content: msg.content });
      }
      messages.push({ role: "user", content: input.question });
      const response = await invokeLLM({
        messages,
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ad_chat_response", strict: true,
            schema: {
              type: "object",
              properties: {
                answer: { type: "string" },
                data_cards: { type: "array", items: { type: "object", properties: { title: { type: "string" }, metrics: { type: "array", items: { type: "object", properties: { label: { type: "string" }, value: { type: "string" } }, required: ["label","value"], additionalProperties: false } } }, required: ["title","metrics"], additionalProperties: false } },
                actionable_suggestions: { type: "array", items: { type: "object", properties: { action: { type: "string" }, can_auto_execute: { type: "boolean" } }, required: ["action","can_auto_execute"], additionalProperties: false } },
                related_questions: { type: "array", items: { type: "string" } },
              },
              required: ["answer","data_cards","actionable_suggestions","related_questions"],
              additionalProperties: false,
            },
          },
        },
      });
      return JSON.parse(response.choices?.[0]?.message?.content as string);
    }),

   // ─── 18. getDspReportLocal ──────────────────────────────────────
  getDspReportLocal: protectedProcedure
    .input(z.object({ weekStartDate: z.string().optional(), weekEndDate: z.string().optional() }))
    .query(async ({ ctx, input }) => {
      const db = await getDbInstance();
      const conditions: any[] = [eq(adDspReports.userId, ctx.user.id)];
      if (input.weekStartDate) conditions.push(gte(adDspReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adDspReports.weekEndDate, input.weekEndDate));
      const rows = await db.select().from(adDspReports).where(and(...conditions));

      if (rows.length === 0) {
        return {
          orders: [],
          kpi: { totalBudget:0, totalSpends:0, totalSales:0, totalOrders:0, totalImpressions:0, totalViewable:0, totalClicks:0, totalDpv:0, totalAddToCart:0, roas:0, acos:0, ctr:0, viewabilityRate:0 },
          message: '暂无DSP报告数据。请前往「数据导入中心」上传DSP广告报告。',
          hasData: false,
          _meta: { isLocalData: true, notice: '暂无DSP报告数据' },
        };
      }

      const orders = rows.map(r => ({
        orderName: r.orderName || '',
        orderBudget: n(r.orderBudget),
        orderStatus: r.orderStatus || '',
        spends: n(r.spends),
        sales: n(r.sales),
        orders: r.orders || 0,
        impressions: r.impressions || 0,
        viewableImpressions: r.viewableImpressions || 0,
        clicks: r.clicks || 0,
        dpv: r.dpv || 0,
        totalAddToCart: r.totalAddToCart || 0,
        roas: n(r.roas),
        acos: n(r.acos),
        ctr: n(r.ctr),
        lineItemType: r.lineItemType || '',
        creativeType: r.creativeType || '',
      }));

      const totalBudget = orders.reduce((s, o) => s + o.orderBudget, 0);
      const totalSpends = orders.reduce((s, o) => s + o.spends, 0);
      const totalSales = orders.reduce((s, o) => s + o.sales, 0);
      const totalOrders = orders.reduce((s, o) => s + o.orders, 0);
      const totalImpressions = orders.reduce((s, o) => s + o.impressions, 0);
      const totalViewable = orders.reduce((s, o) => s + o.viewableImpressions, 0);
      const totalClicks = orders.reduce((s, o) => s + o.clicks, 0);
      const totalDpv = orders.reduce((s, o) => s + o.dpv, 0);
      const totalAddToCart = orders.reduce((s, o) => s + o.totalAddToCart, 0);

      return {
        orders,
        kpi: {
          totalBudget, totalSpends, totalSales, totalOrders,
          totalImpressions, totalViewable, totalClicks, totalDpv, totalAddToCart,
          roas: totalSpends > 0 ? totalSales / totalSpends : 0,
          acos: totalSales > 0 ? totalSpends / totalSales : 0,
          ctr: totalImpressions > 0 ? totalClicks / totalImpressions : 0,
          viewabilityRate: totalImpressions > 0 ? totalViewable / totalImpressions : 0,
        },
        message: null,
        hasData: true,
        _meta: { isLocalData: true },
      };
    }),

  // ─── 19. aiDspStrategyLocal ────────────────────────────────────
  aiDspStrategyLocal: protectedProcedure
    .input(z.object({ question: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbInstance();
      const rows = await db.select().from(adDspReports).where(eq(adDspReports.userId, ctx.user.id));

      if (rows.length === 0) {
        return { strategy: null, error: '暂无DSP报告数据，请先上传DSP广告报告。' };
      }

      const totalSpends = rows.reduce((s, r) => s + n(r.spends), 0);
      const totalSales = rows.reduce((s, r) => s + n(r.sales), 0);
      const totalOrders = rows.reduce((s, r) => s + (r.orders || 0), 0);
      const totalImpressions = rows.reduce((s, r) => s + (r.impressions || 0), 0);
      const totalClicks = rows.reduce((s, r) => s + (r.clicks || 0), 0);
      const topOrders = rows.sort((a, b) => n(b.spends) - n(a.spends)).slice(0, 10).map(r => `${r.orderName}: 花费$${n(r.spends).toFixed(0)} 销售$${n(r.sales).toFixed(0)} ROAS:${n(r.roas).toFixed(2)}`);

      const summary = `DSP总览: 花费$${totalSpends.toFixed(0)} 销售$${totalSales.toFixed(0)} 订单${totalOrders} 曝光${totalImpressions} 点击${totalClicks} ROAS:${totalSpends>0?(totalSales/totalSpends).toFixed(2):'N/A'}\nTop订单:\n${topOrders.join('\n')}`;

      const response = await invokeLLM({
        messages: [
          { role: 'system', content: '你是亚马逊DSP广告策略专家。基于DSP数据给出优化建议。输出严格JSON格式。' },
          { role: 'user', content: `DSP数据分析：\n${summary}\n${input.question ? `\n用户问题：${input.question}` : ''}\n\n请给出DSP广告优化策略建议。` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'dsp_strategy', strict: true,
            schema: {
              type: 'object',
              properties: {
                analysis: { type: 'string', description: 'DSP整体表现分析' },
                recommendations: { type: 'array', items: { type: 'object', properties: { area: { type: 'string' }, suggestion: { type: 'string' }, priority: { type: 'string' } }, required: ['area','suggestion','priority'], additionalProperties: false } },
                key_metrics: { type: 'object', properties: { roas_assessment: { type: 'string' }, budget_efficiency: { type: 'string' }, audience_quality: { type: 'string' } }, required: ['roas_assessment','budget_efficiency','audience_quality'], additionalProperties: false },
              },
              required: ['analysis','recommendations','key_metrics'],
              additionalProperties: false,
            },
          },
        },
      });
      const content = response.choices?.[0]?.message?.content || '{}';
      try {
        return { strategy: JSON.parse(content), error: null };
      } catch {
        return { strategy: content, error: null };
      }
    }),

  // ─── 20. aiChannelStrategyLocal ────────────────────────────────
  aiChannelStrategyLocal: protectedProcedure
    .input(z.object({
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      question: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDbInstance();
      const conditions: any[] = [eq(adCampaignReports.userId, ctx.user.id)];
      if (input.weekStartDate) conditions.push(gte(adCampaignReports.weekStartDate, input.weekStartDate));
      if (input.weekEndDate) conditions.push(lte(adCampaignReports.weekEndDate, input.weekEndDate));
      const rows = await db.select().from(adCampaignReports).where(and(...conditions));
      const channelMap: Record<string, { cost:number; sales:number; orders:number }> = {};
      for (const r of rows) {
        const ch = (r.adType||'SP').toUpperCase();
        if (!channelMap[ch]) channelMap[ch] = { cost:0, sales:0, orders:0 };
        channelMap[ch].cost += n(r.spend); channelMap[ch].sales += n(r.sales); channelMap[ch].orders += n(r.orders);
      }
      const summary = Object.entries(channelMap).map(([ch,d]) => `${ch}: 花费$${d.cost.toFixed(0)} 销售$${d.sales.toFixed(0)} ACoS:${d.sales>0?((d.cost/d.sales)*100).toFixed(1):'N/A'}%`).join('\n');
      const response = await invokeLLM({
        messages: [
          { role: 'system', content: '你是亚马逊跨渠道广告策略专家。基于SP/SB/SD各渠道数据给出预算分配和策略建议。输出严格JSON格式。' },
          { role: 'user', content: `基于本地上传数据的跨渠道分析：\n${summary}\n${input.question ? `\n用户问题：${input.question}` : ''}\n\n请给出跨渠道预算分配建议和策略优化方向。` },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'channel_strategy', strict: true,
            schema: {
              type: 'object',
              properties: {
                analysis: { type: 'string' },
                channel_recommendations: { type: 'array', items: { type: 'object', properties: { channel: { type: 'string' }, currentShare: { type: 'number' }, suggestedShare: { type: 'number' }, action: { type: 'string' }, reason: { type: 'string' } }, required: ['channel','currentShare','suggestedShare','action','reason'], additionalProperties: false } },
                key_insights: { type: 'array', items: { type: 'string' } },
              },
              required: ['analysis','channel_recommendations','key_insights'],
              additionalProperties: false,
            },
          },
        },
      });
      return JSON.parse(response.choices?.[0]?.message?.content as string);
    }),
});
