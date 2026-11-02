import { describe, expect, it } from "vitest";
import { rebuildStep4DisplaySnapshot } from "./domains/image/routers/sessions";
import { enrichStep5AplusSubmodules } from "./domains/image/step5AplusSubmodules";

describe("Step4参考图与Step5图片建议映射", () => {
  it("对多图A+子模块和品牌故事保留同一组稳定参考图键", () => {
    const outline = {
      mainImage: { purpose: "主图" },
      aPlusModules: [
        {
          moduleNumber: 1,
          purpose: "场景模块",
          subModules: [
            { subModuleNumber: 1, title: "车库", purpose: "车库场景" },
            { subModuleNumber: 2, title: "庭院", purpose: "庭院场景" },
          ],
        },
        { moduleNumber: 2, purpose: "单图模块" },
      ],
      brandStory: { purpose: "品牌使命" },
    };
    const step4 = rebuildStep4DisplaySnapshot(
      { step2AiResult: JSON.stringify(outline) },
      {
        imageReferences: [
          { imageType: "主图", purpose: "主图" },
          { imageType: "A+模块", purpose: "车库参考" },
          { imageType: "A+模块", purpose: "庭院参考" },
          { imageType: "A+模块", purpose: "模块二参考" },
        ],
      },
    );
    const step5 = enrichStep5AplusSubmodules({
      result: {
        aPlusModules: [
          { moduleNumber: 1, title: "场景模块", subModules: [{ subModuleNumber: 1 }, { subModuleNumber: 2 }] },
          { moduleNumber: 2, title: "单图模块" },
        ],
        brandStory: { title: "品牌故事" },
      },
      outline,
      step4Snapshot: step4,
    });

    expect(step4.imageReferences.filter((item: any) => /^A\+模块/.test(item.imageType)).map((item: any) => item.imageKey)).toEqual(["aplus-1.1", "aplus-1.2", "aplus-2"]);
    expect(step5.aPlusModules[0].subModules.map((item: any) => item.referenceImageKey)).toEqual(["aplus-1.1", "aplus-1.2"]);
    expect(step5.aPlusModules[1].referenceImageKey).toBe("aplus-2");
    expect(step4.imageReferences.find((item: any) => item.imageKey === "brand-story")?.imageType).toBe("品牌故事");
    expect(step5.brandStory.referenceImageKey).toBe("brand-story");
  });
});
