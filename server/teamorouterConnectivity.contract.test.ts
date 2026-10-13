import { readFileSync } from "node:fs";
import { Script } from "node:vm";
import { ModuleKind, ScriptTarget, transpileModule } from "typescript";
import { describe, expect, it, vi } from "vitest";

// Exercise the actual test's registration gate with an isolated environment and
// a mock fetch. No host credentials, native network function or provider module
// is available in this sandbox, including in the explicit opt-in test below.
const source = readFileSync(new URL("./teamorouterConnectivity.real.test.ts", import.meta.url), "utf8");
const code = transpileModule(source, {
  compilerOptions: { module: ModuleKind.CommonJS, target: ScriptTarget.ES2020 },
}).outputText;

async function runConnectivityTest(env: Record<string, string | undefined>) {
  const fetch = vi.fn().mockResolvedValue({ status: 200, json: async () => ({ data: [{ id: "gpt-5.6-sol" }] }) });
  const callbacks: Array<() => Promise<void>> = [];
  let skipSuite = false;
  const mockedVitest = {
    expect,
    // Vitest still collects a skipped suite; only test callbacks are skipped.
    describe: { skipIf: (skip: boolean) => (_name: string, register: () => void) => {
      skipSuite = skip;
      register();
    } },
    it: (_name: string, callback: () => Promise<void>) => { if (!skipSuite) callbacks.push(callback); },
  };
  new Script(code).runInNewContext({
    exports: {}, process: { env }, fetch, AbortSignal,
    require: (name: string) => {
      if (name !== "vitest") throw new Error("Unexpected connectivity-test import");
      return mockedVitest;
    },
  }, { timeout: 1000 });
  for (const callback of callbacks) await callback();
  return { registeredTests: callbacks.length, fetch };
}

describe("Teamorouter real-test network isolation", () => {
  it.each([
    {},
    { RUN_REAL_DB_TESTS: "1" },
    { RUN_REAL_LLM_TESTS: "0" },
    { RUN_REAL_LLM_TESTS: "true" },
    { ALLOW_REAL_NETWORK_IN_TESTS: "1" },
    { RUN_REAL_LLM_TESTS: "1", ALLOW_REAL_NETWORK_IN_TESTS: "0" },
  ])("does not fetch without explicit LLM opt-in and permitted network (%j)", async flags => {
    const result = await runConnectivityTest({
      ...flags,
      EXTERNAL_LLM_BASE_URL: "https://synthetic-gateway.invalid/v1",
      EXTERNAL_LLM_API_KEY: "synthetic-not-a-real-credential",
    });
    expect(result.registeredTests).toBe(0);
    expect(result.fetch).not.toHaveBeenCalled();
  });

  it("does not require provider credentials in an ordinary test environment", async () => {
    const result = await runConnectivityTest({});
    expect(result.registeredTests).toBe(0);
    expect(result.fetch).not.toHaveBeenCalled();
  });

  it("explicit opt-in registers the connectivity check, exercised with a mock only", async () => {
    const result = await runConnectivityTest({
      RUN_REAL_LLM_TESTS: "1",
      EXTERNAL_LLM_BASE_URL: "https://synthetic-gateway.invalid/v1/",
      EXTERNAL_LLM_API_KEY: "synthetic-not-a-real-credential",
    });
    expect(result.registeredTests).toBe(1);
    expect(result.fetch).toHaveBeenCalledOnce();
    expect(result.fetch).toHaveBeenCalledWith("https://synthetic-gateway.invalid/v1/models", expect.objectContaining({
      headers: { authorization: "Bearer synthetic-not-a-real-credential" },
    }));
  });

  it("explicit opt-in without required configuration rejects before fetch", async () => {
    await expect(runConnectivityTest({ RUN_REAL_LLM_TESTS: "1" })).rejects.toThrow("EXTERNAL_LLM_BASE_URL is required");
  });
});
