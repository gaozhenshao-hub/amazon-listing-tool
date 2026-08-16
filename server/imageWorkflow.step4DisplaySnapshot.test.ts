import { describe, expect, it } from "vitest";
import { rebuildStep4DisplaySnapshot } from "./domains/image/routers/sessions";

describe("Step4参考图显示快照重建", () => {
  it("按当前大纲保留连续A+编号，并为遗漏的品牌故事回填可编辑参考内容", () => {
    const session = {
      step2AiResult: JSON.stringify({
        mainImage: { purpose: "主图" },
        secondaryImages: [{ imageNumber: 2, purpose: "辅图" }],
        aPlusModules: [
          { moduleNumber: 1, purpose: "A+一" },
          { moduleNumber: 2, purpose: "A+二" },
        ],
        brandStory: { purpose: "品牌故事使命" },
      }),
    };
    const snapshot = {
      imageReferences: [
        { imageType: "主图", purpose: "主图参考" },
        { imageType: "辅图2", purpose: "辅图参考" },
        { imageType: "A+模块 8", purpose: "历史A+一" },
        { imageType: "A+模块 9", purpose: "历史A+二" },
      ],
    };

    const rebuilt = rebuildStep4DisplaySnapshot(session, snapshot);
    expect(rebuilt.imageReferences.map((item: any) => item.imageType)).toEqual([
      "主图", "辅图2", "辅图3", "辅图4", "辅图5", "辅图6", "辅图7", "A+模块 1", "A+模块 2", "品牌故事",
    ]);
    expect(rebuilt.imageReferences[7]).toMatchObject({ imageKey: "aplus-1", purpose: "历史A+一" });
    expect(rebuilt.imageReferences[8]).toMatchObject({ imageKey: "aplus-2", purpose: "历史A+二" });
    expect(rebuilt.imageReferences[9]).toMatchObject({
      imageKey: "brand-story",
      isBrandStory: true,
      isBackfilledFromOutline: true,
      purpose: "品牌故事使命",
    });
    expect(rebuilt.imageReferences[9].compositionReference).toBeTruthy();
    expect(rebuilt.imageReferences[9].effectReference).toBeTruthy();
  });

  it("将历史A+参考条目按当前多图模块目标重新赋予父模块、子图和imageKey", () => {
    const session = {
      step2AiResult: JSON.stringify({
        mainImage: { purpose: "主图" },
        secondaryImages: [{ imageNumber: 2, purpose: "辅图" }],
        aPlusModules: [
          {
            moduleNumber: 1,
            purpose: "四场景展示",
            subModules: [
              { subModuleNumber: 1, title: "车库" },
              { subModuleNumber: 2, title: "庭院" },
              { subModuleNumber: 3, title: "露营" },
              { subModuleNumber: 4, title: "工地" },
            ],
          },
          { moduleNumber: 2, purpose: "单图模块" },
        ],
        brandStory: { purpose: "品牌故事使命" },
      }),
    };
    const snapshot = {
      imageReferences: [
        { imageType: "主图", purpose: "主图参考" },
        { imageType: "辅图", imageNumber: 2, purpose: "辅图参考" },
        { imageType: "A+模块", imageNumber: 8, purpose: "历史子图一" },
        { imageType: "A+模块", imageNumber: 9, purpose: "历史子图二" },
        { imageType: "A+模块", imageNumber: 10, purpose: "历史子图三" },
        { imageType: "A+模块", imageNumber: 11, purpose: "历史子图四" },
        { imageType: "A+模块", imageNumber: 12, purpose: "历史模块二" },
      ],
    };

    const rebuilt = rebuildStep4DisplaySnapshot(session, snapshot);
    const aplus = rebuilt.imageReferences.filter((item: any) => /^A\+模块/.test(item.imageType));
    expect(aplus.map((item: any) => [item.imageKey, item.parentModuleNumber, item.subModuleNumber, item.imageType])).toEqual([
      ["aplus-1.1", 1, 1, "A+模块 1.1"],
      ["aplus-1.2", 1, 2, "A+模块 1.2"],
      ["aplus-1.3", 1, 3, "A+模块 1.3"],
      ["aplus-1.4", 1, 4, "A+模块 1.4"],
      ["aplus-2", 2, null, "A+模块 2"],
    ]);
    expect(rebuilt.imageReferences.at(-1)).toMatchObject({ imageKey: "brand-story", imageType: "品牌故事", isBrandStory: true });
  });
});
