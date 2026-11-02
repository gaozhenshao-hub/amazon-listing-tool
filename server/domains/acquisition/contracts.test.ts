import { describe, expect, it } from "vitest";
import type { AmazonAcquisitionProvider } from "./contracts";
import {
  AmazonAcquisitionRequestSchema,
  assertProviderSupportsRequest,
  NormalizedAmazonSnapshotSchema,
} from "./contracts";

const request = AmazonAcquisitionRequestSchema.parse({
  workspaceId: 1,
  marketplace: "US",
  asin: "B0H1VCSGWK",
  capabilities: ["catalog_basic", "image_gallery"],
  maxChargeUsd: 0.1,
  idempotencyKey: "workspace:1:US:B0H1VCSGWK:catalog+images",
});

const provider: AmazonAcquisitionProvider = {
  providerCode: "qualified-provider",
  supportedMarketplaces: ["US"],
  capabilities: ["catalog_basic", "image_gallery"],
  async estimate() {
    return { estimatedMaxUsd: 0.01, pricingModel: "pay_per_event", cacheEligible: true };
  },
  async fetch() {
    return {
      providerCode: "qualified-provider",
      providerRunId: "run-1",
      status: "succeeded",
      failureCategory: null,
      chargedUsd: 0.005,
      rawArtifact: null,
    };
  },
};

describe("统一Amazon采集核心合同", () => {
  it("接受精确站点、ASIN、能力和预算请求", () => {
    expect(request).toMatchObject({ marketplace: "US", asin: "B0H1VCSGWK", maxChargeUsd: 0.1 });
    expect(() => assertProviderSupportsRequest(provider, request)).not.toThrow();
  });

  it("Provider能力或站点不匹配时失败关闭", () => {
    expect(() => assertProviderSupportsRequest(provider, { ...request, marketplace: "JP" })).toThrow("marketplace");
    expect(() => assertProviderSupportsRequest(provider, { ...request, capabilities: ["aplus"] })).toThrow("aplus");
  });

  it("标准化Snapshot要求字段状态和仅哈希化的Provider图片定位", () => {
    const snapshot = NormalizedAmazonSnapshotSchema.parse({
      asin: "B0H1VCSGWK",
      marketplace: "US",
      sourceUrlHash: "a".repeat(64),
      title: "Public product title",
      brand: null,
      category: null,
      description: null,
      bulletPoints: [],
      price: null,
      rating: null,
      reviewCount: null,
      variantAsins: [],
      assets: [{
        role: "main",
        positionIndex: 0,
        sourcePath: "highResolutionImages[0]",
        sourceUrlHash: "b".repeat(64),
        providerAssetId: null,
        moduleType: null,
        moduleClass: null,
      }],
      fieldEvidence: {
        title: { status: "pending_review", sourcePath: "title", valueHash: "c".repeat(64), noteCode: null },
        aplus: { status: "not_returned", sourcePath: "aPlusContent", valueHash: null, noteCode: "not_observed" },
      },
    });
    expect(snapshot.assets[0]).not.toHaveProperty("sourceUrl");
    expect(snapshot.fieldEvidence.aplus?.status).toBe("not_returned");
  });
});
