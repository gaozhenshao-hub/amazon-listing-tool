import { describe, expect, it } from "vitest";
import {
  getListingBulletSkillRepairV3,
  LISTING_BULLET_QUALITY_MODEL,
  LISTING_BULLET_SKILL_SLUG,
  LISTING_BULLET_SKILL_VERSION,
} from "./listingBulletSkillPolicy";

describe("Listing 五点 Skill v3 policy", () => {
  it("preserves the Ogilvy role and narrows the task to five FABE bullets", () => {
    const repair = getListingBulletSkillRepairV3();

    expect(repair).toMatchObject({
      slug: LISTING_BULLET_SKILL_SLUG,
      version: LISTING_BULLET_SKILL_VERSION,
      modelOverride: LISTING_BULLET_QUALITY_MODEL,
    });
    expect(repair.systemPrompt).toContain("Ogilvy & Mather");
    expect(repair.systemPrompt).toContain("Generate 5 optimized Amazon bullet points");
    expect(repair.systemPrompt).toContain("FABE Method");
    expect(repair.systemPrompt).toContain("MINIMUM: 200 characters");
    expect(repair.systemPrompt).toContain("MAXIMUM: 280 characters");
    expect(repair.systemPrompt).not.toContain("TWO-STAGE TITLE POLICY");
  });
});
