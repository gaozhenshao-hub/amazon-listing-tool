import { describe, expect, it } from "vitest";
import { runEmperorSkill } from "./services/emperorSkillRunner";

const shouldRun = process.env.RUN_REAL_LLM_TESTS === "1";
const realTest = shouldRun ? it : it.skip;
const userId = Number(process.env.REAL_LLM_TEST_USER_ID || 0);

function parseJson(content: string): unknown {
  const cleaned = content
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, "")
    .replace(/^```(?:json)?\s*/im, "")
    .replace(/\s*```\s*$/im, "")
    .trim();
  return JSON.parse(cleaned);
}

describe("real Listing Skill workflow", () => {
  realTest("runs all six Listing skills through real providers", async () => {
    expect(userId).toBeGreaterThan(0);

    const context = process.env.REAL_LLM_TEST_CONTEXT || [
      "Product: Rechargeable handheld milk frother",
      "Market: US",
      "Brand: TestBrand",
      "Features: stainless steel whisk, 3 speeds, USB-C charging, ergonomic handle",
      "Audience: home coffee users",
    ].join("\n");

    const fallbackModels = ["claude-sonnet-5", "gemini-3-6-flash", "manus-default"];
    const common = {
      userId,
      context,
      emphasis: "Accuracy, Amazon compliance, and valid JSON",
      fallbackModels,
      validate: parseJson,
    };

    const sellingPoints = await runEmperorSkill({
      ...common,
      skillSlug: "listing.sellingpoints.generate",
      variables: {},
    });
    expect(sellingPoints.parsed).toBeTruthy();

    const title = await runEmperorSkill({
      ...common,
      skillSlug: "listing.title.generate",
      variables: { sellingPoints: sellingPoints.parsed },
    });
    expect(title.parsed).toBeTruthy();

    const bullets = await runEmperorSkill({
      ...common,
      skillSlug: "listing.bullets.generate",
      variables: { sellingPoints: sellingPoints.parsed, title: title.parsed },
    });
    expect(bullets.parsed).toBeTruthy();

    const description = await runEmperorSkill({
      ...common,
      skillSlug: "listing.description.generate",
      variables: { title: title.parsed, bullets: bullets.parsed },
    });
    expect(description.parsed).toBeTruthy();

    const searchTerms = await runEmperorSkill({
      ...common,
      skillSlug: "listing.searchterms.generate",
      variables: {
        title: title.parsed,
        bullets: bullets.parsed,
        description: description.parsed,
      },
    });
    expect(searchTerms.parsed).toBeTruthy();

    const qa = await runEmperorSkill({
      ...common,
      skillSlug: "listing.qa.generate",
      variables: {
        title: title.parsed,
        bullets: bullets.parsed,
        description: description.parsed,
        searchTerms: searchTerms.parsed,
      },
    });
    expect(qa.parsed).toBeTruthy();
  }, 600_000);
});
