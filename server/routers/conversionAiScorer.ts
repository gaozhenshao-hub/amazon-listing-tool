/**
 * 转化率对比 — AI评分引擎
 * 
 * 职责：基于采集到的 ConversionCrawlData，调用LLM对每个检查项进行结构化评分。
 * 
 * 评分策略：
 * 1. 可程序化判断的项（字数、评论数、Prime标识等）→ 直接计算，不调用LLM
 * 2. 需要AI分析的项（可读性、卖点顺序、FABE法则等）→ 按类别批量调用LLM
 * 3. 需要图片分析的项（主图质量、A+视觉效果等）→ 调用LLM视觉分析
 * 
 * 核心理念："AI是助手，人是决策者" — AI评分仅作为初始建议，用户可编辑确认
 */

import { invokeLLM } from "../_core/llm";
import type { ConversionCrawlData } from "./conversionDataCollector";

// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

export interface CheckItemScore {
  checkItemId: number;
  categoryName: string;
  subDimension: string;
  score: number | null;  // 1-5分，null表示无数据无法评分
  reason: string;        // 评分理由或无数据提示
  rawData: string;       // 用于评分的原始数据（JSON）
  /** 评分来源：programmatic=程序计算，ai=AI分析，no_data=无数据 */
  source: "programmatic" | "ai" | "no_data";
}

interface CheckItemDef {
  id: number;
  categoryName: string;
  subDimension: string;
  standard: string;
  categoryIndex: number;
  sortOrder: number;
}

// ═══════════════════════════════════════════════════════════════
// Programmatic Scoring (不需要AI的检查项)
// ═══════════════════════════════════════════════════════════════

/**
 * 尝试对检查项进行程序化评分
 * 返回 null 表示需要AI评分
 */
