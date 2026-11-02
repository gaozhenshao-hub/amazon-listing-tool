import { describe, expect, it } from "vitest";

const runLive = process.env.RUN_APIFY_CREDENTIAL_TEST === "1" ? describe : describe.skip;

runLive("Apify credential integration", () => {
  it("authenticates the server token without exposing account data", async () => {
    const token = process.env.APIFY_API_TOKEN;
    expect(token, "APIFY_API_TOKEN must be configured").toBeTruthy();

    const response = await fetch("https://api.apify.com/v2/users/me", {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      signal: AbortSignal.timeout(15_000),
    });

    expect(response.status, "Apify credential endpoint must return HTTP 200").toBe(200);
    const payload = await response.json() as { data?: { id?: string } };
    expect(payload.data?.id).toBeTruthy();
  }, 20_000);
});
