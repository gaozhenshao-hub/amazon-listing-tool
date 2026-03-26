/**
 * SellerSprite (卖家精灵) CSV/Excel Import Parser
 * 
 * 解析卖家精灵导出的产品数据文件，提取可用于转化率对比评分的字段。
 * 支持中英文列名自动识别，兼容CSV和Excel格式。
 * 
 * 覆盖的数据类别：
 * - 标题 (Title)
 * - 五点 (Bullet Points)  
 * - 变体 (Variations)
 * - 产品信息 (Product Info)
 * - 价格 (Price)
 * - 配送 (Fulfillment)
 * - Review
 * - 广告关键词 (Ad Keywords)
 */

// ═══════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════

export interface SellerSpriteProductData {
  asin: string;
  title?: string;
  brand?: string;
  category?: string;
  bsrRank?: number;
  subCategoryRank?: number;
  price?: number;
  rating?: number;
  reviewCount?: number;
  monthlySales?: number;
  monthlyRevenue?: number;
  launchDate?: string;
  sellerCount?: number;
  variationCount?: number;
  fbaFee?: number;
  fulfillment?: string;  // FBA / FBM / AMZ
  imageCount?: number;
  bulletPoints?: string[];
  description?: string;
  // 关键词相关
  keywords?: SellerSpriteKeywordData[];
  // 评论相关
  reviews?: SellerSpriteReviewData[];
}

export interface SellerSpriteKeywordData {
  keyword: string;
  searchVolume?: number;
  organicRank?: number;
  adRank?: number;
  ppcBid?: number;
  titleDensity?: number;
}

