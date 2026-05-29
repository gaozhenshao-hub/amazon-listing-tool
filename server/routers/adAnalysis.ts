import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { invokeLLM } from "../_core/llm";
import { searchTermActions, budgetTracking } from "../../drizzle/schema";
import { eq, desc, and, sql } from "drizzle-orm";

// ─── 12-Category Classification Thresholds ──────────────────────
interface ClassificationThresholds {
  highImpressions: number;   // e.g., 1000
  lowImpressions: number;    // e.g., 100
  highCTR: number;           // e.g., 0.5% → 0.005
  lowCTR: number;            // e.g., 0.15% → 0.0015
  highCVR: number;           // e.g., 10% → 0.10
  lowCVR: number;            // e.g., 3% → 0.03
}

const DEFAULT_THRESHOLDS: ClassificationThresholds = {
  highImpressions: 1000,
  lowImpressions: 100,
  highCTR: 0.005,    // 0.5%
  lowCTR: 0.0015,    // 0.15%
  highCVR: 0.10,     // 10%
  lowCVR: 0.03,      // 3%
};

// ─── 12 Category Definitions with 4-part Advice ─────────────────
const TWELVE_CATEGORIES = [
  {
    id: 1, key: "high_imp_high_ctr_high_cvr",
    label: "高曝光_高点击率_高转化", shortLabel: "核心大词",
    condition: "曝光≥高阈值 & 点击率≥高阈值 & 转化率≥高阈值",
    problemAnalysis: "❶ 该搜索词是产品的核心流量词，表现优异\n❷ 需要确保该词的广告位稳定在首页\n❸ 关注竞争对手是否在抢占该词的广告位",
    adPurpose: "稳固核心词地位、保持出单量、控制ACoS在合理范围",
    adStrategy: "❶ 保持当前出价，确保广告位稳定\n❷ 如果ACoS偏高，可适当降低出价观察\n❸ 建议单独开精准匹配广告组，给予充足预算\n❹ 定期检查自然排名，如果自然排名靠前可适当降低广告出价\n❺ 关注该词的竞价趋势，避免被竞品抬价",
    expectedResult: "出单量稳定、ACoS可控、广告位保持首页",
  },
  {
    id: 2, key: "high_imp_high_ctr_low_cvr",
    label: "高曝光_高点击率_低转化", shortLabel: "流量陷阱词",
    condition: "曝光≥高阈值 & 点击率≥高阈值 & 转化率<低阈值",
    problemAnalysis: "❶ 搜索词与产品有一定相关性（点击率高），但转化差\n❷ 可能是Listing页面（价格/图片/Review）竞争力不足\n❸ 搜索词可能过于宽泛，用户意图不够精准\n❹ 竞品在该词上的产品力更强",
    adPurpose: "降低无效花费、提高转化率、优化Listing竞争力",
    adStrategy: "❶ 检查Listing页面是否有优化空间（主图/价格/Review/A+）\n❷ 如果ACoS过高，建议降低出价或暂停\n❸ 考虑用词组匹配替代广泛匹配，缩小流量范围\n❹ 分析该词下的竞品Listing，找出差距\n❺ 如果是策略性抢流量，可保留但需设置预算上限",
    expectedResult: "花费减少、转化率提升或ACoS降低、无效点击减少",
  },
  {
    id: 3, key: "high_imp_low_ctr_high_cvr",
    label: "高曝光_低点击率_高转化", shortLabel: "潜力提升词",
    condition: "曝光≥高阈值 & 点击率<低阈值 & 转化率≥高阈值",
    problemAnalysis: "❶ 搜索词曝光大但点击率低，说明主图/标题/价格在搜索结果中不够吸引\n❷ 转化率高说明产品本身有竞争力，进入详情页后能成交\n❸ 可能是广告位不够靠前，展示位置影响了点击率",
    adPurpose: "提高点击率、获取更多流量、放大转化优势",
    adStrategy: "❶ 优化主图和标题，提高搜索结果页的吸引力\n❷ 适当提高出价，争取更靠前的广告位\n❸ 检查是否有价格优势，考虑Coupon或促销提升点击\n❹ 开启品牌推广(SB)广告，用品牌旗舰店吸引点击\n❺ A/B测试不同的主图，找到点击率最高的版本",
    expectedResult: "点击率上升、点击量增加、出单量显著增长、整体花费可能增加但ACoS可控",
  },
  {
    id: 4, key: "high_imp_low_ctr_low_cvr",
    label: "高曝光_低点击率_低转化", shortLabel: "低效大词",
    condition: "曝光≥高阈值 & 点击率<低阈值 & 转化率<低阈值",
    problemAnalysis: "❶ 搜索词曝光大但点击和转化都差，可能与产品相关性不高\n❷ 产品在该词的搜索结果中缺乏竞争力\n❸ 可能是自动广告匹配到的宽泛词",
    adPurpose: "减少无效花费、评估是否值得继续投放",
    adStrategy: "❶ 如果花费较高且无转化，建议做精准否定\n❷ 如果有少量转化，降低出价观察一段时间\n❸ 检查搜索词与产品的相关性，不相关直接否定\n❹ 如果是类目大词，考虑用词组否定缩小范围\n❺ 将预算转移到表现更好的搜索词上",
    expectedResult: "花费大幅减少、整体ACoS降低、预算释放给高效词",
  },
  {
    id: 5, key: "mid_imp_high_ctr_high_cvr",
    label: "中曝光_高点击率_高转化", shortLabel: "高效精准词",
    condition: "低阈值≤曝光<高阈值 & 点击率≥高阈值 & 转化率≥高阈值",
    problemAnalysis: "❶ 搜索词精准度高，点击和转化都优秀\n❷ 曝光量中等，还有提升空间\n❸ 这类词通常是长尾精准词，竞争相对较小",
    adPurpose: "扩大曝光、增加出单量、保持高效率",
    adStrategy: "❶ 适当提高出价，争取更多曝光和更好的广告位\n❷ 建议添加为精确匹配关键词，单独管理\n❸ 增加每日预算，确保不会因预算不足而错过展示\n❹ 基于该词拓展相似的长尾词\n❺ 监控竞争对手是否开始竞争该词",
    expectedResult: "曝光量增加、出单量增长、ACoS保持低位",
  },
  {
    id: 6, key: "mid_imp_high_ctr_low_cvr",
    label: "中曝光_高点击率_低转化", shortLabel: "需优化转化词",
    condition: "低阈值≤曝光<高阈值 & 点击率≥高阈值 & 转化率<低阈值",
    problemAnalysis: "❶ 搜索词吸引点击但不能转化，Listing页面可能有问题\n❷ 价格、Review、图片等可能不如竞品\n❸ 搜索词可能有歧义，部分用户意图与产品不匹配",
    adPurpose: "提高转化率、降低ACoS、优化Listing",
    adStrategy: "❶ 重点优化Listing详情页（价格/Review/图片/A+）\n❷ 从售价、Review、品牌竞争力、Listing页面竞争力等维度检查\n❸ 如果ACoS过高，降低出价或暂停观察\n❹ 考虑添加Coupon或限时促销提升转化\n❺ 分析竞品在该词下的Listing优势",
    expectedResult: "转化率提升、ACoS降低、单量基本持平或上升",
  },
  {
    id: 7, key: "mid_imp_low_ctr_high_cvr",
    label: "中曝光_低点击率_高转化", shortLabel: "隐藏宝藏词",
    condition: "低阈值≤曝光<高阈值 & 点击率<低阈值 & 转化率≥高阈值",
    problemAnalysis: "❶ 转化率高说明产品匹配度好，但点击率低限制了出单\n❷ 可能是广告位不够靠前或主图不够吸引\n❸ 这类词是潜在的高价值词，值得重点培养",
    adPurpose: "提高点击率、释放转化潜力、增加出单量",
    adStrategy: "❶ 提高出价争取更好的广告位（Top of Search）\n❷ 优化主图和标题中与该搜索词相关的元素\n❸ 开启SB广告增加品牌曝光\n❹ 添加为精确匹配，给予更高出价\n❺ 测试不同的广告创意（如视频广告）",
    expectedResult: "点击率上升、出单量显著增长、ACoS保持低位",
  },
  {
    id: 8, key: "mid_imp_low_ctr_low_cvr",
    label: "中曝光_低点击率_低转化", shortLabel: "观察淘汰词",
    condition: "低阈值≤曝光<高阈值 & 点击率<低阈值 & 转化率<低阈值",
    problemAnalysis: "❶ 点击率和转化率都低，产品与搜索词的匹配度可能不高\n❷ 花费效率低，需要评估是否继续投放\n❸ 可能是自动广告匹配到的边缘词",
    adPurpose: "评估投放价值、减少无效花费",
    adStrategy: "❶ 如果花费>$5且无转化，建议做精准否定\n❷ 如果有少量转化，降低出价到最低观察2周\n❸ 检查搜索词与产品的语义相关性\n❹ 如果完全不相关，直接否定\n❺ 将节省的预算分配给高效词",
    expectedResult: "无效花费减少、整体广告效率提升",
  },
  {
    id: 9, key: "low_imp_high_ctr_high_cvr",
    label: "低曝光_高点击率_高转化", shortLabel: "精准长尾词",
    condition: "曝光<低阈值 & 点击率≥高阈值 & 转化率≥高阈值",
    problemAnalysis: "❶ 极其精准的长尾词，转化效率最高\n❷ 曝光量小限制了出单潜力\n❸ 竞争可能较小，是低成本获客的好机会",
    adPurpose: "扩大曝光、最大化出单、保持高效率",
    adStrategy: "❶ 大幅提高出价，争取Top of Search广告位\n❷ 添加为精确匹配关键词，单独管理\n❸ 增加预算确保全天候展示\n❹ 基于该词拓展更多类似的长尾词\n❺ 在Listing标题和Bullet Points中融入该词",
    expectedResult: "曝光量大幅增加、出单量增长、ACoS保持极低",
  },
  {
    id: 10, key: "low_imp_high_ctr_low_cvr",
    label: "低曝光_高点击率_低转化", shortLabel: "小众吸引词",
    condition: "曝光<低阈值 & 点击率≥高阈值 & 转化率<低阈值",
    problemAnalysis: "❶ 曝光少但点击率高，说明搜索结果中产品展示有吸引力\n❷ 转化低可能是详情页不够有说服力\n❸ 数据量小，结论可能不够可靠",
    adPurpose: "观察数据、优化转化、评估潜力",
    adStrategy: "❶ 数据量不足，建议继续观察至少2周\n❷ 适当提高出价获取更多数据\n❸ 同时优化Listing详情页\n❹ 如果持续无转化，考虑暂停\n❺ 关注该词的搜索量趋势",
    expectedResult: "获取更多数据后再做决策、转化率可能提升",
  },
  {
    id: 11, key: "low_imp_low_ctr_high_cvr",
    label: "低曝光_低点击率_高转化", shortLabel: "冷门精准词",
    condition: "曝光<低阈值 & 点击率<低阈值 & 转化率≥高阈值",
    problemAnalysis: "❶ 搜索量小且点击率低，但进入详情页的用户转化率高\n❷ 可能是非常精准的小众需求词\n❸ 数据量极小，统计意义有限",
    adPurpose: "扩大测试、验证词的真实价值",
    adStrategy: "❶ 提高出价争取更多曝光和点击\n❷ 优化主图提高点击率\n❸ 持续观察2-4周积累数据\n❹ 如果确认转化稳定，加大投入\n❺ 搜索相关的同义词和变体词",
    expectedResult: "数据量增加、验证转化稳定性、可能发现新的精准词群",
  },
  {
    id: 12, key: "low_imp_low_ctr_low_cvr",
    label: "低曝光_低点击率_低转化", shortLabel: "无效词",
    condition: "曝光<低阈值 & 点击率<低阈值 & 转化率<低阈值",
    problemAnalysis: "❶ 各项指标都差，搜索词与产品匹配度极低\n❷ 可能是自动广告匹配到的无关词\n❸ 继续投放只会浪费预算",
    adPurpose: "立即止损、释放预算",
    adStrategy: "❶ 立即做精准否定，停止在该词上的花费\n❷ 如果是ASIN定位词，关闭该投放对象\n❸ 检查自动广告是否需要收紧匹配范围\n❹ 将释放的预算分配给高效词\n❺ 定期清理此类无效词，保持广告账户健康",
    expectedResult: "花费立即减少、整体ACoS降低、预算效率提升",
  },
];

