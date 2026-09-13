import { describe, expect, it, vi } from "vitest";
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

  it("uses the documented BSR actor input and normalizes price, BSR and offers without inventing unsupported fields", async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ data: { id: "run-1", status: "SUCCEEDED", defaultDatasetId: "dataset-1", usageTotalUsd: 0.002 } }))
      .mockResolvedValueOnce(jsonResponse([{ asin: "B0H1VCSGWK", title: "Example", price: "$29.99", currency: "USD", bsr_rank: 4321, bsr_category: "Home", bsr_categories_all: [{ rank: 4321, category: "Home" }], buy_box_winner: "Example Brand", buy_box_seller_name: "Example Seller", ships_from: "Amazon", offer_count: 4, snapshot_ts: "2026-09-13T00:00:00Z" }]));
    const provider = new ApifyAmazonMonitorProvider({ apiToken: "test-token", fetchImpl, pollIntervalMs: 0 });
    const request = AmazonMonitorRequestSchema.parse({ workspaceId: 1, kind: "competitor", marketplace: "US", asin: "B0H1VCSGWK", keyword: null, postalCode: "10001", depth: 1, maxChargeUsd: 0.1, idempotencyKey: "monitor-competitor-test" });
    const result = await provider.fetch(request);
    const requestBody = JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body));
    expect(requestBody).toMatchObject({ marketplaces: ["US"], asins: ["B0H1VCSGWK"], maxSnapshots: 1 });
    expect(result.status).toBe("succeeded");
    expect(result.normalized).toMatchObject({ kind: "competitor", price: "29.99", bsrRank: 4321, offerCount: 4, coverage: { ratings: "provider_unsupported", coupon: "provider_unsupported" } });
    expect(result.rawArtifact?.contentHash).toMatch(/^[a-f0-9]{64}$/);
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
});
