import { describe, expect, it } from "vitest";
import { preserveHistoricalStep4ReferencesOnFallback } from "./domains/image/services/step4ReferenceJob";

describe("Step4历史参考图失败回退", () => {
  it("基础回填出现时保留历史可编辑构图、效果与本地参考资产", () => {
    const historical = {
      imageReferences: [{
        imageKey: "aplus-5.1",
        imageType: "A+模块 5.1",
        imageNumber: 0,
        parentModuleNumber: 5,
        subModuleNumber: 1,
        designNotes: "历史车库方案，可继续编辑",
        compositionReference: { layout: "历史车库构图", focalPoint: "蓝色气路" },
        effectReference: { colorApplication: "历史蓝灰配色", visualMood: "专业车间" },
        compositionRefImageUrl: "https://example.com/garage-reference.jpg",
        compositionRefNote: "保留车库背景色",
      }],
    };
    const fallback = {
      imageReferences: [{
        imageKey: "aplus-5.1",
        imageType: "A+模块 5.1",
        imageNumber: 0,
        parentModuleNumber: 5,
        subModuleNumber: 1,
        designNotes: "系统基础回填方案",
        compositionReference: { layout: "基础构图" },
        effectReference: { colorApplication: "基础配色" },
        isBackfilledFromOutline: true,
      }],
    };

    const recovered = preserveHistoricalStep4ReferencesOnFallback(historical, fallback);
    expect(recovered.imageReferences[0]).toMatchObject({
      imageKey: "aplus-5.1",
      imageType: "A+模块 5.1",
      parentModuleNumber: 5,
      subModuleNumber: 1,
      designNotes: "历史车库方案，可继续编辑",
      compositionReference: { layout: "历史车库构图" },
      effectReference: { colorApplication: "历史蓝灰配色" },
      compositionRefImageUrl: "https://example.com/garage-reference.jpg",
      compositionRefNote: "保留车库背景色",
    });
  });

  it("完整Skill结果不回退时不覆盖新的AI参考方案", () => {
    const historical = { imageReferences: [{ imageKey: "secondary-2", designNotes: "旧方案" }] };
    const latest = { imageReferences: [{ imageKey: "secondary-2", designNotes: "新AI方案", isBackfilledFromOutline: false }] };

    expect(preserveHistoricalStep4ReferencesOnFallback(historical, latest)).toBe(latest);
  });
});
