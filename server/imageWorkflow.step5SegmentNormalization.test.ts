import { describe, expect, it } from "vitest";
import {
  normalizeStep5MainSegment,
  normalizeStep5SecondarySegment,
} from "./domains/image/routerContext";
import { findIncompleteStep5Segment } from "./domains/image/step5SegmentValidation";

describe("Step5分段结果归一化", () => {
  const rawMainSegment = {
    mainImage: {
      imageType: "主图",
      purpose: "展示41件套系统的高质感与完整性",
      layout: {
        composition: "白底三角形陈列构图",
        focalPoint: "前景核心金属分流块",
        visualFlow: "由核心分流块向四周配件扩散",
      },
      elements: {
        product: "蓝色管材、分流块、接头和工具完整陈列",
        props: "无外部道具",
        badges: "无图标和徽章",
      },
      visualStyle: {
        background: "纯白背景",
        colorPalette: "工具蓝与金属银",
        lighting: "明亮棚拍顶侧光",
        tone: "专业高端",
      },
      designNotes: "金属质感真实且秩序清晰",
    },
  };

  const rawSecondarySegment = {
    secondaryImages: Array.from({ length: 6 }, (_, index) => ({
      imageNumber: index + 2,
      imageType: `辅图${index + 2}`,
      purpose: `说明辅图${index + 2}的核心卖点`,
      compositionReference: {
        compositionType: "局部放大构图",
        focalPoint: `辅图${index + 2}关键结构`,
        layout: `辅图${index + 2}左图右文布局`,
        visualFlow: "标题到结构再到使用提示",
      },
      effectReference: {
        colorApplication: "工业蓝与警示橙",
        lightingStyle: "局部聚光",
        atmosphere: "专业可靠",
        typographyApplication: "粗体参数标签",
      },
      designNotes: "突出易读性和核心参数",
    })),
  };

  it("将生产Step4原始主图参考字段归一化为前台可编辑字段", () => {
    const normalized = normalizeStep5MainSegment(rawMainSegment);
    expect(normalized.mainImage).toMatchObject({
      concept: "展示41件套系统的高质感与完整性",
      composition: "白底三角形陈列构图",
      primary: "蓝色管材、分流块、接头和工具完整陈列",
      shooting: expect.stringContaining("明亮棚拍顶侧光"),
    });
  });

  it("将生产Step4原始辅图参考字段归一化为前台可编辑字段", () => {
    const normalized = normalizeStep5SecondarySegment(rawSecondarySegment);
    expect(normalized.secondaryImages).toHaveLength(6);
    expect(normalized.secondaryImages[0]).toMatchObject({
      focus: "说明辅图2的核心卖点",
      expression: "局部放大构图",
      composition: "辅图2左图右文布局",
      textOverlay: "粗体参数标签",
    });
  });

  it("拒绝未归一化的原始参考结构，并接受归一化后的完整分段", () => {
    expect(findIncompleteStep5Segment({
      mainSegment: rawMainSegment,
      secondarySegment: rawSecondarySegment,
      aplusModules: [],
      outlineAplusModules: [],
      requiresBrandStory: false,
      brandStory: null,
    })?.group).toBe("main");

    expect(findIncompleteStep5Segment({
      mainSegment: normalizeStep5MainSegment(rawMainSegment),
      secondarySegment: normalizeStep5SecondarySegment(rawSecondarySegment),
      aplusModules: [],
      outlineAplusModules: [],
      requiresBrandStory: false,
      brandStory: null,
    })).toBeNull();
  });
});
