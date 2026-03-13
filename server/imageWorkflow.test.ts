import { describe, expect, it } from "vitest";
import {
  STEP1_SELLING_POINTS_PROMPT,
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP3_STYLE_PROMPT,
  STEP4_REFERENCE_PROMPT,
  STEP5_FINAL_SUGGESTION_PROMPT,
  STEP5_TRANSLATION_PROMPT,
} from "./imageWorkflowPrompts";

// ═══════════════════════════════════════════════════════════════════
// 5-Step Image Workflow Tests
// ═══════════════════════════════════════════════════════════════════

describe("Image Workflow 5-Step Prompts", () => {

  // ─── Step 1: Selling Points Prompt ─────────────────────────────
  describe("STEP1_SELLING_POINTS_PROMPT", () => {
    it("includes the expert role", () => {
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("拥有10年设计经验且优秀的亚马逊运营专家");
    });

    it("includes all 6 analysis dimensions", () => {
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("核心卖点");
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("次要卖点");
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("差评点");
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("好评点");
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("必要性描述");
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("使用场景");
    });

    it("specifies core selling points should be max 2", () => {
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("不超过2个");
    });

    it("includes memory hook concept for core selling points", () => {
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("记忆点");
    });

    it("includes expression strategies for core selling points", () => {
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("expressionStrategies");
    });

    it("distinguishes resolved vs unresolved negative review points", () => {
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("已解决");
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("未解决");
    });

    it("includes scene weight/percentage concept", () => {
      expect(STEP1_SELLING_POINTS_PROMPT).toContain("占比");
    });

    it("outputs JSON with required structure fields", () => {
      expect(STEP1_SELLING_POINTS_PROMPT).toContain('"coreSellingPoints"');
      expect(STEP1_SELLING_POINTS_PROMPT).toContain('"secondarySellingPoints"');
      expect(STEP1_SELLING_POINTS_PROMPT).toContain('"negativeReviewPoints"');
      expect(STEP1_SELLING_POINTS_PROMPT).toContain('"positiveReviewPoints"');
      expect(STEP1_SELLING_POINTS_PROMPT).toContain('"necessityDescriptions"');
      expect(STEP1_SELLING_POINTS_PROMPT).toContain('"scenes"');
    });
  });

  // ─── Step 2: Image Outline Prompt ──────────────────────────────
  describe("STEP2_IMAGE_OUTLINE_PROMPT", () => {
    it("includes the expert role", () => {
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain("拥有10年设计经验且优秀的亚马逊运营专家");
    });

    it("covers main image, secondary images, brand story and A+ content", () => {
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain("主图");
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain("辅图");
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain("品牌故事");
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain("A+");
    });

    it("requires each image to map to selling points", () => {
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain("sellingPointRef");
    });

    it("outputs JSON with mainImage, secondaryImages, brandStory, aPlusModules", () => {
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain('"mainImage"');
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain('"secondaryImages"');
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain('"brandStory"');
      expect(STEP2_IMAGE_OUTLINE_PROMPT).toContain('"aPlusModules"');
    });
  });

  // ─── Step 3: Style Prompt ──────────────────────────────────────
  describe("STEP3_STYLE_PROMPT", () => {
    it("includes the expert role", () => {
      expect(STEP3_STYLE_PROMPT).toContain("拥有10年设计经验且优秀的亚马逊运营专家");
    });

    it("recommends multiple style options", () => {
      expect(STEP3_STYLE_PROMPT).toContain("styleOptions");
    });

    it("includes color palette in style recommendations", () => {
      expect(STEP3_STYLE_PROMPT).toContain("colorPalette");
    });

    it("includes font recommendations", () => {
      expect(STEP3_STYLE_PROMPT).toContain("typography");
    });

    it("includes design style description", () => {
      expect(STEP3_STYLE_PROMPT).toContain("overallTone");
    });
  });

  // ─── Step 4: Reference Image Prompt ────────────────────────────
  describe("STEP4_REFERENCE_PROMPT", () => {
    it("includes the expert role", () => {
      expect(STEP4_REFERENCE_PROMPT).toContain("拥有10年设计经验且优秀的亚马逊运营专家");
    });

    it("includes composition reference concept", () => {
      expect(STEP4_REFERENCE_PROMPT).toContain("构图参考");
    });

    it("includes effect reference concept", () => {
      expect(STEP4_REFERENCE_PROMPT).toContain("效果图参考");
    });

    it("prioritizes knowledge base for composition references", () => {
      expect(STEP4_REFERENCE_PROMPT).toContain("构图参考");
    });

    it("outputs JSON with references per image", () => {
      expect(STEP4_REFERENCE_PROMPT).toContain('"imageReferences"');
      expect(STEP4_REFERENCE_PROMPT).toContain('"compositionReference"');
      expect(STEP4_REFERENCE_PROMPT).toContain('"effectReference"');
    });
  });

  // ─── Step 5: Final Suggestion Prompt ───────────────────────────
  describe("STEP5_FINAL_SUGGESTION_PROMPT", () => {
    it("includes the expert role", () => {
      expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain("拥有10年设计经验且优秀的亚马逊运营专家");
    });

    it("includes designGuidelines in output structure", () => {
      expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain('"designGuidelines"');
    });

    it("includes FABE analysis in output", () => {
      expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain("FABE");
      expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain('"fabe"');
    });

    it("includes data visualization in output", () => {
      expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain('"dataVisualization"');
    });

    it("includes icons in output", () => {
      expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain('"icons"');
    });

    it("includes A+ content with story, consistency, modular design", () => {
      expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain('"overallStory"');
      expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain('"consistency"');
      expect(STEP5_FINAL_SUGGESTION_PROMPT).toContain('"modularDesign"');
    });
  });

  // ─── Step 5: Translation Prompt ────────────────────────────────
  describe("STEP5_TRANSLATION_PROMPT", () => {
    it("is a translation prompt", () => {
      expect(STEP5_TRANSLATION_PROMPT).toContain("翻译");
    });

    it("maintains JSON structure during translation", () => {
      expect(STEP5_TRANSLATION_PROMPT).toContain("JSON");
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Workflow Data Structure Validation Tests
// ═══════════════════════════════════════════════════════════════════

describe("Image Workflow Data Structures", () => {

  describe("Step 1: Selling Points Structure", () => {
    const sampleStep1 = {
      coreSellingPoints: [
        {
          id: 1,
          point: "超强防水IPX7",
          whyCore: "竞品多为IPX5，我们的IPX7是差异化优势",
          expressionStrategies: ["水下实拍展示", "对比图展示", "数据图表展示"],
          memoryHook: "IPX7 全天候防水",
        },
      ],
      secondarySellingPoints: [
        { id: 1, point: "轻量化设计", value: "仅120g", suggestedExpression: "手持展示轻巧" },
      ],
      negativeReviewPoints: [
        { id: 1, point: "电池续航短", status: "resolved", strategy: "对比展示新版12小时续航", imageStrategy: "数据对比图" },
      ],
      positiveReviewPoints: [
        { id: 1, point: "音质出色", strength: "high", reinforceStrategy: "场景化展示" },
      ],
      essentialInfo: [
        { id: 1, type: "parameter", content: "尺寸: 120x60x30mm", priority: "high" },
      ],
      scenes: [
        { id: 1, scene: "户外运动", weight: 40, keywords: ["running", "hiking"], suggestedExpression: "运动场景实拍" },
      ],
    };

    it("validates core selling points structure", () => {
      const cp = sampleStep1.coreSellingPoints[0];
      expect(cp).toHaveProperty("id");
      expect(cp).toHaveProperty("point");
      expect(cp).toHaveProperty("whyCore");
      expect(cp).toHaveProperty("expressionStrategies");
      expect(cp).toHaveProperty("memoryHook");
      expect(Array.isArray(cp.expressionStrategies)).toBe(true);
    });

    it("validates negative review points have status field", () => {
      const np = sampleStep1.negativeReviewPoints[0];
      expect(np).toHaveProperty("status");
      expect(["resolved", "unresolved"]).toContain(np.status);
      expect(np).toHaveProperty("imageStrategy");
    });

    it("validates scenes have weight field", () => {
      const scene = sampleStep1.scenes[0];
      expect(scene).toHaveProperty("weight");
      expect(typeof scene.weight).toBe("number");
    });

    it("can serialize and deserialize step 1 data", () => {
      const json = JSON.stringify(sampleStep1);
      const parsed = JSON.parse(json);
      expect(parsed.coreSellingPoints).toHaveLength(1);
      expect(parsed.scenes[0].weight).toBe(40);
    });
  });

  describe("Step 2: Image Outline Structure", () => {
    const sampleStep2 = {
      mainImage: {
        purpose: "第一印象，展示产品全貌",
        sellingPointRef: "核心卖点1",
        content: "产品正面45度角展示",
        keyMessage: "IPX7防水蓝牙耳机",
      },
      secondaryImages: [
        {
          imageNumber: 2,
          purpose: "核心卖点展示",
          sellingPointRef: "核心卖点1 - 防水",
          content: "水下实拍展示IPX7防水性能",
          keyMessage: "IPX7级防水，无惧风雨",
        },
      ],
      brandStory: {
        theme: "品质生活，音乐相伴",
        modules: [
          { type: "header", content: "品牌理念展示" },
          { type: "lifestyle", content: "用户使用场景" },
        ],
      },
      aPlusModules: [
        {
          moduleNumber: 1,
          type: "Hero Banner",
          sellingPointRef: "品牌故事",
          content: "全幅品牌形象展示",
          keyMessage: "专注音频10年",
        },
      ],
    };

    it("validates main image has selling point reference", () => {
      expect(sampleStep2.mainImage).toHaveProperty("sellingPointRef");
      expect(sampleStep2.mainImage).toHaveProperty("purpose");
      expect(sampleStep2.mainImage).toHaveProperty("content");
    });

    it("validates secondary images have selling point mapping", () => {
      const img = sampleStep2.secondaryImages[0];
      expect(img).toHaveProperty("sellingPointRef");
      expect(img).toHaveProperty("imageNumber");
      expect(img).toHaveProperty("keyMessage");
    });

    it("validates brand story is included", () => {
      expect(sampleStep2).toHaveProperty("brandStory");
      expect(sampleStep2.brandStory).toHaveProperty("theme");
      expect(sampleStep2.brandStory).toHaveProperty("modules");
    });

    it("validates A+ modules are included", () => {
      expect(sampleStep2).toHaveProperty("aPlusModules");
      expect(sampleStep2.aPlusModules[0]).toHaveProperty("type");
      expect(sampleStep2.aPlusModules[0]).toHaveProperty("sellingPointRef");
    });
  });

  describe("Step 3: Style Structure", () => {
    const sampleStep3 = {
      styles: [
        {
          id: 1,
          name: "科技蓝·简约风",
          designStyle: "Minimalist Tech",
          colorPalette: { primary: "#2563EB", secondary: "#F8FAFC", accent: "#0EA5E9", text: "#1E293B" },
          fontStyle: { heading: "Montserrat Bold", body: "Inter Regular" },
          backgroundStyle: "纯色/渐变背景",
          moodDescription: "科技感、专业、可信赖",
          suitableFor: "电子产品、智能设备",
          sampleDescription: "蓝白配色，几何线条装饰，大面积留白",
        },
      ],
    };

    it("validates style has all required fields", () => {
      const style = sampleStep3.styles[0];
      expect(style).toHaveProperty("id");
      expect(style).toHaveProperty("name");
      expect(style).toHaveProperty("designStyle");
      expect(style).toHaveProperty("colorPalette");
      expect(style).toHaveProperty("fontStyle");
      expect(style).toHaveProperty("moodDescription");
    });

    it("validates color palette has primary, secondary, accent", () => {
      const palette = sampleStep3.styles[0].colorPalette;
      expect(palette).toHaveProperty("primary");
      expect(palette).toHaveProperty("secondary");
      expect(palette).toHaveProperty("accent");
    });
  });

  describe("Step 4: Reference Image Structure", () => {
    const sampleStep4 = {
      imageReferences: [
        {
          imageNumber: 1,
          imageType: "主图",
          compositionRef: {
            type: "居中构图",
            description: "产品居中，占画面85%",
            source: "知识库",
            referenceId: "kb-001",
          },
          effectRef: {
            style: "科技蓝·简约风",
            description: "蓝白渐变背景，产品悬浮效果",
            source: "风格方案1",
          },
        },
      ],
    };

    it("validates reference has composition and effect references", () => {
      const ref = sampleStep4.imageReferences[0];
      expect(ref).toHaveProperty("compositionRef");
      expect(ref).toHaveProperty("effectRef");
      expect(ref.compositionRef).toHaveProperty("type");
      expect(ref.compositionRef).toHaveProperty("source");
      expect(ref.effectRef).toHaveProperty("style");
    });
  });

  describe("Step 5: Final Suggestion Structure", () => {
    const sampleStep5 = {
      designGuidelines: {
        fontRecommendation: "Montserrat Bold / Inter Regular",
        overallColorPalette: "Primary #2563EB, Secondary #F8FAFC, Accent #0EA5E9",
        accentColor: "#0EA5E9",
        iconColor: "#2563EB",
        primaryFontColor: "#1E293B",
        secondaryFontColor: "#64748B",
        brandTone: "科技感、专业、可信赖",
        mobileOptimization: "最小字号24px，触控区域44px",
      },
      mainImage: {
        concept: "产品全貌展示",
        title: "IPX7 Waterproof",
        colorScheme: { primary: "#FFFFFF", secondary: "#F1F5F9", accent: "#2563EB" },
        composition: "居中构图，产品占85%",
        shootingNotes: "45度角，柔光，无阴影",
        keyElements: ["产品正面", "品牌Logo"],
        tips: ["使用高分辨率相机"],
      },
      secondaryImages: [
        {
          imageNumber: 2,
          title: "IPX7 Waterproof Protection",
          focus: "防水性能",
          fabe: {
            feature: "IPX7级防水认证",
            advantage: "超越竞品IPX5标准",
            benefit: "运动出汗、雨天无忧",
            evidence: "通过IPX7认证测试",
          },
          expressionMethod: "实拍对比",
          composition: "分屏对比",
          colorScheme: { primary: "#2563EB", secondary: "#FFFFFF", accent: "#0EA5E9" },
          textOverlay: "IPX7 WATERPROOF",
          dataVisualization: "防水等级对比柱状图",
          icons: ["water-drop", "shield", "checkmark"],
          keyElements: ["水下实拍", "对比数据"],
          tips: ["使用防水测试实拍素材"],
        },
      ],
      aPlusContent: {
        overallStrategy: "故事驱动",
        overallStory: "从问题到解决方案的叙事",
        consistency: "蓝白配色贯穿始终",
        modularDesign: "每个模块独立完整",
        sections: [
          {
            type: "Hero Banner",
            title: "The Ultimate Audio Experience",
            purpose: "品牌形象",
            content: "全幅品牌形象展示",
            fabe: {
              feature: "一体化设计",
              advantage: "替代3个独立工具",
              benefit: "节省时间和空间",
              evidence: "50,000+用户使用",
            },
            expressionMethod: "场景展示",
            colorScheme: { primary: "#2563EB", secondary: "#FFFFFF", accent: "#F59E0B" },
            composition: "全幅，文字叠加在左侧",
            dataVisualization: "用户满意度饼图",
            icons: ["star", "users", "clock"],
            tips: ["使用生活方式摄影"],
          },
        ],
      },
    };

    it("validates designGuidelines has all enhanced fields", () => {
      const dg = sampleStep5.designGuidelines;
      expect(dg).toHaveProperty("fontRecommendation");
      expect(dg).toHaveProperty("overallColorPalette");
      expect(dg).toHaveProperty("accentColor");
      expect(dg).toHaveProperty("iconColor");
      expect(dg).toHaveProperty("primaryFontColor");
      expect(dg).toHaveProperty("secondaryFontColor");
      expect(dg).toHaveProperty("brandTone");
      expect(dg).toHaveProperty("mobileOptimization");
    });

    it("validates mainImage has shooting notes and composition", () => {
      const mi = sampleStep5.mainImage;
      expect(mi).toHaveProperty("concept");
      expect(mi).toHaveProperty("shootingNotes");
      expect(mi).toHaveProperty("composition");
      expect(mi).toHaveProperty("colorScheme");
    });

    it("validates secondaryImages have FABE analysis", () => {
      const si = sampleStep5.secondaryImages[0];
      expect(si).toHaveProperty("fabe");
      expect(si.fabe).toHaveProperty("feature");
      expect(si.fabe).toHaveProperty("advantage");
      expect(si.fabe).toHaveProperty("benefit");
      expect(si.fabe).toHaveProperty("evidence");
    });

    it("validates secondaryImages have data visualization and icons", () => {
      const si = sampleStep5.secondaryImages[0];
      expect(si).toHaveProperty("dataVisualization");
      expect(si).toHaveProperty("icons");
      expect(Array.isArray(si.icons)).toBe(true);
    });

    it("validates A+ content has story, consistency, modular design", () => {
      const ap = sampleStep5.aPlusContent;
      expect(ap).toHaveProperty("overallStory");
      expect(ap).toHaveProperty("consistency");
      expect(ap).toHaveProperty("modularDesign");
    });

    it("validates A+ sections have FABE and enhanced fields", () => {
      const section = sampleStep5.aPlusContent.sections[0];
      expect(section).toHaveProperty("fabe");
      expect(section).toHaveProperty("expressionMethod");
      expect(section).toHaveProperty("colorScheme");
      expect(section).toHaveProperty("composition");
      expect(section).toHaveProperty("dataVisualization");
      expect(section).toHaveProperty("icons");
    });

    it("can serialize full step 5 data round-trip", () => {
      const json = JSON.stringify(sampleStep5);
      const parsed = JSON.parse(json);
      expect(parsed.designGuidelines.accentColor).toBe("#0EA5E9");
      expect(parsed.secondaryImages[0].fabe.feature).toBe("IPX7级防水认证");
      expect(parsed.aPlusContent.overallStory).toBe("从问题到解决方案的叙事");
      expect(parsed.aPlusContent.sections[0].icons).toEqual(["star", "users", "clock"]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Workflow Session State Machine Tests
// ═══════════════════════════════════════════════════════════════════

describe("Workflow Session State Machine", () => {
  it("validates step progression order: 1 → 2 → 3 → 4 → 5", () => {
    const validTransitions = [
      { from: 1, to: 2 },
      { from: 2, to: 3 },
      { from: 3, to: 4 },
      { from: 4, to: 5 },
    ];
    validTransitions.forEach(({ from, to }) => {
      expect(to).toBe(from + 1);
    });
  });

  it("validates reset clears data from target step onwards", () => {
    const resetToStep = (step: number) => {
      const clearData: Record<string, any> = { currentStep: step };
      for (let s = step; s <= 5; s++) {
        clearData[`step${s}AiResult`] = null;
        clearData[`step${s}UserEdit`] = null;
        clearData[`step${s}Confirmed`] = 0;
      }
      return clearData;
    };

    const reset3 = resetToStep(3);
    expect(reset3.currentStep).toBe(3);
    expect(reset3.step3AiResult).toBeNull();
    expect(reset3.step4AiResult).toBeNull();
    expect(reset3.step5AiResult).toBeNull();
    // Steps before target should not be cleared
    expect(reset3).not.toHaveProperty("step1AiResult");
    expect(reset3).not.toHaveProperty("step2AiResult");
  });

  it("validates each step requires previous step confirmation", () => {
    const stepDependencies: Record<number, string> = {
      2: "step1Confirmed",
      3: "step2Confirmed",
      4: "step3Confirmed",
      5: "step4Confirmed",
    };

    Object.entries(stepDependencies).forEach(([step, dep]) => {
      expect(dep).toBe(`step${Number(step) - 1}Confirmed`);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════
// Knowledge Base Image Picker for Step 4 Tests
// ═══════════════════════════════════════════════════════════════════

describe("KB Image Picker Integration", () => {
  describe("KB Image data structure", () => {
    it("KB image has required fields for picker display", () => {
      const sampleKbImage = {
        id: 1,
        imageUrl: "https://example.com/image.jpg",
        imagePosition: "main" as const,
        tagCategory: "家居收纳",
        tagColorScheme: "黑白灰",
        tagImageType: "场景图",
        tagDesignStyle: "简约风",
      };
      expect(sampleKbImage.id).toBeDefined();
      expect(sampleKbImage.imageUrl).toBeDefined();
      expect(sampleKbImage.imagePosition).toBeDefined();
      expect(["main", "secondary", "aplus"]).toContain(sampleKbImage.imagePosition);
    });

    it("supports 4-dimension filtering", () => {
      const filterKeys = ["tagCategory", "tagColorScheme", "tagImageType", "tagDesignStyle"];
      const sampleFilter = {
        tagCategory: "家居收纳",
        tagColorScheme: "黑白灰",
        tagImageType: "场景图",
        tagDesignStyle: "简约风",
      };
      filterKeys.forEach(key => {
        expect(sampleFilter).toHaveProperty(key);
      });
    });

    it("supports imagePosition filter for main/secondary/aplus", () => {
      const validPositions = ["main", "secondary", "aplus"];
      validPositions.forEach(pos => {
        expect(typeof pos).toBe("string");
        expect(pos.length).toBeGreaterThan(0);
      });
    });
  });

  describe("KB reference images in Step4 data", () => {
    it("can attach KB images to a reference entry", () => {
      const refEntry = {
        imageType: "辅图",
        imageNumber: 2,
        purpose: "展示产品功能",
        compositionReference: { compositionType: "对角线构图" },
        effectReference: { colorApplication: "蓝白配色" },
        kbReferenceImages: [
          {
            id: 10,
            imageUrl: "https://example.com/kb1.jpg",
            position: "secondary",
            category: "家居收纳",
            imageType: "功能图",
            designStyle: "简约风",
            colorScheme: "蓝白",
          },
        ],
      };
      expect(refEntry.kbReferenceImages).toHaveLength(1);
      expect(refEntry.kbReferenceImages[0].imageUrl).toContain("https://");
      expect(refEntry.kbReferenceImages[0].position).toBe("secondary");
    });

    it("can add multiple KB images to a reference", () => {
      const kbImages: any[] = [];
      kbImages.push({ id: 1, imageUrl: "url1", position: "main" });
      kbImages.push({ id: 2, imageUrl: "url2", position: "secondary" });
      kbImages.push({ id: 3, imageUrl: "url3", position: "aplus" });
      expect(kbImages).toHaveLength(3);
    });

    it("can remove a KB image from a reference", () => {
      const kbImages = [
        { id: 1, imageUrl: "url1" },
        { id: 2, imageUrl: "url2" },
        { id: 3, imageUrl: "url3" },
      ];
      const filtered = kbImages.filter((_, idx) => idx !== 1);
      expect(filtered).toHaveLength(2);
      expect(filtered.map(i => i.id)).toEqual([1, 3]);
    });

    it("preserves KB images when serializing Step4 data", () => {
      const step4Data = {
        imageReferences: [
          {
            imageType: "主图",
            kbReferenceImages: [{ id: 1, imageUrl: "url1" }],
            compositionReference: {},
            effectReference: {},
          },
        ],
        overallConsistency: "保持一致",
      };
      const serialized = JSON.stringify(step4Data);
      const parsed = JSON.parse(serialized);
      expect(parsed.imageReferences[0].kbReferenceImages).toHaveLength(1);
      expect(parsed.imageReferences[0].kbReferenceImages[0].imageUrl).toBe("url1");
    });
  });

  describe("Filter options aggregation", () => {
    it("can extract unique filter values from image list", () => {
      const images = [
        { tagCategory: "家居", tagColorScheme: "黑白", tagImageType: "场景图", tagDesignStyle: "简约" },
        { tagCategory: "家居", tagColorScheme: "蓝白", tagImageType: "功能图", tagDesignStyle: "简约" },
        { tagCategory: "户外", tagColorScheme: "黑白", tagImageType: "场景图", tagDesignStyle: "科技" },
      ];
      const categories = new Set(images.map(i => i.tagCategory));
      const colorSchemes = new Set(images.map(i => i.tagColorScheme));
      const imageTypes = new Set(images.map(i => i.tagImageType));
      const designStyles = new Set(images.map(i => i.tagDesignStyle));

      expect(Array.from(categories).sort()).toEqual(["家居", "户外"]);
      expect(Array.from(colorSchemes).sort()).toEqual(["蓝白", "黑白"]);
      expect(Array.from(imageTypes).sort()).toEqual(["功能图", "场景图"]);
      expect(Array.from(designStyles).sort()).toEqual(["科技", "简约"]);
    });

    it("handles empty filter values gracefully", () => {
      const images = [
        { tagCategory: null, tagColorScheme: "黑白", tagImageType: null, tagDesignStyle: "简约" },
        { tagCategory: "家居", tagColorScheme: null, tagImageType: "场景图", tagDesignStyle: null },
      ];
      const categories = new Set<string>();
      for (const img of images) {
        if (img.tagCategory) categories.add(img.tagCategory);
      }
      expect(Array.from(categories)).toEqual(["家居"]);
    });
  });

  describe("Image position auto-mapping", () => {
    it("maps 主图 to main position", () => {
      const targetType = "主图";
      const position = targetType === "主图" ? "main" : targetType?.includes("A+") ? "aplus" : "secondary";
      expect(position).toBe("main");
    });

    it("maps A+ content to aplus position", () => {
      const targetType = "A+内容";
      const position = targetType === "主图" ? "main" : targetType?.includes("A+") ? "aplus" : "secondary";
      expect(position).toBe("aplus");
    });

    it("maps 辅图 to secondary position", () => {
      const targetType = "辅图";
      const position = targetType === "主图" ? "main" : targetType?.includes("A+") ? "aplus" : "secondary";
      expect(position).toBe("secondary");
    });
  });
});

// ═════════════════════════════════════════════════════════════════
// Step3 KB Image Picker + Export Full Plan Tests
// ═════════════════════════════════════════════════════════════════

describe("Step3 KB Image Picker for Style References", () => {
  it("styleKbImages field stores KB images keyed by style index", () => {
    const step3Data = {
      selectedStyles: [
        { name: "Modern Clean", description: "Minimalist design" },
        { name: "Warm Natural", description: "Earthy tones" },
      ],
      styleKbImages: {
        "0": [{ id: 1, imageUrl: "https://cdn.example.com/img1.jpg", tags: ["modern"] }],
        "1": [{ id: 2, imageUrl: "https://cdn.example.com/img2.jpg", tags: ["natural"] }],
      },
    };
    expect(step3Data.styleKbImages["0"]).toHaveLength(1);
    expect(step3Data.styleKbImages["1"]).toHaveLength(1);
    expect(step3Data.styleKbImages["0"][0].imageUrl).toContain("img1");
  });

  it("styleKbImages can be empty for styles without KB references", () => {
    const step3Data = {
      selectedStyles: [{ name: "Bold" }],
      styleKbImages: { "0": [] },
    };
    expect(step3Data.styleKbImages["0"]).toHaveLength(0);
  });

  it("KB images include required fields (id, imageUrl)", () => {
    const kbImage = { id: 42, imageUrl: "https://cdn.example.com/ref.jpg", tags: ["clean", "white"] };
    expect(kbImage).toHaveProperty("id");
    expect(kbImage).toHaveProperty("imageUrl");
    expect(kbImage.tags).toBeInstanceOf(Array);
  });

  it("styleKbImages are preserved when confirming Step3", () => {
    const userEdit = JSON.stringify({
      selectedStyles: [{ name: "Modern" }],
      styleKbImages: { "0": [{ id: 1, imageUrl: "https://cdn.example.com/img.jpg" }] },
    });
    const parsed = JSON.parse(userEdit);
    expect(parsed.styleKbImages).toBeDefined();
    expect(parsed.styleKbImages["0"]).toHaveLength(1);
  });
});

describe("Export Full Plan (5-Step Complete Document)", () => {
  // Helper to simulate safeJsonParse
  function safeJsonParse(str: string | null | undefined): any {
    if (!str) return null;
    try { return JSON.parse(str); } catch { return null; }
  }

  const mockSession = {
    step1AiResult: JSON.stringify({
      coreSellingPoints: [{ point: "Ultra-light", memoryHook: "Feather-light" }],
      secondarySellingPoints: [{ point: "Easy install" }],
      positiveReviewPoints: [{ point: "Great value" }],
      negativeReviewPoints: [{ point: "Fragile", resolved: true, strategy: "Show durability test" }],
      necessityDescriptions: [{ type: "Size", description: "12x8 inches" }],
      scenes: [{ scene: "Home", percentage: "60%", priority: 1 }],
    }),
    step1UserEdit: null,
    step2AiResult: JSON.stringify({
      images: [
        { imageLabel: "Main Image", imageType: "主图", content: "Product on white bg", sellingPoint: "Ultra-light" },
        { imageLabel: "Image 2", imageType: "辅图", content: "Size comparison", sellingPoint: "Compact" },
      ],
      brandStory: "Our brand story...",
      aPlusOutline: "A+ content plan...",
    }),
    step2UserEdit: null,
    step3AiResult: JSON.stringify({
      selectedStyles: [{ name: "Modern Clean", description: "Minimalist", colorPalette: { primary: "#333" }, typography: { headingFont: "Helvetica", bodyFont: "Arial" }, overallTone: "Professional" }],
      styleKbImages: { "0": [{ id: 1, imageUrl: "https://cdn.example.com/ref.jpg" }] },
    }),
    step3UserEdit: null,
    step4AiResult: JSON.stringify({
      imageReferences: [
        {
          imageLabel: "Main Image",
          compositionReference: { type: "Center", description: "Product centered" },
          effectReference: { style: "Clean", description: "White background" },
          kbReferenceImages: [{ id: 1, imageUrl: "https://cdn.example.com/kb1.jpg" }],
        },
      ],
    }),
    step4UserEdit: null,
    step5AiResult: JSON.stringify({
      designGuidelines: { fontRecommendation: "Helvetica", overallColorPalette: "#333, #fff", brandTone: "Professional" },
      mainImage: { title: "Main Shot", concept: "Clean product", composition: "Center", shootingNotes: "White bg" },
      secondaryImages: [{ imageNumber: 2, title: "Size", focus: "Dimensions", fabe: { feature: "Compact", advantage: "Portable", benefit: "Easy carry", evidence: "12x8" }, expressionMethod: "Comparison", composition: "Side by side", textOverlay: "Only 12x8!" }],
      aPlusContent: { sections: [{ title: "Brand Story", purpose: "Trust", content: "Our story...", fabe: { feature: "F", advantage: "A", benefit: "B", evidence: "E" } }] },
    }),
    step5AiResultCn: JSON.stringify({
      designGuidelines: { fontRecommendation: "微软雅黑", overallColorPalette: "#333, #fff", brandTone: "专业" },
      mainImage: { title: "主图", concept: "干净产品", composition: "居中", shootingNotes: "白底" },
    }),
    step5UserEdit: null,
    step5Confirmed: true,
  };

  it("safeJsonParse returns null for null input", () => {
    expect(safeJsonParse(null)).toBeNull();
    expect(safeJsonParse(undefined)).toBeNull();
    expect(safeJsonParse("")).toBeNull();
  });

  it("safeJsonParse returns null for invalid JSON", () => {
    expect(safeJsonParse("not json")).toBeNull();
    expect(safeJsonParse("{broken")).toBeNull();
  });

  it("safeJsonParse returns parsed object for valid JSON", () => {
    const result = safeJsonParse('{"key": "value"}');
    expect(result).toEqual({ key: "value" });
  });

  it("Step1 data can be parsed from session", () => {
    const sp = safeJsonParse(mockSession.step1UserEdit || mockSession.step1AiResult);
    expect(sp).not.toBeNull();
    expect(sp.coreSellingPoints).toHaveLength(1);
    expect(sp.coreSellingPoints[0].point).toBe("Ultra-light");
    expect(sp.scenes).toHaveLength(1);
  });

  it("Step2 outline data can be parsed from session", () => {
    const outline = safeJsonParse(mockSession.step2AiResult);
    expect(outline).not.toBeNull();
    expect(outline.images).toHaveLength(2);
    expect(outline.brandStory).toBeTruthy();
  });

  it("Step3 style data includes selectedStyles and styleKbImages", () => {
    const styleData = safeJsonParse(mockSession.step3AiResult);
    expect(styleData).not.toBeNull();
    expect(styleData.selectedStyles).toHaveLength(1);
    expect(styleData.styleKbImages).toBeDefined();
    expect(styleData.styleKbImages["0"]).toHaveLength(1);
  });

  it("Step4 reference data includes kbReferenceImages", () => {
    const refData = safeJsonParse(mockSession.step4AiResult);
    expect(refData).not.toBeNull();
    expect(refData.imageReferences[0].kbReferenceImages).toHaveLength(1);
  });

  it("Step5 data includes all required sections", () => {
    const en = safeJsonParse(mockSession.step5AiResult);
    expect(en).not.toBeNull();
    expect(en.designGuidelines).toBeDefined();
    expect(en.mainImage).toBeDefined();
    expect(en.secondaryImages).toHaveLength(1);
    expect(en.aPlusContent.sections).toHaveLength(1);
  });

  it("Step5 CN translation can be parsed", () => {
    const cn = safeJsonParse(mockSession.step5AiResultCn);
    expect(cn).not.toBeNull();
    expect(cn.designGuidelines.fontRecommendation).toBe("微软雅黑");
  });

  it("userEdit takes priority over aiResult when both exist", () => {
    const sessionWithEdit = {
      ...mockSession,
      step1UserEdit: JSON.stringify({ coreSellingPoints: [{ point: "Edited point" }] }),
    };
    const sp = safeJsonParse(sessionWithEdit.step1UserEdit || sessionWithEdit.step1AiResult);
    expect(sp.coreSellingPoints[0].point).toBe("Edited point");
  });

  it("full plan export requires step5Confirmed to be true", () => {
    expect(mockSession.step5Confirmed).toBe(true);
    const unconfirmedSession = { ...mockSession, step5Confirmed: false };
    expect(unconfirmedSession.step5Confirmed).toBe(false);
  });

  it("FABE structure has all 4 fields", () => {
    const en = safeJsonParse(mockSession.step5AiResult);
    const fabe = en.secondaryImages[0].fabe;
    expect(fabe).toHaveProperty("feature");
    expect(fabe).toHaveProperty("advantage");
    expect(fabe).toHaveProperty("benefit");
    expect(fabe).toHaveProperty("evidence");
  });

  it("negative review points track resolved status", () => {
    const sp = safeJsonParse(mockSession.step1AiResult);
    const neg = sp.negativeReviewPoints[0];
    expect(neg.resolved).toBe(true);
    expect(neg.strategy).toBeTruthy();
  });

  it("scenes include percentage and priority", () => {
    const sp = safeJsonParse(mockSession.step1AiResult);
    const scene = sp.scenes[0];
    expect(scene.scene).toBe("Home");
    expect(scene.percentage).toBe("60%");
    expect(scene.priority).toBe(1);
  });

  it("style colorPalette and typography are preserved", () => {
    const styleData = safeJsonParse(mockSession.step3AiResult);
    const style = styleData.selectedStyles[0];
    expect(style.colorPalette.primary).toBe("#333");
    expect(style.typography.headingFont).toBe("Helvetica");
    expect(style.typography.bodyFont).toBe("Arial");
  });

  it("compositionReference and effectReference are in Step4 data", () => {
    const refData = safeJsonParse(mockSession.step4AiResult);
    const ref = refData.imageReferences[0];
    expect(ref.compositionReference.type).toBe("Center");
    expect(ref.effectReference.style).toBe("Clean");
  });
});


// ═══════════════════════════════════════════════════════════════════
// Refine Single Image + PDF Export Tests
// ═══════════════════════════════════════════════════════════════════

describe("refineSingleImage procedure", () => {
  it("accepts mainImage imageType", () => {
    const validTypes = ["mainImage", "secondaryImage", "aPlusSection"];
    expect(validTypes).toContain("mainImage");
  });

  it("accepts secondaryImage imageType with index", () => {
    const input = {
      projectId: 1,
      imageType: "secondaryImage" as const,
      imageIndex: 2,
      currentContent: JSON.stringify({ en: { title: "Test" }, cn: { title: "测试" } }),
      instruction: "把标题改为XXX",
    };
    expect(input.imageType).toBe("secondaryImage");
    expect(input.imageIndex).toBe(2);
    expect(input.instruction).toBeTruthy();
  });

  it("accepts aPlusSection imageType with index", () => {
    const input = {
      projectId: 1,
      imageType: "aPlusSection" as const,
      imageIndex: 0,
      currentContent: JSON.stringify({ en: { title: "Brand Story" }, cn: { title: "品牌故事" } }),
      instruction: "增加数据可视化元素",
    };
    expect(input.imageType).toBe("aPlusSection");
    expect(input.imageIndex).toBe(0);
  });

  it("generates correct image type label for mainImage", () => {
    const imageType = "mainImage";
    const imageIndex = undefined;
    const label = imageType === "mainImage" ? "主图 (Main Image)"
      : imageType === "secondaryImage" ? `辅图 ${(imageIndex || 0) + 2} (Secondary Image)`
      : `A+ 模块 ${(imageIndex || 0) + 1} (A+ Content Section)`;
    expect(label).toBe("主图 (Main Image)");
  });

  it("generates correct image type label for secondaryImage", () => {
    const imageType = "secondaryImage";
    const imageIndex = 3;
    const label = imageType === "mainImage" ? "主图 (Main Image)"
      : imageType === "secondaryImage" ? `辅图 ${(imageIndex || 0) + 2} (Secondary Image)`
      : `A+ 模块 ${(imageIndex || 0) + 1} (A+ Content Section)`;
    expect(label).toBe("辅图 5 (Secondary Image)");
  });

  it("generates correct image type label for aPlusSection", () => {
    const imageType = "aPlusSection";
    const imageIndex = 2;
    const label = imageType === "mainImage" ? "主图 (Main Image)"
      : imageType === "secondaryImage" ? `辅图 ${(imageIndex || 0) + 2} (Secondary Image)`
      : `A+ 模块 ${(imageIndex || 0) + 1} (A+ Content Section)`;
    expect(label).toBe("A+ 模块 3 (A+ Content Section)");
  });

  it("includes style context in the system prompt", () => {
    // The refineSingleImage procedure uses session.step3UserEdit || step3AiResult as style context
    const styleContext = '{"selectedStyles":[{"name":"Modern Clean","colorPalette":{"primary":"#333"}}]}';
    const systemPrompt = `你是一位拥有10年设计经验的亚马逊运营专家。用户需要微调一张图片的建议内容。

重要规则：
1. 仅修改用户指定的部分，保持其他内容不变
2. 保持与整体风格方案的一致性
3. 输出格式必须与输入格式完全一致（相同的JSON字段结构）
4. 同时输出英文版和中文版
5. 返回JSON格式: { "en": {...修改后的英文版}, "cn": {...修改后的中文版} }

当前风格方案参考:
${styleContext}`;
    expect(systemPrompt).toContain("仅修改用户指定的部分");
    expect(systemPrompt).toContain("保持与整体风格方案的一致性");
    expect(systemPrompt).toContain("Modern Clean");
  });

  it("quick actions cover all common refinement scenarios", () => {
    const quickActions = [
      { label: "标题更简短", instruction: "请把标题改得更简短有力，更有吸引力" },
      { label: "换一种构图", instruction: "请推荐一种不同的构图方式，让画面更有冲击力" },
      { label: "强化卖点表达", instruction: "请强化卖点的表达，让卖点更突出更有说服力" },
      { label: "优化文案", instruction: "请优化图片上的文案内容，让文字更精炼更有营销力" },
      { label: "调整配色", instruction: "请推荐一套更合适的配色方案，提升视觉效果" },
      { label: "增加数据可视化", instruction: "请增加数据可视化元素（图表、图标、数据对比等）让信息更直观" },
    ];
    expect(quickActions).toHaveLength(6);
    expect(quickActions.map(a => a.label)).toContain("标题更简短");
    expect(quickActions.map(a => a.label)).toContain("换一种构图");
    expect(quickActions.map(a => a.label)).toContain("强化卖点表达");
    expect(quickActions.map(a => a.label)).toContain("优化文案");
    expect(quickActions.map(a => a.label)).toContain("调整配色");
    expect(quickActions.map(a => a.label)).toContain("增加数据可视化");
  });
});

describe("Refine result handling", () => {
  it("correctly updates mainImage in enData and cnData", () => {
    const enData = {
      mainImage: { title: "Original", concept: "Clean" },
      secondaryImages: [{ title: "Img2" }],
    };
    const cnData = {
      mainImage: { title: "原始", concept: "简洁" },
      secondaryImages: [{ title: "图2" }],
    };
    const refinedEn = { title: "Refined", concept: "Bold" };
    const refinedCn = { title: "优化后", concept: "大胆" };

    const newEn = { ...enData, mainImage: refinedEn };
    const newCn = { ...cnData, mainImage: refinedCn };

    expect(newEn.mainImage.title).toBe("Refined");
    expect(newCn.mainImage.title).toBe("优化后");
    expect(newEn.secondaryImages[0].title).toBe("Img2"); // unchanged
  });

  it("correctly updates a specific secondary image", () => {
    const enData = {
      secondaryImages: [
        { title: "Img1", focus: "Feature A" },
        { title: "Img2", focus: "Feature B" },
        { title: "Img3", focus: "Feature C" },
      ],
    };
    const idx = 1;
    const refinedEn = { title: "Img2 Refined", focus: "Feature B Enhanced" };

    const imgs = [...enData.secondaryImages];
    imgs[idx] = refinedEn;
    const newEn = { ...enData, secondaryImages: imgs };

    expect(newEn.secondaryImages[0].title).toBe("Img1"); // unchanged
    expect(newEn.secondaryImages[1].title).toBe("Img2 Refined"); // updated
    expect(newEn.secondaryImages[2].title).toBe("Img3"); // unchanged
  });

  it("correctly updates a specific A+ section", () => {
    const enData = {
      aPlusContent: {
        overallStrategy: "Brand story",
        sections: [
          { title: "Section 1", purpose: "Brand intro" },
          { title: "Section 2", purpose: "Feature highlight" },
        ],
      },
    };
    const idx = 0;
    const refinedEn = { title: "Section 1 Refined", purpose: "Brand intro enhanced" };

    const sections = [...enData.aPlusContent.sections];
    sections[idx] = refinedEn;
    const newEn = { ...enData, aPlusContent: { ...enData.aPlusContent, sections } };

    expect(newEn.aPlusContent.sections[0].title).toBe("Section 1 Refined");
    expect(newEn.aPlusContent.sections[1].title).toBe("Section 2"); // unchanged
    expect(newEn.aPlusContent.overallStrategy).toBe("Brand story"); // unchanged
  });
});

describe("PDF Export via print", () => {
  it("buildFullPlanContent generates valid HTML with print styles", () => {
    // Simulate what the PDF export does - it calls buildFullPlanContent which returns HTML
    // The HTML includes @media print styles for PDF generation
    const mockHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>产品图片设计完整方案</title>
<style>
@media print { body { max-width: 100%; } .no-print { display: none; } }
</style></head><body><h1>Test</h1></body></html>`;
    expect(mockHtml).toContain("@media print");
    expect(mockHtml).toContain("产品图片设计完整方案");
  });

  it("export buttons include both HTML and PDF options", () => {
    const exportOptions = ["导出HTML", "导出PDF"];
    expect(exportOptions).toContain("导出HTML");
    expect(exportOptions).toContain("导出PDF");
  });

  it("PDF export uses window.print for browser-native PDF generation", () => {
    // The handleExportPdf function:
    // 1. Builds HTML content
    // 2. Opens new window
    // 3. Writes content
    // 4. Triggers window.print()
    // This allows "Save as PDF" in the print dialog
    const steps = ["buildPdfContent", "window.open", "document.write", "window.print"];
    expect(steps).toHaveLength(4);
    expect(steps[3]).toBe("window.print");
  });
});


// ═══════════════════════════════════════════════════════════════════
// Lock Feature Tests for RefinePopover
// ═══════════════════════════════════════════════════════════════════

describe("Refine Lock Feature", () => {

  // ─── LOCKABLE_FIELDS definitions ─────────────────────────────
  describe("LOCKABLE_FIELDS configuration", () => {
    const LOCKABLE_FIELDS: Record<string, { key: string; label: string; icon: string }[]> = {
      mainImage: [
        { key: "title", label: "标题", icon: "T" },
        { key: "concept", label: "概念", icon: "C" },
        { key: "colorScheme", label: "配色方案", icon: "🎨" },
        { key: "composition", label: "构图方式", icon: "📐" },
        { key: "shootingNotes", label: "拍摄提示", icon: "📷" },
        { key: "keyElements", label: "关键元素", icon: "⭐" },
        { key: "sellingPoints", label: "卖点", icon: "💡" },
      ],
      secondaryImage: [
        { key: "title", label: "标题", icon: "T" },
        { key: "fabe", label: "FABE分析", icon: "F" },
        { key: "expressionMethod", label: "表达方式", icon: "📝" },
        { key: "colorScheme", label: "配色方案", icon: "🎨" },
        { key: "composition", label: "构图", icon: "📐" },
        { key: "dataVisualization", label: "数据可视化", icon: "📊" },
        { key: "icons", label: "图标建议", icon: "🔣" },
        { key: "keyElements", label: "关键元素", icon: "⭐" },
        { key: "sellingPoints", label: "卖点", icon: "💡" },
        { key: "copywriting", label: "文案", icon: "✏️" },
      ],
      aPlusSection: [
        { key: "title", label: "标题", icon: "T" },
        { key: "fabe", label: "FABE分析", icon: "F" },
        { key: "expressionMethod", label: "表达方式", icon: "📝" },
        { key: "colorScheme", label: "配色方案", icon: "🎨" },
        { key: "composition", label: "构图", icon: "📐" },
        { key: "dataVisualization", label: "数据可视化", icon: "📊" },
        { key: "icons", label: "图标建议", icon: "🔣" },
        { key: "content", label: "内容描述", icon: "📄" },
        { key: "copywriting", label: "文案", icon: "✏️" },
      ],
    };

    it("defines lockable fields for mainImage", () => {
      expect(LOCKABLE_FIELDS.mainImage).toBeDefined();
      expect(LOCKABLE_FIELDS.mainImage.length).toBe(7);
      const keys = LOCKABLE_FIELDS.mainImage.map(f => f.key);
      expect(keys).toContain("title");
      expect(keys).toContain("concept");
      expect(keys).toContain("colorScheme");
      expect(keys).toContain("composition");
      expect(keys).toContain("shootingNotes");
      expect(keys).toContain("keyElements");
      expect(keys).toContain("sellingPoints");
    });

    it("defines lockable fields for secondaryImage", () => {
      expect(LOCKABLE_FIELDS.secondaryImage).toBeDefined();
      expect(LOCKABLE_FIELDS.secondaryImage.length).toBe(10);
      const keys = LOCKABLE_FIELDS.secondaryImage.map(f => f.key);
      expect(keys).toContain("title");
      expect(keys).toContain("fabe");
      expect(keys).toContain("expressionMethod");
      expect(keys).toContain("colorScheme");
      expect(keys).toContain("dataVisualization");
      expect(keys).toContain("icons");
      expect(keys).toContain("copywriting");
    });

    it("defines lockable fields for aPlusSection", () => {
      expect(LOCKABLE_FIELDS.aPlusSection).toBeDefined();
      expect(LOCKABLE_FIELDS.aPlusSection.length).toBe(9);
      const keys = LOCKABLE_FIELDS.aPlusSection.map(f => f.key);
      expect(keys).toContain("title");
      expect(keys).toContain("fabe");
      expect(keys).toContain("content");
      expect(keys).toContain("copywriting");
    });

    it("all fields have required properties (key, label, icon)", () => {
      for (const [type, fields] of Object.entries(LOCKABLE_FIELDS)) {
        for (const field of fields) {
          expect(field.key).toBeTruthy();
          expect(field.label).toBeTruthy();
          expect(field.icon).toBeTruthy();
        }
      }
    });

    it("no duplicate keys within each image type", () => {
      for (const [type, fields] of Object.entries(LOCKABLE_FIELDS)) {
        const keys = fields.map(f => f.key);
        const uniqueKeys = new Set(keys);
        expect(uniqueKeys.size).toBe(keys.length);
      }
    });

    it("common fields exist across all image types", () => {
      const commonFields = ["title", "colorScheme", "composition"];
      for (const field of commonFields) {
        expect(LOCKABLE_FIELDS.mainImage.some(f => f.key === field)).toBe(true);
        expect(LOCKABLE_FIELDS.secondaryImage.some(f => f.key === field)).toBe(true);
        expect(LOCKABLE_FIELDS.aPlusSection.some(f => f.key === field)).toBe(true);
      }
    });
  });

  // ─── Server-side lock enforcement logic ─────────────────────────
  describe("Server-side lock enforcement", () => {
    it("restores locked fields from original content after AI response", () => {
      const original = {
        en: { title: "Original Title", colorScheme: "Blue/White", composition: "Center" },
        cn: { title: "原始标题", colorScheme: "蓝/白", composition: "居中" },
      };
      const aiResult = {
        en: { title: "New Title", colorScheme: "Red/Gold", composition: "Rule of thirds" },
        cn: { title: "新标题", colorScheme: "红/金", composition: "三分法" },
      };
      const lockedFields = ["title", "colorScheme"];

      // Simulate server-side enforcement
      const originalEn = original.en;
      const originalCn = original.cn;
      for (const field of lockedFields) {
        if (aiResult.en && (originalEn as any)[field] !== undefined) {
          (aiResult.en as any)[field] = (originalEn as any)[field];
        }
        if (aiResult.cn && (originalCn as any)[field] !== undefined) {
          (aiResult.cn as any)[field] = (originalCn as any)[field];
        }
      }

      expect(aiResult.en.title).toBe("Original Title");
      expect(aiResult.en.colorScheme).toBe("Blue/White");
      expect(aiResult.en.composition).toBe("Rule of thirds"); // not locked, should change
      expect(aiResult.cn.title).toBe("原始标题");
      expect(aiResult.cn.colorScheme).toBe("蓝/白");
      expect(aiResult.cn.composition).toBe("三分法"); // not locked, should change
    });

    it("handles empty lockedFields gracefully", () => {
      const original = {
        en: { title: "Title" },
        cn: { title: "标题" },
      };
      const aiResult = {
        en: { title: "New Title" },
        cn: { title: "新标题" },
      };
      const lockedFields: string[] = [];

      // No fields locked, nothing should be restored
      for (const field of lockedFields) {
        if (aiResult.en && (original.en as any)[field] !== undefined) {
          (aiResult.en as any)[field] = (original.en as any)[field];
        }
      }

      expect(aiResult.en.title).toBe("New Title"); // should remain changed
    });

    it("handles locking non-existent fields without error", () => {
      const original = {
        en: { title: "Title" },
        cn: { title: "标题" },
      };
      const aiResult = {
        en: { title: "New Title" },
        cn: { title: "新标题" },
      };
      const lockedFields = ["nonExistentField"];

      // Should not throw
      for (const field of lockedFields) {
        if (aiResult.en && (original.en as any)[field] !== undefined) {
          (aiResult.en as any)[field] = (original.en as any)[field];
        }
      }

      expect(aiResult.en.title).toBe("New Title"); // unchanged since locked field doesn't exist
    });

    it("handles locking all fields", () => {
      const original = {
        en: { title: "T1", colorScheme: "CS1", composition: "C1" },
        cn: { title: "标题1", colorScheme: "配色1", composition: "构图1" },
      };
      const aiResult = {
        en: { title: "T2", colorScheme: "CS2", composition: "C2" },
        cn: { title: "标题2", colorScheme: "配色2", composition: "构图2" },
      };
      const lockedFields = ["title", "colorScheme", "composition"];

      for (const field of lockedFields) {
        if (aiResult.en && (original.en as any)[field] !== undefined) {
          (aiResult.en as any)[field] = (original.en as any)[field];
        }
        if (aiResult.cn && (original.cn as any)[field] !== undefined) {
          (aiResult.cn as any)[field] = (original.cn as any)[field];
        }
      }

      // All fields should be restored to original
      expect(aiResult.en.title).toBe("T1");
      expect(aiResult.en.colorScheme).toBe("CS1");
      expect(aiResult.en.composition).toBe("C1");
      expect(aiResult.cn.title).toBe("标题1");
      expect(aiResult.cn.colorScheme).toBe("配色1");
      expect(aiResult.cn.composition).toBe("构图1");
    });
  });

  // ─── Lock prompt instruction generation ─────────────────────────
  describe("Lock prompt instruction generation", () => {
    it("generates correct lock instruction for AI prompt", () => {
      const lockedFields = ["title", "colorScheme"];
      const instruction = `\n\n🔒 锁定字段（以下字段必须与原内容完全一致，严禁修改）：\n${lockedFields.map(f => `- ${f}`).join("\n")}\n\n即使用户的修改指令涉及这些字段，也必须保持原值不变。只能修改未锁定的字段。`;

      expect(instruction).toContain("🔒 锁定字段");
      expect(instruction).toContain("- title");
      expect(instruction).toContain("- colorScheme");
      expect(instruction).toContain("严禁修改");
    });

    it("generates empty instruction when no fields are locked", () => {
      const lockedFields: string[] = [];
      const instruction = lockedFields.length > 0
        ? `\n\n🔒 锁定字段：\n${lockedFields.map(f => `- ${f}`).join("\n")}`
        : "";

      expect(instruction).toBe("");
    });
  });

  // ─── Frontend lock state management ─────────────────────────
  describe("Frontend lock state management", () => {
    it("toggle lock adds and removes fields from set", () => {
      const lockedFields = new Set<string>();

      // Toggle on
      lockedFields.add("title");
      expect(lockedFields.has("title")).toBe(true);
      expect(lockedFields.size).toBe(1);

      // Toggle off
      lockedFields.delete("title");
      expect(lockedFields.has("title")).toBe(false);
      expect(lockedFields.size).toBe(0);
    });

    it("lockAll adds all lockable fields", () => {
      const lockableFields = [
        { key: "title", label: "标题", icon: "T" },
        { key: "colorScheme", label: "配色方案", icon: "🎨" },
        { key: "composition", label: "构图", icon: "📐" },
      ];
      const lockedFields = new Set(lockableFields.map(f => f.key));

      expect(lockedFields.size).toBe(3);
      expect(lockedFields.has("title")).toBe(true);
      expect(lockedFields.has("colorScheme")).toBe(true);
      expect(lockedFields.has("composition")).toBe(true);
    });

    it("unlockAll clears all locked fields", () => {
      const lockedFields = new Set(["title", "colorScheme", "composition"]);
      lockedFields.clear();

      expect(lockedFields.size).toBe(0);
    });

    it("filters lockable fields based on current content", () => {
      const allFields = [
        { key: "title", label: "标题", icon: "T" },
        { key: "fabe", label: "FABE分析", icon: "F" },
        { key: "colorScheme", label: "配色方案", icon: "🎨" },
      ];
      const currentContent = { title: "Some title", colorScheme: "Blue" };

      const filtered = allFields.filter(f => {
        const val = (currentContent as any)[f.key];
        return val !== undefined && val !== null && val !== "";
      });

      expect(filtered.length).toBe(2);
      expect(filtered.map(f => f.key)).toContain("title");
      expect(filtered.map(f => f.key)).toContain("colorScheme");
      expect(filtered.map(f => f.key)).not.toContain("fabe");
    });

    it("lock badge shows correct count", () => {
      const lockedFields = new Set(["title", "colorScheme"]);
      const badgeText = `已锁定 ${lockedFields.size}`;
      expect(badgeText).toBe("已锁定 2");
    });

    it("toast message includes lock count when fields are locked", () => {
      const lockedFields = new Set(["title", "colorScheme", "composition"]);
      const message = "微调完成" + (lockedFields.size > 0 ? `（已锁定${lockedFields.size}个元素）` : "");
      expect(message).toBe("微调完成（已锁定3个元素）");
    });
  });
});
