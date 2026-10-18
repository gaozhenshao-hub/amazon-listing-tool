import { z } from "zod";
import { AssistantConfigurationSchema } from "../../../shared/assistantConfigurations";
import { configurationHash, AssistantConversationSkillPinSchema, assistantConversationSkillScopeMatches,
  assistantConversationSkillSnapshotHash } from "../ai_os/services/assistantConversationSourcePrimitives";
import { StrictRegisteredModelSnapshotSchema, strictRuntimeHash, strictRuntimeCanonical, STRICT_SKILL_LIMITS } from "../ai_os/services/strictSkillRuntime";

/** Explicit opt-in adapters only. This is not a global runner overlay, registry
 * initialization, source approval, or authority to access a business resource. */
import { VIDEO_WORKFLOW_DEFINITIONS, VideoWorkflowOperationSchema, type VideoWorkflowOperation } from "../../../shared/videoWorkflow";
export const VIDEO_CONFIGURED_DEFINITIONS = Object.freeze(Object.fromEntries(Object.entries(VIDEO_WORKFLOW_DEFINITIONS).map(([operation, value]) => [operation, {operation,stage:value.stage,agentKey:"video" as const,approvalKind:"video_workflow" as const,skillSlug:value.slug,inputContract:value.input,outputContract:value.output}])) as {[K in VideoWorkflowOperation]: {operation:K;stage:typeof VIDEO_WORKFLOW_DEFINITIONS[K]["stage"];agentKey:"video";approvalKind:"video_workflow";skillSlug:typeof VIDEO_WORKFLOW_DEFINITIONS[K]["slug"];inputContract:typeof VIDEO_WORKFLOW_DEFINITIONS[K]["input"];outputContract:typeof VIDEO_WORKFLOW_DEFINITIONS[K]["output"]}});
export type VideoConfiguredDefinition = typeof VIDEO_CONFIGURED_DEFINITIONS[keyof typeof VIDEO_CONFIGURED_DEFINITIONS];
const id = z.number().int().min(1).max(2147483647), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/u.test(value));
export const VideoConfiguredStageSchema = z.enum(["video_competitor_analysis","video_section_plan","video_shot_detail","video_edit_script"]);
export const VideoConfiguredIdentitySchema = z.object({ userId: id, workspaceId: id }).strict();
export const VideoConfiguredOperationIdSchema = z.string().uuid().refine(value => value === value.toLowerCase());
export const VideoConfiguredSavedConfigurationSchema = z.object({ workspaceId: id, agentKey: z.literal("video"), revision: id,
  hash, config: AssistantConfigurationSchema }).strict().superRefine((value, ctx) => {
  if (value.hash !== configurationHash(value.config)) ctx.addIssue({ code: "custom", message: "Configuration hash mismatch" });
});
export type VideoConfiguredSavedConfiguration = z.infer<typeof VideoConfiguredSavedConfigurationSchema>;
export function videoConfiguredDefinitionFor(operation: VideoWorkflowOperation): VideoConfiguredDefinition { return VIDEO_CONFIGURED_DEFINITIONS[operation]; }
export const VideoConfiguredSourceApprovalSchema = z.object({ version: z.literal(1), workspaceId: id, stage: VideoConfiguredStageSchema, operation: VideoWorkflowOperationSchema,
  agentKey: z.literal("video"), skillSlug: text(128), skillSnapshotHash: hash, modelSlug: text(128), modelConfigurationHash: hash,
  source: z.object({ origin: z.literal("qingdao"), revision: text(256), approvalRef: text(512), evidenceId: text(256), evidenceHash: hash }).strict(),
  inputContract: text(128), outputContract: text(128), maxCostCents: z.number().int().min(0).max(1000000000) }).strict().superRefine((value, ctx) => {
  const definition = videoConfiguredDefinitionFor(value.operation);
  for (const key of ["stage", "agentKey", "skillSlug", "inputContract", "outputContract"] as const)
    if (value[key] !== definition[key]) ctx.addIssue({ code: "custom", path: [key], message: "Approval domain contract mismatch" });
});
export type VideoConfiguredSourceApproval = z.infer<typeof VideoConfiguredSourceApprovalSchema>;
export const VideoConfiguredDispatchBudgetSchema = z.object({ textBytes: z.number().int().min(1).max(STRICT_SKILL_LIMITS.textBytes),
  imageCount: z.literal(0), imageBytes: z.literal(0), contextAdmissionUnits: z.number().int().positive(), outputTokens: z.number().int().positive(),
  contextLimit: z.number().int().positive(), tokenEstimateIsExact: z.literal(false) }).strict();
export const VideoConfiguredDispatchReceiptSchema = z.object({ runId: text(128), stage: VideoConfiguredStageSchema, requestHash: hash,
  modelConfigurationHash: hash, bindingHash: hash, budget: VideoConfiguredDispatchBudgetSchema }).strict();
export type VideoConfiguredDispatchReceipt = z.infer<typeof VideoConfiguredDispatchReceiptSchema>;
const body = z.object({ schema: z.literal("video-configured-runtime/v1"), identity: VideoConfiguredIdentitySchema,
  operationId: VideoConfiguredOperationIdSchema, operation: VideoWorkflowOperationSchema, stage: VideoConfiguredStageSchema, sourceHash: hash, sourceContextHash: hash,
  configuration: z.object({ agentKey: z.literal("video"), revision: id, hash }).strict(),
  approval: VideoConfiguredSourceApprovalSchema, approvalHash: hash, skill: AssistantConversationSkillPinSchema, model: StrictRegisteredModelSnapshotSchema,
  budgetPlan: z.object({ maxCalls: z.literal(1), maxCostCentsTotal: z.number().int().min(0).max(1000000000), budget: VideoConfiguredDispatchBudgetSchema }).strict() }).strict();
export const VideoConfiguredRuntimeSnapshotSchema = body.extend({ snapshotHash: hash }).strict().superRefine((value, ctx) => {
  try {
    const { snapshotHash, ...rest } = value, definition = videoConfiguredDefinitionFor(value.operation), budget = value.budgetPlan.budget;
    if (Buffer.byteLength(strictRuntimeCanonical(value)) > 128 * 1024 || snapshotHash !== strictRuntimeHash(rest)
      || value.configuration.agentKey !== definition.agentKey || value.approval.operation !== value.operation || value.approval.stage !== value.stage || value.approval.agentKey !== definition.agentKey
      || value.approval.workspaceId !== value.identity.workspaceId || value.model.workspaceId !== value.identity.workspaceId
      || value.approvalHash !== strictRuntimeHash(value.approval) || value.approval.skillSnapshotHash !== assistantConversationSkillSnapshotHash(value.skill)
      || !assistantConversationSkillScopeMatches(value.skill, value.identity.workspaceId, definition.skillSlug)
      || value.approval.modelSlug !== value.model.model.slug || value.approval.modelConfigurationHash !== value.model.configurationHash
      || value.budgetPlan.maxCostCentsTotal !== value.approval.maxCostCents || budget.outputTokens !== value.skill.maxTokens
      || budget.contextLimit !== value.model.model.maxContextTokens || budget.contextAdmissionUnits + budget.outputTokens > budget.contextLimit)
      ctx.addIssue({ code: "custom", message: "Runtime snapshot binding mismatch" });
  } catch { ctx.addIssue({ code: "custom", message: "Invalid runtime snapshot" }); }
});
export type VideoConfiguredRuntimeSnapshot = z.infer<typeof VideoConfiguredRuntimeSnapshotSchema>;
export const videoConfiguredRuntimeHash = strictRuntimeHash;