function tryProgrammaticScore(
  item: CheckItemDef,
  data: ConversionCrawlData
): { score: number | null; reason: string; rawData: string } | null {
  const cat = item.categoryName;
  const sub = item.subDimension;

  // ── 标题：字数 ──
  if (cat === "标题" && sub === "字数") {
    const { charCount } = data.categories.标题;
    const rawData = JSON.stringify({ charCount, text: data.categories.标题.text.substring(0, 100) });
    if (charCount === 0) return { score: null, reason: "未获取到标题数据，请手动评分", rawData };
    if (charCount >= 150 && charCount <= 200) return { score: 5, reason: `标题${charCount}字符，充分利用了字符数限制（150-200最佳）`, rawData };
    if (charCount >= 120 && charCount < 150) return { score: 4, reason: `标题${charCount}字符，较好但可进一步扩展`, rawData };
    if (charCount >= 80 && charCount < 120) return { score: 3, reason: `标题${charCount}字符，有较大优化空间`, rawData };
    if (charCount > 200) return { score: 3, reason: `标题${charCount}字符，超出推荐长度，可能被截断`, rawData };
    return { score: 2, reason: `标题仅${charCount}字符，严重不足`, rawData };
  }

  // ── 标题：品牌词 ──
  if (cat === "标题" && sub === "品牌词") {
    const { hasBrand, brand, text } = data.categories.标题;
    const rawData = JSON.stringify({ hasBrand, brand, titlePreview: text.substring(0, 80) });
    if (!brand) return { score: null, reason: "未检测到品牌信息，请手动评分", rawData };
    if (hasBrand) return { score: 5, reason: `品牌"${brand}"已包含在标题中`, rawData };
    return { score: 2, reason: `品牌"${brand}"未出现在标题中`, rawData };
  }

  // ── 五点：数量检查（隐含在排版等项中） ──
  // 五点的大部分项目需要AI分析，但我们可以检查基础数据
  
  // ── 标：各类标签 ──
  if (cat === "标" && sub.includes("BS/AC/NR")) {
    const b = data.categories.标;
    const rawData = JSON.stringify({ hasBestSeller: b.hasBestSeller, hasAmazonChoice: b.hasAmazonChoice, hasNewRelease: b.hasNewRelease });
    let count = 0;
    if (b.hasBestSeller) count++;
    if (b.hasAmazonChoice) count++;
    if (b.hasNewRelease) count++;
    if (count >= 2) return { score: 5, reason: `拥有${count}个销量标（BS/AC/NR），表现优秀`, rawData };
    if (count === 1) return { score: 4, reason: `拥有1个销量标，建议争取更多`, rawData };
    return { score: 2, reason: "未获得任何销量标（BS/AC/NR），需要重点提升", rawData };
  }

  if (cat === "标" && sub.includes("活动标")) {
    const b = data.categories.标;
    const rawData = JSON.stringify({ hasDeal: b.hasDeal, dealInfo: b.dealInfo });
    if (b.hasDeal) return { score: 5, reason: `当前有活动标：${b.dealInfo || "Deal"}`, rawData };
    return { score: 3, reason: "当前无活动标，建议策划促销活动", rawData };
  }

  if (cat === "标" && sub.includes("促销标")) {
    const b = data.categories.标;
    const rawData = JSON.stringify({ hasCoupon: b.hasCoupon, couponInfo: b.couponInfo });
    if (b.hasCoupon) return { score: 5, reason: `当前有促销标：${b.couponInfo || "Coupon"}`, rawData };
    return { score: 3, reason: "当前无促销标（Coupon/Prime折扣等），建议设置", rawData };
  }

  if (cat === "标" && sub.includes("服务标")) {
    const d = data.categories.配送;
    const rawData = JSON.stringify({ isFBA: d.isFBA, hasPrime: d.hasPrime, shipsFrom: d.shipsFrom });
    if (d.isFBA) return { score: 5, reason: "FBA配送，拥有Amazon配送和销售标识", rawData };
    return { score: 2, reason: "非FBA配送，缺少Amazon配送标识", rawData };
  }

  if (cat === "标" && sub.includes("叠加效应")) {
    const b = data.categories.标;
    const rawData = JSON.stringify({ totalBadges: b.totalBadges });
    if (b.totalBadges >= 4) return { score: 5, reason: `拥有${b.totalBadges}个标签叠加，转化提升效果显著`, rawData };
    if (b.totalBadges >= 3) return { score: 4, reason: `拥有${b.totalBadges}个标签叠加，效果良好`, rawData };
    if (b.totalBadges >= 2) return { score: 3, reason: `仅${b.totalBadges}个标签，建议增加更多`, rawData };
    return { score: 2, reason: `仅${b.totalBadges}个标签，叠加效应弱`, rawData };
  }

  // ── 价格：划线价格 ──
  if (cat === "价格" && sub === "划线价格") {
    const p = data.categories.价格;
    const rawData = JSON.stringify({ currentPrice: p.currentPrice, listPrice: p.listPrice, hasStrikethrough: p.hasStrikethrough, discountPercent: p.discountPercent });
    if (p.hasStrikethrough && p.discountPercent) {
      if (p.discountPercent >= 20 && p.discountPercent <= 40) return { score: 5, reason: `划线价格折扣${p.discountPercent}%，折扣幅度合理且有吸引力`, rawData };
      if (p.discountPercent >= 10) return { score: 4, reason: `划线价格折扣${p.discountPercent}%，有一定吸引力`, rawData };
      if (p.discountPercent > 40) return { score: 3, reason: `划线价格折扣${p.discountPercent}%，折扣过大可能影响品牌形象`, rawData };
      return { score: 3, reason: `划线价格折扣仅${p.discountPercent}%，感知不够强`, rawData };
    }
    return { score: 2, reason: "无划线价格，缺少价格优惠感知", rawData };
  }

  // ── 价格：购物车价格 ──
  if (cat === "价格" && sub === "购物车价格") {
    const p = data.categories.价格;
    const rawData = JSON.stringify({ buyBoxPrice: p.buyBoxPrice, currentPrice: p.currentPrice });
    if (p.buyBoxPrice) return { score: 4, reason: `已获得购物车，价格$${p.buyBoxPrice}`, rawData };
    return { score: null, reason: "未检测到购物车价格信息，请手动评分", rawData };
  }

  // ── 配送 ──
  if (cat === "配送" && sub === "配送方式") {
    const d = data.categories.配送;
    const rawData = JSON.stringify({ isFBA: d.isFBA, isFBM: d.isFBM });
    if (d.isFBA) return { score: 5, reason: "FBA配送，物流体验最佳", rawData };
    return { score: 2, reason: "FBM配送，建议转为FBA提升转化", rawData };
  }

  if (cat === "配送" && sub === "配送时效") {
    const d = data.categories.配送;
    const rawData = JSON.stringify({ deliveryDays: d.deliveryDays, deliveryText: d.deliveryText });
    if (d.deliveryDays !== null) {
      if (d.deliveryDays <= 2) return { score: 5, reason: `配送时效${d.deliveryDays}天，极速配送`, rawData };
      if (d.deliveryDays <= 5) return { score: 4, reason: `配送时效${d.deliveryDays}天，较快`, rawData };
      return { score: 3, reason: `配送时效${d.deliveryDays}天，建议优化`, rawData };
    }
    return { score: null, reason: "未获取到配送时效信息，请手动评分", rawData };
  }

  // ── 变体：数量 ──
  if (cat === "变体" && sub === "变体数量") {
    const v = data.categories.变体;
    const rawData = JSON.stringify({ variantCount: v.variantCount, variantTypes: v.variantTypes });
    if (v.variantCount === 0) return { score: null, reason: "未检测到变体信息，请手动评分", rawData };
    if (v.variantCount >= 3 && v.variantCount <= 10) return { score: 5, reason: `${v.variantCount}个变体，数量合理`, rawData };
    if (v.variantCount > 10 && v.variantCount <= 20) return { score: 4, reason: `${v.variantCount}个变体，数量较多但可接受`, rawData };
    if (v.variantCount > 20) return { score: 3, reason: `${v.variantCount}个变体，过多可能造成选择障碍`, rawData };
    return { score: 3, reason: `仅${v.variantCount}个变体，可考虑增加`, rawData };
  }

  // ── 变体：图片 ──
  if (cat === "变体" && sub === "变体图片") {
    const v = data.categories.变体;
    const rawData = JSON.stringify({ hasImages: v.hasImages, variantCount: v.variantCount });
    if (v.variantCount === 0) return { score: null, reason: "未检测到变体信息，请手动评分", rawData };
    if (v.hasImages) return { score: 5, reason: "变体有独立图片，方便区分", rawData };
    return { score: 2, reason: "变体缺少独立图片，不利于区分", rawData };
  }

  // ── 产品信息：完整性 ──
  if (cat === "产品信息" && sub === "完整性") {
    const info = data.categories.产品信息;
    const rawData = JSON.stringify({ fieldCount: info.fieldCount, hasWeight: info.hasWeight, hasDimensions: info.hasDimensions });
    if (info.fieldCount >= 10) return { score: 5, reason: `产品信息${info.fieldCount}个字段，非常完整`, rawData };
    if (info.fieldCount >= 6) return { score: 4, reason: `产品信息${info.fieldCount}个字段，较完整`, rawData };
    if (info.fieldCount >= 3) return { score: 3, reason: `产品信息仅${info.fieldCount}个字段，建议补充`, rawData };
    return { score: 2, reason: `产品信息仅${info.fieldCount}个字段，严重不足`, rawData };
  }

  // ── 商品文档 ──
  if (cat === "商品文档" && sub.includes("安装文档")) {
    const doc = data.categories.商品文档;
    const rawData = JSON.stringify({ hasManual: doc.hasManual, documentCount: doc.documentCount });
    if (doc.hasManual) return { score: 5, reason: "已上传产品使用/安装文档", rawData };
    return { score: 2, reason: "未上传产品使用/安装文档", rawData };
  }

  if (cat === "商品文档" && sub.includes("检测报告")) {
    const doc = data.categories.商品文档;
    const rawData = JSON.stringify({ hasCertification: doc.hasCertification, documentTypes: doc.documentTypes });
    if (doc.hasCertification) return { score: 5, reason: "已上传检测报告/安全认证", rawData };
    return { score: 2, reason: "未上传检测报告/安全认证", rawData };
  }

  // ── 主图：视频数量 ──
  if (cat === "主图" && sub === "视频" && item.standard.includes("数量")) {
    const img = data.categories.主图;
    const rawData = JSON.stringify({ videoCount: img.videoCount });
    if (img.videoCount >= 3) return { score: 5, reason: `${img.videoCount}个视频，数量充足`, rawData };
    if (img.videoCount >= 2) return { score: 4, reason: `${img.videoCount}个视频，建议增加`, rawData };
    if (img.videoCount >= 1) return { score: 3, reason: `仅${img.videoCount}个视频，建议增加`, rawData };
    return { score: 1, reason: "无视频，强烈建议添加产品视频", rawData };
  }

  // ── Review：评论数量 ──
  if (cat === "Review" && sub.includes("首页无差评")) {
    const r = data.categories.Review;
    const rawData = JSON.stringify({ rating: r.rating, reviewCount: r.reviewCount, topReviewCount: r.topReviews.length });
    // 需要AI分析首页评论内容
    return null;
  }

  // ── Q&A：数量 ──
  if (cat === "Q&A" && sub === "数量") {
    const qa = data.categories["Q&A"];
    const rawData = JSON.stringify({ questionCount: qa.questionCount });
    if (qa.questionCount >= 50) return { score: 5, reason: `${qa.questionCount}个Q&A，数量充足，热度高`, rawData };
    if (qa.questionCount >= 20) return { score: 4, reason: `${qa.questionCount}个Q&A，数量较好`, rawData };
    if (qa.questionCount >= 10) return { score: 3, reason: `${qa.questionCount}个Q&A，建议增加`, rawData };
    if (qa.questionCount >= 1) return { score: 2, reason: `仅${qa.questionCount}个Q&A，数量不足`, rawData };
    return { score: 1, reason: "无Q&A，建议主动提问增加热度", rawData };
  }

  // ── 广告：关键词词库 ──
  if (cat === "广告" && sub === "关键词词库") {
    const ad = data.categories.广告;
    const rawData = JSON.stringify({ keywordCount: ad.keywordCount, topKeywords: ad.topKeywords.slice(0, 5) });
    if (ad.keywordCount >= 50) return { score: 5, reason: `${ad.keywordCount}个广告关键词，词库丰富`, rawData };
    if (ad.keywordCount >= 20) return { score: 4, reason: `${ad.keywordCount}个广告关键词，较好`, rawData };
    if (ad.keywordCount >= 5) return { score: 3, reason: `${ad.keywordCount}个广告关键词，建议扩充`, rawData };
    return { score: 2, reason: `仅${ad.keywordCount}个广告关键词，词库不足`, rawData };
  }

  // 默认返回null，需要AI评分
  return null;
}

