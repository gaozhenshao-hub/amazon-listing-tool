import { z } from "zod";
import {
  ACQUISITION_FIELD_STATUSES,
  AMAZON_ACQUISITION_CAPABILITIES,
  PROVIDER_FAILURE_CATEGORIES,
  type AcquisitionFieldStatus as SharedAcquisitionFieldStatus,
  type AmazonAcquisitionCapability as SharedAmazonAcquisitionCapability,
  type ProviderFailureCategory as SharedProviderFailureCategory,
} from "../../../shared/acquisition";

export { ACQUISITION_FIELD_STATUSES, AMAZON_ACQUISITION_CAPABILITIES, PROVIDER_FAILURE_CATEGORIES };

export const AmazonAcquisitionCapabilitySchema = z.enum(AMAZON_ACQUISITION_CAPABILITIES);
export type AmazonAcquisitionCapability = SharedAmazonAcquisitionCapability;

export const AcquisitionFieldStatusSchema = z.enum(ACQUISITION_FIELD_STATUSES);
export type AcquisitionFieldStatus = SharedAcquisitionFieldStatus;

export const ProviderFailureCategorySchema = z.enum(PROVIDER_FAILURE_CATEGORIES);
export type ProviderFailureCategory = SharedProviderFailureCategory;

export const ProviderQualificationDecisionSchema = z.enum([
  "approved",
  "conditionally_approved",
  "rejected",
  "pending_real_sample",
]);
export type ProviderQualificationDecision = z.infer<typeof ProviderQualificationDecisionSchema>;

export const ProviderFieldEvidenceSchema = z.object({
  status: AcquisitionFieldStatusSchema,
  sourcePath: z.string().trim().min(1).nullable(),
  valueHash: z.string().trim().min(1).nullable(),
  noteCode: z.string().trim().min(1).nullable(),
});
export type ProviderFieldEvidence = z.infer<typeof ProviderFieldEvidenceSchema>;

export const ProviderQualificationRecordSchema = z.object({
  provider: z.string().trim().min(1),
  actor: z.string().trim().min(1),
  actorVersion: z.string().trim().min(1).nullable(),
  checkedAt: z.string().datetime(),
  declaredCapabilities: z.array(AmazonAcquisitionCapabilitySchema),
  observedCapabilities: z.array(AmazonAcquisitionCapabilitySchema),
  fieldEvidence: z.record(z.string(), ProviderFieldEvidenceSchema),
  decision: ProviderQualificationDecisionSchema,
  pricingModel: z.string().trim().min(1),
  maxObservedChargeUsd: z.number().nonnegative().nullable(),
});
export type ProviderQualificationRecord = z.infer<typeof ProviderQualificationRecordSchema>;

export function inferAcquisitionFieldStatus(input: {
  providerSupportsField: boolean;
  providerReportedAbsent?: boolean;
  requestBlockedSuspected?: boolean;
  valueReturned: boolean;
  valueValid?: boolean;
  humanConfirmed?: boolean;
}): AcquisitionFieldStatus {
  if (!input.providerSupportsField) return "provider_unsupported";
  if (input.requestBlockedSuspected) return "provider_blocked_suspected";
  if (input.valueReturned && input.valueValid === false) return "invalid";
  if (input.valueReturned) return input.humanConfirmed ? "returned" : "pending_review";
  if (input.providerReportedAbsent && input.humanConfirmed) return "confirmed_absent";
  return "not_returned";
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.toLowerCase();
  if (typeof error === "string") return error.toLowerCase();
  return "";
}

export function classifyProviderFailure(error: unknown): ProviderFailureCategory {
  const message = errorMessage(error);

  if (message.includes("not configured") || message.includes("missing api token")) return "provider_not_configured";
  if (message.includes("401") || message.includes("unauthorized") || message.includes("invalid token")) return "authentication_failed";
  if (message.includes("403") || message.includes("forbidden")) return "permission_denied";
  if (message.includes("429") || message.includes("rate limit")) return "rate_limited";
  if (message.includes("timeout") || message.includes("timed out")) return "request_timeout";
  if (message.includes("budget") || message.includes("charge limit")) return "budget_exceeded";
  if (message.includes("partial result") || message.includes("partial_result")) return "partial_result";
  if (message.includes("schema") || message.includes("unexpected field")) return "schema_drift";
  if (message.includes("normalize") || message.includes("normalization")) return "normalization_failed";
  if (message.includes("captcha") || message.includes("blocked")) return "provider_blocked_suspected";
  if (message.includes("503") || message.includes("unavailable") || message.includes("connection refused")) return "provider_unavailable";
  return "unknown";
}

export function assertQualificationCanBeApproved(record: ProviderQualificationRecord): void {
  const requiredCapabilities: AmazonAcquisitionCapability[] = ["catalog_basic", "image_gallery"];
  const observed = new Set(record.observedCapabilities);
  const missing = requiredCapabilities.filter((capability) => !observed.has(capability));

  if (missing.length > 0) {
    throw new Error(`Provider qualification missing required capabilities: ${missing.join(",")}`);
  }

  const unresolvedFields = Object.entries(record.fieldEvidence)
    .filter(([, evidence]) => ["pending_review", "invalid", "provider_blocked_suspected"].includes(evidence.status))
    .map(([field]) => field);
  if (unresolvedFields.length > 0) {
    throw new Error(`Provider qualification contains unresolved fields: ${unresolvedFields.join(",")}`);
  }
}
