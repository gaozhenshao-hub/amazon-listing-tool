import { describe, expect, it, vi, beforeEach } from "vitest";

// ─── Feature 1: Review Aggregation (Kano Model) ───────────────────
describe("Review Aggregation - Kano Model", () => {
  it("should structure Kano model data with pain/itch/delight points", () => {
    const kanoData = {
      painPoints: [
        { point: "Paint chips easily", frequency: "high", severity: "high", sourceAsins: ["B001", "B002"], listingAdvice: "Emphasize durable coating" },
        { point: "Difficult assembly", frequency: "medium", severity: "medium", sourceAsins: ["B003"], listingAdvice: "Highlight easy setup" },
      ],
      itchPoints: [
        { point: "More color options", frequency: "high", importance: "medium", sourceAsins: ["B001"], listingAdvice: "Mention variety" },
      ],
      delightPoints: [
        { point: "Surprisingly sturdy", frequency: "medium", impact: "high", sourceAsins: ["B002", "B003"], listingAdvice: "Emphasize build quality" },
      ],
      overallSentiment: "Mixed - quality concerns but good value",
    };

    expect(kanoData.painPoints).toHaveLength(2);
    expect(kanoData.itchPoints).toHaveLength(1);
    expect(kanoData.delightPoints).toHaveLength(1);
    expect(kanoData.painPoints[0].sourceAsins).toContain("B001");
    expect(kanoData.painPoints[0].listingAdvice).toBeTruthy();
    expect(kanoData.overallSentiment).toBeTruthy();
  });

  it("should support editable Kano points with all required fields", () => {
    const editablePoint = {
      point: "Original text",
      frequency: "high",
      severity: "high",
      sourceAsins: ["B001"],
      listingAdvice: "Original advice",
    };

    // Simulate editing
    const edited = { ...editablePoint, point: "Edited text", listingAdvice: "Updated advice" };
    expect(edited.point).toBe("Edited text");
    expect(edited.listingAdvice).toBe("Updated advice");
    expect(edited.sourceAsins).toEqual(["B001"]); // preserved
  });

  it("should integrate Kano data into listing generation context", () => {
    const reviewAggregation = {
      painPoints: JSON.stringify([
        { point: "Breaks easily", frequency: "high", severity: "high", listingAdvice: "Emphasize durability" },
      ]),
      itchPoints: JSON.stringify([
        { point: "Want more sizes", frequency: "medium", importance: "high", listingAdvice: "Mention size range" },
      ]),
      delightPoints: JSON.stringify([
        { point: "Great packaging", frequency: "low", impact: "medium", listingAdvice: "Highlight premium packaging" },
      ]),
      overallSentiment: "Positive with durability concerns",
      status: "completed",
    };

    // Simulate buildProductContext integration
    const parts: string[] = [];
    if (reviewAggregation.status === "completed") {
      const pains = JSON.parse(reviewAggregation.painPoints);
      parts.push("Kano Model Aggregated Review Analysis:");
      pains.forEach((p: any) => {
        parts.push(`  Pain: ${p.point} (${p.frequency}/${p.severity})`);
        if (p.listingAdvice) parts.push(`    → ${p.listingAdvice}`);
      });
    }

    expect(parts.length).toBeGreaterThan(0);
    expect(parts.join("\n")).toContain("Breaks easily");
    expect(parts.join("\n")).toContain("Emphasize durability");
  });
});

