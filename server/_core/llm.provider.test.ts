import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("独立LLM提供商配置", () => {
  it("外部OpenAI兼容网关使用显式模型与chat completions地址", async () => {
    vi.stubEnv("LLM_PROVIDER", "external");
    vi.stubEnv("EXTERNAL_LLM_BASE_URL", "https://llm.example.test/v1/");
    vi.stubEnv("EXTERNAL_LLM_API_KEY", "test-key");
    vi.stubEnv("EXTERNAL_LLM_MODEL", "model-x");
    vi.resetModules();
    const { resolveLlmRuntimeConfig } = await import("./llm");

    expect(resolveLlmRuntimeConfig()).toEqual({
      provider: "external",
      apiUrl: "https://llm.example.test/v1/chat/completions",
      apiKey: "test-key",
      model: "model-x",
    });
  });

  it("外部网关缺少凭据时明确拒绝调用", async () => {
    vi.stubEnv("LLM_PROVIDER", "external");
    vi.stubEnv("EXTERNAL_LLM_BASE_URL", "https://llm.example.test/v1");
    vi.stubEnv("EXTERNAL_LLM_API_KEY", "");
    vi.stubEnv("EXTERNAL_LLM_MODEL", "");
    vi.resetModules();
    const { resolveLlmRuntimeConfig } = await import("./llm");

    expect(() => resolveLlmRuntimeConfig()).toThrow("External LLM configuration missing");
  });
});
