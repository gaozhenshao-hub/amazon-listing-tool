import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalCompetitorResearchEvidence } from "../../../../shared/competitorResearchEvidence";
import { CompetitorDeepStartInputSchema } from "../../../../shared/competitorDeepExecutionJob";
import { AssistantConfigurationSchema, AssistantRevisionSchema } from "../../../../shared/assistantConfigurations";
import { AssistantConversationSkillPinSchema, assistantConversationSkillSnapshotHash, assistantConversationSkillScopeMatches, configurationHash } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { StrictRegisteredModelSnapshotSchema } from "../../ai_os/services/strictSkillRuntime";
export const DEEP_STAGES = ["title", "selling", "buyers_batch", "buyers_synthesis", "summary"] as const;
const id = z.number().int().positive().safe(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim());
export const deepRuntimeHash = (value: unknown) => createHash("sha256").update(canonicalCompetitorResearchEvidence(value)).digest("hex");
export const CompetitorDeepApprovalSchema = z.object({ version: z.literal(1), workspaceId: id, stage: z.enum(DEEP_STAGES),
  skillSlug: text(128), skillSnapshotHash: hash, modelSlug: text(128), modelConfigurationHash: hash,
  source: z.object({ origin: z.literal("user_listing"), revision: text(256), approvalRef: text(512), evidenceId: text(256), evidenceHash: hash }).strict(),
  inputContract: z.enum(["competitor_deep_evidence_v1", "competitor_deep_agent_evidence_v2"]), outputContract: z.literal("competitor_deep_claims_v1"),
  maxCostCents: z.number().int().min(0).max(1_000_000_000),
}).strict();
export type CompetitorDeepApproval = z.infer<typeof CompetitorDeepApprovalSchema>;
const stage = z.object({ approval: CompetitorDeepApprovalSchema, skill: AssistantConversationSkillPinSchema, model: StrictRegisteredModelSnapshotSchema }).strict();
export const CompetitorDeepConfigurationSchema = z.object({ workspaceId: id, agentKey: z.literal("listing"), revision: AssistantRevisionSchema,
  hash, config: AssistantConfigurationSchema }).strict().superRefine((value, ctx) => {
  if (value.hash !== configurationHash(value.config)) ctx.addIssue({ code: "custom", message: "Configuration hash invalid" });
});
export type CompetitorDeepConfiguration = z.infer<typeof CompetitorDeepConfigurationSchema>;
const legacyBody = z.object({ version: z.literal(1), workspaceId: id, stages: z.array(stage).length(5) }).strict();
const configuredBody = legacyBody.extend({ version: z.literal(2), configuration: CompetitorDeepConfigurationSchema }).strict();
/** v1 keeps its original immutable execution/replay semantics; new reservations require v2. */
export const CompetitorDeepRuntimeSnapshotSchema = z.discriminatedUnion("version", [legacyBody.extend({ snapshotHash: hash }), configuredBody.extend({ snapshotHash: hash })]).superRefine((value, ctx) => {
  const { snapshotHash, ...rest } = value;
  if (snapshotHash !== deepRuntimeHash(rest) || value.stages.some((item, i) => item.approval.stage !== DEEP_STAGES[i]
    || item.approval.workspaceId !== value.workspaceId || item.model.workspaceId !== value.workspaceId
    || item.approval.skillSnapshotHash !== assistantConversationSkillSnapshotHash(item.skill)
    || !assistantConversationSkillScopeMatches(item.skill, value.workspaceId, item.approval.skillSlug)
    || item.approval.modelSlug !== item.model.model.slug || item.approval.modelConfigurationHash !== item.model.configurationHash
    || (value.version === 1 ? item.approval.inputContract !== "competitor_deep_evidence_v1" || item.skill.modelOverride !== null && item.skill.modelOverride !== item.model.model.slug
      : item.approval.inputContract !== "competitor_deep_agent_evidence_v2")))
    ctx.addIssue({ code: "custom", message: "Runtime binding invalid" });
  if (value.version === 2 && (value.configuration.workspaceId !== value.workspaceId || !value.configuration.config.enabled || value.stages.some(item => {
    const binding = value.configuration.config.skills.find(candidate => candidate.slug === item.skill.slug && candidate.enabled);
    return !binding || binding.version !== item.skill.version || binding.manifestSha256 !== item.skill.manifestSha256
      || (value.configuration.config.modelSlug || item.skill.modelOverride) !== item.model.model.slug;
  }))) ctx.addIssue({ code: "custom", message: "Configuration binding invalid" });
});
export type CompetitorDeepRuntimeSnapshot = z.infer<typeof CompetitorDeepRuntimeSnapshotSchema>;
export const CompetitorDeepReservationSchema = z.object({ request: CompetitorDeepStartInputSchema, requestHash: hash,
  runtime: CompetitorDeepRuntimeSnapshotSchema }).strict();
export type CompetitorDeepReservation = z.infer<typeof CompetitorDeepReservationSchema>;
