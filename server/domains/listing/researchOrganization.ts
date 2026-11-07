import {
  mergeResearchProposal,
  preserveManualResearch,
  adoptSellingProposal,
} from "../../../shared/researchEditing";
import { listingAggregationSchema } from "../../../shared/listingAggregation";
import { questionMergeSignature } from "../../../shared/questionMerging";
import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { adjustAggregationResult } from "./aggregationAdjustments";
import { acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { saveListingAggregation } from "./aggregationStore";
import { TRPCError } from "@trpc/server";
import { readListingAggregation } from "./aggregationStore";
import { generateListingAggregation } from "./generateListingAggregation";
import { ensureResearchAgent, researchAgentContext } from "./researchAgent";
import { RESEARCH_SKILLS } from "./researchPrompts";
import { mutateResearchManaged } from "./researchManagedStore";
import { assertResearchEditable } from "./researchLocks";
import type { PlanningScope } from "./imagePlanningStore";
import {
  getAiJobRun,
  startRegisteredAiJob,
  registerAiJobHandler,
} from "../../services/aiJobRunner";
import {
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeWaitingHuman,
  markBusinessManagedNodeFailed,
} from "../ai_os/services/businessManagedAgent";
type Section = "selling" | "reviews" | "questions";
export const researchPreviewInput = z.object({
  projectId: z.number().int().positive(),
  section: z.enum(["selling", "reviews", "questions"]),
  runId: z.string().min(1).max(80),
  previewRevision: z.number().int().nonnegative(),
});
export const researchRefinementInput = researchPreviewInput.extend({
  message: z.string().trim().min(1).max(4000),
});
const previewOutput = z
  .object({
    data: listingAggregationSchema,
    revision: z.number(),
    section: z.enum(["selling", "reviews", "questions"]),
    previewRevision: z.number().default(0),
    preserveManual: z.boolean().optional(),
    history: z
      .array(
        z.object({
          role: z.enum(["user", "assistant"]),
          text: z.string().max(6000),
        })
      )
      .max(40)
      .default([]),
  })
  .passthrough();
const previewConflict = () =>
  new TRPCError({
    code: "CONFLICT",
    message: "整理预览或人工内容已更新，请打开最新预览",
  });
async function lockedPreview(
  scope: PlanningScope,
  input: z.infer<typeof researchPreviewInput>,
  data: import("../../../shared/listingAggregation").ListingAggregation,
  tx: import("../../repositories/dbClient").DbExecutor
) {
  if (data.researchJobs?.[input.section] !== input.runId)
    throw previewConflict();
  const [rows] = await tx.execute(
    sql`SELECT output,status FROM ai_jobs WHERE runId=${input.runId} AND projectId=${scope.projectId} AND workspaceId=${scope.workspaceId} AND userId=${scope.userId} FOR UPDATE`
  );
  const row = (rows as any[])[0];
  if (!row || row.status !== "succeeded") throw previewConflict();
  const output = previewOutput.parse(
    typeof row.output === "string" ? JSON.parse(row.output) : row.output
  );
  if (
    output.section !== input.section ||
    output.previewRevision !== input.previewRevision
  )
    throw previewConflict();
  if (
    input.section === "questions" &&
    output.data.questionMergeBase !== questionMergeSignature(data.questions)
  )
    throw previewConflict();
  return output;
}
export async function dismissResearchPreview(
  scope: PlanningScope,
  input: z.infer<typeof researchPreviewInput>
) {
  return mutateResearchManaged(scope, input.section, async (data, tx) => {
    const output = await lockedPreview(scope, input, data, tx);
    await tx.execute(
      sql`UPDATE ai_jobs SET output=${JSON.stringify({ ...output, decision: "canceled" })} WHERE runId=${input.runId}`
    );
    delete data.researchJobs![input.section];
    return { dismissed: true };
  }, { allowLockedSelling: true });
}
export async function refineResearchPreview(
  scope: PlanningScope,
  input: z.infer<typeof researchRefinementInput>
) {
  const before = await readListingAggregation(scope);
  const snapshot = await mutateResearchManaged(
    scope,
    input.section,
    (data, tx) => lockedPreview(scope, input, data, tx),
    { readOnly: true }
  );
  const original = snapshot.result;
  const base = preserveManualResearch(
    before.data,
    mergeResearchProposal(before.data, original.data, input.section)
  );
  const adjusted = await adjustAggregationResult(scope, {
    projectId: scope.projectId,
    section: input.section,
    data: base,
    message: input.message,
    history: original.history,
  });
  return mutateResearchManaged(
    scope,
    input.section,
    async (data, tx) => {
      const current = await lockedPreview(scope, input, data, tx);
      if (acquisitionReviewHash(data) !== acquisitionReviewHash(before.data))
        throw previewConflict();
      const next = {
        ...current,
        data: preserveManualResearch(data, adjusted.data),
        originalData: current.originalData || current.data,
        previewRevision: current.previewRevision + 1,
        history: [
          ...current.history,
          { role: "user", text: input.message },
          { role: "assistant", text: adjusted.reply },
        ],
      };
      previewOutput.parse(next);
      await tx.execute(
        sql`UPDATE ai_jobs SET output=${JSON.stringify(next)} WHERE runId=${input.runId}`
      );
      return { previewRevision: next.previewRevision };
    },
    { readOnly: true }
  );
}
export async function confirmResearchPreview(
  scope: PlanningScope,
  input: z.infer<typeof researchPreviewInput>
) {
  const result = await mutateResearchManaged(
    scope,
    input.section,
    async (data, tx) => {
      const output = await lockedPreview(scope, input, data, tx);
      const [rows] = await tx.execute(
        sql`SELECT revision FROM listing_aggregations WHERE project_id=${scope.projectId} AND workspace_id=${scope.workspaceId} FOR UPDATE`
      );
      const revision = Number((rows as any[])[0]?.revision || 0);
      const saved = await saveListingAggregation(
        scope,
        revision,
        input.section === "selling"
          ? adoptSellingProposal(data, output.data, output.preserveManual !== false)
          : mergeResearchProposal(data, output.data, input.section),
        tx,
        { generated: true, section: input.section, exactSelling: input.section === "selling" }
      );
      await tx.execute(
        sql`UPDATE ai_jobs SET output=${JSON.stringify({ ...output, decision: "confirmed" })} WHERE runId=${input.runId}`
      );
      return saved;
    },
    { readOnly: true, allowLockedSelling: true }
  );
  await acknowledgeResearchOrganization(
    scope,
    input.section,
    input.runId,
    result.result.data
  ).catch(() => console.warn("[聚合分析] 已保存，流程确认记录待同步"));
  return result.result;
}
export async function startResearchOrganization(
  scope: PlanningScope,
  section: Section,
  feedback = "",
  preserveManual = true
) {
  if (section !== "selling") await assertResearchEditable(scope, section);
  const agent = await ensureResearchAgent(scope, section);
  return mutateResearchManaged(scope, section, async data => {
    const id = data.researchJobs?.[section],
      previous = id ? await getAiJobRun(id) : null;
    if (previous && ["queued", "running"].includes(previous.status))
      return { runId: previous.runId };
    if (
      section !== "selling" &&
      (data.organized?.[section] || !!data[section].length) &&
      !feedback.trim()
    )
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "请说明对结果哪里不满意，以及希望怎样改进",
      });
    const job = await startRegisteredAiJob({
      runId: "research-" + randomUUID(),
      kind: "listing.research.organize",
      module: "listing",
      procedure: "analysis.organize",
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      projectId: scope.projectId,
      skillSlug: RESEARCH_SKILLS[section],
      queueName: "analysis",
      timeoutSeconds: 900,
      maxAttempts: 1,
      input: { ...scope, ...agent, agentRunId:agent.agentRunId, agentNodeId:agent.agentNodeId, section, feedback, preserveManual },
    });
    data.researchJobs = { ...data.researchJobs, [section]: job.runId };
    return { runId: job.runId };
  }, { allowLockedSelling: true });
}
export async function researchOrganizationStatus(
  scope: PlanningScope,
  section: Section
) {
  const current = await readListingAggregation(scope),
    id = current.data.researchJobs?.[section],
    job = id ? await getAiJobRun(id) : null;
  if (!job) return null;
  if (
    job.projectId !== scope.projectId ||
    job.workspaceId !== scope.workspaceId ||
    job.userId !== scope.userId
  )
    throw new TRPCError({ code: "NOT_FOUND", message: "整理记录不可访问" });
  const original =
    job.status === "succeeded"
      ? (job.output as {
          data: unknown;
          revision: number;
          section: Section;
          previewRevision?: number;
          preserveManual?: boolean;
          history?: Array<{ role: "user" | "assistant"; text: string }>;
        })
      : null;
  const questionPreviewStale =
    !!original &&
    section === "questions" &&
    (!(original.data as any)?.questionMergeBase ||
      (original.data as any).questionMergeBase !==
        questionMergeSignature(current.data.questions));
  const proposal =
    original && !questionPreviewStale
      ? {
          ...original,
          previewRevision: original.previewRevision || 0,
          revision: current.revision,
          data: section === "selling" ? listingAggregationSchema.parse(original.data) : preserveManualResearch(
            current.data,
            mergeResearchProposal(
              current.data,
              listingAggregationSchema.parse(original.data),
              section
            )
          ),
        }
      : null;
  return {
    runId: job.runId,
    status: job.status,
    proposal,
    error: questionPreviewStale
      ? "请点击一键整理问题，生成合并同类项后的最新预览；人工修改会保留。"
      : ["failed", "canceled"].includes(job.status)
        ? "本次整理未完成，现有人工内容已保留。可重试或继续编辑。"
        : null,
  };
}
registerAiJobHandler({
  id: "listing-research-organize",
  match: job => job.kind === "listing.research.organize",
  handler: async (job, { signal }) => {
    const scope = {
        projectId: job.projectId!,
        workspaceId: job.workspaceId!,
        userId: job.userId!,
      },
      input = job.input as any,
      section = input.section as Section;
    const agent = await researchAgentContext(scope, input.agentRunId, section),
      tracking = { ...agent, aiJobRunId: job.runId, aiJobAttempt: job.attempt, allowJobReplacement: section === "selling" };
    await markBusinessManagedNodeRunning(tracking);
    try {
      await mutateResearchManaged(scope, section, async () => null, {
        readOnly: true,
        allowLockedSelling: true,
      });
      signal.throwIfAborted();
      const output = await generateListingAggregation(scope, {
        preview: true,
        section,
        signal,
        feedback: input.feedback,
        preserveManual: section === "selling" ? input.preserveManual !== false : undefined,
      });
      signal.throwIfAborted();
      if (section !== "selling") await assertResearchEditable(scope, section);
      await markBusinessManagedNodeWaitingHuman({
        ...tracking,
        output: { section, revision: output.revision },
      });
      return {
        ...output,
        section,
        previewRevision: 0,
        preserveManual: section === "selling" ? input.preserveManual !== false : undefined,
        history: input.feedback ? [{ role: "user", text: input.feedback }] : [],
      };
    } catch (error) {
      await markBusinessManagedNodeFailed({
        ...tracking,
        finalAttempt: true,
        errorMessage: "本次整理未完成",
      }).catch(() => null);
      throw error;
    }
  },
});

export async function acknowledgeResearchOrganization(
  scope: PlanningScope,
  section: Section,
  runId: string,
  data: unknown
) {
  const job = await getAiJobRun(runId);
  if (
    !job ||
    job.status !== "succeeded" ||
    job.projectId !== scope.projectId ||
    job.workspaceId !== scope.workspaceId ||
    job.userId !== scope.userId ||
    (job.input as any)?.section !== section
  )
    return;
  const agent = await researchAgentContext(
    scope,
    (job.input as any).agentRunId,
    section
  );
  await markBusinessManagedNodeConfirmed({
    ...agent,
    output: data,
    userEdit: data,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
  });
}
