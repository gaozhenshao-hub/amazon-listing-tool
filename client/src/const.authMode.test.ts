import { describe, expect, it, vi } from "vitest";

describe("独立认证模式", () => {
  it("本地认证模式下登录入口保持在应用内", async () => {
    vi.stubEnv("VITE_AUTH_MODE", "local");
    vi.resetModules();
    const { getLoginUrl, isLocalAuthMode } = await import("./const");

    expect(isLocalAuthMode()).toBe(true);
    expect(getLoginUrl()).toBe("/login");
  });
});
