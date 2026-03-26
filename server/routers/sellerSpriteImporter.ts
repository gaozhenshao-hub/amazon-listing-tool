/**
 * SellerSprite (卖家精灵) XLSX/CSV Import Parser
 * 
 * 解析卖家精灵导出的三种xlsx文件：
 * 1. ReverseASIN — 反查ASIN关键词（流量词、搜索量、SPR、自然排名等）
 * 2. Reviews — 评论数据（标题、内容、星级、VP、Vine等）
 * 3. Products — 产品数据（标题、五点、价格、BSR、评分、变体、标签等）
 * 
 * 支持中英文列名自动识别，兼容CSV和Excel(xlsx)格式。
 */

import * as XLSX from "xlsx";

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export interface SellerSpriteProductData {
  asin: string;
  parentAsin?: string;
  title?: string;
  brand?: string;
  category?: string;
  categoryPath?: string;
  subCategory?: string;
  bsrRank?: number;
  subCategoryRank?: number;
  price?: number;
  primePrice?: number;
  rating?: number;
  reviewCount?: number;
  monthlySales?: number;
  monthlyRevenue?: number;
  childSales?: number;
  childRevenue?: number;
  launchDate?: string;
  listingAge?: number;
  sellerCount?: number;
  variationCount?: number;
  fbaFee?: number;
  grossMargin?: number;
  fulfillment?: string;
  imageCount?: number;
  bulletPoints?: string[];
  description?: string;
  lqs?: number;
  qaCount?: number;
  coupon?: string;
  // 标签字段
  hasBestSeller?: boolean;
  hasAmazonChoice?: boolean;
  hasNewRelease?: boolean;
  hasAplus?: boolean;
  hasVideo?: boolean;
  hasSPAd?: boolean;
  hasBrandStory?: boolean;
  hasBrandAd?: boolean;
  hasCPFGreen?: boolean;
  has7DayPromo?: boolean;
  acKeyword?: string;
  // 卖家信息
  buyboxSeller?: string;
  buyboxType?: string;
  sellerLocation?: string;
  sellerInfo?: string;
  // 物流尺寸
  productWeight?: string;
  productDimensions?: string;
  packageWeight?: string;
  packageDimensions?: string;
  packageSizeTier?: string;
  // 关键词相关
  keywords?: SellerSpriteKeywordData[];
  // 评论相关
  reviews?: SellerSpriteReviewData[];
}

export interface SellerSpriteKeywordData {
  keyword: string;
  keywordTranslation?: string;
  isACRecommended?: boolean;
  trafficShare?: number;
  weeklyExposure?: number;
  keywordType?: string;
  conversionEffect?: string;
  trafficWordType?: string;
  organicTrafficShare?: number;
  adTrafficShare?: number;
  organicRank?: number;
  organicRankPage?: number;
  organicRankUpdateTime?: string;
  adRank?: number;
  adRankPage?: number;
  adRankUpdateTime?: string;
  abaWeeklyRank?: number;
  searchVolume?: number;
  spr?: number;
  titleDensity?: number;
  purchaseCount?: number;
  purchaseRate?: number;
  impressions?: number;
  clicks?: number;
  productCount?: number;
  supplyDemandRatio?: number;
  adCompetitorCount?: number;
  clickTotalShare?: number;
  conversionTotalShare?: number;
  ppcBid?: number;
  suggestedBidRange?: string;
  topTenAsins?: string;
}

export interface SellerSpriteReviewData {
  asin?: string;
  title?: string;
  content: string;
  isVerified?: boolean;
  isVineVoice?: boolean;
  variant?: string;
  rating: number;
  helpfulVotes?: number;
  imageCount?: number;
  imageUrls?: string;
  hasVideo?: boolean;
  videoUrl?: string;
  reviewUrl?: string;
  reviewer?: string;
  reviewerAvatar?: string;
  reviewerCountry?: string;
  reviewerProfile?: string;
  influencerLink?: string;
  date?: string;
}

export interface ImportResult {
  success: boolean;
  fileType: 'product' | 'keyword' | 'review' | 'unknown';
  products: SellerSpriteProductData[];
  keywords: SellerSpriteKeywordData[];
  reviews: SellerSpriteReviewData[];
  warnings: string[];
  errors: string[];
  /** 识别到的列名映射 */
  columnMapping: Record<string, string>;
  /** 总行数 */
  totalRows: number;
  /** 成功解析行数 */
  parsedRows: number;
}

// ═══════════════════════════════════════════════════════════════════════
// Column Name Mapping — ReverseASIN (关键词)
// ═══════════════════════════════════════════════════════════════════════

const KEYWORD_COLUMN_MAP: Record<string, string> = {
  '流量词': 'keyword',
  '关键词翻译': 'keywordTranslation',
  'AC推荐词': 'isACRecommended',
  '流量占比': 'trafficShare',
  '预估周曝光量': 'weeklyExposure',
  '关键词类型': 'keywordType',
  '转化效果': 'conversionEffect',
  '流量词类型': 'trafficWordType',
  '自然流量占比': 'organicTrafficShare',
  '广告流量占比': 'adTrafficShare',
  '自然排名': 'organicRank',
  '自然排名页码': 'organicRankPage',
  '广告排名': 'adRank',
  '广告排名页码': 'adRankPage',
  'ABA周排名': 'abaWeeklyRank',
  '月搜索量': 'searchVolume',
  'SPR': 'spr',
  '标题密度': 'titleDensity',
  '购买量': 'purchaseCount',
  '购买率': 'purchaseRate',
  '展示量': 'impressions',
  '点击量': 'clicks',
  '商品数': 'productCount',
  '需供比': 'supplyDemandRatio',
  '广告竞品数': 'adCompetitorCount',
  '点击总占比': 'clickTotalShare',
  '转化总占比': 'conversionTotalShare',
  'PPC价格': 'ppcBid',
  '建议竞价范围': 'suggestedBidRange',
  '前十ASIN': 'topTenAsins',
  // English fallbacks
  'Keyword': 'keyword',
  'Search Volume': 'searchVolume',
  'Organic Rank': 'organicRank',
  'Ad Rank': 'adRank',
  'PPC Bid': 'ppcBid',
  'Title Density': 'titleDensity',
};

