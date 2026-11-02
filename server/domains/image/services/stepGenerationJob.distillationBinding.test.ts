import { describe, expect, it } from "vitest";
import { imageStepGenerationJobInput } from "./stepGenerationJob";

const confirmedFence = { actorRole: "super_admin", scopeRevision: 2, upstreamDigest: "a".repeat(64) };

describe("imageStepGenerationJobInput distillation binding", () => {
  it("accepts an explicit locked-ledger and released-skill binding for audit propagation", () => {
    const parsed = imageStepGenerationJobInput.parse({
      projectId: 9,
      sessionId: 3,
      step: 2,
      ...confirmedFence,
      distillationBinding: { ledgerKey: "ledger-locked-v2", skillSlugs: ["image.outline.storyboard.plan"] },
    });
    expect(parsed.distillationBinding).toEqual({ ledgerKey: "ledger-locked-v2", skillSlugs: ["image.outline.storyboard.plan"] });
  });

  it("蒸馏指导可为空，但历史作业缺版本fence时必须失败关闭", () => {
    expect(imageStepGenerationJobInput.parse({ projectId: 9, sessionId: 3, step: 1, ...confirmedFence }).distillationBinding)
      .toBeUndefined();
    expect(() => imageStepGenerationJobInput.parse({ projectId: 9, sessionId: 3, step: 1 })).toThrow();
  });
});
