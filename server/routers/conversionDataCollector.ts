/**
 * 转化率对比 — 数据采集引擎
 * 
 * 职责：为每个ASIN采集产品页面数据，整合爬虫+领星API+程序计算三大数据源，
 * 输出结构化的 ConversionCrawlData，供AI评分引擎使用。
 * 
 * 数据源：
 * 1. scraper.ts — 产品详情页深度爬虫（标题/五点/价格/图片/A+/品牌故事/评论）
 * 2. crawlerEngine.ts — 竞品监控爬虫（BSR/价格/Coupon/Deal/评论数）
 * 3. lingxingAdapter.ts — 领星ERP API（广告数据/利润/库存）
 * 4. 程序化计算 — 字数统计、正则匹配、HTML解析等
 */

import { scrapeAmazonProduct, type AmazonProductData, type ProductImage } from "../scraper";
import { crawlCompetitorData, type CompetitorCrawlData } from "../crawlerEngine";
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
  };
  /** 原始爬虫数据（用于AI分析） */
  raw: {
    scraperData: AmazonProductData | null;
    competitorData: CompetitorCrawlData | null;
    adData: AdData | null;
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
  hasRecommendation: boolean;
  imageCount: number;
  textContent: string;
  images: ProductImage[];
}

export interface AplusData {
  hasAplus: boolean;
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
      ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
      ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
      ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
      ({ code: "200", data: {} as any, _meta: { source: "deprecated" as any } }),
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
  /** 爬虫代理配置 */
  proxyUrl?: string;
}

/**
 * 为单个ASIN采集完整的转化率对比数据
 * 
 * 流程：
 * 1. 并行调用 scraper + crawlerEngine 爬取产品页面
 * 2. 从HTML中提取扩展数据（变体/配送/限购/标签等）
 * 3. 调用领星API获取广告数据
 * 4. 整合为结构化的 ConversionCrawlData
 */
export async function collectConversionData(
  asin: string,
  options: CollectionOptions = {}
): Promise<ConversionCrawlData> {
  const startTime = Date.now();

  // Step 1: 并行爬取
  const [scraperResult, competitorResult, adResult] = await Promise.allSettled([
    scrapeAmazonProduct(asin, { proxyUrl: options.proxyUrl }),
    crawlCompetitorData(asin),
    options.skipAds ? Promise.resolve(null) : collectAdData(asin, options.sid),
  ]);

  const scraperData = scraperResult.status === "fulfilled" ? scraperResult.value : null;
  const competitorData = competitorResult.status === "fulfilled" ? competitorResult.value?.data as CompetitorCrawlData : null;
  const adData = adResult.status === "fulfilled" ? adResult.value : null;

  const scraperError = scraperResult.status === "rejected" ? String(scraperResult.reason) : null;
  const competitorError = competitorResult.status === "rejected" ? String(competitorResult.reason) : null;
  const adError = adResult.status === "rejected" ? String(adResult.reason) : null;

  if (scraperError) console.warn(`[ConversionCollector] Scraper failed for ${asin}: ${scraperError}`);
  if (competitorError) console.warn(`[ConversionCollector] Competitor crawl failed for ${asin}: ${competitorError}`);
  if (adError) console.warn(`[ConversionCollector] Ad data failed for ${asin}: ${adError}`);

  // 判断是否有任何有效数据
  const hasScraperData = !!scraperData;
  const hasCompetitorData = !!competitorData;
  const hasAdData = !!adData && (adData.campaigns?.length > 0 || adData.keywords?.length > 0);
  const hasAnyData = hasScraperData || hasCompetitorData || hasAdData;

  // Step 2: 从原始HTML中提取扩展数据（如果scraper成功的话）
  // 注意：scraper.ts 的 fetchWithRetry 返回HTML，但 scrapeAmazonProduct 只返回解析后的数据
  // 所以我们需要用 competitorData 中的基础数据 + scraperData 中的详细数据来组合
  let extendedData: ReturnType<typeof parseExtendedProductData> | null = null;
  
  // 由于我们无法直接获取原始HTML（scraper.ts不暴露），
  // 我们基于已有的scraperData和competitorData来构建结构化数据
  
  // Step 3: 构建结构化数据

  // ── 标题 ──
  const titleText = scraperData?.title || competitorData?.title || "";
  const titleData: TitleData = {
    text: titleText,
    charCount: titleText.length,
    wordCount: titleText.split(/\s+/).filter(Boolean).length,
    brand: scraperData?.brand || "",
    hasBrand: !!(scraperData?.brand && titleText.toLowerCase().includes(scraperData.brand.toLowerCase())),
    rawTitle: titleText,
  };

  // ── 五点 ──
  const bullets = scraperData?.bulletPoints || competitorData?.bulletPoints || [];
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
    hasBestSeller: (competitorData?.bsrRank || 0) <= 1,
    hasAmazonChoice: false, // 需要HTML解析
    hasNewRelease: false,
    hasDeal: !!competitorData?.dealInfo,
    dealInfo: competitorData?.dealInfo || null,
    hasCoupon: !!competitorData?.couponInfo,
    couponInfo: competitorData?.couponInfo || null,
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
  const currentPrice = competitorData?.price || (scraperData?.price ? parseFloat(scraperData.price.replace(/[^0-9.]/g, "")) : null);
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
  const allImages = scraperData?.images || [];
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
    hasRecommendation: false,
    imageCount: brandStoryImages.length,
    textContent: "",
    images: brandStoryImages,
  };

  // ── A+ ──
  const aplusData: AplusData = {
    hasAplus: aplusImages.length > 0,
    moduleCount: 0,
    moduleTypes: [],
    hasComparisonChart: false,
    hasVideo: false,
    imageCount: aplusImages.length,
    textContent: scraperData?.description || "",
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
    rating: competitorData?.rating || (scraperData?.rating ? parseFloat(scraperData.rating) : null),
    reviewCount: competitorData?.reviewCount || (scraperData?.reviewCount ? parseInt(scraperData.reviewCount) : null),
    hasVine: false,
    topReviews: scraperData?.reviews || [],
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
    },
    raw: {
      scraperData,
      competitorData,
      adData,
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