// ─── Classification Function ────────────────────────────────────
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

  // Map to category
  const key = `${impLevel}_imp_${ctrLevel}_ctr_${cvrLevel}_cvr`;
  const cat = TWELVE_CATEGORIES.find(c => c.key === key);
  return cat ? { categoryId: cat.id, categoryKey: cat.key } : { categoryId: 12, categoryKey: "low_imp_low_ctr_low_cvr" };
}

// ─── ASIN Data Anonymization ────────────────────────────────────
function anonymizeForAI(data: any[], asinMap: Map<string, string>): any[] {
  return data.map((item, idx) => {
    const anonId = `Product_${String(idx + 1).padStart(3, '0')}`;
    if (item.asin) asinMap.set(anonId, item.asin);
    const { asin, advertised_asin, sku, ...rest } = item;
    return { ...rest, product_id: anonId };
  });
}

function deAnonymizeResults(results: any[], asinMap: Map<string, string>): any[] {
  return results.map(item => {
    if (item.product_id && asinMap.has(item.product_id)) {
      return { ...item, asin: asinMap.get(item.product_id) };
    }
    return item;
  });
}

// ─── In-Memory Cache (TTL-based) ──────────────────────────────
const _queryCache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCached<T>(key: string): T | null {
  const entry = _queryCache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data as T;
  if (entry) _queryCache.delete(key);
  return null;
}

