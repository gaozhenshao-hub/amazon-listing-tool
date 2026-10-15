import { describe, expect, it } from "vitest";
import { mergedReadOnlyFeaturesEnabled } from "./mergedReadOnlyFeatures";
import { PERMISSION_ROUTE_REGISTRY } from "@shared/const";

describe("merged read-only integration opt-in", () => {
  it("requires the exact explicit build opt-in", () => {
    expect(mergedReadOnlyFeaturesEnabled("1")).toBe(true);
    for (const value of [undefined, null, "", "0", "true", " 1", 1, true, {}]) {
      expect(mergedReadOnlyFeaturesEnabled(value)).toBe(false);
    }
  });

  it("gives the new library an enforced existing Agent permission boundary", () => {
    expect(PERMISSION_ROUTE_REGISTRY["/emperor/agent-library"]).toEqual({
      moduleId: "emperor", subModuleId: "emperor_agents", enforcement: "enforced",
    });
    expect(PERMISSION_ROUTE_REGISTRY["/emperor/agents"].subModuleId).toBe("emperor_agents");
  });
});
