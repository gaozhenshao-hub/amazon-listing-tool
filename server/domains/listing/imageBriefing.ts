import { createSkillImprovementDraft } from "../ai_os/services/skillWorkbench";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { readListingAggregation } from "./aggregationStore";
import { mutateResearchManaged } from "./researchManagedStore";
import { imagePlanningSources, planningVisuals } from "./imagePlanningSources";
import { planningModelSources } from "./imagePlanningContext";
import { ensureResearchAgent, researchAgentContext } from "./researchAgent";
import { RESEARCH_SKILLS } from "./researchPrompts";
import { assistantConfigurationService } from "../ai_os/services/assistantConfigurations";
import { runCompetitorSkill } from "./runCompetitorSkill";
import { safeParseSkillJSON } from "../ai_os/services/skillRunner";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
  getAiJobRun,
} from "../../services/aiJobRunner";
import {
  markBusinessManagedNodeRunning,
  markBusinessManagedNodeConfirmed,
  markBusinessManagedNodeFailed,
} from "../ai_os/services/businessManagedAgent";
import type { PlanningScope } from "./imagePlanningStore";
const conversation = (): NonNullable<
  import("../../../shared/listingAggregation").ListingAggregation["planningConversation"]
> => ({
  epoch: randomUUID(),
  revision: 0,
  messages: [] as Array<{
    id: string;
    role: "user" | "assistant";
    text: string;
    createdAt: string;
  }>,
  opened: false,
  jobRunId: null as string | null,
});
export async function briefingStatus(scope: PlanningScope) {
  const current =
    (await readListingAggregation(scope)).data.planningConversation ||
    conversation();
  const job = current.jobRunId ? await getAiJobRun(current.jobRunId) : null;
  const owned =
    job?.projectId === scope.projectId &&
    job?.workspaceId === scope.workspaceId &&
    job?.userId === scope.userId;
  return {
    ...current,
    job: owned
      ? {
          status: job!.status,
          error: ["failed", "canceled"].includes(job!.status)
            ? "本次对话未完成，已保留之前的交流，可重试。"
            : null,
        }
      : null,
  };
}
export async function startBriefing(
  scope: PlanningScope,
  message: string,
  opener = false
) {
  const configured = await assistantConfigurationService.get(
    scope.workspaceId,
    "images"
  );
  if (configured.status !== "configured" || !configured.record.config.enabled)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先启用图片策划助手",
    });
  const agent = await ensureResearchAgent(scope, "planning");
  return mutateResearchManaged(scope, "planning", async data => {
    const current = data.planningConversation || conversation();
    if (current.jobRunId) {
      const previous = await getAiJobRun(current.jobRunId);
      if (previous && ["queued", "running"].includes(previous.status))
        return { runId: previous.runId };
    }
    if (opener && current.opened && current.messages.length)
      return { runId: current.jobRunId };
    if (!opener && !message.trim())
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "请填写想讨论的内容",
      });
    if (current.messages.length >= 298)
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "本项目对话已较长，请保存需要的信息后清空，再开始新讨论",
      });
    if (!opener)
      current.messages.push({
        id: randomUUID(),
        role: "user",
        text: message.trim(),
        createdAt: new Date().toISOString(),
      });
    current.opened = true;
    current.revision++;
    delete current.error;
    const job = await startRegisteredAiJob({
      runId: "image-briefing-" + randomUUID(),
      kind: "listing.images.briefing",
      module: "listing",
      procedure: "imagePlanning.briefing",
      workspaceId: scope.workspaceId,
      userId: scope.userId,
      projectId: scope.projectId,
      skillSlug: RESEARCH_SKILLS.planning,
      queueName: "analysis",
      timeoutSeconds: 600,
      maxAttempts: 1,
      input: {
        ...scope,
        ...agent,
        agentRunId:agent.agentRunId,
        agentNodeId:agent.agentNodeId,
        epoch: current.epoch,
        revision: current.revision,
        opener,
        modelSlug: configured.record.config.modelSlug,
      },
    });
    current.jobRunId = job.runId;
    data.planningConversation = current;
    return { runId: job.runId };
  });
}
export async function clearBriefing(scope: PlanningScope) {
  return mutateResearchManaged(scope, "planning", async data => {
    data.planningConversation = conversation();
    return { cleared: true };
  });
}
registerAiJobHandler({
  id: "listing-image-briefing",
  match: job => job.kind === "listing.images.briefing",
  handler: async (job, { signal }) => {
    const scope = {
        projectId: job.projectId!,
        workspaceId: job.workspaceId!,
        userId: job.userId!,
      },
      input = job.input as any;
    const agent = await researchAgentContext(
        scope,
        input.agentRunId,
        "planning"
      ),
      tracking = { ...agent, aiJobRunId: job.runId, aiJobAttempt: job.attempt };
    await markBusinessManagedNodeRunning(tracking);
    try {
      const current = (
        await mutateResearchManaged(
          scope,
          "planning",
          async data => data.planningConversation,
          { readOnly: true }
        )
      ).result;
      if (
        !current ||
        current.epoch !== input.epoch ||
        current.revision !== input.revision ||
        current.jobRunId !== job.runId
      )
        throw new Error("对话已变化，本次回复不再写入");
      const sources = await imagePlanningSources(scope),
        visuals = await planningVisuals(scope);
      const context = JSON.stringify({
        upstream: planningModelSources(sources.input),
        history: current.messages,
        opener: input.opener,
        request: input.opener
          ? "请主动开场，用约300–500字中文，先简述对本品的理解与买家主要关注，再说明主图/附图和A+的表达重点、建议风格与配色，最后问运营有什么想法和建议。最多4个短段落，不展开逐张大纲，不罗列大量数字或追问；依据已保存本品事实，不虚构优势。"
          : "回应运营的最新问题，结合完整对话继续策划",
        visualEvidence: visuals.images,
      });
      const result = await runCompetitorSkill({
        skillSlug: RESEARCH_SKILLS.planning,
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        projectId: scope.projectId,
        modelOverride: input.modelSlug,
        context,
        variables: { context },
        signal,
        attachments: visuals.attachments,
        validate: text =>
          z
            .object({ reply: z.string().trim().min(1).max(12000) })
            .parse(safeParseSkillJSON(text)),
      });
      signal.throwIfAborted();
      await mutateResearchManaged(scope, "planning", async data => {
        const c = data.planningConversation;
        if (
          !c ||
          c.epoch !== input.epoch ||
          c.revision !== input.revision ||
          c.jobRunId !== job.runId
        )
          throw new Error("对话已变化，本次回复不再写入");
        c.messages.push({
          id: randomUUID(),
          role: "assistant",
          text: result.parsed.reply,
          createdAt: new Date().toISOString(),
        });
        c.revision++;
        return { saved: true };
      });
      await markBusinessManagedNodeConfirmed({
        ...tracking,
        output: { reply: result.parsed.reply },
      });
      return { saved: true, reply: result.parsed.reply, input: context };
    } catch (error) {
      await markBusinessManagedNodeFailed({
        ...tracking,
        finalAttempt: true,
        errorMessage: "图片策划对话未完成",
      }).catch(() => null);
      throw error;
    }
  },
});

