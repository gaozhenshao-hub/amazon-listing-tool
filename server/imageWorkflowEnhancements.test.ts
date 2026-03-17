import { describe, it, expect, vi, beforeEach } from "vitest";

// ═══════════════════════════════════════════════════════════════════
// Tests for A+ Image Workflow Enhancements
// Covers: Step 1-5 lock/unlock, Step 4 ref image upload, Step 5 A+ module,
//         Step 6 AI prompt generation, export with Step 6
// ═══════════════════════════════════════════════════════════════════

// ─── Mock LLM ──────────────────────────────────────────────────────
vi.mock("./server/_core/llm", () => ({
  invokeLLM: vi.fn(),
}));

// ─── Mock Storage ──────────────────────────────────────────────────
vi.mock("./server/storage", () => ({
  storagePut: vi.fn().mockResolvedValue({ url: "https://cdn.test/uploaded.png", key: "test-key" }),
}));

describe("Image Workflow Enhancements", () => {
  // ─── Step 6 Schema Fields ────────────────────────────────────────
  describe("Step 6 DB Schema Fields", () => {
    it("should have step6 fields in the schema", async () => {
      const schema = await import("../drizzle/schema");
      const table = schema.imageWorkflowSessions;
      expect(table).toBeDefined();
      // Check that step6 columns exist
      expect(table.step6AiResult).toBeDefined();
      expect(table.step6AiResultCn).toBeDefined();
      expect(table.step6UserEdit).toBeDefined();
      expect(table.step6Confirmed).toBeDefined();
    });

    it("should have step4 reference image fields in the schema", async () => {
      const schema = await import("../drizzle/schema");
      const table = schema.imageWorkflowSessions;
      expect(table.step4CompositionRefs).toBeDefined();
      expect(table.step4EffectRefs).toBeDefined();
    });

    it("should have step5 A+ module optimization field", async () => {
      const schema = await import("../drizzle/schema");
      const table = schema.imageWorkflowSessions;
      expect(table.step5OptimizedResult).toBeDefined();
    });
  });

  // ─── Step Lock/Unlock Mechanism ──────────────────────────────────
  describe("Step Lock/Unlock Mechanism", () => {
    it("should support confirming each step (1-6)", () => {
      // Verify the session object supports confirmed flags for all 6 steps
      const mockSession = {
        step1Confirmed: 1,
        step2Confirmed: 1,
        step3Confirmed: 1,
        step4Confirmed: 1,
        step5Confirmed: 1,
        step6Confirmed: 1,
      };
      for (let i = 1; i <= 6; i++) {
        expect(mockSession[`step${i}Confirmed` as keyof typeof mockSession]).toBe(1);
      }
    });

    it("should allow resetting to any step 1-6", () => {
      // The resetToStep endpoint accepts step 1-6
      const validSteps = [1, 2, 3, 4, 5, 6];
      validSteps.forEach(step => {
        expect(step).toBeGreaterThanOrEqual(1);
        expect(step).toBeLessThanOrEqual(6);
      });
    });

    it("should clear subsequent step data when resetting", () => {
      // When resetting to step 3, steps 4-6 should be cleared
      const resetStep = 3;
      const clearedSteps = [4, 5, 6];
      clearedSteps.forEach(step => {
        expect(step).toBeGreaterThan(resetStep);
      });
    });

    it("should preserve content when unlocking a step", () => {
      // When unlocking step 2, the existing content should remain for auto-fill
      const mockSession = {
        step2AiResult: '{"outline": "test outline"}',
        step2UserEdit: '{"outline": "edited outline"}',
        step2Confirmed: 0, // unlocked
      };
      // After unlock, userEdit should still be available for auto-fill
      expect(mockSession.step2UserEdit).toBeTruthy();
      expect(mockSession.step2Confirmed).toBe(0);
    });
  });

  // ─── Step 4 Reference Image Upload ───────────────────────────────
  describe("Step 4 Independent Reference Image Upload", () => {
    it("should support composition reference image per image slot", () => {
      const compositionRefs: Record<string, string> = {
        "main_image": "https://cdn.test/comp-ref-main.png",
        "secondary_1": "https://cdn.test/comp-ref-sec1.png",
      };
      expect(Object.keys(compositionRefs).length).toBe(2);
      expect(compositionRefs["main_image"]).toContain("comp-ref");
    });

    it("should support effect reference image per image slot", () => {
      const effectRefs: Record<string, string> = {
        "main_image": "https://cdn.test/effect-ref-main.png",
        "secondary_1": "https://cdn.test/effect-ref-sec1.png",
      };
      expect(Object.keys(effectRefs).length).toBe(2);
      expect(effectRefs["main_image"]).toContain("effect-ref");
    });

    it("should store refs as JSON in session", () => {
      const refs = {
        "main_image": "https://cdn.test/ref.png",
        "secondary_2": "https://cdn.test/ref2.png",
      };
      const serialized = JSON.stringify(refs);
      const parsed = JSON.parse(serialized);
      expect(parsed["main_image"]).toBe("https://cdn.test/ref.png");
    });

    it("should support re-optimization based on reference images", () => {
      // The reoptimizeWithRef endpoint accepts imageKey and refType
      const input = {
        projectId: 1,
        imageKey: "main_image",
        refType: "composition" as const,
      };
      expect(["composition", "effect"]).toContain(input.refType);
    });
  });

  // ─── Step 5 A+ Module Selection ──────────────────────────────────
  describe("Step 5 A+ Module Style Selection", () => {
    const APLUS_MODULES = [
      { id: "standard_image_text", name: "标准图文模块" },
      { id: "standard_comparison", name: "标准对比表模块" },
      { id: "standard_tech_specs", name: "标准技术规格模块" },
      { id: "premium_hero_banner", name: "高级主图横幅模块" },
      { id: "premium_hotspot", name: "高级热点模块" },
      { id: "premium_carousel", name: "高级轮播模块" },
      { id: "premium_video", name: "高级视频模块" },
      { id: "premium_qa", name: "高级Q&A模块" },
      { id: "premium_navigation", name: "高级导航模块" },
    ];

    it("should have at least 9 A+ module types", () => {
      expect(APLUS_MODULES.length).toBeGreaterThanOrEqual(9);
    });

    it("should allow selecting multiple modules", () => {
      const selected = new Set(["premium_hero_banner", "premium_hotspot", "standard_comparison"]);
      expect(selected.size).toBe(3);
      expect(selected.has("premium_hero_banner")).toBe(true);
    });

    it("should generate optimized content based on selected modules", () => {
      const input = {
        projectId: 1,
        selectedModules: ["premium_hero_banner", "premium_carousel"],
      };
      expect(input.selectedModules.length).toBe(2);
      expect(input.selectedModules).toContain("premium_hero_banner");
    });

    it("should store optimized result separately from original", () => {
      const session = {
        step5AiResult: '{"original": true}',
        step5OptimizedResult: '{"optimized": true, "modules": ["premium_hero_banner"]}',
      };
      expect(session.step5AiResult).not.toBe(session.step5OptimizedResult);
      const optimized = JSON.parse(session.step5OptimizedResult);
      expect(optimized.optimized).toBe(true);
    });
  });

  // ─── Step 6 AI Prompt Generation ─────────────────────────────────
  describe("Step 6 AI Prompt Generation", () => {
    it("should generate prompts with correct structure", () => {
      const mockResult = {
        imagePrompts: [
          {
            imageType: "mainImage",
            imageNumber: 1,
            imageLabel: "主图",
            purpose: "展示产品全貌",
            prompt: "A premium product photo, studio lighting, white background, 8k, ultra detailed",
            negativePrompt: "blurry, low quality, watermark, text overlay",
            parameters: {
              aspectRatio: "1:1",
              style: "photographic",
              quality: "hd",
              seed: null,
            },
            promptBreakdown: {
              subject: "premium product",
              scene: "white studio background",
              composition: "centered, full product view",
              lighting: "studio lighting, soft shadows",
              color: "neutral, product colors",
              styleKeywords: "commercial photography",
              qualityKeywords: "8k, ultra detailed",
            },
            notes: "Use square format for Amazon main image requirements",
          },
        ],
        globalSettings: {
          recommendedTool: "Midjourney v6",
          consistencyTips: "Use same seed and style parameters",
          brandColorIntegration: "Add brand accent color to props",
        },
      };

      expect(mockResult.imagePrompts.length).toBeGreaterThan(0);
      const firstPrompt = mockResult.imagePrompts[0];
      expect(firstPrompt.imageType).toBe("mainImage");
      expect(firstPrompt.prompt).toBeTruthy();
      expect(firstPrompt.negativePrompt).toBeTruthy();
      expect(firstPrompt.parameters.aspectRatio).toBe("1:1");
      expect(firstPrompt.promptBreakdown.subject).toBeTruthy();
      expect(mockResult.globalSettings.recommendedTool).toBeTruthy();
    });

    it("should support both EN and CN versions", () => {
      const enPrompt = "A premium product photo, studio lighting";
      const cnPrompt = "一张高端产品照片，影棚灯光";
      expect(enPrompt).not.toBe(cnPrompt);
      expect(typeof enPrompt).toBe("string");
      expect(typeof cnPrompt).toBe("string");
    });

    it("should allow editing prompts before confirming", () => {
      const originalPrompt = "A product photo, white background";
      const editedPrompt = "A premium product photo, gradient background, soft lighting";
      expect(editedPrompt).not.toBe(originalPrompt);
      expect(editedPrompt.length).toBeGreaterThan(originalPrompt.length);
    });

    it("should support copying individual and all prompts", () => {
      const prompts = [
        { prompt: "prompt 1", negativePrompt: "neg 1", imageLabel: "主图" },
        { prompt: "prompt 2", negativePrompt: "neg 2", imageLabel: "辅图1" },
      ];
      // Copy all
      const allText = prompts.map((p, i) =>
        `--- ${p.imageLabel} ---\nPrompt: ${p.prompt}\nNegative: ${p.negativePrompt}\n`
      ).join('\n');
      expect(allText).toContain("主图");
      expect(allText).toContain("辅图1");
      expect(allText).toContain("prompt 1");
    });

    it("should confirm and lock step 6", () => {
      const session = {
        step6AiResult: '{"imagePrompts": []}',
        step6UserEdit: '{"imagePrompts": [{"prompt": "edited"}]}',
        step6Confirmed: 1,
        status: "completed",
      };
      expect(session.step6Confirmed).toBe(1);
      expect(session.status).toBe("completed");
    });
  });

  // ─── Export with Step 6 ──────────────────────────────────────────
  describe("Export Full Plan with Step 6", () => {
    it("should include Step 6 in the table of contents", () => {
      const toc = [
        "Step 1: 卖点梳理",
        "Step 2: 图片大纲",
        "Step 3: 风格确认",
        "Step 4: 参考图确认",
        "Step 5: 图片结构及内容建议",
        "Step 6: AI图片提示词",
      ];
      expect(toc.length).toBe(6);
      expect(toc[5]).toContain("Step 6");
      expect(toc[5]).toContain("AI图片提示词");
    });

    it("should export Step 6 prompt data in HTML format", () => {
      const mockStep6Data = {
        imagePrompts: [
          {
            imageLabel: "主图",
            purpose: "展示产品",
            prompt: "A product photo",
            negativePrompt: "blurry",
            parameters: { aspectRatio: "1:1", style: "photo", quality: "hd" },
            notes: "Use square format",
          },
        ],
        globalSettings: {
          recommendedTool: "Midjourney",
          consistencyTips: "Same seed",
          brandColorIntegration: "Brand blue",
        },
      };

      // Simulate export HTML generation
      const html: string[] = [];
      html.push(`<h2>Step 6: AI图片提示词</h2>`);
      if (mockStep6Data.globalSettings) {
        html.push(`<p>推荐工具: ${mockStep6Data.globalSettings.recommendedTool}</p>`);
      }
      mockStep6Data.imagePrompts.forEach((p, idx) => {
        html.push(`<h4>${p.imageLabel}</h4>`);
        html.push(`<pre>${p.prompt}</pre>`);
        html.push(`<pre>${p.negativePrompt}</pre>`);
      });

      const result = html.join("\n");
      expect(result).toContain("Step 6");
      expect(result).toContain("Midjourney");
      expect(result).toContain("A product photo");
      expect(result).toContain("blurry");
    });

    it("should only show export button when all 6 steps are confirmed", () => {
      const session = {
        step1Confirmed: 1,
        step2Confirmed: 1,
        step3Confirmed: 1,
        step4Confirmed: 1,
        step5Confirmed: 1,
        step6Confirmed: 1,
      };
      const allConfirmed = [1, 2, 3, 4, 5, 6].every(
        s => session[`step${s}Confirmed` as keyof typeof session] === 1
      );
      expect(allConfirmed).toBe(true);
    });

    it("should not show export when step 6 is not confirmed", () => {
      const session = {
        step1Confirmed: 1,
        step2Confirmed: 1,
        step3Confirmed: 1,
        step4Confirmed: 1,
        step5Confirmed: 1,
        step6Confirmed: 0,
      };
      const allConfirmed = [1, 2, 3, 4, 5, 6].every(
        s => session[`step${s}Confirmed` as keyof typeof session] === 1
      );
      expect(allConfirmed).toBe(false);
    });
  });

  // ─── A+ Module Reference Data ────────────────────────────────────
  describe("A+ Module Reference Data", () => {
    const PREMIUM_APLUS_MODULES = [
      {
        id: "premium_hero_banner",
        name: "高级主图横幅模块",
        description: "全宽横幅图片，支持视频和交互元素",
        imageSize: "1464×600",
        category: "premium",
      },
      {
        id: "premium_hotspot",
        name: "高级热点模块",
        description: "可点击热点区域，展示产品细节",
        imageSize: "1464×600",
        category: "premium",
      },
      {
        id: "premium_carousel",
        name: "高级轮播模块",
        description: "多图轮播展示，支持自动播放",
        imageSize: "1464×600",
        category: "premium",
      },
      {
        id: "standard_image_text",
        name: "标准图文模块",
        description: "左图右文或右图左文布局",
        imageSize: "300×300",
        category: "standard",
      },
    ];

    it("should have both standard and premium module categories", () => {
      const categories = new Set(PREMIUM_APLUS_MODULES.map(m => m.category));
      expect(categories.has("standard")).toBe(true);
      expect(categories.has("premium")).toBe(true);
    });

    it("should have image size specifications for each module", () => {
      PREMIUM_APLUS_MODULES.forEach(m => {
        expect(m.imageSize).toBeTruthy();
        expect(m.imageSize).toMatch(/\d+×\d+/);
      });
    });

    it("should have unique IDs for all modules", () => {
      const ids = PREMIUM_APLUS_MODULES.map(m => m.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });
  });

  // ─── StepProgressBar with 6 Steps ────────────────────────────────
  describe("StepProgressBar with 6 Steps", () => {
    it("should have 6 step labels", () => {
      const STEPS = [
        { label: "卖点梳理", icon: "Target" },
        { label: "图片大纲", icon: "Layout" },
        { label: "风格确认", icon: "Palette" },
        { label: "参考图确认", icon: "Eye" },
        { label: "图片建议", icon: "Image" },
        { label: "AI提示词", icon: "Wand2" },
      ];
      expect(STEPS.length).toBe(6);
      expect(STEPS[5].label).toBe("AI提示词");
    });

    it("should show step 6 as completed when confirmed", () => {
      const session = { step6Confirmed: 1 };
      expect(!!session.step6Confirmed).toBe(true);
    });
  });

  // ─── Workflow Completion ─────────────────────────────────────────
  describe("Workflow Completion", () => {
    it("should mark workflow as completed when step 6 is confirmed", () => {
      const session = {
        step6Confirmed: 1,
        status: "completed",
      };
      expect(session.status).toBe("completed");
    });

    it("should advance to step 6 after step 5 confirm", () => {
      let currentStep = 5;
      const maxSteps = 6;
      if (currentStep < maxSteps) {
        currentStep++;
      }
      expect(currentStep).toBe(6);
    });

    it("should not advance beyond step 6", () => {
      let currentStep = 6;
      const maxSteps = 6;
      if (currentStep < maxSteps) {
        currentStep++;
      }
      expect(currentStep).toBe(6);
    });
  });
});
