import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
import { ACQUISITION_ASSET_ROLES, ACQUISITION_CONSUMER_TYPES, ACQUISITION_MARKETPLACES } from "./acquisition";
import { canonicalCompetitorResearchEvidence } from "./competitorResearchEvidence";

export const ACQUISITION_REVIEW_MAX_BYTES = 8 * 1024 * 1024;
export const ACQUISITION_REVIEW_MAX_ASSETS = 300;
const id = z.number().int().min(1).max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const text = (maximum: number) => z.string().trim().min(1).max(maximum).refine(value => {
  const bytes = new TextEncoder().encode(value);
  return new TextDecoder().decode(bytes) === value;
});
export function acquisitionReviewCanonical(value: unknown, maximum = ACQUISITION_REVIEW_MAX_BYTES): string {
  const result = canonicalCompetitorResearchEvidence(value);
  if (new TextEncoder().encode(result).byteLength > maximum) throw new Error("ACQUISITION_REVIEW_JSON_LIMIT");
  return result;
}
export function acquisitionReviewHash(value: unknown): string { return SHA256(acquisitionReviewCanonical(value)).toString(); }
export const AcquisitionReviewIdentitySchema = z.object({ userId: id, workspaceId: id }).strict();
export const AcquisitionReviewReadInputSchema = z.object({ expectedWorkspaceId: id, expectedProjectId: id.nullable(), snapshotId: id }).strict();
export const AcquisitionReviewPatchSchema = z.object({
  title: text(1000).nullable().optional(), brand: text(255).nullable().optional(), category: text(1000).nullable().optional(),
  description: text(20_000).nullable().optional(), bulletPoints: z.array(text(3000)).max(20).optional(),
  price: z.object({ value: z.string().regex(/^\d+(?:\.\d+)?$/u).max(50), currency: z.string().regex(/^[A-Z]{3}$/u) }).strict().nullable().optional(),
  rating: z.string().regex(/^\d+(?:\.\d+)?$/u).max(10).nullable().optional(), reviewCount: z.number().int().min(0).max(2147483647).nullable().optional(),
  variantAsins: z.array(z.string().regex(/^[A-Z0-9]{10}$/u)).max(200).optional(),
}).strict();
export const AcquisitionReviewDecisionSchema = z.object({ assetId: id, decision: z.enum(["keep", "delete", "pending"]) }).strict();
export const AcquisitionReviewDecisionsSchema = z.array(AcquisitionReviewDecisionSchema).max(ACQUISITION_REVIEW_MAX_ASSETS)
  .refine(value => new Set(value.map(item => item.assetId)).size === value.length);
const mutation = AcquisitionReviewReadInputSchema.extend({ operationId: uuid, expectedRevisionHash: hash }).strict();
export const AcquisitionReviewSaveInputSchema = mutation.extend({ action: z.literal("save"), patch: AcquisitionReviewPatchSchema,
  assetDecisions: AcquisitionReviewDecisionsSchema, note: text(2000).nullable() }).strict();
export const AcquisitionReviewConfirmInputSchema = mutation.extend({ action: z.literal("confirm"), note: text(2000).nullable() }).strict();
export const AcquisitionReviewRejectInputSchema = mutation.extend({ action: z.literal("reject"), note: text(2000) }).strict();
export const AcquisitionReviewWriteInputSchema = z.discriminatedUnion("action", [AcquisitionReviewSaveInputSchema, AcquisitionReviewConfirmInputSchema, AcquisitionReviewRejectInputSchema]);
export const AcquisitionReviewOperationInputSchema = AcquisitionReviewReadInputSchema.extend({ operationId: uuid }).strict();
export const AcquisitionReviewRecoverInputSchema = AcquisitionReviewOperationInputSchema.extend({ decision: z.enum(["check", "cancel"]) }).strict();
const imageRole = z.enum(["main", "secondary", "aplus", "brand_story"]);
export const AcquisitionReviewImageInputSchema = z.discriminatedUnion("mode", [
  mutation.extend({ mode: z.literal("retry_original"), sourceAssetId: id }).strict(),
  mutation.extend({ mode: z.literal("supplement"), sourceAssetId: id.nullable(), role: imageRole,
    fileName: text(180).refine(value => !/[\\/\u0000-\u001f\u007f]/u.test(value)),
    base64: z.string().min(4).max(Math.ceil(8 * 1024 * 1024 / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/u),
  }).strict(),
]);
export const AcquisitionReviewImageRecoverInputSchema = AcquisitionReviewOperationInputSchema.extend({ decision: z.enum(["check", "complete_image", "cancel"]) }).strict();
const capability = z.object({ available: z.boolean(), reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/u).nullable() }).strict()
  .refine(value => value.available === (value.reasonCode === null));
