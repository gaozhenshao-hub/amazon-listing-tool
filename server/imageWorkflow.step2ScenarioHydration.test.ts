import { describe, expect, it } from "vitest";
import { normalizeImageOutline } from "../shared/imageWorkflow";

describe("Step2 场景备注水合", () => {
  it("保留车库、庭院、露营、工地完整子图标题", () => {
    const outline = normalizeImageOutline({
      aPlusModules: [{
        moduleNumber: 5,
        selectedModuleType: "premium_rule_carousel",
        subModuleRemark: "4种场景：车库、庭院、露营、工地",
        subModuleCount: 4,
        subModules: ["车库", "庭院", "露营", "工地"].map((title, index) => ({
          subModuleNumber: index + 1,
          title,
          purpose: `${title}场景`,
          contentBrief: `${title}内容`,
          isLocked: index === 0,
        })),
      }],
    });

    const subModules = outline.aPlusModules[0].subModules;
    expect(subModules.map((item: any) => item.title)).toEqual(["车库", "庭院", "露营", "工地"]);
    expect(subModules[0].isLocked).toBe(true);
    expect(outline.aPlusModules[0].subModuleRemark).toBe("4种场景：车库、庭院、露营、工地");
  });
});