function setCache(key: string, data: any): void {
  _queryCache.set(key, { data, ts: Date.now() });
  // Evict old entries if cache grows too large
  if (_queryCache.size > 100) {
    const now = Date.now();
    Array.from(_queryCache.entries()).forEach(([k, v]) => {
      if (now - v.ts > CACHE_TTL) _queryCache.delete(k);
    });
  }
}

// ─── Parallel batch helper (controls concurrency) ─────────────
async function parallelBatch<T>(
  tasks: (() => Promise<T>)[],
  concurrency: number = 5
): Promise<T[]> {
  const results: T[] = [];
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return results;
}

// ─── Helper Functions ───────────────────────────────────────────
function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

/** Generate array of YYYY-MM-DD dates from startDate to endDate (inclusive) */
function getDatesInRange(startDate: string, endDate: string): string[] {
  const dates: string[] = [];
  const sd = new Date(startDate);
  const ed = new Date(endDate);
  for (let d = new Date(sd); d <= ed; d.setDate(d.getDate() + 1)) {
    dates.push(d.toISOString().split("T")[0]);
  }
  return dates;
}

/** Resolve date range from input: prefer startDate/endDate, fallback to days-ago logic */
function resolveDateRange(input: { startDate?: string; endDate?: string; days?: number }): string[] {
  if (input.startDate && input.endDate) {
    return getDatesInRange(input.startDate, input.endDate);
  }
  const days = Math.min(input.days || 3, 31);
  const dates: string[] = [];
  for (let d = 1; d <= days; d++) {
    dates.push(getDateNDaysAgo(d));
  }
  return dates;
}

