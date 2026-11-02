import { describe, expect, it } from "vitest";
import { buildSingleBulletV7Change } from "../scripts/upgradeListingSingleBulletSkillsV7";
import { canonicalJson } from "../scripts/upgradeListingSingleBulletSkillsV6";

function row(slug: string) {
  return { slug, workspaceId: null, version: 6, status: "Released", modelOverride: null,
    name: "old", description: "old", manifest: { implementation: { modelPolicy: "teamo-claude-opus-5", qualityModelPolicy: "teamo-gpt-6-astra", systemPrompt: "old" },
      governance: { humanReviewRequired: true } } };
}

describe("单条卖点v7受控Skill升级", () => {
  it("只允许两项单条Skill，保留原模型治理策略，自检Skill不被重复更新", () => {
    const workflow = buildSingleBulletV7Change(row("listing.bullet.step.generate"));
    const manual = buildSingleBulletV7Change(row("listing.bullet.single"));
    expect(workflow.changed).toBe(true);
    expect(workflow.manifest.implementation?.systemPrompt).toBe(manual.manifest.implementation?.systemPrompt);
    expect(workflow.manifest.implementation?.systemPrompt).toContain("FACT_SOURCE_AND_TEMPLATE_GUARD_V1");
    expect(workflow.manifest.implementation?.qualityModelPolicy).toBe("teamo-gpt-6-astra");
    expect(workflow.manifest.governance?.humanReviewRequired).toBe(true);
    expect(() => buildSingleBulletV7Change(row("listing.checklist.bullets"))).toThrow();
  });

  it("规范化JSON键序后升级幂等，状态不符时拒绝变更", () => {
    const original = row("listing.bullet.single");
    const updated = buildSingleBulletV7Change(original);
    const next = { ...original, ...updated, manifest: JSON.parse(canonicalJson(updated.manifest)), version: 7 };
    expect(buildSingleBulletV7Change(next).changed).toBe(false);
    expect(() => buildSingleBulletV7Change({ ...original, status: "Draft" })).toThrow();
  });
});
