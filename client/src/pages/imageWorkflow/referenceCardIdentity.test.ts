import { describe, expect, it } from "vitest";
import { getStep4KbReferenceCardKey, getStep4ReferenceCardKey } from "./referenceCardIdentity";

describe("Step4参考图卡片身份", () => {
  it("优先使用跨单图优化稳定的imageKey，而不是数组索引", () => {
    expect(getStep4ReferenceCardKey({ imageKey: "aplus-5.2" }, 11)).toBe("aplus-5.2");
    expect(getStep4ReferenceCardKey({ imageKey: " step4-ref-4 " }, 4)).toBe("step4-ref-4");
  });

  it("历史数据缺失imageKey时保留安全回退键", () => {
    expect(getStep4ReferenceCardKey({}, 3)).toBe("step4-ref-3");
    expect(getStep4ReferenceCardKey(null, 0)).toBe("step4-ref-0");
  });

  it("知识库参考图使用稳定的记录标识或URL，而非渲染位置", () => {
    expect(getStep4KbReferenceCardKey("step4-ref-2", { id: 88, imageUrl: "https://example.test/a.png" }, 1)).toBe("step4-ref-2:kb:88");
    expect(getStep4KbReferenceCardKey("step4-ref-2", { imageUrl: "https://example.test/a.png" }, 1)).toBe("step4-ref-2:kb:https://example.test/a.png");
  });
});
