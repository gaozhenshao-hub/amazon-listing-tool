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
});
