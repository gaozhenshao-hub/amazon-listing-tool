import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migration = fs.readFileSync(
  path.resolve(import.meta.dirname, "../drizzle/0171_listing_bullet_step_skill_v3.sql"),
  "utf8",
);

describe("新版逐条卖点精雕Skill", () => {
  it("仅处理用户当前选中的任意卖点，并保持单条英文输出范围", () => {
    expect(migration).toContain("用户当前选中的卖点核心及其序号");
    expect(migration).toContain("无论它是第一、第二、第三、第四或第五条");
    expect(migration).toContain("绝不生成其余卖点、整套五点、编号列表、多段文本");
  });

  it("要求200–280字符，并只在事实存在时使用场景、数据比较和信任元素", () => {
    expect(migration).toContain("200–280字符");
    expect(migration).toContain("真实使用场景");
    expect(migration).toContain("数据比较");
    expect(migration).toContain("信任元素");
    expect(migration).toContain("若没有明确事实依据，必须省略这些元素，绝不编造");
    expect(migration).toContain("'supportsJsonMode',TRUE");
  });
});
