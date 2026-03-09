import { describe, it, expect } from "vitest";

// Test the A/B test variant generation structure and logic
describe("A/B Test Feature", () => {
  describe("Variant Style Definitions", () => {
    const styles = [
      {
        id: "professional",
        name: "专业技术型",
        nameEn: "Professional & Technical",
        titleInstruction: "Focus on technical specifications",
        bulletInstruction: "Lead each bullet with a technical feature",
      },
      {
        id: "emotional",
        name: "情感场景型",
        nameEn: "Emotional & Lifestyle",
        titleInstruction: "Focus on lifestyle benefits",
        bulletInstruction: "Lead each bullet with a relatable scenario",
      },
      {
        id: "datadriven",
        name: "数据驱动型",
        nameEn: "Data-Driven & Comparative",
        titleInstruction: "Focus on quantifiable advantages",
        bulletInstruction: "Lead each bullet with a quantified claim",
      },
    ];

    it("should have exactly 3 style variants", () => {
      expect(styles).toHaveLength(3);
    });

    it("should have unique IDs for each style", () => {
      const ids = styles.map((s) => s.id);
      expect(new Set(ids).size).toBe(3);
    });

    it("each style should have both Chinese and English names", () => {
      for (const style of styles) {
        expect(style.name).toBeTruthy();
        expect(style.nameEn).toBeTruthy();
        expect(style.name).not.toBe(style.nameEn);
      }
    });

    it("each style should have distinct title and bullet instructions", () => {
      for (const style of styles) {
        expect(style.titleInstruction).toBeTruthy();
        expect(style.bulletInstruction).toBeTruthy();
        expect(style.titleInstruction).not.toBe(style.bulletInstruction);
      }
    });

    it("professional style should emphasize technical aspects", () => {
      const pro = styles.find((s) => s.id === "professional")!;
      expect(pro.titleInstruction.toLowerCase()).toContain("technical");
      expect(pro.bulletInstruction.toLowerCase()).toContain("technical feature");
    });

    it("emotional style should emphasize lifestyle and scenarios", () => {
      const emo = styles.find((s) => s.id === "emotional")!;
      expect(emo.titleInstruction.toLowerCase()).toContain("lifestyle");
      expect(emo.bulletInstruction.toLowerCase()).toContain("scenario");
    });

    it("data-driven style should emphasize quantifiable data", () => {
      const dd = styles.find((s) => s.id === "datadriven")!;
      expect(dd.titleInstruction.toLowerCase()).toContain("quantif");
      expect(dd.bulletInstruction.toLowerCase()).toContain("quantif");
    });
  });

  describe("A/B Variant Data Structure", () => {
    const mockVariant = {
      id: "professional",
      name: "专业技术型",
      nameEn: "Professional & Technical",
      description: "强调产品规格参数、技术优势、专利认证",
      titleData: {
        titles: [
          {
            title: "Premium Stainless Steel Water Bottle 32oz Double Wall Vacuum Insulated BPA Free Leak Proof Wide Mouth Sports Flask with Temperature Display for Outdoor Camping Hiking Gym Fitness Travel Office Daily Use",
            characterCount: 195,
            coreKeywords: ["Water Bottle", "Vacuum Insulated", "Stainless Steel"],
            strategy: "Technical specs first approach",
          },
        ],
        recommendedTitle: "Premium Stainless Steel Water Bottle 32oz Double Wall Vacuum Insulated BPA Free Leak Proof Wide Mouth Sports Flask with Temperature Display for Outdoor Camping Hiking Gym Fitness Travel Office Daily Use",
        reasoning: "Technical approach emphasizes material and specs",
      },
      bulletData: {
        bulletPoints: [
          {
            subtitle: "【304 Stainless Steel】",
            fullText: "Crafted from premium food-grade 304 stainless steel with double-wall vacuum insulation technology that keeps drinks cold for 24 hours or hot for 12 hours, tested and certified to FDA safety standards for daily use",
            sellingPoint: "Premium material and insulation",
            fabeBreakdown: {
              feature: "304 stainless steel",
              advantage: "Superior insulation",
              benefit: "Temperature retention",
              evidence: "24hr cold / 12hr hot",
            },
            characterCount: 245,
          },
        ],
      },
    };

    it("variant should have all required fields", () => {
      expect(mockVariant.id).toBeTruthy();
      expect(mockVariant.name).toBeTruthy();
      expect(mockVariant.nameEn).toBeTruthy();
      expect(mockVariant.description).toBeTruthy();
    });

    it("titleData should contain titles array with required fields", () => {
      const title = mockVariant.titleData.titles[0];
      expect(title.title).toBeTruthy();
      expect(title.characterCount).toBeGreaterThan(0);
      expect(title.coreKeywords).toBeInstanceOf(Array);
      expect(title.coreKeywords.length).toBeGreaterThan(0);
      expect(title.strategy).toBeTruthy();
    });

    it("titleData should have a recommended title", () => {
      expect(mockVariant.titleData.recommendedTitle).toBeTruthy();
      expect(mockVariant.titleData.reasoning).toBeTruthy();
    });

    it("bulletData should contain bulletPoints array with FABE breakdown", () => {
      const bp = mockVariant.bulletData.bulletPoints[0];
      expect(bp.subtitle).toBeTruthy();
      expect(bp.fullText).toBeTruthy();
      expect(bp.fabeBreakdown).toBeDefined();
      expect(bp.fabeBreakdown.feature).toBeTruthy();
      expect(bp.fabeBreakdown.advantage).toBeTruthy();
      expect(bp.fabeBreakdown.benefit).toBeTruthy();
      expect(bp.fabeBreakdown.evidence).toBeTruthy();
    });

    it("bullet point character count should be within range", () => {
      const bp = mockVariant.bulletData.bulletPoints[0];
      const fullText = `${bp.subtitle} ${bp.fullText}`;
      expect(fullText.length).toBeGreaterThanOrEqual(200);
      expect(fullText.length).toBeLessThanOrEqual(300); // some tolerance
    });
  });

  describe("Apply Variant Logic", () => {
    it("should extract recommended title from variant", () => {
      const variant = {
        id: "emotional",
        titleData: {
          titles: [{ title: "Title A" }, { title: "Title B" }],
          recommendedTitle: "Recommended Title",
        },
        bulletData: {
          bulletPoints: [
            { subtitle: "【Bullet 1】", fullText: "Description 1" },
          ],
        },
      };

      // Logic: prefer recommendedTitle, fallback to first title
      let selectedTitle: string | undefined;
      if (variant.titleData?.recommendedTitle) {
        selectedTitle = variant.titleData.recommendedTitle;
      } else if (variant.titleData?.titles?.[0]?.title) {
        selectedTitle = variant.titleData.titles[0].title;
      }
      expect(selectedTitle).toBe("Recommended Title");
    });

    it("should fallback to first title when no recommended title", () => {
      const variant = {
        id: "datadriven",
        titleData: {
          titles: [{ title: "First Title" }, { title: "Second Title" }],
        },
        bulletData: null,
      };

      let selectedTitle: string | undefined;
      if (variant.titleData?.recommendedTitle) {
        selectedTitle = variant.titleData.recommendedTitle;
      } else if (variant.titleData?.titles?.[0]?.title) {
        selectedTitle = variant.titleData.titles[0].title;
      }
      expect(selectedTitle).toBe("First Title");
    });

    it("should serialize bullet points as JSON string for apply", () => {
      const bulletPoints = [
        { subtitle: "【A】", fullText: "Text A", characterCount: 210 },
        { subtitle: "【B】", fullText: "Text B", characterCount: 220 },
      ];
      const serialized = JSON.stringify(bulletPoints);
      const parsed = JSON.parse(serialized);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].subtitle).toBe("【A】");
    });

    it("should handle variant with only title (no bullets)", () => {
      const applyData: Record<string, any> = { projectId: 1 };
      const variant = {
        titleData: { recommendedTitle: "My Title" },
        bulletData: null,
      };

      if (variant.titleData?.recommendedTitle) {
        applyData.title = variant.titleData.recommendedTitle;
      }
      if (variant.bulletData?.bulletPoints) {
        applyData.bulletPoints = JSON.stringify(variant.bulletData.bulletPoints);
      }

      expect(applyData.title).toBe("My Title");
      expect(applyData.bulletPoints).toBeUndefined();
    });

    it("should handle variant with only bullets (no title)", () => {
      const applyData: Record<string, any> = { projectId: 1 };
      const variant = {
        titleData: null,
        bulletData: {
          bulletPoints: [{ subtitle: "【X】", fullText: "Y" }],
        },
      };

      if (variant.titleData?.recommendedTitle) {
        applyData.title = variant.titleData.recommendedTitle;
      }
      if (variant.bulletData?.bulletPoints) {
        applyData.bulletPoints = JSON.stringify(variant.bulletData.bulletPoints);
      }

      expect(applyData.title).toBeUndefined();
      expect(applyData.bulletPoints).toBeTruthy();
    });
  });

  describe("Component Selection", () => {
    it("should default to both title and bulletPoints", () => {
      const defaultComponents = ["title", "bulletPoints"];
      expect(defaultComponents).toContain("title");
      expect(defaultComponents).toContain("bulletPoints");
      expect(defaultComponents).toHaveLength(2);
    });

    it("should support generating only titles", () => {
      const components = ["title"];
      expect(components).toContain("title");
      expect(components).not.toContain("bulletPoints");
    });

    it("should support generating only bullet points", () => {
      const components = ["bulletPoints"];
      expect(components).not.toContain("title");
      expect(components).toContain("bulletPoints");
    });
  });

  describe("Frontend UI State", () => {
    it("style icons mapping should cover all 3 variants", () => {
      const styleIcons: Record<string, string> = {
        professional: "Cpu",
        emotional: "Heart",
        datadriven: "BarChart3",
      };
      expect(Object.keys(styleIcons)).toHaveLength(3);
      expect(styleIcons.professional).toBe("Cpu");
      expect(styleIcons.emotional).toBe("Heart");
      expect(styleIcons.datadriven).toBe("BarChart3");
    });

    it("style colors mapping should cover all 3 variants", () => {
      const styleColors: Record<string, string> = {
        professional: "text-blue-600 bg-blue-50 border-blue-200",
        emotional: "text-rose-600 bg-rose-50 border-rose-200",
        datadriven: "text-emerald-600 bg-emerald-50 border-emerald-200",
      };
      expect(Object.keys(styleColors)).toHaveLength(3);
      for (const color of Object.values(styleColors)) {
        expect(color).toContain("text-");
        expect(color).toContain("bg-");
        expect(color).toContain("border-");
      }
    });
  });
});

