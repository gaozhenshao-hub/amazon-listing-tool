import { describe, expect, it } from "vitest";
import {
  acquisitionAttemptIdempotencyKey,
  buildAcquisitionIdempotencyKey,
  evaluateAcquisitionBudget,
  isAcquisitionCacheFresh,
} from "./policy";

const policy = {
  perRunMaxUsd: 0.1,
  dailyBudgetUsd: 2,
  monthlyBudgetUsd: 30,
  cacheTtlSeconds: 86_400,
};

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

  it("fails closed for each budget boundary", () => {
    expect(evaluateAcquisitionBudget({ estimatedMaxUsd: 0.2, requestedMaxUsd: 0.1, dailyChargedUsd: 0, monthlyChargedUsd: 0, policy }).reason).toBe("request_limit");
    expect(evaluateAcquisitionBudget({ estimatedMaxUsd: 0.11, requestedMaxUsd: 1, dailyChargedUsd: 0, monthlyChargedUsd: 0, policy }).reason).toBe("per_run_limit");
    expect(evaluateAcquisitionBudget({ estimatedMaxUsd: 0.05, requestedMaxUsd: 0.1, dailyChargedUsd: 1.96, monthlyChargedUsd: 0, policy }).reason).toBe("daily_limit");
    expect(evaluateAcquisitionBudget({ estimatedMaxUsd: 0.05, requestedMaxUsd: 0.1, dailyChargedUsd: 0, monthlyChargedUsd: 29.96, policy }).reason).toBe("monthly_limit");
  });
});
