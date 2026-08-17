import { describe, expect, it } from "vitest";
import { normalizeImageOutline } from "../shared/imageWorkflow";

describe("Step2场景备注草稿契约", () => {
  it("将四种场景备注归一化为可持久化的四个子图主题", () => {
    const draft = normalizeImageOutline({
      mainImage: {},
      secondaryImages: [],
      aPlusModules: [
        {
          moduleNumber: 5,
          selectedModuleType: "navigation_carousel",
          subModuleRemark: "4种场景：车库、庭院、露营、工地",
          subModuleCount: 4,
          subModules: [
            { subModuleNumber: 1, title: "车库" },
            { subModuleNumber: 2, title: "庭院" },
            { subModuleNumber: 3, title: "露营" },
            { subModuleNumber: 4, title: "工地" },
          ],
        },
      ],
    });

    const module = draft.aPlusModules[0];
    expect(module.subModuleRemark).toBe("4种场景：车库、庭院、露营、工地");
    expect(module.subModuleCount).toBe(4);
    expect(module.subModules.map((item: any) => item.title)).toEqual(["车库", "庭院", "露营", "工地"]);
  });
});
