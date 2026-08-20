import { afterEach, describe, expect, it, vi } from "vitest";

const originalAuthMode = process.env.AUTH_MODE;
const originalForgeApiUrl = process.env.BUILT_IN_FORGE_API_URL;
const originalForgeApiKey = process.env.BUILT_IN_FORGE_API_KEY;

function restoreEnv(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

afterEach(() => {
  restoreEnv("AUTH_MODE", originalAuthMode);
  restoreEnv("BUILT_IN_FORGE_API_URL", originalForgeApiUrl);
  restoreEnv("BUILT_IN_FORGE_API_KEY", originalForgeApiKey);
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("notifyOwner in independent local mode", () => {
  it("returns an undelivered status instead of throwing when no hosted notification provider exists", async () => {
    process.env.AUTH_MODE = "local";
    delete process.env.BUILT_IN_FORGE_API_URL;
    delete process.env.BUILT_IN_FORGE_API_KEY;
    const info = vi.spyOn(console, "info").mockImplementation(() => undefined);
    vi.resetModules();
    const { notifyOwner } = await import("./notification");

    await expect(
      notifyOwner({ title: "AI Worker 心跳过期", content: "用于回归测试的告警。" })
    ).resolves.toBe(false);
    expect(info).toHaveBeenCalledWith(expect.stringContaining("Disabled in local authentication mode"));
  });
});
