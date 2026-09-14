import { describe, expect, it } from "vitest";
import {
  assertQualificationCanBeApproved,
  classifyProviderFailure,
  inferAcquisitionFieldStatus,
  ProviderQualificationRecordSchema,
} from "./providerContracts";

describe("Amazon受控Provider合同", () => {
  it("区分未返回、确认不存在、Provider不支持和疑似阻断", () => {
    expect(inferAcquisitionFieldStatus({ providerSupportsField: true, valueReturned: false })).toBe("not_returned");
    expect(inferAcquisitionFieldStatus({
      providerSupportsField: true,
      providerReportedAbsent: true,
      valueReturned: false,
      humanConfirmed: true,
    })).toBe("confirmed_absent");
    expect(inferAcquisitionFieldStatus({ providerSupportsField: false, valueReturned: false })).toBe("provider_unsupported");
    expect(inferAcquisitionFieldStatus({
      providerSupportsField: true,
      requestBlockedSuspected: true,
      valueReturned: false,
    })).toBe("provider_blocked_suspected");
  });

  it("Provider返回有效值后仍需人工审核，确认后才成为returned", () => {
    expect(inferAcquisitionFieldStatus({
      providerSupportsField: true,
      valueReturned: true,
      valueValid: true,
    })).toBe("pending_review");
    expect(inferAcquisitionFieldStatus({
      providerSupportsField: true,
      valueReturned: true,
      valueValid: true,
      humanConfirmed: true,
    })).toBe("returned");
  });

  it("将Provider异常限制为固定脱敏类别", () => {
    expect(classifyProviderFailure(new Error("401 invalid token from upstream"))).toBe("authentication_failed");
    expect(classifyProviderFailure(new Error("429 rate limit exceeded"))).toBe("rate_limited");
    expect(classifyProviderFailure(new Error("request timed out"))).toBe("request_timeout");
    expect(classifyProviderFailure(new Error("captcha blocked response"))).toBe("provider_blocked_suspected");
    expect(classifyProviderFailure(new Error("apify_network"))).toBe("provider_unavailable");
    expect(classifyProviderFailure(new Error("apify_http_400"))).toBe("schema_drift");
    expect(classifyProviderFailure(new Error("apify_http_503"))).toBe("provider_unavailable");
    expect(classifyProviderFailure(new Error("source-specific secret detail"))).toBe("unknown");
  });

  it("只有实样观察到基础目录和完整图库且无未决字段时才允许批准", () => {
    const record = ProviderQualificationRecordSchema.parse({
      provider: "apify",
      actor: "example/amazon-product",
      actorVersion: "build-1",
      checkedAt: "2026-09-13T00:00:00.000Z",
      declaredCapabilities: ["catalog_basic", "image_gallery", "aplus"],
      observedCapabilities: ["catalog_basic", "image_gallery"],
      fieldEvidence: {
        title: { status: "returned", sourcePath: "title", valueHash: "hash-title", noteCode: null },
        gallery: { status: "returned", sourcePath: "highResolutionImages", valueHash: "hash-gallery", noteCode: null },
        aplus: { status: "not_returned", sourcePath: "aPlusContent", valueHash: null, noteCode: "not_observed" },
      },
      decision: "conditionally_approved",
      pricingModel: "pay_per_event",
      maxObservedChargeUsd: 0.01,
    });

    expect(() => assertQualificationCanBeApproved(record)).not.toThrow();
    expect(() => assertQualificationCanBeApproved({
      ...record,
      observedCapabilities: ["catalog_basic"],
    })).toThrow("image_gallery");
    expect(() => assertQualificationCanBeApproved({
      ...record,
      fieldEvidence: {
        ...record.fieldEvidence,
        gallery: { status: "pending_review", sourcePath: "highResolutionImages", valueHash: "hash-gallery", noteCode: null },
      },
    })).toThrow("gallery");
  });
});
