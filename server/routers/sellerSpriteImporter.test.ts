import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import {
  parseSellerSpriteXlsx,
  parseSellerSpriteData,
  mergeSellerSpriteWithCrawlData,
  type SellerSpriteProductData,
} from './sellerSpriteImporter';

// ═══════════════════════════════════════════════════════════════════════
// Helper: 创建模拟xlsx Buffer
// ═══════════════════════════════════════════════════════════════════════

function createXlsxBuffer(headers: string[], rows: any[][]): Buffer {
  const wb = XLSX.utils.book_new();
  const data = [headers, ...rows];
  const ws = XLSX.utils.aoa_to_sheet(data);
  XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');
  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
}

// ═══════════════════════════════════════════════════════════════════════
// 产品数据解析测试
// ═══════════════════════════════════════════════════════════════════════

describe('parseSellerSpriteXlsx - 产品数据', () => {
  it('应正确解析产品数据xlsx文件', () => {
    const headers = ['ASIN', '商品标题', '品牌', '价格($)', '评分', '评分数', '月销量', '变体数', '大类BSR', '配送方式', 'LQS', 'Q&A数'];
    const rows = [
      ['B0F21JYKNT', 'Test Product Title', 'TestBrand', 29.99, 4.5, 1234, 500, 3, 5000, 'FBA', 8, 25],
      ['B0ABCDEFGH', 'Another Product', 'Brand2', 19.99, 4.2, 567, 200, 1, 10000, 'FBM', 6, 10],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.success).toBe(true);
    expect(result.fileType).toBe('product');
    expect(result.products.length).toBe(2);
    expect(result.parsedRows).toBe(2);
    expect(result.totalRows).toBe(2);

    const p1 = result.products[0];
    expect(p1.asin).toBe('B0F21JYKNT');
    expect(p1.title).toBe('Test Product Title');
    expect(p1.brand).toBe('TestBrand');
    expect(p1.price).toBe(29.99);
    expect(p1.rating).toBe(4.5);
    expect(p1.reviewCount).toBe(1234);
    expect(p1.monthlySales).toBe(500);
    expect(p1.variationCount).toBe(3);
    expect(p1.bsrRank).toBe(5000);
    expect(p1.fulfillment).toBe('FBA');
    expect(p1.lqs).toBe(8);
    expect(p1.qaCount).toBe(25);
  });

  it('应正确解析产品标签字段', () => {
    const headers = ['ASIN', '商品标题', 'Best Seller标识', "Amazon's Choice", 'A+页面', '视频介绍', '品牌故事', 'SP广告', 'AC关键词'];
    const rows = [
      ['B0F21JYKNT', 'Test', 'Y', 'Y', 'Y', 'Y', 'Y', 'N', 'wireless charger'],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.success).toBe(true);
    const p = result.products[0];
    expect(p.hasBestSeller).toBe(true);
    expect(p.hasAmazonChoice).toBe(true);
    expect(p.hasAplus).toBe(true);
    expect(p.hasVideo).toBe(true);
    expect(p.hasBrandStory).toBe(true);
    expect(p.hasSPAd).toBe(false);
    expect(p.acKeyword).toBe('wireless charger');
  });

  it('应正确解析物流尺寸字段', () => {
    const headers = ['ASIN', '商品标题', '商品重量', '商品尺寸', '包装重量', '包装尺寸', '包装尺寸分段'];
    const rows = [
      ['B0F21JYKNT', 'Test', '1.5 pounds', '10 x 5 x 3 inches', '2.0 pounds', '12 x 6 x 4 inches', 'Standard-Size'],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.success).toBe(true);
    const p = result.products[0];
    expect(p.productWeight).toBe('1.5 pounds');
    expect(p.productDimensions).toBe('10 x 5 x 3 inches');
    expect(p.packageWeight).toBe('2.0 pounds');
    expect(p.packageDimensions).toBe('12 x 6 x 4 inches');
    expect(p.packageSizeTier).toBe('Standard-Size');
  });

  it('应支持targetAsin过滤', () => {
    const headers = ['ASIN', '商品标题', '价格($)'];
    const rows = [
      ['B0F21JYKNT', 'Target Product', 29.99],
      ['B0ABCDEFGH', 'Other Product', 19.99],
      ['B0XXXXXXXXX', 'Third Product', 39.99],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer, 'B0F21JYKNT');

    expect(result.success).toBe(true);
    expect(result.products.length).toBe(1);
    expect(result.products[0].asin).toBe('B0F21JYKNT');
  });

  it('应正确处理空值和缺失字段', () => {
    const headers = ['ASIN', '商品标题', '价格($)', '评分', '月销量'];
    const rows = [
      ['B0F21JYKNT', 'Test', '-', 'N/A', ''],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.success).toBe(true);
    const p = result.products[0];
    expect(p.price).toBeUndefined();
    expect(p.rating).toBeUndefined();
    expect(p.monthlySales).toBeUndefined();
  });

  it('应正确解析五点描述', () => {
    const headers = ['ASIN', '商品标题', '产品卖点'];
    const rows = [
      ['B0F21JYKNT', 'Test', 'Point 1\nPoint 2\nPoint 3\nPoint 4\nPoint 5'],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.success).toBe(true);
    const p = result.products[0];
    expect(p.bulletPoints).toEqual(['Point 1', 'Point 2', 'Point 3', 'Point 4', 'Point 5']);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 关键词数据解析测试
// ═══════════════════════════════════════════════════════════════════════

describe('parseSellerSpriteXlsx - 关键词数据', () => {
  it('应正确解析关键词xlsx文件', () => {
    const headers = ['流量词', '关键词翻译', '月搜索量', '自然排名', '广告排名', 'SPR', 'PPC价格', 'ABA周排名', '标题密度', '流量占比'];
    const rows = [
      ['wireless charger', '无线充电器', 50000, 5, 3, 8, 1.25, 1500, 12, 0.15],
      ['phone charger', '手机充电器', 80000, 12, 0, 15, 0.95, 800, 8, 0.08],
      ['fast charger', '快充', 30000, 0, 0, 5, 1.50, 3000, 3, 0.03],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.success).toBe(true);
    expect(result.fileType).toBe('keyword');
    expect(result.keywords.length).toBe(3);
    expect(result.parsedRows).toBe(3);

    const k1 = result.keywords[0];
    expect(k1.keyword).toBe('wireless charger');
    expect(k1.keywordTranslation).toBe('无线充电器');
    expect(k1.searchVolume).toBe(50000);
    expect(k1.organicRank).toBe(5);
    expect(k1.adRank).toBe(3);
    expect(k1.spr).toBe(8);
    expect(k1.ppcBid).toBe(1.25);
    expect(k1.abaWeeklyRank).toBe(1500);
    expect(k1.titleDensity).toBe(12);
    expect(k1.trafficShare).toBe(0.15);
  });

  it('应正确解析AC推荐词字段', () => {
    const headers = ['流量词', 'AC推荐词', '月搜索量'];
    const rows = [
      ['wireless charger', 'Y', 50000],
      ['phone charger', 'N', 80000],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.success).toBe(true);
    expect(result.keywords[0].isACRecommended).toBe(true);
    expect(result.keywords[1].isACRecommended).toBe(false);
  });

  it('应跳过空关键词行', () => {
    const headers = ['流量词', '月搜索量'];
    const rows = [
      ['wireless charger', 50000],
      ['', 0],
      ['phone charger', 80000],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.keywords.length).toBe(2);
    expect(result.parsedRows).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 评论数据解析测试
// ═══════════════════════════════════════════════════════════════════════

describe('parseSellerSpriteXlsx - 评论数据', () => {
  it('应正确解析评论xlsx文件', () => {
    const headers = ['ASIN', '标题', '内容', 'VP评论', 'Vine Voice评论', '型号', '星级', '赞同数', '评论时间', '评论人', '所属国家'];
    const rows = [
      ['B0F21JYKNT', 'Great product!', 'This charger works perfectly with my phone.', 'Y', 'N', 'Black', 5, 12, '2025-03-15', 'John D.', 'US'],
      ['B0F21JYKNT', 'Not bad', 'Decent quality for the price.', 'Y', 'N', 'White', 4, 3, '2025-03-10', 'Jane S.', 'US'],
      ['B0F21JYKNT', 'Terrible', 'Stopped working after 2 weeks.', 'N', 'Y', 'Black', 1, 0, '2025-03-01', 'Bob M.', 'UK'],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.success).toBe(true);
    expect(result.fileType).toBe('review');
    expect(result.reviews.length).toBe(3);
    expect(result.parsedRows).toBe(3);

    const r1 = result.reviews[0];
    expect(r1.asin).toBe('B0F21JYKNT');
    expect(r1.title).toBe('Great product!');
    expect(r1.content).toBe('This charger works perfectly with my phone.');
    expect(r1.isVerified).toBe(true);
    expect(r1.isVineVoice).toBe(false);
    expect(r1.variant).toBe('Black');
    expect(r1.rating).toBe(5);
    expect(r1.helpfulVotes).toBe(12);
    expect(r1.date).toBe('2025-03-15');
    expect(r1.reviewer).toBe('John D.');
    expect(r1.reviewerCountry).toBe('US');
  });

  it('应自动去重评论', () => {
    const headers = ['内容', '星级', '评论人'];
    const rows = [
      ['Great product!', 5, 'John'],
      ['Great product!', 5, 'John'], // 重复
      ['Different review', 4, 'Jane'],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.reviews.length).toBe(2);
    expect(result.warnings.some(w => w.includes('去重'))).toBe(true);
  });

  it('应跳过空内容的评论', () => {
    const headers = ['内容', '星级'];
    const rows = [
      ['Good product', 5],
      ['', 3],
      ['Another review', 4],
    ];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.reviews.length).toBe(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 文件类型检测测试
// ═══════════════════════════════════════════════════════════════════════

describe('文件类型自动检测', () => {
  it('应识别关键词文件', () => {
    const headers = ['流量词', '月搜索量', 'SPR'];
    const rows = [['test keyword', 5000, 8]];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);
    expect(result.fileType).toBe('keyword');
  });

  it('应识别评论文件', () => {
    const headers = ['内容', '星级', 'VP评论'];
    const rows = [['Good product', 5, 'Y']];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);
    expect(result.fileType).toBe('review');
  });

  it('应识别产品文件', () => {
    const headers = ['ASIN', '商品标题', '大类BSR', '月销量'];
    const rows = [['B0F21JYKNT', 'Test', 5000, 500]];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);
    expect(result.fileType).toBe('product');
  });

  it('未知列名但有ASIN列应回退到产品类型', () => {
    const headers = ['ASIN', 'Unknown Column', 'Another Column'];
    const rows = [['B0F21JYKNT', 'value1', 'value2']];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);
    // 有ASIN列时会被detectFileType识别为产品类型，不会触发警告
    expect(result.fileType).toBe('product');
    expect(result.success).toBe(true);
  });

  it('完全未知列名应触发警告', () => {
    const headers = ['Col1', 'Col2', 'Col3'];
    const rows = [['val1', 'val2', 'val3']];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);
    expect(result.fileType).toBe('product');
    expect(result.warnings.some(w => w.includes('无法自动识别'))).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// CSV向后兼容测试
// ═══════════════════════════════════════════════════════════════════════

describe('parseSellerSpriteData - CSV兼容', () => {
  it('应正确解析CSV格式的产品数据', () => {
    const csv = 'ASIN,商品标题,价格($),评分,月销量\nB0F21JYKNT,Test Product,29.99,4.5,500\nB0ABCDEFGH,Other Product,19.99,4.2,200';
    const result = parseSellerSpriteData(csv);

    expect(result.success).toBe(true);
    expect(result.fileType).toBe('product');
    expect(result.products.length).toBe(2);
    expect(result.products[0].asin).toBe('B0F21JYKNT');
    expect(result.products[0].price).toBe(29.99);
  });

  it('应正确解析CSV格式的关键词数据', () => {
    const csv = '流量词,月搜索量,自然排名,PPC价格\nwireless charger,50000,5,1.25\nphone charger,80000,12,0.95';
    const result = parseSellerSpriteData(csv);

    expect(result.success).toBe(true);
    expect(result.fileType).toBe('keyword');
    expect(result.keywords.length).toBe(2);
    expect(result.keywords[0].keyword).toBe('wireless charger');
    expect(result.keywords[0].searchVolume).toBe(50000);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 列名映射测试
// ═══════════════════════════════════════════════════════════════════════

describe('列名映射', () => {
  it('应记录识别到的列名映射', () => {
    const headers = ['ASIN', '商品标题', '价格($)', '未知列'];
    const rows = [['B0F21JYKNT', 'Test', 29.99, 'unknown']];
    const buffer = createXlsxBuffer(headers, rows);
    const result = parseSellerSpriteXlsx(buffer);

    expect(result.columnMapping['ASIN']).toBe('asin');
    expect(result.columnMapping['商品标题']).toBe('title');
    expect(result.columnMapping['价格($)']).toBe('price');
    expect(result.columnMapping['未知列']).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════
// 错误处理测试
// ═══════════════════════════════════════════════════════════════════════

describe('错误处理', () => {
  it('应处理空文件', () => {
    const buffer = createXlsxBuffer([], []);
    const result = parseSellerSpriteXlsx(buffer);
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('应处理只有表头的文件', () => {
    const buffer = createXlsxBuffer(['ASIN', '商品标题'], []);
    const result = parseSellerSpriteXlsx(buffer);
    expect(result.success).toBe(false);
    expect(result.errors.some(e => e.includes('空'))).toBe(true);
  });

  it('应处理无效的Buffer', () => {
    const result = parseSellerSpriteXlsx(Buffer.from('invalid data'));
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it('CSV空文本应返回错误', () => {
    const result = parseSellerSpriteData('');
    expect(result.success).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════
// mergeSellerSpriteWithCrawlData 测试
// ═══════════════════════════════════════════════════════════════════════

describe('mergeSellerSpriteWithCrawlData', () => {
  it('应补充爬虫缺失的字段', () => {
    const ssData: SellerSpriteProductData = {
      asin: 'B0F21JYKNT',
      title: 'SS Title',
      brand: 'SS Brand',
      price: 29.99,
      rating: 4.5,
      reviewCount: 1234,
      monthlySales: 500,
      fulfillment: 'FBA',
      bsrRank: 5000,
      lqs: 8,
      qaCount: 25,
    };
    const existing = {};
    const merged = mergeSellerSpriteWithCrawlData(ssData, existing);

    expect(merged.title).toBe('SS Title');
    expect(merged._titleSource).toBe('sellersprite');
    expect(merged.brand).toBe('SS Brand');
    expect(merged.price).toBe('$29.99');
    expect(merged.rating).toBe('4.5');
    expect(merged.reviewCount).toBe('1234');
    expect(merged.fulfillment).toBe('FBA');
    expect(merged.bsrRank).toBe(5000);
    expect(merged.lqs).toBe(8);
    expect(merged.qaCount).toBe(25);
  });

  it('不应覆盖已有的爬虫数据', () => {
    const ssData: SellerSpriteProductData = {
      asin: 'B0F21JYKNT',
      title: 'SS Title',
      price: 29.99,
      rating: 4.5,
    };
    const existing = {
      title: 'Crawled Title',
      price: '$24.99',
      rating: '4.3',
    };
    const merged = mergeSellerSpriteWithCrawlData(ssData, existing);

    expect(merged.title).toBe('Crawled Title');
    expect(merged.price).toBe('$24.99');
    expect(merged.rating).toBe('4.3');
  });

  it('应补充标签信息', () => {
    const ssData: SellerSpriteProductData = {
      asin: 'B0F21JYKNT',
      hasBestSeller: true,
      hasAmazonChoice: true,
      hasAplus: true,
      hasVideo: true,
      hasBrandStory: true,
    };
    const existing = {};
    const merged = mergeSellerSpriteWithCrawlData(ssData, existing);

    expect(merged.hasBestSeller).toBe(true);
    expect(merged.hasAmazonChoice).toBe(true);
    expect(merged.hasAplus).toBe(true);
    expect(merged.hasVideo).toBe(true);
    expect(merged.hasBrandStory).toBe(true);
  });
});
