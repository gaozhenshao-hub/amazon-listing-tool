import { describe, expect, it } from "vitest";
import { getUnconfirmedStep4References, resolveStep4ConfirmationData } from "./ReferenceImagesStep";

describe("Step4逐图确认计数", () => {
  it("将服务端逐图版本水合的isLocked状态视为已确认，即使不存在客户端lockedSnapshot", () => {
    const references = [
      { imageKey: "step4-ref-0", isLocked: true },
      { imageKey: "step4-ref-1", isLocked: true, lockedSnapshot: { imageKey: "step4-ref-1" } },
      { imageKey: "step4-ref-2", isLocked: false },
    ];

    expect(getUnconfirmedStep4References(references).map((reference) => reference.imageKey)).toEqual([
      "step4-ref-2",
    ]);
  });

  it("将缺少锁定状态的历史参考图识别为仍需确认", () => {
    expect(getUnconfirmedStep4References([{ imageKey: "step4-ref-0" }, null]).length).toBe(2);
  });

  it("整体确认优先使用已持久化且锁定更多图片的会话快照，避免本地旧状态误拦截", () => {
    const localData = {
      imageReferences: [
        { imageKey: "step4-ref-0", isLocked: true },
        { imageKey: "step4-ref-1", isLocked: false },
      ],
    };
    const persistedUserEdit = JSON.stringify({
      imageReferences: [
        { imageKey: "step4-ref-0", isLocked: true },
        { imageKey: "step4-ref-1", isLocked: true },
      ],
    });

    const resolved = resolveStep4ConfirmationData(localData, persistedUserEdit);
    expect(getUnconfirmedStep4References(resolved.imageReferences)).toHaveLength(0);
  });

  it("逐图解锁后使用服务端未锁定快照覆盖旧本地锁定状态", () => {
    const localData = {
      imageReferences: [
        { imageKey: "step4-ref-0", isLocked: true },
        { imageKey: "step4-ref-1", isLocked: true },
      ],
    };
    const persistedUserEdit = JSON.stringify({
      imageReferences: [
        { imageKey: "step4-ref-0", isLocked: false },
        { imageKey: "step4-ref-1", isLocked: false },
      ],
    });

    const resolved = resolveStep4ConfirmationData(localData, persistedUserEdit);
    expect(getUnconfirmedStep4References(resolved.imageReferences)).toHaveLength(2);
  });
});
