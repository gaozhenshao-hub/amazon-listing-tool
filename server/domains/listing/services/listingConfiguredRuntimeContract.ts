import { z } from "zod";
import { ListingConfiguredIdentitySchema, ListingConfiguredHashSchema as hash, ListingConfiguredUuidSchema, listingConfiguredHash, LISTING_CONFIGURED_DEFINITIONS } from "../../../../shared/listingConfiguredWorkflow";
import { CompetitorDeepConfigurationSchema } from "./competitorDeepRuntimeContract";
import { AssistantConversationSkillPinSchema, assistantConversationSkillSnapshotHash } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { StrictRegisteredModelSnapshotSchema } from "../../ai_os/services/strictSkillRuntime";
import { ConfiguredBusinessDispatchBudgetSchema } from "../../ai_os/services/configuredBusinessRuntimeContract";
export const ListingConfiguredConfigurationSchema = CompetitorDeepConfigurationSchema;
export type ListingConfiguredConfiguration = z.infer<typeof ListingConfiguredConfigurationSchema>;
export const ListingConfiguredStageOperationSchema = z.enum(["sellingPoints", "singleBullet", "bullets", "title", "description", "searchTerms", "qa"]);
const route = z.object({ slug: z.string().min(1).max(128), configurationHash: hash, maxCostCents: z.number().int().min(0).max(1000000000) }).strict();
export const ListingConfiguredApprovalSchema = z.object({ version: z.literal(1), workspaceId: z.number().int().positive(), operation: ListingConfiguredStageOperationSchema,
  skillSlug: z.string().min(1).max(128), skillSnapshotHash: hash, inputContract: z.literal("listing_generation_context_v1"), outputContract: z.literal("listing_generation_original_output_v1"),
  source: z.object({ origin: z.literal("user_listing"), revision: z.string().min(1).max(256), approvalRef: z.string().min(1).max(512), evidenceHash: hash }).strict(),
  executionPolicy: z.literal("frozen_routes_known_response_repair_unknown_never_retry"), modelRoutes: z.array(route).min(1).max(2),
  maxQualityRepairs: z.number().int().min(0).max(2), originalPreset: z.enum(["standard", "quality_first"]) }).strict().superRefine((value, ctx) => {
  const expected = ["singleBullet", "title", "bullets"].includes(value.operation) ? 2 : 0;
  if (value.skillSlug !== LISTING_CONFIGURED_DEFINITIONS[value.operation].slug || value.maxQualityRepairs !== expected
    || value.originalPreset !== (value.operation === "singleBullet" ? "quality_first" : "standard")
    || new Set(value.modelRoutes.map(model => model.slug)).size !== value.modelRoutes.length) ctx.addIssue({ code: "custom", message: "Original operation policy mismatch" });
});
export type ListingConfiguredApproval = z.infer<typeof ListingConfiguredApprovalSchema>;
export const ListingConfiguredRuntimeEntrySchema = z.object({ approval: ListingConfiguredApprovalSchema, skill: AssistantConversationSkillPinSchema,
  models: z.array(StrictRegisteredModelSnapshotSchema).min(1).max(2) }).strict();
export const ListingConfiguredRuntimeSnapshotSchema = z.object({ version: z.literal(1), identity: ListingConfiguredIdentitySchema, operationId: ListingConfiguredUuidSchema,
  sourceHash: hash, configuration: ListingConfiguredConfigurationSchema, entries: z.array(ListingConfiguredRuntimeEntrySchema).min(1).max(7),
  maxCalls: z.number().int().min(1).max(42), maxCostCents: z.number().int().min(0).max(1000000000), snapshotHash: hash }).strict().superRefine((value, ctx) => {
  const { snapshotHash, ...body } = value;
  if (snapshotHash !== listingConfiguredHash(body) || value.configuration.workspaceId !== value.identity.workspaceId || !value.configuration.config.enabled
    || new Set(value.entries.map(entry => entry.approval.operation)).size !== value.entries.length
    || value.entries.some(entry => entry.approval.workspaceId !== value.identity.workspaceId || entry.approval.skillSnapshotHash !== assistantConversationSkillSnapshotHash(entry.skill)
      || entry.models.length !== entry.approval.modelRoutes.length || entry.models.some((model, index) => model.workspaceId !== value.identity.workspaceId
        || model.model.slug !== entry.approval.modelRoutes[index].slug || model.configurationHash !== entry.approval.modelRoutes[index].configurationHash))
    || value.maxCalls !== value.entries.reduce((sum, entry) => sum + (1 + entry.approval.maxQualityRepairs) * entry.models.length, 0)
    || value.maxCostCents !== value.entries.reduce((sum, entry) => sum + (1 + entry.approval.maxQualityRepairs) * entry.approval.modelRoutes.reduce((cost, model) => cost + model.maxCostCents, 0), 0))
    ctx.addIssue({ code: "custom", message: "Runtime binding invalid" });
});
export type ListingConfiguredRuntimeSnapshot = z.infer<typeof ListingConfiguredRuntimeSnapshotSchema>;
export const ListingConfiguredAttemptSchema = z.object({ operation: ListingConfiguredStageOperationSchema, qualityAttempt: z.number().int().min(0).max(2), modelIndex: z.number().int().min(0).max(1) }).strict();
export const ListingConfiguredDispatchSchema = z.object({ runId: z.string().min(1).max(80), stage: z.enum(["listing_selling_points", "listing_single_bullet", "listing_bullets", "listing_title", "listing_description", "listing_search_terms", "listing_qa"]),
  requestHash: hash, modelConfigurationHash: hash, bindingHash: hash, budget: ConfiguredBusinessDispatchBudgetSchema }).strict();
