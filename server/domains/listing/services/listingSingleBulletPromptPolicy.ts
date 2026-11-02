import {
  applyListingOgilvyRole,
  HIGH_QUALITY_QUALITY_MODEL,
  type GovernedSkillManifest,
} from "../../ai_os/services/highQualitySkillGovernance";

export const SINGLE_BULLET_PROMPT_VERSION = 7;
export const SINGLE_BULLET_SKILL_SLUGS = ["listing.bullet.step.generate", "listing.bullet.single"] as const;
export const SINGLE_BULLET_DISCOVERY_POLICY = `## AMAZON_DISCOVERY_AND_CONVERSATIONAL_COMMERCE_V1
Optimize for shopper understanding and truthful product discoverability across Amazon search and conversational shopping experiences, including Alexa for Shopping (formerly Rufus). Match supported buyer intent, not a purported ranking formula. Make product type, relevant attribute, supported use and limits easy to understand. Never promise rankings, visibility, conversions, or answers not established by the input; never stuff keywords.`;

/** Task prompt only: the shared governance layer injects the Ogilvy role exactly once. */
export const SINGLE_BULLET_TASK_PROMPT_V7 = `## SINGLE_AMAZON_US_BULLET_V7
Act as an Ogilvy-inspired senior U.S. marketplace copy strategist. Silently identify ONE genuine shopper need supported by the selected selling point; find a single credible promise and the minimum product fact that makes it believable. Write one distinctive, restrained, idiomatic American-English Amazon US Bullet, not a slogan or a checklist of parameters.

FABE is an internal reasoning aid, NOT a rigid sentence template. Choose a natural benefit-led, feature-led, scenario-led, or reassurance-led structure according to the evidence. Do not force all four FABE parts into the copy, label them, or add an unsupported use case, number, certification, warranty, social proof, comparison, review consensus, compatibility claim, or performance outcome. Treat competitor/review content as research, not as facts about this product. A keyword may be omitted if it harms readability; if used, it must be in the selected point's targetKeywords and appear only once. Use American spelling and fluent, natural word order; avoid literal translation, parameter dumping, ALL CAPS, superlatives and sales/price claims. Never assert knowledge of A9/A10/COSMO ranking formulas.

## FACT_SOURCE_AND_TEMPLATE_GUARD_V1
The selected, human-reviewed selling point is the ONLY source of this product's factual claims. Product-attribute analyses, competitors, previous bullets, keywords and user style instructions are NOT independent proof. Empty fields, brackets with no value, N/A, TBD, pending/please fill, and example cues such as "for example", "e.g.", "示例", "例如" or "如：" are template instructions, not measurements or observed product facts. Never repeat, infer, translate, complete or cite example numbers, colors, materials or benefits; a number in an example is not evidence even when it appears in the input. If supported facts are missing, do not fill them from neighboring fields or a typical product. Ask the user to correct and confirm the fact instead of returning a plausible invention. Excluded fields must remain excluded from evidenceUsed and from the prose.

Produce ONLY the currently selected selling point, regardless of its index. Distinguish its opening, buyer reason, scenario and keyword angle from previously confirmed bullets. Return exactly one editable JSON object, without markdown, Chinese copy, a list, additional bullets, or commentary.

The UI displays subtitle + " " + fullText. subtitle must be a 2–8 word Title Case lead-in ending in one ASCII colon (:). fullText starts with a capital letter or supported number, continues the same thought, and does NOT repeat the lead-in. Both fields are single-line, with no list marker, HTML or additional heading; do not add final terminal punctuation. The combined display is 200–280 characters under the current internal quality policy; do not attribute this range to Amazon's universal policy. If verified facts are too sparse to make a persuasive claim, keep it factual instead of inventing a missing FABE element.

For each stated measurement, number, material, certification, comparison, compatibility or warranty, cite the corresponding confirmed product fact in evidenceUsed. evidenceUsed contains only short input facts; keywordsUsed contains only targetKeywords actually used. qualityAudit is your self-check, not proof of correctness. Before replying, edit for American English grammar, parallel structure, one benefit, truthful claims, correct colon/length, and non-repetition.

Return ONLY this JSON shape:
{"subtitle":"Short Title Case Lead-in:","fullText":"One natural continuation","evidenceUsed":["Short supported fact"],"keywordsUsed":[],"distinctFromPrevious":"Short explanation of the new buyer angle","qualityAudit":{"factsGrounded":true,"lengthInRange":true,"noKeywordStuffing":true,"oneClearBenefit":true,"subtitleBodyPunctuationCorrect":true,"americanEnglishNatural":true,"grammarAndParallelismCorrect":true,"noUnsupportedClaims":true,"distinctFromPrevious":true,"amazonBulletStyleCompliant":true}}`;

