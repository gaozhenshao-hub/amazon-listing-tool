import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { normalizeImageOutline } from "../shared/imageWorkflow";

const workflowStepsSource = readFileSync(
  resolve(process.cwd(), "server/domains/image/routers/workflowSteps.ts"),
  "utf8",
);

describe("Step2整体确认路由契约", () => {
  it("未锁定草稿保存会规范化并持久化step2UserEdit，锁定后拒绝覆盖草稿", () => {
    const draftBlock = workflowStepsSource.slice(
      workflowStepsSource.indexOf("saveStep2Draft: protectedProcedure"),
      workflowStepsSource.indexOf("// ─── Step 2: Save user edits and confirm"),
    );

    expect(draftBlock).toContain("if (session.step2Confirmed)");
    expect(draftBlock).toContain("图片大纲已锁定，请先点击“解锁编辑”后再保存草稿");
    expect(draftBlock).toContain("const normalized = normalizeImageOutline(parsed)");
    expect(draftBlock).toContain("step2UserEdit: JSON.stringify(normalized)");
    expect(draftBlock).toContain("currentStep: 2");
    expect(draftBlock).toContain("return { outline: normalized }");
  });

  it("确认前将场景子图规范化，并将同一快照保存及发布给后续步骤", () => {
    const confirmBlock = workflowStepsSource.slice(
      workflowStepsSource.indexOf("confirmStep2: protectedProcedure"),
      workflowStepsSource.indexOf("// ─── Step 2: Lock a single image"),
    );

    expect(confirmBlock).toContain("const normalized = normalizeImageOutline(parsed)");
    expect(confirmBlock).toContain("step2UserEdit: JSON.stringify(normalized)");
    expect(confirmBlock).toContain("step2Confirmed: 1");
    expect(confirmBlock).toContain("aiResult: normalized");
    expect(confirmBlock).toContain("userEdit: normalized");
  });

  it("确认快照会把历史单字场景内容恢复为完整标题，并保留锁定资产", () => {
    const normalized = normalizeImageOutline({
      aPlusModules: [{
        moduleNumber: 5,
        selectedModuleType: "premium_rule_carousel",
        subModuleRemark: "4种场景：车库、庭院、露营、工地",
        subModuleCount: 4,
        subModules: ["车库", "庭院", "露营", "工地"].map((title, index) => ({
          subModuleNumber: index + 1,
          title,
          contentBrief: `展示产品在“${index === 0 ? "场" : title.charAt(0)}”中的核心价值、使用方式或结果。`,
          isLocked: index === 0,
          lockedArtifactRef: index === 0 ? "artifact-step2-5-1" : null,
        })),
      }],
    });

    expect(normalized.aPlusModules[0].subModules[0]).toMatchObject({
      title: "车库",
      contentBrief: "展示产品在“车库”中的核心价值、使用方式或结果。",
      isLocked: true,
      lockedArtifactRef: "artifact-step2-5-1",
    });
  });

  it("草稿回读会保留场景备注、完整标题与已锁定子图资产", () => {
    const rehydrated = normalizeImageOutline({
      aPlusModules: [{
        moduleNumber: 5,
        subModuleRemark: "4种场景：车库、庭院、露营、工地",
        subModuleCount: 4,
        subModules: ["车库", "庭院", "露营", "工地"].map((title, index) => ({
          subModuleNumber: index + 1,
          title,
          purpose: `围绕“${title}”展开`,
          contentBrief: `展示产品在“${title}”中的核心价值、使用方式或结果。`,
          isLocked: index === 1,
          lockedArtifactRef: index === 1 ? "artifact-step2-5-2" : null,
        })),
      }],
    });

    expect(rehydrated.aPlusModules[0]).toMatchObject({
      subModuleRemark: "4种场景：车库、庭院、露营、工地",
      subModuleCount: 4,
    });
    expect(rehydrated.aPlusModules[0].subModules[1]).toMatchObject({
      title: "庭院",
      isLocked: true,
      lockedArtifactRef: "artifact-step2-5-2",
    });
  });
});