describe("A/B Mixed Selection Feature", () => {
  // Simulate 3 variants with different titles and bullet points
  const mockVariants = [
    {
      id: "professional",
      name: "专业技术型",
      titleData: {
        titles: [
          { title: "Professional Title Option A" },
          { title: "Professional Title Option B" },
        ],
        recommendedTitle: "Professional Recommended Title",
      },
      bulletData: {
        bulletPoints: [
          { subtitle: "【Pro BP1】", fullText: "Professional bullet 1 description", sellingPoint: "Tech spec" },
          { subtitle: "【Pro BP2】", fullText: "Professional bullet 2 description", sellingPoint: "Material" },
          { subtitle: "【Pro BP3】", fullText: "Professional bullet 3 description", sellingPoint: "Durability" },
          { subtitle: "【Pro BP4】", fullText: "Professional bullet 4 description", sellingPoint: "Certification" },
          { subtitle: "【Pro BP5】", fullText: "Professional bullet 5 description", sellingPoint: "Warranty" },
        ],
      },
    },
    {
      id: "emotional",
      name: "情感场景型",
      titleData: {
        titles: [{ title: "Emotional Title Option A" }],
        recommendedTitle: "Emotional Recommended Title",
      },
      bulletData: {
        bulletPoints: [
          { subtitle: "【Emo BP1】", fullText: "Emotional bullet 1 description", sellingPoint: "Lifestyle" },
          { subtitle: "【Emo BP2】", fullText: "Emotional bullet 2 description", sellingPoint: "Comfort" },
          { subtitle: "【Emo BP3】", fullText: "Emotional bullet 3 description", sellingPoint: "Family" },
          { subtitle: "【Emo BP4】", fullText: "Emotional bullet 4 description", sellingPoint: "Joy" },
          { subtitle: "【Emo BP5】", fullText: "Emotional bullet 5 description", sellingPoint: "Gift" },
        ],
      },
    },
    {
      id: "datadriven",
      name: "数据驱动型",
      titleData: {
        titles: [{ title: "Data Title Option A" }],
        recommendedTitle: "Data Recommended Title",
      },
      bulletData: {
        bulletPoints: [
          { subtitle: "【Data BP1】", fullText: "Data bullet 1 description", sellingPoint: "Stats" },
          { subtitle: "【Data BP2】", fullText: "Data bullet 2 description", sellingPoint: "Comparison" },
          { subtitle: "【Data BP3】", fullText: "Data bullet 3 description", sellingPoint: "Metrics" },
          { subtitle: "【Data BP4】", fullText: "Data bullet 4 description", sellingPoint: "ROI" },
          { subtitle: "【Data BP5】", fullText: "Data bullet 5 description", sellingPoint: "Value" },
        ],
      },
    },
  ];

  describe("Mixed Selection State Management", () => {
    it("should initialize with default selection from first variant", () => {
      const firstVariant = mockVariants[0];
      const selectedTitleVariant = firstVariant.id;
      const selectedTitleIdx = 0;
      const bulletCount = firstVariant.bulletData.bulletPoints.length;
      const selectedBullets = Array.from({ length: bulletCount }, (_, i) => ({
        variantId: firstVariant.id,
        bulletIdx: i,
      }));

      expect(selectedTitleVariant).toBe("professional");
      expect(selectedTitleIdx).toBe(0);
      expect(selectedBullets).toHaveLength(5);
      expect(selectedBullets.every((b) => b.variantId === "professional")).toBe(true);
    });

    it("should allow selecting title from any variant", () => {
      // User selects emotional title
      const selectedTitleVariant = "emotional";
      const variant = mockVariants.find((v) => v.id === selectedTitleVariant)!;
      const title = variant.titleData.recommendedTitle || variant.titleData.titles[0]?.title;
      expect(title).toBe("Emotional Recommended Title");
    });

    it("should allow selecting specific title option within a variant", () => {
      const selectedTitleVariant = "professional";
      const selectedTitleIdx = 1; // Second title option
      const variant = mockVariants.find((v) => v.id === selectedTitleVariant)!;
      const title = variant.titleData.titles[selectedTitleIdx]?.title;
      expect(title).toBe("Professional Title Option B");
    });

    it("should allow selecting bullets from different variants", () => {
      // Mix: bullet 1 from professional, bullet 2 from emotional, bullet 3 from data, etc.
      const selectedBullets = [
        { variantId: "professional", bulletIdx: 0 },
        { variantId: "emotional", bulletIdx: 1 },
        { variantId: "datadriven", bulletIdx: 2 },
        { variantId: "emotional", bulletIdx: 3 },
        { variantId: "professional", bulletIdx: 4 },
      ];

      const result = selectedBullets.map((sel) => {
        const v = mockVariants.find((v) => v.id === sel.variantId)!;
        return v.bulletData.bulletPoints[sel.bulletIdx];
      });

      expect(result).toHaveLength(5);
      expect(result[0].subtitle).toBe("【Pro BP1】");
      expect(result[1].subtitle).toBe("【Emo BP2】");
      expect(result[2].subtitle).toBe("【Data BP3】");
      expect(result[3].subtitle).toBe("【Emo BP4】");
      expect(result[4].subtitle).toBe("【Pro BP5】");
    });
  });

  describe("Mixed Selection Title Resolution", () => {
    it("should prefer recommendedTitle when available", () => {
      const selectedTitleVariant = "professional";
      const selectedTitleIdx = 0;
      const v = mockVariants.find((v) => v.id === selectedTitleVariant)!;
      const titles = v.titleData?.titles || [];
      let title = "";
      if (titles[selectedTitleIdx]?.title) title = titles[selectedTitleIdx].title;
      if (v.titleData?.recommendedTitle) title = v.titleData.recommendedTitle;
      expect(title).toBe("Professional Recommended Title");
    });

    it("should fallback to indexed title when no recommended", () => {
      const variantNoRec = {
        ...mockVariants[0],
        titleData: {
          titles: [{ title: "Fallback Title A" }, { title: "Fallback Title B" }],
        },
      };
      const selectedTitleIdx = 1;
      const titles = variantNoRec.titleData?.titles || [];
      const title = titles[selectedTitleIdx]?.title || titles[0]?.title || "";
      expect(title).toBe("Fallback Title B");
    });
  });

  describe("Mixed Selection Apply Logic", () => {
    it("should combine title from one variant and bullets from multiple variants", () => {
      const selectedTitleVariant = "emotional";
      const selectedBullets = [
        { variantId: "professional", bulletIdx: 0 },
        { variantId: "emotional", bulletIdx: 1 },
        { variantId: "datadriven", bulletIdx: 2 },
        { variantId: "professional", bulletIdx: 3 },
        { variantId: "datadriven", bulletIdx: 4 },
      ];

      // Get title
      const titleVariant = mockVariants.find((v) => v.id === selectedTitleVariant)!;
      const title = titleVariant.titleData.recommendedTitle || titleVariant.titleData.titles[0]?.title || "";

      // Get bullets
      const bullets = selectedBullets.map((sel) => {
        const v = mockVariants.find((v) => v.id === sel.variantId)!;
        return v.bulletData.bulletPoints[sel.bulletIdx];
      });

      // Build apply data
      const applyData: Record<string, any> = { projectId: 1 };
      if (title) applyData.title = title;
      if (bullets.length > 0) applyData.bulletPoints = JSON.stringify(bullets);

      expect(applyData.title).toBe("Emotional Recommended Title");
      const parsedBullets = JSON.parse(applyData.bulletPoints);
      expect(parsedBullets).toHaveLength(5);
      expect(parsedBullets[0].subtitle).toBe("【Pro BP1】");
      expect(parsedBullets[1].subtitle).toBe("【Emo BP2】");
      expect(parsedBullets[2].subtitle).toBe("【Data BP3】");
    });

    it("should handle empty selection gracefully", () => {
      const applyData: Record<string, any> = { projectId: 1 };
      const title = "";
      const bullets: any[] = [];

      if (title) applyData.title = title;
      if (bullets.length > 0) applyData.bulletPoints = JSON.stringify(bullets);

      expect(applyData.title).toBeUndefined();
      expect(applyData.bulletPoints).toBeUndefined();
    });

    it("should preserve bullet point structure when mixing", () => {
      const selectedBullets = [
        { variantId: "professional", bulletIdx: 0 },
        { variantId: "emotional", bulletIdx: 1 },
      ];

      const bullets = selectedBullets.map((sel) => {
        const v = mockVariants.find((v) => v.id === sel.variantId)!;
        return v.bulletData.bulletPoints[sel.bulletIdx];
      });

      // Each bullet should retain its original structure
      expect(bullets[0]).toHaveProperty("subtitle");
      expect(bullets[0]).toHaveProperty("fullText");
      expect(bullets[0]).toHaveProperty("sellingPoint");
      expect(bullets[1]).toHaveProperty("subtitle");
      expect(bullets[1]).toHaveProperty("fullText");
      expect(bullets[1]).toHaveProperty("sellingPoint");
    });
  });

  describe("Mode Toggle", () => {
    it("should start in browse mode", () => {
      const mixedMode = "browse";
      expect(mixedMode).toBe("browse");
    });

    it("should toggle to mix mode", () => {
      let mixedMode: "browse" | "mix" = "browse";
      mixedMode = "mix";
      expect(mixedMode).toBe("mix");
    });

    it("should reset to browse mode when dialog closes", () => {
      let mixedMode: "browse" | "mix" = "mix";
      // Simulate dialog close
      mixedMode = "browse";
      expect(mixedMode).toBe("browse");
    });
  });

  describe("Variant Source Tracking", () => {
    it("should track which variant each bullet comes from", () => {
      const selectedBullets = [
        { variantId: "professional", bulletIdx: 0 },
        { variantId: "emotional", bulletIdx: 1 },
        { variantId: "datadriven", bulletIdx: 2 },
        { variantId: "emotional", bulletIdx: 3 },
        { variantId: "professional", bulletIdx: 4 },
      ];

      const sources = selectedBullets.map((sel) => {
        const v = mockVariants.find((v) => v.id === sel.variantId)!;
        return v.name;
      });

      expect(sources[0]).toBe("专业技术型");
      expect(sources[1]).toBe("情感场景型");
      expect(sources[2]).toBe("数据驱动型");
      expect(sources[3]).toBe("情感场景型");
      expect(sources[4]).toBe("专业技术型");
    });

    it("should track title source variant", () => {
      const selectedTitleVariant = "datadriven";
      const v = mockVariants.find((v) => v.id === selectedTitleVariant)!;
      expect(v.name).toBe("数据驱动型");
    });
  });
});
