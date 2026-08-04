import { z } from "zod";

import { invokeLLM } from "../../../_core/llm";

import { router } from "../../../_core/trpc";
import { protectedProcedure } from "../../ops/workspaceProcedure";

import { getDb } from "../../../repositories/dbClient";

import { eq, desc, and, sql } from "drizzle-orm";

import { budgetTracking } from "../../../../drizzle/schema";
import { workspaceIdFromContext } from "../../../services/securityGovernance";
import { opsWorkspaceCondition, withOpsWorkspace } from "../../../repositories/ops";
import { ContextScopedCache } from "../../../infrastructure/cache/scopedCache";
import { currentOpsCacheScope } from "../../ops/workspaceContext";

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
const CACHE_TTL = 5 * 60 * 1000;
const _queryCache = new ContextScopedCache<any>({
  namespace: "ads.analysis.query",
  visibility: "workspace",
  defaultTtlMs: CACHE_TTL,
  maxEntries: 100,
}, () => currentOpsCacheScope("workspace"));

function getCached<T>(key: string): T | null {
  return _queryCache.get(key) as T | null;
}

function setCache(key: string, data: any): void {
  _queryCache.set(key, data);
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

export { z, invokeLLM, protectedProcedure, router, getDb, eq, desc, and, sql, budgetTracking, workspaceIdFromContext, opsWorkspaceCondition, withOpsWorkspace, ClassificationThresholds, DEFAULT_THRESHOLDS, TWELVE_CATEGORIES, classifySearchTerm, anonymizeForAI, deAnonymizeResults, _queryCache, CACHE_TTL, getCached, setCache, parallelBatch, getDateNDaysAgo, getDatesInRange, resolveDateRange, getAllSellerSids, MARKETPLACE_MAP, filterSidsByMarketplace };