export async function improveBriefing(scope: PlanningScope, feedback: string) {
  const current = (await readListingAggregation(scope)).data
    .planningConversation;
  const job = current?.jobRunId ? await getAiJobRun(current.jobRunId) : null;
  if (
    !current ||
    !job ||
    job.status !== "succeeded" ||
    job.projectId !== scope.projectId ||
    job.workspaceId !== scope.workspaceId ||
    job.userId !== scope.userId ||
    !(job.output as any)?.input
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "请先完成一次策划对话",
    });
  const output = job.output as { input: string; reply: string },
    context = JSON.stringify({
      businessModule: "listing",
      sourceResultId: job.runId,
      projectId: scope.projectId,
      input: JSON.parse(output.input),
      originalResult: output.reply,
      editedResult:
        current.messages.filter(m => m.role === "assistant").at(-1)?.text ||
        output.reply,
      feedback,
      history: current.messages,
      targetType: "skill",
      targetKey: RESEARCH_SKILLS.planning,
      scope: "current_result",
    });
  if (context.length > 120000)
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "本次对话资料较多，请缩小改进范围后提交",
    });
  return mutateResearchManaged(scope, "planning", async (_data, tx) => {
    const draft = await createSkillImprovementDraft(
      {
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        admin: ["admin", "super_admin"].includes(scope.role || ""),
        superAdmin: scope.role === "super_admin",
      },
      RESEARCH_SKILLS.planning,
      randomUUID(),
      { context, productId: null },
      tx
    );
    return { id: draft.id };
  });
}
