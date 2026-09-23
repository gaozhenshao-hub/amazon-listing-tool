import { describe, expect, it } from "vitest";
import {
  LISTING_CHECKLIST_DIMENSIONS,
  parseCompleteListingChecklist,
} from "./checklistContracts";
import {
  LISTING_CHECKLIST_SKILL_POLICIES,
  buildListingChecklistSkillManifest,
} from "./listingChecklistSkillPolicy";
import { HIGH_QUALITY_QUALITY_MODEL } from "../../ai_os/services/highQualitySkillGovernance";

describe("Listing checklist response contracts", () => {
  it("accepts only a complete 15-dimension bullet scorecard", () => {
    const checkListScores = Object.fromEntries(
      LISTING_CHECKLIST_DIMENSIONS.bullets.map((key) => [key, { pass: true, notes: "Grounded evaluation" }]),
    );
    const result = parseCompleteListingChecklist({ checkListScores }, "bullets");
    expect(result?.checkListScores).toEqual(checkListScores);
  });

  it("rejects an empty scorecard instead of treating it as 0/15", () => {
    expect(parseCompleteListingChecklist({ checkListScores: {} }, "bullets")).toBeNull();
  });

  it("rejects a schema-drifted QA scorecard", () => {
    const scores = Object.fromEntries(
      LISTING_CHECKLIST_DIMENSIONS.qa.map((key) => [key, { pass: true, notes: "OK" }]),
    );
    delete scores.semanticRelation;
    scores.semanticRelations = { pass: true, notes: "Wrong key" };
    expect(parseCompleteListingChecklist({ checkListScores: scores }, "qa")).toBeNull();
  });
});

describe("Listing checklist Skill policy", () => {
  it("sets every listing checklist to structured GPT-6 quality evaluation", () => {
    for (const policy of LISTING_CHECKLIST_SKILL_POLICIES) {
      const manifest = buildListingChecklistSkillManifest(policy, { implementation: { maxTokens: 512 } });
      expect(manifest.implementation?.supportsJsonMode).toBe(true);
      expect(manifest.implementation?.qualityModelPolicy).toBe(HIGH_QUALITY_QUALITY_MODEL);
      expect(manifest.implementation?.evaluationModelPolicy).toBe(HIGH_QUALITY_QUALITY_MODEL);
      expect(manifest.implementation?.systemPrompt).toContain("checkListScores");
      expect((manifest.contract?.outputSchema as { properties?: { checkListScores?: { required?: string[] } } })
        ?.properties?.checkListScores?.required).toEqual([...LISTING_CHECKLIST_DIMENSIONS[policy.kind]]);
    }
  });
});