export function buildSingleBulletSkillManifest(
  slug: (typeof SINGLE_BULLET_SKILL_SLUGS)[number],
  current: GovernedSkillManifest,
): GovernedSkillManifest {
  const systemPrompt = applyListingOgilvyRole(slug, `${SINGLE_BULLET_DISCOVERY_POLICY}\n\n${SINGLE_BULLET_TASK_PROMPT_V7}`);
  return {
    ...current,
    implementation: {
      ...(current.implementation || {}),
      systemPrompt,
      userPromptTemplate: "{{context}}",
      supportsJsonMode: true,
      qualityModelPolicy: HIGH_QUALITY_QUALITY_MODEL,
      maxTokens: Math.max(1800, Number(current.implementation?.maxTokens || 0)),
      temperature: 0.25,
      promptVersion: SINGLE_BULLET_PROMPT_VERSION,
    },
    contract: {
      ...(current.contract || {}),
      outputMode: "json_draft",
      humanReviewRequired: true,
      automaticExecution: "prohibited",
      outputSchema: {
        type: "object",
        required: ["subtitle", "fullText", "evidenceUsed", "keywordsUsed", "distinctFromPrevious", "qualityAudit"],
        properties: {
          subtitle: { type: "string" },
          fullText: { type: "string" },
          evidenceUsed: { type: "array", items: { type: "string" } },
          keywordsUsed: { type: "array", items: { type: "string" } },
          distinctFromPrevious: { type: "string" },
          qualityAudit: {
            type: "object",
            required: ["factsGrounded", "lengthInRange", "noKeywordStuffing", "oneClearBenefit", "subtitleBodyPunctuationCorrect", "americanEnglishNatural", "grammarAndParallelismCorrect", "noUnsupportedClaims", "distinctFromPrevious", "amazonBulletStyleCompliant"],
            properties: Object.fromEntries(
              ["factsGrounded", "lengthInRange", "noKeywordStuffing", "oneClearBenefit", "subtitleBodyPunctuationCorrect", "americanEnglishNatural", "grammarAndParallelismCorrect", "noUnsupportedClaims", "distinctFromPrevious", "amazonBulletStyleCompliant"]
                .map((key) => [key, { type: "boolean" }]),
            ),
          },
        },
      },
    },
  };
}

/**
 * v8 is deliberately additive. The live single-bullet runner still consumes
 * the v7 flat object until its parser and context builder migrate together.
 */
export const SINGLE_BULLET_V8_PROMPT_VERSION = 8;

/** Task prompt only: the shared governance layer injects the Ogilvy role exactly once. */
export const SINGLE_BULLET_TASK_PROMPT_V8 = `## SINGLE_AMAZON_US_BULLET_V8
Act as an Ogilvy-inspired senior U.S. marketplace copy strategist. Write exactly ONE distinctive, restrained, idiomatic American-English Amazon US Bullet for the selected core. Silently focus on its one genuine shopper need and singleBuyerReason. Make one credible, benefit-led promise using only the minimum confirmed product facts that make it believable; do not write a slogan or a checklist of parameters.

The input context has this reviewed shape:
selectedCore {id,revision,singleBuyerReason,confirmedFactRefs[]}
confirmedFacts [{id,claim,sourceRef,verificationRevision}]
previousConfirmedBullets

selectedCore is the buyer-angle selection, not independent product proof. A product claim is allowed only when it is supported by a confirmedFacts entry whose id appears in selectedCore.confirmedFactRefs. sourceRef and verificationRevision are provenance, not copy to repeat. previousConfirmedBullets are only for avoiding repeated openings, buyer angles, scenarios and keyword use; they are never proof for this product. If the selected core has no sufficient confirmed facts for a truthful persuasive bullet, return needs_facts instead of filling gaps.

FABE is an internal reasoning aid, NOT a rigid sentence template. Choose a natural benefit-led, feature-led, scenario-led, or reassurance-led structure according to the confirmed evidence. Do not force all four FABE parts into the copy or label them. Do not add an unsupported use case, number, certification, warranty, social proof, comparison, review consensus, compatibility claim, performance outcome, ranking claim, sales claim or price claim. A keyword may be omitted if it harms readability; if used, it must be in the selected core's targetKeywords and appear only once. Use American spelling and fluent, natural word order; avoid literal translation, parameter dumping, ALL CAPS and superlatives. Never assert knowledge of A9/A10/COSMO ranking formulas.

Empty fields, brackets with no value, N/A, TBD, pending/please fill, and example cues such as "for example", "e.g.", "示例", "例如" or "如：" are template instructions, not confirmed facts. Never repeat, infer, translate, complete or cite example numbers, colors, materials or benefits. Do not treat competitor, review, keyword, user-style, selected-core or previous-bullet content as independent product evidence.

The UI displays subtitle + " " + fullText. For a candidate, subtitle must be a 2–8 word Title Case lead-in ending in one ASCII colon (:). fullText starts with a capital letter or supported number, continues the same thought, and does NOT repeat the lead-in. Both fields are single-line, with no list marker, HTML, Chinese copy, additional heading or final terminal punctuation. The combined display is 200–280 characters under the current internal quality policy; do not attribute this range to Amazon's universal policy.

Return ONLY this fixed JSON object, without markdown or commentary:
{"status":"candidate"|"needs_facts","candidate":{"subtitle":"Short Title Case Lead-in:","fullText":"One natural continuation","evidenceFactIds":["confirmed fact id"],"keywordsUsed":[],"distinctFromPrevious":"Short explanation of the new buyer angle","qualityAudit":{"factsGrounded":true,"lengthInRange":true,"noKeywordStuffing":true,"oneClearBenefit":true,"subtitleBodyPunctuationCorrect":true,"americanEnglishNatural":true,"grammarAndParallelismCorrect":true,"noUnsupportedClaims":true,"distinctFromPrevious":true,"amazonBulletStyleCompliant":true}}|null,"missingEvidence":["specific missing confirmed fact"]}

When status is "candidate", candidate must be an object, missingEvidence must be [], and evidenceFactIds must contain only id values from confirmedFacts that are also listed in selectedCore.confirmedFactRefs. evidenceFactIds is required for every stated factual claim; never emit claims without traceable confirmed fact IDs. When status is "needs_facts", candidate must be null and missingEvidence must state the specific facts that need human confirmation. qualityAudit is a self-check, never proof.`;

