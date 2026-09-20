import { BULLET_POINTS_PROMPT } from "../../../prompts";

/**
 * The database manifest is the runtime authority for emperor Skills. This
 * explicit policy is the reviewed source for repairing the legacy five-bullet
 * Skill when its database record drifts or conflicts with the task boundary.
 */
export const LISTING_BULLET_SKILL_SLUG = "listing.bullets.generate";
export const LISTING_BULLET_SKILL_VERSION = 3;
export const LISTING_BULLET_QUALITY_MODEL = "teamo-gpt-6-astra";

export const LISTING_BULLET_SYSTEM_PROMPT_V3 = BULLET_POINTS_PROMPT;

export type ListingBulletSkillRepair = {
  slug: typeof LISTING_BULLET_SKILL_SLUG;
  version: typeof LISTING_BULLET_SKILL_VERSION;
  modelOverride: typeof LISTING_BULLET_QUALITY_MODEL;
  systemPrompt: string;
};

/**
 * Version 3 deliberately keeps the reviewed Ogilvy persona and the existing
 * FABE/length/JSON requirements in one prompt. It removes title-specific and
 * duplicate legacy preambles, so a five-bullet request has one task boundary.
 */
export function getListingBulletSkillRepairV3(): ListingBulletSkillRepair {
  return {
    slug: LISTING_BULLET_SKILL_SLUG,
    version: LISTING_BULLET_SKILL_VERSION,
    modelOverride: LISTING_BULLET_QUALITY_MODEL,
    systemPrompt: LISTING_BULLET_SYSTEM_PROMPT_V3,
  };
}
