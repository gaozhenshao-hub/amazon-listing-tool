import { describe, expect, it } from "vitest";
import {
  getStep5AplusSectionCardKey,
  getStep5SecondaryImageCardKey,
} from "./step5RenderIdentity";

describe("Step5结果卡片身份", () => {
  it("优先使用图片槽位标识而非数组位置", () => {
    expect(getStep5SecondaryImageCardKey({ imageNumber: 4, title: "场景图" }, 0)).toBe(
      "step5-secondary:4"
    );
  });

  it("为A+模块使用持久模块编号并安全回退", () => {
    expect(getStep5AplusSectionCardKey({ moduleNumber: "3.2" }, 0)).toBe("step5-aplus:3.2");
    expect(getStep5AplusSectionCardKey({}, 2)).toBe("step5-aplus:3");
  });
});
