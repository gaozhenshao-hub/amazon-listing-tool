import { describe, expect, it } from "vitest";
import { parseLooseLlmJson } from "./domains/image/routerContext";

describe("Step4皇帝Skill JSON恢复", () => {
  it("恢复代码围栏包裹且尾部附加说明的完整长JSON", () => {
    const payload = {
      imageReferences: [
        { imageKey: "aplus-5.1", title: "车库", composition: { note: "保留 {大标题} 的位置" } },
        { imageKey: "aplus-5.2", title: "庭院" },
      ],
    };
    const raw = `\uFEFF\`\`\`json\n${JSON.stringify(payload)}\n\`\`\`\n以上为场景参考图说明。`;

    expect(parseLooseLlmJson(raw)).toEqual(payload);
  });

  it("恢复未闭合代码围栏后仍完整闭合的JSON对象", () => {
    const payload = { imageReferences: [{ imageKey: "aplus-5.3", title: "露营" }] };
    const raw = `\`\`\`json\n${JSON.stringify(payload)}\n模型补充说明`;

    expect(parseLooseLlmJson(raw)).toEqual(payload);
  });
});
