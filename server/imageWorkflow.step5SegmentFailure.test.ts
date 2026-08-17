import { describe, expect, it } from "vitest";
import { describeStep5SegmentFailure } from "./domains/image/step5SegmentFailure";
import { buildStep5RunSnapshot } from "./domains/image/routerContext";

describe("Step5分段失败定位", () => {
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
});
