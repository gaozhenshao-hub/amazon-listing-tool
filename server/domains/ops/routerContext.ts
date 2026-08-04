import { failUnavailableDataSource } from "@shared/_core/errors";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../../_core/trpc";
import { protectedProcedure } from "./workspaceProcedure";
import { getDb } from "./repository";
import { invokeLLM } from "../../_core/llm";
import { collectConversionData, collectMultipleAsins, type ConversionCrawlData } from "./service";
import { scoreAllCheckItems, type CheckItemScore } from "./service";
import { parseSellerSpriteData, parseSellerSpriteXlsx, mergeSellerSpriteWithCrawlData, buildCrawlDataFromSellerSprite, type SellerSpriteProductData, type ImportResult } from "./service";
import { resolveDataUserId } from "./service";
import {
  productProfiles, productVariants, productTodos, productLogs,
  keywordMonitors, keywordSnapshots,
  opsPlans, opsPlanActions, opsPlanSummaries,
  conversionComparisons, conversionCheckItems, conversionScores, conversionSuggestions, checkItemOverrides,
  executionReviews, teamTasks,
  productWeeklyOps, productMonthlySummary, productBasicInfo,
  lingxingProductWeekly,
  operatorNameMappings,
  opsImportHistory,
} from "./schema";
import { competitorMonitors, competitorSnapshots } from "../../../drizzle/schema/ads";
import { users } from "../../../drizzle/schema/auth";
import { eq, desc, and, or, sql, asc, isNull, inArray } from "drizzle-orm";
import { ContextScopedCache } from "../../infrastructure/cache/scopedCache";
import { currentOpsCacheScope } from "./workspaceContext";

export {
  TRPCError,
  and,
  asc,
  buildCrawlDataFromSellerSprite,
  checkItemOverrides,
  collectConversionData,
  collectMultipleAsins,
  competitorMonitors,
  competitorSnapshots,
  conversionCheckItems,
  conversionComparisons,
  conversionScores,
  conversionSuggestions,
  desc,
  eq,
  executionReviews,
  getDb,
  inArray,
  invokeLLM,
  isNull,
  keywordMonitors,
  keywordSnapshots,
  lingxingProductWeekly,
  mergeSellerSpriteWithCrawlData,
  operatorNameMappings,
  opsImportHistory,
  opsPlanActions,
  opsPlanSummaries,
  opsPlans,
  or,
  parseSellerSpriteData,
  parseSellerSpriteXlsx,
  productBasicInfo,
  productLogs,
  productMonthlySummary,
  productProfiles,
  productTodos,
  productVariants,
  productWeeklyOps,
  protectedProcedure,
  resolveDataUserId,
  router,
  scoreAllCheckItems,
  sql,
  teamTasks,
  users,
  z,
};
export type {
  CheckItemScore,
  ConversionCrawlData,
  ImportResult,
  SellerSpriteProductData,
};

// ============== Scoring Progress Tracking ==============
export type ScoringProgress = {
  status: 'running' | 'done' | 'error';
  scored: number;
  total: number;
  message: string;
};
export const scoringProgressMap = new ContextScopedCache<ScoringProgress>({
  namespace: "ops.scoring.progress",
  visibility: "user",
  defaultTtlMs: 10 * 60 * 1000,
  maxEntries: 500,
}, () => currentOpsCacheScope("user"));
// ═══════════════════════════════════════════════════════
// Helper functions
// ═══════════════════════════════════════════════════════

// Seller cache shared across all productOps procedures
export const SELLER_CACHE_TTL = 5 * 60 * 1000; // 5 minutes
export const _productOpsSellerCache = new ContextScopedCache<any[]>({
  namespace: "ops.sellers",
  visibility: "workspace",
  defaultTtlMs: SELLER_CACHE_TTL,
  maxEntries: 100,
}, () => currentOpsCacheScope("workspace"));

export async function getCachedSellers(adapter: any): Promise<any[]> {
  const cached = _productOpsSellerCache.get("seller-list");
  if (cached) return cached;
  try {
    const res = failUnavailableDataSource();
    const sellersRaw = res.data || [];
    const sellers = Array.isArray(sellersRaw) ? sellersRaw : (sellersRaw as any)?.records || (sellersRaw as any)?.list || [];
    _productOpsSellerCache.set("seller-list", sellers);
    return sellers;
  } catch (err: any) {
    console.warn(`[ProductOps] Seller list fetch error: ${err.message}`);
    return _productOpsSellerCache.get("seller-list") || [];
  }
}

