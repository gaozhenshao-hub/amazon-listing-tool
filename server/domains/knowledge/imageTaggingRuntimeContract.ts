import { z } from "zod";
import { AssistantConfigurationSchema } from "../../../shared/assistantConfigurations";
import { AssistantConversationSkillPinSchema, assistantConversationSkillScopeMatches, assistantConversationSkillSnapshotHash,
  configurationHash } from "../ai_os/services/assistantConversationSourcePrimitives";
import { StrictRegisteredModelSnapshotSchema, strictRuntimeCanonical, strictRuntimeHash } from "../ai_os/services/strictSkillRuntime";

/** Server-only contracts. Registry/configuration membership alone is not source approval. */
const id = z.number().int().min(1).max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
export const IMAGE_TAGGING_RUNTIME_LIMITS = Object.freeze({ imageBytes: 8 * 1024 * 1024, snapshotBytes: 128 * 1024 });
export const imageTaggingRuntimeHash = strictRuntimeHash;
export const ImageTaggingIdentitySchema = z.object({ workspaceId: id, userId: id }).strict();
export const ImageTaggingOperationIdSchema = z.string().uuid().refine(value => value === value.toLowerCase());
export const ImageTaggingSavedConfigurationSchema = z.object({ workspaceId: id, agentKey: z.literal("tagger"), revision: id,
  hash, config: AssistantConfigurationSchema }).strict().superRefine((value, ctx) => {
  if (value.hash !== configurationHash(value.config)) ctx.addIssue({ code: "custom", message: "Configuration hash mismatch" });
});
export type ImageTaggingSavedConfiguration = z.infer<typeof ImageTaggingSavedConfigurationSchema>;
export const ImageTaggingEvidenceSchema = z.object({ imageSetId: id, imageId: id, imageRevision: hash,
  sourceUrlRef: text(8192), contentHash: hash, byteSize: z.number().int().min(1).max(IMAGE_TAGGING_RUNTIME_LIMITS.imageBytes),
  contentType: z.enum(["image/png", "image/jpeg", "image/webp", "image/gif"]) }).strict();
export type ImageTaggingEvidence = z.infer<typeof ImageTaggingEvidenceSchema>;
export const ImageTaggingImageBudgetSchema = z.object({ policyId: text(256), maxInputTokensPerImage: z.number().int().min(1).max(10000000),
  stage: z.literal("image_tagging"), maxImageBytes: z.literal(8388608), maxImages: z.literal(1) }).strict();
export const ImageTaggingSourceApprovalSchema = z.object({ version: z.literal(1), workspaceId: id, agentKey: z.literal("tagger"),
  stage: z.literal("image_tagging"), skillSlug: text(128), skillSnapshotHash: hash, modelSlug: text(128), modelConfigurationHash: hash,
  source: z.object({ origin: z.literal("qingdao"), revision: text(256), approvalRef: text(512), evidenceId: text(256), evidenceHash: hash }).strict(),
  inputContract: z.literal("image_tagging_evidence_v1"), outputContract: z.literal("image_tagging_labels_v1"),
  maxCostCents: z.number().int().min(0).max(1000000000), imageBudget: ImageTaggingImageBudgetSchema }).strict();
export type ImageTaggingSourceApproval = z.infer<typeof ImageTaggingSourceApprovalSchema>;
const snapshotBody = z.object({ schema: z.literal("image-tagging-runtime/v1"), identity: ImageTaggingIdentitySchema,
  operationId: ImageTaggingOperationIdSchema, stage: z.literal("image_tagging"), sourceHash: hash,
  imageCount: z.number().int().min(1).max(1000),
  budgetPlan: z.object({ maxImageBytes: z.literal(8388608), maxContextAdmissionUnits: z.number().int().positive(),
    outputTokens: z.number().int().positive(), maxCostCentsPerImage: z.number().int().min(0).max(1000000000),
    maxCostCentsTotal: z.number().int().min(0).max(1000000000000) }).strict(),
  configuration: z.object({ agentKey: z.literal("tagger"), revision: id, hash }).strict(),
  approval: ImageTaggingSourceApprovalSchema, approvalHash: hash, skill: AssistantConversationSkillPinSchema,
  model: StrictRegisteredModelSnapshotSchema }).strict();
export const ImageTaggingRuntimeSnapshotSchema = snapshotBody.extend({ snapshotHash: hash }).strict().superRefine((value, ctx) => {
  try {
    const { snapshotHash, ...body } = value;
    if (Buffer.byteLength(strictRuntimeCanonical(value)) > IMAGE_TAGGING_RUNTIME_LIMITS.snapshotBytes
      || snapshotHash !== imageTaggingRuntimeHash(body) || value.approvalHash !== imageTaggingRuntimeHash(value.approval)
      || value.approval.workspaceId !== value.identity.workspaceId || value.model.workspaceId !== value.identity.workspaceId
      || value.approval.skillSnapshotHash !== assistantConversationSkillSnapshotHash(value.skill)
      || !assistantConversationSkillScopeMatches(value.skill, value.identity.workspaceId, value.approval.skillSlug)
      || value.approval.modelSlug !== value.model.model.slug || value.approval.modelConfigurationHash !== value.model.configurationHash
      || value.budgetPlan.maxCostCentsPerImage !== value.approval.maxCostCents
      || value.budgetPlan.maxCostCentsTotal !== value.imageCount * value.approval.maxCostCents
      || value.budgetPlan.outputTokens !== value.skill.maxTokens
      || value.budgetPlan.maxContextAdmissionUnits + value.skill.maxTokens > value.model.model.maxContextTokens
      || !value.model.model.capabilityTags.includes("vision")) ctx.addIssue({ code: "custom", message: "Runtime binding mismatch" });
  } catch { ctx.addIssue({ code: "custom", message: "Runtime snapshot invalid" }); }
});
export type ImageTaggingRuntimeSnapshot = z.infer<typeof ImageTaggingRuntimeSnapshotSchema>;
export const ImageTaggingDispatchBudgetSchema = z.object({ textBytes: z.number().int().nonnegative(), imageCount: z.literal(1),
  imageBytes: z.number().int().min(1).max(IMAGE_TAGGING_RUNTIME_LIMITS.imageBytes), contextAdmissionUnits: z.number().int().positive(),
  outputTokens: z.number().int().positive(), contextLimit: z.number().int().positive(), tokenEstimateIsExact: z.literal(false) }).strict();
export const ImageTaggingDispatchReceiptSchema = z.object({ runId: text(128), stage: z.literal("image_tagging"), requestHash: hash,
  modelConfigurationHash: hash, bindingHash: hash, budget: ImageTaggingDispatchBudgetSchema }).strict();
export type ImageTaggingDispatchReceipt = z.infer<typeof ImageTaggingDispatchReceiptSchema>;
