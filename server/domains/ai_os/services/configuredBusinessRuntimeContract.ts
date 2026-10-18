import { z } from "zod";
import { AssistantConfigurationSchema } from "../../../../shared/assistantConfigurations";
import { configurationHash, AssistantConversationSkillPinSchema, assistantConversationSkillScopeMatches,
  assistantConversationSkillSnapshotHash } from "./assistantConversationSourcePrimitives";
import { StrictRegisteredModelSnapshotSchema, strictRuntimeHash, strictRuntimeCanonical, STRICT_SKILL_LIMITS } from "./strictSkillRuntime";

/** Explicit opt-in adapters only. This is not a global runner overlay, registry
 * initialization, source approval, or authority to access a business resource. */
export const CONFIGURED_BUSINESS_DEFINITIONS = Object.freeze({
  imagePlanning: Object.freeze({ stage: "image_outline", agentKey: "images", approvalKind: "image_planning", skillSlug: "image.step2.outline",
    inputContract: "image_planning_evidence_v1", outputContract: "image_planning_outline_v1" } as const),
  developmentMarket: Object.freeze({ stage: "development_market_overview", agentKey: "development", approvalKind: "development_market", skillSlug: "dev.analysis.market_overview",
    inputContract: "development_market_evidence_v1", outputContract: "development_market_analysis_v1" } as const),
});
export type ConfiguredBusinessDefinition = typeof CONFIGURED_BUSINESS_DEFINITIONS[keyof typeof CONFIGURED_BUSINESS_DEFINITIONS];
const id = z.number().int().min(1).max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
export const ConfiguredBusinessStageSchema = z.enum(["image_outline", "development_market_overview"]);
export const ConfiguredBusinessIdentitySchema = z.object({ userId: id, workspaceId: id }).strict();
export const ConfiguredBusinessOperationIdSchema = z.string().uuid().refine(value => value === value.toLowerCase());
export const ConfiguredBusinessSavedConfigurationSchema = z.object({ workspaceId: id, agentKey: z.enum(["images", "development"]), revision: id,
  hash, config: AssistantConfigurationSchema }).strict().superRefine((value, ctx) => {
  if (value.hash !== configurationHash(value.config)) ctx.addIssue({ code: "custom", message: "Configuration hash mismatch" });
});
export type ConfiguredBusinessSavedConfiguration = z.infer<typeof ConfiguredBusinessSavedConfigurationSchema>;
export function configuredBusinessDefinitionFor(stage: z.infer<typeof ConfiguredBusinessStageSchema>): ConfiguredBusinessDefinition {
  return stage === "image_outline" ? CONFIGURED_BUSINESS_DEFINITIONS.imagePlanning : CONFIGURED_BUSINESS_DEFINITIONS.developmentMarket;
}
export const ConfiguredBusinessSourceApprovalSchema = z.object({ version: z.literal(1), workspaceId: id, stage: ConfiguredBusinessStageSchema,
  agentKey: z.enum(["images", "development"]), skillSlug: text(128), skillSnapshotHash: hash, modelSlug: text(128), modelConfigurationHash: hash,
  source: z.object({ origin: z.literal("qingdao"), revision: text(256), approvalRef: text(512), evidenceId: text(256), evidenceHash: hash }).strict(),
  inputContract: text(128), outputContract: text(128), maxCostCents: z.number().int().min(0).max(1000000000) }).strict().superRefine((value, ctx) => {
  const definition = configuredBusinessDefinitionFor(value.stage);
  for (const key of ["agentKey", "skillSlug", "inputContract", "outputContract"] as const)
    if (value[key] !== definition[key]) ctx.addIssue({ code: "custom", path: [key], message: "Approval domain contract mismatch" });
});
export type ConfiguredBusinessSourceApproval = z.infer<typeof ConfiguredBusinessSourceApprovalSchema>;
export const ConfiguredBusinessDispatchBudgetSchema = z.object({ textBytes: z.number().int().min(1).max(STRICT_SKILL_LIMITS.textBytes),
  imageCount: z.literal(0), imageBytes: z.literal(0), contextAdmissionUnits: z.number().int().positive(), outputTokens: z.number().int().positive(),
  contextLimit: z.number().int().positive(), tokenEstimateIsExact: z.literal(false) }).strict();
export const ConfiguredBusinessDispatchReceiptSchema = z.object({ runId: text(128), stage: ConfiguredBusinessStageSchema, requestHash: hash,
  modelConfigurationHash: hash, bindingHash: hash, budget: ConfiguredBusinessDispatchBudgetSchema }).strict();
export type ConfiguredBusinessDispatchReceipt = z.infer<typeof ConfiguredBusinessDispatchReceiptSchema>;
const body = z.object({ schema: z.literal("configured-business-runtime/v1"), identity: ConfiguredBusinessIdentitySchema,
  operationId: ConfiguredBusinessOperationIdSchema, stage: ConfiguredBusinessStageSchema, sourceHash: hash, sourceContextHash: hash,
  configuration: z.object({ agentKey: z.enum(["images", "development"]), revision: id, hash }).strict(),
  approval: ConfiguredBusinessSourceApprovalSchema, approvalHash: hash, skill: AssistantConversationSkillPinSchema, model: StrictRegisteredModelSnapshotSchema,
  budgetPlan: z.object({ maxCalls: z.literal(1), maxCostCentsTotal: z.number().int().min(0).max(1000000000), budget: ConfiguredBusinessDispatchBudgetSchema }).strict() }).strict();
export const ConfiguredBusinessRuntimeSnapshotSchema = body.extend({ snapshotHash: hash }).strict().superRefine((value, ctx) => {
  try {
    const { snapshotHash, ...rest } = value, definition = configuredBusinessDefinitionFor(value.stage), budget = value.budgetPlan.budget;
    if (Buffer.byteLength(strictRuntimeCanonical(value)) > 128 * 1024 || snapshotHash !== strictRuntimeHash(rest)
      || value.configuration.agentKey !== definition.agentKey || value.approval.stage !== value.stage || value.approval.agentKey !== definition.agentKey
      || value.approval.workspaceId !== value.identity.workspaceId || value.model.workspaceId !== value.identity.workspaceId
      || value.approvalHash !== strictRuntimeHash(value.approval) || value.approval.skillSnapshotHash !== assistantConversationSkillSnapshotHash(value.skill)
      || !assistantConversationSkillScopeMatches(value.skill, value.identity.workspaceId, definition.skillSlug)
      || value.approval.modelSlug !== value.model.model.slug || value.approval.modelConfigurationHash !== value.model.configurationHash
      || value.budgetPlan.maxCostCentsTotal !== value.approval.maxCostCents || budget.outputTokens !== value.skill.maxTokens
      || budget.contextLimit !== value.model.model.maxContextTokens || budget.contextAdmissionUnits + budget.outputTokens > budget.contextLimit)
      ctx.addIssue({ code: "custom", message: "Runtime snapshot binding mismatch" });
  } catch { ctx.addIssue({ code: "custom", message: "Invalid runtime snapshot" }); }
});
export type ConfiguredBusinessRuntimeSnapshot = z.infer<typeof ConfiguredBusinessRuntimeSnapshotSchema>;
export const configuredBusinessRuntimeHash = strictRuntimeHash;
