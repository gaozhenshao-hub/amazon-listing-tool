import { describe, expect, it } from "vitest";
import { describeStep5SegmentFailure } from "./step5SegmentFailure";

describe("Step5分段失败定位", () => {
  it("为主图和辅图保留准确失败分组", () => {
    expect(describeStep5SegmentFailure({ id: "main", group: "main" })).toEqual({ group: "main", module: null });
    expect(describeStep5SegmentFailure({ id: "secondary", group: "secondary" })).toEqual({ group: "secondary", module: null });
  });

  it("为A+子模块和品牌故事保留准确模块标识", () => {
    expect(describeStep5SegmentFailure({ id: "aplus_7", group: "aplus" })).toEqual({ group: "aplus", module: "A+ 7" });
    expect(describeStep5SegmentFailure({ id: "brand_story", group: "brand_story" })).toEqual({ group: "brand_story", module: "品牌故事" });
  });

  it("在没有失败分段时返回可审计的未知定位", () => {
    expect(describeStep5SegmentFailure(null)).toEqual({ group: "unknown", module: null });
  });
});
