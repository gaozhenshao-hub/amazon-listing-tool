import { describe, expect, it } from "vitest";
import { imageStepGenerationJobInput } from "./stepGenerationJob";

describe("imageStepGenerationJobInput distillation binding", () => {
  it("accepts an explicit locked-ledger and released-skill binding for audit propagation", () => {
    const parsed = imageStepGenerationJobInput.parse({
      projectId: 9,
      sessionId: 3,
      step: 2,
      distillationBinding: { ledgerKey: "ledger-locked-v2", skillSlugs: ["image.outline.storyboard.plan"] },
    });
    expect(parsed.distillationBinding).toEqual({ ledgerKey: "ledger-locked-v2", skillSlugs: ["image.outline.storyboard.plan"] });
  });

  it("keeps historic step jobs valid when no guidance has been selected", () => {
    expect(imageStepGenerationJobInput.parse({ projectId: 9, sessionId: 3, step: 1 }).distillationBinding).toBeUndefined();
  });
});
