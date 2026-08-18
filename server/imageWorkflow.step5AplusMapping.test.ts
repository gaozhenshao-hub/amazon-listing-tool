import { describe, expect, it } from "vitest";
import { enrichStep5AplusSubmodules } from "./domains/image/step5AplusSubmodules";

const outline = {
  aPlusModules: [
    { moduleNumber: 1, title: "核心卖点", purpose: "说明核心价值", contentBrief: "核心价值说明" },
    { moduleNumber: 2, title: "使用场景", purpose: "说明使用环境", contentBrief: "场景价值说明" },
  ],
  brandStory: { title: "品牌故事", purpose: "建立品牌信任", contentBrief: "品牌使命与承诺" },
};

describe("Step5 A+输出结构兼容", () => {
  it("保留分段Skill顶层aPlusModules中的模块级内容", () => {
    const result = enrichStep5AplusSubmodules({
      result: {
        aPlusModules: [
          { moduleNumber: 1, title: "卖点模块", purpose: "模型生成卖点", composition: "左右分栏", imageDescription: "场景实拍" },
          { moduleNumber: 2, title: "场景模块", purpose: "模型生成场景", composition: "全幅横图", imageDescription: "户外场景" },
        ],
        brandStory: { title: "品牌故事", purpose: "模型生成品牌故事", composition: "品牌时间线", imageDescription: "品牌资产展示" },
      },
      outline,
      step4Snapshot: null,
    });

    expect(result.aPlusModules).toHaveLength(2);
    expect(result.aPlusModules[0]).toMatchObject({ moduleNumber: 1, purpose: "模型生成卖点", composition: "左右分栏", imageDescription: "场景实拍" });
    expect(result.aPlusContent.sections[1]).toMatchObject({ moduleNumber: 2, purpose: "模型生成场景", composition: "全幅横图", imageDescription: "户外场景" });
    expect(result.brandStory).toMatchObject({ purpose: "模型生成品牌故事", composition: "品牌时间线" });
  });

  it("兼容完整Skill在aPlusContent.sections内返回的A+内容", () => {
    const result = enrichStep5AplusSubmodules({
      result: {
        aPlusContent: {
          sections: [
            { moduleNumber: 1, title: "完整Skill模块一", purpose: "完整结果一", composition: "居中构图", imageDescription: "卖点图标" },
            { moduleNumber: 2, title: "完整Skill模块二", purpose: "完整结果二", composition: "三栏构图", imageDescription: "场景图" },
          ],
          brandStory: { title: "品牌故事", purpose: "完整Skill品牌内容", composition: "对比叙事", imageDescription: "品牌展示" },
        },
      },
      outline,
      step4Snapshot: null,
    });

    expect(result.aPlusModules).toHaveLength(2);
    expect(result.aPlusModules[0]).toMatchObject({ moduleNumber: 1, purpose: "完整结果一", composition: "居中构图", imageDescription: "卖点图标" });
    expect(result.aPlusContent.sections[1]).toMatchObject({ moduleNumber: 2, purpose: "完整结果二", composition: "三栏构图", imageDescription: "场景图" });
    expect(result.brandStory).toMatchObject({ purpose: "完整Skill品牌内容", composition: "对比叙事" });
  });

  it("按大纲补齐A+ 1至7及独立品牌故事的模块级内容", () => {
    const fullOutline = {
      aPlusModules: Array.from({ length: 7 }, (_, index) => ({
        moduleNumber: index + 1,
        title: `模块 ${index + 1}`,
        purpose: `用途 ${index + 1}`,
        contentBrief: `内容 ${index + 1}`,
      })),
      brandStory: { title: "品牌故事", purpose: "品牌使命", contentBrief: "品牌承诺" },
    };
    const result = enrichStep5AplusSubmodules({
      result: {
        aPlusModules: fullOutline.aPlusModules.map((module) => ({
          ...module,
          content: `${module.contentBrief}的模型结果`,
          composition: "模块化构图",
          imageDescription: "完整图片建议",
        })),
        brandStory: { title: "品牌故事", purpose: "品牌使命", content: "品牌承诺的模型结果", composition: "品牌叙事", imageDescription: "品牌图片建议" },
      },
      outline: fullOutline,
      step4Snapshot: null,
    });

    expect(result.aPlusModules).toHaveLength(7);
    expect(result.aPlusModules.every((module: any) => module.title && module.purpose && module.content)).toBe(true);
    expect(result.brandStory).toMatchObject({ title: "品牌故事", purpose: "品牌使命", content: "品牌承诺的模型结果" });
  });

  it("将超时回退中的通用场景占位替换为已确认Step4参考图的构图和作图建议", () => {
    const scenarioOutline = {
      aPlusModules: [{
        moduleNumber: 5,
        title: "场景轮播",
        purpose: "展示多种使用场景",
        subModules: [{ subModuleNumber: 1, title: "车库", purpose: "车库场景", contentBrief: "车库场景价值" }],
      }],
    };
    const result = enrichStep5AplusSubmodules({
      result: {
        aPlusModules: [{
          moduleNumber: 5,
          title: "场景轮播",
          purpose: "展示多种使用场景",
          subModules: [{
            subModuleNumber: 1,
            title: "车库",
            purpose: "围绕“车库”展开的独立A+子图",
            composition: "展示产品在“车库”中的核心价值、使用方式或结果。",
            imageDescription: "展示产品在“车库”中的核心价值、使用方式或结果。",
          }],
        }],
      },
      outline: scenarioOutline,
      step4Snapshot: {
        imageReferences: [{
          imageKey: "aplus-5.1",
          compositionPlan: { layout: "车库墙面安装的管路走向与接头特写" },
          effectPlan: { description: "冷蓝工业光、橙色重点标注与真实工具细节" },
        }],
      },
    });

    expect(result.aPlusModules[0].subModules[0]).toMatchObject({
      purpose: "车库场景",
      composition: "车库墙面安装的管路走向与接头特写",
      imageDescription: "冷蓝工业光、橙色重点标注与真实工具细节",
    });
  });
});
