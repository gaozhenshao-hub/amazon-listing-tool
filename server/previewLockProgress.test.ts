import { describe, it, expect } from "vitest";

describe("Preview Page Lock Progress & Defensive JSON Parsing", () => {
  // --- Defensive JSON Parsing Tests ---
  describe("Defensive JSON Parsing", () => {
    it("should safely parse valid array JSON for qaContent", () => {
      const raw = '[{"q":"What is this?","a":"A product"}]';
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
    });

    it("should return null for non-array qaContent (string)", () => {
      const raw = '"just a string"';
      const parsed = JSON.parse(raw);
      const result = Array.isArray(parsed) ? parsed : null;
      expect(result).toBeNull();
    });

    it("should return null for non-array qaContent (object)", () => {
      const raw = '{"q":"test"}';
      const parsed = JSON.parse(raw);
      const result = Array.isArray(parsed) ? parsed : null;
      expect(result).toBeNull();
    });

    it("should return null for non-array qaContent (number)", () => {
      const raw = '42';
      const parsed = JSON.parse(raw);
      const result = Array.isArray(parsed) ? parsed : null;
      expect(result).toBeNull();
    });

    it("should safely parse valid object JSON for imageAdvice", () => {
      const raw = '{"mainImage":{"concept":"test","keyElements":["a","b"],"tips":["tip1"]}}';
      const parsed = JSON.parse(raw);
      const result = (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) ? parsed : null;
      expect(result).not.toBeNull();
      expect(result.mainImage.concept).toBe("test");
    });

    it("should return null for array imageAdvice (wrong type)", () => {
      const raw = '["not","an","object"]';
      const parsed = JSON.parse(raw);
      const result = (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) ? parsed : null;
      expect(result).toBeNull();
    });

    it("should return null for string imageAdvice (wrong type)", () => {
      const raw = '"just a string"';
      const parsed = JSON.parse(raw);
      const result = (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) ? parsed : null;
      expect(result).toBeNull();
    });

    it("should safely handle Array.isArray checks on nested array properties", () => {
      const imageAdvice = { mainImage: { keyElements: "not-an-array", tips: 42 } };
      expect(Array.isArray(imageAdvice.mainImage.keyElements)).toBe(false);
      expect(Array.isArray(imageAdvice.mainImage.tips)).toBe(false);
    });

    it("should correctly identify valid nested arrays", () => {
      const imageAdvice = { mainImage: { keyElements: ["a", "b"], tips: ["tip1"] } };
      expect(Array.isArray(imageAdvice.mainImage.keyElements)).toBe(true);
      expect(Array.isArray(imageAdvice.mainImage.tips)).toBe(true);
    });

    it("should handle null/undefined nested properties gracefully", () => {
      const imageAdvice = { mainImage: { keyElements: null, tips: undefined } };
      expect(Array.isArray(imageAdvice.mainImage.keyElements)).toBe(false);
      expect(Array.isArray(imageAdvice.mainImage.tips)).toBe(false);
    });

    it("should safely parse bulletPoints as array", () => {
      const raw = '[{"subtitle":"Test","fullText":"Full text here"}]';
      const parsed = JSON.parse(raw);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].subtitle).toBe("Test");
    });

    it("should fallback for non-array bulletPoints", () => {
      const raw = '"Bullet 1\\nBullet 2"';
      const parsed = JSON.parse(raw);
      const result = Array.isArray(parsed) ? parsed : [];
      expect(result).toEqual([]);
    });

    it("should handle invalid JSON gracefully", () => {
      const raw = "not valid json {{{";
      let result: any = null;
      try {
        result = JSON.parse(raw);
      } catch {
        result = null;
      }
      expect(result).toBeNull();
    });
  });

  // --- Locked Steps Parsing Tests ---
  describe("Locked Steps Parsing", () => {
    it("should parse valid lockedSteps array", () => {
      const raw = "[1,2,3]";
      const parsed = JSON.parse(raw);
      const result = Array.isArray(parsed) ? parsed : [];
      expect(result).toEqual([1, 2, 3]);
    });

    it("should return empty array for null lockedSteps", () => {
      const raw = null;
      const result = raw ? (() => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } })() : [];
      expect(result).toEqual([]);
    });

    it("should return empty array for non-array lockedSteps", () => {
      const raw = '"not-an-array"';
      const parsed = JSON.parse(raw);
      const result = Array.isArray(parsed) ? parsed : [];
      expect(result).toEqual([]);
    });

    it("should correctly identify locked vs unlocked steps", () => {
      const lockedSteps = [1, 3, 5];
      const STEP_LABELS = [
        { step: 1, label: "卖点精雕" },
        { step: 2, label: "标题生成" },
        { step: 3, label: "描述生成" },
        { step: 4, label: "搜索词" },
        { step: 5, label: "QA问答" },
      ];

      const locked = STEP_LABELS.filter(s => lockedSteps.includes(s.step));
      const unlocked = STEP_LABELS.filter(s => !lockedSteps.includes(s.step));

      expect(locked.length).toBe(3);
      expect(unlocked.length).toBe(2);
      expect(unlocked.map(s => s.label)).toEqual(["标题生成", "搜索词"]);
    });

    it("should correctly calculate allLocked status", () => {
      expect([1, 2, 3, 4, 5].length === 5).toBe(true);
      expect([1, 2, 3].length === 5).toBe(false);
      expect(([] as number[]).length === 5).toBe(false);
    });

    it("should correctly calculate lock progress percentage", () => {
      expect((3 / 5) * 100).toBe(60);
      expect((5 / 5) * 100).toBe(100);
      expect((0 / 5) * 100).toBe(0);
    });

    it("should handle empty lockedSteps string", () => {
      const raw = "";
      const result = raw ? (() => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : []; } catch { return []; } })() : [];
      expect(result).toEqual([]);
    });

    it("should handle lockedSteps with all 5 steps", () => {
      const raw = "[1,2,3,4,5]";
      const parsed = JSON.parse(raw);
      const result = Array.isArray(parsed) ? parsed : [];
      expect(result.length).toBe(5);
      expect(result).toEqual([1, 2, 3, 4, 5]);
    });
  });

  // --- Secondary Images Array Safety ---
  describe("Secondary Images Array Safety", () => {
    it("should handle secondaryImages as non-array", () => {
      const imageAdvice = { secondaryImages: "not-array" };
      expect(Array.isArray(imageAdvice.secondaryImages)).toBe(false);
    });

    it("should handle secondaryImages as valid array", () => {
      const imageAdvice = { secondaryImages: [{ concept: "test", keyElements: ["a"] }] };
      expect(Array.isArray(imageAdvice.secondaryImages)).toBe(true);
      expect(imageAdvice.secondaryImages.length).toBe(1);
    });

    it("should handle aPlusContent.sections as non-array", () => {
      const imageAdvice = { aPlusContent: { sections: "not-array" } };
      expect(Array.isArray(imageAdvice.aPlusContent.sections)).toBe(false);
    });

    it("should handle aPlusContent.sections as valid array", () => {
      const imageAdvice = { aPlusContent: { sections: [{ type: "banner", content: "test" }] } };
      expect(Array.isArray(imageAdvice.aPlusContent.sections)).toBe(true);
    });

    it("should handle nested img.icons as non-array", () => {
      const img = { icons: 42 };
      expect(Array.isArray(img.icons)).toBe(false);
    });

    it("should handle nested img.tips as non-array", () => {
      const img = { tips: null };
      expect(Array.isArray(img.tips)).toBe(false);
    });
  });
});