// ═══════════════════════════════════════════════════════════════════════
// Column Name Mapping — Reviews (评论)
// ═══════════════════════════════════════════════════════════════════════

const REVIEW_COLUMN_MAP: Record<string, string> = {
  'ASIN': 'asin',
  '标题': 'title',
  '内容': 'content',
  'VP评论': 'isVerified',
  'Vine Voice评论': 'isVineVoice',
  '型号': 'variant',
  '星级': 'rating',
  '赞同数': 'helpfulVotes',
  '图片数量': 'imageCount',
  '图片地址': 'imageUrls',
  '是否有视频': 'hasVideo',
  '视频地址': 'videoUrl',
  '评论链接': 'reviewUrl',
  '评论人': 'reviewer',
  '头像地址': 'reviewerAvatar',
  '所属国家': 'reviewerCountry',
  '评论人主页': 'reviewerProfile',
  '红人计划链接': 'influencerLink',
  '评论时间': 'date',
  // English fallbacks
  'Title': 'title',
  'Content': 'content',
  'Rating': 'rating',
  'Review Content': 'content',
  'Review Title': 'title',
  'Star': 'rating',
  'Verified Purchase': 'isVerified',
  'VP': 'isVerified',
  'Review Date': 'date',
  'Date': 'date',
};

// ═══════════════════════════════════════════════════════════════════════
// Column Name Mapping — Products (产品数据)
// ═══════════════════════════════════════════════════════════════════════

const PRODUCT_COLUMN_MAP: Record<string, string> = {
  '#': 'index',
  '图片': 'image',
  'ASIN': 'asin',
  'SKU': 'sku',
  '详细参数': 'detailParams',
  '品牌': 'brand',
  '品牌链接': 'brandLink',
  '商品标题': 'title',
  '产品卖点': 'bulletPoints',
  '商品详情页链接': 'detailPageLink',
  '商品主图': 'mainImage',
  '父ASIN': 'parentAsin',
  '类目路径': 'categoryPath',
  '大类目': 'category',
  '大类BSR': 'bsrRank',
  '大类BSR增长数': 'bsrGrowth',
  '大类BSR增长率': 'bsrGrowthRate',
  '小类目': 'subCategory',
  '小类BSR': 'subCategoryRank',
  '月销量': 'monthlySales',
  '月销量增长率': 'monthlySalesGrowthRate',
  '月销售额($)': 'monthlyRevenue',
  '子体销量': 'childSales',
  '子体销售额($)': 'childRevenue',
  '变体数': 'variationCount',
  '价格($)': 'price',
  'Prime价格($)': 'primePrice',
  'Coupon': 'coupon',
  'Q&A数': 'qaCount',
  '评分数': 'reviewCount',
  '月新增\n评分数': 'monthlyNewReviews',
  '评分': 'rating',
  '留评率': 'reviewRate',
  'FBA($)': 'fbaFee',
  '毛利率': 'grossMargin',
  '评级': 'ratingGrade',
  '上架时间': 'launchDate',
  '上架天数': 'listingAge',
  '配送方式': 'fulfillment',
  '买家运费($)': 'buyerShipping',
  'LQS': 'lqs',
  '卖家数': 'sellerCount',
  'Buybox卖家': 'buyboxSeller',
  'BuyBox类型': 'buyboxType',
  '卖家所属地': 'sellerLocation',
  '卖家信息': 'sellerInfo',
  '卖家首页': 'sellerPage',
  'Best Seller标识': 'hasBestSeller',
  "Amazon's Choice": 'hasAmazonChoice',
  'CPF绿标': 'hasCPFGreen',
  'CPF绿标信息': 'cpfGreenInfo',
  'New Release标识': 'hasNewRelease',
  'A+页面': 'hasAplus',
  '视频介绍': 'hasVideo',
  'SP广告': 'hasSPAd',
  '品牌故事': 'hasBrandStory',
  '品牌广告': 'hasBrandAd',
  '7天促销': 'has7DayPromo',
  'AC关键词': 'acKeyword',
  '商品重量': 'productWeight',
  '商品重量（单位换算）': 'productWeightConverted',
  '商品尺寸': 'productDimensions',
  '商品尺寸（单位换算）': 'productDimensionsConverted',
  '包装重量': 'packageWeight',
  '包装重量（单位换算）': 'packageWeightConverted',
  '包装尺寸': 'packageDimensions',
  '包装尺寸（单位换算）': 'packageDimensionsConverted',
  '包装尺寸分段': 'packageSizeTier',
  // 简写兼容映射
  '标题': 'title',
  '价格': 'price',
  '评论数': 'reviewCount',
  '销量': 'monthlySales',
  '类目': 'category',
  // English fallbacks
  'Title': 'title',
  'Brand': 'brand',
  'Price': 'price',
  'Rating': 'rating',
  'Reviews': 'reviewCount',
  'Monthly Sales': 'monthlySales',
  'BSR': 'bsrRank',
  'Variations': 'variationCount',
  'Fulfillment': 'fulfillment',
};

