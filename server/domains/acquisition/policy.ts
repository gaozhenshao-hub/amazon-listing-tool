import { createHash } from "node:crypto";
import { z } from "zod";
import type { AmazonAcquisitionCapability } from "../../../shared/acquisition";

export const DEFAULT_ACQUISITION_CACHE_TTL_SECONDS = 24 * 60 * 60;

export const AcquisitionBudgetPolicySchema = z.object({
  perRunMaxUsd: z.number().positive().max(100),
  dailyBudgetUsd: z.number().positive().max(10_000),
  monthlyBudgetUsd: z.number().positive().max(100_000),
  cacheTtlSeconds: z.number().int().min(60).max(30 * 24 * 60 * 60),
}).refine(value => value.dailyBudgetUsd >= value.perRunMaxUsd, {
  message: "Daily budget must be at least the per-run limit",
  path: ["dailyBudgetUsd"],
}).refine(value => value.monthlyBudgetUsd >= value.dailyBudgetUsd, {
  message: "Monthly budget must be at least the daily budget",
  path: ["monthlyBudgetUsd"],
});
export type AcquisitionBudgetPolicy = z.infer<typeof AcquisitionBudgetPolicySchema>;

export function buildAcquisitionIdempotencyKey(input: {
  workspaceId: number;
  consumerType: string;
  consumerRef: string;
  marketplace: string;
  asin: string;
  capabilities: readonly AmazonAcquisitionCapability[];
  cachePolicy: string;
}): string {
  const canonical = JSON.stringify({
    workspaceId: input.workspaceId,
    consumerType: input.consumerType.trim(),
    consumerRef: input.consumerRef.trim(),
    marketplace: input.marketplace.trim().toUpperCase(),
    asin: input.asin.trim().toUpperCase(),
    capabilities: [...new Set(input.capabilities)].sort(),
    cachePolicy: input.cachePolicy,
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function acquisitionAttemptIdempotencyKey(input: {
  baseKey: string;
  existingStatus?: string | null;
  now?: Date;
}): { key: string; reuseExisting: boolean } {
  if (input.existingStatus && ["queued", "running", "review_required"].includes(input.existingStatus)) {
    return { key: input.baseKey, reuseExisting: true };
  }
  if (!input.existingStatus) return { key: input.baseKey, reuseExisting: false };
  const minuteBucket = Math.floor((input.now ?? new Date()).getTime() / 60_000).toString(36);
  return { key: `${input.baseKey}:${minuteBucket}`, reuseExisting: false };
}

export function isAcquisitionCacheFresh(input: {
  capturedAt: Date;
  now: Date;
  cacheTtlSeconds: number;
}): boolean {
  const ageMs = input.now.getTime() - input.capturedAt.getTime();
  return ageMs >= 0 && ageMs <= input.cacheTtlSeconds * 1_000;
}

export type AcquisitionBudgetDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: "request_limit" | "per_run_limit" | "daily_limit" | "monthly_limit" };

export function evaluateAcquisitionBudget(input: {
  estimatedMaxUsd: number;
  requestedMaxUsd: number;
  dailyChargedUsd: number;
  monthlyChargedUsd: number;
  policy: AcquisitionBudgetPolicy;
}): AcquisitionBudgetDecision {
  const values = [
    input.estimatedMaxUsd,
    input.requestedMaxUsd,
    input.dailyChargedUsd,
    input.monthlyChargedUsd,
  ];
  if (values.some(value => !Number.isFinite(value) || value < 0)) {
    return { allowed: false, reason: "request_limit" };
  }
  if (input.estimatedMaxUsd > input.requestedMaxUsd) return { allowed: false, reason: "request_limit" };
  if (input.estimatedMaxUsd > input.policy.perRunMaxUsd) return { allowed: false, reason: "per_run_limit" };
  if (input.dailyChargedUsd + input.estimatedMaxUsd > input.policy.dailyBudgetUsd) {
    return { allowed: false, reason: "daily_limit" };
  }
  if (input.monthlyChargedUsd + input.estimatedMaxUsd > input.policy.monthlyBudgetUsd) {
    return { allowed: false, reason: "monthly_limit" };
  }
  return { allowed: true, reason: null };
}
