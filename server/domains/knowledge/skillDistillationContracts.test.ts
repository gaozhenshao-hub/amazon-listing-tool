import { describe, expect, it } from "vitest";
import {
  DISTILLATION_SKILL_CATALOG,
  canTransitionDraft,
  isDistillationSkillType,
  normalizeDistillationProfile,
} from "./skillDistillationContracts";

describe("knowledge skill distillation contracts", () => {
  it("defines the complete 22-skill catalog with unique stable type keys", () => {
    expect(DISTILLATION_SKILL_CATALOG).toHaveLength(22);
    expect(new Set(DISTILLATION_SKILL_CATALOG.map(([key]) => key)).size).toBe(22);
    expect(isDistillationSkillType("listing.image.claim-ledger")).toBe(true);
    expect(isDistillationSkillType("unsafe.ad_hoc_skill")).toBe(false);
  });

  it("sets safe default profile values for a draft that has no product evidence yet", () => {
    expect(normalizeDistillationProfile({ productCategory: "water_heater_parts" })).toEqual({
      domain: "product_knowledge",
      descriptionMode: "fact_specification",
      expressionDirection: "core_value",
      productCategory: "water_heater_parts",
      style: "professional_trust",
      market: "US",
      audience: "general",
      productConditions: [],
    });
  });

  it("never permits published drafts to be silently edited or republished", () => {
    expect(canTransitionDraft("draft", "review")).toBe(true);
    expect(canTransitionDraft("review", "approved")).toBe(true);
    expect(canTransitionDraft("approved", "published")).toBe(true);
    expect(canTransitionDraft("published", "review")).toBe(false);
    expect(canTransitionDraft("published", "superseded")).toBe(true);
  });
});
