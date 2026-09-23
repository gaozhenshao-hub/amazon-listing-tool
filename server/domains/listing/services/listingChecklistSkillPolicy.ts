import {
  EVALUATE_BULLET_CHECKLIST_PROMPT,
  EVALUATE_DESCRIPTION_CHECKLIST_PROMPT,
  EVALUATE_QA_CHECKLIST_PROMPT,
  EVALUATE_SEARCH_TERMS_CHECKLIST_PROMPT,
  EVALUATE_TITLE_CHECKLIST_PROMPT,
} from "../../../prompts";
import {
  applyListingOgilvyRole,
  HIGH_QUALITY_QUALITY_MODEL,
  type GovernedSkillManifest,
} from "../../ai_os/services/highQualitySkillGovernance";
import { LISTING_CHECKLIST_DIMENSIONS, type ListingChecklistKind } from "./checklistContracts";

export type ListingChecklistSkillPolicy = {
  slug: string;
  kind: ListingChecklistKind;
  prompt: string;
};

export const LISTING_CHECKLIST_SKILL_POLICIES: readonly ListingChecklistSkillPolicy[] = [
  { slug: "listing.checklist.bullets", kind: "bullets", prompt: EVALUATE_BULLET_CHECKLIST_PROMPT },
  { slug: "listing.checklist.title", kind: "title", prompt: EVALUATE_TITLE_CHECKLIST_PROMPT },
  { slug: "listing.checklist.description", kind: "description", prompt: EVALUATE_DESCRIPTION_CHECKLIST_PROMPT },
  { slug: "listing.checklist.searchterms", kind: "searchterms", prompt: EVALUATE_SEARCH_TERMS_CHECKLIST_PROMPT },
  { slug: "listing.checklist.qa", kind: "qa", prompt: EVALUATE_QA_CHECKLIST_PROMPT },
];

export function buildListingChecklistSkillManifest(
  policy: ListingChecklistSkillPolicy,
  currentManifest: GovernedSkillManifest,
): GovernedSkillManifest {
  const implementation = { ...(currentManifest.implementation || {}) };
  implementation.systemPrompt = applyListingOgilvyRole(policy.slug, policy.prompt);
  implementation.userPromptTemplate = "{{context}}";
  implementation.supportsJsonMode = true;
  implementation.qualityModelPolicy = HIGH_QUALITY_QUALITY_MODEL;
  implementation.evaluationModelPolicy = HIGH_QUALITY_QUALITY_MODEL;
  implementation.maxTokens = Math.max(1800, Number(implementation.maxTokens || 0));
  implementation.temperature = 0;

  const dimensions = LISTING_CHECKLIST_DIMENSIONS[policy.kind];
  const scoreProperties = Object.fromEntries(
    dimensions.map((dimension) => [
      dimension,
      {
        type: "object",
        required: ["pass", "notes", "reason", "suggestion", "evidenceQuote"],
      },
    ]),
  );
  return {
    ...currentManifest,
    implementation,
    contract: {
      ...(currentManifest.contract || {}),
      outputMode: "json_draft",
      humanReviewRequired: true,
      automaticExecution: "prohibited",
      outputSchema: {
        type: "object",
        required: ["checkListScores"],
        properties: {
          checkListScores: {
            type: "object",
            required: [...dimensions],
            properties: scoreProperties,
          },
        },
      },
    },
  };
}