export const MARKETPLACE_MID_MAP: Record<string, number[]> = {
  'US': [1], 'UK': [4], 'DE': [5], 'FR': [6], 'IT': [7], 'ES': [8], 'JP': [9], 'AU': [10], 'CA': [2], 'MX': [3],
};

export async function findMatchedSid(adapter: any, product: { storeName: string | null; marketplace: string | null }): Promise<{ matchedSid: number | string; matchedMid: number; sellers: any[] }> {
  const sellers = await getCachedSellers(adapter);
  let matchedSid: number | string = 1;
  let matchedMid: number = 1; // default US
  const matched = sellers.find((s: any) =>
    (product.storeName && (s.name === product.storeName || s.wname === product.storeName || s.account_name === product.storeName)) ||
    (product.marketplace && (s.marketplace === product.marketplace || (MARKETPLACE_MID_MAP[product.marketplace] || []).includes(s.mid)))
  );
  if (matched) {
    matchedSid = matched.sid;
    matchedMid = matched.mid || (product.marketplace ? (MARKETPLACE_MID_MAP[product.marketplace]?.[0] || 1) : 1);
  } else if (product.marketplace) {
    matchedMid = MARKETPLACE_MID_MAP[product.marketplace]?.[0] || 1;
  }
  return { matchedSid, matchedMid, sellers };
}

export function getToday(): string {
  return new Date().toISOString().split("T")[0];
}
export function getYesterday(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().split("T")[0];
}
export function getDateNDaysAgo(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().split("T")[0];
}
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Mock crawl data generator (will be replaced by real crawler)
export function generateMockCrawlData(asin: string): Record<string, any> {
  return {
    "标题": { text: `Premium Product ${asin} - High Quality Item for Home Use`, charCount: 65, hasBrand: true },
    "五点描述": { bulletCount: 5, avgCharCount: 220, hasEmoji: false, hasPainPoints: true },
    "长描述": { hasHtml: true, charCount: 1500, hasKeywords: true },
    "搜索词": { charCount: 200, keywordCount: 15 },
    "价格": { price: 29.99, listPrice: 39.99, hasCoupon: true, couponPercent: 10, hasDeal: false },
    "变体": { variantCount: 4, hasImages: true, naming: "Color" },
    "配送": { isFBA: true, deliveryDays: 2 },
    "退货": { policy: "30-day return", freeReturn: true },
    "产品信息": { completeness: 85, hasWeight: true, hasDimensions: true },
    "商品文档": { hasManual: true, hasCertification: false },
    "主图": { imageCount: 7, hasVideo: true, mainImageSize: "2000x2000", hasLifestyle: true, hasInfographic: true },
    "流量闭环": { hasNewModel: false, hasBundleDeal: true, hasSponsoredAd: true },
    "品牌故事": { hasBrandStory: true, hasRecommendation: true },
    "A+": { hasAPlus: true, moduleCount: 7, hasComparisonChart: true, hasVideo: false },
    "Post": { postCount: 15, frequency: "3/week", avgLikes: 12 },
    "Video": { videoCount: 2, totalDuration: 120, hasProductDemo: true },
    "Q&A": { questionCount: 45, answeredPercent: 92, avgUpvotes: 5 },
    "Review": { rating: 4.3, reviewCount: 1250, hasVine: true, topNegativeOnFirstPage: false },
    "店铺介绍": { feedbackScore: 96, hasStorefront: true },
    "广告": { adSpend: 500, acos: 22, roas: 4.5, campaignCount: 8 },
  };
}

