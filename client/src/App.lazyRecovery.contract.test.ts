import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appSource = readFileSync(resolve(process.cwd(), "client/src/App.tsx"), "utf8");

describe("应用动态模块恢复契约", () => {
  it("为平台首页和知识库概览使用一次性恢复加载器", () => {
    expect(appSource).toContain('"lazy-recovery:platform-home"');
    expect(appSource).toContain('"lazy-recovery:kb-overview"');
    expect(appSource).toMatch(/const PlatformHome = lazyWithRecovery\(/);
    expect(appSource).toMatch(/const KBOverview = lazyWithRecovery\(/);
  });
});
