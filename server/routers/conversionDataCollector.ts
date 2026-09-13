import { failUnavailableDataSource } from "@shared/_core/errors";
/**
 * 转化率对比 — 数据采集引擎
 * 
 * 职责：为每个ASIN整合已确认Amazon Snapshot、领星API与程序化计算，
 * 输出结构化的 ConversionCrawlData，供AI评分引擎使用。
 * 
 * 数据源：
 * 1. Unified Acquisition — 人工确认的标题/五点/价格/图片/A+/品牌故事/评分
 * 2. 领星ERP API — 广告数据/利润/库存
 * 3. 程序化计算 — 字数统计等确定性指标
 * 排名、Coupon、Deal等监控字段在A8迁移独立Provider前保持“未覆盖”，不得回退旧爬虫。
 */

import { requireDb } from "../repositories/dbClient";
import { findFreshConfirmedSnapshot } from "../domains/acquisition/repository";
import { loadConfirmedSnapshotForConsumer } from "../domains/acquisition/legacyConsumerProjection";
import { resolveStoredObjectUrl } from "../storage";
// ═══════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════

/** 按类别组织的完整爬取数据 */
export interface ConversionCrawlData {
  asin: string;
  crawledAt: string;
  /** 数据采集是否成功（至少有一个数据源返回了有效数据） */
  hasData: boolean;
  /** 各数据源的采集状态 */
  dataSourceStatus: {
    scraper: { success: boolean; error?: string };
    competitor: { success: boolean; error?: string };
    lingxingAd: { success: boolean; error?: string };
    confirmedSnapshot?: { success: boolean; confirmedSnapshotId?: number; error?: string };
  };
  /** 原始爬虫数据（用于AI分析） */
  raw: {
    scraperData: ConfirmedAmazonProductData | null;
    competitorData: null;
    adData: AdData | null;
    confirmedSnapshot?: { id: number; contentHash: string; confirmationVersion: number } | null;
  };
  /** 按18个类别组织的结构化数据（仅当hasData=true时有意义） */
  categories: {
    标题: TitleData;
    五点: BulletPointsData;
    标: BadgeData;
    价格: PriceData;
    限购: PurchaseLimitData;
    配送: DeliveryData;
    变体: VariantData;
    产品信息: ProductInfoData;
    商品文档: ProductDocData;
    主图: ImageData;
    流量闭环: TrafficLoopData;
    品牌故事: BrandStoryData;
    "A+": AplusData;
    Video: VideoData;
    "Q&A": QAData;
    Review: ReviewData;
    店铺介绍页面: StoreData;
    广告: AdCategoryData;
  };
}

export interface ProductImage {
  url: string;
  position: "main" | "secondary" | "aplus" | "brand_story";
  positionIndex: number;
  aplusModuleType?: string;
  aplusModuleClass?: string;
}

export interface ConfirmedAmazonProductData {
  title: string;
  bulletPoints: string[];
  price: string;
  rating: string;
  reviewCount: string;
  description: string;
  brand: string;
  imageUrls: string[];
  images: ProductImage[];
  reviews: string[];
  category: string;
  asin: string;
}

export interface TitleData {
  text: string;
  charCount: number;
  wordCount: number;
  brand: string;
  hasBrand: boolean;
  /** 原始HTML中的标题 */
  rawTitle: string;
}

export interface BulletPointsData {
  bullets: string[];
  bulletCount: number;
  avgCharCount: number;
  totalCharCount: number;
  /** 每条bullet的字符数 */
  charCounts: number[];
}

export interface BadgeData {
  hasBestSeller: boolean;
  hasAmazonChoice: boolean;
  hasNewRelease: boolean;
  hasDeal: boolean;
  dealInfo: string | null;
  hasCoupon: boolean;
  couponInfo: string | null;
  hasPrime: boolean;
  hasSubscribeSave: boolean;
  hasClimateTag: boolean;
  hasSmallBusiness: boolean;
  /** 标签总数 */
  totalBadges: number;
}

export interface PriceData {
  currentPrice: number | null;
  listPrice: number | null;
  hasStrikethrough: boolean;
  discountPercent: number | null;
  hasCoupon: boolean;
  couponValue: string | null;
  hasSubscribeSave: boolean;
  unitPrice: string | null;
  buyBoxPrice: number | null;
  /** 价格尾数 */
  priceEnding: string | null;
}

