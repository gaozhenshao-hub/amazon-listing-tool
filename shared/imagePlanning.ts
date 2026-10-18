import { z } from "zod";
import SHA256 from "crypto-js/sha256.js";
import { canonicalCompetitorResearchEvidence } from "./competitorResearchEvidence";
import { normalizeImageOutline } from "./imageWorkflow";

export const IMAGE_PLANNING_LIMITS = Object.freeze({ sourceBytes: 2 * 1024 * 1024, resultBytes: 65535, sourceRows: 100, history: 50 });
export const ImagePlanningIdSchema = z.number().int().min(1).max(2147483647);
export const ImagePlanningHashSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const ImagePlanningUuidSchema = z.string().uuid().refine(value => value === value.toLowerCase());
const id = ImagePlanningIdSchema, hash = ImagePlanningHashSchema, uuid = ImagePlanningUuidSchema;
export function imagePlanningCanonical(value: unknown): string {
  const result = canonicalCompetitorResearchEvidence(value);
  if (new TextEncoder().encode(result).byteLength > IMAGE_PLANNING_LIMITS.sourceBytes) throw new Error("IMAGE_PLANNING_METADATA_LIMIT");
  return result;
}
export const imagePlanningHash = (value: unknown) => SHA256(imagePlanningCanonical(value)).toString();
export const ImagePlanningIdentitySchema = z.object({ userId: id, workspaceId: id }).strict();
export const ImagePlanningScopeSchema = z.object({ expectedWorkspaceId: id, projectId: id, sessionId: id }).strict();
export const ImagePlanningOperationInputSchema = ImagePlanningScopeSchema.extend({ operationId: uuid }).strict();
export const ImagePlanningPreviewInputSchema = ImagePlanningOperationInputSchema;
export const ImagePlanningStartInputSchema = ImagePlanningOperationInputSchema.extend({ expectedSourceHash: hash,
  expectedRuntimeHash: hash, maxCostCents: z.number().int().min(0).max(1000000000), chargeConfirmed: z.literal(true) }).strict();
export const ImagePlanningApplyOperationInputSchema = ImagePlanningOperationInputSchema.extend({ runOperationId: uuid }).strict();
export const ImagePlanningApplyInputSchema = ImagePlanningApplyOperationInputSchema.extend({ expectedSourceHash: hash,
  expectedResultHash: hash, replaceDraftConfirmed: z.literal(true) }).strict().refine(value => value.operationId !== value.runOperationId);
export const ImagePlanningHistoryInputSchema = ImagePlanningScopeSchema;
export type ImagePlanningIdentity = z.infer<typeof ImagePlanningIdentitySchema>;
export type ImagePlanningScope = z.infer<typeof ImagePlanningScopeSchema>;
export type ImagePlanningOperationInput = z.infer<typeof ImagePlanningOperationInputSchema>;
export type ImagePlanningStartInput = z.infer<typeof ImagePlanningStartInputSchema>;
export type ImagePlanningApplyInput = z.infer<typeof ImagePlanningApplyInputSchema>;
export type ImagePlanningApplyOperationInput = z.infer<typeof ImagePlanningApplyOperationInputSchema>;

const jsonObject = z.record(z.string(), z.unknown());
const substantive = jsonObject.refine(value => typeof value.purpose === "string" && value.purpose.trim().length > 0
  && typeof value.contentBrief === "string" && value.contentBrief.trim().length > 0, "Purpose and complete brief are required");
/** Preserve the complete existing outline, not a new summary-only schema.
 * Reject incomplete model slots before the existing normalizer can invent them. */
