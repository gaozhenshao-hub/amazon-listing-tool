import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("Step5结果区DOM隔离契约", () => {
  it("为辅图和A+历史卡片同时保留稳定身份键与浏览器翻译隔离", async () => {
    const source = await readFile(
      new URL("../ImageWorkflowPage.tsx", import.meta.url),
      "utf8"
    );

    expect(source).toContain(
      '<Card key={getStep5SecondaryImageCardKey(img, idx)} translate="no">'
    );
    expect(source).toContain(
      'key={getStep5AplusSectionCardKey(section, idx)}\n                    translate="no"'
    );
  });
});
