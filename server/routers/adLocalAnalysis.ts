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
} from "../../drizzle/schema";
import { eq, and, inArray, gte, lte } from "drizzle-orm";

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
    .query(async ({ ctx, input }) => {
      const d = await getDbInstance();
      const thresholds: ClassificationThresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
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

      return { keywords, placementNames, total: keywords.length, isMock: false, isLocalData: true };
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
        const kw = r.keyword || r.targeting || r.searchTerm;
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

      const thresholds = DEFAULT_THRESHOLDS;
      const targets = Object.values(targetMap).map(t => {
        const acos = safePct(t.cost, t.sales);
        const ctr = safePct(t.clicks, t.impressions);
        const cpc = safeDiv(t.cost, t.clicks);
        const cvr = safePct(t.orders, t.clicks);
        const { categoryId, categoryKey } = classifySearchTerm(t.impressions, t.clicks, t.orders, thresholds);
        return { ...t, acos, ctr, cpc, cvr, categoryId, categoryKey };
      });
      targets.sort((a, b) => b.cost - a.cost);

      const categoryStats: Record<number, number> = {};
      for (let i = 1; i <= 9; i++) categoryStats[i] = 0;
      for (const t of targets) {
        const clickLevel = t.clicks >= 10 ? 'high' : t.clicks >= 3 ? 'mid' : 'low';
        const cvr = t.clicks > 0 ? t.orders / t.clicks : 0;
        const cvrLevel = cvr >= 0.10 ? 'high' : cvr >= 0.03 ? 'mid' : 'low';
        const catIdx = ({ high: 0, mid: 1, low: 2 } as any)[clickLevel] * 3 + ({ high: 0, mid: 1, low: 2 } as any)[cvrLevel] + 1;
        categoryStats[catIdx] = (categoryStats[catIdx] || 0) + 1;
      }

      return { targets, categoryStats, total: targets.length, isMock: false, isLocalData: true };
    }),

  // ─── 8. getWordFrequencyLocal ───────────────────────────────────
  getWordFrequencyLocal: protectedProcedure
    .input(z.object({
      campaignNames: z.array(z.string()).optional(),
      parentAsin: z.string().optional(),
      weekStartDate: z.string().optional(),
      weekEndDate: z.string().optional(),
      adType: z.enum(["SP", "SB"]).optional().default("SP"),
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

      // Build categoryStats: group words by performance category
      const categoryStats: Record<number, { count: number; totalImpressions: number; totalClicks: number; totalCost: number; totalSales: number; totalOrders: number }> = {};
      for (const w of words) {
        let cat = 6; // default: 0 conversion <7 clicks
        if (w.orders > 0) {
          const cvr = w.clicks > 0 ? w.orders / w.clicks : 0;
          if (cvr >= 0.1) cat = 1; // high conversion
          else if (cvr >= 0.05) cat = 2; // medium conversion
          else cat = 3; // low conversion
        } else if (w.clicks >= 30) {
          cat = 4; // 0 conversion 30+ clicks
        } else if (w.clicks >= 7) {
          cat = 5; // 0 conversion 7-30 clicks
        }
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
      adType: z.enum(["SP", "SB"]).optional().default("SP"),
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
      adType: z.enum(["SP", "SB"]).optional().default("SP"),
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
});
