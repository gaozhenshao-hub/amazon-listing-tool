import { describe, expect, it } from "vitest";
import { validateStep4ReferenceResult } from "./domains/image/services/step4ReferenceJob";

const targets = [
  { imageKey: "mainImage", imageNumber: 1, imageType: "主图", purpose: "展示产品" },
  { imageKey: "secondary-2", imageNumber: 2, imageType: "辅图2", purpose: "展示卖点" },
  { imageKey: "aplus-5-1", imageNumber: 0, imageType: "A+模块 5.1", parentModuleNumber: 5, subModuleNumber: 1, purpose: "车库场景" },
  { imageKey: "aplus-5-2", imageNumber: 0, imageType: "A+模块 5.2", parentModuleNumber: 5, subModuleNumber: 2, purpose: "庭院场景" },
  { imageKey: "brand-story", imageNumber: 0, imageType: "品牌故事", purpose: "品牌价值" },
];

describe("Step4参考图缺项恢复", () => {
  it("保留模型有效项并按当前目标补齐缺失场景子图与品牌故事", () => {
    const result = validateStep4ReferenceResult({
      imageReferences: [
        { imageKey: "mainImage", imageType: "主图", imageNumber: 1, compositionReference: { layout: "模型主图布局" } },
        { imageKey: "aplus-5-1", imageType: "A+模块 5.1", parentModuleNumber: 5, subModuleNumber: 1, compositionReference: { layout: "车库布局" } },
      ],
    }, targets);

    expect(result.imageReferences).toHaveLength(5);
    expect(result.imageReferences[0].compositionReference.layout).toBe("模型主图布局");
    expect(result.imageReferences[1].imageNumber).toBe(2);
    expect(result.imageReferences[1].isBackfilledFromOutline).toBe(true);
    expect(result.imageReferences[2].compositionReference.layout).toBe("车库布局");
    expect(result.imageReferences[3].parentModuleNumber).toBe(5);
    expect(result.imageReferences[3].subModuleNumber).toBe(2);
    expect(result.imageReferences[4].imageType).toBe("品牌故事");
  });

  it("在皇帝输出完全不可用时按当前大纲生成每个目标的可编辑基础参考", () => {
    const result = validateStep4ReferenceResult({ imageReferences: [] }, targets);

    expect(result.imageReferences).toHaveLength(targets.length);
    expect(result.imageReferences.map((reference: any) => reference.imageKey)).toEqual(targets.map((target) => target.imageKey));
    expect(result.imageReferences.every((reference: any) => reference.isBackfilledFromOutline)).toBe(true);
  });
});
