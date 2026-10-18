import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
import { canonicalCompetitorResearchEvidence } from "./competitorResearchEvidence";
import { CATEGORY_OPTIONS, COLOR_SCHEME_OPTIONS, COMPOSITION_OPTIONS, STYLE_NAME_OPTIONS,
  IMAGE_TYPE_HIERARCHY, SELLING_POINT_HIERARCHY, COLOR_TAG_OPTIONS } from "./imageTagConstants";

/** Metadata only: original bytes are verified separately immediately before each dispatch. */
export const IMAGE_TAGGING_LIMITS = Object.freeze({ images: 300, sourceBytes: 4 * 1024 * 1024, imageBytes: 8 * 1024 * 1024 });
const id = z.number().int().min(1).max(2147483647);
const hash = z.string().regex(/^[a-f0-9]{64}$/u);
const uuid = z.string().uuid().refine(value => value === value.toLowerCase());
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
export function imageTaggingCanonical(value: unknown): string {
  const result = canonicalCompetitorResearchEvidence(value);
  if (new TextEncoder().encode(result).byteLength > IMAGE_TAGGING_LIMITS.sourceBytes) throw new Error("IMAGE_TAGGING_METADATA_LIMIT");
  return result;
}
export function imageTaggingHash(value: unknown): string { return SHA256(imageTaggingCanonical(value)).toString(); }
export const IMAGE_TAGGING_TAG_FIELDS = ["tagCategory", "tagImageTypeMain", "tagImageTypeSub", "tagSellingPointCategory",
  "tagSellingPointDetail", "tagComposition", "tagColorSchemeV2", "tagDesignStyleV2"] as const;
const allowed = (options: readonly string[]) => z.string().max(100).refine(value => value === "" || options.includes(value), "Unknown tag option");
const typeMain = Object.keys(IMAGE_TYPE_HIERARCHY);
const sellingMain = Object.keys(SELLING_POINT_HIERARCHY);
export const IMAGE_TAGGING_OPTIONS = Object.freeze({ categories: CATEGORY_OPTIONS, imageTypes: IMAGE_TYPE_HIERARCHY,
  sellingPoints: Object.fromEntries(Object.entries(SELLING_POINT_HIERARCHY).map(([key, values]) => [key, values.filter(value => value !== "更牛逼")])),
  compositions: COMPOSITION_OPTIONS, colors: COLOR_SCHEME_OPTIONS, styles: STYLE_NAME_OPTIONS, accents: COLOR_TAG_OPTIONS });
const tags = z.object({ tagCategory: allowed(CATEGORY_OPTIONS), tagImageTypeMain: allowed(typeMain),
  tagImageTypeSub: z.string().max(100), tagSellingPointCategory: allowed(sellingMain), tagSellingPointDetail: z.string().max(100),
  tagComposition: allowed(COMPOSITION_OPTIONS), tagColorSchemeV2: allowed(COLOR_SCHEME_OPTIONS), tagDesignStyleV2: allowed(STYLE_NAME_OPTIONS) }).strict();
function hierarchy(value: z.infer<typeof tags>, ctx: z.RefinementCtx) {
  const sub = (IMAGE_TYPE_HIERARCHY as Record<string, readonly string[]>)[value.tagImageTypeMain] ?? [];
  const detail: readonly string[] = IMAGE_TAGGING_OPTIONS.sellingPoints[value.tagSellingPointCategory] ?? [];
  if (value.tagImageTypeSub !== "" && !sub.includes(value.tagImageTypeSub)) ctx.addIssue({ code: "custom", path: ["tagImageTypeSub"], message: "Image subtype does not belong to its parent" });
  if (value.tagSellingPointDetail !== "" && !detail.includes(value.tagSellingPointDetail)) ctx.addIssue({ code: "custom", path: ["tagSellingPointDetail"], message: "Selling point does not belong to its parent" });
}
export const ImageTaggingTagsSchema = tags.superRefine(hierarchy);
export type ImageTaggingTags = z.infer<typeof ImageTaggingTagsSchema>;
export const ImageTaggingCandidateSchema = tags.extend({ accentColor: allowed(COLOR_TAG_OPTIONS), evidence: text(1000) }).strict().superRefine(hierarchy);
export type ImageTaggingCandidate = z.infer<typeof ImageTaggingCandidateSchema>;
/** Existing manual/legacy labels remain intact, including intentional empty strings. */
export const ImageTaggingExistingTagsSchema = z.object(Object.fromEntries(IMAGE_TAGGING_TAG_FIELDS.map(key => [key, z.string().max(255).nullable()])) as Record<typeof IMAGE_TAGGING_TAG_FIELDS[number], z.ZodNullable<z.ZodString>>).strict();
export type ImageTaggingExistingTags = z.infer<typeof ImageTaggingExistingTagsSchema>;
export const ImageTaggingIdentitySchema = z.object({ userId: id, workspaceId: id }).strict();
export const ImageTaggingScopeSchema = z.object({ expectedWorkspaceId: id, imageSetId: id }).strict();
export const ImageTaggingModeSchema = z.enum(["missing", "all_unconfirmed"]);
export const ImageTaggingPreviewInputSchema = ImageTaggingScopeSchema.extend({ operationId: uuid, mode: ImageTaggingModeSchema }).strict();
export const ImageTaggingSubmitInputSchema = ImageTaggingPreviewInputSchema.extend({ expectedSourceHash: hash, expectedRuntimeHash: hash,
  maxCostCents: z.number().int().min(0).max(1000000000000), chargeConfirmed: z.literal(true) }).strict();
