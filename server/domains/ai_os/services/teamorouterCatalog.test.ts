import { describe, expect, it, vi } from "vitest";
import {
  TEAMOROUTER_CREDENTIAL_REF,
  TEAMOROUTER_OPENAI_BASE_URL,
  canonicalizeTeamorouterOpenAiBaseUrl,
  defaultTeamorouterFallbacks,
} from "./teamorouterCatalog";
import { syncGovernedTeamorouterCatalog } from "./teamorouterCatalogRegistration";

describe("Teamorouter catalog policy", () => {
  it("canonicalizes only the retired .com OpenAI endpoint", () => {
    expect(canonicalizeTeamorouterOpenAiBaseUrl("https://api.teamorouter.com/v1")).toBe(TEAMOROUTER_OPENAI_BASE_URL);
    expect(canonicalizeTeamorouterOpenAiBaseUrl("https://api.example.test/v1")).toBe("https://api.example.test/v1");
  });

  it("uses direct official Teamorouter candidates when Forge is not provisioned", () => {
    expect(defaultTeamorouterFallbacks("")).toEqual(["teamo-gemini-3-8-flash", "teamo-deepseek-v4-flash"]);
    expect(defaultTeamorouterFallbacks("configured")[0]).toBe("manus-default");
  });

  it("migrates legacy records and registers non-default candidates with a credential reference", async () => {
    const execute = vi.fn(async () => []);
    const result = await syncGovernedTeamorouterCatalog(execute);

    expect(result.defaultChanged).toBe(false);
    expect(result.registeredModelSlugs).toContain("teamo-gpt-6-astra");
    expect(result.registeredModelSlugs).toContain("teamo-gemini-3-8-flash");
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE emperor_model_providers"),
      [TEAMOROUTER_OPENAI_BASE_URL, TEAMOROUTER_CREDENTIAL_REF, "%api.teamorouter.com%"],
    );
    expect(execute).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO emperor_model_providers"),
      expect.arrayContaining([TEAMOROUTER_CREDENTIAL_REF, TEAMOROUTER_OPENAI_BASE_URL]),
    );
  });
});
