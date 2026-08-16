import { describe, expect, it } from "vitest";
import { normalizeImageOutline } from "../shared/imageWorkflow";

describe("多图A+子图锁定状态", () => {
  it("归一化多图A+大纲时保留子图锁定字段", () => {
    const normalized = normalizeImageOutline({
      aPlusModules: [{
        moduleNumber: 1,
        selectedModuleType: "premium_nav_carousel",
        subModules: [{
          subModuleNumber: 1,
          title: "Zero Leakage",
          isLocked: true,
          lockedAt: "2026-08-16T07:24:11.000Z",
          lockedBy: 1,
          lockedArtifactRef: "artifact:image.workflow.step.2.aplus.1.1@1",
        }],
      }],
    });

    const child = normalized.aPlusModules[0].subModules[0];
    expect(child.isLocked).toBe(true);
    expect(child.lockedAt).toBe("2026-08-16T07:24:11.000Z");
    expect(child.lockedBy).toBe(1);
    expect(child.lockedArtifactRef).toBe("artifact:image.workflow.step.2.aplus.1.1@1");
  });
});