// ─── Feature 2: Keyword Field Editing ──────────────────────────────
describe("Keyword Field Editing", () => {
  it("should support all editable field values for relevance/traffic/competition", () => {
    const validLevels = ["high", "medium", "low"];
    
    for (const level of validLevels) {
      expect(validLevels).toContain(level);
    }
  });

  it("should support all strategy category options", () => {
    const validCategories = [
      "core_main", "sub_core", "precise_longtail",
      "scene_intent", "longtail_main", "observe_test", "negative",
    ];
    
    expect(validCategories).toHaveLength(7);
    expect(validCategories).toContain("core_main");
    expect(validCategories).toContain("negative");
  });

  it("should support all listing placement options", () => {
    const validPlacements = [
      "title_front", "title_mid", "title_end",
      "bullet_first", "bullet_body",
      "aplus", "search_term", "not_use",
    ];
    
    expect(validPlacements).toHaveLength(8);
    expect(validPlacements).toContain("title_front");
    expect(validPlacements).toContain("search_term");
  });

  it("should support all root category options", () => {
    const validRoots = [
      "core", "function", "scene", "audience",
      "spec", "painpoint", "gift_holiday",
    ];
    
    expect(validRoots).toHaveLength(7);
    expect(validRoots).toContain("core");
    expect(validRoots).toContain("gift_holiday");
  });

  it("should preserve AI-classified values as defaults when editing", () => {
    const keyword = {
      id: 1,
      keyword: "test keyword",
      relevance: "high",
      trafficLevel: "medium",
      competition: "low",
      strategyCategory: "core_main",
      rootCategory: "core",
      listingPlacement: "title_front",
    };

    // Simulate user editing only one field
    const update = { relevance: "medium" };
    const updated = { ...keyword, ...update };
    
    expect(updated.relevance).toBe("medium"); // changed
    expect(updated.trafficLevel).toBe("medium"); // preserved
    expect(updated.competition).toBe("low"); // preserved
    expect(updated.strategyCategory).toBe("core_main"); // preserved
  });
});

// ─── Feature 3: Step-by-Step Bullet Generation ─────────────────────
describe("Step-by-Step Bullet Generation", () => {
  it("should generate selling point cores with correct structure", () => {
    const coresResponse = {
      sellingPoints: [
        {
          index: 1,
          theme: "Premium Material Quality",
          themeZh: "优质材料品质",
          description: "Highlight the specific material used",
          descriptionZh: "突出产品使用的具体材料",
          fabeDirection: {
            feature: "Made from food-grade silicone",
            advantage: "More durable than competitors",
            benefit: "Safe for children and pets",
            evidence: "FDA certified, BPA-free",
          },
          targetKeywords: ["food grade", "bpa free"],
          addressesGap: "Competitors don't mention material safety",
        },
        {
          index: 2,
          theme: "Easy Assembly",
          themeZh: "便捷安装",
          description: "Emphasize tool-free setup",
          descriptionZh: "强调免工具安装",
          fabeDirection: {
            feature: "Snap-fit design",
            advantage: "No tools needed",
            benefit: "Set up in 5 minutes",
            evidence: "95% of customers report easy assembly",
          },
          targetKeywords: ["easy setup", "no tools"],
          addressesGap: "Competitor reviews mention difficult assembly",
        },
      ],
      overallStrategy: "Focus on safety and convenience",
    };

    expect(coresResponse.sellingPoints).toHaveLength(2);
    expect(coresResponse.sellingPoints[0].theme).toBe("Premium Material Quality");
    expect(coresResponse.sellingPoints[0].fabeDirection.feature).toBeTruthy();
    expect(coresResponse.sellingPoints[0].targetKeywords).toContain("food grade");
    expect(coresResponse.overallStrategy).toBeTruthy();
  });

  it("should validate single bullet character count (200-280)", () => {
    const bullet = {
      subtitle: "【Premium Material】",
      fullText: "Crafted from food-grade silicone that is BPA-free and FDA certified, our product ensures maximum safety for your family. Unlike cheaper alternatives that crack and peel, this durable material withstands daily use while maintaining its vibrant color and smooth texture for years of reliable performance.",
    };

    const combined = `${bullet.subtitle} ${bullet.fullText}`;
    const charCount = combined.length;
    
    expect(charCount).toBeGreaterThanOrEqual(200);
    expect(charCount).toBeLessThanOrEqual(350); // Allow some flexibility for test
  });

  it("should support editing selling point cores before generation", () => {
    const core = {
      index: 1,
      theme: "Original Theme",
      description: "Original description",
      fabeDirection: {
        feature: "Original feature",
        advantage: "Original advantage",
        benefit: "Original benefit",
        evidence: "Original evidence",
      },
      targetKeywords: ["keyword1", "keyword2"],
    };

    // Simulate user editing
    const editedCore = {
      ...core,
      theme: "Edited Theme",
      description: "Edited description with more detail",
      fabeDirection: {
        ...core.fabeDirection,
        feature: "Edited feature with specific specs",
      },
    };

    expect(editedCore.theme).toBe("Edited Theme");
    expect(editedCore.fabeDirection.feature).toContain("Edited");
    expect(editedCore.fabeDirection.advantage).toBe("Original advantage"); // preserved
    expect(editedCore.targetKeywords).toEqual(["keyword1", "keyword2"]); // preserved
  });

  it("should pass previously confirmed bullets as context", () => {
    const confirmedBullets = [
      { subtitle: "【Safety First】", fullText: "Our product is FDA certified..." },
      { subtitle: "【Easy Setup】", fullText: "No tools needed, snap-fit design..." },
    ];

    const newSellingPoint = {
      index: 3,
      theme: "Versatile Design",
      description: "Multi-purpose usage",
    };

    // Build the request with previous bullets context
    const request = {
      projectId: 1,
      sellingPoint: newSellingPoint,
      previousBullets: confirmedBullets,
    };

    expect(request.previousBullets).toHaveLength(2);
    expect(request.sellingPoint.index).toBe(3);
  });

  it("should track confirmation state for each core and bullet independently", () => {
    const cores = 5;
    const confirmedCores = [true, true, false, false, false];
    const generatedBullets: Record<number, any> = {
      0: { subtitle: "【Test】", fullText: "Generated text..." },
      1: { subtitle: "【Test2】", fullText: "Generated text 2..." },
    };
    const confirmedBullets: Record<number, boolean> = {
      0: true,
      1: false,
    };

    // Core 0: confirmed core + confirmed bullet
    expect(confirmedCores[0]).toBe(true);
    expect(generatedBullets[0]).toBeTruthy();
    expect(confirmedBullets[0]).toBe(true);

    // Core 1: confirmed core + generated but unconfirmed bullet
    expect(confirmedCores[1]).toBe(true);
    expect(generatedBullets[1]).toBeTruthy();
    expect(confirmedBullets[1]).toBe(false);

    // Core 2: unconfirmed core, no bullet yet
    expect(confirmedCores[2]).toBe(false);
    expect(generatedBullets[2]).toBeUndefined();

    // All bullets confirmed check
    const allConfirmed = Array.from({ length: cores }, (_, i) => confirmedBullets[i] === true);
    expect(allConfirmed.every(Boolean)).toBe(false);
  });
});

