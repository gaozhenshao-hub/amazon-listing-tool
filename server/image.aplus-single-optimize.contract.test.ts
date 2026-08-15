import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("server/domains/image/routers/references.ts", "utf8");
const workflowStepsSource = readFileSync("server/domains/image/routers/workflowSteps.ts", "utf8");

describe("A+单模块样式重新优化契约", () => {
  it("统一调用皇帝专用Skill并传入归一化样式元数据", () => {
    expect(source).toContain('slug: "image.step2.aplus.single.optimize"');
    expect(source).toContain("const normalizedStyle");
    expect(source).toContain("userId: ctx.user.id");
    expect(source).toContain("context: skillContext");
    expect(workflowStepsSource).toContain("图片大纲已锁定，请先点击“解锁编辑”后再调整A+模块样式");
    expect(source).toContain("selectedModuleSpecs: normalizedStyle.specs");
    expect(source).toContain("selectedModuleStructure: normalizedStyle.structure");
  });
});
