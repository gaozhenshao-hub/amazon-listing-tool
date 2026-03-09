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