export interface SellerSpriteReviewData {
  content: string;
  rating: number;
  date?: string;
  isVerified?: boolean;
  title?: string;
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
// Column Name Mapping (中英文双语)
// ═══════════════════════════════════════════════════════════════════════

/** 列名到标准字段的映射 */
const COLUMN_MAPPINGS: Record<string, string> = {
  // ASIN
  'asin': 'asin',
  'ASIN': 'asin',
  'Asin': 'asin',
  'Parent ASIN': 'parentAsin',
  '父ASIN': 'parentAsin',
  
  // 标题
  'title': 'title',
  'Title': 'title',
  '标题': 'title',
  'Product Title': 'title',
  '产品标题': 'title',
  '商品名称': 'title',
  
  // 品牌
  'brand': 'brand',
  'Brand': 'brand',
  '品牌': 'brand',
  'Brand Name': 'brand',
  '品牌名称': 'brand',
  
  // 品类
  'category': 'category',
  'Category': 'category',
  '品类': 'category',
  '类目': 'category',
  'Main Category': 'category',
  '大类': 'category',
  
  // BSR排名
  'bsr': 'bsrRank',
  'BSR': 'bsrRank',
  'BSR Rank': 'bsrRank',
  '大类排名': 'bsrRank',
  'Best Sellers Rank': 'bsrRank',
  
  // 小类排名
  'Sub Category Rank': 'subCategoryRank',
  '小类排名': 'subCategoryRank',
  'Sub BSR': 'subCategoryRank',
  
  // 价格
  'price': 'price',
  'Price': 'price',
  '价格': 'price',
  '售价': 'price',
  'Current Price': 'price',
  '当前价格': 'price',
  
  // 评分
  'rating': 'rating',
  'Rating': 'rating',
  '评分': 'rating',
  'Star Rating': 'rating',
  '星级': 'rating',
  'Avg Rating': 'rating',
  '平均评分': 'rating',
  
  // 评论数
  'reviews': 'reviewCount',
  'Reviews': 'reviewCount',
  'Review Count': 'reviewCount',
  '评论数': 'reviewCount',
  '评论数量': 'reviewCount',
  'Ratings': 'reviewCount',
  '评分数': 'reviewCount',
  
  // 月销量
  'Monthly Sales': 'monthlySales',
  '月销量': 'monthlySales',
  'Est. Monthly Sales': 'monthlySales',
  '预估月销量': 'monthlySales',
  'Sales': 'monthlySales',
  '销量': 'monthlySales',
  
  // 月收入
  'Monthly Revenue': 'monthlyRevenue',
  '月收入': 'monthlyRevenue',
  'Est. Monthly Revenue': 'monthlyRevenue',
  '预估月收入': 'monthlyRevenue',
  'Revenue': 'monthlyRevenue',
  '收入': 'monthlyRevenue',
  
  // 上架时间
  'Launch Date': 'launchDate',
  '上架时间': 'launchDate',
  'Date First Available': 'launchDate',
  '首次上架': 'launchDate',
  '上架日期': 'launchDate',
  
  // 卖家数
  'Sellers': 'sellerCount',
  '卖家数': 'sellerCount',
  'Seller Count': 'sellerCount',
  '卖家数量': 'sellerCount',
  
  // 变体数
  'Variations': 'variationCount',
  '变体数': 'variationCount',
  'Variation Count': 'variationCount',
  '变体数量': 'variationCount',
  
  // FBA费用
  'FBA Fee': 'fbaFee',
  'FBA费用': 'fbaFee',
  'FBA Fees': 'fbaFee',
  
  // 配送方式
  'Fulfillment': 'fulfillment',
  '配送方式': 'fulfillment',
  'Fulfilled By': 'fulfillment',
  '发货方式': 'fulfillment',
  'FBA/FBM': 'fulfillment',
  
  // 图片数
  'Images': 'imageCount',
  '图片数': 'imageCount',
  'Image Count': 'imageCount',
  '图片数量': 'imageCount',
  
  // 五点描述
  'Bullet Points': 'bulletPoints',
  '五点描述': 'bulletPoints',
  'Bullet Point': 'bulletPoints',
  '卖点': 'bulletPoints',
  'Feature Bullets': 'bulletPoints',
  '产品特点': 'bulletPoints',
  // 分开的五点
  'Bullet Point 1': 'bulletPoint1',
  'Bullet Point 2': 'bulletPoint2',
  'Bullet Point 3': 'bulletPoint3',
  'Bullet Point 4': 'bulletPoint4',
  'Bullet Point 5': 'bulletPoint5',
  '五点1': 'bulletPoint1',
  '五点2': 'bulletPoint2',
  '五点3': 'bulletPoint3',
  '五点4': 'bulletPoint4',
  '五点5': 'bulletPoint5',
  
  // 描述
  'Description': 'description',
  '描述': 'description',
  '产品描述': 'description',
  'Product Description': 'description',
  
  // 关键词相关
  'Keyword': 'keyword',
  '关键词': 'keyword',
  'Search Term': 'keyword',
  '搜索词': 'keyword',
  
  'Search Volume': 'searchVolume',
  '搜索量': 'searchVolume',
  'Monthly Search Volume': 'searchVolume',
  '月搜索量': 'searchVolume',
  
  'Organic Rank': 'organicRank',
  '自然排名': 'organicRank',
  'Natural Rank': 'organicRank',
  
  'Ad Rank': 'adRank',
  '广告排名': 'adRank',
  'Sponsored Rank': 'adRank',
  'SP Rank': 'adRank',
  
  'PPC Bid': 'ppcBid',
  '广告竞价': 'ppcBid',
  'CPC': 'ppcBid',
  'Bid': 'ppcBid',
  
  'Title Density': 'titleDensity',
  '标题密度': 'titleDensity',
  
  // 评论相关
  'Review Content': 'reviewContent',
  '评论内容': 'reviewContent',
  'Review Text': 'reviewContent',
  'Content': 'reviewContent',
  
  'Review Rating': 'reviewRating',
  '评论评分': 'reviewRating',
  'Star': 'reviewRating',
  
  'Review Date': 'reviewDate',
  '评论日期': 'reviewDate',
  'Date': 'reviewDate',
  '日期': 'reviewDate',
  
  'Verified Purchase': 'isVerified',
  'VP': 'isVerified',
  '是否VP': 'isVerified',
  
  'Review Title': 'reviewTitle',
  '评论标题': 'reviewTitle',
};

// ═══════════════════════════════════════════════════════════════════════
// CSV Parser
// ═══════════════════════════════════════════════════════════════════════

/**
 * 解析CSV文本内容
 */
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let inQuotes = false;
  
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];
    
    if (inQuotes) {
      if (char === '"' && nextChar === '"') {
        currentField += '"';
        i++; // skip next quote
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
        if (currentRow.some(f => f !== '')) {
          rows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
        if (char === '\r') i++; // skip \n
      } else {
        currentField += char;
      }
    }
  }
  
  // Last field/row
  currentRow.push(currentField.trim());
  if (currentRow.some(f => f !== '')) {
    rows.push(currentRow);
  }
  
  return rows;
}

