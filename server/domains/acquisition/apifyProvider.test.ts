import { describe, expect, it, vi } from "vitest";
import { ApifyAmazonProvider } from "./apifyProvider";

const request = {
  workspaceId: 1,
  marketplace: "US" as const,
  asin: "B000000001",
  capabilities: ["catalog_basic", "image_gallery"] as const,
  maxChargeUsd: 0.1,
  idempotencyKey: "qualification-test-0001",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("ApifyAmazonProvider", () => {
  it("estimates the qualified pay-per-result contract", async () => {
    const provider = new ApifyAmazonProvider({ apiToken: "test-token" });
    await expect(provider.estimate(request)).resolves.toEqual({
      estimatedMaxUsd: 0.005,
      pricingModel: "pay_per_result",
      cacheEligible: true,
    });
  });

  it("fails closed before an external request when budget is below the estimate", async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const provider = new ApifyAmazonProvider({ apiToken: "test-token", fetchImpl });
    const result = await provider.fetch({ ...request, maxChargeUsd: 0.001 });

    expect(result).toMatchObject({ status: "failed", failureCategory: "budget_exceeded" });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("starts one US product run, polls to completion and returns one immutable raw artifact", async () => {
    const fetchImpl = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "run-1", status: "RUNNING" } }))
      .mockResolvedValueOnce(jsonResponse({
        data: { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.005 },
      }))
      .mockResolvedValueOnce(jsonResponse([{ asin: "B000000001", highResolutionImages: ["https://example.test/1.jpg"] }]));
    const provider = new ApifyAmazonProvider({
      apiToken: "test-token",
      fetchImpl,
      pollIntervalMs: 0,
      maxWaitMs: 1_000,
    });

    const result = await provider.fetch(request);

    expect(result.status).toBe("succeeded");
    expect(result.failureCategory).toBeNull();
    expect(result.chargedUsd).toBe(0.005);
    expect(result.rawArtifact?.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const [startUrl, startInit] = fetchImpl.mock.calls[0];
    expect(String(startUrl)).toContain("/acts/junglee~Amazon-crawler/runs?");
    expect(String(startUrl)).toContain("maxItems=1");
    expect(String(startUrl)).toContain("maxTotalChargeUsd=0.1000");
    expect(String(startUrl)).not.toContain("test-token");
    expect(startInit?.headers).toMatchObject({ Authorization: "Bearer test-token" });
    expect(JSON.parse(String(startInit?.body))).toMatchObject({
      categoryOrProductUrls: [{ url: "https://www.amazon.com/dp/B000000001" }],
      maxItemsPerStartUrl: 1,
      maxProductVariantsAsSeparateResults: 0,
      maxOffers: 0,
      scrapeSellers: false,
      proxyCountry: "US",
    });
  });

  it("maps authentication failures to a fixed category without returning an upstream body", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(jsonResponse({ secret: "must-not-leak" }, 401));
    const provider = new ApifyAmazonProvider({ apiToken: "invalid", fetchImpl });
    const result = await provider.fetch(request);

    expect(result).toEqual({
      providerCode: "apify.junglee.amazon_crawler",
      providerRunId: "",
      status: "failed",
      failureCategory: "authentication_failed",
      chargedUsd: null,
      rawArtifact: null,
    });
  });
});
