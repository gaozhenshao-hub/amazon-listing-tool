import { z } from "zod";
import { ListingAuxiliaryIdentitySchema, ListingAuxiliaryOperationSchema, listingAuxiliaryHash, LISTING_AUXILIARY_DEFINITIONS } from "../../../../shared/listingAuxiliaryWorkflow";
import { ListingConfiguredHashSchema as hash, ListingConfiguredUuidSchema as ListingAuxiliaryUuidSchema } from "../../../../shared/listingConfiguredWorkflow";
import { CompetitorDeepConfigurationSchema } from "./competitorDeepRuntimeContract";
import { AssistantConversationSkillPinSchema, assistantConversationSkillSnapshotHash } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { StrictRegisteredModelSnapshotSchema } from "../../ai_os/services/strictSkillRuntime";
import { ConfiguredBusinessDispatchBudgetSchema } from "../../ai_os/services/configuredBusinessRuntimeContract";
export const ListingAuxiliaryConfigurationSchema = CompetitorDeepConfigurationSchema;
export type ListingAuxiliaryConfiguration = z.infer<typeof ListingAuxiliaryConfigurationSchema>;
export const ListingAuxiliaryStageOperationSchema = ListingAuxiliaryOperationSchema;
const route = z.object({ slug: z.string().min(1).max(128), configurationHash: hash, maxCostCents: z.number().int().min(0).max(1000000000) }).strict();
export const ListingAuxiliaryApprovalSchema = z.object({ version: z.literal(1), workspaceId: z.number().int().positive(), operation: ListingAuxiliaryStageOperationSchema,
  skillSlug: z.string().min(1).max(128), skillSnapshotHash: hash, inputContract: z.literal("listing_auxiliary_context_v1"), outputContract: z.literal("listing_auxiliary_original_output_v1"),
  source: z.object({ origin: z.literal("user_listing"), revision: z.string().min(1).max(256), approvalRef: z.string().min(1).max(512), evidenceHash: hash }).strict(),
  executionPolicy: z.literal("frozen_routes_known_response_repair_unknown_never_retry"), modelRoutes: z.array(route).min(1).max(2),
  maxQualityRepairs: z.number().int().min(0).max(2), originalPreset: z.enum(["standard", "quality_first"]) }).strict().superRefine((value, ctx) => {
  const expected = LISTING_AUXILIARY_DEFINITIONS[value.operation].repairs;
  if (value.skillSlug !== LISTING_AUXILIARY_DEFINITIONS[value.operation].slug || value.maxQualityRepairs !== expected
    || value.originalPreset !== LISTING_AUXILIARY_DEFINITIONS[value.operation].preset
    || new Set(value.modelRoutes.map(model => model.slug)).size !== value.modelRoutes.length) ctx.addIssue({ code: "custom", message: "Original operation policy mismatch" });
});
export type ListingAuxiliaryApproval = z.infer<typeof ListingAuxiliaryApprovalSchema>;
export const ListingAuxiliaryRuntimeEntrySchema = z.object({ approval: ListingAuxiliaryApprovalSchema, skill: AssistantConversationSkillPinSchema,
  models: z.array(StrictRegisteredModelSnapshotSchema).min(1).max(2) }).strict();
export const ListingAuxiliaryRuntimeSnapshotSchema = z.object({ version: z.literal(1), identity: ListingAuxiliaryIdentitySchema, operationId: ListingAuxiliaryUuidSchema,
  sourceHash: hash, configuration: ListingAuxiliaryConfigurationSchema, entries: z.array(ListingAuxiliaryRuntimeEntrySchema).length(1), targetCount: z.number().int().min(1).max(9),
  maxCalls: z.number().int().min(1).max(54), maxCostCents: z.number().int().min(0).max(1000000000), snapshotHash: hash }).strict().superRefine((value, ctx) => {
  const { snapshotHash, ...body } = value;
  if (snapshotHash !== listingAuxiliaryHash(body) || value.configuration.workspaceId !== value.identity.workspaceId || !value.configuration.config.enabled
    || new Set(value.entries.map(entry => entry.approval.operation)).size !== value.entries.length
    || value.entries.some(entry => entry.approval.workspaceId !== value.identity.workspaceId || entry.approval.skillSnapshotHash !== assistantConversationSkillSnapshotHash(entry.skill)
      || entry.models.length !== entry.approval.modelRoutes.length || entry.models.some((model, index) => model.workspaceId !== value.identity.workspaceId
        || model.model.slug !== entry.approval.modelRoutes[index].slug || model.configurationHash !== entry.approval.modelRoutes[index].configurationHash))
    || value.maxCalls !== value.targetCount * value.entries.reduce((sum, entry) => sum + (1 + entry.approval.maxQualityRepairs) * entry.models.length, 0)
    || value.maxCostCents !== value.targetCount * value.entries.reduce((sum, entry) => sum + (1 + entry.approval.maxQualityRepairs) * entry.approval.modelRoutes.reduce((cost, model) => cost + model.maxCostCents, 0), 0))
    ctx.addIssue({ code: "custom", message: "Runtime binding invalid" });
});
export type ListingAuxiliaryRuntimeSnapshot = z.infer<typeof ListingAuxiliaryRuntimeSnapshotSchema>;
export const ListingAuxiliaryAttemptSchema = z.object({ operation: ListingAuxiliaryStageOperationSchema, targetIndex: z.number().int().min(0).max(8), qualityAttempt: z.number().int().min(0).max(2), modelIndex: z.number().int().min(0).max(1) }).strict();
export const ListingAuxiliaryDispatchSchema = z.object({ runId: z.string().min(1).max(80), stage: z.enum(["listing_keyword_fabe", "listing_bullet_optimize", "listing_check_bullets", "listing_check_title", "listing_check_description", "listing_check_searchterms", "listing_check_qa"]),
  requestHash: hash, modelConfigurationHash: hash, bindingHash: hash, budget: ConfiguredBusinessDispatchBudgetSchema }).strict();
