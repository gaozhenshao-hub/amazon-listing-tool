import { z } from "zod";
import { AssistantConfigurationSchema } from "../../../shared/assistantConfigurations";
import { KnowledgeQaIdentitySchema, KnowledgeQaHashSchema as hash, KnowledgeQaUuidSchema, KnowledgeQaIdSchema as id, knowledgeQaHash } from "../../../shared/knowledgeQa";
import { configurationHash, AssistantConversationSkillPinSchema, assistantConversationSkillSnapshotHash, assistantConversationSkillScopeMatches } from "../ai_os/services/assistantConversationSourcePrimitives";
import { StrictRegisteredModelSnapshotSchema } from "../ai_os/services/strictSkillRuntime";
import { ConfiguredBusinessDispatchBudgetSchema } from "../ai_os/services/configuredBusinessRuntimeContract";
export const KnowledgeQaConfigurationSchema = z.object({ workspaceId: id, agentKey: z.literal("knowledge"), revision: id, hash, config: AssistantConfigurationSchema }).strict()
  .refine(value => configurationHash(value.config) === value.hash);
export const KnowledgeQaApprovalSchema = z.object({ version: z.literal(1), workspaceId: id, stage: z.enum(["knowledge_select", "knowledge_answer"]), agentKey: z.literal("knowledge"),
  skillSlug: z.enum(["knowledge.qa.select", "knowledge.qa.answer"]), skillSnapshotHash: hash, modelSlug: z.string().min(1).max(128), modelConfigurationHash: hash,
  source: z.object({ origin: z.literal("qingdao"), revision: z.string().min(1).max(256), approvalRef: z.string().min(1).max(512), evidenceId: z.string().min(1).max(256), evidenceHash: hash }).strict(),
  inputContract: z.literal("knowledge_qa_evidence_v1"), outputContract: z.enum(["knowledge_qa_selection_v1", "knowledge_qa_markdown_v1"]), maxCostCents: z.number().int().min(0).max(1000000) }).strict()
  .refine(value => value.stage === "knowledge_select" ? value.skillSlug === "knowledge.qa.select" && value.outputContract === "knowledge_qa_selection_v1" : value.skillSlug === "knowledge.qa.answer" && value.outputContract === "knowledge_qa_markdown_v1");
const binding = z.object({ approval: KnowledgeQaApprovalSchema, skill: AssistantConversationSkillPinSchema, model: StrictRegisteredModelSnapshotSchema }).strict();
const body = z.object({ version: z.literal(1), identity: KnowledgeQaIdentitySchema, operationId: KnowledgeQaUuidSchema, sourceHash: hash,
  configuration: z.object({ revision: id, hash }).strict(), select: binding, answer: binding,
  budgetPlan: z.object({ maxCalls: z.number().int().min(0).max(3), maxCostCentsTotal: z.number().int().min(0).max(3000000) }).strict() }).strict();
export const KnowledgeQaRuntimeSnapshotSchema = body.extend({ snapshotHash: hash }).strict().superRefine((value, ctx) => {
  const { snapshotHash, ...rest } = value;
  if (snapshotHash !== knowledgeQaHash(rest)) ctx.addIssue({ code: "custom", message: "SNAPSHOT_HASH_INVALID" });
  if (value.budgetPlan.maxCostCentsTotal !== (value.budgetPlan.maxCalls ? (value.budgetPlan.maxCalls - 1) * value.select.approval.maxCostCents + value.answer.approval.maxCostCents : 0)) ctx.addIssue({ code: "custom", message: "SNAPSHOT_BUDGET_INVALID" });
  for (const [key, slug, stage] of [["select", "knowledge.qa.select", "knowledge_select"], ["answer", "knowledge.qa.answer", "knowledge_answer"]] as const) {
    const entry = value[key]; if (entry.approval.workspaceId !== value.identity.workspaceId || entry.approval.stage !== stage || entry.approval.skillSlug !== slug
      || entry.approval.skillSnapshotHash !== assistantConversationSkillSnapshotHash(entry.skill) || !assistantConversationSkillScopeMatches(entry.skill, value.identity.workspaceId, slug)
      || entry.model.workspaceId !== value.identity.workspaceId || entry.approval.modelSlug !== entry.model.model.slug || entry.approval.modelConfigurationHash !== entry.model.configurationHash
      || entry.skill.supportsJsonMode !== (key === "select")) ctx.addIssue({ code: "custom", message: "SNAPSHOT_BINDING_INVALID" });
  }
});
export const KnowledgeQaDispatchSchema = z.object({ runId: z.string().min(1).max(128), stage: z.enum(["knowledge_select", "knowledge_answer"]), requestHash: hash,
  modelConfigurationHash: hash, bindingHash: hash, budget: ConfiguredBusinessDispatchBudgetSchema }).strict();
export type KnowledgeQaRuntimeSnapshot = z.infer<typeof KnowledgeQaRuntimeSnapshotSchema>;
export type KnowledgeQaConfiguration = z.infer<typeof KnowledgeQaConfigurationSchema>;
export type KnowledgeQaApproval = z.infer<typeof KnowledgeQaApprovalSchema>;
export type KnowledgeQaDispatch = z.infer<typeof KnowledgeQaDispatchSchema>;
