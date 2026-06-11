/**
 * Unit tests for SellerSprite Excel upload feature
 * Tests the parseSellerSpriteData function with realistic CSV data
 * derived from the actual SellerSprite search export format
 */
import { describe, it, expect } from "vitest";

// Import the parser function
import { parseSellerSpriteData } from "./routers/sellerSpriteImporter";

// Minimal CSV header matching the actual SellerSprite search export format
const SEARCH_RESULT_HEADER = `"#","图片","ASIN","SKU","详细参数","品牌","品牌链接","搜索排名","商品标题","产品卖点","商品详情页链接","商品主图","父ASIN","类目路径","大类目","大类BSR","大类BSR增长数","大类BSR增长率","小类目","小类BSR","月销量","月销量增长率","月销售额($)","子体销量","子体销售额($)","变体数","价格($)","Prime价格($)","Coupon","Q&A数","评分数","月新增评分数","评分","留评率","FBA($)","毛利率","评级","上架时间","上架天数","配送方式","买家运费($)","LQS","卖家数","Buybox卖家","BuyBox类型","卖家所属地","卖家信息","卖家首页","Best Seller标识","Amazon's Choice","CPF绿标","CPF绿标信息","New Release标识","A+页面","视频介绍","SP广告","品牌故事","品牌广告","7天促销","AC关键词","商品重量","商品重量（单位换算）","商品尺寸","商品尺寸（单位换算）","包装重量","包装重量（单位换算）","包装尺寸","包装尺寸（单位换算）","包装尺寸分段"`;

// Sample data row with realistic values
const SAMPLE_DATA_ROW = `"1","","B0GL2LSB6C","","","LndscLaser","","广告位：第1页第1位","3rd-Gen Dreadlocks Machine, Patented Needle Retraction","【No More Waiting】Skip the 5-10 hours in a salon chair.","https://www.amazon.com/dp/B0GL2LSB6C","https://m.media-amazon.com/images/I/test.jpg","B0GL2LSB6C","Beauty & Personal Care > Hair Care","Beauty & Personal Care","2500","100","4.2%","Hair Braiding Machines","15","1200","5.3%","45600","800","30400","3","38.99","38.99","","45","1250","85","4.3","2.1%","8.50","0.32","A","2024-01-15","450","FBA","0","75","2","LndscLaser","Prime","CN","","","是","是","","","","是","","是","","","","","","0.5 lb","0.23 kg","8 x 4 x 3 in","20.3 x 10.2 x 7.6 cm","0.8 lb","0.36 kg","9 x 5 x 4 in","22.9 x 12.7 x 10.2 cm","小号标准件"`;

const SAMPLE_CSV = `${SEARCH_RESULT_HEADER}\n${SAMPLE_DATA_ROW}`;

describe("SellerSprite Excel Upload - parseSellerSpriteData", () => {
  it("should detect product/search_result file type from Chinese headers", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    expect(result.success).toBe(true);
    // SellerSprite search result files are classified as 'product' type
    // since they share the same column structure (商品标题, 大类BSR, etc.)
    expect(["product", "search_result"]).toContain(result.fileType);
  });

  it("should parse ASIN correctly", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    expect(result.products).toHaveLength(1);
    expect(result.products[0].asin).toBe("B0GL2LSB6C");
  });

  it("should parse product title correctly", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    expect(result.products[0].title).toContain("Dreadlocks Machine");
  });

  it("should parse brand correctly", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    expect(result.products[0].brand).toBe("LndscLaser");
  });

  it("should parse numeric fields: price, rating, reviewCount", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    const p = result.products[0];
    expect(p.price).toBe(38.99);
    expect(p.rating).toBe(4.3);
    expect(p.reviewCount).toBe(1250);
  });

  it("should parse sales metrics: monthlySales, monthlyRevenue", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    const p = result.products[0];
    expect(p.monthlySales).toBe(1200);
    expect(p.monthlyRevenue).toBe(45600);
  });

  it("should parse BSR ranks", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    const p = result.products[0];
    expect(p.bsrRank).toBe(2500);
    expect(p.subCategoryRank).toBe(15);
  });

  it("should parse FBA fee and gross margin", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    const p = result.products[0];
    expect(p.fbaFee).toBe(8.5);
    // grossMargin is 0.32 (32%)
    expect(p.grossMargin).toBeCloseTo(0.32, 2);
  });

  it("should parse boolean flags: hasSPAd, hasAplus, hasBestSeller, hasAmazonChoice", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    const p = result.products[0];
    expect(p.hasSPAd).toBe(true);
    expect(p.hasAplus).toBe(true);
    expect(p.hasBestSeller).toBe(true);
    expect(p.hasAmazonChoice).toBe(true);
  });

  it("should parse fulfillment method", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    expect(result.products[0].fulfillment).toBe("FBA");
  });

  it("should parse bullet points from 产品卖点 column", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    const p = result.products[0];
    expect(p.bulletPoints).toBeDefined();
    expect(Array.isArray(p.bulletPoints)).toBe(true);
    if (p.bulletPoints && p.bulletPoints.length > 0) {
      expect(p.bulletPoints[0]).toContain("Waiting");
    }
  });

  it("should return totalRows and parsedRows counts", () => {
    const result = parseSellerSpriteData(SAMPLE_CSV, undefined);
    expect(result.totalRows).toBe(1);
    expect(result.parsedRows).toBe(1);
  });

  it("should handle empty CSV gracefully", () => {
    const result = parseSellerSpriteData("", undefined);
    expect(result.success).toBe(false);
    expect(result.products).toHaveLength(0);
  });

  it("should handle CSV with only header row", () => {
    const result = parseSellerSpriteData(SEARCH_RESULT_HEADER, undefined);
    // Should parse successfully but with 0 products
    expect(result.products).toHaveLength(0);
  });

  it("should handle multiple data rows", () => {
    const multiRowCSV = `${SEARCH_RESULT_HEADER}\n${SAMPLE_DATA_ROW}\n${SAMPLE_DATA_ROW.replace("B0GL2LSB6C", "B0TESTTEST")}`;
    const result = parseSellerSpriteData(multiRowCSV, undefined);
    expect(result.products.length).toBeGreaterThanOrEqual(1);
  });
});