/**
 * 检测文件类型（产品/关键词/评论）
 */
function detectFileType(headers: string[]): 'product' | 'keyword' | 'review' | 'unknown' {
  const normalizedHeaders = headers.map(h => {
    const mapped = COLUMN_MAPPINGS[h.trim()];
    return mapped || h.trim().toLowerCase();
  });
  
  // 关键词文件特征：有keyword和searchVolume
  const hasKeyword = normalizedHeaders.some(h => h === 'keyword');
  const hasSearchVolume = normalizedHeaders.some(h => h === 'searchVolume');
  if (hasKeyword && hasSearchVolume) return 'keyword';
  
  // 评论文件特征：有reviewContent
  const hasReviewContent = normalizedHeaders.some(h => h === 'reviewContent');
  if (hasReviewContent) return 'review';
  
  // 产品文件特征：有asin
  const hasAsin = normalizedHeaders.some(h => h === 'asin');
  if (hasAsin) return 'product';
  
  return 'unknown';
}

/**
 * 解析数字，支持逗号分隔和货币符号
 */
function parseNumber(value: string): number | undefined {
  if (!value || value === '-' || value === 'N/A' || value === '--') return undefined;
  // 移除货币符号、逗号、空格
  const cleaned = value.replace(/[$€£¥,\s]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? undefined : num;
}

/**
 * 解析布尔值
 */
function parseBoolean(value: string): boolean {
  const lower = value.toLowerCase().trim();
  return lower === 'yes' || lower === 'true' || lower === '是' || lower === '1' || lower === 'y';
}

// ═══════════════════════════════════════════════════════════════════════
// Main Import Function
// ═══════════════════════════════════════════════════════════════════════

/**
 * 解析卖家精灵导出的CSV/Excel文本数据
 * @param text - CSV文本内容（如果是Excel，需要先转换为CSV）
 * @param targetAsin - 可选，只提取特定ASIN的数据
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
    // 解析CSV
    const rows = parseCSV(text);
    if (rows.length < 2) {
      result.errors.push('文件内容为空或只有表头');
      return result;
    }
    
    const headers = rows[0];
    const dataRows = rows.slice(1);
    result.totalRows = dataRows.length;
    
    // 建立列名映射
    const columnMap: Record<number, string> = {};
    headers.forEach((header, index) => {
      const trimmed = header.trim();
      const mapped = COLUMN_MAPPINGS[trimmed];
      if (mapped) {
        columnMap[index] = mapped;
        result.columnMapping[trimmed] = mapped;
      } else {
        // 尝试模糊匹配
        const lowerHeader = trimmed.toLowerCase();
        for (const [key, value] of Object.entries(COLUMN_MAPPINGS)) {
          if (key.toLowerCase() === lowerHeader) {
            columnMap[index] = value;
            result.columnMapping[trimmed] = value;
            break;
          }
        }
      }
    });
    
    // 检测文件类型
    result.fileType = detectFileType(headers);
    
    if (result.fileType === 'unknown') {
      result.warnings.push('无法自动识别文件类型，将尝试按产品数据解析');
      result.fileType = 'product';
    }
    
    // 解析数据行
    for (let rowIdx = 0; rowIdx < dataRows.length; rowIdx++) {
      const row = dataRows[rowIdx];
      try {
        const rowData: Record<string, string> = {};
        row.forEach((cell, colIdx) => {
          const field = columnMap[colIdx];
          if (field) {
            rowData[field] = cell;
          }
        });
        
        if (result.fileType === 'product') {
          const product = parseProductRow(rowData);
          if (product) {
            // 如果指定了目标ASIN，只保留匹配的
            if (targetAsin && product.asin.toUpperCase() !== targetAsin.toUpperCase()) {
              continue;
            }
            result.products.push(product);
            result.parsedRows++;
          }
        } else if (result.fileType === 'keyword') {
          const keyword = parseKeywordRow(rowData);
          if (keyword) {
            result.keywords.push(keyword);
            result.parsedRows++;
          }
        } else if (result.fileType === 'review') {
          const review = parseReviewRow(rowData);
          if (review) {
            result.reviews.push(review);
            result.parsedRows++;
          }
        }
      } catch (e: any) {
        result.warnings.push(`第${rowIdx + 2}行解析失败: ${e.message}`);
      }
    }
    
    result.success = result.parsedRows > 0;
    
    if (result.parsedRows === 0) {
      result.errors.push('没有成功解析任何数据行，请检查文件格式是否正确');
    }
    
  } catch (e: any) {
    result.errors.push(`文件解析失败: ${e.message}`);
  }
  
  return result;
}

/**
 * 解析产品数据行
 */
function parseProductRow(data: Record<string, string>): SellerSpriteProductData | null {
  const asin = data.asin?.trim();
  if (!asin || asin.length < 5) return null;
  
  // 合并五点描述
  const bulletPoints: string[] = [];
  if (data.bulletPoints) {
    // 可能是用分号或换行分隔的
    bulletPoints.push(...data.bulletPoints.split(/[;\n]/).filter(b => b.trim()));
  }
  for (let i = 1; i <= 5; i++) {
    const bp = data[`bulletPoint${i}`];
    if (bp?.trim()) bulletPoints.push(bp.trim());
  }
  
  return {
    asin: asin.toUpperCase(),
    title: data.title?.trim() || undefined,
    brand: data.brand?.trim() || undefined,
    category: data.category?.trim() || undefined,
    bsrRank: parseNumber(data.bsrRank),
    subCategoryRank: parseNumber(data.subCategoryRank),
    price: parseNumber(data.price),
    rating: parseNumber(data.rating),
    reviewCount: parseNumber(data.reviewCount),
    monthlySales: parseNumber(data.monthlySales),
    monthlyRevenue: parseNumber(data.monthlyRevenue),
    launchDate: data.launchDate?.trim() || undefined,
    sellerCount: parseNumber(data.sellerCount),
    variationCount: parseNumber(data.variationCount),
    fbaFee: parseNumber(data.fbaFee),
    fulfillment: data.fulfillment?.trim() || undefined,
    imageCount: parseNumber(data.imageCount),
    bulletPoints: bulletPoints.length > 0 ? bulletPoints : undefined,
    description: data.description?.trim() || undefined,
  };
}

/**
 * 解析关键词数据行
 */
function parseKeywordRow(data: Record<string, string>): SellerSpriteKeywordData | null {
  const keyword = data.keyword?.trim();
  if (!keyword) return null;
  
  return {
    keyword,
    searchVolume: parseNumber(data.searchVolume),
    organicRank: parseNumber(data.organicRank),
    adRank: parseNumber(data.adRank),
    ppcBid: parseNumber(data.ppcBid),
    titleDensity: parseNumber(data.titleDensity),
  };
}

/**
 * 解析评论数据行
 */
function parseReviewRow(data: Record<string, string>): SellerSpriteReviewData | null {
  const content = data.reviewContent?.trim();
  if (!content) return null;
  
  return {
    content,
    rating: parseNumber(data.reviewRating) ?? 0,
    date: data.reviewDate?.trim() || undefined,
    isVerified: data.isVerified ? parseBoolean(data.isVerified) : undefined,
    title: data.reviewTitle?.trim() || undefined,
  };
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
  
  // 图片数
  if (!merged.imageCount && ssData.imageCount) {
    merged.imageCount = ssData.imageCount;
    merged._imageCountSource = 'sellersprite';
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
  
  return merged;
}