export const ImagePlanningOutlineSchema = z.object({ mainImage: substantive,
  secondaryImages: z.array(substantive).length(6), aPlusModules: z.array(substantive).length(7),
  brandStory: jsonObject.refine(value => typeof value.theme === "string" && value.theme.trim().length > 0
    && typeof value.contentBrief === "string" && value.contentBrief.trim().length > 0),
}).catchall(z.unknown()).superRefine((value, ctx) => {
  try {
    if (new TextEncoder().encode(imagePlanningCanonical(value)).byteLength > IMAGE_PLANNING_LIMITS.resultBytes
      || value.secondaryImages.some((item, index) => item.imageNumber !== index + 2)
      || value.aPlusModules.some((item, index) => item.moduleNumber !== index + 1)) ctx.addIssue({ code: "custom", message: "Complete outline or storage bound invalid" });
  } catch { ctx.addIssue({ code: "custom", message: "Outline is not bounded JSON" }); }
});
export type ImagePlanningOutline = z.infer<typeof ImagePlanningOutlineSchema>;
export function normalizeImagePlanningOutline(value: unknown): ImagePlanningOutline {
  const parsed = ImagePlanningOutlineSchema.parse(value);
  return ImagePlanningOutlineSchema.parse(normalizeImageOutline(parsed, { forceDefaultAplus: true, recoverMissingSecondaryContent: false }));
}
const sourceBody = z.object({ version: z.literal(1), identity: ImagePlanningIdentitySchema, scope: ImagePlanningScopeSchema,
  sourceRevision: hash, scopeRevision: z.number().int().positive(),
  project: jsonObject, session: jsonObject,
  confirmedSteps: z.array(z.object({ step: z.number().int().min(0).max(1), version: id, snapshotHash: hash, content: jsonObject }).strict()).length(2),
  files: z.array(jsonObject).max(100), competitors: z.array(jsonObject).max(100),
  comparisons: z.array(jsonObject).max(100), keywordAnalyses: z.array(jsonObject).max(100),
  otherSources: z.array(jsonObject).max(100),
  coverage: z.literal("complete_saved_project_inputs_not_exhaustive_market"),
}).strict();
export const ImagePlanningSourceSchema = sourceBody.extend({ sourceHash: hash }).strict().superRefine((value, ctx) => {
  try {
    const { sourceHash, ...body } = value;
    if (sourceHash !== imagePlanningHash(body) || value.identity.workspaceId !== value.scope.expectedWorkspaceId
      || value.project.id !== value.scope.projectId || value.session.id !== value.scope.sessionId
      || value.session.projectId !== value.scope.projectId || value.project.workspaceId !== value.identity.workspaceId
      || value.session.step0Confirmed !== 1 || value.session.step1Confirmed !== 1 || value.session.step2Confirmed !== 0 || !value.confirmedSteps.some(step => step.step === 1)
      || new Set(value.confirmedSteps.map(step => step.step)).size !== value.confirmedSteps.length) ctx.addIssue({ code: "custom", message: "Source binding invalid" });
  } catch { ctx.addIssue({ code: "custom", message: "Source incomplete or oversized" }); }
});
export type ImagePlanningSource = z.infer<typeof ImagePlanningSourceSchema>;
const config = z.object({ revision: id, hash }).strict();
const reason = z.string().regex(/^[A-Z][A-Z0-9_]{0,159}$/u).nullable();
export const ImagePlanningPreviewSchema = z.object({ identity: ImagePlanningIdentitySchema, scope: ImagePlanningPreviewInputSchema,
  sourceHash: hash, sourceRevision: hash, scopeRevision: z.number().int().nonnegative(),
  title: z.string(), coverage: z.literal("complete_saved_project_inputs_not_exhaustive_market"),
  counts: z.object({ confirmedSteps: z.number().int().min(1).max(2), files: z.number().int().nonnegative(),
    competitors: z.number().int().nonnegative(), comparisons: z.number().int().nonnegative(), keywordAnalyses: z.number().int().nonnegative() }).strict(),
  configuration: config.nullable(), runtimeHash: hash.nullable(), skillSlug: z.string().nullable(), modelSlug: z.string().nullable(),
  maxCostCents: z.number().int().nonnegative().nullable(), maxCalls: z.literal(1),
  capability: z.object({ available: z.boolean(), reasonCode: reason }).strict(),
}).strict().refine(value => value.identity.workspaceId === value.scope.expectedWorkspaceId
  && value.capability.available === (value.capability.reasonCode === null)
  && (!value.capability.available || value.configuration !== null && value.runtimeHash !== null && value.maxCostCents !== null && value.skillSlug !== null && value.modelSlug !== null));
export type ImagePlanningPreview = z.infer<typeof ImagePlanningPreviewSchema>;
export const ImagePlanningStateSchema = z.enum(["not_found", "queued", "running", "dispatched", "succeeded", "failed", "canceled", "outcome_unknown"]);
export const ImagePlanningJobViewSchema = z.object({ identity: ImagePlanningIdentitySchema, scope: ImagePlanningOperationInputSchema,
  runId: z.string().max(80).nullable(), state: ImagePlanningStateSchema,
  sourceHash: hash.nullable(), currentSourceHash: hash.nullable(), sourceChanged: z.boolean(), runtimeHash: hash.nullable(),
  resultHash: hash.nullable(), candidate: ImagePlanningOutlineSchema.nullable(), configuration: config.nullable(),
  maxCostCents: z.number().int().nonnegative().nullable(), reasonCode: reason,
}).strict().refine(value => value.identity.workspaceId === value.scope.expectedWorkspaceId
  && (value.candidate === null) === (value.resultHash === null)
  && (value.state === "succeeded") === (value.candidate !== null)
  && (value.state !== "not_found" || value.runId === null && value.candidate === null));
export type ImagePlanningJobView = z.infer<typeof ImagePlanningJobViewSchema>;
export const ImagePlanningApplyReceiptSchema = z.object({ identity: ImagePlanningIdentitySchema, scope: ImagePlanningApplyOperationInputSchema,
  status: z.enum(["committed", "cancelled", "not_found"]), requestHash: hash.nullable(), afterSourceHash: hash.nullable(),
  resultHash: hash.nullable(), reasonCode: reason,
}).strict().refine(value => value.identity.workspaceId === value.scope.expectedWorkspaceId
  && (value.status === "committed" ? value.requestHash !== null && value.afterSourceHash !== null && value.resultHash !== null
    : value.requestHash === null && value.afterSourceHash === null && value.resultHash === null));
export type ImagePlanningApplyReceipt = z.infer<typeof ImagePlanningApplyReceiptSchema>;
export const ImagePlanningHistorySchema = z.object({ identity: ImagePlanningIdentitySchema, scope: ImagePlanningScopeSchema,
  complete: z.boolean(), operations: z.array(z.object({ operationId: uuid, state: ImagePlanningStateSchema,
    createdAt: z.string(), sourceHash: hash }).strict()).max(50) }).strict();
