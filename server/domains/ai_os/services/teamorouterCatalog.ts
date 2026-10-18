import { ENV } from "../../../_core/env";

import { TEAMOROUTER_CREDENTIAL_REF } from "./strictSkillRuntime";
export { TEAMOROUTER_OPENAI_BASE_URL, TEAMOROUTER_DIRECT_HOST, TEAMOROUTER_LEGACY_SOCKS_HOST, TEAMOROUTER_CREDENTIAL_REF, canonicalizeTeamorouterOpenAiBaseUrl } from "./strictSkillRuntime";

export type TeamorouterCatalogModel = {
  slug: string;
  name: string;
  modelId: string;
  capabilityTags: string[];
  maxContextTokens: number;
};

/**
 * Candidates observed through the account's authenticated `/v1/models` catalog
 * on 2026-09-20. They remain non-default until a governed Skill policy selects
 * one; cost is intentionally not hard-coded because Teamorouter pricing varies
 * dynamically by request.
 */
export const TEAMOROUTER_TEXT_MODEL_CATALOG: readonly TeamorouterCatalogModel[] = [
  {
    slug: "teamo-gpt-6-astra",
    name: "TeamoRouter GPT-6 Astra",
    modelId: "gpt-6-astra",
    capabilityTags: ["text", "reasoning", "teamorouter", "catalog-verified"],
    maxContextTokens: 128_000,
  },
  {
    slug: "teamo-gemini-3-8-flash",
    name: "TeamoRouter Gemini 3.8 Flash",
    modelId: "gemini-3.8-flash",
    capabilityTags: ["text", "fast", "teamorouter", "catalog-verified"],
    maxContextTokens: 128_000,
  },
  {
    slug: "teamo-deepseek-v4-pro",
    name: "TeamoRouter DeepSeek V4 Pro",
    modelId: "deepseek-v4-pro",
    capabilityTags: ["text", "reasoning", "teamorouter", "catalog-verified"],
    maxContextTokens: 128_000,
  },
  {
    slug: "teamo-deepseek-v4-flash",
    name: "TeamoRouter DeepSeek V4 Flash",
    modelId: "deepseek-v4-flash",
    capabilityTags: ["text", "fast", "teamorouter", "catalog-verified"],
    maxContextTokens: 128_000,
  },
  {
    slug: "teamo-glm-5-3",
    name: "TeamoRouter GLM-5.3",
    modelId: "glm-5.3",
    capabilityTags: ["text", "chinese", "teamorouter", "catalog-verified"],
    maxContextTokens: 128_000,
  },
  {
    slug: "teamo-grok-4-6",
    name: "TeamoRouter Grok 4.6",
    modelId: "grok-4.6",
    capabilityTags: ["text", "reasoning", "teamorouter", "catalog-verified"],
    maxContextTokens: 128_000,
  },
];

export function resolveGovernedModelApiKey(reference?: string | null): string {
  if (reference === TEAMOROUTER_CREDENTIAL_REF) return ENV.externalLlmApiKey;
  return reference?.trim() || "";
}


export function defaultTeamorouterFallbacks(forgeApiKey = ENV.forgeApiKey): string[] {
  if (forgeApiKey) return ["manus-default", "teamo-gemini-3-8-flash"];
  return ["teamo-gemini-3-8-flash", "teamo-deepseek-v4-flash"];
}
