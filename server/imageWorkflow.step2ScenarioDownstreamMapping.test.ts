import { describe, expect, it } from "vitest";
import {
  buildImageWorkflowReferenceTargets,
  normalizeImageOutline,
} from "../shared/imageWorkflow";

describe("Step2场景备注下游映射", () => {
  it("将四种场景备注完整传递到Step4/Step5共用子图目标", () => {
    const outline = normalizeImageOutline({
      aPlusModules: [
        { moduleNumber: 1, selectedModuleType: "premium_full_image", title: "单图" },
        { moduleNumber: 2, selectedModuleType: "premium_full_image", title: "单图" },
        { moduleNumber: 3, selectedModuleType: "premium_full_image", title: "单图" },
        { moduleNumber: 4, selectedModuleType: "premium_full_image", title: "单图" },
        {
          moduleNumber: 5,
          selectedModuleType: "premium_nav_carousel",
          title: "场景模块",
          subModuleRemark: "4种场景：车库、庭院、露营、工地",
          subModuleCount: 4,
        },
      ],
      brandStory: { title: "品牌故事" },
    });

    const targets = buildImageWorkflowReferenceTargets(outline);
    const scenarioTargets = targets.filter((target) => target.parentModuleNumber === 5);

    expect(scenarioTargets.map((target) => target.imageKey)).toEqual([
      "aplus-5.1",
      "aplus-5.2",
      "aplus-5.3",
      "aplus-5.4",
    ]);
    expect(scenarioTargets.map((target) => target.subModuleTopic)).toEqual([
      "车库",
      "庭院",
      "露营",
      "工地",
    ]);
    expect(scenarioTargets.every((target) => target.subModuleRemark === "4种场景：车库、庭院、露营、工地")).toBe(true);
    expect(targets.some((target) => target.imageKey === "brand-story")).toBe(true);
  });
});
