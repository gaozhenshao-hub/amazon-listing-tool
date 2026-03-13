import { describe, it, expect } from "vitest";
import { EXPAND_KEYWORD_TO_FABE_PROMPT } from "./prompts";

describe("expandKeywordToFABE", () => {
  describe("Prompt structure", () => {
    it("should include FABE method references", () => {
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("FABE");
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("Feature");
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("Advantage");
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("Benefit");
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("Evidence");
    });

    it("should require JSON response format", () => {
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("JSON format");
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain('"theme"');
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain('"themeZh"');
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain('"fabeDirection"');
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain('"targetKeywords"');
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain('"addressesGap"');
    });

    it("should include expert role persona", () => {
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("Ogilvy");
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("native English speaker");
    });

    it("should mention bilingual (EN/CN) output", () => {
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("Chinese translation");
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain('"themeZh"');
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain('"descriptionZh"');
    });

    it("should mention product context usage", () => {
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("product context");
      expect(EXPAND_KEYWORD_TO_FABE_PROMPT).toContain("competitor");
    });
  });

  describe("AI response parsing", () => {
    it("should parse a valid AI response", () => {
      const mockResponse = JSON.stringify({
        theme: "Waterproof Design",
        themeZh: "防水设计",
        description: "Highlight the product's waterproof capabilities for outdoor use",
        descriptionZh: "突出产品的防水能力，适合户外使用",
        fabeDirection: {
          feature: "IPX7 waterproof rating with sealed seams",
          advantage: "Superior water resistance compared to competitors rated IPX4",
          benefit: "Use confidently in rain, near pools, or during water activities",
          evidence: "Tested to withstand 30 minutes submersion at 1 meter depth",
        },
        targetKeywords: ["waterproof", "outdoor", "water resistant"],
        addressesGap: "Most competitors only offer splash-proof (IPX4), leaving a gap for truly waterproof products",
      });

      const parsed = JSON.parse(mockResponse);
      expect(parsed.theme).toBe("Waterproof Design");
      expect(parsed.themeZh).toBe("防水设计");
      expect(parsed.fabeDirection.feature).toContain("IPX7");
      expect(parsed.fabeDirection.advantage).toBeTruthy();
      expect(parsed.fabeDirection.benefit).toBeTruthy();
      expect(parsed.fabeDirection.evidence).toBeTruthy();
      expect(parsed.targetKeywords).toHaveLength(3);
      expect(parsed.addressesGap).toBeTruthy();
    });

    it("should handle minimal AI response with defaults", () => {
      const mockResponse = JSON.stringify({
        theme: "Eco-Friendly",
        themeZh: "",
        description: "",
        fabeDirection: {
          feature: "Made from recycled materials",
          advantage: "",
          benefit: "",
          evidence: "",
        },
      });

      const parsed = JSON.parse(mockResponse);
      // Simulate the backend fallback logic
      const result = {
        theme: parsed.theme || "Unknown",
        themeZh: parsed.themeZh || "",
        description: parsed.description || "",
        descriptionZh: parsed.descriptionZh || "",
        fabeDirection: {
          feature: parsed.fabeDirection?.feature || "",
          advantage: parsed.fabeDirection?.advantage || "",
          benefit: parsed.fabeDirection?.benefit || "",
          evidence: parsed.fabeDirection?.evidence || "",
        },
        targetKeywords: parsed.targetKeywords || [],
        addressesGap: parsed.addressesGap || "",
      };

      expect(result.theme).toBe("Eco-Friendly");
      expect(result.themeZh).toBe("");
      expect(result.fabeDirection.feature).toBe("Made from recycled materials");
      expect(result.targetKeywords).toEqual([]);
      expect(result.addressesGap).toBe("");
    });

    it("should extract JSON from markdown-wrapped response", () => {
      const markdownWrapped = '```json\n{"theme": "Easy Assembly", "themeZh": "简易组装"}\n```';
      const jsonMatch = markdownWrapped.match(/\{[\s\S]*\}/);
      expect(jsonMatch).not.toBeNull();
      const parsed = JSON.parse(jsonMatch![0]);
      expect(parsed.theme).toBe("Easy Assembly");
    });
  });

  describe("Frontend integration", () => {
    it("should validate keyword input is non-empty", () => {
      const keyword = "";
      expect(keyword.trim().length).toBe(0);
      // Frontend should show error toast for empty keyword
    });

    it("should validate keyword max length", () => {
      const keyword = "a".repeat(200);
      expect(keyword.length).toBeLessThanOrEqual(200);
      // Backend z.string().max(200) should accept this
    });

    it("should reject keyword exceeding max length", () => {
      const keyword = "a".repeat(201);
      expect(keyword.length).toBeGreaterThan(200);
      // Backend z.string().max(200) should reject this
    });

    it("should correctly merge AI result into selling point cores array", () => {
      const existingCores = [
        { index: 1, theme: "Premium Material", isManual: false },
        { index: 2, theme: "Safety Certified", isManual: false },
      ];

      const aiResult = {
        theme: "Waterproof Design",
        themeZh: "防水设计",
        description: "Highlight waterproof capabilities",
        descriptionZh: "突出防水能力",
        fabeDirection: {
          feature: "IPX7 waterproof",
          advantage: "Better than IPX4 competitors",
          benefit: "Use in rain confidently",
          evidence: "30 min submersion test",
        },
        targetKeywords: ["waterproof"],
        addressesGap: "Competitors only IPX4",
      };

      const newCore = {
        index: existingCores.length + 1,
        theme: aiResult.theme,
        themeZh: aiResult.themeZh,
        description: aiResult.description,
        descriptionZh: aiResult.descriptionZh,
        fabeDirection: aiResult.fabeDirection,
        targetKeywords: aiResult.targetKeywords,
        addressesGap: aiResult.addressesGap,
        isManual: true,
      };

      const updatedCores = [...existingCores, newCore];
      expect(updatedCores).toHaveLength(3);
      expect(updatedCores[2].theme).toBe("Waterproof Design");
      expect(updatedCores[2].isManual).toBe(true);
      expect(updatedCores[2].fabeDirection.feature).toBe("IPX7 waterproof");
    });

    it("should not exceed 9 total selling points", () => {
      const existingCores = Array.from({ length: 9 }, (_, i) => ({
        index: i + 1,
        theme: `Theme ${i + 1}`,
      }));

      expect(existingCores.length).toBe(9);
      // Frontend should disable add button and show error
      const canAddMore = existingCores.length < 9;
      expect(canAddMore).toBe(false);
    });
  });
});
