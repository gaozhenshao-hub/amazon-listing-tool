import { describe, expect, it } from "vitest";
import { CONTEXT_SOURCE_INVALIDATED_REASON, contextRecoveryBlock } from "./contextRecoveryPolicy";

describe("上下文来源失效恢复治理", () => {
  it("没有失效来源时不阻断恢复", () => {
    expect(contextRecoveryBlock([])).toEqual({ blocked: false });
  });

  it("任一附件或知识来源失效时必须拒绝恢复", () => {
    expect(contextRecoveryBlock([
      { sourceType: "attachment", sourceKey: "att_archived" },
      { sourceType: "knowledge", sourceKey: "kref_archived" },
    ])).toEqual({
      blocked: true,
      reasonCode: CONTEXT_SOURCE_INVALIDATED_REASON,
      message: "关联上下文来源已失效；请重新编译上下文并再次人工确认后再运行",
    });
  });
});
