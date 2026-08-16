import { describe, expect, it } from "vitest";
import { enrichStep5AplusSubmodules } from "./domains/image/step5AplusSubmodules";

describe("Step5多图A+子模块建议", () => {
  it("在模型仅返回父模块时，回填已锁定子图的独立建议与参考图键", () => {
    const result = enrichStep5AplusSubmodules({
      result: { aPlusContent: { sections: [{ title: "父模块", moduleSpecificContent: { panels: [] } }] } },
      outline: {
        aPlusModules: [{ moduleNumber: 1, subModules: [{ subModuleNumber: 1, title: "Zero Leakage", purpose: "证明密封", contentBrief: "展示双重密封", isLocked: true }] }],
      },
      step4Snapshot: {
        imageReferences: [{ imageType: "A+模块 1.1", compositionPlan: { layout: "左侧剖面，右侧文案" }, effectPlan: { description: "工业蓝高对比" } }],
      },
    });

    const section = result.aPlusContent.sections[0];
    expect(section.subModules).toEqual([expect.objectContaining({
      subModuleNumber: 1,
      title: "Zero Leakage",
      purpose: "证明密封",
      composition: "左侧剖面，右侧文案",
      imageDescription: "工业蓝高对比",
      referenceImageKey: "A+模块 1.1",
      isLocked: true,
    })]);
    expect(section.moduleSpecificContent.subImages).toHaveLength(1);
  });
});