export const ImageTaggingOperationInputSchema = ImageTaggingScopeSchema.extend({ operationId: uuid }).strict();
export const ImageTaggingApplyOperationInputSchema = ImageTaggingOperationInputSchema.extend({ runOperationId: uuid }).strict();
export const ImageTaggingApplyDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ imageId: id, candidateHash: hash, decision: z.literal("accept"), tags: ImageTaggingTagsSchema }).strict(),
  z.object({ imageId: id, candidateHash: hash, decision: z.literal("exclude"), tags: z.null() }).strict(),
]);
export const ImageTaggingApplyInputSchema = ImageTaggingApplyOperationInputSchema.extend({ expectedSourceHash: hash, expectedResultHash: hash,
  decisions: z.array(ImageTaggingApplyDecisionSchema).min(1).max(IMAGE_TAGGING_LIMITS.images)
    .refine(value => new Set(value.map(item => item.imageId)).size === value.length) }).strict();
export type ImageTaggingPreviewInput = z.infer<typeof ImageTaggingPreviewInputSchema>;
export type ImageTaggingSubmitInput = z.infer<typeof ImageTaggingSubmitInputSchema>;
export type ImageTaggingOperationInput = z.infer<typeof ImageTaggingOperationInputSchema>;
export type ImageTaggingApplyInput = z.infer<typeof ImageTaggingApplyInputSchema>;
export type ImageTaggingApplyOperationInput = z.infer<typeof ImageTaggingApplyOperationInputSchema>;
export const ImageTaggingSourceImageSchema = z.object({ id, imageSetId: id, imageUrl: text(8192), imagePosition: text(64),
  positionIndex: z.number().int().min(0).max(2147483647).nullable(), revisionHash: hash, originalContentHash: hash.nullable(),
  tagsConfirmed: z.boolean(), analysisConfirmed: z.boolean(), tags: ImageTaggingExistingTagsSchema }).strict();
const sourceBody = z.object({ version: z.literal(1), identity: ImageTaggingIdentitySchema, imageSetId: id,
  set: z.object({ id, userId: id, workspaceId: id, asin: text(20), title: z.string().max(4000).nullable(), status: text(64), visibility: text(64),
    originInstanceId: text(255).nullable(), remoteId: id.nullable(), syncVersion: z.number().int().min(0).nullable(), revisionHash: hash }).strict(),
  images: z.array(ImageTaggingSourceImageSchema).min(1).max(IMAGE_TAGGING_LIMITS.images) }).strict();
export const ImageTaggingSourceSchema = sourceBody.extend({ sourceHash: hash }).strict().superRefine((value, ctx) => {
  const { sourceHash, ...body } = value;
  try {
    if (sourceHash !== imageTaggingHash(body) || value.set.id !== value.imageSetId || value.set.userId !== value.identity.userId
      || value.set.workspaceId !== value.identity.workspaceId || value.images.some(image => image.imageSetId !== value.imageSetId)
      || new Set(value.images.map(image => image.id)).size !== value.images.length) ctx.addIssue({ code: "custom", message: "Source binding mismatch" });
  } catch { ctx.addIssue({ code: "custom", message: "Source metadata unavailable" }); }
});
export type ImageTaggingSource = z.infer<typeof ImageTaggingSourceSchema>;
export type ImageTaggingSourceImage = z.infer<typeof ImageTaggingSourceImageSchema>;
export function imageTaggingEligibility(image: Pick<ImageTaggingSourceImage, "tagsConfirmed" | "analysisConfirmed" | "tags">, mode: z.infer<typeof ImageTaggingModeSchema>) {
  if (image.tagsConfirmed || image.analysisConfirmed) return "skipped_confirmed" as const;
  if (mode === "missing" && image.tags.tagCategory !== null && image.tags.tagImageTypeMain !== null && image.tags.tagDesignStyleV2 !== null) return "skipped_complete" as const;
  return "pending" as const;
}
const configuration = z.object({ revision: id, hash }).strict();
const budget = z.object({ currency: z.literal("USD"), maxCalls: z.number().int().min(0).max(IMAGE_TAGGING_LIMITS.images),
  maxCostCentsPerImage: z.number().int().nonnegative(), maxCostCentsTotal: z.number().int().nonnegative(), maxImageBytes: z.literal(8388608),
  note: z.literal("授权费用上限，不是实际账单；已派发但结果未知的图片不会自动重试") }).strict();
