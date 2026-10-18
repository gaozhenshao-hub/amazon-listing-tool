import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
import { canonicalCompetitorResearchEvidence } from "./competitorResearchEvidence";

export const COMPETITOR_DEEP_ADOPTION_MAX_BYTES = 768 * 1024;
export const COMPETITOR_DEEP_ADOPTION_RAW_KEY = "deepAdoptionRef" as const;
const id = z.number().int().positive().safe();
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().regex(/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u);
const runId = z.string().min(1).max(80).refine(value => value.trim() === value);
const timestamp = z.string().datetime();
const summary = z.string().trim().min(1).max(20_000).refine(value => {
  const bytes = new TextEncoder().encode(value);
  return bytes.length <= 65_535 && new TextDecoder().decode(bytes) === value;
}, "DEEP_ADOPTION_SUMMARY_INVALID");
export const CompetitorDeepAdoptionIdentitySchema = z.object({ userId: id, workspaceId: id.nullable(),
  sourceWorkspaceId: id.nullable(), projectId: id, analysisId: id, asin: z.string().regex(/^[A-Z0-9]{10}$/u) }).strict();
export const CompetitorDeepAdoptionRefSchema = z.object({ version: z.literal(1), kind: z.literal("competitor_deep_adoption"),
  artifactId: z.string().regex(/^deep_adopt_[a-f0-9]{64}$/u), operationId: uuid, jobRunId: runId,
  resultHash: hash, evidenceHash: hash, sourceFingerprint: hash, projectionHash: hash, summaryHash: hash,
  summaryVersion: id, adoptedBy: id, adoptedAt: timestamp }).strict();
/** The full result is replay-validated by the server. Shape/hash parsing alone
 * is not authorization, provenance, or a usable current research projection. */
export const CompetitorDeepAdoptionArtifactSchema = z.object({ version: z.literal(1), kind: z.literal("adopted_competitor_deep_research"),
  identity: CompetitorDeepAdoptionIdentitySchema, operationId: uuid, jobRunId: runId,
  originalArtifactId: z.string().regex(/^deep_[a-f0-9]{64}$/u), publicationRevision: hash,
  resultHash: hash, evidenceHash: hash, skillPlanHash: hash, journalHash: hash, sourceFingerprint: hash,
  summary, summaryVersion: id, adoptedBy: id, adoptedAt: timestamp,
  result: z.unknown().refine(value => !!value && typeof value === "object" && !Array.isArray(value)) }).strict();
export type CompetitorDeepAdoptionRef = z.infer<typeof CompetitorDeepAdoptionRefSchema>;
export type CompetitorDeepAdoptionArtifact = z.infer<typeof CompetitorDeepAdoptionArtifactSchema>;
export type CompetitorDeepAdoptionIdentity = z.infer<typeof CompetitorDeepAdoptionIdentitySchema>;
const scope = z.object({ projectId: id, analysisId: id, expectedWorkspaceId: id.nullable(), jobRunId: runId, operationId: uuid }).strict();
export const CompetitorDeepAdoptionOperationInputSchema = scope;
export const CompetitorDeepAdoptionInputSchema = scope.extend({ expectedRevision: hash, expectedResultHash: hash,
  expectedEvidenceHash: hash, summary, confirmLimitations: z.literal(true) }).strict();
const receipt = z.object({ version: z.literal(1), identity: z.object({ userId: id, workspaceId: id.nullable() }).strict(),
  projectId: id, analysisId: id, jobRunId: runId, operationId: uuid, status: z.enum(["committed", "cancelled", "unknown"]),
  requestHash: hash.nullable(), ref: CompetitorDeepAdoptionRefSchema.nullable(), committedRevision: hash.nullable(),
  reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/u).nullable() }).strict();
function receiptValid(value: z.infer<typeof receipt>) {
  return value.status === "committed" ? value.requestHash !== null && value.ref !== null && value.committedRevision !== null
    && value.reasonCode === null && value.ref.operationId === value.operationId && value.ref.jobRunId === value.jobRunId
    && value.ref.adoptedBy === value.identity.userId : value.ref === null && value.committedRevision === null;
}
export const CompetitorDeepAdoptionReceiptSchema = receipt.refine(receiptValid, "DEEP_ADOPTION_RECEIPT_INVALID");
export const CompetitorDeepAdoptionResultSchema = receipt.extend({ currentRevision: hash.nullable(), currentActive: z.boolean() })
  .refine(value => receiptValid(value) && (!value.currentActive || value.status === "committed" && value.currentRevision !== null), "DEEP_ADOPTION_RESULT_INVALID");
