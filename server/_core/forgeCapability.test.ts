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
  vi.resetModules();
});

describe("独立部署Forge能力边界", () => {
  it("在本地认证且未配置托管服务时返回明确的能力不可用错误", async () => {
    process.env.AUTH_MODE = "local";
    delete process.env.BUILT_IN_FORGE_API_URL;
    delete process.env.BUILT_IN_FORGE_API_KEY;
    vi.resetModules();
    const {
      assertForgeCapabilityAvailable,
      ForgeCapabilityUnavailableError,
    } = await import("./forgeCapability");

    let thrown: unknown;
    try {
      assertForgeCapabilityAvailable("data_api");
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(ForgeCapabilityUnavailableError);
    expect((thrown as ForgeCapabilityUnavailableError).capabilityCode).toBe(
      "INDEPENDENT_CAPABILITY_UNAVAILABLE"
    );
    expect(() => assertForgeCapabilityAvailable("data_api")).toThrow(
      "当前独立部署尚未配置外部数据检索服务"
    );
  });
});
