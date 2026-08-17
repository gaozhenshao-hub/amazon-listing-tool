import { describe, expect, it } from "vitest";
import { getUnconfirmedStep4References } from "./ReferenceImagesStep";

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
});