export interface PurchaseLimitData {
  hasLimit: boolean;
  limitQuantity: number | null;
  limitText: string | null;
}

export interface DeliveryData {
  isFBA: boolean;
  isFBM: boolean;
  deliveryDays: number | null;
  deliveryText: string | null;
  hasPrime: boolean;
  hasFreeShipping: boolean;
  shipsFrom: string | null;
  soldBy: string | null;
}

export interface VariantData {
  variantCount: number;
  variantTypes: string[];
  variants: Array<{
    name: string;
    hasImage: boolean;
    price?: string;
  }>;
  hasImages: boolean;
}

export interface ProductInfoData {
  /** 产品信息表中的字段数 */
  fieldCount: number;
  hasWeight: boolean;
  hasDimensions: boolean;
  hasMaterial: boolean;
  hasColor: boolean;
  hasManufacturer: boolean;
  /** 原始产品信息键值对 */
  fields: Record<string, string>;
}

export interface ProductDocData {
  hasManual: boolean;
  hasCertification: boolean;
  documentCount: number;
  documentTypes: string[];
}

export interface ImageData {
  mainImages: ProductImage[];
  mainImageCount: number;
  hasMainImage: boolean;
  mainImageResolution: string | null;
  secondaryImages: ProductImage[];
  secondaryImageCount: number;
  aplusImages: ProductImage[];
  brandStoryImages: ProductImage[];
  videoCount: number;
  hasVideo: boolean;
  totalImageCount: number;
}

export interface TrafficLoopData {
  hasNewModel: boolean;
  hasBundleDeal: boolean;
  hasFrequentlyBought: boolean;
  hasSponsoredProducts: boolean;
  hasVirtualBundle: boolean;
  hasBrandStoreLink: boolean;
}

export interface BrandStoryData {
  hasBrandStory: boolean;
  coverageStatus?: "confirmed" | "not_returned" | "unknown";
  hasRecommendation: boolean;
  imageCount: number;
  textContent: string;
  images: ProductImage[];
}

export interface AplusData {
  hasAplus: boolean;
  coverageStatus?: "confirmed" | "not_returned" | "unknown";
  moduleCount: number;
  moduleTypes: string[];
  hasComparisonChart: boolean;
  hasVideo: boolean;
  imageCount: number;
  textContent: string;
  images: ProductImage[];
}

export interface VideoData {
  videoCount: number;
  hasMainVideo: boolean;
  videoUrls: string[];
}

export interface QAData {
  questionCount: number;
  /** 前几个Q&A的内容 */
  topQuestions: Array<{
    question: string;
    answer: string;
    votes: number;
  }>;
}

export interface ReviewData {
  rating: number | null;
  reviewCount: number | null;
  hasVine: boolean;
  topReviews: string[];
  /** 评分分布 */
  ratingDistribution: Record<string, number>;
}

export interface StoreData {
  feedbackScore: number | null;
  feedbackCount: number | null;
  hasStorefront: boolean;
  storeName: string | null;
}

export interface AdCategoryData {
  hasCampaigns: boolean;
  campaignCount: number;
  totalSpend: number | null;
  acos: number | null;
  roas: number | null;
  keywordCount: number;
  topKeywords: Array<{
    keyword: string;
    impressions: number;
    clicks: number;
    spend: number;
    acos: number;
  }>;
  searchTerms: Array<{
    term: string;
    impressions: number;
    clicks: number;
    conversions: number;
  }>;
}

// ═══════════════════════════════════════════════════════════════
// HTML Extended Parsing Helpers
// ═══════════════════════════════════════════════════════════════

/**
 * 从产品页面HTML中提取扩展数据（超出scraper.ts基础提取的部分）
 * 包括：变体、配送、限购、产品信息表、商品文档、Q&A、标签等
 */