// Default 129 check items (18 categories)
export function getDefault129CheckItems() {
  const items: Array<{ categoryIndex: number; categoryName: string; subDimension: string; standard: string; sortOrder: number }> = [];
  let order = 0;

  // 1. 标题 (10项)
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "可读性", standard: "没有语法错误，逻辑通顺，符合北美用户阅读习惯，避免关键词堆砌，合理使用断句", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "文字、数字、标点符号规范使用", standard: "数字表达使用阿拉伯数字，字母大小写的统一性，标点符号合理使用，测量单位需完整拼写（6 inches 而不是 6\"）", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "字数", standard: "对应类目要充分使用标题字符数", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "内容", standard: "包含核心产品卖点、功能、参数及使用场景、特定用户人群", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "关键词", standard: "确保标题包含1-2个核心关键词（如\"power bank\"、\"portable charger\"）", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "词序", standard: "核心卖点词前置, 使消费者更易抓住重点信息，突出产品重点，强调突出产品优势点", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "套装产品", standard: "多件商品组合销售，清晰表述pack数量", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "流量词", standard: "关键词筛选与市场和产品相符合的流量词，长尾词和卖点有机结合", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "品牌词", standard: "品牌有一定知名度，突出品牌词", sortOrder: order++ });
  items.push({ categoryIndex: 1, categoryName: "标题", subDimension: "节日", standard: "加入特定节日词", sortOrder: order++ });
  // 2. 五点 (15项)
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "可读性", standard: "没有语法错误，逻辑通顺，符合北美用户阅读习惯，避免关键词堆砌，合理使用断句", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "文字、数字、标点符号规范使用", standard: "数字表达使用阿拉伯数字，字母大小写的统一性，标点符号合理使用，测量单位需完整拼写（6 inches 而不是 6\"）", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "排版", standard: "字数及式样统一", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "卖点顺序", standard: "一条一个核心卖点，卖点表达清楚，突出主要功能，客户关注点/核心卖点/特殊说明点进行前置", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "小标题", standard: "小标题简短清晰，帮助用户归纳总结卖点", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "FABE法则", standard: "对每个卖点都进行FABE思考罗列，提炼用户最关心的点以及最切中他们利益点的卖点", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "构化格式", standard: "卖点+解答  采用结构化格式，让信息一目了然", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "用户心理学", standard: "符合大众用户心理学，例如：厌恶损失、从众心理", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "常问问题？", standard: "通过评价、Q&A、品牌分析识别高频问题并在五点中5个回答", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "数据对比", standard: "使用量化数据（如\"轻30%\"、\"充电快2倍\"、\"比Anker多1年\"）", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "场景", standard: "要点中自然融入使用场景（如\"办公室\"、\"旅行\"、\"健身房\"）", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "信任背书", standard: "符合大众用户心理学，例如：厌恶损失、从众心理", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "质保与售后", standard: "包含数据背书（如\"50000+五星评价\"）或权威背书（如\"FCC认证\"）", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "流量词", standard: "定期更新ARA排名快速上升的相关长尾词", sortOrder: order++ });
  items.push({ categoryIndex: 2, categoryName: "五点", subDimension: "易于AI理解", standard: "Listing中含有used for, capable of, is a, cause这4种关系的表达（注意：不一定是含有这4个关键词），最容易生成高质量的知识，因为带有这些关系的上下文最容易让算法理解，所以优先抓取这类信息。", sortOrder: order++ });
  // 3. 标 (6项)
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "销量标：BS/AC/NR", standard: "BS/AC/NR标实际上利用的也是用户购物时的社会影响，BS/AC/NR标代表的也是该词/类目下大家都在买的产品推荐，利用从众，提升点击和转化（别人都在买的，我不知道买什么，那我也试试） ●BS标：短期内可以通过切换类目节点获得best seller 标，长期须以所在类目的bs1为目标，增加转化、点击 ●AC标：Amazon Choice：产品定位、主图及自然关键词、广告关键词重合度高才易获得 ●NR标：New Release。新品上架90天内通过迅速推广，获得同类新品第一，提高点击、转化", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "活动标：BD/LD/DOTD/PD/黑五/网一", standard: "LD期间，控制进度条至80+% ●DEAL标：DOTD、BD、LD活动标志，通过活动价格提升转化率", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "促销标：coupon/prime会员折扣/30day low price/code", standard: "通过不同的折扣工具设定会有相应的标识出现，引导用户购买折扣商品 ●降价标：30天内最低价可获得。正红色，醒目，比一般折扣标更为有效，是短时间推广提升转化的利器 ●Coupon标：可按百分比、固定折扣金额两种方式设置", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "服务标：ship from amazon/sold by amazon", standard: "亚马逊配送和销售会增加顾客的信任度", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "其他标：环保标/alexa", standard: "欧美用户比较关注生态健康，具有环保标志会提升用户认可度，work with alexa是智能产品适配alexa的认证标", sortOrder: order++ });
  items.push({ categoryIndex: 3, categoryName: "标", subDimension: "叠加效应", standard: "越多越好（BS的情况下，又有AC，且本周进行7DD（活动标），以及coupon），promotion", sortOrder: order++ });
  // 4. 价格 (11项)
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "划线价格", standard: "通过设置合理的list price，获得划线价格，满足消费者占便宜的心理需求", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "价格组合", standard: "通过设置prime，coupon，code，promotion，B2B等多种价格组合方式，加大价格优惠力度。并在确保运营目标达成前提下，获得最佳转化率（优惠卷名称以英文产品名称+优惠）", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "单只价格", standard: "通过单只价格的设置加大价格感知和对比，给消费者更直观的价格感受", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "市场/竞品定价：参考市场/竞品的定价区间，以略低于竞品的价格获取转化率优势", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "活动定价：考虑DOTD、7DD、LD的活动价格折扣，在活动期间提升产品转化", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "成本定价：参考产品毛利成本进行定价", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "父体内价格策略：父体内不同子体形成一定的合理的价格差，设置低价引流款，提升转化", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "定价尾数：不同地区客户偏好的定价尾数不一样，USA地区偏好尾数9，CA地区偏好尾数7", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "定价策略", standard: "整数关口：利用消费者心理，设置9.99的整数关口，加大价格优惠感知", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "购物车价格", standard: "新品跟卖老品，通过设置更低的新品价格来获取购物车，提升转化", sortOrder: order++ });
  items.push({ categoryIndex: 4, categoryName: "价格", subDimension: "高/低客单价区间对价格的敏感度", standard: "客单价高/低的产品价格敏感度区间不一样，因此不同幅度的价格调整对转化的提升也是不一样的。考虑产品客单价的高低，把握价格敏感度来提升转化", sortOrder: order++ });
  // 5. 限购 (3项)
  items.push({ categoryIndex: 5, categoryName: "限购", subDimension: "限购", standard: "商品限购也会造成饥饿感", sortOrder: order++ });
  items.push({ categoryIndex: 5, categoryName: "限购", subDimension: "限购", standard: "商品限购会影响买家多套下单，尤其是企业买家的大批量购买需求", sortOrder: order++ });
  items.push({ categoryIndex: 5, categoryName: "限购", subDimension: "限购", standard: "对于不同产品、不同库存灵活运用是否限购提升转化", sortOrder: order++ });
  // 6. 配送 (3项)
  items.push({ categoryIndex: 6, categoryName: "配送", subDimension: "配送方式", standard: "FBA优于FBM", sortOrder: order++ });
  items.push({ categoryIndex: 6, categoryName: "配送", subDimension: "配送时效", standard: "FBM发货配送时效缩短，设置处理时间和头程发货仓库库存分布。", sortOrder: order++ });
  items.push({ categoryIndex: 6, categoryName: "配送", subDimension: "不低于$25的商品", standard: "避免让客户承担配送费/亚马逊多次收尾程费", sortOrder: order++ });
  // 7. 变体 (5项)
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体数量", standard: "符合亚马逊规则要求，不宜过多，造成选择障碍", sortOrder: order++ });
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体名称", standard: "清晰易懂，不产生理解误差，减少决策阻碍", sortOrder: order++ });
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体图片", standard: "分类直观展现，方便理解变体间差异，减少决策阻碍（多种产品属性叠加命名，有可能利于提升转化，但属于违规行为不建议使用）", sortOrder: order++ });
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体逻辑", standard: "父体结构合理，变体结构有逻辑并符合消费者习惯", sortOrder: order++ });
  items.push({ categoryIndex: 7, categoryName: "变体", subDimension: "变体价格", standard: "保证PC端和手机端均能清晰表达", sortOrder: order++ });
  // 8. 产品信息 (3项)
  items.push({ categoryIndex: 8, categoryName: "产品信息", subDimension: "完整性", standard: "更多的产品详细信息，既利于客户检索产品参数与自己需求是否匹配，也能体现卖家专业性，不出现误导顾客的信息", sortOrder: order++ });
  items.push({ categoryIndex: 8, categoryName: "产品信息", subDimension: "正确性", standard: "产品描述与实际一致，减少售后问题和产品审核风险", sortOrder: order++ });
  items.push({ categoryIndex: 8, categoryName: "产品信息", subDimension: "合规性", standard: "不出现亚马逊违规信息", sortOrder: order++ });
  // 9. 商品文档 (2项)
  items.push({ categoryIndex: 9, categoryName: "商品文档", subDimension: "产品介绍/安装文档", standard: "添加产品使用说明等文案以解决顾客问题，关心安装的用户可以快速看到安装手册", sortOrder: order++ });
  items.push({ categoryIndex: 9, categoryName: "商品文档", subDimension: "检测报告/安全认证", standard: "满足平台合规，提升专业度和客户信任度", sortOrder: order++ });
  // 10. 主图 (22项)
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "图片像素、清晰度、留白比例", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "主图场景化，让消费者有获得感和满足感，知道使用效果，体现产品差异化", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "家具白底图通过相关配件和装饰品提升图片的视觉效果", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "特定卖点 通过放大卖点细节来呈现", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "多功能家具不同摆放角度的测试最佳方案", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "首图", standard: "加入节日素材", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "一图一卖点，展示尽可能全面", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "顺序按用户最关心的卖点重要等级排序", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "卖点呈现直观，不需要用户二次思考理解", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "文字简洁、语序语法正确", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "文案大小合适，适合阅读（手机、PC）", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "更多场景（符合当地，符合使用习惯）增加代入感", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "元素可视化，不要有过多的文字堆积", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "是否有尺寸/规格对比图，用参照物（如手机、信用卡）展示产品大小", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "更贴近真实安装场景的场景图，避免过于高大上脱离实际", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "品牌调性一致", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "反光、阴影、背景色、产品摆放位置", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "辅图", standard: "借助参考物直观反映出产品尺寸大小", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "视频", standard: "视频时长：30-60s", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "视频", standard: "视频数量：2-5个", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "视频", standard: "视频类型：安装视频、品牌视频、卖点视频、用户自拍视频", sortOrder: order++ });
  items.push({ categoryIndex: 10, categoryName: "主图", subDimension: "季节版、假日版、大促版", standard: "针对特定季节、假日、大促设计专属图片", sortOrder: order++ });
  // 11. 流量闭环 (6项)
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "新版本关联", standard: "新品绑定到老品New Model, 提升转化", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "新版本关联", standard: "占坑，防止流量丢失（另一个角度的提高转化）", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "新版本关联", standard: "新版本价格更高，提升本品转化", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "捆绑，buy together", standard: "配套产品捆绑销售，提高转化（羽毛球/羽毛球拍）", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "捆绑，buy together", standard: "设置捆绑优惠，提高转化", sortOrder: order++ });
  items.push({ categoryIndex: 11, categoryName: "流量闭环", subDimension: "定位广告", standard: "有但有临界值；在临界值内占据更多坑位，提升整体转化", sortOrder: order++ });
  // 12. 品牌故事 (4项)
  items.push({ categoryIndex: 12, categoryName: "品牌故事", subDimension: "关联产品推荐", standard: "流量闭环，色调风格统一", sortOrder: order++ });
  items.push({ categoryIndex: 12, categoryName: "品牌故事", subDimension: "品牌形象", standard: "品牌背书-认证，成绩展示", sortOrder: order++ });
  items.push({ categoryIndex: 12, categoryName: "品牌故事", subDimension: "卖点介绍", standard: "核心卖点多次加强输出", sortOrder: order++ });
  items.push({ categoryIndex: 12, categoryName: "品牌故事", subDimension: "卖家介绍", standard: "体现专业性，讲述品牌理念和产品设计初衷", sortOrder: order++ });
  // 13. A+ (13项)
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "整体性", standard: "符合品牌调性，色调风格统一，弱化页面的切片感，遵循图片逻辑，更多品牌化特色", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "兼顾PC和手机端用户体验", standard: "在电脑端及移动端均能让顾客流畅浏览，避免图片展示不到位卖点表达不清晰的问题", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "卖点展示形式更多样", standard: "需要包含的板块（banner+核心卖点+场景集合+问答+流量闭环框+安装视频（可选）+品牌化视频等）巧用模块，提升A+观感和可玩性；模块服务于卖点，有空间做更多更详细的卖点表达，避免卖点堆砌重复", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "是否包含对比图表？", standard: "制作与竞品的参数对比表，突出核心优势", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "是否设计了清晰的故事线？", standard: "A+内容应有逻辑：吸引→展示卖点→解决疑虑→建立信任", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "页面更大，场景化", standard: "让买家身临其境，提高对产品的信任与喜爱", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "视频", standard: "智能产品可以放很多功能的介绍操作视频，帮助用户直观感受产品功能；也可以上传卖点视频来动态宣传每一个卖点", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "售后方式", standard: "亚马逊对视频审核较弱，视频最后几秒附上售后方式，提高客户售后联系频率", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "QA", standard: "将买家关注的热点问题突出展示，让顾客一目了然，在收到前就能解决相关问题", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "产品闭环", standard: "关联产品推荐、同类产品推荐", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "卖点痛点补充", standard: "补充额外的顾客痛点及关注点，进一步提升顾客下单的可能性", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "卖点对比", standard: "进一步加强卖点体现，让顾客在对比中明确能够获得的利益点", sortOrder: order++ });
  items.push({ categoryIndex: 13, categoryName: "A+", subDimension: "图片像素清晰度", standard: "图片展示清晰，提升页面美观性，增加顾客的好感度", sortOrder: order++ });
  // 14. Video (4项)
  items.push({ categoryIndex: 14, categoryName: "Video", subDimension: "主图视频", standard: "视频风格形式统一一致", sortOrder: order++ });
  items.push({ categoryIndex: 14, categoryName: "Video", subDimension: "主图视频", standard: "视频剪辑节奏符合产品调性", sortOrder: order++ });
  items.push({ categoryIndex: 14, categoryName: "Video", subDimension: "主图视频", standard: "包含产品的重要卖点，消费者的痛点", sortOrder: order++ });
  items.push({ categoryIndex: 14, categoryName: "Video", subDimension: "主图视频", standard: "有吸引力的开头，点赞数大于>3", sortOrder: order++ });
  // 15. Q&A (7项)
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "回复内容形式", standard: "文字回复和视频回复并行", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "点赞", standard: "核心消费者卖点痛点前置-QA点赞", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "数量", standard: "要有一定数量，让用户感知产品有讨论，有热度", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "及时性", standard: "要及时回复，积极解决顾客问题", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "专业性", standard: "用词专业，解决问题的一步到位", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "埋词量", standard: "更多的长尾词，属性词，获得更多搜索权重", sortOrder: order++ });
  items.push({ categoryIndex: 15, categoryName: "Q&A", subDimension: "回复账号", standard: "每条QA卖家买家都有回复，回复数量大于3", sortOrder: order++ });
  // 16. Review (5项)
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "vine", standard: "vine评论内容丰富，图文并茂+视频，比正常留评更有价值", sortOrder: order++ });
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "种子链接", standard: "确保推广期间前台搜索页面4.6分以上", sortOrder: order++ });
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "首页无差评", standard: "绝大部分用户习惯浏览第一页的评论", sortOrder: order++ });
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "关键词标签", standard: "通过用户体验打造形成关键词标签", sortOrder: order++ });
  items.push({ categoryIndex: 16, categoryName: "Review", subDimension: "售后服务", standard: "用户针对售后服务的好评提及率高会提升高客单产品的转化率", sortOrder: order++ });
  // 17. 店铺介绍页面 (2项)
  items.push({ categoryIndex: 17, categoryName: "店铺介绍页面", subDimension: "Feedback", standard: "Feedback分数越高越好，无法删除的要去回复提升店铺形象", sortOrder: order++ });
  items.push({ categoryIndex: 17, categoryName: "店铺介绍页面", subDimension: "店铺介绍", standard: "店铺介绍有专业性，重点突出对于消费者权益的重视，提供售前售后电话/邮箱方便联系", sortOrder: order++ });
  // 18. 广告 (8项)
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "关键词词库", standard: "筛选出高转化关键词并建立关键词词库", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "广告分析", standard: "竞争对手流量，广告架构，策略分析", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "广告架构", standard: "【自动+手动(三种品牌方式)+长尾广泛+定位+品牌闭环】", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "时间表现", standard: "针对核心关键词做分时竞价和分时预算", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "标AC", standard: "不断提升关键词权重，做好AC标获取计划", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "广告优化", standard: "周度对ara排名进行跟进，有提升但未投放词及时进行测试，转化率差，cpa高的词，寻找合适的位置捡漏，或逐步淘汰。", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "广告测试", standard: "定期收录新的关键词，进行不同广告投放词的测试，持续提升产品的曝光，点击数据", sortOrder: order++ });
  items.push({ categoryIndex: 18, categoryName: "广告", subDimension: "关键数据跟踪", standard: "定期追踪广告关键词的不同位置的转化率，曝光量", sortOrder: order++ });  return items;
}
