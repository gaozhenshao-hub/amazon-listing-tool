import { describe, expect, it } from "vitest";
import {
  assertV8ProductionApplyAuthorized,
  buildSingleBulletV8Change,
  canonicalV8Json,
} from "../scripts/upgradeListingSingleBulletSkillsV8";

function row(slug: string) {
  return {
    slug,
    workspaceId: null,
    version: 7,
    status: "Released",
    modelOverride: null,
    name: "old",
    description: "old",
    manifest: {
      implementation: {
        modelPolicy: "teamo-claude-opus-5",
        qualityModelPolicy: "teamo-gpt-6-astra",
        systemPrompt: "old v7 prompt",
      },
      governance: { humanReviewRequired: true },
    },
  };
}

describe("单条卖点v8离线同步准备", () => {
  it("只准备两个单条Skill的v8固定信封，保留模型治理且不触发Provider或数据库", () => {
    const workflow = buildSingleBulletV8Change(row("listing.bullet.step.generate"));
    const manual = buildSingleBulletV8Change(row("listing.bullet.single"));
    const schema = workflow.manifest.contract?.outputSchema as any;

    expect(workflow.changed).toBe(true);
    expect(workflow.manifest.implementation?.systemPrompt).toBe(manual.manifest.implementation?.systemPrompt);
    expect(workflow.manifest.implementation?.systemPrompt).toContain("SINGLE_AMAZON_US_BULLET_V8");
    expect(workflow.manifest.implementation?.systemPrompt).toContain("confirmedFactRefs[]");
    expect(workflow.manifest.implementation?.systemPrompt).toContain("evidenceFactIds");
    expect(workflow.manifest.implementation?.modelPolicy).toBe("teamo-claude-opus-5");
    expect(workflow.manifest.implementation?.qualityModelPolicy).toBe("teamo-gpt-6-astra");
    expect(workflow.manifest.governance?.humanReviewRequired).toBe(true);
    expect(schema).toMatchObject({ type: "object", required: ["status", "candidate", "missingEvidence"] });
    expect(schema.properties.candidate.type).toEqual(["object", "null"]);
    expect(schema.properties.candidate.required).toContain("evidenceFactIds");
    expect(() => buildSingleBulletV8Change(row("listing.checklist.bullets"))).toThrow();
  });

  it("规范化JSON键序后幂等，并且草稿Skill拒绝升级", () => {
    const original = row("listing.bullet.single");
    const updated = buildSingleBulletV8Change(original);
    const next = {
      ...original,
      ...updated,
      manifest: JSON.parse(canonicalV8Json(updated.manifest)),
      version: 8,
    };
    expect(buildSingleBulletV8Change(next).changed).toBe(false);
    expect(() => buildSingleBulletV8Change({ ...original, status: "Draft" })).toThrow();
  });

  it("新信封解析器尚未接线时只允许预览，任何环境都禁止--apply", () => {
    expect(() => assertV8ProductionApplyAuthorized({ apply: false, runtimeEnvironment: "production" })).not.toThrow();
    expect(() => assertV8ProductionApplyAuthorized({ apply: true, runtimeEnvironment: "staging" })).toThrow("暂禁止 --apply");
    expect(() => assertV8ProductionApplyAuthorized({ apply: true, runtimeEnvironment: "production" })).toThrow("暂禁止 --apply");
    expect(() => assertV8ProductionApplyAuthorized({
      apply: true,
      runtimeEnvironment: "production",
      productionApproval: "approved",
    })).toThrow("暂禁止 --apply");
  });
});
