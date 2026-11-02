import { describe, expect, it } from "vitest";
import { buildSingleBulletV6Change, canonicalJson } from "../scripts/upgradeListingSingleBulletSkillsV6";

describe("单条卖点v6 Skill升级脚本", () => {
  it("MySQL JSON字段重排对象键后仍识别相同配置", () => {
    expect(canonicalJson({ implementation: { temperature: 0.25, systemPrompt: "x" }, contract: { type: "object" } }))
      .toBe(canonicalJson({ contract: { type: "object" }, implementation: { systemPrompt: "x", temperature: 0.25 } }));
  });

  it("同版本的手动试写Skill无语义变更时不重复发布", () => {
    const original = { slug: "listing.bullet.single", workspaceId: null, version: 7,
      status: "Released", manifest: {}, modelOverride: null, name: "旧名称", description: null };
    const next = buildSingleBulletV6Change(original);
    const row = { ...original, name: next.name, description: next.description,
      manifest: JSON.parse(canonicalJson(next.manifest)) };
    expect(buildSingleBulletV6Change(row).changed).toBe(false);
    expect(buildSingleBulletV6Change({ ...row, name: "过期名称" }).changed).toBe(true);
  });
});
