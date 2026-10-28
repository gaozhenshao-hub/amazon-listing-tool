import { describe, expect, it } from "vitest";
import {
  acquisitionAttemptIdempotencyKey,
  buildAcquisitionIdempotencyKey,
  isAcquisitionCacheFresh,
} from "./policy";


describe("acquisition policy", () => {
  it("builds the same idempotency key regardless of capability order", () => {
    const base = {
      workspaceId: 1,
      consumerType: "kb_images",
      consumerRef: "set-1",
      marketplace: "US",
      asin: "B000000001",
      cachePolicy: "prefer_cache",
    };
    expect(buildAcquisitionIdempotencyKey({ ...base, capabilities: ["catalog_basic", "image_gallery"] }))
      .toBe(buildAcquisitionIdempotencyKey({ ...base, capabilities: ["image_gallery", "catalog_basic"] }));
  });

  it("uses a 24-hour freshness boundary", () => {
    const now = new Date("2026-09-13T12:00:00.000Z");
    expect(isAcquisitionCacheFresh({ capturedAt: new Date("2026-09-12T12:00:00.000Z"), now, cacheTtlSeconds: 86_400 })).toBe(true);
    expect(isAcquisitionCacheFresh({ capturedAt: new Date("2026-09-12T11:59:59.000Z"), now, cacheTtlSeconds: 86_400 })).toBe(false);
  });

  it("reuses active jobs but allows a new completed or failed attempt", () => {
    const now = new Date("2026-09-13T12:34:10.000Z");
    expect(acquisitionAttemptIdempotencyKey({ baseKey: "base", existingStatus: "running", now }))
      .toEqual({ key: "base", reuseExisting: true });
    expect(acquisitionAttemptIdempotencyKey({ baseKey: "base", existingStatus: "confirmed", now }).key)
      .toMatch(/^base:/);
    expect(acquisitionAttemptIdempotencyKey({ baseKey: "base", existingStatus: "failed", now }).key)
      .toBe(acquisitionAttemptIdempotencyKey({ baseKey: "base", existingStatus: "failed", now }).key);
  });

});
