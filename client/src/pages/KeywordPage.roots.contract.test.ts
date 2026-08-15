import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(process.cwd(), "client/src/pages/KeywordPage.tsx"), "utf8");

describe("词根分类搜索量展示", () => {
  it("显示词根搜索量汇总与每个关键词的搜索量后缀", () => {
    expect(source).toContain("const totalSearchVolume");
    expect(source).toContain("totalSearchVolume.toLocaleString()");
    expect(source).toContain("root.keywords.reduce((sum: number, kw: any)");
    expect(source).toContain("kw.monthlySearchVolume == null");
  });
});
