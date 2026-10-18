import { z } from "zod";
import { listingConfiguredCanonical, listingConfiguredHash, ListingConfiguredIdentitySchema, ListingConfiguredIdSchema, ListingConfiguredHashSchema, ListingConfiguredUuidSchema } from "./listingConfiguredWorkflow";
export const LISTING_AUXILIARY_KIND = "listing.auxiliary.configured.v1";
export const listingAuxiliaryCanonical = listingConfiguredCanonical;
export const listingAuxiliaryHash = listingConfiguredHash;
export const ListingAuxiliaryIdentitySchema = ListingConfiguredIdentitySchema;
export type ListingAuxiliaryIdentity = z.infer<typeof ListingAuxiliaryIdentitySchema>;
const id = ListingConfiguredIdSchema, hash = ListingConfiguredHashSchema, uuid = ListingConfiguredUuidSchema;
const text = (max: number) => z.string().refine(value => new TextEncoder().encode(value).length <= max, "TEXT_LIMIT");
const ids = z.array(id).max(1000).refine(value => new Set(value).size === value.length);
export const LISTING_AUXILIARY_DEFINITIONS = {
  keywordFabe: { stage: "listing_keyword_fabe", slug: "listing.keyword.fabe.expand", preset: "standard", repairs: 0 },
  optimizeBullet: { stage: "listing_bullet_optimize", slug: "listing.bullet.step.generate", preset: "quality_first", repairs: 2 },
  checkBullet: { stage: "listing_check_bullets", slug: "listing.checklist.bullets", preset: "quality_first", repairs: 0 },
  checkTitle: { stage: "listing_check_title", slug: "listing.checklist.title", preset: "quality_first", repairs: 0 },
  checkDescription: { stage: "listing_check_description", slug: "listing.checklist.description", preset: "quality_first", repairs: 0 },
  checkSearchTerms: { stage: "listing_check_searchterms", slug: "listing.checklist.searchterms", preset: "quality_first", repairs: 0 },
  checkQa: { stage: "listing_check_qa", slug: "listing.checklist.qa", preset: "quality_first", repairs: 0 },
} as const;
export const ListingAuxiliaryOperationSchema = z.enum(["keywordFabe", "optimizeBullet", "checkBullet", "checkTitle", "checkDescription", "checkSearchTerms", "checkQa"]);
export type ListingAuxiliaryOperation = z.infer<typeof ListingAuxiliaryOperationSchema>;
export const ListingAuxiliaryBulletSchema = z.object({ subtitle: text(2000), fullText: text(65535) }).strict();
export const ListingAuxiliaryQaItemSchema = z.object({ question: text(65535), answer: text(65535), category: text(1000).optional(), priority: z.union([z.number().finite(), text(1000)]).optional(), sourceInsight: text(65535).optional() }).strict();
export const ListingAuxiliaryPayloadSchemas = {
  keywordFabe: z.object({ keyword: z.string().trim().min(1).max(200) }).strict(),
  optimizeBullet: z.object({ coreRevisionId: id, coreInputHash: hash, currentBullet: ListingAuxiliaryBulletSchema, previousBullets: z.array(ListingAuxiliaryBulletSchema).max(9), optimizationNote: z.string().trim().min(1).max(4000), sourceCandidateId: id.nullable() }).strict(),
  checkBullet: z.object({ items: z.array(ListingAuxiliaryBulletSchema.extend({ bulletIndex: z.number().int().min(0).max(8), coreRevisionId: id.nullable(), candidateId: id.nullable(), evidenceUsed: z.array(text(2000)).max(20) }).strict()).min(1).max(9).refine(items => new Set(items.map(item => item.bulletIndex)).size === items.length) }).strict(),
  checkTitle: z.object({ title: text(65535), itemHighlights: text(65535) }).strict(),
  checkDescription: z.object({ description: text(65535) }).strict(),
  checkSearchTerms: z.object({ searchTerms: text(65535), title: text(65535), bulletPoints: z.array(ListingAuxiliaryBulletSchema).max(9) }).strict(),
  checkQa: z.object({ items: z.array(ListingAuxiliaryQaItemSchema).min(1).max(100) }).strict(),
} as const;
export const ListingAuxiliaryScopeSchema = z.object({ expectedWorkspaceId: id, projectId: id }).strict();
export const ListingAuxiliaryOperationInputSchema = ListingAuxiliaryScopeSchema.extend({ operationId: uuid }).strict();
const common = { ...ListingAuxiliaryOperationInputSchema.shape, analysisIds: ids };
const variants = [
  z.object({ ...common, operation: z.literal("keywordFabe"), payload: ListingAuxiliaryPayloadSchemas.keywordFabe }).strict(),
  z.object({ ...common, operation: z.literal("optimizeBullet"), payload: ListingAuxiliaryPayloadSchemas.optimizeBullet }).strict(),
  z.object({ ...common, operation: z.literal("checkBullet"), payload: ListingAuxiliaryPayloadSchemas.checkBullet }).strict(),
  z.object({ ...common, operation: z.literal("checkTitle"), payload: ListingAuxiliaryPayloadSchemas.checkTitle }).strict(),
  z.object({ ...common, operation: z.literal("checkDescription"), payload: ListingAuxiliaryPayloadSchemas.checkDescription }).strict(),
  z.object({ ...common, operation: z.literal("checkSearchTerms"), payload: ListingAuxiliaryPayloadSchemas.checkSearchTerms }).strict(),
  z.object({ ...common, operation: z.literal("checkQa"), payload: ListingAuxiliaryPayloadSchemas.checkQa }).strict(),
] as const;
const boundedRequest = (value: unknown, ctx: z.RefinementCtx) => { if (new TextEncoder().encode(listingAuxiliaryCanonical(value)).length > 1048576) ctx.addIssue({ code: "custom", message: "REQUEST_LIMIT" }); };
export const ListingAuxiliaryPreviewInputSchema = z.discriminatedUnion("operation", variants).superRefine(boundedRequest);
const accepted = { expectedSourceHash: hash, expectedRuntimeHash: hash, maxCostCents: z.number().int().min(0).max(1000000000), chargeConfirmed: z.literal(true) };
export const ListingAuxiliaryStartInputSchema = z.discriminatedUnion("operation", [variants[0].extend(accepted), variants[1].extend(accepted), variants[2].extend(accepted), variants[3].extend(accepted), variants[4].extend(accepted), variants[5].extend(accepted), variants[6].extend(accepted)]).superRefine(boundedRequest);
export type ListingAuxiliaryPreviewInput = z.infer<typeof ListingAuxiliaryPreviewInputSchema>;
export type ListingAuxiliaryStartInput = z.infer<typeof ListingAuxiliaryStartInputSchema>;
export type ListingAuxiliaryOperationInput = z.infer<typeof ListingAuxiliaryOperationInputSchema>;
export function listingAuxiliaryPreviewRequest(input: ListingAuxiliaryPreviewInput) { const { expectedWorkspaceId, projectId, operationId, analysisIds, operation, payload } = input; return ListingAuxiliaryPreviewInputSchema.parse({ expectedWorkspaceId, projectId, operationId, analysisIds, operation, payload }); }
export const listingAuxiliaryDraftHash = (input: Pick<ListingAuxiliaryPreviewInput, "operation" | "payload">) => listingAuxiliaryHash({ operation: input.operation, payload: input.payload });
export function listingAuxiliaryTargets(input: ListingAuxiliaryPreviewInput) { return input.operation === "checkBullet" ? input.payload.items.map((item, targetIndex) => ({ targetIndex, targetHash: listingAuxiliaryHash(item), value: item })) : [{ targetIndex: 0, targetHash: listingAuxiliaryHash(input.payload), value: input.payload }]; }
const resultObject = z.record(z.string(), z.unknown()).superRefine((value, ctx) => { try { if (new TextEncoder().encode(listingAuxiliaryCanonical(value)).length > 1048576) ctx.addIssue({ code: "custom", message: "RESULT_LIMIT" }); } catch { ctx.addIssue({ code: "custom", message: "INVALID_JSON" }); } });
export const ListingAuxiliaryCandidateSchema = z.object({ version: z.literal(1), operation: ListingAuxiliaryOperationSchema, sourceHash: hash, draftHash: hash,
  targets: z.array(z.object({ targetIndex: z.number().int().min(0).max(8), targetHash: hash, result: resultObject }).strict()).min(1).max(9), requiresHumanReview: z.literal(true) }).strict().superRefine((value, ctx) => {
  if (value.targets.some((target, i) => target.targetIndex !== i) || value.operation !== "checkBullet" && value.targets.length !== 1) ctx.addIssue({ code: "custom", message: "TARGET_SET_INVALID" });
});
export const ListingAuxiliaryPreviewResultSchema = z.object({ identity: ListingAuxiliaryIdentitySchema, request: ListingAuxiliaryPreviewInputSchema, available: z.boolean(), reasonCode: z.string().nullable(),
  sourceHash: hash, draftHash: hash, runtimeHash: hash.nullable(), configuration: z.object({ revision: id, hash }).strict().nullable(),
  maxCalls: z.number().int().min(1).max(54), maxCostCents: z.number().int().min(0).max(1000000000).nullable(),
  stages: z.array(z.object({ operation: ListingAuxiliaryOperationSchema, targetCount: z.number().int().min(1).max(9), skillSlug: z.string(), skillVersion: id, skillHash: hash,
    models: z.array(z.object({ slug: z.string(), configurationHash: hash, maxCostCents: z.number().int().min(0) }).strict()).min(1).max(2), maxQualityRepairs: z.number().int().min(0).max(2) }).strict()).max(1),
  limitations: z.array(z.string()).max(100), executionPolicy: z.literal("frozen_routes_known_response_repair_unknown_never_retry") }).strict();
