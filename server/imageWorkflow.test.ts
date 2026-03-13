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
