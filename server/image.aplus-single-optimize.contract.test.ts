import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("server/domains/image/routers/references.ts", "utf8");

describe("A+单模块样式重新优化契约", () => {
  it("统一调用皇帝专用Skill并传入归一化样式元数据", () => {
    expect(source).toContain('emperorSkill: { slug: "image.step2.aplus.single.optimize" }');
    expect(source).toContain("const normalizedStyle");
    expect(source).toContain("selectedModuleSpecs: normalizedStyle.specs");
    expect(source).toContain("selectedModuleStructure: normalizedStyle.structure");
  });
});