function parseExtendedProductData(html: string) {
  const cheerio = require("cheerio");
  const $ = cheerio.load(html);

  // ── 变体信息 ──
  const variants: VariantData = {
    variantCount: 0,
    variantTypes: [],
    variants: [],
    hasImages: false,
  };

  // 变体类型（如 Color, Size）
  $("div.a-row.a-spacing-top-small label.a-form-label").each((_: any, el: any) => {
    const label = $(el).text().trim().replace(/:$/, "");
    if (label && !variants.variantTypes.includes(label)) {
      variants.variantTypes.push(label);
    }
  });

  // 变体选项
  $("li[data-defaultasin], li.swatchAvailable, li.swatchSelect").each((_: any, el: any) => {
    const name = $(el).attr("title")?.replace("Click to select ", "") || $(el).text().trim();
    const hasImage = !!$(el).find("img").length;
    const price = $(el).attr("data-dp-url")?.match(/price=([\d.]+)/)?.[1];
    if (name) {
      variants.variants.push({ name, hasImage, price });
      if (hasImage) variants.hasImages = true;
    }
  });
  variants.variantCount = variants.variants.length || 
    $("select#native_dropdown_selected_size_name option, select#native_dropdown_selected_color_name option").length;

  // ── 配送信息 ──
  const deliveryText = $("div#deliveryBlockMessage, div#mir-layout-DELIVERY_BLOCK").text().trim();
  const shipsFrom = $("span:contains('Ships from')").parent().text().replace("Ships from", "").trim()
    || $("div.tabular-buybox-text span:contains('Ships from')").next().text().trim();
  const soldBy = $("span:contains('Sold by')").parent().text().replace("Sold by", "").trim()
    || $("div.tabular-buybox-text span:contains('Sold by')").next().text().trim();
  const isFBA = shipsFrom.toLowerCase().includes("amazon") || deliveryText.toLowerCase().includes("fulfilled by amazon");
  const hasPrime = !!$("i.a-icon-prime, span.a-icon-prime").length;
  const hasFreeShipping = deliveryText.toLowerCase().includes("free") || hasPrime;
  
  // 配送天数
  let deliveryDays: number | null = null;
  const deliveryMatch = deliveryText.match(/(\d+)\s*(?:day|business day)/i);
  if (deliveryMatch) deliveryDays = parseInt(deliveryMatch[1]);

  const delivery: DeliveryData = {
    isFBA,
    isFBM: !isFBA,
    deliveryDays,
    deliveryText: deliveryText.substring(0, 200),
    hasPrime,
    hasFreeShipping,
    shipsFrom: shipsFrom.substring(0, 100) || null,
    soldBy: soldBy.substring(0, 100) || null,
  };

  // ── 限购信息 ──
  const limitText = $("span:contains('limit'), span:contains('Limit')").text().trim();
  const limitMatch = limitText.match(/limit\s*(\d+)/i);
  const purchaseLimit: PurchaseLimitData = {
    hasLimit: !!limitMatch,
    limitQuantity: limitMatch ? parseInt(limitMatch[1]) : null,
    limitText: limitText.substring(0, 200) || null,
  };

  // ── 产品信息表 ──
  const productInfo: Record<string, string> = {};
  // 方式1：表格形式
  $("table.a-keyvalue tr, table.prodDetTable tr").each((_: any, el: any) => {
    const key = $(el).find("th, td.a-span3").first().text().trim();
    const value = $(el).find("td.a-span9, td:last-child").text().trim();
    if (key && value) productInfo[key] = value;
  });
  // 方式2：div形式
  $("div.a-section.a-spacing-small div.a-row").each((_: any, el: any) => {
    const spans = $(el).find("span");
    if (spans.length >= 2) {
      const key = $(spans[0]).text().trim();
      const value = $(spans[1]).text().trim();
      if (key && value && key.length < 50) productInfo[key] = value;
    }
  });

  const productInfoData: ProductInfoData = {
    fieldCount: Object.keys(productInfo).length,
    hasWeight: Object.keys(productInfo).some(k => k.toLowerCase().includes("weight")),
    hasDimensions: Object.keys(productInfo).some(k => k.toLowerCase().includes("dimension") || k.toLowerCase().includes("size")),
    hasMaterial: Object.keys(productInfo).some(k => k.toLowerCase().includes("material")),
    hasColor: Object.keys(productInfo).some(k => k.toLowerCase().includes("color") || k.toLowerCase().includes("colour")),
    hasManufacturer: Object.keys(productInfo).some(k => k.toLowerCase().includes("manufacturer")),
    fields: productInfo,
  };

  // ── 商品文档 ──
  const documentTypes: string[] = [];
  $("div#productDocuments a, div.a-section a[href*='document']").each((_: any, el: any) => {
    const text = $(el).text().trim();
    if (text) documentTypes.push(text);
  });
  const productDoc: ProductDocData = {
    hasManual: documentTypes.some(d => d.toLowerCase().includes("manual") || d.toLowerCase().includes("guide") || d.toLowerCase().includes("instruction")),
    hasCertification: documentTypes.some(d => d.toLowerCase().includes("certif") || d.toLowerCase().includes("safety") || d.toLowerCase().includes("compliance")),
    documentCount: documentTypes.length,
    documentTypes,
  };

  // ── 标签/标志 ──
  const bsrText = $("th:contains('Best Sellers Rank')").next().text()
    || $("span:contains('Best Sellers Rank')").parent().text()
    || $("li#SalesRank").text();
  const hasBestSeller = bsrText.includes("#1 ") || !!$("span.a-badge-text:contains('Best Seller')").length;
  const hasAmazonChoice = !!$("span.ac-badge-text-primary, span:contains(\"Amazon's Choice\")").length;
  const hasNewRelease = !!$("span:contains('New Release'), span.a-badge-text:contains('New')").length;
  const hasDeal = !!$("span.a-badge-text:contains('Deal'), span.dealBadge").length;
  const dealInfo = $("span.a-badge-text:contains('Deal')").text().trim() || $("span.dealBadge").text().trim() || null;
  const hasCoupon = !!$("span.a-coupon-badge, div#couponBadgeRegularVpc").length;
  const couponInfo = $("span.a-coupon-badge, div#couponBadgeRegularVpc").text().trim() || null;
  const hasSubscribeSave = !!$("div#snsAccordionRowMiddle, span:contains('Subscribe & Save')").length;
  const hasClimateTag = !!$("span:contains('Climate Pledge'), img[alt*='Climate']").length;
  const hasSmallBusiness = !!$("span:contains('Small Business'), img[alt*='Small Business']").length;

  let totalBadges = 0;
  if (hasBestSeller) totalBadges++;
  if (hasAmazonChoice) totalBadges++;
  if (hasNewRelease) totalBadges++;
  if (hasDeal) totalBadges++;
  if (hasCoupon) totalBadges++;
  if (hasPrime) totalBadges++;
  if (hasSubscribeSave) totalBadges++;
  if (hasClimateTag) totalBadges++;
  if (hasSmallBusiness) totalBadges++;

  const badges: BadgeData = {
    hasBestSeller, hasAmazonChoice, hasNewRelease,
    hasDeal, dealInfo, hasCoupon, couponInfo,
    hasPrime, hasSubscribeSave, hasClimateTag, hasSmallBusiness,
    totalBadges,
  };

  // ── 价格扩展 ──
  const listPriceText = $("span.a-text-price span.a-offscreen, span.priceBlockStrikePriceString").first().text().trim();
  const listPriceMatch = listPriceText.match(/([\d,.]+)/);
  const listPrice = listPriceMatch ? parseFloat(listPriceMatch[1].replace(/,/g, "")) : null;
  const currentPriceText = $("span.a-price:not(.a-text-price) span.a-offscreen").first().text().trim();
  const currentPriceMatch = currentPriceText.match(/([\d,.]+)/);
  const currentPrice = currentPriceMatch ? parseFloat(currentPriceMatch[1].replace(/,/g, "")) : null;
  const unitPriceText = $("span.a-price[data-a-size='mini'] span.a-offscreen, span:contains('per ')").first().text().trim();

  const priceData: PriceData = {
    currentPrice,
    listPrice,
    hasStrikethrough: !!listPrice && !!currentPrice && listPrice > currentPrice,
    discountPercent: (listPrice && currentPrice && listPrice > currentPrice) 
      ? Math.round((1 - currentPrice / listPrice) * 100) : null,
    hasCoupon,
    couponValue: couponInfo,
    hasSubscribeSave,
    unitPrice: unitPriceText || null,
    buyBoxPrice: currentPrice,
    priceEnding: currentPrice ? currentPrice.toFixed(2).slice(-2) : null,
  };

  // ── 流量闭环 ──
  const hasNewModel = !!$("div:contains('Newer model'), a:contains('newer version')").length;
  const hasBundleDeal = !!$("div#bundleV2_feature_div, div:contains('Bundle')").length;
  const hasFrequentlyBought = !!$("div#sims-fbt, div:contains('Frequently bought together')").length;
  const hasSponsoredProducts = !!$("div#sp_detail, div.sp_desktop_content").length;
  const hasVirtualBundle = !!$("div:contains('Virtual Bundle')").length;
  const hasBrandStoreLink = !!$("a#bylineInfo[href*='/stores/'], a[href*='brandId=']").length;

  const trafficLoop: TrafficLoopData = {
    hasNewModel, hasBundleDeal, hasFrequentlyBought,
    hasSponsoredProducts, hasVirtualBundle, hasBrandStoreLink,
  };

  // ── Q&A 基础数据 ──
  const qaCountText = $("a[href*='ask/questions'] span, span#askATFLink span").text().trim();
  const qaCountMatch = qaCountText.match(/([\d,]+)/);
  const questionCount = qaCountMatch ? parseInt(qaCountMatch[1].replace(/,/g, "")) : 0;

  const qaData: QAData = {
    questionCount,
    topQuestions: [], // Q&A详情需要单独爬取
  };

  // ── Review扩展 ──
  const ratingDistribution: Record<string, number> = {};
  $("table#histogramTable tr").each((_: any, el: any) => {
    const star = $(el).find("td:first-child").text().trim();
    const pctText = $(el).find("td:last-child").text().trim();
    const pctMatch = pctText.match(/(\d+)%/);
    if (star && pctMatch) {
      ratingDistribution[star] = parseInt(pctMatch[1]);
    }
  });
  const hasVine = !!$("span.a-badge-text:contains('Vine'), i.a-icon-vine").length;

  // ── 店铺信息 ──
  const storeName = $("a#sellerProfileTriggerId").text().trim() || soldBy || null;
  const feedbackText = $("div#seller-feedback-summary").text().trim();
  const feedbackMatch = feedbackText.match(/(\d+)%/);

  const storeData: StoreData = {
    feedbackScore: feedbackMatch ? parseInt(feedbackMatch[1]) : null,
    feedbackCount: null,
    hasStorefront: !!$("a#bylineInfo[href*='/stores/']").length,
    storeName,
  };

  // ── Video ──
  const videoCount = $("div.a-section video, div#altImages li.videoThumbnail, li.videoBlockIngress").length;
  const hasMainVideo = videoCount > 0;

  return {
    variants,
    delivery,
    purchaseLimit,
    productInfoData,
    productDoc,
    badges,
    priceData,
    trafficLoop,
    qaData,
    ratingDistribution,
    hasVine,
    storeData,
    videoCount,
    hasMainVideo,
  };
}

