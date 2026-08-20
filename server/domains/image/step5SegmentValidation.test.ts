import { describe, expect, it } from "vitest";
import { findIncompleteStep5Segment } from "./step5SegmentValidation";

const completeInput = {
  mainSegment: {
    mainImage: {
      concept: "主图概念",
      composition: "主图构图",
      primary: "主视觉",
      shooting: "拍摄说明",
    },
  },
  secondarySegment: {
    secondaryImages: Array.from({ length: 6 }, () => ({
      focus: "卖点焦点",
      expression: "表达方式",
      composition: "画面构图",
      textOverlay: "图中文字",
    })),
  },
  aplusModules: Array.from({ length: 7 }, (_, index) => ({ moduleNumber: index + 1 })),
  outlineAplusModules: Array.from({ length: 7 }, (_, index) => ({ moduleNumber: index + 1 })),
  requiresBrandStory: true,
  brandStory: { title: "品牌故事" },
};

describe("Step5分段完整性校验", () => {
  it("为主图、辅图、A+ 7和品牌故事缺失返回明确定位", () => {
    expect(findIncompleteStep5Segment({ ...completeInput, mainSegment: {} })).toEqual({ group: "main", module: null });
    expect(findIncompleteStep5Segment({ ...completeInput, secondarySegment: { secondaryImages: [] } })).toEqual({ group: "secondary", module: null });
    expect(findIncompleteStep5Segment({ ...completeInput, aplusModules: completeInput.aplusModules.slice(0, 6) })).toEqual({ group: "aplus", module: "A+ 7" });
    expect(findIncompleteStep5Segment({ ...completeInput, brandStory: null })).toEqual({ group: "brand_story", module: "品牌故事" });
  });

  it("在所有分段完整时不触发失败定位", () => {
    expect(findIncompleteStep5Segment(completeInput)).toBeNull();
  });
});
