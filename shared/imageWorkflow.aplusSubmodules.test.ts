import { buildImageWorkflowReferenceTargets, normalizeImageOutline } from "./imageWorkflow";

describe("多图A+模块逐图目标", () => {
  it("将四图和轮播模块展开为独立的A+子图参考目标", () => {
    const outline = normalizeImageOutline({
      secondaryImages: [2, 3, 4, 5, 6, 7].map((imageNumber) => ({ imageNumber, purpose: `辅图${imageNumber}` })),
      aPlusModules: [
        { moduleNumber: 8, selectedModuleType: "premium_four_image_text" },
        { moduleNumber: 9, selectedModuleType: "premium_rule_carousel", subModuleRemark: "4种场景：车库、庭院、露营、工地" },
      ],
    });
    const targets = buildImageWorkflowReferenceTargets(outline);
    expect(targets.map((target) => target.imageType)).toContain("A+模块 8.1");
    expect(targets.map((target) => target.imageType)).toContain("A+模块 8.4");
    expect(targets.map((target) => target.imageType)).toContain("A+模块 9.1");
    expect(targets.find((target) => target.imageKey === "aplus-8.1")).toMatchObject({
      parentModuleNumber: 8,
      subModuleNumber: 1,
    });
    expect(targets.find((target) => target.imageKey === "aplus-9.1")).toMatchObject({
      subModuleRemark: "4种场景：车库、庭院、露营、工地",
      subModuleTopic: "车库",
      subModuleCount: 4,
    });
  });

  it("把4种场景备注归一化为A+ 1.1至1.4，并逐项保留场景主题", () => {
    const outline = normalizeImageOutline({
      aPlusModules: [{ moduleNumber: 1, selectedModuleType: "premium_rule_carousel", subModuleRemark: "4种场景：车库、庭院、露营、工地" }],
    });
    const targets = buildImageWorkflowReferenceTargets(outline)
      .filter((target) => target.parentModuleNumber === 1);
    expect(targets).toHaveLength(4);
    expect(targets.map((target) => target.imageType)).toEqual(["A+模块 1.1", "A+模块 1.2", "A+模块 1.3", "A+模块 1.4"]);
    expect(targets.map((target) => target.subModuleTopic)).toEqual(["车库", "庭院", "露营", "工地"]);
  });
});
