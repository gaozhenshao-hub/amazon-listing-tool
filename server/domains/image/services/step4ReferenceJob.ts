import { z } from "zod";
import { STEP4_REFERENCE_PROMPT } from "../../../imageWorkflowPrompts";
import {
  createAiJobRun,
  listAiJobRunsForUser,
  registerAiJobHandler,
  scheduleAiJobRun,
  type AiJobSnapshot,
  type AiJobHandlerContext,
} from "../../ai_os/services/jobRunner";
import * as db from "../repository";
import { kbDb } from "../repository";
import { callImageWorkflowSkill } from "../routerContext";
import {
  syncStepJobFailedToAgent,
  syncStepJobQueuedToAgent,
  syncStepJobRunningToAgent,
  syncStepJobWaitingHumanToAgent,
  ensureImageWorkflowAgentRun,
  imageWorkflowSkillNodeId,
} from "../imageWorkflowAgentBridge";

const STEP4_JOB_KIND = "image.step4.reference";
const STEP4_JOB_MODULE = "imageWorkflow";

export const step4ReferenceJobInput = z.object({
  projectId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  agentRunId: z.string().max(80).optional(),
  agentNodeId: z.string().max(80).optional(),
});

function compactPromptText(value: unknown, maxChars: number) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;

  const tailChars = Math.min(1_500, Math.floor(maxChars * 0.2));
  const headChars = maxChars - tailChars;
  return `${text.slice(0, headChars)}\n\n[上下文已压缩，省略${text.length - maxChars}字符]\n\n${text.slice(-tailChars)}`;
}

function normalizeStep4JobError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "参考图推荐失败");
  if (/<!doctype\s+html|<html[\s>]/i.test(message)) {
    return new Error("上游模型服务返回了异常页面，系统将按任务重试策略自动重试");
  }
  return error instanceof Error ? error : new Error(message);
}

export function validateStep4ReferenceResult(value: any) {
  const references = Array.isArray(value?.imageReferences) ? value.imageReferences : [];
  const secondaryNumbers = new Set(
    references
      .filter((reference: any) => !String(reference?.imageType || "").toLowerCase().includes("a+"))
      .map((reference: any) => Number(reference?.imageNumber)),
  );
  const missingNumbers = [2, 3, 4, 5, 6, 7].filter((imageNumber) => !secondaryNumbers.has(imageNumber));
  if (missingNumbers.length > 0) {
    throw new Error(`构图参考必须完整覆盖辅图2-7，当前缺少辅图: ${missingNumbers.join(", ")}`);
  }
  return value;
}

export async function getLatestStep4ReferenceJob(userId: number, projectId: number) {
  const jobs = await listAiJobRunsForUser(userId, {
    module: STEP4_JOB_MODULE,
    projectId,
    limit: 20,
  });
  return jobs.find((job) => job.kind === STEP4_JOB_KIND) || null;
}

export async function buildStep4ReferenceRecommendation(input: {
  project: any;
  session: any;
  userId: number;
  workspaceId?: number | null;
}) {
  let kbImageInfo = "";
  try {
    const kbImages = await kbDb.listAllImages(input.userId, "mine", {});
    if (kbImages.length > 0) {
      const rows = kbImages.slice(0, 20).map((image: any) =>
        `[${image.tagImageType || "未分类"}] ${image.tagCategory || ""} - ${image.tagDesignStyle || ""} (${image.imagePosition || ""})`,
      );
      kbImageInfo = `\n--- 知识库图片参考 ---\n${rows.join("\n")}`;
    }
  } catch (error) {
    console.warn("[Image Step 4] Failed to load knowledge-base references:", error);
  }

  const outline = compactPromptText(input.session.step2UserEdit || input.session.step2AiResult, 9_000);
  const style = compactPromptText(input.session.step3UserEdit || input.session.step3AiResult, 6_000);
  const context = `产品名称: ${input.project.productName || input.project.name}\n品牌: ${input.project.brand || "未指定"}\n类目: ${input.project.category || "未指定"}\n\n--- 已确认的图片大纲 ---\n${outline}\n\n--- 已确认的风格方案 ---\n${style}\n${kbImageInfo}\n\n请为主图、全部辅图2-7和每个A+模块推荐构图参考和效果图参考，不得遗漏辅图7。若图片大纲中的A+模块包含selectedModuleType/selectedModuleName/selectedModuleStructure，必须按该模块结构生成参考：轮播模块拆成每个面板的构图/效果参考，四图模块拆成4张子图，热点模块包含底图和各热点位置，比较表模块包含产品列和特征行布局。`;

  return callImageWorkflowSkill({
    skillSlug: "image.step4.reference",
    userId: input.userId,
    workspaceId: input.workspaceId ?? input.project.workspaceId ?? null,
    systemPrompt: STEP4_REFERENCE_PROMPT,
    context,
    maxModelAttempts: 3,
    validate: validateStep4ReferenceResult,
  });
}