const jsonObject = z.record(z.string(), z.unknown()).superRefine((value, ctx) => {
  try { acquisitionReviewCanonical(value); } catch { ctx.addIssue({ code: "custom", message: "Invalid or oversized JSON" }); }
});
export const AcquisitionReviewReadResultSchema = z.object({
  identity: AcquisitionReviewIdentitySchema, scope: AcquisitionReviewReadInputSchema,
  snapshot: z.object({ id, jobId: id, asin: z.string().regex(/^[A-Z0-9]{10}$/u), marketplace: z.enum(ACQUISITION_MARKETPLACES),
    status: z.enum(["draft", "pending_review", "confirmed", "rejected", "superseded"]), jobStatus: z.enum(["queued", "running", "review_required", "confirmed", "failed", "canceled"]),
    consumerType: z.enum(ACQUISITION_CONSUMER_TYPES), consumerRef: text(128), sourceHash: hash }).strict(),
  original: jsonObject, effectiveDraft: jsonObject,
  revision: z.object({ id, version: id, hash, status: z.enum(["pending_review", "confirmed", "rejected"]), note: text(2000).nullable() }).strict().nullable(),
  revisionHash: hash,
  assets: z.array(z.object({ id, role: z.enum(ACQUISITION_ASSET_ROLES), positionIndex: z.number().int().nonnegative(),
    fieldStatus: text(64), storageAvailable: z.boolean(), contentHash: hash.nullable(),
    decision: z.enum(["keep", "delete", "pending"]), origin: z.enum(["original", "supplement"]), replacesAssetId: id.nullable(),
    previewUrl: z.string().url().max(4096).nullable(), width: id.nullable(), height: id.nullable(),
  }).strict()).max(ACQUISITION_REVIEW_MAX_ASSETS),
  capabilities: z.object({ save: capability, confirm: capability, reject: capability, image: capability }).strict(),
}).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.scope.expectedWorkspaceId || value.snapshot.id !== value.scope.snapshotId
    || new Set(value.assets.map(asset => asset.id)).size !== value.assets.length) ctx.addIssue({ code: "custom", message: "Review scope mismatch" });
  try { acquisitionReviewCanonical(value); } catch { ctx.addIssue({ code: "custom", message: "Review exceeds complete-read budget" }); }
});
export const AcquisitionReviewWriteResultSchema = z.object({
  identity: AcquisitionReviewIdentitySchema, scope: AcquisitionReviewReadInputSchema, operationId: uuid,
  action: z.enum(["save", "confirm", "reject", "image"]).nullable(), status: z.enum(["committed", "cancelled", "unknown"]),
  requestHash: hash.nullable(), revisionId: id.nullable(), revisionVersion: id.nullable(), committedRevisionHash: hash.nullable(),
  confirmedSnapshotId: id.nullable(), reasonCode: z.string().regex(/^[A-Z][A-Z0-9_]{0,100}$/u).nullable(),
}).strict().superRefine((value, ctx) => {
  const valid = value.identity.workspaceId === value.scope.expectedWorkspaceId && (value.status === "committed"
    ? value.action !== null && value.requestHash !== null && value.revisionId !== null && value.revisionVersion !== null && value.committedRevisionHash !== null
      && value.reasonCode === null && (value.action === "confirm" ? value.confirmedSnapshotId !== null : value.confirmedSnapshotId === null)
    : value.action === null && value.requestHash === null && value.revisionId === null && value.revisionVersion === null
      && value.committedRevisionHash === null && value.confirmedSnapshotId === null && value.reasonCode === (value.status === "cancelled" ? "OPERATION_CANCELLED" : "OUTCOME_UNKNOWN"));
  if (!valid) ctx.addIssue({ code: "custom", message: "Review receipt binding mismatch" });
});
export type AcquisitionReviewIdentity = z.infer<typeof AcquisitionReviewIdentitySchema>;
export type AcquisitionReviewReadInput = z.infer<typeof AcquisitionReviewReadInputSchema>;
export type AcquisitionReviewPatch = z.infer<typeof AcquisitionReviewPatchSchema>;
export type AcquisitionReviewDecision = z.infer<typeof AcquisitionReviewDecisionSchema>;
export type AcquisitionReviewReadResult = z.infer<typeof AcquisitionReviewReadResultSchema>;
export type AcquisitionReviewWriteInput = z.infer<typeof AcquisitionReviewWriteInputSchema>;
export type AcquisitionReviewOperationInput = z.infer<typeof AcquisitionReviewOperationInputSchema>;
export type AcquisitionReviewRecoverInput = z.infer<typeof AcquisitionReviewRecoverInputSchema>;
export type AcquisitionReviewWriteResult = z.infer<typeof AcquisitionReviewWriteResultSchema>;
export type AcquisitionReviewImageInput = z.infer<typeof AcquisitionReviewImageInputSchema>;
export type AcquisitionReviewImageRecoverInput = z.infer<typeof AcquisitionReviewImageRecoverInputSchema>;
export function acquisitionReviewRequestHash(identity: AcquisitionReviewIdentity, input: AcquisitionReviewWriteInput): string {
  return acquisitionReviewHash({ identity: AcquisitionReviewIdentitySchema.parse(identity), request: AcquisitionReviewWriteInputSchema.parse(input) });
}
export function acquisitionReviewImageRequestHash(identity: AcquisitionReviewIdentity, raw: AcquisitionReviewImageInput, metadata?: { contentHash: string; byteSize: number }): string {
  const input = AcquisitionReviewImageInputSchema.parse(raw);
  if (input.mode === "retry_original") return acquisitionReviewHash({ identity: AcquisitionReviewIdentitySchema.parse(identity), request: input });
  const { base64: _bytes, ...request } = input;
  const parsed = z.object({ contentHash: hash, byteSize: z.number().int().positive().max(8 * 1024 * 1024) }).strict().parse(metadata);
  return acquisitionReviewHash({ identity: AcquisitionReviewIdentitySchema.parse(identity), request: { ...request, ...parsed } });
}
