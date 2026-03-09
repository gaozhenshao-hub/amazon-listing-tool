import { describe, it, expect } from "vitest";
import { scoreListing } from "./scoringEngine";
import type { ListingScore } from "./scoringEngine";

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

  it("should check keyword coverage with A9 data", () => {
    const a9Keywords = {
      titleMustHaveKeywords: [
        { keyword: "wireless headphones" },
        { keyword: "noise cancelling" },
        { keyword: "bluetooth" },
      ],
      bulletPointKeywords: [
        { keyword: "battery life" },
        { keyword: "comfortable" },
      ],
      goldenLongTailKeywords: [
        { keyword: "over ear headset" },
      ],
    };

    const result = scoreListing(
      {
        title: goodTitle,
        bulletPoints: goodBullets,
        description: goodDescription,
        searchTerms: goodSearchTerms,
        titleCn: null, bulletPointsCn: null, descriptionCn: null, searchTermsCn: null, imageAdvice: null,
      },
      a9Keywords,
      coreKeywords
    );

    const kwDim = result.dimensions.find(d => d.name === "Keyword Coverage");
    expect(kwDim).toBeDefined();
    // With good keyword coverage, should score well
    expect(kwDim!.percentage).toBeGreaterThanOrEqual(50);
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
});
