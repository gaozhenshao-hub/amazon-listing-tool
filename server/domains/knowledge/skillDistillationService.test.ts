import { describe, expect, it } from "vitest";
import { defaultManifestForSkillType, getDistillationCatalog } from "./skillDistillationCatalog";
import { assertSkillDistillationGovernor } from "./skillDistillationAuthorization";

describe("knowledge skill distillation governance", () => {
  it("exposes blueprint-only catalog entries and never labels them as auto-running", () => {
    const catalog = getDistillationCatalog();
    expect(catalog).toHaveLength(22);
    expect(catalog.every((entry) => entry.lifecycle === "blueprint_only")).toBe(true);
    expect(catalog.find((entry) => entry.skillTypeKey === "image.prompt-brief.plan")?.workflowNodes).toContain("图片 Step 6：提示词");
  });

  it("uses an approved-evidence-only review-required manifest default", () => {
    const manifest = defaultManifestForSkillType("listing.bullet.fabe.plan");
    expect(manifest.implementation.knowledge.source).toBe("approved_evidence_only");
    expect(manifest.contract.mode).toBe("review_required");
  });

  it("limits distillation governance to super administrators", () => {
    expect(() => assertSkillDistillationGovernor({ role: "super_admin" })).not.toThrow();
    expect(() => assertSkillDistillationGovernor({ role: "admin" })).toThrow("仅允许超级管理员");
  });
});
