import { describe, expect, it } from "vitest";
import { buildStep4ConfirmedSnapshot, compactStep4ReferenceForStorage, compactStep4SnapshotForStorage, extractLatestStep4JobResult, mergeSingleStep4Reference, mergeStep4LatestWithUserAssets } from "./domains/image/step4Snapshot";

describe("Step4锁定快照持久化", () => {
  it("向解锁路由提供可用的最新方案合并导出", () => {
    expect(typeof mergeStep4LatestWithUserAssets).toBe("function");
    expect(typeof extractLatestStep4JobResult).toBe("function");
  });

  it("解析最新Step4任务的嵌套output.result场景方案", () => {
    const result = extractLatestStep4JobResult(JSON.stringify({
      reconciledAfterAgentSyncTimeout: true,
      result: {
        imageReferences: [{ imageKey: "aplus-5.1", compositionReference: { layout: "展示车库环境" } }],
      },
    }));

    expect(result?.imageReferences[0]).toMatchObject({
      imageKey: "aplus-5.1",
      compositionReference: { layout: "展示车库环境" },
    });
  });

  it("解锁时采用最新AI场景方案并保留本地参考图和备注", () => {
    const result = mergeStep4LatestWithUserAssets(
      { imageReferences: [{ imageKey: "aplus-5.1", designNotes: "旧车库方案", compositionRefImageUrl: "local://garage", compositionRefNote: "保留白色背景" }] },
      { imageReferences: [{ imageKey: "aplus-5.1", designNotes: "新车库场景方案", compositionReference: { layout: "车库场景" } }] },
    );
    expect(result?.imageReferences[0]).toMatchObject({
      designNotes: "新车库场景方案",
      compositionRefImageUrl: "local://garage",
      compositionRefNote: "保留白色背景",
      compositionReference: { layout: "车库场景" },
    });
  });

  it("解锁时让四种场景内容保持最新，同时保留对应本地备注", () => {
    const result = mergeStep4LatestWithUserAssets(
      {
        imageReferences: [
          { imageKey: "aplus-5.1", title: "旧车库", compositionRefNote: "车库参考背景色。" },
          { imageKey: "aplus-5.2", title: "旧庭院" },
          { imageKey: "aplus-5.3", title: "旧露营" },
          { imageKey: "aplus-5.4", title: "旧工地" },
        ],
      },
      {
        imageReferences: [
          { imageKey: "aplus-5.1", title: "Garage", designNotes: "最新车库方案" },
          { imageKey: "aplus-5.2", title: "Courtyard", designNotes: "最新庭院方案" },
          { imageKey: "aplus-5.3", title: "Camping", designNotes: "最新露营方案" },
          { imageKey: "aplus-5.4", title: "Jobsite", designNotes: "最新工地方案" },
        ],
      },
    );

    expect(result?.imageReferences).toHaveLength(4);
    expect(result?.imageReferences.map((reference: any) => reference.title)).toEqual(["Garage", "Courtyard", "Camping", "Jobsite"]);
    expect(result?.imageReferences[0]).toMatchObject({
      designNotes: "最新车库方案",
      compositionRefNote: "车库参考背景色。",
    });
  });

  it("最新成功任务的场景方案可作为解锁内容基准", () => {
    const latestJobResult = {
      imageReferences: [
        { imageKey: "aplus-5.1", imageType: "A+模块 5.1", compositionReference: { layout: "车库场景" } },
        { imageKey: "aplus-5.2", imageType: "A+模块 5.2", compositionReference: { layout: "庭院场景" } },
      ],
    };
    const result = mergeStep4LatestWithUserAssets(
      { imageReferences: [{ imageKey: "aplus-5.1", compositionRefNote: "保留本地备注" }] },
      latestJobResult,
    );

    expect(result?.imageReferences).toHaveLength(2);
    expect(result?.imageReferences[0]).toMatchObject({
      compositionReference: { layout: "车库场景" },
      compositionRefNote: "保留本地备注",
    });
    expect(result?.imageReferences[1].compositionReference.layout).toBe("庭院场景");
  });

  it("四种场景参考卡片水合后均保留非空构图、效果与可编辑说明", () => {
    const sceneNames = ["Garage", "Courtyard", "Camping", "Jobsite"];
    const latest = {
      imageReferences: sceneNames.map((scene, index) => ({
        imageKey: `aplus-5.${index + 1}`,
        parentModuleNumber: 5,
        subModuleNumber: index + 1,
        title: scene,
        designNotes: `${scene} 可编辑设计说明`,
        compositionReference: { layout: `${scene} 构图方案`, focalPoint: `${scene} 焦点` },
        effectReference: { colorApplication: `${scene} 配色方案`, visualMood: `${scene} 视觉氛围` },
      })),
    };

    const hydrated = mergeStep4LatestWithUserAssets({ imageReferences: [] }, latest);
    const scenes = hydrated?.imageReferences || [];

    expect(scenes.map((reference: any) => reference.imageKey)).toEqual([
      "aplus-5.1", "aplus-5.2", "aplus-5.3", "aplus-5.4",
    ]);
    scenes.forEach((reference: any, index: number) => {
      expect(reference.title).toBe(sceneNames[index]);
      expect(reference.designNotes).toBeTruthy();
      expect(reference.compositionReference?.layout).toBeTruthy();
      expect(reference.effectReference?.colorApplication).toBeTruthy();
    });
  });

  it("去除展示层lockedSnapshot并保留已锁定图的内容", () => {
    const result = compactStep4ReferenceForStorage({
      imageType: "A+模块 1.1",
      purpose: "测试独立子图",
      compositionRefNote: "保留左右分栏",
      effectRefNote: "采用冷色金属高光",
      isLocked: true,
      lockedAt: "2026-08-16T00:00:00.000Z",
      lockedSnapshot: { imageType: "A+模块 1.1", purpose: "确认版本", compositionRefNote: "保留左右分栏", effectRefNote: "采用冷色金属高光", lockedSnapshot: { stale: true } },
    }, true);

    expect(result).toMatchObject({ imageType: "A+模块 1.1", purpose: "确认版本", compositionRefNote: "保留左右分栏", effectRefNote: "采用冷色金属高光", isLocked: true });
    expect(result).not.toHaveProperty("lockedSnapshot");
  });

  it("多图快照写入前不会保留递归锁定副本", () => {
    const result = compactStep4SnapshotForStorage({
      imageReferences: [{ imageType: "A+模块 4.1", lockedSnapshot: { imageType: "A+模块 4.1" } }],
    });

    expect(result.imageReferences[0]).toEqual({ imageType: "A+模块 4.1" });
  });

  it("单图重新生成只替换目标参考图并保留其他图片和上传资产", () => {
    const snapshot = {
      imageReferences: [
        { imageKey: "main-1", imageType: "主图", purpose: "主图旧方案" },
        { imageKey: "aplus-2", imageType: "A+模块 2", imageNumber: 2, purpose: "模块二旧方案", compositionRefImageUrl: "https://example.com/composition.png", compositionRefNote: "保留左右分栏", parentModuleNumber: 2 },
        { imageKey: "brand-story", imageType: "品牌故事", purpose: "品牌故事旧方案" },
      ],
    };
    const result = mergeSingleStep4Reference(snapshot, 1, { compositionReference: { layout: "新的构图" }, effectReference: { atmosphere: "新的效果" } });

    expect(result.imageReferences[0]).toEqual(snapshot.imageReferences[0]);
    expect(result.imageReferences[2]).toEqual(snapshot.imageReferences[2]);
    expect(result.imageReferences[1]).toMatchObject({
      imageKey: "aplus-2",
      imageType: "A+模块 2",
      purpose: "模块二旧方案",
      parentModuleNumber: 2,
      compositionRefImageUrl: "https://example.com/composition.png",
      compositionRefNote: "保留左右分栏",
      compositionReference: { layout: "新的构图" },
    });
  });

  it("单图确认锁定后，全量参考图的稳定键、其余内容与品牌故事均保持不变", () => {
    const keys = [
      "main-1", "secondary-2", "secondary-3", "secondary-4", "secondary-5", "secondary-6", "secondary-7",
      "aplus-1.1", "aplus-1.2", "aplus-1.3", "aplus-1.4", "aplus-2", "aplus-3",
      "aplus-4.1", "aplus-4.2", "aplus-4.3", "aplus-4.4",
      "aplus-5.1", "aplus-5.2", "aplus-5.3", "aplus-5.4", "aplus-6",
      "aplus-7.1", "aplus-7.2", "aplus-7.3", "aplus-7.4", "brand-story",
    ];
    const before = {
      imageReferences: keys.map((imageKey) => ({
        imageKey,
        imageType: imageKey === "brand-story" ? "品牌故事" : imageKey,
        purpose: `${imageKey} 目的`,
        compositionReference: { layout: `${imageKey} 构图` },
        effectReference: { colorApplication: `${imageKey} 配色` },
      })),
    };
    const after = {
      ...before,
      imageReferences: before.imageReferences.map((reference, index) => index === 0
        ? { ...reference, isLocked: true, lockedSnapshot: { ...reference } }
        : reference),
    };

    expect(after.imageReferences).toHaveLength(27);
    expect(after.imageReferences.map((reference) => reference.imageKey)).toEqual(keys);
    expect(after.imageReferences.slice(1)).toEqual(before.imageReferences.slice(1));
    expect(after.imageReferences[0]).toMatchObject({ imageKey: "main-1", isLocked: true });
    expect(after.imageReferences.find((reference) => reference.imageKey === "brand-story")).toEqual(before.imageReferences.at(-1));
  });

  it("整体确认从逐图确认版本汇总时保留构图和效果备注", () => {
    const result = buildStep4ConfirmedSnapshot(
      { imageReferences: [{ imageType: "辅图 2" }, { imageType: "A+模块 7" }] },
      new Map([
        [0, { imageType: "辅图 2", compositionRefImageUrl: "https://example.com/comp.png", compositionRefNote: "参考背景色", effectRefNote: "保留金属高光" }],
        [1, { imageType: "A+模块 7", effectRefImageUrl: "https://example.com/effect.png", effectRefNote: "深蓝科技感" }],
      ]),
    );

    expect(result.imageReferences[0]).toMatchObject({ compositionRefNote: "参考背景色", effectRefNote: "保留金属高光", isLocked: true });
    expect(result.imageReferences[1]).toMatchObject({ effectRefNote: "深蓝科技感", isLocked: true });
  });

  it("多图A+模块、单图模块与品牌故事按稳定目标标识完整映射", () => {
    const expectedKeys = [
      "aplus-1.1", "aplus-1.2", "aplus-1.3", "aplus-1.4",
      "aplus-2", "aplus-3",
      "aplus-4.1", "aplus-4.2", "aplus-4.3", "aplus-4.4",
      "aplus-5.1", "aplus-5.2", "aplus-5.3", "aplus-5.4",
      "aplus-6",
      "aplus-7.1", "aplus-7.2", "aplus-7.3", "aplus-7.4",
      "brand-story",
    ];
    const latest = {
      imageReferences: expectedKeys.map((imageKey) => {
        const [prefix, parentAndSub] = imageKey.split("-");
        const [parentPart, subPart] = (parentAndSub || "").split(".");
        const parentModuleNumber = imageKey === "brand-story" ? null : Number(parentPart);
        const subModuleNumber = subPart ? Number(subPart) : null;
        return {
          imageKey,
          parentModuleNumber,
          subModuleNumber,
          compositionReference: { layout: `${imageKey} 构图` },
          effectReference: { colorApplication: `${imageKey} 配色` },
        };
      }),
    };

    const result = mergeStep4LatestWithUserAssets({ imageReferences: [] }, latest);
    const references = result?.imageReferences || [];

    expect(references.map((reference: any) => reference.imageKey)).toEqual(expectedKeys);
    expect(references.filter((reference: any) => reference.parentModuleNumber === 5).map((reference: any) => reference.subModuleNumber)).toEqual([1, 2, 3, 4]);
    expect(references.find((reference: any) => reference.imageKey === "brand-story")).toMatchObject({
      compositionReference: { layout: "brand-story 构图" },
      effectReference: { colorApplication: "brand-story 配色" },
    });
  });
});