// ═══════════════════════════════════════════════════════════════════════
// Helpers
// ═══════════════════════════════════════════════════════════════════════

function parseNumber(value: any): number | undefined {
  if (value === null || value === undefined || value === '' || value === '-' || value === 'N/A' || value === '--') return undefined;
  if (typeof value === 'number') return isNaN(value) ? undefined : value;
  const cleaned = String(value).replace(/[$€£¥,\s%]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

function parseYN(value: any): boolean {
  if (value === null || value === undefined || value === '') return false;
  const s = String(value).trim().toUpperCase();
  return s === 'Y' || s === 'YES' || s === '是' || s === 'TRUE' || s === '1';
}

/**
 * 自动检测文件类型
 * 基于列名特征判断：关键词/评论/产品
 */
function detectFileType(headers: string[]): 'keyword' | 'review' | 'product' | 'unknown' {
  const headerSet = new Set(headers.map(h => (h || '').trim()));
  
  // 关键词文件特征：有"流量词"或"月搜索量"
  if (headerSet.has('流量词') || (headerSet.has('Keyword') && headerSet.has('Search Volume'))) {
    return 'keyword';
  }
  
  // 评论文件特征：有"内容"+"星级" 或 "VP评论"
  if ((headerSet.has('内容') && headerSet.has('星级')) || headerSet.has('VP评论') || headerSet.has('Vine Voice评论')) {
    return 'review';
  }
  
  // 产品文件特征：有"商品标题"或"大类BSR"或"产品卖点"
  if (headerSet.has('商品标题') || headerSet.has('大类BSR') || headerSet.has('产品卖点') || headerSet.has('月销量')) {
    return 'product';
  }
  
  // Fallback: 有ASIN列的当产品处理
  if (headerSet.has('ASIN')) {
    return 'product';
  }
  
  return 'unknown';
}

/**
 * 从xlsx Buffer中解析数据
 */
function parseXlsxBuffer(buffer: Buffer): { headers: string[]; rows: Record<string, any>[]; sheetName: string } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  // 取第一个sheet（跳过Note等辅助sheet）
  const sheetName = workbook.SheetNames[0];
  const worksheet = workbook.Sheets[sheetName];
  
  // 转换为JSON，header: 1 返回数组格式
  const rawRows: any[][] = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' });
  
  if (rawRows.length < 2) {
    return { headers: [], rows: [], sheetName };
  }
  
  const headers = rawRows[0].map((h: any) => String(h || '').trim());
  const rows: Record<string, any>[] = [];
  
  for (let i = 1; i < rawRows.length; i++) {
    const row = rawRows[i];
    // 跳过完全空行
    if (!row || row.every((cell: any) => cell === '' || cell === null || cell === undefined)) continue;
    
    const obj: Record<string, any> = {};
    headers.forEach((header, idx) => {
      if (header) {
        obj[header] = row[idx] !== undefined ? row[idx] : '';
      }
    });
    rows.push(obj);
  }
  
  return { headers, rows, sheetName };
}

/**
 * 从CSV文本中解析数据
 */
function parseCSVText(text: string): { headers: string[]; rows: Record<string, any>[] } {
  const csvRows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\n' || (char === '\r' && nextChar === '\n')) {
        currentRow.push(currentField.trim());
        if (currentRow.some(f => f !== '')) csvRows.push(currentRow);
        currentRow = [];
        currentField = '';
        if (char === '\r') i++;
      } else {
        currentField += char;
      }
    }
  }
  currentRow.push(currentField.trim());
  if (currentRow.some(f => f !== '')) csvRows.push(currentRow);
  
  if (csvRows.length < 2) return { headers: [], rows: [] };
  
  const headers = csvRows[0];
  const rows: Record<string, any>[] = [];
  for (let i = 1; i < csvRows.length; i++) {
    const obj: Record<string, any> = {};
    headers.forEach((h, idx) => {
      obj[h] = csvRows[i][idx] || '';
    });
    rows.push(obj);
  }
  return { headers, rows };
}

// ═══════════════════════════════════════════════════════════════════════
// Row Parsers
// ═══════════════════════════════════════════════════════════════════════