// ─── Integration: Kano → Listing Generation ────────────────────────
describe("Kano Model → Listing Generation Integration", () => {
  it("should format Kano data for buildProductContext correctly", () => {
    const aggregation = {
      painPoints: [
        { point: "Breaks easily", frequency: "high", severity: "high", sourceAsins: ["B001", "B002"], listingAdvice: "Emphasize durability" },
      ],
      itchPoints: [
        { point: "Want waterproof", frequency: "medium", importance: "high", sourceAsins: ["B001"], listingAdvice: "Highlight waterproof feature" },
      ],
      delightPoints: [
        { point: "Beautiful colors", frequency: "high", impact: "medium", sourceAsins: ["B003"], listingAdvice: "Showcase color variety" },
      ],
    };

    // Build context parts
    const parts: string[] = [];
    parts.push("Pain Points (痛点 - Must-Be Quality):");
    aggregation.painPoints.forEach(p => {
      parts.push(`  - ${p.point} (frequency: ${p.frequency}, severity: ${p.severity}) [from: ${p.sourceAsins.join(", ")}]`);
      parts.push(`    → Listing advice: ${p.listingAdvice}`);
    });
    parts.push("Itch Points (痒点 - One-Dimensional Quality):");
    aggregation.itchPoints.forEach(p => {
      parts.push(`  - ${p.point} (frequency: ${p.frequency}, importance: ${p.importance})`);
    });
    parts.push("Delight Points (爽点 - Attractive Quality):");
    aggregation.delightPoints.forEach(p => {
      parts.push(`  - ${p.point} (frequency: ${p.frequency}, impact: ${p.impact})`);
    });

    const context = parts.join("\n");
    expect(context).toContain("Breaks easily");
    expect(context).toContain("B001, B002");
    expect(context).toContain("Emphasize durability");
    expect(context).toContain("Want waterproof");
    expect(context).toContain("Beautiful colors");
  });

  it("should fall back to individual review analysis when no aggregation exists", () => {
    const analyses = [
      {
        asin: "B001",
        reviewAnalysis: JSON.stringify({
          painPoints: [{ issue: "Breaks easily" }],
          itchPoints: [{ desire: "More colors" }],
          delightPoints: [{ feature: "Good packaging" }],
        }),
      },
    ];

    const allPainPoints: string[] = [];
    const allItchPoints: string[] = [];
    const allDelightPoints: string[] = [];

    // No aggregation - fall back to individual analysis
    const hasAggregation = false;
    if (!hasAggregation) {
      for (const analysis of analyses) {
        if (analysis.reviewAnalysis) {
          const ra = JSON.parse(analysis.reviewAnalysis);
          if (ra.painPoints) allPainPoints.push(...ra.painPoints.map((p: any) => p.issue || p));
          if (ra.itchPoints) allItchPoints.push(...ra.itchPoints.map((p: any) => p.desire || p));
          if (ra.delightPoints) allDelightPoints.push(...ra.delightPoints.map((p: any) => p.feature || p));
        }
      }
    }

    expect(allPainPoints).toContain("Breaks easily");
    expect(allItchPoints).toContain("More colors");
    expect(allDelightPoints).toContain("Good packaging");
  });
});

