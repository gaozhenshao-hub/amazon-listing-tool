import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { getLingxingAdapter } from "../lingxingAdapter";
import { invokeLLM } from "../_core/llm";
import { searchTermActions } from "../../drizzle/schema";
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

// ─── Helper Functions ───────────────────────────────────────────
function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}

// Get all seller SIDs (reuse from operations)
let _sellerCache2: { sids: string[], sellers: any[], ts: number } | null = null;
async function getAllSellerSids(): Promise<{sids: string[], sellers: any[]}> {
  if (_sellerCache2 && Date.now() - _sellerCache2.ts < 300000 && _sellerCache2.sids.length > 0) {
    return { sids: _sellerCache2.sids, sellers: _sellerCache2.sellers };
  }
  const adapter = getLingxingAdapter();
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await adapter.request({ path: "/erp/sc/data/seller/lists" });
      const rawSellers = res.data || [];
      const sellers = Array.isArray(rawSellers) ? rawSellers : (rawSellers as any)?.records || (rawSellers as any)?.list || [];
      const sids = sellers.map((s: any) => String(s.sid));
      if (sids.length > 0) {
        _sellerCache2 = { sids, sellers, ts: Date.now() };
        return { sids, sellers };
      }
      await new Promise(r => setTimeout(r, attempt * 2000));
    } catch (err: any) {
      if (attempt < 3) await new Promise(r => setTimeout(r, attempt * 2000));
    }
  }
  if (_sellerCache2) return { sids: _sellerCache2.sids, sellers: _sellerCache2.sellers };
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
export const adAnalysisRouter = router({

  // ─── Get ASIN List for Selection ──────────────────────────────
  getProductAsins: protectedProcedure
    .input(z.object({ marketplace: z.string().optional() }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 5);
      
      const asinSet = new Map<string, any>();
      for (const sid of sidsToQuery) {
        try {
          // Get product list with ASIN info
          const res = await adapter.requestWithMockFallback({
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
        isMock: adapter.isMockMode(),
      };
    }),

  // ─── 12-Category Search Term Classification ───────────────────
  getSearchTerms12Category: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      marketplace: z.string().optional(),
      days: z.number().optional().default(7),
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
      const adapter = getLingxingAdapter();
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 5);
      const days = input.days || 7;
      const thresholds = { ...DEFAULT_THRESHOLDS, ...input.thresholds };

      // Aggregate search terms over multiple days
      const termAggMap: Record<string, {
        query: string; target_text: string; match_type: string;
        campaign_id: string; ad_group_id: string;
        impressions: number; clicks: number; cost: number;
        sales: number; orders: number; units: number; days_seen: number;
      }> = {};

      for (const sid of sidsToQuery) {
        for (let d = 1; d <= days; d++) {
          const reportDate = getDateNDaysAgo(d);
          try {
            let offset = 0;
            let hasMore = true;
            while (hasMore && offset < 2000) {
              const res = await adapter.requestWithMockFallback({
                path: "/pb/openapi/newad/ad/queryWordReports",
                body: { sid, report_date: reportDate, target_type: "keyword", offset, length: 200 },
                headers: { "X-API-VERSION": "2" },
              });
              const rawData = res.data || [];
              const items = Array.isArray(rawData) ? rawData : (rawData as any).records || [];
              
              for (const item of items) {
                // Filter by ASIN if specified
                if (input.campaignId && item.campaign_id && String(item.campaign_id) !== input.campaignId) continue;
                
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
              hasMore = items.length >= 200;
              offset += 200;
            }
          } catch (err: any) {
            // Skip failed days
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

      return {
        searchTerms,
        categoryStats,
        categories: TWELVE_CATEGORIES,
        thresholds,
        days,
        total: searchTerms.length,
        isMock: adapter.isMockMode(),
      };
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
      days: z.number().optional().default(7),
      campaignId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);
      const days = input.days || 7;

      const placementAgg: Record<string, {
        placement: string; impressions: number; clicks: number;
        cost: number; sales: number; orders: number;
      }> = {};

      for (const sid of sidsToQuery) {
        for (let d = 1; d <= days; d++) {
          const reportDate = getDateNDaysAgo(d);
          try {
           const res = await adapter.requestWithMockFallback({
              path: "/pb/openapi/newad/Groups/placementReports",
              body: { sid, report_date: reportDate, show_detail: 0, offset: 0, length: 200 },
            });
            const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
            for (const item of items) {
              if (input.campaignId && String(item.campaign_id) !== input.campaignId) continue;
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
          } catch (err: any) {
            // Skip
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

      return { placements, days, isMock: adapter.isMockMode() };
    }),

  // ─── Hourly Ad Data (for Dayparting Strategy) ─────────────────
  getAdHourlyData: protectedProcedure
    .input(z.object({
      marketplace: z.string().optional(),
      days: z.number().optional().default(7),
      campaignId: z.string().optional(),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);
      const days = input.days || 7;

      // Aggregate hourly data
      const hourlyAgg: Record<number, {
        hour: number; impressions: number; clicks: number;
        cost: number; sales: number; orders: number;
      }> = {};
      for (let h = 0; h < 24; h++) {
        hourlyAgg[h] = { hour: h, impressions: 0, clicks: 0, cost: 0, sales: 0, orders: 0 };
      }

      for (const sid of sidsToQuery) {
        for (let d = 1; d <= days; d++) {
          const reportDate = getDateNDaysAgo(d);
          try {
            const body: any = { report_date: reportDate };
            if (input.campaignId) body.campaign_id = Number(input.campaignId);
            else body.sid = sid;
            
            const res = await adapter.requestWithMockFallback({
              path: "/pb/openapi/newad/spCampaignHourData",
              body,
              headers: { "X-API-VERSION": "2" },
            });
            const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
            for (const item of items) {
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

      return { hourlyData, days, isMock: adapter.isMockMode() };
    }),

  // ─── Order Hourly Heatmap (ASIN360) ───────────────────────────
  getOrderHourlyHeatmap: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      marketplace: z.string().optional(),
      days: z.number().optional().default(7),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsStr = sids.slice(0, 5).join(',');
      const dateEnd = getDateNDaysAgo(1);
      const dateStart = getDateNDaysAgo(input.days || 7);
      try {
        const body: any = {
          sids: sidsStr,
          date_start: dateStart,
          date_end: dateEnd,
          summary_field: "campaign",
        };
        if (input.campaignId) body.summary_field_value = input.campaignId;;

        const res = await adapter.requestWithMockFallback({
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

        return { heatmapData, isMock: adapter.isMockMode() };
      } catch (err: any) {
        console.warn(`[OrderHeatmap] Error: ${err.message}`);
        return { heatmapData: [], isMock: adapter.isMockMode() };
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
      marketplace: z.string().optional(),
      days: z.number().optional().default(30),
    }))
    .mutation(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);

      // Collect campaign data for diagnosis
      let totalImpressions = 0, totalClicks = 0, totalCost = 0, totalSales = 0, totalOrders = 0;
      let campaignCount = 0;
      
      for (const sid of sidsToQuery) {
        for (let d = 1; d <= Math.min(input.days || 30, 30); d++) {
          try {
            const res = await adapter.requestWithMockFallback({
            path: "/pb/openapi/newad/d/spCampaignReports",
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
      marketplace: z.string().optional(),
      days: z.number().optional().default(7),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);
      const days = input.days || 7;

      const targetAgg: Record<string, {
        target_id: string; targeting_type: string; targeting_expression: string;
        impressions: number; clicks: number; cost: number; sales: number; orders: number;
      }> = {};

      for (const sid of sidsToQuery) {
        for (let d = 1; d <= days; d++) {
          try {
            const res = await adapter.requestWithMockFallback({
              path: "/erp/sp/api/v2/reports/targets",
              body: { sid, report_date: getDateNDaysAgo(d), show_detail: 0, offset: 0, length: 200 },
            });
            const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
            for (const item of items) {
              const key = `${item.target_id}||${item.targeting_expression}`;
              if (targetAgg[key]) {
                targetAgg[key].impressions += Number(item.impressions) || 0;
                targetAgg[key].clicks += Number(item.clicks) || 0;
                targetAgg[key].cost += Number(item.cost) || 0;
                targetAgg[key].sales += Number(item.sales) || 0;
                targetAgg[key].orders += Number(item.orders) || 0;
              } else {
                targetAgg[key] = {
                  target_id: String(item.target_id || ''),
                  targeting_type: item.targeting_type || '',
                  targeting_expression: item.targeting_expression || '',
                  impressions: Number(item.impressions) || 0,
                  clicks: Number(item.clicks) || 0,
                  cost: Number(item.cost) || 0,
                  sales: Number(item.sales) || 0,
                  orders: Number(item.orders) || 0,
                };
              }
            }
          } catch {}
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
      return { targets, days, isMock: adapter.isMockMode() };
    }),

  // ─── Word Frequency Attribute 6-Category Analysis (Tab 4) ────
  getWordFrequencyAnalysis: protectedProcedure
    .input(z.object({
        campaignId: z.string().optional(),
      marketplace: z.string().optional(),
      days: z.number().optional().default(7),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 5);
      const days = input.days || 7;
      // Collect all search terms for this campaign
      const allTerms: Array<{
        query: string; impressions: number; clicks: number;
        cost: number; sales: number; orders: number;
      }> = [];

      for (const sid of sidsToQuery) {
        for (let d = 1; d <= Math.min(days, 30); d++) {
          try {
            const body: any = { sid, report_date: getDateNDaysAgo(d), offset: 0, length: 500 };
            if (input.campaignId) body.campaign_id = input.campaignId;
            const res = await adapter.requestWithMockFallback({
              path: "/erp/sp/query/queryUserSearchTerm",
              body,
            });
            const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
            for (const item of items) {
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

      return { attributes: attributes.slice(0, 200), categoryStats, totalWords: attributes.length, days, isMock: adapter.isMockMode() };
    }),

  // ─── Effective Converting Search Terms Discovery (Tab 8) ─────
  getEffectiveSearchTerms: protectedProcedure
    .input(z.object({
      campaignId: z.string().optional(),
      marketplace: z.string().optional(),
      days: z.number().optional().default(30),
    }))
    .query(async ({ input }) => {
      const adapter = getLingxingAdapter();
      const { sellers } = await getAllSellerSids();
      const sids = filterSidsByMarketplace(sellers, input.marketplace);
      const sidsToQuery = sids.map(Number).slice(0, 3);
      const days = input.days || 30;

      // Step 1: Get all search terms with ad data
      const adTerms: Record<string, {
        query: string; impressions: number; clicks: number;
        cost: number; sales: number; orders: number; isAdvertised: boolean;
      }> = {};

      for (const sid of sidsToQuery) {
        for (let d = 1; d <= Math.min(days, 30); d++) {
          try {
            const body: any = { sid, report_date: getDateNDaysAgo(d), offset: 0, length: 500 };
            if (input.campaignId) body.campaign_id = input.campaignId;
            const res = await adapter.requestWithMockFallback({
              path: "/erp/sp/query/queryUserSearchTerm",
              body,
            });
            const items = Array.isArray(res.data) ? res.data : (res.data as any)?.records || [];
            for (const item of items) {
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
              // If it has cost > 0, it's an advertised term
              if ((Number(item.cost) || 0) > 0) adTerms[q].isAdvertised = true;
            }
          } catch {}
        }
      }

      // Step 2: Get keyword reports (what we're actively targeting)
      const targetedKeywords = new Set<string>();
      for (const sid of sidsToQuery) {
        try {
          const res = await adapter.requestWithMockFallback({
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
        isMock: adapter.isMockMode(),
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
});