// ═══════════════════════════════════════════════════════════════
// AI Batch Scoring (按类别批量评分)
// ═══════════════════════════════════════════════════════════════

/**
 * 构建类别数据摘要，用于AI评分的上下文
 */
function buildCategoryContext(categoryName: string, data: ConversionCrawlData): string {
  const cat = data.categories;

  switch (categoryName) {
    case "标题":
      return `【标题数据】
标题全文：${cat.标题.text}
字符数：${cat.标题.charCount}
单词数：${cat.标题.wordCount}
品牌：${cat.标题.brand}
品牌是否在标题中：${cat.标题.hasBrand}`;

    case "五点":
      return `【五点描述数据】
五点数量：${cat.五点.bulletCount}
${cat.五点.bullets.map((b, i) => `第${i + 1}点（${cat.五点.charCounts[i]}字符）：${b}`).join("\n")}
平均字符数：${cat.五点.avgCharCount}`;

    case "标":
      return `【标签数据】
BS标：${cat.标.hasBestSeller}
AC标：${cat.标.hasAmazonChoice}
NR标：${cat.标.hasNewRelease}
Deal标：${cat.标.hasDeal}（${cat.标.dealInfo || "无"}）
Coupon标：${cat.标.hasCoupon}（${cat.标.couponInfo || "无"}）
Prime标：${cat.标.hasPrime}
Subscribe&Save：${cat.标.hasSubscribeSave}
环保标：${cat.标.hasClimateTag}
小企业标：${cat.标.hasSmallBusiness}
标签总数：${cat.标.totalBadges}`;

    case "价格":
      return `【价格数据】
当前价格：$${cat.价格.currentPrice || "未知"}
划线价格：$${cat.价格.listPrice || "无"}
折扣比例：${cat.价格.discountPercent || 0}%
有Coupon：${cat.价格.hasCoupon}（${cat.价格.couponValue || "无"}）
Subscribe&Save：${cat.价格.hasSubscribeSave}
单位价格：${cat.价格.unitPrice || "无"}
购物车价格：$${cat.价格.buyBoxPrice || "未知"}
价格尾数：${cat.价格.priceEnding || "未知"}`;

    case "限购":
      return `【限购数据】
是否限购：${cat.限购.hasLimit}
限购数量：${cat.限购.limitQuantity || "无"}
限购说明：${cat.限购.limitText || "无"}`;

    case "配送":
      return `【配送数据】
FBA：${cat.配送.isFBA}
FBM：${cat.配送.isFBM}
配送天数：${cat.配送.deliveryDays || "未知"}
配送说明：${cat.配送.deliveryText || "无"}
Prime：${cat.配送.hasPrime}
免运费：${cat.配送.hasFreeShipping}
发货方：${cat.配送.shipsFrom || "未知"}
销售方：${cat.配送.soldBy || "未知"}`;

    case "变体":
      return `【变体数据】
变体数量：${cat.变体.variantCount}
变体类型：${cat.变体.variantTypes.join(", ") || "无"}
有独立图片：${cat.变体.hasImages}
变体列表：${cat.变体.variants.map(v => `${v.name}${v.price ? `($${v.price})` : ""}`).join(", ") || "无"}`;

    case "产品信息":
      return `【产品信息数据】
字段数：${cat.产品信息.fieldCount}
有重量：${cat.产品信息.hasWeight}
有尺寸：${cat.产品信息.hasDimensions}
有材质：${cat.产品信息.hasMaterial}
有颜色：${cat.产品信息.hasColor}
有制造商：${cat.产品信息.hasManufacturer}
字段列表：${Object.entries(cat.产品信息.fields).map(([k, v]) => `${k}: ${v}`).join("\n") || "无"}`;

    case "商品文档":
      return `【商品文档数据】
有使用手册：${cat.商品文档.hasManual}
有认证报告：${cat.商品文档.hasCertification}
文档数量：${cat.商品文档.documentCount}
文档类型：${cat.商品文档.documentTypes.join(", ") || "无"}`;

    case "主图":
      return `【主图数据】
主图数量：${cat.主图.mainImageCount}
辅图数量：${cat.主图.secondaryImageCount}
A+图片数量：${cat.主图.aplusImages.length}
品牌故事图片数量：${cat.主图.brandStoryImages.length}
视频数量：${cat.主图.videoCount}
总图片数量：${cat.主图.totalImageCount}
主图URL：${cat.主图.mainImages.map(img => img.url).join("\n") || "无"}
辅图URL：${cat.主图.secondaryImages.slice(0, 6).map(img => img.url).join("\n") || "无"}`;

    case "流量闭环":
      return `【流量闭环数据】
新版本关联：${cat.流量闭环.hasNewModel}
捆绑销售：${cat.流量闭环.hasBundleDeal}
经常一起购买：${cat.流量闭环.hasFrequentlyBought}
赞助商品：${cat.流量闭环.hasSponsoredProducts}
虚拟捆绑：${cat.流量闭环.hasVirtualBundle}
品牌旗舰店链接：${cat.流量闭环.hasBrandStoreLink}`;

    case "品牌故事":
      return `【品牌故事数据】
有品牌故事：${cat.品牌故事.hasBrandStory}
有关联推荐：${cat.品牌故事.hasRecommendation}
图片数量：${cat.品牌故事.imageCount}
文案内容：${cat.品牌故事.textContent.substring(0, 500) || "无"}`;

    case "A+":
      return `【A+内容数据】
有A+：${cat["A+"].hasAplus}
模块数量：${cat["A+"].moduleCount}
模块类型：${cat["A+"].moduleTypes.join(", ") || "未知"}
有对比图表：${cat["A+"].hasComparisonChart}
有视频：${cat["A+"].hasVideo}
图片数量：${cat["A+"].imageCount}
文案内容：${cat["A+"].textContent.substring(0, 500) || "无"}`;

    case "Video":
      return `【视频数据】
视频数量：${cat.Video.videoCount}
有主图视频：${cat.Video.hasMainVideo}`;

    case "Q&A":
      return `【Q&A数据】
问题数量：${cat["Q&A"].questionCount}
热门问题：${cat["Q&A"].topQuestions.map(q => `Q: ${q.question} A: ${q.answer} (${q.votes}票)`).join("\n") || "无详细数据"}`;

    case "Review":
      return `【评论数据】
评分：${cat.Review.rating || "未知"}
评论数：${cat.Review.reviewCount || "未知"}
有Vine评论：${cat.Review.hasVine}
评分分布：${JSON.stringify(cat.Review.ratingDistribution) || "未知"}
最新评论摘要：${cat.Review.topReviews.slice(0, 3).map(r => r.substring(0, 100)).join("\n") || "无"}`;

    case "店铺介绍页面":
      return `【店铺数据】
Feedback评分：${cat.店铺介绍页面.feedbackScore || "未知"}
Feedback数量：${cat.店铺介绍页面.feedbackCount || "未知"}
有品牌旗舰店：${cat.店铺介绍页面.hasStorefront}
店铺名称：${cat.店铺介绍页面.storeName || "未知"}`;

    case "广告":
      return `【广告数据】
有广告活动：${cat.广告.hasCampaigns}
活动数量：${cat.广告.campaignCount}
总花费：$${cat.广告.totalSpend || "未知"}
ACOS：${cat.广告.acos || "未知"}%
ROAS：${cat.广告.roas || "未知"}
关键词数量：${cat.广告.keywordCount}
Top关键词：${cat.广告.topKeywords.slice(0, 5).map(k => `${k.keyword}(曝光${k.impressions},点击${k.clicks},ACOS ${k.acos}%)`).join("\n") || "无"}
搜索词：${cat.广告.searchTerms.slice(0, 5).map(t => `${t.term}(曝光${t.impressions},点击${t.clicks},转化${t.conversions})`).join("\n") || "无"}`;

    default:
      return `【${categoryName}】数据不可用`;
  }
}

