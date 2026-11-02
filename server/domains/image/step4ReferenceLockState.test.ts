import { describe, expect, it } from "vitest";
import { clearStep4ReferenceLock, clearStep4ReferenceLocks } from "./step4ReferenceLockState";

describe("Step4参考图锁定状态清理", () => {
  it("删除历史锁定快照并保留人工参考图和备注", () => {
    expect(clearStep4ReferenceLock({
      imageKey: "step4-ref-0",
      isLocked: true,
      lockedSnapshot: { imageKey: "step4-ref-0" },
      lockedAt: "2026-08-19T08:00:00.000Z",
      compositionRefImageUrl: "https://example.test/composition.png",
      compositionRefNote: "保留左右分栏",
    })).toEqual({
      imageKey: "step4-ref-0",
      isLocked: false,
      compositionRefImageUrl: "https://example.test/composition.png",
      compositionRefNote: "保留左右分栏",
    });
  });

  it("可一次清理所有参考图的过期锁定标记", () => {
    expect(clearStep4ReferenceLocks([
      { imageKey: "step4-ref-0", isLocked: true },
      { imageKey: "step4-ref-1", isLocked: false, effectRefNote: "保留冷色光影" },
    ])).toEqual([
      { imageKey: "step4-ref-0", isLocked: false },
      { imageKey: "step4-ref-1", isLocked: false, effectRefNote: "保留冷色光影" },
    ]);
  });
});
