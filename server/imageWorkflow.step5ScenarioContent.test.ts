import { describe, expect, it } from "vitest";
import { enrichStep5AplusSubmodules } from "./domains/image/step5AplusSubmodules";

describe("Step5 场景子图建议完整性", () => {
  it("保留车库、庭院、露营、工地四个子图的正文、构图与作图建议", () => {
    const scenarioTopics = ["车库", "庭院", "露营", "工地"];
    const result = enrichStep5AplusSubmodules({
      outline: {
        aPlusModules: [{
          moduleNumber: 5,
          subModuleRemark: "4种场景：车库、庭院、露营、工地",
          subModuleCount: 4,
          subModules: scenarioTopics.map((topic, index) => ({
            subModuleNumber: index + 1,
            title: topic,
            purpose: `${topic}用途`,
            contentBrief: `${topic}内容`,
          })),
        }],
      },
      result: {
        aPlusModules: [{
          moduleNumber: 5,
          title: "场景展示",
          subModules: scenarioTopics.map((topic, index) => ({
            subModuleNumber: index + 1,
            title: topic,
            content: `${topic}卖点正文`,
            composition: `${topic}构图建议`,
            imageDescription: `${topic}作图建议`,
          })),
        }],
      },
    } as any);

    const subModules = result.aPlusModules[0].subModules;
    expect(subModules).toHaveLength(4);
    subModules.forEach((subModule: any, index: number) => {
      expect(subModule.title).toBe(scenarioTopics[index]);
      expect(subModule.content).toContain(scenarioTopics[index]);
      expect(subModule.composition).toContain(scenarioTopics[index]);
      expect(subModule.imageDescription).toContain(scenarioTopics[index]);
    });
  });
});
