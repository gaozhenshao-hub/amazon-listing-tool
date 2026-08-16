import { describe, expect, it } from "vitest";
import { enrichStep5AplusSubmodules } from "./domains/image/step5AplusSubmodules";
import { readFileSync } from "node:fs";

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

  it("将备注驱动的子图数量和主题显式写入最终建议上下文", () => {
    const source = readFileSync("server/domains/image/routerContext.ts", "utf8");
    expect(source).toContain("A+备注驱动的逐图目标");
    expect(source).toContain("subModuleRemark: target.subModuleRemark");
    expect(source).toContain("subModuleCount: target.subModuleCount");
    expect(source).toContain("subModuleTopic: target.subModuleTopic");
  });
});
