import { describe, expect, it } from "vitest";
import { preserveLockedAplusSubmodules } from "./domains/image/step2AplusLockedSubmodules";

describe("Step2 A+模块重新优化锁定保护", () => {
  it("保留已锁定子图的完整内容、备注和Artifact，同时允许未锁定子图按新样式更新", () => {
    const result = preserveLockedAplusSubmodules(
      {
        subModuleRemark: "4种场景：车库、庭院、露营、工地",
        subModuleCount: 4,
        subModules: [
          { subModuleNumber: 1, title: "车库", contentBrief: "旧锁定内容", isLocked: true, lockedArtifactRef: "artifact:step2:1.1" },
          { subModuleNumber: 2, title: "庭院", contentBrief: "旧未锁定内容" },
        ],
      },
      {
        selectedModuleType: "premium_nav_carousel",
        subModules: [
          { subModuleNumber: 1, title: "模型新标题", contentBrief: "模型新内容" },
          { subModuleNumber: 2, title: "庭院新版", contentBrief: "模型新内容" },
          { subModuleNumber: 3, title: "露营新版" },
        ],
      },
    );

    expect(result.subModuleRemark).toBe("4种场景：车库、庭院、露营、工地");
    expect(result.subModuleCount).toBe(4);
    expect(result.subModules[0]).toMatchObject({ title: "车库", contentBrief: "旧锁定内容", isLocked: true, lockedArtifactRef: "artifact:step2:1.1" });
    expect(result.subModules[1]).toMatchObject({ title: "庭院新版", contentBrief: "模型新内容" });
    expect(result.subModules[2]).toMatchObject({ title: "露营新版" });
  });

  it("新样式没有返回已锁定子图时仍保留该子图", () => {
    const result = preserveLockedAplusSubmodules(
      { subModules: [{ subModuleNumber: 4, title: "工地", isLocked: true, lockedAt: "2026-08-17T00:00:00.000Z" }] },
      { subModules: [{ subModuleNumber: 1, title: "新子图" }] },
    );

    expect(result.subModules).toHaveLength(2);
    expect(result.subModules[1]).toMatchObject({ subModuleNumber: 4, title: "工地", isLocked: true });
  });
});