export const ListingAuxiliaryStateSchema = z.enum(["not_found", "queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown"]);
export const ListingAuxiliaryViewSchema = z.object({ identity: ListingAuxiliaryIdentitySchema, scope: ListingAuxiliaryOperationInputSchema, state: ListingAuxiliaryStateSchema, runId: z.string().max(80).nullable(), request: ListingAuxiliaryPreviewInputSchema.nullable(),
  sourceHash: hash.nullable(), draftHash: hash.nullable(), resultHash: hash.nullable(), candidate: ListingAuxiliaryCandidateSchema.nullable(), sourceCurrent: z.boolean(), completedTargets: z.number().int().min(0).max(9), errorCode: z.string().nullable() }).strict();
export const ListingAuxiliaryApplyOperationInputSchema = ListingAuxiliaryOperationInputSchema.extend({ applyOperationId: uuid }).strict().refine(value => value.operationId !== value.applyOperationId);
export const ListingAuxiliaryApplyInputSchema = ListingAuxiliaryOperationInputSchema.extend({ applyOperationId: uuid, expectedSourceHash: hash, expectedResultHash: hash, expectedDraftHash: hash, confirmHumanReview: z.literal(true) }).strict().refine(value => value.operationId !== value.applyOperationId);
export const ListingAuxiliaryApplyReceiptSchema = z.object({ identity: ListingAuxiliaryIdentitySchema, scope: ListingAuxiliaryApplyOperationInputSchema, status: z.enum(["committed", "cancelled", "not_found"]), requestHash: hash.nullable(), resultHash: hash.nullable(), draftHash: hash.nullable(),
  reportArtifactId: z.string().max(80).nullable(), candidateIds: z.array(id).max(1), reasonCode: z.string().nullable() }).strict();
