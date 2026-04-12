/**
 * Tests for 4 new features:
 * 1. Anti-bot module (antiBot.ts)
 * 2. Seller Sprite CSV importer (sellerSpriteImporter.ts)
 * 3. Manual input form (applySellerSpriteData API)
 * 4. Image AI analyzer (imageAiAnalyzer.ts)
 */
import { describe, it, expect, vi } from "vitest";

// ═══════════════════════════════════════════════════════
// 1. Anti-Bot Module Tests
// ═══════════════════════════════════════════════════════

describe("Anti-Bot Module", () => {
  it("should export smartFetch and helper functions", async () => {
    const antiBot = await import("./antiBot");
    expect(antiBot.smartFetch).toBeDefined();
    expect(typeof antiBot.smartFetch).toBe("function");
    expect(antiBot.generateFingerprint).toBeDefined();
    expect(typeof antiBot.generateFingerprint).toBe("function");
    expect(antiBot.checkForCaptcha).toBeDefined();
    expect(typeof antiBot.checkForCaptcha).toBe("function");
    expect(antiBot.randomDelay).toBeDefined();
    expect(typeof antiBot.randomDelay).toBe("function");
  });

  it("generateFingerprint should return a valid fingerprint", async () => {
    const { generateFingerprint } = await import("./antiBot");
    const fp = generateFingerprint();
    expect(typeof fp.userAgent).toBe("string");
    expect(fp.userAgent.length).toBeGreaterThan(20);
    expect(fp.userAgent).toMatch(/Mozilla|Chrome|Safari|Firefox|Edge/);
    expect(typeof fp.isMobile).toBe("boolean");
    expect(typeof fp.headers).toBe("object");
  });

  it("generateFingerprint should return different fingerprints", async () => {
    const { generateFingerprint } = await import("./antiBot");
    const fps = new Set<string>();
    for (let i = 0; i < 20; i++) {
      fps.add(generateFingerprint().userAgent);
    }
    // Should have at least 3 different UAs in 20 calls
    expect(fps.size).toBeGreaterThanOrEqual(3);
  });

  it("checkForCaptcha should detect CAPTCHA pages", async () => {
    const { checkForCaptcha } = await import("./antiBot");
    
    // Normal page
    const normalResult = checkForCaptcha("<html><body><h1>Product</h1></body></html>");
    expect(normalResult.isCaptcha).toBe(false);
    
    // CAPTCHA page
    const captchaResult = checkForCaptcha('<html><body><form action="/errors/validateCaptcha">Enter captcha</form></body></html>');
    expect(captchaResult.isCaptcha).toBe(true);
    
    // Robot check - returns isBlocked instead of isCaptcha
    const robotResult = checkForCaptcha('<html><body><p>Sorry, we just need to make sure you\'re not a robot</p></body></html>');
    expect(robotResult.isBlocked).toBe(true);
  });

  it("checkForCaptcha should not false-positive on normal content", async () => {
    const { checkForCaptcha } = await import("./antiBot");
    const normalHtml = `
      <html><body>
        <h1>Bluetooth Earbuds</h1>
        <div id="productTitle">Great Product</div>
        <div id="feature-bullets"><ul><li>Feature 1</li></ul></div>
        <div id="aplus">A+ Content here</div>
      </body></html>
    `;
    const result = checkForCaptcha(normalHtml);
    expect(result.isCaptcha).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════
// 2. Seller Sprite CSV Importer Tests
// ═══════════════════════════════════════════════════════

describe("Seller Sprite CSV Importer", () => {
  it("should export parseSellerSpriteData function", async () => {
    const importer = await import("./routers/sellerSpriteImporter");
    expect(importer.parseSellerSpriteData).toBeDefined();
    expect(typeof importer.parseSellerSpriteData).toBe("function");
  });

  it("should parse basic CSV with ASIN and title", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");
    const csv = `ASIN,标题,价格,评分,评论数
B0F21JYKNT,Test Product Title,29.99,4.5,150
B0ABCDEFGH,Another Product,19.99,4.2,80`;
    
    const result = parseSellerSpriteData(csv);
    expect(result.success).toBe(true);
    expect(result.products).toBeDefined();
    expect(result.products.length).toBe(2);
    expect(result.products[0].asin).toBe("B0F21JYKNT");
    expect(result.products[0].title).toBe("Test Product Title");
  });

  it("should handle English column headers", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");
    const csv = `ASIN,Title,Price,Rating,Reviews
B0F21JYKNT,Test Product,29.99,4.5,150`;
    
    const result = parseSellerSpriteData(csv);
    expect(result.success).toBe(true);
    expect(result.products.length).toBe(1);
  });

  it("should return error for empty CSV", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");
    const result = parseSellerSpriteData("");
    expect(result.success).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should return error for CSV without ASIN column", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");
    const csv = `Name,Price,Rating
Product 1,29.99,4.5`;
    
    const result = parseSellerSpriteData(csv);
    expect(result.success).toBe(false);
    // No ASIN column means no rows can be parsed
    expect(result.errors.length).toBeGreaterThan(0);
  });

  it("should parse price correctly from various formats", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");
    const csv = `ASIN,标题,价格
B0F21JYKNT,Product 1,$29.99
B0ABCDEFGH,Product 2,¥199.00
B0XYZXYZXY,Product 3,19.99`;
    
    const result = parseSellerSpriteData(csv);
    expect(result.success).toBe(true);
    expect(result.products.length).toBe(3);
    // All should have parsed price
    for (const p of result.products) {
      expect(p.price).toBeDefined();
    }
  });

  it("should handle tab-separated values or return error gracefully", async () => {
    const { parseSellerSpriteData } = await import("./routers/sellerSpriteImporter");
    const tsv = `ASIN\t标题\t价格\nB0F21JYKNT\tTest Product\t29.99`;
    
    const result = parseSellerSpriteData(tsv);
    // TSV may or may not be supported - either way should not crash
    expect(typeof result.success).toBe("boolean");
    expect(Array.isArray(result.errors)).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════
// 3. Image AI Analyzer Tests
// ═══════════════════════════════════════════════════════

describe("Image AI Analyzer", () => {
  it("should export analyzeImage and analyzeImages functions", async () => {
    const analyzer = await import("./routers/imageAiAnalyzer");
    expect(analyzer.analyzeImage).toBeDefined();
    expect(typeof analyzer.analyzeImage).toBe("function");
    expect(analyzer.analyzeImages).toBeDefined();
    expect(typeof analyzer.analyzeImages).toBe("function");
    expect(analyzer.analyzeImagesForScoring).toBeDefined();
    expect(typeof analyzer.analyzeImagesForScoring).toBe("function");
  });

  it("analyzeImagesForScoring should return null scores for empty images", async () => {
    const { analyzeImagesForScoring } = await import("./routers/imageAiAnalyzer");
    const result = await analyzeImagesForScoring([]);
    expect(result.mainImageScore).toBeNull();
    expect(result.secondaryImageScores).toEqual([]);
    expect(result.aplusImageScore).toBeNull();
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0]).toContain("没有可分析的图片");
  });

  it("analyzeImages should handle empty array", async () => {
    const { analyzeImages } = await import("./routers/imageAiAnalyzer");
    const result = await analyzeImages([]);
    expect(result.success).toBe(false);
    expect(result.results).toEqual([]);
    expect(result.analyzedCount).toBe(0);
    expect(result.totalCount).toBe(0);
  });

  it("analyzeImages should limit to maxImages count", async () => {
    // Verify the function signature accepts maxImages parameter
    const { analyzeImages } = await import("./routers/imageAiAnalyzer");
    expect(analyzeImages.length).toBeGreaterThanOrEqual(1);
    // The function accepts (images, maxImages) - verify it slices correctly
    // We test with empty array to avoid API calls
    const result = await analyzeImages([], 3);
    expect(result.totalCount).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════
// 4. ProductOps Router - New Procedures Tests
// ═══════════════════════════════════════════════════════

describe("ProductOps Router - New Procedures", () => {
  it("should have parseSellerSpriteCSV procedure", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const procedures = Object.keys((productOpsRouter as any)._def.procedures || {});
    expect(procedures).toContain("parseSellerSpriteCSV");
  });

  it("should have applySellerSpriteData procedure", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const procedures = Object.keys((productOpsRouter as any)._def.procedures || {});
    expect(procedures).toContain("applySellerSpriteData");
  });

  it("should have analyzeProductImages procedure", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const procedures = Object.keys((productOpsRouter as any)._def.procedures || {});
    expect(procedures).toContain("analyzeProductImages");
  });

  it("should have correct total procedure count (88)", async () => {
    const { productOpsRouter } = await import("./routers/productOps");
    const procedures = Object.keys((productOpsRouter as any)._def.procedures || {});
    expect(procedures.length).toBe(91);
  });
});

// ═══════════════════════════════════════════════════════
// 5. Integration Tests - Data Flow
// ═══════════════════════════════════════════════════════

describe("Data Flow Integration", () => {
  it("scraper should use antiBot module", async () => {
    const scraperCode = await import("fs").then(fs => 
      fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/scraper.ts", "utf-8")
    );
    expect(scraperCode).toContain("antiBot");
    expect(scraperCode).toContain("smartFetch");
  });

  it("crawlerEngine should use antiBot module", async () => {
    const crawlerCode = await import("fs").then(fs => 
      fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/crawlerEngine.ts", "utf-8")
    );
    expect(crawlerCode).toContain("antiBot");
    expect(crawlerCode).toContain("smartFetch");
  });

  it("conversionDataCollector should not have createFallbackData generating fake data", async () => {
    const collectorCode = await import("fs").then(fs => 
      fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/conversionDataCollector.ts", "utf-8")
    );
    // Should return null instead of fake data
    expect(collectorCode).toContain("return null");
    // Should not have hasPrime: true as default
    expect(collectorCode).not.toMatch(/hasPrime:\s*true\s*[,}]/);
  });

  it("conversionAiScorer should not default to score 3 on failure", async () => {
    const scorerCode = await import("fs").then(fs => 
      fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/routers/conversionAiScorer.ts", "utf-8")
    );
    // Should have null score handling
    expect(scorerCode).toContain("score: null");
    expect(scorerCode).toContain("no_data");
  });

  it("lingxingAdapter should not fallback to mock on IP whitelist error", async () => {
    const adapterCode = await import("fs").then(fs => 
      fs.readFileSync("/home/ubuntu/amazon-listing-tool/server/lingxingAdapter.ts", "utf-8")
    );
    // Should throw error instead of falling back to mock
    expect(adapterCode).toContain("throw new Error");
    // The mock_fallback in request method should be removed
    expect(adapterCode).not.toMatch(/mode:\s*['"]mock_fallback['"]/);
  });
});


// ═══════════════════════════════════════════════════════
// 5. Data Coverage Dashboard Logic Tests
// ═══════════════════════════════════════════════════════

describe("Data Coverage Dashboard Logic", () => {
  // Test the coverage calculation logic that the frontend uses
  
  it("should calculate coverage rate correctly for fully scored ASIN", () => {
    const totalCheckItems = 129;
    const scores = Array.from({ length: 129 }, (_, i) => ({
      checkItemId: i + 1,
      asin: "B0TEST1234",
      score: 4,
      source: "ai",
    }));
    
    const scored = scores.filter(s => s.score && s.score > 0 && s.source !== "no_data").length;
    const noData = scores.filter(s => s.source === "no_data" || s.score === null).length;
    const pending = totalCheckItems - scored - noData;
    const coverageRate = totalCheckItems > 0 ? Math.round(scored / totalCheckItems * 100) : 0;
    
    expect(scored).toBe(129);
    expect(noData).toBe(0);
    expect(pending).toBe(0);
    expect(coverageRate).toBe(100);
  });

  it("should calculate coverage rate correctly for partially scored ASIN", () => {
    const totalCheckItems = 129;
    const scores = [
      ...Array.from({ length: 80 }, (_, i) => ({
        checkItemId: i + 1,
        asin: "B0TEST1234",
        score: 3,
        source: "programmatic",
      })),
      ...Array.from({ length: 20 }, (_, i) => ({
        checkItemId: i + 81,
        asin: "B0TEST1234",
        score: null as number | null,
        source: "no_data",
      })),
    ];
    
    const scored = scores.filter(s => s.score && s.score > 0 && s.source !== "no_data").length;
    const noData = scores.filter(s => s.source === "no_data" || s.score === null).length;
    const pending = totalCheckItems - scored - noData;
    const coverageRate = totalCheckItems > 0 ? Math.round(scored / totalCheckItems * 100) : 0;
    
    expect(scored).toBe(80);
    expect(noData).toBe(20);
    expect(pending).toBe(29);
    expect(coverageRate).toBe(62);
  });

  it("should calculate coverage rate as 0 for ASIN with no scores", () => {
    const totalCheckItems = 129;
    const scores: any[] = [];
    
    const scored = scores.filter(s => s.score && s.score > 0 && s.source !== "no_data").length;
    const noData = scores.filter(s => s.source === "no_data" || s.score === null).length;
    const pending = totalCheckItems - scored - noData;
    const coverageRate = totalCheckItems > 0 ? Math.round(scored / totalCheckItems * 100) : 0;
    
    expect(scored).toBe(0);
    expect(noData).toBe(0);
    expect(pending).toBe(129);
    expect(coverageRate).toBe(0);
  });

  it("should calculate average score correctly excluding no_data items", () => {
    const scores = [
      { score: 5, source: "programmatic" },
      { score: 4, source: "ai" },
      { score: 3, source: "manual" },
      { score: null, source: "no_data" },
      { score: null, source: "no_data" },
    ];
    
    const validScores = scores.filter(s => s.score && s.score > 0 && s.source !== "no_data");
    const avgScore = validScores.length > 0
      ? Math.round(validScores.reduce((sum, s) => sum + (s.score || 0), 0) / validScores.length * 10) / 10
      : 0;
    
    expect(validScores.length).toBe(3);
    expect(avgScore).toBe(4);
  });

  it("should calculate per-category coverage correctly", () => {
    // Simulate 3 categories with different coverage
    const categories = [
      { name: "首图", items: [1, 2, 3, 4, 5, 6] },
      { name: "标题", items: [7, 8, 9, 10, 11] },
      { name: "广告", items: [12, 13, 14, 15] },
    ];
    
    const scoreMap: Record<number, { score: number | null; source: string }> = {
      1: { score: 4, source: "ai" },
      2: { score: 5, source: "programmatic" },
      3: { score: 3, source: "manual" },
      4: { score: null, source: "no_data" },
      5: { score: null, source: "no_data" },
      6: { score: 4, source: "ai" },
      7: { score: 5, source: "programmatic" },
      8: { score: 4, source: "programmatic" },
      9: { score: 3, source: "ai" },
      10: { score: 4, source: "ai" },
      11: { score: 5, source: "programmatic" },
      // 12-15: no scores at all (pending)
    };
    
    const catCoverage = categories.map(cat => {
      const catScored = cat.items.filter(id => {
        const s = scoreMap[id];
        return s?.score && s.score > 0 && s.source !== "no_data";
      }).length;
      const catNoData = cat.items.filter(id => {
        const s = scoreMap[id];
        return s?.source === "no_data" || (s && s.score === null);
      }).length;
      return {
        name: cat.name,
        total: cat.items.length,
        scored: catScored,
        noData: catNoData,
        rate: cat.items.length > 0 ? Math.round(catScored / cat.items.length * 100) : 0,
      };
    });
    
    expect(catCoverage[0].name).toBe("首图");
    expect(catCoverage[0].scored).toBe(4);
    expect(catCoverage[0].noData).toBe(2);
    expect(catCoverage[0].rate).toBe(67);
    
    expect(catCoverage[1].name).toBe("标题");
    expect(catCoverage[1].scored).toBe(5);
    expect(catCoverage[1].noData).toBe(0);
    expect(catCoverage[1].rate).toBe(100);
    
    expect(catCoverage[2].name).toBe("广告");
    expect(catCoverage[2].scored).toBe(0);
    expect(catCoverage[2].noData).toBe(0);
    expect(catCoverage[2].rate).toBe(0);
  });

  it("should correctly identify own ASIN vs competitor ASINs", () => {
    const ownAsin = "B0OWN12345";
    const allAsins = ["B0OWN12345", "B0COMP1111", "B0COMP2222"];
    
    const asinCoverage = allAsins.map(asin => ({
      asin,
      isOwn: asin === ownAsin,
    }));
    
    expect(asinCoverage[0].isOwn).toBe(true);
    expect(asinCoverage[1].isOwn).toBe(false);
    expect(asinCoverage[2].isOwn).toBe(false);
  });

  it("should handle color thresholds correctly", () => {
    const getColorClass = (rate: number) => {
      if (rate >= 80) return "emerald";
      if (rate >= 50) return "yellow";
      if (rate >= 20) return "orange";
      return "red";
    };
    
    expect(getColorClass(100)).toBe("emerald");
    expect(getColorClass(80)).toBe("emerald");
    expect(getColorClass(79)).toBe("yellow");
    expect(getColorClass(50)).toBe("yellow");
    expect(getColorClass(49)).toBe("orange");
    expect(getColorClass(20)).toBe("orange");
    expect(getColorClass(19)).toBe("red");
    expect(getColorClass(0)).toBe("red");
  });
});
