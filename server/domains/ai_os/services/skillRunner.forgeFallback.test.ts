import { afterEach, describe, expect, it, vi } from "vitest";
import { runtimeProviderOverrideForModel } from "./skillRunner";

afterEach(() => {
  vi.doUnmock("../../../_core/env");
  vi.resetModules();
});

async function defaultFallbacksFor(forgeApiKey: string) {
  vi.resetModules();
  vi.doMock("../../../_core/env", async () => {
    const original = await vi.importActual<typeof import("../../../_core/env")>("../../../_core/env");
    return { ...original, ENV: { ...original.ENV, forgeApiKey } };
  });
  return (await import("./skillRunner")).DEFAULT_FALLBACKS;
}

describe("governed Skill Forge emergency fallback", () => {
  it("routes only the registered manus_builtin candidate through Forge", () => {
    expect(runtimeProviderOverrideForModel({ provider: "manus_builtin" })).toBe("forge");
    expect(runtimeProviderOverrideForModel({ provider: "custom" })).toBeUndefined();
    expect(runtimeProviderOverrideForModel({ provider: "openai" })).toBeUndefined();
  });

  it("uses independent external defaults when Forge is not configured", async () => {
    expect(await defaultFallbacksFor("")).toEqual(["teamo-gemini-3-8-flash", "teamo-deepseek-v4-flash"]);
  });

  it("preserves the governed Forge-first defaults only when Forge is configured", async () => {
    expect(await defaultFallbacksFor("synthetic-test-value-not-a-credential"))
      .toEqual(["manus-default", "teamo-gemini-3-8-flash"]);
  });
});