// Get all seller SIDs (reuse from operations)
// Seller SIDs - now sourced from imported data (no API calls)
async function getAllSellerSids(): Promise<{sids: string[], sellers: any[]}> {
  return { sids: [], sellers: [] };
}

const MARKETPLACE_MAP: Record<number, { code: string }> = {
  1: { code: 'US' }, 2: { code: 'CA' }, 3: { code: 'MX' },
  4: { code: 'UK' }, 5: { code: 'DE' }, 6: { code: 'FR' },
  7: { code: 'IT' }, 8: { code: 'ES' }, 9: { code: 'JP' },
  10: { code: 'AU' }, 11: { code: 'IN' }, 12: { code: 'AE' },
};

function filterSidsByMarketplace(sellers: any[], marketplaceCode?: string): string[] {
  if (!marketplaceCode || marketplaceCode === 'ALL') return sellers.map((s: any) => String(s.sid));
  const midEntry = Object.entries(MARKETPLACE_MAP).find(([_, v]) => v.code === marketplaceCode);
  if (!midEntry) return sellers.map((s: any) => String(s.sid));
  const targetMid = Number(midEntry[0]);
  const filtered = sellers.filter((s: any) => Number(s.mid) === targetMid);
  return filtered.length > 0 ? filtered.map((s: any) => String(s.sid)) : sellers.map((s: any) => String(s.sid));
}

// ============== Ad Analysis Router ==============
// Export cache helpers for cross-module ASIN mapping reuse
export { getCached as getAdAnalysisCache, setCache as setAdAnalysisCache };