export const ListingAuxiliaryHistoryInputSchema = ListingAuxiliaryScopeSchema.extend({ beforeId: id.nullable(), limit: z.number().int().min(1).max(20) }).strict();
export const ListingAuxiliaryHistoryResultSchema = z.object({ identity: ListingAuxiliaryIdentitySchema, scope: ListingAuxiliaryHistoryInputSchema, items: z.array(z.object({ id, operationId: uuid, operation: ListingAuxiliaryOperationSchema, state: ListingAuxiliaryStateSchema, sourceHash: hash, draftHash: hash, createdAt: z.string() }).strict()).max(20), nextBeforeId: id.nullable() }).strict();
export type ListingAuxiliaryPreviewResult = z.infer<typeof ListingAuxiliaryPreviewResultSchema>;
export type ListingAuxiliaryCandidate = z.infer<typeof ListingAuxiliaryCandidateSchema>;
export type ListingAuxiliaryView = z.infer<typeof ListingAuxiliaryViewSchema>;
export type ListingAuxiliaryApplyInput = z.infer<typeof ListingAuxiliaryApplyInputSchema>;
export type ListingAuxiliaryApplyOperationInput = z.infer<typeof ListingAuxiliaryApplyOperationInputSchema>;
export type ListingAuxiliaryApplyReceipt = z.infer<typeof ListingAuxiliaryApplyReceiptSchema>;
export type ListingAuxiliaryHistoryResult = z.infer<typeof ListingAuxiliaryHistoryResultSchema>;
