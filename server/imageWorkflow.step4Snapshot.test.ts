import { describe, expect, it } from "vitest";
import { compactStep4ReferenceForStorage, compactStep4SnapshotForStorage } from "./domains/image/step4Snapshot";

describe("Step4锁定快照持久化", () => {
  it("去除展示层lockedSnapshot并保留已锁定图的内容", () => {
    const result = compactStep4ReferenceForStorage({
      imageType: "A+模块 1.1",
      purpose: "测试独立子图",
      isLocked: true,
      lockedAt: "2026-08-16T00:00:00.000Z",
      lockedSnapshot: { imageType: "A+模块 1.1", purpose: "确认版本", lockedSnapshot: { stale: true } },
    }, true);

    expect(result).toMatchObject({ imageType: "A+模块 1.1", purpose: "确认版本", isLocked: true });
    expect(result).not.toHaveProperty("lockedSnapshot");
  });

  it("多图快照写入前不会保留递归锁定副本", () => {
    const result = compactStep4SnapshotForStorage({
      imageReferences: [{ imageType: "A+模块 4.1", lockedSnapshot: { imageType: "A+模块 4.1" } }],
    });

    expect(result.imageReferences[0]).toEqual({ imageType: "A+模块 4.1" });
  });
});