export const adAnalysisRouter = router({

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
          const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
            path: "/erp/sc/data/mws/listing",
            body: { sid, offset: 0, length: 200 },
          });
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
            const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
              path: searchTermApiPath,
              body: { sid, report_date: reportDate, show_detail: 1, target_type: "keyword", offset, length: 200, ...(hasCampaignFilter && effectiveCampaignIds.length === 1 && !/^C\d+$/.test(effectiveCampaignIds[0]) ? { campaign_id: effectiveCampaignIds[0] } : {}) },
              headers: { "X-API-VERSION": "2" },
            });
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
    }),

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
          return (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
            path: placementApiPath,
            body,
          });
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
          return (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
            path: keywordApiPath,
            body: { sid, report_date: date, offset: 0, length: 1000 },
          });
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
          return (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
            path: placementApiPath,
            body: { sid, report_date: date, show_detail: 1, offset: 0, length: 1000 },
          });
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
            
            const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
              path: hourlyApiPath,
              body,
              headers: { "X-API-VERSION": "2" },
            });
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

        const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
          path: "/basicOpen/salesAnalysis/productPerformance/performanceTrendByHour",
          body,
        });
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
      const response = await invokeLLM({
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
    }),

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
            const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
            path: "/pb/openapi/newad/spCampaignHourData",
              body: { sid, report_date: getDateNDaysAgo(d), show_detail: 0, offset: 0, length: 200 },
              headers: { "X-API-VERSION": "2" },
            });
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

      // AI diagnosis
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
          return (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
            path: targetingApiPath,
            body,
          });
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
            const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
              path: "/erp/sp/query/queryUserSearchTerm",
              body,
            });
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
            const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
              path: "/erp/sp/query/queryUserSearchTerm",
              body,
            });
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
          const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
            path: "/erp/sp/data/getKeywordsReports",
            body: { sid, report_date: getDateNDaysAgo(1), offset: 0, length: 500 },
          });
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
    }),

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
            const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
              path: searchTermApiPath,
              body: { sid, report_date: reportDate, show_detail: 1, target_type: "keyword", offset, length: 200, campaign_id: campaignId },
              headers: { "X-API-VERSION": "2" },
            });
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
              const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
                path: adPath,
                body: {
                  sid,
                  ...(input.state ? { state: input.state } : {}),
                  offset,
                  length: 100,
                },
                headers: { "X-API-VERSION": "2" },
              });
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
              const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
                path: adPath,
                body: { sid, offset, length: 100 },
                headers: { "X-API-VERSION": "2" },
              });
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
              const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
                path: adPath,
                body: { sid, offset: 0, length: 100 },
                headers: { "X-API-VERSION": "2" },
              });
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
              (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
                path: '/pb/openapi/newad/spCampaignHourData',
                body: { campaign_id: Number(cid), report_date: reportDate },
              }).then(res => ({ cid, res })).catch(() => null)
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

      const response = await invokeLLM({
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
    }),

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
          const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
            path: '/pb/openapi/newad/spCampaigns',
            body: { sid, offset: 0, length: 100 },
            headers: { "X-API-VERSION": "2" },
          });
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
              (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
                path: '/pb/openapi/newad/spCampaignHourData',
                body: { campaign_id: Number(cid), report_date: reportDate },
              }).then(res => ({ cid, res })).catch(() => null)
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
                const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
                  path: searchTermApiPath,
                  body: { sid, report_date: reportDate, show_detail: 1, target_type: 'keyword', offset: 0, length: 200, ...(hasCampaignFilter && effectiveCampaignIds.length === 1 ? { campaign_id: effectiveCampaignIds[0] } : {}) },
                  headers: { 'X-API-VERSION': '2' },
                });
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
              const res = await (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
                path: adPath,
                body: { sid, offset: 0, length: 100 },
              });
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
      await db!.insert(budgetTracking).values({
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
      });
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
        .where(eq(budgetTracking.userId, ctx.user.id))
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
        .where(and(eq(budgetTracking.id, input.trackingId), eq(budgetTracking.userId, ctx.user.id)))
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
              (async (..._args: any[]) => ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }))({
                path: '/pb/openapi/newad/spCampaignHourData',
                body: { campaign_id: Number(cid), report_date: reportDate },
              }).then(res => ({ cid, res })).catch(() => null)
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
        const llmRes = await invokeLLM({
          messages: [
            { role: 'system', content: '你是亚马逊广告效果评估专家。请严格按JSON格式输出。' },
            { role: 'user', content: `请评估以下预算调整的执行效果：\n\n基线数据：花费$${Number(record.baselineSpend)||0} | 销售$${Number(record.baselineSales)||0} | ACoS:${baseAcos}% | ROAS:${baseRoas}x\n执行后：花费$${Math.round(totalSpend*100)/100} | 销售$${Math.round(totalSales*100)/100} | ACoS:${followupAcos}% | ROAS:${followupRoas}x\n变化：ACoS ${acosChange>0?'+':''}${acosChange}% | ROAS ${roasChange>0?'+':''}${roasChange}%\n活动数:${campaignIds.length} | 订单:${totalOrders}\n\n请给出简短评价(100字内)和评分(1-100)。` },
          ],
          response_format: {
            type: 'json_schema',
            json_schema: {
              name: 'budget_effect',
              strict: true,
              schema: {
                type: 'object',
                properties: {
                  summary: { type: 'string' },
                  score: { type: 'integer' },
                  recommendation: { type: 'string' },
                },
                required: ['summary', 'score', 'recommendation'],
                additionalProperties: false,
              },
            },
          },
        });
        const parsed = JSON.parse(String(llmRes.choices[0].message.content) || '{}');
        effectSummary = `${parsed.summary}\n\n建议：${parsed.recommendation}`;
        effectScore = Math.max(1, Math.min(100, parsed.score || 50));
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
        .where(eq(budgetTracking.id, input.trackingId));

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
    }),
});
