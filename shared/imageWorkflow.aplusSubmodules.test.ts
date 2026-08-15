import { buildImageWorkflowReferenceTargets, normalizeImageOutline } from "./imageWorkflow";

describe("多图A+模块逐图目标", () => {
  it("将四图和轮播模块展开为独立的A+子图参考目标", () => {
    const outline = normalizeImageOutline({
      secondaryImages: [2, 3, 4, 5, 6, 7].map((imageNumber) => ({ imageNumber, purpose: `辅图${imageNumber}` })),
      aPlusModules: [
        { moduleNumber: 8, selectedModuleType: "premium_four_image_text" },
        { moduleNumber: 9, selectedModuleType: "premium_rule_carousel" },
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
  });
});
