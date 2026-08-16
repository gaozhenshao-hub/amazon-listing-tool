import { describe, expect, it } from "vitest";
import { buildImageWorkflowReferenceTargets, normalizeImageOutline } from "../shared/imageWorkflow";

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
});