/**
 * 对一批检查项进行AI评分（同一类别的项目一起评分，减少API调用）
 */
async function aiScoreBatch(
  items: CheckItemDef[],
  categoryName: string,
  data: ConversionCrawlData
): Promise<CheckItemScore[]> {
  if (items.length === 0) return [];

  const context = buildCategoryContext(categoryName, data);
  
  const itemsDescription = items.map((item, idx) => 
    `${idx + 1}. [${item.subDimension}] 评分标准：${item.standard}`
  ).join("\n");

  try {
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

    const response = await invokeLLM({
      messages: [
        {
          role: "system",
          content: `你是一位资深亚马逊运营专家和转化率优化顾问。你需要根据产品页面的实际数据，对每个检查项进行1-5分的评分。

评分标准：
- 5分：完全符合标准，表现优秀
- 4分：基本符合标准，有小幅提升空间
- 3分：一般水平，有明显优化空间
- 2分：存在明显不足，需要改进
- 1分：严重缺失或不合格，需要立即改进

要求：
1. 评分必须基于提供的实际数据，不要凭空猜测
2. 如果数据不足以判断，给3分并说明原因
3. 评分理由要具体、可操作，指出具体的优缺点
4. 理由控制在50字以内，简明扼要

请严格按照JSON数组格式返回，每个元素包含 index（从1开始）、score（1-5整数）、reason（评分理由）。`
        },
        {
          role: "user",
          content: `ASIN: ${data.asin}
类别: ${categoryName}

${context}

请对以下${items.length}个检查项评分：
${itemsDescription}`
        }
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "batch_scores",
          strict: true,
          schema: {
            type: "object",
            properties: {
              scores: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    index: { type: "integer", description: "检查项序号（从1开始）" },
                    score: { type: "integer", description: "评分1-5" },
                    reason: { type: "string", description: "评分理由" },
                  },
                  required: ["index", "score", "reason"],
                  additionalProperties: false,
                },
              },
            },
            required: ["scores"],
            additionalProperties: false,
          },
        },
      },
    });

    const rawContent = response.choices[0]?.message?.content;
    const contentStr = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent);
    const parsed = JSON.parse(contentStr || '{"scores":[]}');
    const aiScores = parsed.scores || [];

    return items.map((item, idx) => {
      const aiScore = aiScores.find((s: any) => s.index === idx + 1);
      const score = aiScore ? Math.min(5, Math.max(1, aiScore.score)) : null;
      const reason = aiScore?.reason || "无数据，请手动评分";
      
      return {
        checkItemId: item.id,
        categoryName: item.categoryName,
        subDimension: item.subDimension,
        score,
        reason,
        rawData: JSON.stringify({ category: categoryName, context: context.substring(0, 200) }),
        source: "ai" as const,
      };
    });
  } catch (err: any) {
    console.warn(`[ConversionAiScorer] AI scoring failed for category ${categoryName}: ${err.message}`);
    // AI评分失败，返回null分数，不生成假评分
    return items.map(item => ({
      checkItemId: item.id,
      categoryName: item.categoryName,
      subDimension: item.subDimension,
      score: null,
      reason: `AI评分失败（${err.message?.substring(0, 30)}），请手动评分`,
      rawData: JSON.stringify({ error: err.message }),
      source: "no_data" as const,
    }));
  }
}

