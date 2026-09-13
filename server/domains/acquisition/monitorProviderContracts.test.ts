import { describe, expect, it } from "vitest";
import { AmazonMonitorRequestSchema, hasRequiredMonitorEvidence, monitorRequestHash, requiredMonitorCapabilities } from "./monitorProviderContracts";

const base = {
  workspaceId: 1,
  marketplace: "US" as const,
  asin: "B0H1VCSGWK",
  postalCode: "10001",
  depth: 1,
  maxChargeUsd: 0.1,
  idempotencyKey: "monitor-test-key-0001",
};

describe("Amazon monitor contracts", () => {
  it("requires a keyword for search-rank monitoring", () => {
    expect(() => AmazonMonitorRequestSchema.parse({ ...base, kind: "keyword", keyword: null })).toThrow("必须提供关键词");
  });

  it("normalizes ASIN and produces a stable request hash", () => {
    const first = AmazonMonitorRequestSchema.parse({ ...base, kind: "competitor", asin: "b0h1vcsgwk", keyword: null });
    const second = AmazonMonitorRequestSchema.parse({ ...base, kind: "competitor", keyword: null, idempotencyKey: "monitor-test-key-0002" });
    expect(first.asin).toBe("B0H1VCSGWK");
    expect(monitorRequestHash(first)).toBe(monitorRequestHash(second));
  });

  it("keeps provider capabilities separated by monitor kind", () => {
    expect(requiredMonitorCapabilities("competitor")).toEqual(["offers", "rankings"]);
    expect(requiredMonitorCapabilities("keyword")).toEqual(["search_rank"]);
  });

  it("requires returned price, BSR and offer evidence before accepting a competitor snapshot", () => {
    expect(hasRequiredMonitorEvidence({ kind: "competitor", asin: "B0H1VCSGWK", marketplace: "US", title: null, price: "19.99", currency: "USD", bsrRank: 100, bsrCategory: "Home", bsrCategories: [], buyBoxWinner: null, buyBoxSellerName: null, shipsFrom: null, offerCount: null, snapshotAt: null, coverage: { price: "returned", bsrRank: "returned", buyBox: "not_returned", offerCount: "not_returned", ratings: "provider_unsupported", availability: "provider_unsupported", coupon: "provider_unsupported", deal: "provider_unsupported" } })).toBe(false);
  });

  it("requires a location-pinned organic ranking observation before accepting search-rank output", () => {
    expect(hasRequiredMonitorEvidence({ kind: "keyword", asin: "B0H1VCSGWK", marketplace: "US", keyword: "travel tumbler", found: false, organicRank: null, adRank: null, absoluteRank: null, pageNumber: null, notInTop: null, resultsScanned: 48, searchVolume: null, observedFrom: "10001", locationPinned: false, positionNoise: null, runAt: null, coverage: { organicRank: "not_returned", adRank: "not_returned", location: "returned", searchVolume: "not_returned" } })).toBe(false);
  });
});
