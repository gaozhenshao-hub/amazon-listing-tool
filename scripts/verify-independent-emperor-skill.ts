import { runEmperorSkill } from "../server/domains/ai_os/services/skillRunner";

const syntheticAttributes = [
  "Brand: VerificationBrand",
  "Product Name: Synthetic Socket Wrench Set",
  "ASIN: B0VERIFY123",
  "Category: Tools",
  "Specification: 12-piece metric socket set",
  "Scenario: Home repair",
  "Selling Point: Corrosion-resistant steel case",
].join("\n");

const result = await runEmperorSkill({
  skillSlug: "analysis.rufus.attribute",
  userId: 1,
  workspaceId: 1,
  context: syntheticAttributes,
  variables: {
    content: syntheticAttributes,
    sourceText: syntheticAttributes,
    fileContent: syntheticAttributes,
    rawContent: syntheticAttributes,
    productAttributesText: syntheticAttributes,
  },
  maxModelAttempts: 1,
  signal: AbortSignal.timeout(90_000),
  validate: (content) => JSON.parse(content) as Record<string, unknown>,
});

if (!result.parsed || typeof result.parsed !== "object") {
  throw new Error("Skill returned no structured result");
}

console.log(
  JSON.stringify({
    emperor_skill_e2e: "passed",
    skillSlug: result.skillSlug,
    skillVersion: result.skillVersion,
    modelSlug: result.modelSlug,
    provider: result.provider,
    structured: true,
  }),
);

process.exit(0);
