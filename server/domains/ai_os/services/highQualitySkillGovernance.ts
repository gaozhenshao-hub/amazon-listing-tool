export type GovernedSkillKind =
  | "content_draft"
  | "analytical_advisory"
  | "operational_recommendation"
  | "decision_advisory";

export type HighQualitySkillGovernance = {
  schemaVersion: "emperor.skill.governance/1.0";
  kind: GovernedSkillKind;
  draft: true;
  recommendationOnly: true;
  humanReviewRequired: true;
  evidencePolicy: "input_only";
  missingDataPolicy: "explicit_insufficient_data";
  automaticExecution: "prohibited";
  policyProfile: "marketplace_category_confirmed_or_draft";
};

export type GovernedSkillManifest = {
  implementation?: {
    systemPrompt?: string;
    userPromptTemplate?: string;
    modelPolicy?: string;
    qualityModelPolicy?: string;
    evaluationModelPolicy?: string;
    maxTokens?: number;
    temperature?: number;
    supportsJsonMode?: boolean;
    [key: string]: unknown;
  };
  contract?: Record<string, unknown>;
  governance?: Partial<HighQualitySkillGovernance>;
  [key: string]: unknown;
};

/**
 * The reviewed high-quality/high-impact released Skill inventory. This list is
 * deliberately source-controlled so repairs, previews and production updates
 * operate on the same declared boundary rather than a loose category filter.
 */
export const HIGH_QUALITY_SKILL_SLUGS = new Set<string>([
  "ad.budget.allocation",
  "ad.budget.evaluate",
  "ad.channel.strategy",
  "ad.chatbot",
  "ad.dayparting.strategy",
  "ad.deep.business.cross",
  "ad.deep.clinic",
  "ad.deep.cross.diagnosis",
  "ad.deep.impression.analysis",
  "ad.deep.keyword.tier",
  "ad.deep.placement.analysis",
  "ad.deep.sb.benchmark",
  "ad.deep.searchterm.analysis",
  "ad.deep.sop.generate",
  "ad.deep.stage.diagnosis",
  "ad.diagnosis",
  "ad.dsp.strategy",
  "ad.negative.generate",
  "ad.searchterm.advice",
  "ad.searchterm.evaluate",
  "ad.structure.generate",
  "ad.structure.translate",
  "aftersales.return.diagnosis",
  "aftersales.review.analysis",
  "analysis.competitor.single",
  "analysis.image.recognition",
  "dev.analysis.decision_dashboard",
  "dev.analysis.market_overview",
  "dev.analysis.product",
  "dev.market.opportunity",
  "image.workflow.step4.refine",
  "listing.abtest.generate",
  "listing.bullet.refine",
  "listing.bullet.single",
  "listing.bullet.step.generate",
  "listing.bullets.generate",
  "listing.checklist.bullets",
  "listing.checklist.description",
  "listing.checklist.qa",
  "listing.checklist.searchterms",
  "listing.checklist.title",
  "listing.competitor.analyze",
  "listing.description.generate",
  "listing.image.advice",
  "listing.keyword.fabe.expand",
  "listing.qa.generate",
  "listing.review.analyze",
  "listing.scoring.overall",
  "listing.searchterms.generate",
  "listing.sellingpoints.generate",
  "listing.title.generate",
  "listing.translate.chinese",
  "off.campaign.analysis",
  "off.content.calendar",
  "off.influencer.match",
  "off.outreach.email",
  "off.social.content",
  "offsite.crowdfunding",
  "offsite.facebook.analysis",
  "offsite.google.trends",
  "offsite.independent.site",
  "offsite.reddit.analysis",
  "offsite.summary",
  "offsite.tiktok.analysis",
  "offsite.tiktok.analyze",
  "offsite.youtube.analysis",
  "offsite.youtube.analyze",
  "ops.competitor.analysis",
  "ops.inventory.analysis",
  "ops.inventory.multichannel",
  "ops.profit.analysis",
  "ops.searchterm.advice",
  "video.competitor.analysis",
  "video.competitor.summary",
  "video.edit.script",
  "video.product.extract",
  "video.product.info",
  "video.section.plan",
  "video.shot.detail",
  "video.subtopic.expand"
]);

export const HIGH_QUALITY_GOVERNANCE_MARKER = "EMPEROR_HIGH_QUALITY_GOVERNANCE_V1";
export const HIGH_QUALITY_QUALITY_MODEL = "teamo-gpt-6-astra";