export const ImageTaggingPreviewSchema = z.object({ identity: ImageTaggingIdentitySchema, scope: ImageTaggingPreviewInputSchema,
  sourceHash: hash, title: z.string().max(4000).nullable(), configuration: configuration.nullable(), runtimeHash: hash.nullable(),
  skillSlug: text(128).nullable(), modelSlug: text(128).nullable(), budget: budget.nullable(),
  capability: z.object({ available: z.boolean(), reasonCode: text(160).nullable() }).strict(),
  images: z.array(z.object({ imageId: id, revisionHash: hash, previewUrl: z.string().url().max(8192).nullable(),
    imagePosition: text(64), positionIndex: z.number().int().nonnegative().nullable(), tags: ImageTaggingExistingTagsSchema,
    eligibility: z.enum(["pending", "skipped_confirmed", "skipped_complete"]) }).strict()).min(1).max(IMAGE_TAGGING_LIMITS.images),
}).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.scope.expectedWorkspaceId || new Set(value.images.map(image => image.imageId)).size !== value.images.length
    || value.capability.available !== (value.capability.reasonCode === null)
    || value.capability.available && (!value.configuration || !value.runtimeHash || !value.skillSlug || !value.modelSlug || !value.budget)) ctx.addIssue({ code: "custom", message: "Preview scope/capability mismatch" });
});
export type ImageTaggingPreview = z.infer<typeof ImageTaggingPreviewSchema>;
export const ImageTaggingImageStateSchema = z.enum(["pending", "dispatched", "succeeded", "failed", "skipped_confirmed", "skipped_complete", "canceled", "outcome_unknown", "applied", "excluded"]);
export const ImageTaggingJobViewSchema = z.object({ identity: ImageTaggingIdentitySchema, scope: ImageTaggingOperationInputSchema,
  runId: text(80).nullable(), state: z.enum(["not_found", "queued", "running", "succeeded", "partial", "failed", "canceled", "outcome_unknown"]),
  sourceHash: hash.nullable(), currentSourceHash: hash.nullable(), sourceChanged: z.boolean(), runtimeHash: hash.nullable(), resultHash: hash.nullable(),
  configuration: configuration.nullable(), maxCostCents: z.number().int().nonnegative().nullable(), reasonCode: text(160).nullable(),
  images: z.array(z.object({ imageId: id, state: ImageTaggingImageStateSchema, candidate: ImageTaggingCandidateSchema.nullable(),
    candidateHash: hash.nullable(), reasonCode: text(160).nullable(), afterImageRevision: hash.nullable() }).strict()).max(IMAGE_TAGGING_LIMITS.images),
}).strict().superRefine((value, ctx) => {
  if (value.identity.workspaceId !== value.scope.expectedWorkspaceId || new Set(value.images.map(image => image.imageId)).size !== value.images.length
    || value.images.some(image => (image.candidate === null) !== (image.candidateHash === null))
    || value.state === "not_found" && (value.runId !== null || value.images.length)) ctx.addIssue({ code: "custom", message: "Job view scope mismatch" });
});
export type ImageTaggingJobView = z.infer<typeof ImageTaggingJobViewSchema>;
export const ImageTaggingApplyReceiptSchema = z.object({ identity: ImageTaggingIdentitySchema, scope: ImageTaggingApplyOperationInputSchema,
  status: z.enum(["committed", "cancelled", "outcome_unknown", "not_found"]), requestHash: hash.nullable(), afterSourceHash: hash.nullable(),
  appliedCount: z.number().int().min(0).max(IMAGE_TAGGING_LIMITS.images).nullable(), excludedCount: z.number().int().min(0).max(IMAGE_TAGGING_LIMITS.images).nullable(),
  reasonCode: text(160).nullable() }).strict().refine(value => value.identity.workspaceId === value.scope.expectedWorkspaceId
    && (value.status !== "committed" || value.requestHash !== null && value.afterSourceHash !== null && value.appliedCount !== null && value.excludedCount !== null));
export type ImageTaggingApplyReceipt = z.infer<typeof ImageTaggingApplyReceiptSchema>;
export const ImageTaggingHistoryInputSchema = ImageTaggingScopeSchema;
export const ImageTaggingHistorySchema = z.object({ identity: ImageTaggingIdentitySchema, scope: ImageTaggingScopeSchema,
  complete: z.boolean(), operations: z.array(z.object({ operationId: uuid, runId: text(80), state: text(64), sourceHash: hash, createdAt: text(64) }).strict()).max(100) }).strict();
