import { describe, expect, it, vi } from "vitest";
import { safeParseSkillJSON } from "./domains/ai_os/services/skillRunner";
import { describeStep5SegmentFailure } from "./domains/image/step5SegmentFailure";
import { findIncompleteStep5Segment } from "./domains/image/step5SegmentValidation";
import { buildStep5OutlineSafetyFallback, buildStep5RunSnapshot, callStep5SkillWithinDeadline } from "./domains/image/routerContext";

describe("Step5分段失败定位", () => {
  it("完整Skill返回不可解析长JSON时按已确认大纲构建可编辑安全回退", () => {
    const fallback = buildStep5OutlineSafetyFallback({
      productName: "空气管道套件",
      failedGroup: "aplus",
      failedModule: "A+ 7",
      outline: {
        mainImage: { purpose: "展示套件全貌" },
        secondaryImages: Array.from({ length: 6 }, (_, index) => ({
          imageNumber: index + 2,
          purpose: `辅图${index + 2}卖点`,
          contentBrief: `辅图${index + 2}内容`,
          expressionType: "信息图",
        })),
        aPlusModules: Array.from({ length: 7 }, (_, index) => ({
          moduleNumber: index + 1,
          selectedModuleName: `A+ ${index + 1}`,
          purpose: `A+ ${index + 1}价值`,
        })),
        brandStory: { title: "品牌故事", purpose: "品牌承诺" },
      },
    });

    expect(fallback.segmentedGeneration).toMatchObject({ mode: "outline_safety_fallback", failedGroup: "aplus", failedModule: "A+ 7" });
    expect(fallback.mainImage).toMatchObject({
      concept: "展示套件全貌",
      composition: expect.any(String),
      primary: "展示套件全貌",
      shooting: expect.any(String),
    });
    expect(fallback.secondaryImages.map((image: any) => image.imageNumber)).toEqual([2, 3, 4, 5, 6, 7]);
    expect(fallback.secondaryImages.every((image: any) => image.title && image.focus && image.composition && image.expression && image.primary && image.textOverlay)).toBe(true);
    expect(fallback.aPlusModules).toHaveLength(7);
    expect(fallback.aPlusContent).toMatchObject({
      overallStrategy: expect.stringContaining("A+ 1"),
      overallStory: expect.stringContaining("A+ 1价值"),
      consistency: expect.any(String),
      modularDesign: expect.any(String),
    });
    expect(fallback.designGuidelines).toMatchObject({
      fontRecommendation: expect.any(String),
      overallColorPalette: expect.any(String),
      brandTone: expect.any(String),
      mobileOptimization: expect.any(String),
    });
    expect(fallback.brandStory).toMatchObject({ title: "品牌故事", content: "品牌承诺" });
  });

  it("为主图、辅图、A+模块与品牌故事生成稳定失败标识", () => {
    expect(describeStep5SegmentFailure({ id: "main", group: "main" })).toEqual({ group: "main", module: null });
    expect(describeStep5SegmentFailure({ id: "secondary", group: "secondary" })).toEqual({ group: "secondary", module: null });
    expect(describeStep5SegmentFailure({ id: "aplus_7", group: "aplus" })).toEqual({ group: "aplus", module: "A+ 7" });
    expect(describeStep5SegmentFailure({ id: "brand_story", group: "brand_story" })).toEqual({ group: "brand_story", module: "品牌故事" });
  });

  it("回退成功后仍在运行快照中保留失败分组、失败模块与fallback段状态", () => {
    const snapshot = buildStep5RunSnapshot({
      step5RunId: "image_step5_fallback",
      step5RunStatus: "succeeded",
      step5RunProgress: 100,
      step5RunFailedGroup: "aplus",
      step5RunFailedModule: "A+ 7",
      step5RunSegments: JSON.stringify([
        { id: "aplus_7", label: "A+ 7", group: "aplus", status: "fallback", error: "内容不完整" },
        { id: "merge", label: "合并与保存", group: "merge", status: "succeeded" },
      ]),
    });

    expect(snapshot).toMatchObject({ status: "succeeded", failedGroup: "aplus", failedModule: "A+ 7" });
    expect(snapshot.segments).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "aplus_7", status: "fallback", error: "内容不完整" }),
    ]));
  });

  it("完整Skill回退输出可解析且满足辅图、A+与品牌故事字段契约", () => {
    const raw = JSON.stringify({
      mainImage: {
        title: "主图",
        concept: "展示套件全貌",
        composition: "白底居中构图",
        primary: "完整产品套件",
        shooting: "明亮棚拍光线",
      },
      secondaryImages: [2, 3, 4, 5, 6, 7].map((imageNumber) => ({
        imageNumber,
        title: `辅图${imageNumber}`,
        focus: "核心卖点",
        expression: "场景与结构结合展示",
        composition: "左图右文构图",
        textOverlay: "核心参数与短文案",
      })),
      aPlusModules: [1, 2, 3, 4, 5, 6, 7].map((moduleNumber) => ({
        moduleNumber,
        title: `A+ ${moduleNumber}`,
        purpose: "说明卖点",
        content: "模块正文",
        composition: "构图建议",
        imageDescription: "作图建议",
      })),
      brandStory: {
        title: "品牌故事",
        purpose: "传递品牌价值",
        content: "品牌故事正文",
        composition: "品牌构图",
        imageDescription: "品牌作图建议",
      },
    });
    const parsed = safeParseSkillJSON<any>(raw);

    expect(parsed).not.toHaveProperty("raw");
    expect(parsed.secondaryImages).toHaveLength(6);
    expect(parsed.aPlusModules).toHaveLength(7);
    expect(parsed.brandStory).toMatchObject({ title: "品牌故事", content: "品牌故事正文" });
    expect(findIncompleteStep5Segment({
      mainSegment: parsed,
      secondarySegment: parsed,
      aplusModules: parsed.aPlusModules,
      outlineAplusModules: [1, 2, 3, 4, 5, 6, 7].map((moduleNumber) => ({ moduleNumber })),
      requiresBrandStory: true,
      brandStory: parsed.brandStory,
    })).toBeNull();
  });

  it("皇帝Skill长时间无输出时在有界等待后拒绝，让生成任务进入回退而非长期running", async () => {
    vi.useFakeTimers();
    const stalled = callStep5SkillWithinDeadline("主图", () => new Promise<never>(() => undefined));
    const assertion = expect(stalled).rejects.toThrow("主图皇帝Skill超过120秒仍未返回");
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    vi.useRealTimers();
  });
});
