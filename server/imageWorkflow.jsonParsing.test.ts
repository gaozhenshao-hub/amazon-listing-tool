import { describe, expect, it } from "vitest";
import { parseLooseLlmJson } from "./domains/image/routerContext";

describe("图片工作流皇帝Skill JSON容错", () => {
  it("解析代码围栏内含字符串换行和尾逗号的长JSON", () => {
    const value = parseLooseLlmJson('```json\n{"imageReferences":[{"imageType":"A+模块 1.1","purpose":"车库\n场景",},],}\n```');
    expect(value.imageReferences[0]).toMatchObject({ imageType: "A+模块 1.1", purpose: "车库\n场景" });
  });
});
