import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";

describe("独立认证前端构建契约", () => {
  it("将AUTH_MODE显式注入VITE_AUTH_MODE，避免独立构建回退到Manus登录入口", async () => {
    const packageJson = JSON.parse(
      await readFile(new URL("../package.json", import.meta.url), "utf8")
    ) as { scripts?: Record<string, string> };

    expect(packageJson.scripts?.["build:client"]).toContain(
      'VITE_AUTH_MODE="${VITE_AUTH_MODE:-${AUTH_MODE:-manus}}"'
    );
  });
});