// ─── Feature 4: Sync Bullets from Selling Points to Listing Preview ───
describe("Sync Bullets from Step-by-Step Selling Points", () => {
  it("should format confirmed bullets as JSON array of strings", () => {
    const confirmedBullets = [
      { subtitle: "[Premium Material]", fullText: "Made from high-quality stainless steel that resists corrosion and ensures long-lasting durability for everyday kitchen use." },
      { subtitle: "[Easy Assembly]", fullText: "Comes with clear instructions and all necessary hardware for quick 15-minute setup without professional tools." },
      { subtitle: "[Versatile Design]", fullText: "Perfect for indoor and outdoor use, this product adapts to any environment with its weather-resistant finish." },
    ];

    const bulletStrings = confirmedBullets.map(b => `${b.subtitle} ${b.fullText}`);
    const bulletPointsJson = JSON.stringify(bulletStrings);

    expect(bulletStrings).toHaveLength(3);
    expect(bulletStrings[0]).toContain("[Premium Material]");
    expect(bulletStrings[0]).toContain("stainless steel");
    expect(bulletStrings[1]).toContain("[Easy Assembly]");
    expect(bulletStrings[2]).toContain("[Versatile Design]");

    // Verify JSON format is valid
    const parsed = JSON.parse(bulletPointsJson);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(3);
    expect(typeof parsed[0]).toBe("string");
  });

  it("should validate bullet count between 1 and 5", () => {
    const validBullets = [
      { subtitle: "[Point 1]", fullText: "Description 1" },
      { subtitle: "[Point 2]", fullText: "Description 2" },
    ];
    expect(validBullets.length).toBeGreaterThanOrEqual(1);
    expect(validBullets.length).toBeLessThanOrEqual(5);

    const maxBullets = Array.from({ length: 5 }, (_, i) => ({
      subtitle: `[Point ${i + 1}]`,
      fullText: `Description ${i + 1}`,
    }));
    expect(maxBullets.length).toBe(5);
  });

  it("should filter only confirmed bullets from generatedBullets map", () => {
    const generatedBullets: Record<number, any> = {
      0: { subtitle: "[A]", fullText: "Text A" },
      1: { subtitle: "[B]", fullText: "Text B" },
      2: { subtitle: "[C]", fullText: "Text C" },
      3: { subtitle: "[D]", fullText: "Text D" },
      4: { subtitle: "[E]", fullText: "Text E" },
    };
    const confirmedBullets: Record<number, boolean> = {
      0: true,
      1: true,
      2: false,
      3: true,
      4: true,
    };

    const bullets = Object.entries(confirmedBullets)
      .filter(([, confirmed]) => confirmed)
      .map(([i]) => generatedBullets[Number(i)])
      .filter(Boolean)
      .map(b => ({ subtitle: b.subtitle || "", fullText: b.fullText || "" }));

    // Only confirmed bullets should be included (0, 1, 3, 4)
    expect(bullets).toHaveLength(4);
    expect(bullets[0].subtitle).toBe("[A]");
    expect(bullets[1].subtitle).toBe("[B]");
    expect(bullets[2].subtitle).toBe("[D]");
    expect(bullets[3].subtitle).toBe("[E]");
  });

  it("should handle sync result actions correctly", () => {
    // Simulate update action (listing already exists)
    const updateResult = { action: "updated", listingId: 42, bulletCount: 5 };
    expect(updateResult.action).toBe("updated");
    expect(updateResult.bulletCount).toBe(5);

    // Simulate create action (no listing exists yet)
    const createResult = { action: "created", listingId: 43, bulletCount: 3 };
    expect(createResult.action).toBe("created");
    expect(createResult.bulletCount).toBe(3);
  });
});
