import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..");

describe("Vite生产构建契约", () => {
  it("不将仅用于开发诊断的JSX定位插件纳入生产构建", () => {
    const config = fs.readFileSync(path.join(projectRoot, "vite.config.ts"), "utf-8");

    expect(config).toContain('const isProductionBuild = process.env.NODE_ENV === "production";');
    expect(config).toContain("...(isProductionBuild ? [] : [jsxLocPlugin()])");
  });
});