function parseKeywordRow(raw: Record<string, any>, colMap: Record<string, string>): SellerSpriteKeywordData | null {
  const mapped: Record<string, any> = {};
  for (const [origCol, value] of Object.entries(raw)) {
    const field = colMap[origCol.trim()];
    if (field) mapped[field] = value;
  }
  
  const keyword = String(mapped.keyword || '').trim();
  if (!keyword) return null;
  
  return {
    keyword,
    keywordTranslation: mapped.keywordTranslation ? String(mapped.keywordTranslation).trim() : undefined,
    isACRecommended: parseYN(mapped.isACRecommended),
    trafficShare: parseNumber(mapped.trafficShare),
    weeklyExposure: parseNumber(mapped.weeklyExposure),
    keywordType: mapped.keywordType ? String(mapped.keywordType).trim() : undefined,
    conversionEffect: mapped.conversionEffect ? String(mapped.conversionEffect).trim() : undefined,
    trafficWordType: mapped.trafficWordType ? String(mapped.trafficWordType).trim() : undefined,
    organicTrafficShare: parseNumber(mapped.organicTrafficShare),
    adTrafficShare: parseNumber(mapped.adTrafficShare),
    organicRank: parseNumber(mapped.organicRank),
    organicRankPage: parseNumber(mapped.organicRankPage),
    organicRankUpdateTime: mapped.organicRankUpdateTime ? String(mapped.organicRankUpdateTime).trim() : undefined,
    adRank: parseNumber(mapped.adRank),
    adRankPage: parseNumber(mapped.adRankPage),
    adRankUpdateTime: mapped.adRankUpdateTime ? String(mapped.adRankUpdateTime).trim() : undefined,
    abaWeeklyRank: parseNumber(mapped.abaWeeklyRank),
    searchVolume: parseNumber(mapped.searchVolume),
    spr: parseNumber(mapped.spr),
    titleDensity: parseNumber(mapped.titleDensity),
    purchaseCount: parseNumber(mapped.purchaseCount),
    purchaseRate: parseNumber(mapped.purchaseRate),
    impressions: parseNumber(mapped.impressions),
    clicks: parseNumber(mapped.clicks),
    productCount: parseNumber(mapped.productCount),
    supplyDemandRatio: parseNumber(mapped.supplyDemandRatio),
    adCompetitorCount: parseNumber(mapped.adCompetitorCount),
    clickTotalShare: parseNumber(mapped.clickTotalShare),
    conversionTotalShare: parseNumber(mapped.conversionTotalShare),
    ppcBid: parseNumber(mapped.ppcBid),
    suggestedBidRange: mapped.suggestedBidRange ? String(mapped.suggestedBidRange).trim() : undefined,
    topTenAsins: mapped.topTenAsins ? String(mapped.topTenAsins).trim() : undefined,
  };
}

function parseReviewRow(raw: Record<string, any>, colMap: Record<string, string>): SellerSpriteReviewData | null {
  const mapped: Record<string, any> = {};
  for (const [origCol, value] of Object.entries(raw)) {
    const field = colMap[origCol.trim()];
    if (field) mapped[field] = value;
  }
  
  const content = String(mapped.content || '').trim();
  if (!content) return null;
  
  return {
    asin: mapped.asin ? String(mapped.asin).trim() : undefined,
    title: mapped.title ? String(mapped.title).trim() : undefined,
    content,
    isVerified: parseYN(mapped.isVerified),
    isVineVoice: parseYN(mapped.isVineVoice),
    variant: mapped.variant ? String(mapped.variant).trim() : undefined,
    rating: parseNumber(mapped.rating) ?? 0,
    helpfulVotes: parseNumber(mapped.helpfulVotes),
    imageCount: parseNumber(mapped.imageCount),
    imageUrls: mapped.imageUrls ? String(mapped.imageUrls).trim() : undefined,
    hasVideo: parseYN(mapped.hasVideo),
    videoUrl: mapped.videoUrl ? String(mapped.videoUrl).trim() : undefined,
    reviewUrl: mapped.reviewUrl ? String(mapped.reviewUrl).trim() : undefined,
    reviewer: mapped.reviewer ? String(mapped.reviewer).trim() : undefined,
    reviewerAvatar: mapped.reviewerAvatar ? String(mapped.reviewerAvatar).trim() : undefined,
    reviewerCountry: mapped.reviewerCountry ? String(mapped.reviewerCountry).trim() : undefined,
    reviewerProfile: mapped.reviewerProfile ? String(mapped.reviewerProfile).trim() : undefined,
    influencerLink: mapped.influencerLink ? String(mapped.influencerLink).trim() : undefined,
    date: mapped.date ? String(mapped.date).trim() : undefined,
  };
}

