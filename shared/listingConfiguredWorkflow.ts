import { z } from "zod";
import sha256 from "crypto-js/sha256.js";
import { canonicalCompetitorResearchEvidence } from "./competitorResearchEvidence";

export const LISTING_CONFIGURED_KIND = "listing.generation.configured.v1";
export const listingConfiguredCanonical = canonicalCompetitorResearchEvidence;
export const listingConfiguredHash = (value: unknown) => sha256(listingConfiguredCanonical(value)).toString();
export const ListingConfiguredIdSchema = z.number().int().min(1).max(2147483647);
export const ListingConfiguredHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const ListingConfiguredUuidSchema = z.string().uuid().refine(value => value === value.toLowerCase());
export const LISTING_CONFIGURED_DEFINITIONS = {
  sellingPoints: { stage: "listing_selling_points", slug: "listing.sellingpoints.generate", node: "G1" },
  singleBullet: { stage: "listing_single_bullet", slug: "listing.bullet.step.generate", node: "G1" },
  bullets: { stage: "listing_bullets", slug: "listing.bullets.generate", node: "G1" },
  title: { stage: "listing_title", slug: "listing.title.generate", node: "G2" },
  description: { stage: "listing_description", slug: "listing.description.generate", node: "G3" },
  searchTerms: { stage: "listing_search_terms", slug: "listing.searchterms.generate", node: "G4" },
  qa: { stage: "listing_qa", slug: "listing.qa.generate", node: "G5" },
} as const;
export const ListingConfiguredOperationSchema = z.enum(["sellingPoints", "singleBullet", "bullets", "title", "description", "searchTerms", "qa", "batch"]);
export type ListingConfiguredOperation = z.infer<typeof ListingConfiguredOperationSchema>;
export type ListingConfiguredStageOperation = Exclude<ListingConfiguredOperation, "batch">;
export const listingConfiguredOperations = (operation: ListingConfiguredOperation): ListingConfiguredStageOperation[] => operation === "batch"
  ? ["sellingPoints", "bullets", "title", "description", "searchTerms", "qa"] : [operation];
export const ListingConfiguredIdentitySchema = z.object({ userId: ListingConfiguredIdSchema, workspaceId: ListingConfiguredIdSchema }).strict();
export const ListingConfiguredScopeSchema = z.object({ expectedWorkspaceId: ListingConfiguredIdSchema, projectId: ListingConfiguredIdSchema }).strict();
export const ListingConfiguredOperationInputSchema = ListingConfiguredScopeSchema.extend({ operationId: ListingConfiguredUuidSchema }).strict();
const ids = z.array(ListingConfiguredIdSchema).max(1000).refine(value => new Set(value).size === value.length);
export const ListingConfiguredPreviewInputSchema = ListingConfiguredOperationInputSchema.extend({ operation: ListingConfiguredOperationSchema,
  analysisIds: ids, coreRevisionIds: ids.max(10), emphasis: z.string().max(4000).nullable() }).strict();
export const ListingConfiguredStartInputSchema = ListingConfiguredPreviewInputSchema.extend({ expectedSourceHash: ListingConfiguredHashSchema,
  expectedRuntimeHash: ListingConfiguredHashSchema, maxCostCents: z.number().int().min(0).max(1000000000), chargeConfirmed: z.literal(true) }).strict();
const json = z.record(z.string(), z.unknown()).superRefine((value, ctx) => { try {
  if (new TextEncoder().encode(listingConfiguredCanonical(value)).byteLength > 1024 * 1024) ctx.addIssue({ code: "custom", message: "Candidate too large" });
} catch { ctx.addIssue({ code: "custom", message: "Invalid JSON" }); } });
export const ListingConfiguredCandidateSchema = z.object({ version: z.literal(1), operation: ListingConfiguredOperationSchema,
  outputs: z.record(z.string(), json), requiresHumanReview: z.literal(true), sourceHash: ListingConfiguredHashSchema }).strict().superRefine((value, ctx) => {
  const expected = listingConfiguredOperations(value.operation);
  if (Object.keys(value.outputs).length !== expected.length || expected.some(key => !Object.hasOwn(value.outputs, key))) ctx.addIssue({ code: "custom", message: "Incomplete operation outputs" });
});
export const ListingConfiguredPreviewResultSchema = z.object({ identity: ListingConfiguredIdentitySchema, request: ListingConfiguredPreviewInputSchema,
  available: z.boolean(), reasonCode: z.string().nullable(), sourceHash: ListingConfiguredHashSchema, draftHash: ListingConfiguredHashSchema,
  runtimeHash: ListingConfiguredHashSchema.nullable(), configuration: z.object({ revision: z.number().int().positive(), hash: ListingConfiguredHashSchema }).strict().nullable(),
  maxCalls: z.number().int().min(1).max(42), maxCostCents: z.number().int().min(0).max(1000000000).nullable(),
  executionPolicy: z.literal("frozen_routes_known_response_repair_unknown_never_retry"), existingConfirmedCoreIds: ids.max(10),
  stages: z.array(z.object({ operation: ListingConfiguredOperationSchema, skillSlug: z.string(), skillVersion: z.number().int().positive(), skillHash: ListingConfiguredHashSchema,
    models: z.array(z.object({ slug: z.string(), configurationHash: ListingConfiguredHashSchema, maxCostCents: z.number().int().min(0) }).strict()).min(1).max(2), maxQualityRepairs: z.number().int().min(0).max(2) }).strict()).max(7),
  directionCandidatesAreNotConfirmedCores: z.literal(true) }).strict();
