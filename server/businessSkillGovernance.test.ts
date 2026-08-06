import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";

describe("Emperor business Skill boundary", () => {
  it("blocks direct business invokeLLM calls and unregistered bypasses", () => {
    const output = execFileSync(process.execPath, ["scripts/check-business-skill-boundaries.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    expect(output).toContain("Emperor Skill boundary passed");
  });
});