function parseProductRow(raw: Record<string, any>, colMap: Record<string, string>): SellerSpriteProductData | null {
  const mapped: Record<string, any> = {};
  for (const [origCol, value] of Object.entries(raw)) {
    const field = colMap[origCol.trim()];
    if (field) mapped[field] = value;
  }
  
  const asin = String(mapped.asin || '').trim().toUpperCase();
  if (!asin || asin.length < 5) return null;
  
  // 解析五点描述（产品卖点字段，通常以换行分隔）
  let bulletPoints: string[] | undefined;
  if (mapped.bulletPoints) {
    const raw = String(mapped.bulletPoints);
    // 卖家精灵的产品卖点通常用换行分隔
    const points = raw.split(/\n/).map(s => s.trim()).filter(s => s.length > 0);
    if (points.length > 0) bulletPoints = points;
  }
  
  return {
    asin,
    parentAsin: mapped.parentAsin ? String(mapped.parentAsin).trim() : undefined,
    title: mapped.title ? String(mapped.title).trim() : undefined,
    brand: mapped.brand ? String(mapped.brand).trim() : undefined,
    category: mapped.category ? String(mapped.category).trim() : undefined,
    categoryPath: mapped.categoryPath ? String(mapped.categoryPath).trim() : undefined,
    subCategory: mapped.subCategory ? String(mapped.subCategory).trim() : undefined,
    bsrRank: parseNumber(mapped.bsrRank),
    subCategoryRank: parseNumber(mapped.subCategoryRank),
    price: parseNumber(mapped.price),
    primePrice: parseNumber(mapped.primePrice),
    rating: parseNumber(mapped.rating),
    reviewCount: parseNumber(mapped.reviewCount),
    monthlySales: parseNumber(mapped.monthlySales),
    monthlyRevenue: parseNumber(mapped.monthlyRevenue),
    childSales: parseNumber(mapped.childSales),
    childRevenue: parseNumber(mapped.childRevenue),
    launchDate: mapped.launchDate ? String(mapped.launchDate).trim() : undefined,
    listingAge: parseNumber(mapped.listingAge),
    sellerCount: parseNumber(mapped.sellerCount),
    variationCount: parseNumber(mapped.variationCount),
    fbaFee: parseNumber(mapped.fbaFee),
    grossMargin: parseNumber(mapped.grossMargin),
    fulfillment: mapped.fulfillment ? String(mapped.fulfillment).trim() : undefined,
    bulletPoints,
    lqs: parseNumber(mapped.lqs),
    qaCount: parseNumber(mapped.qaCount),
    coupon: mapped.coupon ? String(mapped.coupon).trim() : undefined,
    // 标签
    hasBestSeller: parseYN(mapped.hasBestSeller),
    hasAmazonChoice: parseYN(mapped.hasAmazonChoice),
    hasNewRelease: parseYN(mapped.hasNewRelease),
    hasAplus: parseYN(mapped.hasAplus),
    hasVideo: parseYN(mapped.hasVideo),
    hasSPAd: parseYN(mapped.hasSPAd),
    hasBrandStory: parseYN(mapped.hasBrandStory),
    hasBrandAd: parseYN(mapped.hasBrandAd),
    hasCPFGreen: parseYN(mapped.hasCPFGreen),
    has7DayPromo: parseYN(mapped.has7DayPromo),
    acKeyword: mapped.acKeyword ? String(mapped.acKeyword).trim() : undefined,
    // 卖家信息
    buyboxSeller: mapped.buyboxSeller ? String(mapped.buyboxSeller).trim() : undefined,
    buyboxType: mapped.buyboxType ? String(mapped.buyboxType).trim() : undefined,
    sellerLocation: mapped.sellerLocation ? String(mapped.sellerLocation).trim() : undefined,
    sellerInfo: mapped.sellerInfo ? String(mapped.sellerInfo).trim() : undefined,
    // 物流尺寸
    productWeight: mapped.productWeightConverted ? String(mapped.productWeightConverted).trim() : (mapped.productWeight ? String(mapped.productWeight).trim() : undefined),
    productDimensions: mapped.productDimensionsConverted ? String(mapped.productDimensionsConverted).trim() : (mapped.productDimensions ? String(mapped.productDimensions).trim() : undefined),
    packageWeight: mapped.packageWeightConverted ? String(mapped.packageWeightConverted).trim() : (mapped.packageWeight ? String(mapped.packageWeight).trim() : undefined),
    packageDimensions: mapped.packageDimensionsConverted ? String(mapped.packageDimensionsConverted).trim() : (mapped.packageDimensions ? String(mapped.packageDimensions).trim() : undefined),
    packageSizeTier: mapped.packageSizeTier ? String(mapped.packageSizeTier).trim() : undefined,
  };
}

// ═══════════════════════════════════════════════════════════════════════
// Main Import Functions
// ═══════════════════════════════════════════════════════════════════════

/**
 * 从xlsx Buffer解析卖家精灵数据
 */
export function parseSellerSpriteXlsx(buffer: Buffer, targetAsin?: string): ImportResult {
  const result: ImportResult = {
    success: false,
    fileType: 'unknown',
    products: [],
    keywords: [],
    reviews: [],
    warnings: [],
    errors: [],
    columnMapping: {},
    totalRows: 0,
    parsedRows: 0,
  };
  
  try {
    const { headers, rows, sheetName } = parseXlsxBuffer(buffer);
    
    if (headers.length === 0 || rows.length === 0) {
      result.errors.push('文件内容为空或只有表头');
      return result;
    }
    
    result.totalRows = rows.length;
    result.fileType = detectFileType(headers);
    
    if (result.fileType === 'unknown') {
      result.warnings.push(`无法自动识别文件类型（Sheet: ${sheetName}），将尝试按产品数据解析`);
      result.fileType = 'product';
    }
    
    // 选择对应的列名映射
    const colMap = result.fileType === 'keyword' ? KEYWORD_COLUMN_MAP
      : result.fileType === 'review' ? REVIEW_COLUMN_MAP
      : PRODUCT_COLUMN_MAP;
    
    // 记录列名映射
    headers.forEach(h => {
      const mapped = colMap[h.trim()];
      if (mapped) result.columnMapping[h.trim()] = mapped;
    });
    
    // 解析数据行
    const seenReviews = new Set<string>(); // 用于评论去重
    
    for (let i = 0; i < rows.length; i++) {
      try {
        if (result.fileType === 'keyword') {
          const kw = parseKeywordRow(rows[i], colMap);
          if (kw) {
            result.keywords.push(kw);
            result.parsedRows++;
          }
        } else if (result.fileType === 'review') {
          const review = parseReviewRow(rows[i], colMap);
          if (review) {
            // 去重：基于内容+评论人
            const dedupeKey = `${review.content.substring(0, 100)}|${review.reviewer || ''}`;
            if (!seenReviews.has(dedupeKey)) {
              seenReviews.add(dedupeKey);
              result.reviews.push(review);
              result.parsedRows++;
            }
          }
        } else {
          const product = parseProductRow(rows[i], colMap);
          if (product) {
            if (targetAsin && product.asin !== targetAsin.toUpperCase()) continue;
            result.products.push(product);
            result.parsedRows++;
          }
        }
      } catch (e: any) {
        result.warnings.push(`第${i + 2}行解析失败: ${e.message}`);
      }
    }
    
    // 评论去重统计
    if (result.fileType === 'review' && rows.length > result.parsedRows) {
      const dupeCount = rows.length - result.parsedRows;
      if (dupeCount > 0) {
        result.warnings.push(`已自动去重${dupeCount}条重复评论`);
      }
    }
    
    result.success = result.parsedRows > 0;
    
    if (result.parsedRows === 0) {
      result.errors.push('没有成功解析任何数据行，请检查文件格式是否正确');
    }
    
  } catch (e: any) {
    result.errors.push(`xlsx文件解析失败: ${e.message}`);
  }
  
  return result;
}

