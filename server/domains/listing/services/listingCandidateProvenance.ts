import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import { aiJobs, emperorSkillRuns } from "../../../../drizzle/schema/ai_os";
import { users } from "../../../../drizzle/schema/auth";
import { createListingCandidate } from "./listingCandidateReviewService";
import { getDb } from "../repository";

export async function persistGeneratedBulletCandidate(input: {
  projectId: number; workspaceId: number; userId: number; jobRunId: string;
  coreRevisionId: number; coreInputHash: string;
  execution: { runId: string; modelSlug: string | null; skillVersion: string | null; fallbackCount: number | null };
  bullet: { subtitle: string; fullText: string; evidenceUsed: string[] };
  factRevisions: Array<{ id: number; attributeKey: string; value: string }>;
  issues: string[]; characterCount: number;
}) {
  const db = await getDb();
  if (!db || !input.execution.runId || !input.execution.modelSlug || !input.execution.skillVersion) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "模型候选缺少完整的受治理运行记录，不能入审阅账本" });
  }
  const [actor] = await db.select({ id: users.id, role: users.role }).from(users).where(eq(users.id, input.userId)).limit(1);
  const [job] = await db.select({ id: aiJobs.id, status: aiJobs.status }).from(aiJobs).where(and(
    eq(aiJobs.runId, input.jobRunId), eq(aiJobs.projectId, input.projectId), eq(aiJobs.workspaceId, input.workspaceId),
    eq(aiJobs.userId, input.userId),
  )).limit(1);
  const [run] = await db.select({ id: emperorSkillRuns.id, modelSlug: emperorSkillRuns.modelSlug }).from(emperorSkillRuns).where(and(
    eq(emperorSkillRuns.runId, input.execution.runId), eq(emperorSkillRuns.workspaceId, input.workspaceId),
    eq(emperorSkillRuns.userId, input.userId), eq(emperorSkillRuns.skillSlug, "listing.bullet.step.generate"),
    eq(emperorSkillRuns.status, "succeeded"),
  )).limit(1);
  if (!actor || !job || job.status !== "running" || !run || run.modelSlug !== input.execution.modelSlug) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "模型候选与Job或Skill Run审计记录不匹配" });
  }
  if (!Array.isArray(input.bullet.evidenceUsed) || !input.bullet.evidenceUsed.length || input.issues.length) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "模型候选证据或服务端质量门禁未通过" });
  }
  const evidenceFactIds = input.bullet.evidenceUsed.map((evidence) => {
    const claim = evidence.trim().toLocaleLowerCase("en-US");
    if (claim.length < 3) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "候选证据引用过短，无法映射到已确认产品事实" });
    const matching = input.factRevisions.filter((fact) => {
      const source = `${fact.attributeKey}: ${fact.value}`.toLocaleLowerCase("en-US");
      const value = fact.value.toLocaleLowerCase("en-US");
      return source.includes(claim) && (value.includes(claim) || claim.includes(value));
    });
    if (matching.length !== 1) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "候选证据无法唯一映射到当前确认事实" });
    return matching[0].id;
  });
  return createListingCandidate({
    projectId: input.projectId, workspaceId: input.workspaceId, actorId: actor.id, actorRole: actor.role,
    coreRevisionId: input.coreRevisionId, coreInputHash: input.coreInputHash,
    source: "ai", jobId: job.id, skillRunId: run.id, promptVersion: input.execution.skillVersion,
    actualModel: input.execution.modelSlug,
    modelMetadata: { plannedModel: "quality_first", schemaVersion: "listing.bullet.step.generate.v7",
      fallbackReason: (input.execution.fallbackCount || 0) > 0 ? "governed_model_fallback" : undefined },
    subtitle: input.bullet.subtitle, fullText: input.bullet.fullText,
    evidenceFactIds: [...new Set(evidenceFactIds)],
    gateResult: { status: "passed", eligibleForConfirmation: true,
      characterCount: input.characterCount, issues: input.issues },
  });
}
