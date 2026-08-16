import { describe, expect, it } from "vitest";
import { buildImageWorkflowReferenceTargets, normalizeImageOutline, normalizeStep4References } from "../shared/imageWorkflow";

describe("场景备注驱动的A+子图验收", () => {
  it("将4种场景拆为A+ 1.1至1.4，并逐图保留场景主题", () => {
    const outline = normalizeImageOutline({
      aPlusModules: [{ moduleNumber: 1, selectedModuleType: "premium_rule_carousel", subModuleRemark: "4种场景：车库、庭院、露营、工地" }],
    });
    const targets = buildImageWorkflowReferenceTargets(outline)
      .filter((target) => target.parentModuleNumber === 1);

    expect(targets.map((target) => target.imageType)).toEqual(["A+模块 1.1", "A+模块 1.2", "A+模块 1.3", "A+模块 1.4"]);
    expect(targets.map((target) => target.subModuleTopic)).toEqual(["车库", "庭院", "露营", "工地"]);
    expect(targets.every((target) => target.subModuleRemark === "4种场景：车库、庭院、露营、工地")).toBe(true);
  });

  it("将品牌故事纳入参考图和图片建议共用的独立下游目标", () => {
    const targets = buildImageWorkflowReferenceTargets({
      aPlusModules: [],
      brandStory: { purpose: "讲述品牌使命与用户承诺" },
    });
    expect(targets).toEqual(expect.arrayContaining([
      expect.objectContaining({ imageKey: "brand-story", imageType: "品牌故事", isBrandStory: true }),
    ]));
  });

  it("将历史A+模块重新编号为1至7，并将品牌故事从模块序列中剥离", () => {
    const outline = normalizeImageOutline({
      aPlusModules: [
        ...Array.from({ length: 7 }, (_, index) => ({ moduleNumber: index + 8, title: `模块${index + 8}`, selectedModuleType: "premium_full_image" })),
        { moduleNumber: 15, title: "品牌故事", purpose: "品牌价值" },
      ],
    });
    expect(outline.aPlusModules.map((module: any) => module.moduleNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(outline.brandStory).toEqual(expect.objectContaining({ title: "品牌故事", purpose: "品牌价值" }));
    expect(buildImageWorkflowReferenceTargets(outline).filter((target) => target.imageType.startsWith("A+模块 ")).map((target) => target.parentModuleNumber)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("将历史参考图的8至13及4.1标签按显示顺序重排为A+ 1至7，并保持品牌故事独立", () => {
    const normalized = normalizeStep4References({
      imageReferences: [
        ...[8, 9, 10, 11, 12, 13].map((number) => ({ imageType: `A+模块 ${number}` })),
        { imageType: "A+模块 4.1" },
        { imageType: "品牌故事" },
      ],
    });
    expect(normalized?.imageReferences.map((ref: any) => ref.imageType)).toEqual([
      "A+模块 1", "A+模块 2", "A+模块 3", "A+模块 4", "A+模块 5", "A+模块 6", "A+模块 7.1", "品牌故事",
    ]);
  });
});
