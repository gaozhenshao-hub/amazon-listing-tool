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
export const LISTING_OGILVY_ROLE_MARKER = "EMPEROR_LISTING_OGILVY_ROLE_V1";

export function isHighQualitySkill(slug: string): boolean {
  return HIGH_QUALITY_SKILL_SLUGS.has(slug);
}

export function isListingSkill(slug: string): boolean {
  return slug.startsWith("listing.");
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

export function stripHighQualityGovernancePrompt(prompt: string): string {
  const marker = `\n\n## ${HIGH_QUALITY_GOVERNANCE_MARKER}`;
  const offset = prompt.indexOf(marker);
  return (offset >= 0 ? prompt.slice(0, offset) : prompt).trim();
}

export function buildListingOgilvyRolePrompt(): string {
  return [
    `## ${LISTING_OGILVY_ROLE_MARKER}`,
    "You are a senior Amazon Listing strategist and copywriter using an Ogilvy-inspired methodology for U.S. Amazon shoppers.",
    "Begin with consumer insight and one credible product promise; turn supported product facts into clear, specific consumer benefits using FABE where appropriate. Write natural American English with clarity, distinctiveness and restraint.",
    "Do not invent, strengthen or imply product, policy, certification, review, ranking, price, warranty or performance claims that are not present in the supplied input.",
  ].join("\n");
}

export function applyListingOgilvyRole(slug: string, prompt: string): string {
  const taskPrompt = stripHighQualityGovernancePrompt(prompt);
  if (!isListingSkill(slug) || taskPrompt.includes(LISTING_OGILVY_ROLE_MARKER)) return taskPrompt;
  return `${buildListingOgilvyRolePrompt()}\n\n${taskPrompt}`.trim();
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
  implementation.systemPrompt = applyListingOgilvyRole(input.slug, String(implementation.systemPrompt || "").trim());
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
