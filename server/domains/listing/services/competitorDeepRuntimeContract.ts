import { createHash } from "node:crypto";
import { z } from "zod";
import { canonicalCompetitorResearchEvidence } from "../../../../shared/competitorResearchEvidence";
import { CompetitorDeepStartInputSchema } from "../../../../shared/competitorDeepExecutionJob";
import { AssistantConversationSkillPinSchema, assistantConversationSkillSnapshotHash, assistantConversationSkillScopeMatches } from "../../ai_os/services/assistantConversationSourcePrimitives";
import { StrictRegisteredModelSnapshotSchema } from "../../ai_os/services/strictSkillRuntime";
export const DEEP_STAGES = ["title", "selling", "buyers_batch", "buyers_synthesis", "summary"] as const;
const id = z.number().int().positive().safe(), hash = z.string().regex(/^[a-f0-9]{64}$/u);
const text = (max: number) => z.string().min(1).max(max).refine(value => value === value.trim());
export const deepRuntimeHash = (value: unknown) => createHash("sha256").update(canonicalCompetitorResearchEvidence(value)).digest("hex");
export const CompetitorDeepApprovalSchema = z.object({ version: z.literal(1), workspaceId: id, stage: z.enum(DEEP_STAGES),
  skillSlug: text(128), skillSnapshotHash: hash, modelSlug: text(128), modelConfigurationHash: hash,
  source: z.object({ origin: z.literal("user_listing"), revision: text(256), approvalRef: text(512), evidenceId: text(256), evidenceHash: hash }).strict(),
  inputContract: z.literal("competitor_deep_evidence_v1"), outputContract: z.literal("competitor_deep_claims_v1"),
  maxCostCents: z.number().int().min(0).max(1_000_000_000),
}).strict();
export type CompetitorDeepApproval = z.infer<typeof CompetitorDeepApprovalSchema>;
const stage = z.object({ approval: CompetitorDeepApprovalSchema, skill: AssistantConversationSkillPinSchema, model: StrictRegisteredModelSnapshotSchema }).strict();
const body = z.object({ version: z.literal(1), workspaceId: id, stages: z.array(stage).length(5) }).strict();
export const CompetitorDeepRuntimeSnapshotSchema = body.extend({ snapshotHash: hash }).strict().superRefine((value, ctx) => {
  const { snapshotHash, ...rest } = value;
  if (snapshotHash !== deepRuntimeHash(rest) || value.stages.some((item, i) => item.approval.stage !== DEEP_STAGES[i]
    || item.approval.workspaceId !== value.workspaceId || item.model.workspaceId !== value.workspaceId
    || item.approval.skillSnapshotHash !== assistantConversationSkillSnapshotHash(item.skill)
    || !assistantConversationSkillScopeMatches(item.skill, value.workspaceId, item.approval.skillSlug)
    || item.approval.modelSlug !== item.model.model.slug || item.approval.modelConfigurationHash !== item.model.configurationHash
    || item.skill.modelOverride !== null && item.skill.modelOverride !== item.model.model.slug))
    ctx.addIssue({ code: "custom", message: "Runtime binding invalid" });
});
export type CompetitorDeepRuntimeSnapshot = z.infer<typeof CompetitorDeepRuntimeSnapshotSchema>;
export const CompetitorDeepReservationSchema = z.object({ request: CompetitorDeepStartInputSchema, requestHash: hash,
  runtime: CompetitorDeepRuntimeSnapshotSchema }).strict();
export type CompetitorDeepReservation = z.infer<typeof CompetitorDeepReservationSchema>;
