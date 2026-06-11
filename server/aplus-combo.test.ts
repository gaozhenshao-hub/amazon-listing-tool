import { describe, expect, it } from "vitest";
import { STEP5_APLUS_COMBO_RECOMMEND_PROMPT } from "./imageWorkflowPrompts";

/**
 * Tests for A+ module combination recommendation feature.
 * Validates prompt content, module coverage, and recommendation strategy.
 */

describe("A+ Module Combo Recommendation", () => {
  describe("STEP5_APLUS_COMBO_RECOMMEND_PROMPT", () => {
    it("should be defined and substantial", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toBeDefined();
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT.length).toBeGreaterThan(500);
    });

    it("should contain the expert role prefix", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("10年设计经验");
    });

    it("should require 3 recommendation plans", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("3套");
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("recommendations");
    });

    it("should require 6 modules per plan", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("6个模块");
    });

    it("should contain all 24 module type IDs", () => {
      const expectedModuleIds = [
        "premium_full_image",
        "premium_text",
        "premium_bg_image_text",
        "premium_four_image_text",
        "premium_dual_image_text",
        "premium_single_image_text",
        "premium_full_video",
        "premium_video_text",
        "premium_comparison_1",
        "premium_comparison_2",
        "premium_comparison_3",
        "premium_hotspot_1",
        "premium_hotspot_2",
        "premium_nav_carousel",
        "premium_rule_carousel",
        "premium_simple_carousel",
        "premium_video_carousel",
        "premium_qa",
        "premium_tech_specs",
        "brand_highlight",
        "standard_image_text",
        "standard_comparison",
        "standard_four_image",
        "standard_single_image",
      ];
      for (const id of expectedModuleIds) {
        expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain(id);
      }
    });

    it("should describe 3 strategy types", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("品牌故事型");
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("功能展示型");
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("场景驱动型");
    });

    it("should contain selling point count-based rules", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("卖点数量≤3个");
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("卖点数量4-6个");
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("卖点数量≥7个");
    });

    it("should specify JSON output format with required fields", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"recommendations"');
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"name"');
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"modules"');
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"moduleType"');
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"position"');
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"score"');
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"strengths"');
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"bestFor"');
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"visualRhythm"');
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain('"analysisNote"');
    });

    it("should mention visual rhythm considerations", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("视觉节奏");
    });

    it("should consider product type differentiation", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("技术性产品");
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("生活方式产品");
    });

    it("should mention video module consideration", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("视频素材");
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("视频模块");
    });

    it("should require content suggestions tied to actual selling points", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("contentSuggestion");
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("实际卖点");
    });

    it("should require score in 0-100 range", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("0-100");
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("推荐评分");
    });

    it("should require differentiated plans", () => {
      expect(STEP5_APLUS_COMBO_RECOMMEND_PROMPT).toContain("明显差异化");
    });
  });

  describe("Combo apply logic", () => {
    it("should correctly map combo modules to section indices", () => {
      const comboModules = [
        { position: 1, moduleType: "premium_full_image", moduleName: "高级完整图片" },
        { position: 2, moduleType: "premium_four_image_text", moduleName: "高级四图片+文本" },
        { position: 3, moduleType: "premium_hotspot_1", moduleName: "高级热点1" },
        { position: 4, moduleType: "premium_dual_image_text", moduleName: "高级双图片+文本" },
        { position: 5, moduleType: "premium_comparison_1", moduleName: "高级比较表1" },
        { position: 6, moduleType: "brand_highlight", moduleName: "品牌亮点" },
      ];

      const newStyles: Record<number, string> = {};
      comboModules.forEach((mod) => {
        const idx = (mod.position || 1) - 1;
        if (mod.moduleType) newStyles[idx] = mod.moduleType;
      });

      expect(Object.keys(newStyles)).toHaveLength(6);
      expect(newStyles[0]).toBe("premium_full_image");
      expect(newStyles[1]).toBe("premium_four_image_text");
      expect(newStyles[2]).toBe("premium_hotspot_1");
      expect(newStyles[3]).toBe("premium_dual_image_text");
      expect(newStyles[4]).toBe("premium_comparison_1");
      expect(newStyles[5]).toBe("brand_highlight");
    });

    it("should handle modules with missing position gracefully", () => {
      const comboModules = [
        { moduleType: "premium_full_image", moduleName: "高级完整图片" },
        { position: 2, moduleType: "premium_text", moduleName: "高级文本" },
      ];

      const newStyles: Record<number, string> = {};
      comboModules.forEach((mod: any) => {
        const idx = (mod.position || 1) - 1;
        if (mod.moduleType) newStyles[idx] = mod.moduleType;
      });

      expect(newStyles[0]).toBe("premium_full_image");
      expect(newStyles[1]).toBe("premium_text");
    });
  });
});
