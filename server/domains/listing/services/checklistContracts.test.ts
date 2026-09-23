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
      LISTING_CHECKLIST_DIMENSIONS.bullets.map((key) => [key, {
        pass: true,
        notes: "Grounded evaluation",
        reason: "The required quality signal is present.",
        suggestion: "",
        evidenceQuote: "Observed signal",
      }]),
    );
    const result = parseCompleteListingChecklist({ checkListScores }, "bullets");
    expect(result?.checkListScores).toEqual(checkListScores);
  });

  it("rejects an empty scorecard instead of treating it as 0/15", () => {
    expect(parseCompleteListingChecklist({ checkListScores: {} }, "bullets")).toBeNull();
  });

  it("rejects a schema-drifted QA scorecard", () => {
    const scores = Object.fromEntries(
      LISTING_CHECKLIST_DIMENSIONS.qa.map((key) => [key, {
        pass: true,
        notes: "OK",
        reason: "Observed signal",
        suggestion: "",
        evidenceQuote: "",
      }]),
    );
    delete scores.semanticRelation;
    scores.semanticRelations = { pass: true, notes: "Wrong key", reason: "Wrong key", suggestion: "", evidenceQuote: "" };
    expect(parseCompleteListingChecklist({ checkListScores: scores }, "qa")).toBeNull();
  });

  it("rejects a failed dimension that has no actionable reason and recommendation", () => {
    const checkListScores = Object.fromEntries(
      LISTING_CHECKLIST_DIMENSIONS.bullets.map((key) => [key, {
        pass: key !== "subtitle",
        notes: key === "subtitle" ? "The heading is too long." : "OK",
        reason: key === "subtitle" ? "" : "Observed signal",
        suggestion: "",
        evidenceQuote: "",
      }]),
    );
    expect(parseCompleteListingChecklist({ checkListScores }, "bullets")).toBeNull();
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
      const scoreProperties = ((manifest.contract?.outputSchema as {
        properties?: { checkListScores?: { properties?: Record<string, { required?: string[] }> } }
      })?.properties?.checkListScores?.properties) || {};
      for (const dimension of LISTING_CHECKLIST_DIMENSIONS[policy.kind]) {
        expect(scoreProperties[dimension]?.required).toEqual(["pass", "notes", "reason", "suggestion", "evidenceQuote"]);
      }
    }
  });
});