// ═══════════════════════════════════════════════════════════════
// Main Scoring Function
// ═══════════════════════════════════════════════════════════════

/**
 * 对单个ASIN的所有检查项进行评分
 * 
 * 策略：
 * 1. 先尝试程序化评分（快速、确定性高）
 * 2. 剩余项按类别分组，批量调用AI评分
 * 3. 合并结果返回
 */
export async function scoreAllCheckItems(
  checkItems: CheckItemDef[],
  data: ConversionCrawlData,
  onProgress?: (scored: number, total: number) => void
): Promise<CheckItemScore[]> {
  const results: CheckItemScore[] = [];
  const needsAi: Map<string, CheckItemDef[]> = new Map();

  // Step 1: 程序化评分
  for (const item of checkItems) {
    const programmaticResult = tryProgrammaticScore(item, data);
    if (programmaticResult) {
      results.push({
        checkItemId: item.id,
        categoryName: item.categoryName,
        subDimension: item.subDimension,
        score: programmaticResult.score,
        reason: programmaticResult.reason,
        rawData: programmaticResult.rawData,
        source: programmaticResult.score === null ? "no_data" : "programmatic",
      });
    } else {
      // 需要AI评分，按类别分组
      const group = needsAi.get(item.categoryName) || [];
      group.push(item);
      needsAi.set(item.categoryName, group);
    }
  }

  console.log(`[ConversionAiScorer] Programmatic: ${results.length}/${checkItems.length}, AI needed: ${checkItems.length - results.length} items in ${needsAi.size} categories`);
  onProgress?.(results.length, checkItems.length);

  // Step 2: AI批量评分（按类别）
  const categories = Array.from(needsAi.entries());
  for (const [categoryName, items] of categories) {
    const aiResults = await aiScoreBatch(items, categoryName, data);
    results.push(...aiResults);
    onProgress?.(results.length, checkItems.length);
  }

  return results;
}
