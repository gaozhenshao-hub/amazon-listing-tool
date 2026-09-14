import { describe, expect, it, vi } from "vitest";

const requestApifyJsonIPv4Mock = vi.hoisted(() => vi.fn());
vi.mock("../apiConnections/apifyAccountHealth", () => ({ requestApifyJsonIPv4: requestApifyJsonIPv4Mock }));

import { ApifyAmazonMonitorProvider } from "./apifyMonitorProvider";
import { AmazonMonitorRequestSchema } from "./monitorProviderContracts";

function jsonResponse(data: unknown) {
  return new Response(JSON.stringify(data), { status: 200, headers: { "content-type": "application/json" } });
}

describe("ApifyAmazonMonitorProvider", () => {
  it("fails closed before any request when the explicit budget is too low", async () => {
    const fetchImpl = vi.fn();
    const provider = new ApifyAmazonMonitorProvider({ apiToken: "test-token", fetchImpl });
    const request = AmazonMonitorRequestSchema.parse({ workspaceId: 1, kind: "keyword", marketplace: "US", asin: "B0H1VCSGWK", keyword: "travel tumbler", postalCode: "10001", depth: 1, maxChargeUsd: 0.01, idempotencyKey: "monitor-budget-test" });
    const result = await provider.fetch(request);
    expect(result.status).toBe("failed");
    expect(result.failureCategory).toBe("budget_exceeded");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("uses the documented product-and-offer actor input and normalizes price, BSR and offers without inventing unsupported fields", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.0245 } }))
      .mockResolvedValueOnce(jsonResponse([{ asin: "B0H1VCSGWK", title: "Example", price: "$29.99", bestsellerRanks: [{ rank: 4321, category: "Home" }], hasBuyBox: true, offersCount: 4, offers: [{ isBuyBoxWinner: true, sellerName: "Example Seller", shipsFrom: "Amazon" }] }]));
    const provider = new ApifyAmazonMonitorProvider({ apiToken: "test-token", fetchImpl, pollIntervalMs: 0 });
    const request = AmazonMonitorRequestSchema.parse({ workspaceId: 1, kind: "competitor", marketplace: "US", asin: "B0H1VCSGWK", keyword: null, postalCode: "10001", depth: 1, maxChargeUsd: 0.1, idempotencyKey: "monitor-competitor-test" });
    const result = await provider.fetch(request);
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({ productUrls: [{ url: "https://www.amazon.com/dp/B0H1VCSGWK" }], scrapeOffers: true, maxOffers: 10, scrapeProductDetails: true });
    expect(provider.estimate(request)).toMatchObject({ estimatedMaxUsd: 0.03, pricingModel: "product_detail_plus_capped_offers" });
    expect(result.status).toBe("succeeded");
    expect(result.normalized).toMatchObject({ kind: "competitor", price: "29.99", bsrRank: 4321, offerCount: 4, buyBoxSellerName: "Example Seller", coverage: { price: "returned", bsrRank: "returned", buyBox: "returned", offerCount: "returned", ratings: "provider_unsupported", coupon: "provider_unsupported" } });
    expect(result.rawArtifact?.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("accepts snake_case price, BSR and offer evidence returned by the product-and-offer actor", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "run-snake", status: "SUCCEEDED", defaultDatasetId: "dataset-snake", usageTotalUsd: 0.0008 } }))
      .mockResolvedValueOnce(jsonResponse([{ asin: "B0H1VCSGWK", price: "$18.99", currency: "USD", bsr_rank: 321, offer_count: 2, buy_box_winner: true, buy_box_seller: "Example Seller" }]));
    const provider = new ApifyAmazonMonitorProvider({ apiToken: "test-token", fetchImpl, pollIntervalMs: 0 });
    const request = AmazonMonitorRequestSchema.parse({ workspaceId: 1, kind: "competitor", marketplace: "US", asin: "B0H1VCSGWK", keyword: null, postalCode: "10001", depth: 1, maxChargeUsd: 0.1, idempotencyKey: "monitor-snake-case" });

    const result = await provider.fetch(request);

    expect(result.status).toBe("succeeded");
    expect(result.normalized).toMatchObject({
      kind: "competitor",
      price: "18.99",
      currency: "USD",
      bsrRank: 321,
      offerCount: 2,
      buyBoxSellerName: "Example Seller",
      coverage: { price: "returned", bsrRank: "returned", buyBox: "returned", offerCount: "returned" },
    });
  });

  it("uses the documented rank tracker input and separates organic from sponsored positions", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "run-2", status: "SUCCEEDED", defaultDatasetId: "dataset-2", usageTotalUsd: 0.075 } }))
      .mockResolvedValueOnce(jsonResponse([{ keyword: "travel tumbler", results_scanned: 48, observed_from: "10001", location_pinned: true, run_at: "2026-09-13T00:00:00Z", tracked: [{ asin: "B0H1VCSGWK", found: true, sponsored: false, position_organic: 7, position_absolute: 9, page: 1 }, { asin: "B0H1VCSGWK", found: true, sponsored: true, position_absolute: 2, page: 1 }] }]));
    const provider = new ApifyAmazonMonitorProvider({ apiToken: "test-token", fetchImpl, pollIntervalMs: 0 });
    const request = AmazonMonitorRequestSchema.parse({ workspaceId: 1, kind: "keyword", marketplace: "US", asin: "B0H1VCSGWK", keyword: "travel tumbler", postalCode: "10001", depth: 1, maxChargeUsd: 0.1, idempotencyKey: "monitor-keyword-test" });
    const result = await provider.fetch(request);
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({ keywords: ["travel tumbler"], asins: ["B0H1VCSGWK"], marketplace: "com", postalCode: "10001", depth: 1, includeVolume: false });
    expect(result.normalized).toMatchObject({ kind: "keyword", found: true, organicRank: 7, adRank: 2, absoluteRank: 9, pageNumber: 1, locationPinned: true });
  });

  it("keeps production transport out of the default global fetch path so Apify calls use the controlled IPv4 HTTPS client", async () => {
    const globalFetch = vi.fn();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = globalFetch;
    try {
      requestApifyJsonIPv4Mock
        .mockResolvedValueOnce({ data: { id: "run-ipv4", status: "SUCCEEDED", defaultDatasetId: "dataset-ipv4", usageTotalUsd: 0.0245 } })
        .mockResolvedValueOnce([{ asin: "B0H1VCSGWK", price: "$19.99", bestsellerRanks: [{ rank: 10, category: "Home" }], hasBuyBox: true, offersCount: 1, offers: [] }]);
      const provider = new ApifyAmazonMonitorProvider({ apiToken: "test-token" });
      const request = AmazonMonitorRequestSchema.parse({ workspaceId: 1, kind: "competitor", marketplace: "US", asin: "B0H1VCSGWK", keyword: null, postalCode: "10001", depth: 1, maxChargeUsd: 0.1, idempotencyKey: "monitor-ipv4-transport" });
      await provider.fetch(request);
      expect(globalFetch).not.toHaveBeenCalled();
      expect(requestApifyJsonIPv4Mock).toHaveBeenCalledWith(expect.objectContaining({ path: expect.stringMatching(/^\/acts\//), method: "POST", token: "test-token" }));
    } finally {
      globalThis.fetch = originalFetch;
      requestApifyJsonIPv4Mock.mockReset();
    }
  });
});
