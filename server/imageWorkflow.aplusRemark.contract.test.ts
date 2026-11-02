import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("client/src/pages/imageWorkflow/ImageOutlineStep.tsx", "utf8");

describe("多图A+备注驱动拆分", () => {
  it("从中文数量备注提取子图数量并重建图片大纲", () => {
    expect(source).toContain("updateAPlusSubmoduleRemark");
    expect(source).toContain("subModuleCount: Number(count)");
    expect(source).toContain("const normalized = normalizeImageOutline(newData)");
    expect(source).toContain("normalized.aPlusModules[idx].subModules");
    expect(source).toContain("title: topic");
  });

  it("为运营人员提供场景拆分示例，并说明下游逐图继承", () => {
    expect(source).toContain("4种场景：车库、庭院、露营、工地");
    expect(source).toContain("后续参考图和图片建议会逐图继承");
    expect(source).toContain("预期子图数量");
  });
});
