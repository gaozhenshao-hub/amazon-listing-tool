import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const errorBoundary = readFileSync(resolve(process.cwd(), "client/src/components/ErrorBoundary.tsx"), "utf8");
const networkBanner = readFileSync(resolve(process.cwd(), "client/src/components/NetworkStatusBanner.tsx"), "utf8");

describe("global recovery UI contract", () => {
  it("does not render raw JavaScript stacks to end users and provides recovery paths", () => {
    expect(errorBoundary).not.toContain("error?.stack");
    expect(errorBoundary).toContain("尝试恢复");
    expect(errorBoundary).toContain("返回首页");
  });

  it("exposes an offline status instead of silently leaving the page stale", () => {
    expect(networkBanner).toContain("网络连接暂时中断");
    expect(networkBanner).toContain('window.addEventListener("offline"');
    expect(networkBanner).toContain("重试");
  });
});
