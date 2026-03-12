import { describe, expect, it } from "vitest";
import {
  IMAGE_ADVICE_PROMPT,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
} from "./prompts";

describe("Image Suggestion Split Feature", () => {
  // ─── AI Prompt Structure Tests ────────────────────────────────

  describe("IMAGE_ADVICE_PROMPT - Enhanced Structure", () => {
    it("includes the 10-year design expert role", () => {
      expect(IMAGE_ADVICE_PROMPT).toContain("拥有10年设计经验且优秀的亚马逊运营");
    });

    it("includes all 5 core requirements", () => {
      expect(IMAGE_ADVICE_PROMPT).toContain("标题简短，有吸引力");
      expect(IMAGE_ADVICE_PROMPT).toContain("卖点表达清晰");
      expect(IMAGE_ADVICE_PROMPT).toContain("配色方案");
      expect(IMAGE_ADVICE_PROMPT).toContain("构图方式");
      expect(IMAGE_ADVICE_PROMPT).toContain("数据可视化");
    });

    it("includes FABE analysis requirement", () => {
      expect(IMAGE_ADVICE_PROMPT).toContain("FABE");
      expect(IMAGE_ADVICE_PROMPT).toContain("Feature特征");
      expect(IMAGE_ADVICE_PROMPT).toContain("Advantage优势");
      expect(IMAGE_ADVICE_PROMPT).toContain("Benefit利益");
      expect(IMAGE_ADVICE_PROMPT).toContain("Evidence证据");
    });

    it("includes designGuidelines in JSON structure", () => {
      expect(IMAGE_ADVICE_PROMPT).toContain('"designGuidelines"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"fontRecommendation"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"overallColorPalette"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"brandTone"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"mobileOptimization"');
    });

    it("includes mainImage with shootingNotes in JSON structure", () => {
      expect(IMAGE_ADVICE_PROMPT).toContain('"mainImage"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"concept"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"shootingNotes"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"composition"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"colorScheme"');
    });

    it("includes secondaryImages with FABE structure", () => {
      expect(IMAGE_ADVICE_PROMPT).toContain('"secondaryImages"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"fabe"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"feature"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"advantage"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"benefit"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"evidence"');
    });

    it("includes secondaryImages with enhanced fields", () => {
      expect(IMAGE_ADVICE_PROMPT).toContain('"expressionMethod"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"dataVisualization"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"icons"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"keyElements"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"textOverlay"');
    });

    it("includes A+ content with story, consistency, modular design", () => {
      expect(IMAGE_ADVICE_PROMPT).toContain('"aPlusContent"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"overallStory"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"consistency"');
      expect(IMAGE_ADVICE_PROMPT).toContain('"modularDesign"');
    });

    it("includes A+ sections with FABE and enhanced fields", () => {
      // A+ sections should have fabe, expressionMethod, colorScheme, composition, dataVisualization, icons
      const aPlusSection = IMAGE_ADVICE_PROMPT.substring(
        IMAGE_ADVICE_PROMPT.indexOf('"aPlusContent"')
      );
      expect(aPlusSection).toContain('"fabe"');
      expect(aPlusSection).toContain('"expressionMethod"');
      expect(aPlusSection).toContain('"colorScheme"');
      expect(aPlusSection).toContain('"composition"');
      expect(aPlusSection).toContain('"dataVisualization"');
      expect(aPlusSection).toContain('"icons"');
    });

    it("designGuidelines includes font color details", () => {
      expect(IMAGE_ADVICE_PROMPT).toContain("主字体");
      expect(IMAGE_ADVICE_PROMPT).toContain("副字体");
      expect(IMAGE_ADVICE_PROMPT).toContain("强调色");
      expect(IMAGE_ADVICE_PROMPT).toContain("图标色");
    });
  });

  describe("IMAGE_ADVICE_TRANSLATION_PROMPT - Enhanced Structure", () => {
    it("includes all key fields to translate", () => {
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("designGuidelines");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("mainImage");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("secondaryImages");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("aPlusContent");
    });

    it("includes new fields in translation scope", () => {
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("shootingNotes");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("fabe");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("overallStory");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("consistency");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("modularDesign");
    });

    it("includes A+ section enhanced fields in translation scope", () => {
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("sections[].fabe");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("sections[].expressionMethod");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("sections[].colorScheme");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("sections[].composition");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("sections[].dataVisualization");
      expect(IMAGE_ADVICE_TRANSLATION_PROMPT).toContain("sections[].icons");
    });
  });

  // ─── JSON Structure Validation Tests ──────────────────────────

  describe("Image Advice JSON Structure Validation", () => {
    const sampleImageAdvice = {
      designGuidelines: {
        fontRecommendation: "Montserrat for headings, Open Sans for body",
        overallColorPalette: "Primary #2563EB, Accent #F59E0B, Text #1F2937, Secondary text #6B7280",
        brandTone: "Professional yet approachable",
        mobileOptimization: "Min 24px font size, 44px touch targets",
      },
      mainImage: {
        concept: "Clean product showcase",
        title: "Premium Quality",
        keyElements: ["product", "logo"],
        composition: "Center composition with product filling 85%",
        colorScheme: { primary: "#FFFFFF", secondary: "#F3F4F6", accent: "#2563EB" },
        shootingNotes: "45-degree angle, soft diffused lighting, no shadows",
        tips: ["Use high-res camera"],
      },
      secondaryImages: [
        {
          imageNumber: 2,
          title: "Built to Last",
          focus: "Durability",
          fabe: {
            feature: "304 stainless steel construction",
            advantage: "3x more durable than plastic alternatives",
            benefit: "Lasts for years without replacement",
            evidence: "Tested to 10,000 uses",
          },
          expressionMethod: "对比展示",
          composition: "Split screen: left product, right comparison",
          colorScheme: { primary: "#1E3A5F", secondary: "#E5E7EB", accent: "#10B981" },
          textOverlay: "BUILT TO LAST - 10,000+ Uses Tested",
          dataVisualization: "Bar chart comparing durability metrics",
          icons: ["shield", "checkmark", "timer"],
          keyElements: ["product close-up", "comparison chart"],
          tips: ["Show wear test results"],
        },
      ],
      aPlusContent: {
        overallStrategy: "Story-driven approach",
        overallStory: "From problem to solution narrative",
        consistency: "Blue/white palette throughout",
        modularDesign: "Each module self-contained",
        sections: [
          {
            type: "Hero Banner",
            title: "The Ultimate Solution",
            purpose: "Grab attention",
            content: "Full-width hero with product lifestyle shot",
            fabe: {
              feature: "All-in-one design",
              advantage: "Replaces 3 separate tools",
              benefit: "Save time and space",
              evidence: "Used by 50,000+ customers",
            },
            expressionMethod: "场景展示",
            colorScheme: { primary: "#2563EB", secondary: "#FFFFFF", accent: "#F59E0B" },
            composition: "Full-width with text overlay on left",
            dataVisualization: "Customer satisfaction pie chart",
            icons: ["star", "users", "clock"],
            tips: ["Use lifestyle photography"],
          },
        ],
      },
    };

    it("validates complete image advice structure has all required fields", () => {
      // designGuidelines
      expect(sampleImageAdvice.designGuidelines).toHaveProperty("fontRecommendation");
      expect(sampleImageAdvice.designGuidelines).toHaveProperty("overallColorPalette");
      expect(sampleImageAdvice.designGuidelines).toHaveProperty("brandTone");
      expect(sampleImageAdvice.designGuidelines).toHaveProperty("mobileOptimization");

      // mainImage
      expect(sampleImageAdvice.mainImage).toHaveProperty("concept");
      expect(sampleImageAdvice.mainImage).toHaveProperty("shootingNotes");
      expect(sampleImageAdvice.mainImage).toHaveProperty("colorScheme");
      expect(sampleImageAdvice.mainImage).toHaveProperty("composition");

      // secondaryImages
      const img = sampleImageAdvice.secondaryImages[0];
      expect(img).toHaveProperty("fabe");
      expect(img.fabe).toHaveProperty("feature");
      expect(img.fabe).toHaveProperty("advantage");
      expect(img.fabe).toHaveProperty("benefit");
      expect(img.fabe).toHaveProperty("evidence");
      expect(img).toHaveProperty("expressionMethod");
      expect(img).toHaveProperty("dataVisualization");
      expect(img).toHaveProperty("icons");
      expect(img).toHaveProperty("keyElements");

      // aPlusContent
      expect(sampleImageAdvice.aPlusContent).toHaveProperty("overallStory");
      expect(sampleImageAdvice.aPlusContent).toHaveProperty("consistency");
      expect(sampleImageAdvice.aPlusContent).toHaveProperty("modularDesign");
      const section = sampleImageAdvice.aPlusContent.sections[0];
      expect(section).toHaveProperty("fabe");
      expect(section).toHaveProperty("expressionMethod");
      expect(section).toHaveProperty("colorScheme");
      expect(section).toHaveProperty("composition");
      expect(section).toHaveProperty("dataVisualization");
      expect(section).toHaveProperty("icons");
    });

    it("can serialize and deserialize image advice JSON", () => {
      const jsonStr = JSON.stringify(sampleImageAdvice);
      const parsed = JSON.parse(jsonStr);
      expect(parsed.designGuidelines.fontRecommendation).toBe("Montserrat for headings, Open Sans for body");
      expect(parsed.mainImage.shootingNotes).toBe("45-degree angle, soft diffused lighting, no shadows");
      expect(parsed.secondaryImages[0].fabe.feature).toBe("304 stainless steel construction");
      expect(parsed.aPlusContent.overallStory).toBe("From problem to solution narrative");
      expect(parsed.aPlusContent.sections[0].fabe.benefit).toBe("Save time and space");
    });
  });
});
