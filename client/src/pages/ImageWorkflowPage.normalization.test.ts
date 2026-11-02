import { describe, expect, it } from "vitest";
import { hasDisplayableColorScheme, normalizeFinalImageSuggestions } from "./ImageWorkflowPage";

describe("Step5最终人审字段归一化", () => {
  it("将分段回退的主图shooting和辅图expression映射为前台展示字段", () => {
    const result = normalizeFinalImageSuggestions({
      mainImage: { title: "主图", concept: "核心概念", composition: "居中", shooting: "白底高清拍摄", primary: "产品全貌" },
      secondaryImages: [{ imageNumber: 2, title: "辅图", focus: "密封", expression: "原理展示", composition: "剖面", primary: "O型圈", secondary: "PTFE胶带", accent: "零泄漏" }],
    });

    expect(result.mainImage.shootingNotes).toBe("白底高清拍摄");
    expect(result.secondaryImages[0].expressionMethod).toBe("原理展示");
    expect(result.secondaryImages[0]).toMatchObject({ primary: "O型圈", secondary: "PTFE胶带", accent: "零泄漏" });
  });

  it("仅将真实配色渲染为色卡，空色卡应改为展示具体视觉要素", () => {
    expect(hasDisplayableColorScheme({ primary: "", secondary: "", accent: "" })).toBe(false);
    expect(hasDisplayableColorScheme({ primary: "#0B5FFF", secondary: "", accent: "" })).toBe(true);
  });

  it("为历史安全回退的设计指南与A+整体内容即时补齐可编辑显示字段", () => {
    const result = normalizeFinalImageSuggestions({
      designGuidelines: { visualTone: "工业专业风格", note: "安全回退" },
      aPlusContent: { sections: [{ moduleNumber: 1, title: "零泄漏", purpose: "建立密封信任" }] },
    });

    expect(result.designGuidelines).toMatchObject({
      fontRecommendation: expect.any(String),
      overallColorPalette: expect.any(String),
      brandTone: "工业专业风格",
      mobileOptimization: expect.any(String),
    });
    expect(result.aPlusContent).toMatchObject({
      overallStrategy: expect.stringContaining("零泄漏"),
      overallStory: expect.stringContaining("建立密封信任"),
      consistency: expect.any(String),
      modularDesign: expect.any(String),
    });
  });
});
