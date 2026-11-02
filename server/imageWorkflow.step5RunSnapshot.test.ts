import { describe, expect, it } from "vitest";
import { buildStep5RunSnapshot, buildStep5SegmentPersistenceUpdate } from "./domains/image/routerContext";

describe("Step5运行快照的分段失败定位", () => {
  it("返回持久化的分段状态、失败组和失败模块", () => {
    const snapshot = buildStep5RunSnapshot({
      step5RunId: "image_step5_test",
      step5RunStatus: "failed",
      step5RunProgress: 70,
      step5RunError: "A+ 子任务超时",
      step5RunFailedGroup: "aplus",
      step5RunFailedModule: "A+ 7",
      step5RunSegments: JSON.stringify([
        { id: "main", label: "主图", group: "main", status: "succeeded" },
        { id: "aplus_7", label: "A+ 7", group: "aplus", status: "failed" },
      ]),
    });

    expect(snapshot).toMatchObject({
      runId: "image_step5_test",
      status: "failed",
      failedGroup: "aplus",
      failedModule: "A+ 7",
    });
    expect(snapshot.segments).toEqual([
      { id: "main", label: "主图", group: "main", status: "succeeded" },
      { id: "aplus_7", label: "A+ 7", group: "aplus", status: "failed" },
    ]);
  });

  it("为会话写入构建失败分组、模块与完整分段列表", () => {
    const patch = buildStep5SegmentPersistenceUpdate([
      { id: "main", label: "主图", group: "main", status: "succeeded" },
      { id: "aplus_7", label: "A+ 7", group: "aplus", status: "fallback", error: "JSON不完整" },
    ], { group: "aplus", module: "A+ 7" });

    expect(patch.step5RunFailedGroup).toBe("aplus");
    expect(patch.step5RunFailedModule).toBe("A+ 7");
    expect(JSON.parse(patch.step5RunSegments)).toEqual([
      { id: "main", label: "主图", group: "main", status: "succeeded" },
      { id: "aplus_7", label: "A+ 7", group: "aplus", status: "fallback", error: "JSON不完整" },
    ]);
  });
});
