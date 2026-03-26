import { describe, it, expect } from "vitest";
import { buildCrawlDataFromSellerSprite } from "./sellerSpriteImporter";
import type { SellerSpriteProductData, SellerSpriteKeywordData, SellerSpriteReviewData } from "./sellerSpriteImporter";

describe("buildCrawlDataFromSellerSprite", () => {
  const mockProduct: Partial<SellerSpriteProductData> = {
    asin: "B0F21JYKNT",
    title: "Portable Charger Power Bank 10000mAh - USB C Fast Charging",
    brand: "INIU",
    price: 79.99,
    rating: 4.6,
    reviewCount: 107,
    monthlySales: 503,
    bsrRank: 1234,
    variationCount: 3,
    fulfillment: "FBA",
    imageCount: 7,
    bulletPoints: [
      "Ultra Slim & Lightweight Design",
      "USB-C Fast Charging Technology",
      "Universal Compatibility",
      "LED Battery Indicator",
      "What You Get"
    ],
    hasAplus: true,
    hasVideo: true,
    hasBrandStory: true,
    hasBestSeller: true,
    hasSPAd: true,
    qaCount: 15,
    lqs: 85,
    productWeight: "0.44 pounds",
    productDimensions: "5.2 x 2.7 x 0.5 inches",
  };

  const mockKeywords: SellerSpriteKeywordData[] = [
    {
      keyword: "portable charger",
      searchVolume: 50000,
      organicRank: 5,
      adRank: 2,
      spr: 120,
      ppcBid: 1.5,
      clicks: 200,
      impressions: 5000,
    },
    {
      keyword: "power bank",
      searchVolume: 80000,
      organicRank: 12,
      adRank: 0,
      spr: 200,
    },
  ];

  const mockReviews: SellerSpriteReviewData[] = [
    { content: "Great product, charges fast!", rating: 5, isVerified: true, title: "Love it" },
    { content: "Stopped working after 2 weeks", rating: 1, isVerified: true, isVineVoice: true, title: "Disappointed" },
    { content: "Good value for money", rating: 4, isVerified: true, title: "Decent" },
    { content: "Average quality", rating: 3, isVerified: false, title: "OK" },
    { content: "Best charger I've owned", rating: 5, isVerified: true, title: "Amazing" },
  ];

  it("should return valid ConversionCrawlData structure", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    expect(result.asin).toBe("B0F21JYKNT");
    expect(result.hasData).toBe(true);
    expect(result.crawledAt).toBeTruthy();
    expect(result.categories).toBeTruthy();
    // Must have all 18 categories
    const expectedCategories = [
      "标题", "五点", "标", "价格", "限购", "配送", "变体",
      "产品信息", "商品文档", "主图", "流量闭环", "品牌故事",
      "A+", "Video", "Q&A", "Review", "店铺介绍页面", "广告"
    ];
    for (const cat of expectedCategories) {
      expect(result.categories).toHaveProperty(cat);
    }
  });

  it("should correctly map title data", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    const title = result.categories["标题"];
    expect(title.text).toBe(mockProduct.title);
    expect(title.charCount).toBe(mockProduct.title!.length);
    expect(title.wordCount).toBeGreaterThan(0);
    expect(title.brand).toBe("INIU");
    expect(title.hasBrand).toBe(false); // "INIU" is not in the title text
  });

  it("should correctly map bullet points data", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    const bp = result.categories["五点"];
    expect(bp.bulletCount).toBe(5);
    expect(bp.bullets).toHaveLength(5);
    expect(bp.avgCharCount).toBeGreaterThan(0);
    expect(bp.totalCharCount).toBeGreaterThan(0);
  });

  it("should correctly map badge data", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    const badges = result.categories["标"];
    expect(badges.hasBestSeller).toBe(true);
    expect(badges.hasPrime).toBe(true); // FBA = Prime
    expect(badges.totalBadges).toBeGreaterThanOrEqual(1);
  });

  it("should correctly map price data", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    const price = result.categories["价格"];
    expect(price.currentPrice).toBe(79.99);
    expect(price.buyBoxPrice).toBe(79.99);
    expect(price.priceEnding).toBe("99");
  });

  it("should correctly map delivery data from FBA fulfillment", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    const delivery = result.categories["配送"];
    expect(delivery.isFBA).toBe(true);
    expect(delivery.hasPrime).toBe(true);
    expect(delivery.hasFreeShipping).toBe(true);
  });

  it("should correctly map variant data", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    const variant = result.categories["变体"];
    expect(variant.variantCount).toBe(3);
  });

  it("should correctly map image data", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    const img = result.categories["主图"];
    expect(img.mainImageCount).toBe(7);
    expect(img.hasMainImage).toBe(true);
    expect(img.hasVideo).toBe(true);
    expect(img.videoCount).toBe(1);
  });

  it("should correctly map A+ and brand story data", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    expect(result.categories["A+"].hasAplus).toBe(true);
    expect(result.categories["品牌故事"].hasBrandStory).toBe(true);
    expect(result.categories["Video"].hasMainVideo).toBe(true);
  });

  it("should correctly map Q&A data", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    expect(result.categories["Q&A"].questionCount).toBe(15);
  });

  it("should correctly map product info with dimensions", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    const info = result.categories["产品信息"];
    expect(info.hasWeight).toBe(true);
    expect(info.hasDimensions).toBe(true);
    expect(info.fieldCount).toBeGreaterThanOrEqual(3);
  });

  it("should correctly process keyword data for ad category", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct, mockKeywords);
    const ad = result.categories["广告"];
    expect(ad.hasCampaigns).toBe(true);
    expect(ad.keywordCount).toBe(1); // only 1 keyword has adRank > 0
    expect(ad.topKeywords.length).toBe(1);
    expect(ad.topKeywords[0].keyword).toBe("portable charger");
    expect(ad.searchTerms.length).toBe(2); // all keywords as search terms
  });

  it("should correctly process review data", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct, undefined, mockReviews);
    const review = result.categories["Review"];
    expect(review.rating).toBe(4.6);
    expect(review.reviewCount).toBe(107);
    expect(review.hasVine).toBe(true);
    expect(review.topReviews.length).toBe(5);
    expect(review.ratingDistribution).toBeTruthy();
    // Should have distribution for ratings 1, 3, 4, 5
    expect(Object.keys(review.ratingDistribution).length).toBe(4);
  });

  it("should handle minimal data gracefully", () => {
    const result = buildCrawlDataFromSellerSprite("B0TEST123", { asin: "B0TEST123" });
    expect(result.asin).toBe("B0TEST123");
    expect(result.hasData).toBe(true);
    expect(result.categories["标题"].text).toBe("");
    expect(result.categories["五点"].bulletCount).toBe(0);
    expect(result.categories["价格"].currentPrice).toBeNull();
    expect(result.categories["配送"].isFBA).toBe(false);
    expect(result.categories["主图"].mainImageCount).toBe(0);
  });

  it("should combine all three data sources", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct, mockKeywords, mockReviews);
    // All categories should be populated
    expect(result.categories["标题"].text).toBeTruthy();
    expect(result.categories["五点"].bulletCount).toBe(5);
    expect(result.categories["价格"].currentPrice).toBe(79.99);
    expect(result.categories["广告"].keywordCount).toBe(1);
    expect(result.categories["Review"].topReviews.length).toBe(5);
    expect(result.categories["Review"].hasVine).toBe(true);
    expect(result.categories["A+"].hasAplus).toBe(true);
    expect(result.categories["Video"].hasMainVideo).toBe(true);
    expect(result.categories["品牌故事"].hasBrandStory).toBe(true);
  });

  it("should set traffic loop data correctly", () => {
    const result = buildCrawlDataFromSellerSprite("B0F21JYKNT", mockProduct);
    expect(result.categories["流量闭环"].hasSponsoredProducts).toBe(true);
  });
});