export function isHighQualitySkill(slug: string): boolean {
  return HIGH_QUALITY_SKILL_SLUGS.has(slug);
}

export function classifyHighQualitySkill(slug: string): GovernedSkillKind {
  if (slug.startsWith("ad.")) return "operational_recommendation";
  if (slug.startsWith("dev.")) return "decision_advisory";
  if (slug.startsWith("listing.") || slug.startsWith("image.") || slug.startsWith("video.") || slug.startsWith("off.")) {
    return "content_draft";
  }
  return "analytical_advisory";
}

export function getHighQualitySkillGovernance(slug: string): HighQualitySkillGovernance | null {
  if (!isHighQualitySkill(slug)) return null;
  return {
    schemaVersion: "emperor.skill.governance/1.0",
    kind: classifyHighQualitySkill(slug),
    draft: true,
    recommendationOnly: true,
    humanReviewRequired: true,
    evidencePolicy: "input_only",
    missingDataPolicy: "explicit_insufficient_data",
    automaticExecution: "prohibited",
    policyProfile: "marketplace_category_confirmed_or_draft",
  };
}

function removeMisleadingPolicyClaims(prompt: string, slug: string): string {
  if (slug !== "listing.title.generate") return prompt;
  return prompt
    .split("\n")
    .filter((line) => !/two-stage title|effective july 27|amazon now requires|must be split into two layers/i.test(line))
    .join("\n");
}

function removeMarkdownJsonFenceInstruction(prompt: string, slug: string): string {
  if (slug !== "dev.analysis.product") return prompt;
  const fence = String.fromCharCode(96).repeat(3);
  return prompt.replace(new RegExp(fence + "json\\s*", "gi"), "").replace(new RegExp("\\s*" + fence, "g"), "");
}

function patchCriticalPrompt(prompt: string, slug: string): string {
  if (slug === "listing.bullet.refine") {
    return [
      "You are an Amazon Listing bullet refinement specialist. Rewrite exactly one existing bullet according to the human-approved optimization direction.",
      "Use only product facts, limits, materials, measurements, certifications, comparisons and warranties present in the input. Never invent, strengthen or imply an unsupported claim.",
      "Return only one JSON object with: subtitle, fullText, characterCount, conflictDetected, conflictExplanation, proposedRewrite, evidenceUsed, claimStatus, requiresHumanConfirmation.",
      "claimStatus must be grounded, needs_verification or insufficient_data. If a requested direction conflicts with evidence or marketplace policy, set conflictDetected=true, explain it outside the publishable copy, provide the closest compliant draft, and set requiresHumanConfirmation=true.",
      "The combined subtitle and fullText length must be 200–280 characters only when the supplied product facts support that length. Do not pad with invented data.",
    ].join("\n");
  }
  if (slug === "listing.checklist.bullets") {
    return [
      "You are an Amazon Listing quality auditor. Assess one bullet-point draft as a non-binding, human-reviewable quality check.",
      "Evaluate exactly these 15 dimensions: character_count, subtitle_format, fabe_structure, keyword_relevance, benefit_clarity, specificity, emotional_appeal, readability, uniqueness, mobile_friendliness, compliance, action_orientation, sensory_language, social_proof, urgency.",
      "Use only the supplied text and policy profile. Do not assume marketplace policies, reviews, social proof, urgency, certification or performance facts that are not provided.",
      "Return only JSON: {schemaVersion, draft, requiresHumanApproval, overallScore, blockingIssues, dimensions:[{dimension,status,evidence,recommendation,score}], missingInputs, limitations}. status is pass|warning|fail; score is 0–100; evidence is an input excerpt or an explicit insufficient-data statement.",
    ].join("\n");
  }
  if (slug === "listing.translate.chinese") {
    return [
      "You translate a Chinese Amazon Listing draft into natural, policy-conscious English. Treat the supplied Chinese text as the source and preserve only supported product claims.",
      "Return only JSON with sourceLanguage set to zh, targetLanguage set to en, translatedListing, keywordMapping items containing sourceTerm, targetTerm, sourceRef and claimStatus, missingInputs, and requiresHumanApproval set to true.",
      "Do not estimate search volume, ranking, certification, price, review count, warranty or performance. If a term requires verification, mark claimStatus=needs_verification and leave its unsupported metric null.",
    ].join("\n");
  }
  if (slug === "ad.chatbot") {
    return [
      "You are an Amazon advertising analyst. Answer one analytical question using only the supplied account data and stated time window.",
      "Return only JSON with responseType (diagnosis, metric_explanation, or strategy_question), answer, findings containing claim/evidence/confidence, recommendations containing recommendation/preconditions/humanApprovalRequired:true, missingInputs, and limitations.",
      "Do not issue an execution command, modify budgets, bids, status or keywords. Any recommendation is non-binding and requires human approval.",
    ].join("\n");
  }
  return prompt;
}

