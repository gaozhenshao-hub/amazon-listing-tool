import { describe, it, expect } from "vitest";
import { scoreListing } from "./scoringEngine";
import type { ListingScore, KeywordModuleData } from "./scoringEngine";

describe("Scoring Engine", () => {
  const goodTitle = "Premium Wireless Bluetooth Headphones - Active Noise Cancelling Over-Ear Headset with Hi-Res Audio, 40H Battery Life, Foldable Design for Travel, Work, Gaming - Compatible with iPhone, Android, PC";

  const goodBullets = JSON.stringify({
    bulletPoints: [
      {
        subtitle: "[Superior Sound Quality]",
        fullText: "Experience crystal-clear audio with our advanced 40mm dynamic drivers that deliver deep bass, balanced mids, and crisp highs. The Hi-Res Audio certification ensures you hear every detail in your favorite music, podcasts, and calls with studio-quality precision.",
        sellingPoint: "Sound Quality",
      },
      {
        subtitle: "[Active Noise Cancelling]",
        fullText: "Block out the world with our intelligent ANC technology that reduces ambient noise by up to 95%. Three adjustable modes let you customize your listening experience whether you are on a plane, in the office, or commuting through busy streets daily.",
        sellingPoint: "Noise Cancelling",
      },
      {
        subtitle: "[40-Hour Battery Life]",
        fullText: "Enjoy marathon listening sessions with an impressive 40-hour battery on a single charge. Quick charge technology gives you 3 hours of playback from just 10 minutes of charging, so you never have to worry about running out of power on the go.",
        sellingPoint: "Battery Life",
      },
      {
        subtitle: "[Premium Comfort Design]",
        fullText: "Ultra-soft memory foam ear cushions and an adjustable headband provide all-day comfort without pressure. The lightweight 250g foldable design makes these headphones perfect for travel and storage in the included premium carrying case.",
        sellingPoint: "Comfort",
      },
      {
        subtitle: "[Universal Compatibility]",
        fullText: "Connect seamlessly via Bluetooth 5.3 to any device including iPhone, Android, iPad, Mac, and PC. The included 3.5mm audio cable provides a wired option for airplane entertainment systems and gaming consoles with zero latency.",
        sellingPoint: "Compatibility",
      },
    ],
  });

  const goodDescription = "Introducing our Premium Wireless Bluetooth Headphones, the perfect companion for music lovers and professionals alike. Engineered with cutting-edge audio technology, these headphones deliver an immersive listening experience that transforms how you enjoy music, take calls, and focus on work.\n\nOur advanced Active Noise Cancelling technology uses dual microphones to analyze and neutralize ambient sounds, creating a peaceful bubble wherever you go. Whether you are on a crowded flight or in a noisy office, you will enjoy pristine audio quality.\n\nThe ergonomic over-ear design features premium memory foam cushions that conform to your ears for maximum comfort during extended listening sessions. The adjustable headband distributes weight evenly, eliminating pressure points even after hours of use.\n\nWith 40 hours of battery life and quick charge capability, these wireless headphones keep up with your busiest days. Bluetooth 5.3 ensures stable, low-latency connections to all your devices, while the included 3.5mm cable provides a wired backup option.";

  const goodSearchTerms = "wireless headphones noise cancelling bluetooth over ear headset hi-res audio foldable travel office gaming comfortable lightweight long battery";

  const coreKeywords = ["wireless headphones", "noise cancelling", "bluetooth", "over ear", "headset", "hi-res", "foldable", "travel", "gaming", "battery"];

  // Keyword module data structure (replaces old ABA a9Keywords)
  const sampleKwData: KeywordModuleData = {
    coreKeywords: ["wireless headphones", "noise cancelling", "bluetooth", "over ear", "headset"],
    keywordsByPlacement: {
      titleFront: ["wireless headphones", "bluetooth headphones"],
      titleMid: ["noise cancelling", "over ear"],
      titleEnd: ["gaming headset"],
      bulletFirst: ["battery life", "comfortable"],
      bulletBody: ["foldable", "travel"],
      aplus: ["premium audio"],
      searchTerm: ["hi-res audio", "lightweight headphones"],
    },
    keywordsByStrategy: {
      coreMain: ["wireless headphones", "bluetooth headphones"],
      subCore: ["noise cancelling headphones", "over ear headset"],
      preciseLongtail: ["wireless headphones with microphone", "noise cancelling headphones for travel"],
      sceneIntent: ["headphones for office", "headphones for gaming"],
      longtailMain: ["foldable bluetooth headphones"],
    },
    totalKeywords: 25,
  };

  it("should return a valid score structure", () => {
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: "高级无线蓝牙耳机",
        bulletPointsCn: null,
        descriptionCn: "产品描述中文版",
        searchTermsCn: null,
        imageAdvice: '{"mainImage": "test"}',
      },
      null,
      coreKeywords
    );

    expect(result).toBeDefined();
    expect(result.totalScore).toBeGreaterThan(0);
    expect(result.maxScore).toBe(100);
    expect(result.percentage).toBeGreaterThanOrEqual(0);
    expect(result.percentage).toBeLessThanOrEqual(100);
    expect(result.grade).toBeDefined();
    expect(result.dimensions).toHaveLength(6);
    expect(result.scoredAt).toBeDefined();
  });

  it("should score a well-optimized listing highly", () => {
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: "高级无线蓝牙耳机",
        bulletPointsCn: JSON.stringify([]),
        descriptionCn: "产品描述中文版",
        searchTermsCn: "搜索词中文版",
        imageAdvice: '{"mainImage": "test"}',
      },
      null,
      coreKeywords
    );

    // A well-optimized listing should score at least 60%
    expect(result.percentage).toBeGreaterThanOrEqual(60);
    expect(["A+", "A", "B+", "B", "C"]).toContain(result.grade);
  });

  it("should score an empty listing very low", () => {
    const result = scoreListing(
      {
        title: null,
        bulletPoints: null,
        description: null,
        searchTerms: null,
        titleCn: null,
        bulletPointsCn: null,
        descriptionCn: null,
        searchTermsCn: null,
        imageAdvice: null,
      },
      null,
      []
    );

    expect(result.percentage).toBeLessThan(30);
    expect(["D", "F"]).toContain(result.grade);
    expect(result.suggestions.length).toBeGreaterThan(0);
  });

  it("should detect title length issues", () => {
    // Short title
    const shortResult = scoreListing(
      {
        title: "Short Title",
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      null,
      coreKeywords
    );

    const titleDim = shortResult.dimensions.find(d => d.name === "Title Optimization");
    expect(titleDim).toBeDefined();
    // Short title should not get full marks on title length
    const lengthDetail = titleDim!.details.find(d => d.rule.includes("Title Length"));
    expect(lengthDetail).toBeDefined();
    expect(lengthDetail!.passed).toBe(false);
  });

  it("should detect missing bullet points", () => {
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: JSON.stringify({ bulletPoints: [
          { subtitle: "[Test]", fullText: "A single bullet point that is long enough to meet the minimum character count requirement for Amazon listing optimization.", sellingPoint: "Test" },
        ]}),
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      null,
      coreKeywords
    );

    const bulletDim = result.dimensions.find(d => d.name === "Bullet Points Quality");
    expect(bulletDim).toBeDefined();
    const countDetail = bulletDim!.details.find(d => d.rule.includes("5 Bullet Points"));
    expect(countDetail).toBeDefined();
    expect(countDetail!.passed).toBe(false);
  });

  it("should detect search terms over byte limit", () => {
    // Create search terms over 249 bytes
    const longSearchTerms = Array(50).fill("keyword").join(" ");
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: longSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      null,
      coreKeywords
    );

    const stDim = result.dimensions.find(d => d.name === "Search Terms Optimization");
    expect(stDim).toBeDefined();
    const lenDetail = stDim!.details.find(d => d.rule.includes("Search Terms Length"));
    expect(lenDetail).toBeDefined();
    expect(lenDetail!.passed).toBe(false);
  });

  it("should check keyword coverage with keyword module data", () => {
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      sampleKwData,
      coreKeywords
    );

    const kwDim = result.dimensions.find(d => d.name === "Keyword Coverage");
    expect(kwDim).toBeDefined();
    // With good keyword coverage, should score well
    expect(kwDim!.percentage).toBeGreaterThanOrEqual(50);

    // Verify the new rule names are used (not old ABA-based names)
    const ruleNames = kwDim!.details.map(d => d.rule);
    expect(ruleNames).toContain("Title Placement Keywords Coverage");
    expect(ruleNames).toContain("Bullet Placement Keywords Coverage");
    expect(ruleNames).toContain("Long-tail & Scene Keywords Coverage");
    // Old ABA-based rules should NOT exist
    expect(ruleNames).not.toContain("Title Must-Have Keywords Coverage");
    expect(ruleNames).not.toContain("Golden Long-Tail Keywords Coverage");
    expect(ruleNames).not.toContain("A9 Keyword Data Available");
  });

  it("should show keyword module data not available when no kwData", () => {
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      null,
      coreKeywords
    );

    const kwDim = result.dimensions.find(d => d.name === "Keyword Coverage");
    expect(kwDim).toBeDefined();
    const moduleRule = kwDim!.details.find(d => d.rule === "Keyword Module Data Available");
    expect(moduleRule).toBeDefined();
    expect(moduleRule!.passed).toBe(false);
    expect(moduleRule!.message).toContain("keyword management module");
    expect(moduleRule!.messageCn).toContain("关键词管理模块");
  });

  it("should show keyword module data not available when totalKeywords is 0", () => {
    const emptyKwData: KeywordModuleData = {
      coreKeywords: [],
      keywordsByPlacement: {
        titleFront: [], titleMid: [], titleEnd: [],
        bulletFirst: [], bulletBody: [], aplus: [], searchTerm: [],
      },
      keywordsByStrategy: {
        coreMain: [], subCore: [], preciseLongtail: [], sceneIntent: [], longtailMain: [],
      },
      totalKeywords: 0,
    };

    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      emptyKwData,
      []
    );

    const kwDim = result.dimensions.find(d => d.name === "Keyword Coverage");
    expect(kwDim).toBeDefined();
    expect(kwDim!.details).toHaveLength(1);
    expect(kwDim!.details[0].rule).toBe("Keyword Module Data Available");
  });

  it("should correctly score title placement keyword coverage", () => {
    // Create kwData where title keywords are present in the listing
    const kwDataWithTitleKws: KeywordModuleData = {
      coreKeywords: ["wireless headphones"],
      keywordsByPlacement: {
        titleFront: ["wireless headphones", "bluetooth"],
        titleMid: ["noise cancelling"],
        titleEnd: ["gaming"],
        bulletFirst: [], bulletBody: [], aplus: [], searchTerm: [],
      },
      keywordsByStrategy: {
        coreMain: ["wireless headphones"],
        subCore: [], preciseLongtail: [], sceneIntent: [], longtailMain: [],
      },
      totalKeywords: 5,
    };

    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      kwDataWithTitleKws,
      coreKeywords
    );

    const kwDim = result.dimensions.find(d => d.name === "Keyword Coverage");
    const titleRule = kwDim!.details.find(d => d.rule === "Title Placement Keywords Coverage");
    expect(titleRule).toBeDefined();
    // All title keywords should be found in the listing
    expect(titleRule!.passed).toBe(true);
    expect(titleRule!.score).toBe(4); // max score for this rule
  });

  it("should correctly score bullet placement keyword coverage", () => {
    const kwDataWithBulletKws: KeywordModuleData = {
      coreKeywords: [],
      keywordsByPlacement: {
        titleFront: [], titleMid: [], titleEnd: [],
        bulletFirst: ["battery life", "noise cancelling"],
        bulletBody: ["foldable", "travel"],
        aplus: [], searchTerm: [],
      },
      keywordsByStrategy: {
        coreMain: [],
        subCore: ["comfortable headphones"],
        preciseLongtail: [], sceneIntent: [], longtailMain: [],
      },
      totalKeywords: 5,
    };

    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      kwDataWithBulletKws,
      coreKeywords
    );

    const kwDim = result.dimensions.find(d => d.name === "Keyword Coverage");
    const bulletRule = kwDim!.details.find(d => d.rule === "Bullet Placement Keywords Coverage");
    expect(bulletRule).toBeDefined();
    expect(bulletRule!.score).toBeGreaterThan(0);
  });

  it("should correctly score long-tail and scene keyword coverage", () => {
    const kwDataWithLongtail: KeywordModuleData = {
      coreKeywords: [],
      keywordsByPlacement: {
        titleFront: [], titleMid: [], titleEnd: [],
        bulletFirst: [], bulletBody: [], aplus: [],
        searchTerm: ["hi-res audio", "lightweight"],
      },
      keywordsByStrategy: {
        coreMain: [], subCore: [],
        preciseLongtail: ["wireless headphones"],
        sceneIntent: ["headphones for travel"],
        longtailMain: [],
      },
      totalKeywords: 4,
    };

    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      kwDataWithLongtail,
      coreKeywords
    );

    const kwDim = result.dimensions.find(d => d.name === "Keyword Coverage");
    const longtailRule = kwDim!.details.find(d => d.rule === "Long-tail & Scene Keywords Coverage");
    expect(longtailRule).toBeDefined();
    expect(longtailRule!.score).toBeGreaterThan(0);
  });

  it("should generate optimization suggestions for failing rules", () => {
    const result = scoreListing(
      {
        title: "Short",
        bulletPoints: null,
        description: "",
        searchTerms: null,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      null,
      []
    );

    expect(result.suggestions.length).toBeGreaterThan(0);
    // Should have high priority suggestions
    const highPriority = result.suggestions.filter(s => s.priority === "high");
    expect(highPriority.length).toBeGreaterThan(0);
    // Each suggestion should have both English and Chinese
    for (const sug of result.suggestions) {
      expect(sug.suggestion).toBeTruthy();
      expect(sug.suggestionCn).toBeTruthy();
      expect(sug.impact).toBeTruthy();
      expect(sug.impactCn).toBeTruthy();
    }
  });

  it("should award bilingual and image advice bonus in SEO score", () => {
    const withBilingual = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: "中文标题",
        bulletPointsCn: null,
        descriptionCn: "中文描述",
        searchTermsCn: null,
        imageAdvice: '{"mainImage": "advice"}',
      },
      null,
      coreKeywords
    );

    const withoutBilingual = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null,
        bulletPointsCn: null,
        descriptionCn: null,
        searchTermsCn: null,
        imageAdvice: null,
      },
      null,
      coreKeywords
    );

    const seoDimWith = withBilingual.dimensions.find(d => d.name === "Overall SEO");
    const seoDimWithout = withoutBilingual.dimensions.find(d => d.name === "Overall SEO");
    expect(seoDimWith!.score).toBeGreaterThan(seoDimWithout!.score);
  });

  it("should detect prohibited claims in description", () => {
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: "This is the #1 best seller product with guaranteed satisfaction and free shipping worldwide. Money back if not satisfied.",
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      null,
      coreKeywords
    );

    const descDim = result.dimensions.find(d => d.name === "Description Quality");
    const prohibitedDetail = descDim!.details.find(d => d.rule.includes("Prohibited"));
    expect(prohibitedDetail).toBeDefined();
    expect(prohibitedDetail!.passed).toBe(false);
  });

  it("should have correct max scores summing to 100", () => {
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      null,
      coreKeywords
    );

    const totalMax = result.dimensions.reduce((sum, d) => sum + d.maxScore, 0);
    expect(totalMax).toBe(100);
    expect(result.maxScore).toBe(100);
  });

  it("should not reference ABA in any messages when keyword module data is provided", () => {
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      sampleKwData,
      coreKeywords
    );

    // Check all messages don't contain "ABA" references
    for (const dim of result.dimensions) {
      for (const detail of dim.details) {
        expect(detail.message).not.toContain("ABA");
        expect(detail.messageCn).not.toContain("ABA");
      }
    }
  });

  it("should not reference ABA in any messages when no keyword data", () => {
    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      null,
      []
    );

    // Check all messages don't contain "ABA" references
    for (const dim of result.dimensions) {
      for (const detail of dim.details) {
        expect(detail.message).not.toContain("ABA");
        expect(detail.messageCn).not.toContain("ABA");
      }
    }
  });
});