export const ListingConfiguredStateSchema = z.enum(["not_found", "queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown"]);
export const ListingConfiguredViewSchema = z.object({ identity: ListingConfiguredIdentitySchema, scope: ListingConfiguredOperationInputSchema,
  state: ListingConfiguredStateSchema, runId: z.string().max(80).nullable(), operation: ListingConfiguredOperationSchema.nullable(), sourceHash: ListingConfiguredHashSchema.nullable(),
  resultHash: ListingConfiguredHashSchema.nullable(), candidate: ListingConfiguredCandidateSchema.nullable(), sourceCurrent: z.boolean(), currentDraftHash: ListingConfiguredHashSchema.nullable(),
  completedStages: z.number().int().min(0).max(6), configuration: z.object({ revision: z.number().int().positive(), hash: ListingConfiguredHashSchema }).strict().nullable(), errorCode: z.string().nullable() }).strict();
export const ListingConfiguredApplyOperationInputSchema = ListingConfiguredOperationInputSchema.extend({ applyOperationId: ListingConfiguredUuidSchema }).strict();
export const ListingConfiguredApplyInputSchema = ListingConfiguredApplyOperationInputSchema.extend({ expectedSourceHash: ListingConfiguredHashSchema,
  expectedResultHash: ListingConfiguredHashSchema, expectedDraftHash: ListingConfiguredHashSchema, titleIndex: z.number().int().min(0).max(99).nullable(), confirmHumanReview: z.literal(true) }).strict();
export const ListingConfiguredApplyReceiptSchema = z.object({ identity: ListingConfiguredIdentitySchema, scope: ListingConfiguredApplyOperationInputSchema,
  status: z.enum(["committed", "cancelled", "not_found"]), requestHash: ListingConfiguredHashSchema.nullable(), resultHash: ListingConfiguredHashSchema.nullable(),
  afterHash: ListingConfiguredHashSchema.nullable(), listingId: ListingConfiguredIdSchema.nullable(), candidateIds: ids.max(10), reasonCode: z.string().nullable() }).strict();
export const ListingConfiguredHistoryInputSchema = ListingConfiguredScopeSchema.extend({ beforeId: ListingConfiguredIdSchema.nullable(), limit: z.number().int().min(1).max(20) }).strict();
export const ListingConfiguredHistoryResultSchema = z.object({ identity: ListingConfiguredIdentitySchema, scope: ListingConfiguredHistoryInputSchema,
  items: z.array(z.object({ id: ListingConfiguredIdSchema, operationId: ListingConfiguredUuidSchema, operation: ListingConfiguredOperationSchema,
    state: ListingConfiguredStateSchema, sourceHash: ListingConfiguredHashSchema, createdAt: z.string() }).strict()).max(20), nextBeforeId: ListingConfiguredIdSchema.nullable() }).strict();
export type ListingConfiguredIdentity = z.infer<typeof ListingConfiguredIdentitySchema>;
export type ListingConfiguredScope = z.infer<typeof ListingConfiguredScopeSchema>;
export type ListingConfiguredOperationInput = z.infer<typeof ListingConfiguredOperationInputSchema>;
export type ListingConfiguredPreviewInput = z.infer<typeof ListingConfiguredPreviewInputSchema>;
export type ListingConfiguredStartInput = z.infer<typeof ListingConfiguredStartInputSchema>;
export type ListingConfiguredPreviewResult = z.infer<typeof ListingConfiguredPreviewResultSchema>;
export type ListingConfiguredView = z.infer<typeof ListingConfiguredViewSchema>;
export type ListingConfiguredCandidate = z.infer<typeof ListingConfiguredCandidateSchema>;
export type ListingConfiguredApplyInput = z.infer<typeof ListingConfiguredApplyInputSchema>;
export type ListingConfiguredApplyOperationInput = z.infer<typeof ListingConfiguredApplyOperationInputSchema>;
export type ListingConfiguredApplyReceipt = z.infer<typeof ListingConfiguredApplyReceiptSchema>;
export type ListingConfiguredHistoryResult = z.infer<typeof ListingConfiguredHistoryResultSchema>;