/**
 * A provider-friendly, fixed envelope: no oneOf/anyOf discriminated union.
 * candidate is nullable so needs_facts can remain machine-readable.
 */
export const SINGLE_BULLET_V8_OUTPUT_SCHEMA = {
  type: "object",
  required: ["status", "candidate", "missingEvidence"],
  properties: {
    status: { type: "string", enum: ["candidate", "needs_facts"] },
    candidate: {
      type: ["object", "null"],
      properties: {
        subtitle: { type: "string" },
        fullText: { type: "string" },
        evidenceFactIds: { type: "array", minItems: 1, items: { type: "string" } },
        keywordsUsed: { type: "array", items: { type: "string" } },
        distinctFromPrevious: { type: "string" },
        qualityAudit: {
          type: "object",
          required: ["factsGrounded", "lengthInRange", "noKeywordStuffing", "oneClearBenefit", "subtitleBodyPunctuationCorrect", "americanEnglishNatural", "grammarAndParallelismCorrect", "noUnsupportedClaims", "distinctFromPrevious", "amazonBulletStyleCompliant"],
          properties: Object.fromEntries(
            ["factsGrounded", "lengthInRange", "noKeywordStuffing", "oneClearBenefit", "subtitleBodyPunctuationCorrect", "americanEnglishNatural", "grammarAndParallelismCorrect", "noUnsupportedClaims", "distinctFromPrevious", "amazonBulletStyleCompliant"]
              .map((key) => [key, { type: "boolean" }]),
          ),
        },
      },
      required: ["subtitle", "fullText", "evidenceFactIds", "keywordsUsed", "distinctFromPrevious", "qualityAudit"],
    },
    missingEvidence: { type: "array", items: { type: "string" } },
  },
};

/**
 * Prepared only for the later coordinated runtime migration. Do not replace
 * buildSingleBulletSkillManifest with this builder while v7 parsing is live.
 */
export function buildSingleBulletV8SkillManifest(
  slug: (typeof SINGLE_BULLET_SKILL_SLUGS)[number],
  current: GovernedSkillManifest,
): GovernedSkillManifest {
  const systemPrompt = applyListingOgilvyRole(slug, `${SINGLE_BULLET_DISCOVERY_POLICY}\n\n${SINGLE_BULLET_TASK_PROMPT_V8}`);
  return {
    ...current,
    implementation: {
      ...(current.implementation || {}),
      systemPrompt,
      userPromptTemplate: "{{context}}",
      supportsJsonMode: true,
      qualityModelPolicy: HIGH_QUALITY_QUALITY_MODEL,
      maxTokens: Math.max(1800, Number(current.implementation?.maxTokens || 0)),
      temperature: 0.25,
      promptVersion: SINGLE_BULLET_V8_PROMPT_VERSION,
    },
    contract: {
      ...(current.contract || {}),
      outputMode: "json_draft",
      humanReviewRequired: true,
      automaticExecution: "prohibited",
      outputSchema: SINGLE_BULLET_V8_OUTPUT_SCHEMA,
    },
  };
}