// ═══════════════════════════════════════════════════════════════
// Ad Data Collection (from Lingxing)
// ═══════════════════════════════════════════════════════════════

interface AdData {
  campaigns: any[];
  keywords: any[];
  searchTerms: any[];
  productReports: any[];
}

async function collectAdData(asin: string, sid?: number): Promise<AdData | null> {
  try {
    // 并行获取广告数据
    const [campaignsRes, keywordsRes, searchTermsRes, productReportsRes] = await Promise.allSettled([
      failUnavailableDataSource(),
      failUnavailableDataSource(),
      failUnavailableDataSource(),
      failUnavailableDataSource(),
    ]);

    return {
      campaigns: campaignsRes.status === "fulfilled" ? (campaignsRes.value.data || []) : [],
      keywords: keywordsRes.status === "fulfilled" ? (keywordsRes.value.data || []) : [],
      searchTerms: searchTermsRes.status === "fulfilled" ? (searchTermsRes.value.data || []) : [],
      productReports: productReportsRes.status === "fulfilled" ? (productReportsRes.value.data || []) : [],
    };
  } catch (err: any) {
    console.warn(`[ConversionCollector] Failed to collect ad data for ${asin}: ${err.message}`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
// Main Collection Function
// ═══════════════════════════════════════════════════════════════

export interface CollectionOptions {
  /** 领星seller ID（用于广告数据） */
  sid?: number;
  /** 是否跳过广告数据采集 */
  skipAds?: boolean;
  /** @deprecated 仅兼容旧调用签名；统一采集不接受消费者代理配置。 */
  proxyUrl?: string;
  /** Amazon详情只允许读取该工作空间的Confirmed Snapshot。 */
  workspaceId?: number;
}

/**
 * 为单个ASIN采集完整的转化率对比数据
 * 
 * 流程：
 * 1. 读取当前工作空间的Confirmed Snapshot与已确认S3资产
 * 2. 调用领星API获取广告数据
 * 3. 整合为结构化的 ConversionCrawlData
 */
export async function collectConversionData(
  asin: string,
  options: CollectionOptions = {}
): Promise<ConversionCrawlData> {
  const startTime = Date.now();

  if (!options.workspaceId) throw new Error("conversion collector requires workspaceId");
  const db = await requireDb("Conversion confirmed Amazon snapshot");
  const confirmed = await findFreshConfirmedSnapshot({
    db,
    workspaceId: options.workspaceId,
    marketplace: "US",
    asin: asin.trim().toUpperCase(),
    freshAfter: new Date(0),
  });
  if (!confirmed) throw new Error(`confirmed Amazon snapshot required for ${asin}`);
  const snapshot = await loadConfirmedSnapshotForConsumer({
    db,
    workspaceId: options.workspaceId,
    confirmedSnapshotId: confirmed.id,
  });
  const images: ProductImage[] = await Promise.all(snapshot.assets
    .filter((asset: any) => ["main", "secondary", "aplus", "brand_story"].includes(asset.role))
    .sort((a: any, b: any) => a.positionIndex - b.positionIndex)
    .map(async (asset: any) => ({
      url: await resolveStoredObjectUrl(asset.storageKey),
      position: asset.role as ProductImage["position"],
      positionIndex: asset.positionIndex,
      aplusModuleType: asset.moduleType || undefined,
      aplusModuleClass: asset.moduleClass || undefined,
    })));
  const scraperData: ConfirmedAmazonProductData = {
    asin: snapshot.data.asin,
    title: snapshot.data.title || "",
    brand: snapshot.data.brand || "",
    category: snapshot.data.category || "",
    description: snapshot.data.description || "",
    bulletPoints: snapshot.data.bulletPoints,
    price: snapshot.data.price ? `${snapshot.data.price.value} ${snapshot.data.price.currency}` : "",
    rating: snapshot.data.rating || "",
    reviewCount: snapshot.data.reviewCount === null ? "" : String(snapshot.data.reviewCount),
    imageUrls: images.filter(image => image.position === "main" || image.position === "secondary").map(image => image.url),
    images,
    reviews: [],
  };
  const competitorData = null;
  const [adResult] = await Promise.allSettled([
    options.skipAds ? Promise.resolve(null) : collectAdData(asin, options.sid),
  ]);
  const adData = adResult.status === "fulfilled" ? adResult.value : null;

  const scraperError = null;
  const competitorError = "排名、Coupon与Deal监控尚未迁移至统一Provider（A8）";
  const adError = adResult.status === "rejected" ? String(adResult.reason) : null;

  if (adError) console.warn(`[ConversionCollector] Ad data failed for ${asin}: ${adError}`);

  // 判断是否有任何有效数据
  const hasScraperData = true;
  const hasCompetitorData = false;
  const hasAdData = !!adData && (adData.campaigns?.length > 0 || adData.keywords?.length > 0);
  const hasAnyData = hasScraperData || hasCompetitorData || hasAdData;

  // HTML专属字段未被Confirmed Snapshot覆盖时保持未知/默认，不作存在性断言。
  let extendedData: ReturnType<typeof parseExtendedProductData> | null = null;

  // 构建结构化数据

  // ── 标题 ──
  const titleText = scraperData.title;
  const titleData: TitleData = {
    text: titleText,
    charCount: titleText.length,
    wordCount: titleText.split(/\s+/).filter(Boolean).length,
    brand: scraperData.brand,
    hasBrand: !!(scraperData.brand && titleText.toLowerCase().includes(scraperData.brand.toLowerCase())),
    rawTitle: titleText,
  };

  // ── 五点 ──
  const bullets = scraperData.bulletPoints;
  const bulletCharCounts = bullets.map(b => b.length);
  const bulletPointsData: BulletPointsData = {
    bullets,
    bulletCount: bullets.length,
    avgCharCount: bulletCharCounts.length > 0 ? Math.round(bulletCharCounts.reduce((a, b) => a + b, 0) / bulletCharCounts.length) : 0,
    totalCharCount: bulletCharCounts.reduce((a, b) => a + b, 0),
    charCounts: bulletCharCounts,
  };

  // ── 标签 ──
  const badges: BadgeData = {
    hasBestSeller: false,
    hasAmazonChoice: false, // 需要HTML解析
    hasNewRelease: false,
    hasDeal: false,
    dealInfo: null,
    hasCoupon: false,
    couponInfo: null,
    hasPrime: false, // 不默认假设，需要真实数据确认
    hasSubscribeSave: false,
    hasClimateTag: false,
    hasSmallBusiness: false,
    totalBadges: 0,
  };
  // 计算总标签数
  let badgeCount = 0;
  if (badges.hasBestSeller) badgeCount++;
  if (badges.hasAmazonChoice) badgeCount++;
  if (badges.hasNewRelease) badgeCount++;
  if (badges.hasDeal) badgeCount++;
  if (badges.hasCoupon) badgeCount++;
  if (badges.hasPrime) badgeCount++;
  badges.totalBadges = badgeCount;

  // ── 价格 ──
  const currentPrice = scraperData.price ? parseFloat(scraperData.price.replace(/[^0-9.]/g, "")) : null;
  const priceData: PriceData = {
    currentPrice,
    listPrice: null, // 需要HTML解析
    hasStrikethrough: false,
    discountPercent: null,
    hasCoupon: badges.hasCoupon,
    couponValue: badges.couponInfo,
    hasSubscribeSave: false,
    unitPrice: null,
    buyBoxPrice: currentPrice,
    priceEnding: currentPrice ? currentPrice.toFixed(2).slice(-2) : null,
  };

  // ── 限购 ──
  const purchaseLimitData: PurchaseLimitData = {
    hasLimit: false,
    limitQuantity: null,
    limitText: null,
  };

  // ── 配送 ──
  const deliveryData: DeliveryData = {
    isFBA: false, // 不默认假设，需要真实数据确认
    isFBM: false,
    deliveryDays: null,
    deliveryText: null,
    hasPrime: badges.hasPrime,
    hasFreeShipping: badges.hasPrime,
    shipsFrom: null,
    soldBy: null,
  };

  // ── 变体 ──
  const variantData: VariantData = {
    variantCount: 0,
    variantTypes: [],
    variants: [],
    hasImages: false,
  };

  // ── 产品信息 ──
  const productInfoData: ProductInfoData = {
    fieldCount: 0,
    hasWeight: false,
    hasDimensions: false,
    hasMaterial: false,
    hasColor: false,
    hasManufacturer: false,
    fields: {},
  };

  // ── 商品文档 ──
  const productDocData: ProductDocData = {
    hasManual: false,
    hasCertification: false,
    documentCount: 0,
    documentTypes: [],
  };

  // ── 主图 ──
  const allImages = scraperData.images;
  const mainImages = allImages.filter(img => img.position === "main");
  const secondaryImages = allImages.filter(img => img.position === "secondary");
  const aplusImages = allImages.filter(img => img.position === "aplus");
  const brandStoryImages = allImages.filter(img => img.position === "brand_story");
  
  const imageData: ImageData = {
    mainImages,
    mainImageCount: mainImages.length,
    hasMainImage: mainImages.length > 0,
    mainImageResolution: null,
    secondaryImages,
    secondaryImageCount: secondaryImages.length,
    aplusImages,
    brandStoryImages,
    videoCount: 0, // 需要HTML解析
    hasVideo: false,
    totalImageCount: allImages.length,
  };

  // ── 流量闭环 ──
  const trafficLoopData: TrafficLoopData = {
    hasNewModel: false,
    hasBundleDeal: false,
    hasFrequentlyBought: false,
    hasSponsoredProducts: false,
    hasVirtualBundle: false,
    hasBrandStoreLink: false,
  };

  // ── 品牌故事 ──
  const brandStoryData: BrandStoryData = {
    hasBrandStory: brandStoryImages.length > 0,
    coverageStatus: brandStoryImages.length > 0 ? "confirmed" : "unknown",
    hasRecommendation: false,
    imageCount: brandStoryImages.length,
    textContent: "",
    images: brandStoryImages,
  };

  // ── A+ ──
  const aplusData: AplusData = {
    hasAplus: aplusImages.length > 0,
    coverageStatus: aplusImages.length > 0 ? "confirmed" : "unknown",
    moduleCount: 0,
    moduleTypes: [],
    hasComparisonChart: false,
    hasVideo: false,
    imageCount: aplusImages.length,
    textContent: scraperData.description,
    images: aplusImages,
  };

  // ── Video ──
  const videoData: VideoData = {
    videoCount: 0,
    hasMainVideo: false,
    videoUrls: [],
  };

  // ── Q&A ──
  const qaData: QAData = {
    questionCount: 0,
    topQuestions: [],
  };

  // ── Review ──
  const reviewData: ReviewData = {
    rating: scraperData.rating ? parseFloat(scraperData.rating) : null,
    reviewCount: scraperData.reviewCount ? parseInt(scraperData.reviewCount) : null,
    hasVine: false,
    topReviews: [],
    ratingDistribution: {},
  };

  // ── 店铺 ──
  const storeData: StoreData = {
    feedbackScore: null,
    feedbackCount: null,
    hasStorefront: false,
    storeName: null,
  };

  // ── 广告 ──
  const adCategoryData: AdCategoryData = {
    hasCampaigns: (adData?.campaigns?.length || 0) > 0,
    campaignCount: adData?.campaigns?.length || 0,
    totalSpend: null,
    acos: null,
    roas: null,
    keywordCount: adData?.keywords?.length || 0,
    topKeywords: (adData?.keywords || []).slice(0, 20).map((k: any) => ({
      keyword: k.keyword || k.keywordText || "",
      impressions: k.impressions || 0,
      clicks: k.clicks || 0,
      spend: k.spend || k.cost || 0,
      acos: k.acos || 0,
    })),
    searchTerms: (adData?.searchTerms || []).slice(0, 20).map((t: any) => ({
      term: t.query || t.searchTerm || "",
      impressions: t.impressions || 0,
      clicks: t.clicks || 0,
      conversions: t.conversions || t.purchases || 0,
    })),
  };

  // 计算广告汇总数据
  if (adData?.productReports?.length) {
    const totalSpend = adData.productReports.reduce((sum: number, r: any) => sum + (r.spend || r.cost || 0), 0);
    const totalSales = adData.productReports.reduce((sum: number, r: any) => sum + (r.sales || r.attributedSales || 0), 0);
    adCategoryData.totalSpend = totalSpend;
    adCategoryData.acos = totalSales > 0 ? Math.round((totalSpend / totalSales) * 10000) / 100 : null;
    adCategoryData.roas = totalSpend > 0 ? Math.round((totalSales / totalSpend) * 100) / 100 : null;
  }

  const duration = Date.now() - startTime;

  return {
    asin,
    crawledAt: new Date().toISOString(),
    hasData: hasAnyData,
    dataSourceStatus: {
      scraper: { success: hasScraperData, error: scraperError || undefined },
      competitor: { success: hasCompetitorData, error: competitorError || undefined },
      lingxingAd: { success: hasAdData, error: adError || undefined },
      confirmedSnapshot: { success: true, confirmedSnapshotId: confirmed.id },
    },
    raw: {
      scraperData,
      competitorData,
      adData,
      confirmedSnapshot: {
        id: confirmed.id,
        contentHash: confirmed.contentHash,
        confirmationVersion: confirmed.confirmationVersion,
      },
    },
    categories: {
      标题: titleData,
      五点: bulletPointsData,
      标: badges,
      价格: priceData,
      限购: purchaseLimitData,
      配送: deliveryData,
      变体: variantData,
      产品信息: productInfoData,
      商品文档: productDocData,
      主图: imageData,
      流量闭环: trafficLoopData,
      品牌故事: brandStoryData,
      "A+": aplusData,
      Video: videoData,
      "Q&A": qaData,
      Review: reviewData,
      店铺介绍页面: storeData,
      广告: adCategoryData,
    },
  };
}

/**
 * 批量采集多个ASIN的数据（串行，避免被封IP）
 */
export async function collectMultipleAsins(
  asins: string[],
  options: CollectionOptions = {},
  onProgress?: (asin: string, index: number, total: number) => void
): Promise<Record<string, ConversionCrawlData | null>> {
  const results: Record<string, ConversionCrawlData | null> = {};
  
  for (let i = 0; i < asins.length; i++) {
    const asin = asins[i];
    onProgress?.(asin, i, asins.length);
    
    try {
      const data = await collectConversionData(asin, options);
      // 如果所有数据源都失败，返回null而不是假数据
      results[asin] = data.hasData ? data : null;
      if (!data.hasData) {
        console.warn(`[ConversionCollector] No valid data collected for ${asin} - all data sources failed`);
      }
    } catch (err: any) {
      console.error(`[ConversionCollector] Failed to collect data for ${asin}: ${err.message}`);
      // 采集完全失败，返回null，不生成假数据
      results[asin] = null;
    }
    
    // 在ASIN之间添加随机延迟（2-5秒），避免被封
    if (i < asins.length - 1) {
      const delay = 2000 + Math.random() * 3000;
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
  
  return results;
}
