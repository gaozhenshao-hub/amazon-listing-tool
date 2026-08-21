import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "client/src/pages/emperor/EmperorSkillLibrary.tsx"),
  "utf8",
);

describe("皇帝Skill库完整浏览契约", () => {
  it("以受控页大小查询并在筛选改变时返回第一页", () => {
    expect(source).toContain("const SKILL_PAGE_SIZE = 30;");
    expect(source).toContain("page: currentPage,");
    expect(source).toContain("pageSize: SKILL_PAGE_SIZE,");
    expect(source).toContain("setCurrentPage(1);");
  });

  it("为长Skill列表保留独立滚动与上一页、下一页导航", () => {
    expect(source).toContain('className="flex-1 min-h-0 flex flex-col min-w-0 border-r"');
    expect(source).toContain('className="flex-1 min-h-0"');
    expect(source).toContain("显示 {pageStart}–{pageEnd} / 共 {totalSkills} 个 Skill");
    expect(source).toContain("上一页");
    expect(source).toContain("下一页");
  });
});
