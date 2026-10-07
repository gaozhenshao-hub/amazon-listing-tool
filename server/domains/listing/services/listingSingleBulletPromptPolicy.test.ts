import { describe, expect, it } from "vitest";
import { LISTING_OGILVY_ROLE_MARKER } from "../../ai_os/services/highQualitySkillGovernance";
import { buildSingleBulletV6Change } from "../../../../scripts/upgradeListingSingleBulletSkillsV6";
import { buildSingleBulletV7Change } from "../../../../scripts/upgradeListingSingleBulletSkillsV7";
import { buildSingleBulletSkillManifest, SINGLE_BULLET_SKILL_SLUGS } from "./listingSingleBulletPromptPolicy";

function row(slug: string) {
  return { slug, workspaceId: null, version: 4, status: "Released", manifest: {
    implementation: { systemPrompt: `## ${LISTING_OGILVY_ROLE_MARKER}\nOld v3`, modelPolicy: "teamo-claude-opus-5" },
    contract: { mode: "async", timeoutMs: 90_000 }, governance: { humanReviewRequired: true },
  }, modelOverride: null, name: "旧版", description: "原文" };
}

describe("单条卖点v7统一Prompt Policy", () => {
  it("两个单条入口使用同一提示词：奥美角色/发现语义/任务层各一次，保留路由和人审", () => {
    const prompts = SINGLE_BULLET_SKILL_SLUGS.map((slug) => {
      const upgraded = buildSingleBulletSkillManifest(slug, row(slug).manifest);
      const prompt = upgraded.implementation?.systemPrompt || "";
      expect(prompt.match(new RegExp(LISTING_OGILVY_ROLE_MARKER, "g"))).toHaveLength(1);
      expect(prompt).toContain("AMAZON_DISCOVERY_AND_CONVERSATIONAL_COMMERCE_V1");
      expect(prompt).toContain("SINGLE_AMAZON_US_BULLET_V7");
      expect(prompt).toContain("FACT_SOURCE_AND_TEMPLATE_GUARD_V1");
      expect(prompt).toContain("a number in an example is not evidence");
      expect(prompt).toContain("FABE is an internal reasoning aid");
      expect(prompt).not.toContain("A9/A10算法排名逻辑");
      expect(upgraded.implementation?.modelPolicy).toBe("teamo-claude-opus-5");
      expect(upgraded.contract?.humanReviewRequired).toBe(true);
      expect(upgraded.contract?.automaticExecution).toBe("prohibited");
      const audit = (upgraded.contract?.outputSchema as any)?.properties?.qualityAudit;
      expect(audit?.required).toHaveLength(10);
      for (const key of audit.required) expect(audit.properties[key]).toEqual({ type: "boolean" });
      return prompt;
    });
    expect(prompts[0]).toBe(prompts[1]);
  });

  it("手动试写遵循v7；旧版15维自检Skill合同不受本次两Skill更新影响", () => {
    const manual = buildSingleBulletV7Change(row("listing.bullet.single"));
    expect(manual.name).toContain("试写");
    expect(manual.description).toContain("不驱动分步骤");
    const check = buildSingleBulletV6Change(row("listing.checklist.bullets"));
    expect(check.manifest.implementation?.systemPrompt).toContain("NATURAL_US_BULLET_CHECKLIST_V6");
    expect(check.manifest.implementation?.systemPrompt.match(new RegExp(LISTING_OGILVY_ROLE_MARKER, "g"))).toHaveLength(1);
    expect(check.manifest.implementation?.modelPolicy).toBe("teamo-claude-opus-5");
    expect(check.manifest.contract?.humanReviewRequired).toBe(true);
  });

  it("检查点更新是幂等的，缺失已发布Skill时失败关闭", () => {
    const original = row("listing.bullet.step.generate");
    const next = buildSingleBulletV7Change(original);
    expect(buildSingleBulletV7Change({ ...original, ...next, version: 5 }).changed).toBe(false);
    expect(() => buildSingleBulletV7Change({ ...original, status: "Draft" })).toThrow();
  });
});