/**
 * 从CSV文本解析卖家精灵数据（保持向后兼容）
 */
export function parseSellerSpriteData(text: string, targetAsin?: string): ImportResult {
  const result: ImportResult = {
    success: false,
    fileType: 'unknown',
    products: [],
    keywords: [],
    reviews: [],
    warnings: [],
    errors: [],
    columnMapping: {},
    totalRows: 0,
    parsedRows: 0,
  };
  
  try {
    const { headers, rows } = parseCSVText(text);
    
    if (headers.length === 0 || rows.length === 0) {
      result.errors.push('文件内容为空或只有表头');
      return result;
    }
    
    result.totalRows = rows.length;
    result.fileType = detectFileType(headers);
    
    if (result.fileType === 'unknown') {
      result.warnings.push('无法自动识别文件类型，将尝试按产品数据解析');
      result.fileType = 'product';
    }
    
    const colMap = result.fileType === 'keyword' ? KEYWORD_COLUMN_MAP
      : result.fileType === 'review' ? REVIEW_COLUMN_MAP
      : PRODUCT_COLUMN_MAP;
    
    headers.forEach(h => {
      const mapped = colMap[h.trim()];
      if (mapped) result.columnMapping[h.trim()] = mapped;
    });
    
    const seenReviews = new Set<string>();
    
    for (let i = 0; i < rows.length; i++) {
      try {
        if (result.fileType === 'keyword') {
          const kw = parseKeywordRow(rows[i], colMap);
          if (kw) { result.keywords.push(kw); result.parsedRows++; }
        } else if (result.fileType === 'review') {
          const review = parseReviewRow(rows[i], colMap);
          if (review) {
            const dedupeKey = `${review.content.substring(0, 100)}|${review.reviewer || ''}`;
            if (!seenReviews.has(dedupeKey)) {
              seenReviews.add(dedupeKey);
              result.reviews.push(review);
              result.parsedRows++;
            }
          }
        } else {
          const product = parseProductRow(rows[i], colMap);
          if (product) {
            if (targetAsin && product.asin !== targetAsin.toUpperCase()) continue;
            result.products.push(product);
            result.parsedRows++;
          }
        }
      } catch (e: any) {
        result.warnings.push(`第${i + 2}行解析失败: ${e.message}`);
      }
    }
    
    if (result.fileType === 'review' && rows.length > result.parsedRows) {
      const dupeCount = rows.length - result.parsedRows;
      if (dupeCount > 0) result.warnings.push(`已自动去重${dupeCount}条重复评论`);
    }
    
    result.success = result.parsedRows > 0;
    if (result.parsedRows === 0) {
      result.errors.push('没有成功解析任何数据行，请检查文件格式是否正确');
    }
  } catch (e: any) {
    result.errors.push(`CSV文件解析失败: ${e.message}`);
  }
  
  return result;
}

// ═══════════════════════════════════════════════════════════════════════
// Merge with ConversionCrawlData
// ═══════════════════════════════════════════════════════════════════════

/**
 * 将卖家精灵导入的数据合并到转化率对比的数据采集结果中
 * 只覆盖爬虫未获取到的字段（不覆盖已有真实数据）
 */
export function mergeSellerSpriteWithCrawlData(
  ssData: SellerSpriteProductData,
  existingData: Record<string, any>
): Record<string, any> {
  const merged = { ...existingData };
  
  // 标题类别
  if (!merged.title && ssData.title) {
    merged.title = ssData.title;
    merged._titleSource = 'sellersprite';
  }
  if (!merged.brand && ssData.brand) {
    merged.brand = ssData.brand;
    merged._brandSource = 'sellersprite';
  }
  
  // 五点类别
  if ((!merged.bulletPoints || merged.bulletPoints.length === 0) && ssData.bulletPoints) {
    merged.bulletPoints = ssData.bulletPoints;
    merged._bulletPointsSource = 'sellersprite';
  }
  
  // 价格类别
  if (!merged.price && ssData.price) {
    merged.price = `$${ssData.price.toFixed(2)}`;
    merged._priceSource = 'sellersprite';
  }
  
  // 评分/评论
  if (!merged.rating && ssData.rating) {
    merged.rating = String(ssData.rating);
    merged._ratingSource = 'sellersprite';
  }
  if (!merged.reviewCount && ssData.reviewCount) {
    merged.reviewCount = String(ssData.reviewCount);
    merged._reviewCountSource = 'sellersprite';
  }
  
  // 变体
  if (!merged.variationCount && ssData.variationCount) {
    merged.variationCount = ssData.variationCount;
    merged._variationSource = 'sellersprite';
  }
  
  // 配送
  if (!merged.fulfillment && ssData.fulfillment) {
    merged.fulfillment = ssData.fulfillment;
    merged._fulfillmentSource = 'sellersprite';
  }
  
  // BSR
  if (!merged.bsrRank && ssData.bsrRank) {
    merged.bsrRank = ssData.bsrRank;
    merged._bsrSource = 'sellersprite';
  }
  
  // 月销量
  if (!merged.monthlySales && ssData.monthlySales) {
    merged.monthlySales = ssData.monthlySales;
    merged._salesSource = 'sellersprite';
  }
  
  // 描述
  if (!merged.description && ssData.description) {
    merged.description = ssData.description;
    merged._descriptionSource = 'sellersprite';
  }
  
  // 标签类 — 补充爬虫无法获取的标签信息
  if (ssData.hasBestSeller) merged.hasBestSeller = true;
  if (ssData.hasAmazonChoice) merged.hasAmazonChoice = true;
  if (ssData.hasNewRelease) merged.hasNewRelease = true;
  if (ssData.hasAplus) merged.hasAplus = true;
  if (ssData.hasVideo) merged.hasVideo = true;
  if (ssData.hasBrandStory) merged.hasBrandStory = true;
  if (ssData.hasSPAd) merged.hasSPAd = true;
  if (ssData.hasBrandAd) merged.hasBrandAd = true;
  
  // Q&A
  if (!merged.qaCount && ssData.qaCount) {
    merged.qaCount = ssData.qaCount;
    merged._qaSource = 'sellersprite';
  }
  
  // LQS
  if (!merged.lqs && ssData.lqs) {
    merged.lqs = ssData.lqs;
    merged._lqsSource = 'sellersprite';
  }
  
  return merged;
}

