import { describe, expect, it } from "vitest";
import { enrichStep5AplusSubmodules } from "./domains/image/step5AplusSubmodules";
import { readFileSync } from "node:fs";

describe("Step5多图A+子模块建议", () => {
  it("使用皇帝主图、辅图和A+分段Skill编排，并保留完整Skill回退", () => {
    const source = readFileSync("server/domains/image/routerContext.ts", "utf8");
    expect(source).toContain('skillSlug: "image.step5.main.segment"');
    expect(source).toContain('skillSlug: "image.step5.secondary.segment"');
    expect(source).toContain('skillSlug: "image.step5.aplus.segment"');
    expect(source).toContain('skillSlug: "image.step5.final.suggestion"');
    expect(source).toContain('segmentedGeneration: { mode: "emperor_segments"');
  });

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

  it("按大纲模块编号补齐模型漏掉的第七个A+模块和品牌故事", () => {
    const result = enrichStep5AplusSubmodules({
      result: { aPlusContent: { sections: [{ moduleNumber: 1, title: "模块1" }] } },
      outline: {
        aPlusModules: [
          { moduleNumber: 1, title: "模块1", purpose: "第一模块" },
          { moduleNumber: 7, title: "模块7", purpose: "第七模块" },
        ],
        brandStory: { title: "品牌故事", purpose: "品牌承诺" },
      },
      step4Snapshot: { imageReferences: [{ imageType: "品牌故事", compositionPlan: { layout: "品牌时间线" } }] },
    });

    expect(result.aPlusContent.sections.map((section: any) => section.moduleNumber)).toEqual([1, 7]);
    expect(result.aPlusContent.sections[1]).toEqual(expect.objectContaining({ title: "模块7", purpose: "第七模块" }));
    expect(result.brandStory).toEqual(expect.objectContaining({ title: "品牌故事", purpose: "品牌承诺", referenceImageKey: "品牌故事" }));
  });

  it("在Step5前台渲染品牌故事，并按模块编号而非数组下标映射A+样式", () => {
    const source = readFileSync("client/src/pages/ImageWorkflowPage.tsx", "utf8");
    expect(source).toContain("enData.brandStory");
    expect(source).toContain("品牌故事");
    expect(source).toContain("Number(module?.moduleNumber) === Number(section?.moduleNumber)");
  });
});
