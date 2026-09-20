import { describe, expect, it } from "vitest";
import { DEFAULT_FALLBACKS, runtimeProviderOverrideForModel } from "./skillRunner";

describe("governed Skill Forge emergency fallback", () => {
  it("routes only the registered manus_builtin candidate through Forge", () => {
    expect(runtimeProviderOverrideForModel({ provider: "manus_builtin" })).toBe("forge");
    expect(runtimeProviderOverrideForModel({ provider: "custom" })).toBeUndefined();
    expect(runtimeProviderOverrideForModel({ provider: "openai" })).toBeUndefined();
  });

  it("tries the independent external route before the built-in outage fallback", () => {
    expect(DEFAULT_FALLBACKS[0]).toBe("manus-default");
  });
});