// ═══════════════════════════════════════════════════════════════════════
// Build ConversionCrawlData from SellerSprite Data
// ═══════════════════════════════════════════════════════════════════════

import type {
  ConversionCrawlData,
  TitleData, BulletPointsData, BadgeData, PriceData,
  PurchaseLimitData, DeliveryData, VariantData, ProductInfoData,
  ProductDocData, ImageData, TrafficLoopData, BrandStoryData,
  AplusData, VideoData, QAData, ReviewData as CrawlReviewData,
  StoreData, AdCategoryData,
} from "./conversionDataCollector";

/**
 * 将卖家精灵解析的数据转换为 ConversionCrawlData 格式，
 * 使其可以直接传入 scoreAllCheckItems 进行程序化+AI评分。
 */
export function buildCrawlDataFromSellerSprite(
  asin: string,
  productData: Partial<SellerSpriteProductData>,
  keywordData?: SellerSpriteKeywordData[],
  reviewData?: SellerSpriteReviewData[],
): ConversionCrawlData {

  // ── 标题 ──
  const titleText = productData.title || "";
  const titleData: TitleData = {
    text: titleText,
    charCount: titleText.length,
    wordCount: titleText.split(/\s+/).filter(Boolean).length,
    brand: productData.brand || "",
    hasBrand: !!(productData.brand && titleText.toLowerCase().includes(productData.brand.toLowerCase())),
    rawTitle: titleText,
  };

  // ── 五点 ──
  const bullets = productData.bulletPoints || [];
  const bulletCharCounts = bullets.map(b => b.length);
  const bulletPointsData: BulletPointsData = {
    bullets,
    bulletCount: bullets.length,
    avgCharCount: bulletCharCounts.length > 0 ? Math.round(bulletCharCounts.reduce((a, b) => a + b, 0) / bulletCharCounts.length) : 0,
    totalCharCount: bulletCharCounts.reduce((a, b) => a + b, 0),
    charCounts: bulletCharCounts,
  };

  // ── 标签 ──
  const hasBestSeller = !!productData.hasBestSeller;
  const hasAmazonChoice = !!productData.hasAmazonChoice;
  const hasNewRelease = !!productData.hasNewRelease;
  const hasCoupon = !!productData.coupon;
  let badgeCount = 0;
  if (hasBestSeller) badgeCount++;
  if (hasAmazonChoice) badgeCount++;
  if (hasNewRelease) badgeCount++;
  if (hasCoupon) badgeCount++;

  const badges: BadgeData = {
    hasBestSeller,
    hasAmazonChoice,
    hasNewRelease,
    hasDeal: false,
    dealInfo: null,
    hasCoupon,
    couponInfo: productData.coupon || null,
    hasPrime: productData.fulfillment?.toUpperCase().includes('FBA') || false,
    hasSubscribeSave: false,
    hasClimateTag: !!productData.hasCPFGreen,
    hasSmallBusiness: false,
    totalBadges: badgeCount,
  };

  // ── 价格 ──
  const currentPrice = productData.price || null;
  const priceData: PriceData = {
    currentPrice,
    listPrice: null,
    hasStrikethrough: false,
    discountPercent: null,
    hasCoupon,
    couponValue: productData.coupon || null,
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
  const isFBA = productData.fulfillment?.toUpperCase().includes('FBA') || false;
  const deliveryData: DeliveryData = {
    isFBA,
    isFBM: !isFBA && !!productData.fulfillment,
    deliveryDays: null,
    deliveryText: productData.fulfillment || null,
    hasPrime: isFBA,
    hasFreeShipping: isFBA,
    shipsFrom: isFBA ? "Amazon" : null,
    soldBy: productData.buyboxSeller || null,
  };

  // ── 变体 ──
  const variantData: VariantData = {
    variantCount: productData.variationCount || 0,
    variantTypes: [],
    variants: [],
    hasImages: false,
  };

  // ── 产品信息 ──
  const fields: Record<string, string> = {};
  if (productData.productWeight) fields["Item Weight"] = productData.productWeight;
  if (productData.productDimensions) fields["Product Dimensions"] = productData.productDimensions;
  if (productData.packageWeight) fields["Package Weight"] = productData.packageWeight;
  if (productData.packageDimensions) fields["Package Dimensions"] = productData.packageDimensions;
  if (productData.packageSizeTier) fields["Size Tier"] = productData.packageSizeTier;
  if (productData.brand) fields["Brand"] = productData.brand;

  const productInfoData: ProductInfoData = {
    fieldCount: Object.keys(fields).length,
    hasWeight: !!productData.productWeight || !!productData.packageWeight,
    hasDimensions: !!productData.productDimensions || !!productData.packageDimensions,
    hasMaterial: false,
    hasColor: false,
    hasManufacturer: false,
    fields,
  };

  // ── 商品文档 ──
  const productDocData: ProductDocData = {
    hasManual: false,
    hasCertification: false,
    documentCount: 0,
    documentTypes: [],
  };

  // ── 主图 ──
  const imageData: ImageData = {
    mainImages: [],
    mainImageCount: productData.imageCount || 0,
    hasMainImage: (productData.imageCount || 0) > 0,
    mainImageResolution: null,
    secondaryImages: [],
    secondaryImageCount: Math.max(0, (productData.imageCount || 0) - 1),
    aplusImages: [],
    brandStoryImages: [],
    videoCount: productData.hasVideo ? 1 : 0,
    hasVideo: !!productData.hasVideo,
    totalImageCount: productData.imageCount || 0,
  };

  // ── 流量闭环 ──
  const trafficLoopData: TrafficLoopData = {
    hasNewModel: false,
    hasBundleDeal: false,
    hasFrequentlyBought: false,
    hasSponsoredProducts: !!productData.hasSPAd,
    hasVirtualBundle: false,
    hasBrandStoreLink: false,
  };

  // ── 品牌故事 ──
  const brandStoryData: BrandStoryData = {
    hasBrandStory: !!productData.hasBrandStory,
    hasRecommendation: false,
    imageCount: 0,
    textContent: "",
    images: [],
  };

  // ── A+ ──
  const aplusData: AplusData = {
    hasAplus: !!productData.hasAplus,
    moduleCount: productData.hasAplus ? 1 : 0, // 至少知道有A+
    moduleTypes: [],
    hasComparisonChart: false,
    hasVideo: false,
    imageCount: 0,
    textContent: productData.description || "",
    images: [],
  };

  // ── Video ──
  const videoData: VideoData = {
    videoCount: productData.hasVideo ? 1 : 0,
    hasMainVideo: !!productData.hasVideo,
    videoUrls: [],
  };

  // ── Q&A ──
  const qaData: QAData = {
    questionCount: productData.qaCount || 0,
    topQuestions: [],
  };

  // ── Review ──
  // 合并产品数据中的评分和评论文件中的详细评论
  const topReviews: string[] = [];
  const ratingDistribution: Record<string, number> = {};
  let hasVine = false;
  if (reviewData && reviewData.length > 0) {
    for (const r of reviewData) {
      const reviewText = [r.title, r.content].filter(Boolean).join(': ');
      if (reviewText) topReviews.push(reviewText);
      if (r.isVineVoice) hasVine = true;
    }
    // 计算评分分布
    const dist: Record<number, number> = {};
    for (const r of reviewData) {
      dist[r.rating] = (dist[r.rating] || 0) + 1;
    }
    const total = reviewData.length;
    for (const [star, count] of Object.entries(dist)) {
      ratingDistribution[`${star} star`] = Math.round((count / total) * 100);
    }
  }

  const crawlReviewData: CrawlReviewData = {
    rating: productData.rating || null,
    reviewCount: productData.reviewCount || null,
    hasVine,
    topReviews: topReviews.slice(0, 20),
    ratingDistribution,
  };

  // ── 店铺 ──
  const storeData: StoreData = {
    feedbackScore: null,
    feedbackCount: null,
    hasStorefront: false,
    storeName: productData.buyboxSeller || null,
  };

  // ── 广告 ──
  // 从关键词数据中构建广告信息
  const adKeywords = (keywordData || []).filter(k => k.adRank && k.adRank > 0);
  const adCategoryData: AdCategoryData = {
    hasCampaigns: adKeywords.length > 0 || !!productData.hasSPAd,
    campaignCount: adKeywords.length > 0 ? 1 : 0,
    totalSpend: null,
    acos: null,
    roas: null,
    keywordCount: adKeywords.length,
    topKeywords: adKeywords.slice(0, 20).map(k => ({
      keyword: k.keyword,
      impressions: k.impressions || 0,
      clicks: k.clicks || 0,
      spend: k.ppcBid ? k.ppcBid * (k.clicks || 0) : 0,
      acos: 0,
    })),
    searchTerms: (keywordData || []).slice(0, 20).map(k => ({
      term: k.keyword,
      impressions: k.impressions || 0,
      clicks: k.clicks || 0,
      conversions: k.purchaseCount || 0,
    })),
  };

  return {
    asin: asin.toUpperCase(),
    crawledAt: new Date().toISOString(),
    hasData: true,
    dataSourceStatus: {
      scraper: { success: false, error: "使用卖家精灵数据替代爬虫" },
      competitor: { success: false, error: "使用卖家精灵数据替代" },
      lingxingAd: { success: adKeywords.length > 0, error: adKeywords.length > 0 ? undefined : "使用卖家精灵关键词数据" },
    },
    raw: {
      scraperData: null,
      competitorData: null,
      adData: null,
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
      Review: crawlReviewData,
      店铺介绍页面: storeData,
      广告: adCategoryData,
    },
  };
}
