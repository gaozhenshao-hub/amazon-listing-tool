import { describe, expect, it, vi } from "vitest";
import { STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT, STEP5_APLUS_MODULE_OPTIMIZE_PROMPT } from "./imageWorkflowPrompts";

/**
 * Tests for A+ module style selection and optimization feature.
 * Tests prompt content, module type definitions, and data structure.
 */

describe("A+ Module Style Selection", () => {
  describe("STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT", () => {
    it("should be defined and non-empty", () => {
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toBeDefined();
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT.length).toBeGreaterThan(100);
    });

    it("should contain the expert role prefix", () => {
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("10年设计经验");
    });

    it("should mention single module optimization", () => {
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("某一个模块");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("仅重新优化该模块");
    });

    it("should contain all premium module type IDs", () => {
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
        expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain(id);
      }
    });

    it("should contain module-specific content instructions", () => {
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("比较表");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("轮播");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("热点");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("问答");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("技术规格");
    });

    it("should require bilingual output", () => {
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("中英文双版本");
    });

    it("should contain JSON output format specification", () => {
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("JSON格式输出");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain('"moduleType"');
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain('"moduleName"');
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain('"specs"');
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain('"fabe"');
    });

    it("should contain dimension and character limit specifications", () => {
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("1464x600px");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("300x225px");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("800x600px");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("80字符");
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).toContain("300字符");
    });
  });

  describe("STEP5_APLUS_MODULE_OPTIMIZE_PROMPT (batch)", () => {
    it("should be defined and non-empty", () => {
      expect(STEP5_APLUS_MODULE_OPTIMIZE_PROMPT).toBeDefined();
      expect(STEP5_APLUS_MODULE_OPTIMIZE_PROMPT.length).toBeGreaterThan(100);
    });

    it("should be different from single module prompt", () => {
      expect(STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT).not.toBe(STEP5_APLUS_MODULE_OPTIMIZE_PROMPT);
    });
  });

  describe("Module type data structure", () => {
    const APLUS_MODULES = [
      { id: 'premium_full_image', name: '高级完整图片', category: '全屏展示' },
      { id: 'premium_text', name: '高级文本', category: '文本' },
      { id: 'premium_bg_image_text', name: '高级背景图像+文本', category: '全屏展示' },
      { id: 'premium_four_image_text', name: '高级四图片+文本', category: '图文组合' },
      { id: 'premium_dual_image_text', name: '高级双图片+文本', category: '图文组合' },
      { id: 'premium_single_image_text', name: '高级单图+文本', category: '图文组合' },
      { id: 'premium_full_video', name: '高级全视频', category: '多媒体' },
      { id: 'premium_video_text', name: '高级视频+文本', category: '多媒体' },
      { id: 'premium_comparison_1', name: '高级比较表1', category: '对比展示' },
      { id: 'premium_comparison_2', name: '高级比较表2', category: '对比展示' },
      { id: 'premium_comparison_3', name: '高级比较表3', category: '对比展示' },
      { id: 'premium_hotspot_1', name: '高级热点1', category: '交互展示' },
      { id: 'premium_hotspot_2', name: '高级热点2', category: '交互展示' },
      { id: 'premium_nav_carousel', name: '高级导航轮播', category: '轮播展示' },
      { id: 'premium_rule_carousel', name: '高级规则轮播', category: '轮播展示' },
      { id: 'premium_simple_carousel', name: '高级简单图像轮播', category: '轮播展示' },
      { id: 'premium_video_carousel', name: '高级视频图像轮播', category: '轮播展示' },
      { id: 'premium_qa', name: '高级问答', category: '信息展示' },
      { id: 'premium_tech_specs', name: '高级技术规格', category: '信息展示' },
      { id: 'brand_highlight', name: '品牌亮点', category: '品牌建设' },
      { id: 'standard_image_text', name: '标准图文', category: '标准A+' },
      { id: 'standard_comparison', name: '标准对比表', category: '标准A+' },
      { id: 'standard_four_image', name: '标准四图', category: '标准A+' },
      { id: 'standard_single_image', name: '标准单图', category: '标准A+' },
    ];

    it("should have 24 module types", () => {
      expect(APLUS_MODULES).toHaveLength(24);
    });

    it("should have unique IDs", () => {
      const ids = APLUS_MODULES.map(m => m.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("should cover all expected categories", () => {
      const categories = new Set(APLUS_MODULES.map(m => m.category));
      expect(categories).toContain("全屏展示");
      expect(categories).toContain("图文组合");
      expect(categories).toContain("对比展示");
      expect(categories).toContain("交互展示");
      expect(categories).toContain("轮播展示");
      expect(categories).toContain("多媒体");
      expect(categories).toContain("信息展示");
      expect(categories).toContain("品牌建设");
      expect(categories).toContain("标准A+");
    });

    it("should have non-empty names for all modules", () => {
      for (const mod of APLUS_MODULES) {
        expect(mod.name).toBeTruthy();
        expect(mod.name.length).toBeGreaterThan(0);
      }
    });

    it("should include both premium and standard modules", () => {
      const premiumModules = APLUS_MODULES.filter(m => m.id.startsWith("premium_"));
      const standardModules = APLUS_MODULES.filter(m => m.id.startsWith("standard_"));
      expect(premiumModules.length).toBeGreaterThan(0);
      expect(standardModules.length).toBeGreaterThan(0);
    });
  });
});
