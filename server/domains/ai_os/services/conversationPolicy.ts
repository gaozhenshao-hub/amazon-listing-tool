export type ConversationRiskLevel = "L0" | "L1" | "L2" | "L3";

export function conversationStepRequiresApproval(input: { riskLevel: ConversationRiskLevel; approvalRequired?: boolean }) {
  return Boolean(input.approvalRequired || input.riskLevel === "L2" || input.riskLevel === "L3");
}

export function conversationAttachmentContextPolicy(mimeType: string): "summary_only" | "extracted_text" | "image_vision" {
  if (mimeType.startsWith("image/")) return "image_vision";
  if (mimeType.startsWith("text/") || mimeType === "application/json" || mimeType === "application/pdf") return "extracted_text";
  return "summary_only";
}

export function parseConversationStructuredJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") return value as T;
  const trimmed = value.trim();
  const unfenced = trimmed.startsWith("```")
    ? trimmed.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim()
    : trimmed;
  try { return JSON.parse(unfenced) as T; } catch { return fallback; }
}

export function filterConversationPlanSteps<T extends { capabilityType: string; capabilitySlug: string }>(steps: T[], catalog: Array<{ capabilityType: string; slug: string }>) {
  const allowed = new Set(catalog.map((item) => `${item.capabilityType}:${item.slug}`));
  return {
    valid: steps.filter((step) => allowed.has(`${step.capabilityType}:${step.capabilitySlug}`)),
    invalid: steps.filter((step) => !allowed.has(`${step.capabilityType}:${step.capabilitySlug}`)),
  };
}

const RETRYABLE_PLANNER_ERROR_CODES = new Set([
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMIT",
  "PROVIDER_UNAVAILABLE",
]);

export const CONVERSATION_PLANNER_MAX_ATTEMPTS = 2;

export function shouldRetryConversationPlannerError(error: unknown) {
  const cause = (error as { cause?: unknown } | null | undefined)?.cause as { code?: unknown; retryable?: unknown } | undefined;
  return Boolean(cause?.retryable && typeof cause.code === "string" && RETRYABLE_PLANNER_ERROR_CODES.has(cause.code));
}

export function conversationPlannerRetryDelayMs(attemptIndex: number) {
  return Math.min(1_000, 250 * (2 ** Math.max(0, attemptIndex)));
}
