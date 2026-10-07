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
import {
  EVALUATE_TITLE_CHECKLIST_PROMPT,
  TITLE_GENERATION_PROMPT,
} from "../../../prompts";

function createCompleteScorecard(kind: keyof typeof LISTING_CHECKLIST_DIMENSIONS) {
  return Object.fromEntries(
    LISTING_CHECKLIST_DIMENSIONS[kind].map((key) => [key, {
      pass: true,
      notes: "Grounded evaluation",
      reason: "The required quality signal is present.",
      suggestion: "",
      evidenceQuote: "Observed signal",
    }]),
  );
}

function promptScoreKeys(prompt: string): string[] {
  const responseExample = prompt.slice(prompt.lastIndexOf("Respond in JSON format:"));
  return Array.from(
    responseExample.matchAll(/^\s{4}"([^"]+)": \{ "pass":/gm),
    ([, key]) => key,
  );
}

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

  it("rejects a failed bullet dimension without a quote or explicit missing-evidence marker", () => {
    const checkListScores = Object.fromEntries(
      LISTING_CHECKLIST_DIMENSIONS.bullets.map((key) => [key, {
        pass: key !== "subtitle", notes: "Observed", reason: "Missing information",
        suggestion: "Edit the lead-in", evidenceQuote: "",
      }]),
    );
    expect(parseCompleteListingChecklist({ checkListScores }, "bullets")).toBeNull();
    checkListScores.subtitle.evidenceQuote = "No supporting evidence supplied";
    expect(parseCompleteListingChecklist({ checkListScores }, "bullets")).not.toBeNull();
  });

  it("rejects empty arrays and objects for a title scorecard", () => {
    expect(parseCompleteListingChecklist([], "title")).toBeNull();
    expect(parseCompleteListingChecklist({ checkListScores: [] }, "title")).toBeNull();
    expect(parseCompleteListingChecklist({ checkListScores: {} }, "title")).toBeNull();
  });

  it("accepts a complete title scorecard with the canonical 10 keys", () => {
    const checkListScores = createCompleteScorecard("title");
    const result = parseCompleteListingChecklist({ checkListScores }, "title");

    expect(Object.keys(result?.checkListScores || {})).toEqual([...LISTING_CHECKLIST_DIMENSIONS.title]);
  });

  it("rejects the legacy bundlePack key because it omits required noRepetition", () => {
    const checkListScores = createCompleteScorecard("title");
    checkListScores.bundlePack = checkListScores.noRepetition;
    delete checkListScores.noRepetition;

    expect(parseCompleteListingChecklist({ checkListScores }, "title")).toBeNull();
  });

  it("rejects a failed title dimension without both an actionable reason and suggestion", () => {
    const checkListScores = createCompleteScorecard("title");
    checkListScores.noRepetition = {
      ...checkListScores.noRepetition,
      pass: false,
      reason: "",
      suggestion: "Remove duplicated non-essential words from Layer 2.",
    };
    expect(parseCompleteListingChecklist({ checkListScores }, "title")).toBeNull();

    checkListScores.noRepetition.reason = "The word 'portable' appears in both layers.";
    checkListScores.noRepetition.suggestion = "";
    expect(parseCompleteListingChecklist({ checkListScores }, "title")).toBeNull();

    checkListScores.noRepetition.suggestion = "Remove 'portable' from Layer 2 if its meaning remains clear.";
    expect(parseCompleteListingChecklist({ checkListScores }, "title")).not.toBeNull();
  });
});

describe("Title checklist prompt contract", () => {
  it.each([
    ["evaluator", EVALUATE_TITLE_CHECKLIST_PROMPT],
    ["generation self-check", TITLE_GENERATION_PROMPT],
  ])("uses exactly the canonical title keys in the %s response example", (_name, prompt) => {
    expect(promptScoreKeys(prompt)).toEqual([...LISTING_CHECKLIST_DIMENSIONS.title]);
    expect(prompt).not.toContain('"bundlePack"');
  });

  it("evaluates a multi-pack quantity as content coverage rather than replacing noRepetition", () => {
    expect(EVALUATE_TITLE_CHECKLIST_PROMPT).toContain("contentCoverage");
    expect(EVALUATE_TITLE_CHECKLIST_PROMPT).toContain("multi-pack or bundle");
    expect(EVALUATE_TITLE_CHECKLIST_PROMPT).toContain("noRepetition");
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