export function buildHighQualityGovernancePrompt(slug: string): string {
  const governance = getHighQualitySkillGovernance(slug);
  if (!governance) return "";
  return [
    "\n\n## " + HIGH_QUALITY_GOVERNANCE_MARKER,
    "This is a structured AI draft, never an automatic publication, advertising change, procurement decision, marketplace submission or external action.",
    "Use only facts, numbers, certifications, policy rules, comparisons, reviews, images and measurements that are explicitly present in the supplied input or confirmed policy profile. Never invent, infer or inflate missing facts.",
    "For every external-facing or decision-relevant claim, retain a concise input evidence reference. If evidence is missing, set the claim status to needs_verification or insufficient_data and describe the missing input instead of guessing.",
    "Return valid JSON only, without Markdown. Preserve the task-specific fields and append a top-level _governance object with schemaVersion, draft:true, recommendationOnly:true, requiresHumanApproval:true, evidencePolicy input_only, missingInputs, limitations and claimStatusSummary.",
    "A marketplace/category policy rule is only authoritative when a confirmed policy profile is supplied. Otherwise label compliance guidance as a draft for human review.",
    governance.kind === "operational_recommendation"
      ? "Recommendations must include preconditions, humanApprovalRequired:true and a monitoring or rollback note; never say to execute a bid, budget, campaign, keyword or status change automatically."
      : governance.kind === "decision_advisory"
        ? "Any launch, investment, purchase, pricing or market-entry conclusion is advisory only. Distinguish confirmed facts, bounded estimates and insufficient-data items."
        : "All generated copy, analyses and plans are editable drafts requiring human review before downstream use.",
  ].join("\n");
}

export function buildGovernedHighQualityManifest(input: {
  slug: string;
  manifest: GovernedSkillManifest;
  modelOverride?: string | null;
}): { manifest: GovernedSkillManifest; modelOverride: string | null; changed: boolean } {
  const current = input.manifest || {};
  if (!isHighQualitySkill(input.slug)) {
    return { manifest: current, modelOverride: input.modelOverride ?? null, changed: false };
  }
  const implementation = { ...(current.implementation || {}) };
  let prompt = String(implementation.systemPrompt || "").trim();
  prompt = patchCriticalPrompt(prompt, input.slug);
  prompt = removeMisleadingPolicyClaims(prompt, input.slug);
  prompt = removeMarkdownJsonFenceInstruction(prompt, input.slug);
  if (!prompt.includes(HIGH_QUALITY_GOVERNANCE_MARKER)) {
    prompt += buildHighQualityGovernancePrompt(input.slug);
  }
  implementation.systemPrompt = prompt;
  implementation.supportsJsonMode = true;
  implementation.modelPolicy = input.modelOverride || implementation.modelPolicy || undefined;
  implementation.qualityModelPolicy = HIGH_QUALITY_QUALITY_MODEL;

  const governance = getHighQualitySkillGovernance(input.slug)!;
  const manifest: GovernedSkillManifest = {
    ...current,
    implementation,
    contract: {
      ...(current.contract || {}),
      schemaVersion: governance.schemaVersion,
      inputSchema: {
        type: "object",
        required: ["context"],
        properties: {
          context: { type: "string", description: "Confirmed or uploaded business context; absent facts must remain unresolved." },
          emphasis: { type: "string", description: "Human focus instruction; cannot override evidence or policy." },
        },
      },
      outputMode: "json_draft",
      humanReviewRequired: true,
      automaticExecution: "prohibited",
    },
    governance,
  };
  return { manifest, modelOverride: input.modelOverride ?? null, changed: JSON.stringify(manifest) !== JSON.stringify(current) };
}
