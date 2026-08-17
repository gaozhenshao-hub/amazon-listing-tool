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

  it("将历史单字场景内容简述按完整标题回填且不影响锁定资产", () => {
    const titles = ["车库", "庭院", "露营", "工地"];
    const outline = normalizeImageOutline({
      aPlusModules: [{
        moduleNumber: 5,
        selectedModuleType: "premium_rule_carousel",
        subModuleRemark: "4种场景：车库、庭院、露营、工地",
        subModuleCount: 4,
        subModules: titles.map((title, index) => ({
          subModuleNumber: index + 1,
          title,
          purpose: `围绕“${title}”展开的独立A+子图`,
          contentBrief: `展示产品在“${index === 0 ? "场" : title.charAt(0)}”中的核心价值、使用方式或结果。`,
          isLocked: index === 0,
          lockedArtifactRef: index === 0 ? "artifact-step2-5-1" : null,
        })),
      }],
    });

    const subModules = outline.aPlusModules[0].subModules;
    expect(subModules.map((item: any) => item.contentBrief)).toEqual(
      titles.map((title) => `展示产品在“${title}”中的核心价值、使用方式或结果。`),
    );
    expect(subModules[0]).toMatchObject({
      title: "车库",
      isLocked: true,
      lockedArtifactRef: "artifact-step2-5-1",
    });
  });
});
