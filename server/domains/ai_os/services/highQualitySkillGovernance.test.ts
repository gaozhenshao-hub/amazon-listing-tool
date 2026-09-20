import { describe, expect, it } from "vitest";
import {
  HIGH_QUALITY_GOVERNANCE_MARKER,
  HIGH_QUALITY_QUALITY_MODEL,
  HIGH_QUALITY_SKILL_SLUGS,
  LISTING_OGILVY_ROLE_MARKER,
  applyListingOgilvyRole,
  buildGovernedHighQualityManifest,
  getHighQualitySkillGovernance,
} from "./highQualitySkillGovernance";

describe("high-quality Skill governance contract", () => {
  it("pins the reviewed 80-Skill boundary", () => {
    expect(HIGH_QUALITY_SKILL_SLUGS.size).toBe(80);
    expect(HIGH_QUALITY_SKILL_SLUGS.has("listing.bullets.generate")).toBe(true);
    expect(HIGH_QUALITY_SKILL_SLUGS.has("ad.budget.allocation")).toBe(true);
    expect(HIGH_QUALITY_SKILL_SLUGS.has("dev.analysis.product")).toBe(true);
  });

  it("adds governance as manifest metadata without appending it to task prompts", () => {
    const result = buildGovernedHighQualityManifest({
      slug: "listing.bullets.generate",
      modelOverride: "teamo-gpt-6-astra",
      manifest: {
        implementation: {
          systemPrompt: "Keep the reviewed Ogilvy task boundary.",
          userPromptTemplate: "{{context}}",
          modelPolicy: "deepseek-chat",
        },
      },
    });

    expect(result.modelOverride).toBe("teamo-gpt-6-astra");
    expect(result.manifest.implementation?.modelPolicy).toBe("teamo-gpt-6-astra");
    expect(result.manifest.implementation?.qualityModelPolicy).toBe(HIGH_QUALITY_QUALITY_MODEL);
    expect(result.manifest.implementation?.supportsJsonMode).toBe(true);
    expect(result.manifest.implementation?.systemPrompt).not.toContain(HIGH_QUALITY_GOVERNANCE_MARKER);
    expect(result.manifest.implementation?.systemPrompt).toContain(LISTING_OGILVY_ROLE_MARKER);
    expect(result.manifest.contract).toMatchObject({
      outputMode: "json_draft",
      humanReviewRequired: true,
      automaticExecution: "prohibited",
    });
    expect(result.manifest.governance).toMatchObject({
      draft: true,
      recommendationOnly: true,
      humanReviewRequired: true,
      evidencePolicy: "input_only",
    });
  });

  it("keeps non-Listing task prompts intact and gives every Listing task the same Ogilvy role layer", () => {
    const bulletRefine = buildGovernedHighQualityManifest({
      slug: "listing.bullet.refine",
      modelOverride: "teamo-claude-opus-5",
      manifest: { implementation: { systemPrompt: "legacy conflict", userPromptTemplate: "{{context}}" } },
    });
    expect(bulletRefine.manifest.implementation?.systemPrompt).toContain("legacy conflict");
    expect(bulletRefine.manifest.implementation?.systemPrompt).toContain(LISTING_OGILVY_ROLE_MARKER);

    const productAnalysis = buildGovernedHighQualityManifest({
      slug: "dev.analysis.product",
      modelOverride: "teamo-gpt-5-5",
      manifest: { implementation: { systemPrompt: "Return ```json\n{}\n```", userPromptTemplate: "{{context}}" } },
    });
    expect(productAnalysis.manifest.implementation?.systemPrompt).toContain("```json");
    expect(productAnalysis.manifest.implementation?.systemPrompt).not.toContain(HIGH_QUALITY_GOVERNANCE_MARKER);

    expect(applyListingOgilvyRole("listing.title.generate", "original task")).toContain(LISTING_OGILVY_ROLE_MARKER);
    expect(applyListingOgilvyRole("ad.chatbot", "original task")).toBe("original task");
  });

  it("classifies operational and decision Skills as review-only", () => {
    expect(getHighQualitySkillGovernance("ad.budget.allocation")).toMatchObject({
      kind: "operational_recommendation",
      humanReviewRequired: true,
      automaticExecution: "prohibited",
    });
    expect(getHighQualitySkillGovernance("dev.market.opportunity")).toMatchObject({
      kind: "decision_advisory",
      humanReviewRequired: true,
    });
    expect(getHighQualitySkillGovernance("unmanaged.skill")).toBeNull();
  });
});
