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

  it("场景备注、多图子模块和解锁后的内容在水合归一化时不丢失", () => {
    const source = {
      aPlusModules: [{
        moduleNumber: 1,
        selectedModuleType: "premium_rule_carousel",
        subModuleRemark: "4种场景：车库、庭院、露营、工地",
        subModuleCount: 4,
        subModules: [
          { subModuleNumber: 1, title: "车库", contentBrief: "车库密封场景", isLocked: true, lockedArtifactRef: "artifact:1.1" },
          { subModuleNumber: 2, title: "庭院", contentBrief: "庭院防尘场景", isLocked: false },
          { subModuleNumber: 3, title: "露营", contentBrief: "露营便携场景", isLocked: false },
          { subModuleNumber: 4, title: "工地", contentBrief: "工地耐用场景", isLocked: false },
        ],
      }],
    };

    const refreshed = normalizeImageOutline(source);
    expect(refreshed.aPlusModules[0]).toMatchObject({ subModuleRemark: "4种场景：车库、庭院、露营、工地", subModuleCount: 4 });
    expect(refreshed.aPlusModules[0].subModules.map((item: any) => item.title)).toEqual(["车库", "庭院", "露营", "工地"]);
    expect(refreshed.aPlusModules[0].subModules[0]).toMatchObject({ isLocked: true, lockedArtifactRef: "artifact:1.1", contentBrief: "车库密封场景" });

    const unlockedDraft = normalizeImageOutline({
      ...refreshed,
      aPlusModules: [{
        ...refreshed.aPlusModules[0],
        subModules: refreshed.aPlusModules[0].subModules.map((item: any, index: number) => index === 0 ? { ...item, isLocked: false } : item),
      }],
    });
    expect(unlockedDraft.aPlusModules[0].subModules[0]).toMatchObject({ title: "车库", contentBrief: "车库密封场景", isLocked: false, lockedArtifactRef: "artifact:1.1" });
  });
});
