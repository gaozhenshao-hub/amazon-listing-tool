import { describe, expect, it } from "vitest";

const requireEnvironment = (name: string) => {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`${name} is required for the Teamorouter connectivity check`);
  }
  return value;
};

describe("Teamorouter external model gateway", () => {
  it("lists available models using the managed API key without sending business data", async () => {
    const baseUrl = requireEnvironment("EXTERNAL_LLM_BASE_URL").replace(/\/+$/, "");
    const apiKey = requireEnvironment("EXTERNAL_LLM_API_KEY");
    const modelsUrl = `${baseUrl.replace(/\/v1$/, "")}/v1/models`;

    const response = await fetch(modelsUrl, {
      headers: { authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.status, "Teamorouter model list should accept the managed key").toBe(200);
    const payload = (await response.json()) as { data?: Array<{ id?: string }> };
    expect(Array.isArray(payload.data)).toBe(true);
    expect(payload.data?.some(model => model.id === "gpt-5.6-sol")).toBe(true);
  });
});