export async function startStep4ReferenceJob(input: {
  projectId: number;
  sessionId: number;
  userId: number;
  workspaceId?: number | null;
  agentRunId?: string | null;
}) {
  const activeJob = await getLatestStep4ReferenceJob(input.userId, input.projectId);
  if (activeJob?.status === "queued" || activeJob?.status === "running") {
    const syncActiveJob = activeJob.status === "running"
      ? syncStepJobRunningToAgent
      : syncStepJobQueuedToAgent;
    await syncActiveJob({
      agentRunId: input.agentRunId,
      stepNumber: 4,
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      aiJobRunId: activeJob.runId,
      aiJobAttempt: activeJob.attempt,
      aiJobMaxAttempts: activeJob.maxAttempts,
      progress: activeJob.progress,
    });
    return activeJob;
  }

  const agentRunId = input.agentRunId || await ensureImageWorkflowAgentRun({
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
  if (!agentRunId) throw new Error("图片工作流无法创建 Agent Run，参考图任务未入队");

  const job = await createAiJobRun({
    kind: STEP4_JOB_KIND,
    module: STEP4_JOB_MODULE,
    procedure: "imageWorkflow.startStep4Generation",
    workspaceId: input.workspaceId ?? null,
    userId: input.userId,
    projectId: input.projectId,
    skillSlug: "image.step4.reference",
    input: {
      projectId: input.projectId,
      sessionId: input.sessionId,
      agentRunId,
      agentNodeId: imageWorkflowSkillNodeId(4),
    },
    progress: 5,
    maxAttempts: 3,
    timeoutSeconds: 15 * 60,
  });
  await syncStepJobQueuedToAgent({
    agentRunId,
    stepNumber: 4,
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
    aiJobMaxAttempts: job.maxAttempts,
    progress: job.progress,
  });
  await scheduleAiJobRun(job.runId);
  return job;
}

export async function runStep4ReferenceJob(
  job: AiJobSnapshot,
  context: AiJobHandlerContext,
) {
  const input = step4ReferenceJobInput.parse(job.input);
  const project = await db.getProjectByIdAdmin(input.projectId);
  if (!project) throw new Error("Project not found");
  const session = await db.getImageWorkflowSessionById(input.sessionId);
  if (!session || session.projectId !== input.projectId) throw new Error("No workflow session found");
  if (!session.step3Confirmed) throw new Error("Step 3 not confirmed yet");

  let result: any;
  try {
    result = await buildStep4ReferenceRecommendation({
      project,
      session,
      userId: job.userId,
      workspaceId: job.workspaceId,
    });
  } catch (error) {
    throw normalizeStep4JobError(error);
  }
  if (context.signal.aborted) throw new Error("参考图推荐任务已取消");

  const latestJob = await getLatestStep4ReferenceJob(job.userId, input.projectId);
  if (!latestJob || latestJob.runId !== job.runId) {
    return { skipped: true, reason: "A newer Step 4 recommendation job exists" };
  }
  const latestSession = await db.getImageWorkflowSessionById(input.sessionId);
  if (!latestSession || latestSession.step4Confirmed) {
    return { skipped: true, reason: "Step 4 session is no longer writable" };
  }

  await db.updateImageWorkflowSession(input.sessionId, {
    step4AiResult: JSON.stringify(result),
    currentStep: 4,
  });
  return result;
}

registerAiJobHandler({
  id: "imageWorkflow.step4Reference",
  match: (job) => job.kind === STEP4_JOB_KIND,
  handler: async (job, context) => {
    const input = step4ReferenceJobInput.parse(job.input);
    const fallbackSession = input.agentRunId
      ? null
      : await db.getImageWorkflowSessionById(input.sessionId).catch(() => null);
    const agentRunId = input.agentRunId || fallbackSession?.agentRunId || null;
    const syncInput = {
      agentRunId,
      stepNumber: 4,
      projectId: input.projectId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      aiJobRunId: job.runId,
      aiJobAttempt: job.attempt,
      aiJobMaxAttempts: job.maxAttempts,
    };

    await syncStepJobRunningToAgent({ ...syncInput, progress: 15 });
    try {
      const result = await runStep4ReferenceJob(job, context);
      if (!(result as any)?.skipped) {
        await syncStepJobWaitingHumanToAgent({ ...syncInput, output: result });
      }
      return result;
    } catch (error) {
      const abortReason = context.signal.aborted ? String(context.signal.reason || "") : "";
      const retryableTimeout = /timed?\s*out|timeout/i.test(abortReason);
      const finalAttempt = job.attempt >= job.maxAttempts || (context.signal.aborted && !retryableTimeout);
      await syncStepJobFailedToAgent({
        ...syncInput,
        finalAttempt,
        errorMessage: error instanceof Error ? error.message : String(error || "参考图推荐失败"),
        failureKind: context.signal.aborted ? (retryableTimeout ? "timeout" : "cancel") : "error",
      });
      throw error;
    }
  },
});