export type CompetitorDeepAdoptionInput = z.infer<typeof CompetitorDeepAdoptionInputSchema>;
export type CompetitorDeepAdoptionOperationInput = z.infer<typeof CompetitorDeepAdoptionOperationInputSchema>;
export type CompetitorDeepAdoptionReceipt = z.infer<typeof CompetitorDeepAdoptionReceiptSchema>;
export type CompetitorDeepAdoptionResult = z.infer<typeof CompetitorDeepAdoptionResultSchema>;
export const CompetitorActiveResearchDeliverySchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("legacy") }).strict(),
  z.object({ status: z.literal("unavailable"), reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/u) }).strict(),
  z.object({ status: z.literal("adopted_deep"), identity: CompetitorDeepAdoptionIdentitySchema,
    ref: CompetitorDeepAdoptionRefSchema, currentRevision: hash }).strict(),
]);
export type CompetitorActiveResearchDelivery = z.infer<typeof CompetitorActiveResearchDeliverySchema>;
export const competitorDeepAdoptionCanonical = canonicalCompetitorResearchEvidence;
export function competitorDeepAdoptionHash(value: unknown): string { return SHA256(competitorDeepAdoptionCanonical(value)).toString(); }
export function competitorDeepAdoptionArtifactId(scope: { userId: number; workspaceId: number | null; operationId: string }): string {
  return `deep_adopt_${competitorDeepAdoptionHash({ identity: { userId: scope.userId, workspaceId: scope.workspaceId }, operationId: scope.operationId })}`;
}
/** Review-state equality only; not artifact verification, source provenance,
 * authorization, or permission to issue an active research projection. */
export function matchesCurrentCompetitorDeepAdoptionReview(row: {
  summaryStatus: unknown; summaryVersion: unknown; summaryConfirmedBy: unknown; summaryConfirmedAt: unknown; summary: unknown;
}, ref: CompetitorDeepAdoptionRef): boolean {
  try {
    return row.summaryStatus === "confirmed" && row.summaryVersion === ref.summaryVersion && row.summaryConfirmedBy === ref.adoptedBy
      && row.summaryConfirmedAt instanceof Date && row.summaryConfirmedAt.toISOString() === ref.adoptedAt
      && typeof row.summary === "string" && competitorDeepAdoptionHash(row.summary) === ref.summaryHash;
  } catch { return false; }
}

/** Conservative source binding: every persisted field except summary review
 * metadata and updatedAt; in rawData only the server adoption pointer is omitted.
 * In particular old AI, unknown raw keys and manual sales remain bound. */
export function competitorDeepAdoptionSourceFingerprint(row: unknown): string {
  if (!row || typeof row !== "object" || Array.isArray(row)
    || ![Object.prototype, null].includes(Object.getPrototypeOf(row))) throw new Error("DEEP_ADOPTION_SOURCE_INVALID");
  const descriptors = Object.getOwnPropertyDescriptors(row);
  if (Reflect.ownKeys(row).some(key => typeof key !== "string")) throw new Error("DEEP_ADOPTION_SOURCE_INVALID");
  const source: Record<string, unknown> = {};
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor) || !descriptor.enumerable) throw new Error("DEEP_ADOPTION_SOURCE_INVALID");
    if (key.startsWith("summary") || key === "updatedAt") continue;
    let value: unknown = descriptor.value;
    if (value instanceof Date) value = Date.prototype.toISOString.call(value);
    if (key === "rawData" && value !== null) {
      if (typeof value !== "string") throw new Error("DEEP_ADOPTION_SOURCE_INVALID");
      let raw: unknown;
      try { raw = value.trim() ? JSON.parse(value) : {}; } catch { throw new Error("DEEP_ADOPTION_SOURCE_INVALID"); }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("DEEP_ADOPTION_SOURCE_INVALID");
      const copy = { ...raw } as Record<string, unknown>; delete copy[COMPETITOR_DEEP_ADOPTION_RAW_KEY]; value = copy;
    }
    source[key] = value;
  }
  return competitorDeepAdoptionHash(source);
}
