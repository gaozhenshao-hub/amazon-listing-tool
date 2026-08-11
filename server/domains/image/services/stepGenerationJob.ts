import { z } from "zod";

import {
  APLUS_MODULE_STYLE_GUIDE,
  buildImageWorkflowContext,
  callImageWorkflowSkill,
  getKBReference,
  invokeBusinessSkill,
  normalizeImageOutline,
  parseLLMJson,
} from "../routerContext";
import {
  STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT,
  STEP0_COMPETITOR_SUMMARY_PROMPT,
  STEP1_SELLING_POINTS_PROMPT,
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP3_STYLE_PROMPT,
} from "../../../imageWorkflowPrompts";
import {
  cancelAiJob,
  createAiJobRun,
  listAiJobRunsForUser,
  registerAiJobHandler,
  scheduleAiJobRun,
  updateAiJobProgress,
  type AiJobHandlerContext,
  type AiJobSnapshot,
} from "../../ai_os/services/jobRunner";
import { hydrateImageWorkflowSessionFromArtifacts } from "../../ai_os/services/businessArtifactRegistry";
import * as db from "../repository";
import { devDb, kbDb } from "../repository";
import {
  syncStepJobFailedToAgent,
  syncStepJobQueuedToAgent,
  syncStepJobRunningToAgent,
  syncStepJobWaitingHumanToAgent,
  ensureImageWorkflowAgentRun,
  imageWorkflowSkillNodeId,
} from "../imageWorkflowAgentBridge";

export const IMAGE_GENERATION_STEPS = [0, 1, 2, 3] as const;
export type ImageGenerationStep = (typeof IMAGE_GENERATION_STEPS)[number];

const STEP_CONFIG: Record<ImageGenerationStep, { kind: string; skillSlug: string; label: string }> = {
  0: { kind: "image.step0.generation", skillSlug: "image.step0.competitor.analysis", label: "竞品图片分析" },
  1: { kind: "image.step1.generation", skillSlug: "image.step1.sellingpoints", label: "卖点梳理" },
  2: { kind: "image.step2.generation", skillSlug: "image.step2.outline", label: "图片大纲" },
  3: { kind: "image.step3.generation", skillSlug: "image.step3.style", label: "风格推荐" },
};

const JOB_MODULE = "imageWorkflow";

export const imageStepGenerationJobInput = z.object({
  projectId: z.number().int().positive(),
  sessionId: z.number().int().positive(),
  step: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
  agentRunId: z.string().max(80).optional(),
  agentNodeId: z.string().max(80).optional(),
});

function compactText(value: unknown, maxChars: number) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;
  const tailChars = Math.min(1_500, Math.floor(maxChars * 0.2));
  return `${text.slice(0, maxChars - tailChars)}\n\n[上下文已压缩，省略${text.length - maxChars}字符]\n\n${text.slice(-tailChars)}`;
}

function assertNotCanceled(context: AiJobHandlerContext, label: string) {
  if (context.signal.aborted) throw new Error(`${label}任务已取消`);
}

function normalizeJobError(error: unknown, label: string) {
  const message = error instanceof Error ? error.message : String(error || `${label}失败`);
  if (/<!doctype\s+html|<html[\s>]/i.test(message)) {
    return new Error("上游模型服务返回了异常页面，系统将按任务重试策略自动重试");
  }
  return error instanceof Error ? error : new Error(message);
}

export async function getLatestImageStepGenerationJob(
  userId: number,
  projectId: number,
  step: ImageGenerationStep,
) {
  const jobs = await listAiJobRunsForUser(userId, { module: JOB_MODULE, projectId, limit: 60 });
  return jobs.find((job) => job.kind === STEP_CONFIG[step].kind) || null;
}

async function reportProgress(job: AiJobSnapshot, step: ImageGenerationStep, progress: number, agentRunId?: string | null) {
  await updateAiJobProgress(job.runId, progress, { expectedAttempt: job.attempt });
  await syncStepJobRunningToAgent({
    agentRunId,
    stepNumber: step,
    projectId: Number(job.projectId),
    userId: job.userId,
    workspaceId: job.workspaceId,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
    aiJobMaxAttempts: job.maxAttempts,
    progress,
  });
}

async function generateStep0(job: AiJobSnapshot, context: AiJobHandlerContext, project: any) {
  const input = imageStepGenerationJobInput.parse(job.input);
  const groups = await db.getExpressionGroupsByProject(input.projectId);
  const analyzableGroups = groups.filter((group: any) => Array.isArray(group.images) && group.images.length > 0);
  if (analyzableGroups.length === 0) throw new Error("请先创建至少一个表达方向并上传竞品图片");

  const analyses: Array<{ group: any; result: any }> = [];
  for (let index = 0; index < analyzableGroups.length; index += 1) {
    assertNotCanceled(context, STEP_CONFIG[0].label);
    const group = analyzableGroups[index];
    const content: any[] = [{
      type: "text",
      text: `请分析以下${group.images.length}张竞品图片，它们属于同一卖点表达方向：「${group.expressionName}」。请从构图方式、配色方案、卖点表达方式、亮点等维度综合分析，并输出JSON。`,
    }];
    for (const image of group.images) {
      content.push({ type: "image_url", image_url: { url: image.imageUrl, detail: "high" } });
      content.push({ type: "text", text: `竞品: ${image.competitorName || "未知"}` });
    }
    const response = await invokeBusinessSkill({
      messages: [
        { role: "system", content: STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT },
        { role: "user", content },
      ],
      response_format: { type: "json_object" },
      signal: context.signal,
      emperorSkill: {
        slug: "image.step0.competitor.analysis",
        userId: job.userId,
        workspaceId: job.workspaceId,
        context: `项目: ${project.productName || project.name}; 表达方向: ${group.expressionName}`,
        migrationSource: "server/imageWorkflowPrompts.ts",
      },
    });
    const result = parseLLMJson(response);
    if (!result || result.raw) throw new Error(`表达方向“${group.expressionName}”未返回有效JSON`);
    assertNotCanceled(context, STEP_CONFIG[0].label);
    const latestJob = await getLatestImageStepGenerationJob(job.userId, input.projectId, 0);
    if (!latestJob || latestJob.runId !== job.runId) return { skipped: true, reason: "A newer Step 0 job exists" };
    await db.updateExpressionGroup(group.id, { aiAnalysis: JSON.stringify(result) });
    analyses.push({ group, result });
    await reportProgress(job, 0, 15 + Math.floor(((index + 1) / analyzableGroups.length) * 55), input.agentRunId);
  }

  const summaryContext = analyses.map(({ group, result }) => {
    const selected = group.userEdit || JSON.stringify(result);
    return `表达方向: ${group.expressionName}\n分析: ${compactText(selected, 4_000)}`;
  }).join("\n\n");
  return callImageWorkflowSkill({
    skillSlug: "image.step0.competitor.summary",
    userId: job.userId,
    workspaceId: job.workspaceId,
    systemPrompt: STEP0_COMPETITOR_SUMMARY_PROMPT,
    context: `产品: ${project.productName || project.name}\n类目: ${project.category || "未指定"}\n\n${compactText(summaryContext, 18_000)}`,
    signal: context.signal,
    maxModelAttempts: 3,
    validate: (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("竞品图片总结格式无效");
      return value;
    },
  });
}

async function generateStep1(job: AiJobSnapshot, context: AiJobHandlerContext, project: any) {
  const productContext = compactText(await buildImageWorkflowContext(Number(job.projectId)), 18_000);
  const contextHint = productContext || "暂无竞品、评论或关键词数据。请根据产品名称、品牌和类目，结合亚马逊运营经验生成完整卖点体系。";
  return callImageWorkflowSkill({
    skillSlug: "image.step1.sellingpoints",
    userId: job.userId,
    workspaceId: job.workspaceId,
    systemPrompt: STEP1_SELLING_POINTS_PROMPT,
    context: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || "未指定"}\n类目: ${project.category || "未指定"}\n\n${contextHint}`,
    signal: context.signal,
    maxModelAttempts: 3,
    validate: (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("卖点梳理结果格式无效");
      return value;
    },
  });
}

async function generateStep2(job: AiJobSnapshot, context: AiJobHandlerContext, project: any, session: any) {
  if (!session.step1Confirmed) throw new Error("请先确认 Step 1 卖点梳理");
  const sellingPoints = compactText(session.step1UserEdit || session.step1AiResult, 8_000);
  const productContext = compactText(await buildImageWorkflowContext(Number(job.projectId)), 12_000);
  const step0Summary = session.step0AiResult
    ? `\n\n--- 竞品图片分析总结 ---\n${compactText(session.step0AiResult, 3_000)}`
    : "";
  const contextHint = productContext || "暂无竞品分析数据。请根据产品名称、品牌和类目生成完整图片大纲。";
  const prompt = `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || "未指定"}\n类目: ${project.category || "未指定"}\n\n--- 已确认的卖点体系 ---\n${sellingPoints}\n\n--- 产品背景信息 ---\n${contextHint}${step0Summary}\n\n--- 可选亚马逊A+模块样式 ---\n${APLUS_MODULE_STYLE_GUIDE}\n\n请根据以上卖点体系和竞品分析规划图片大纲。secondaryImages必须恰好生成6项，imageNumber依次为2、3、4、5、6、7，并在referenceHighlights中引用竞品亮点。首次生成时所有A+模块一律使用premium_full_image（高级完整图片、1464x600px、单张全宽大图），不要自行选择其他模块；用户改选后会通过专用皇帝Skill单独重新优化。`;
  return callImageWorkflowSkill({
    skillSlug: "image.step2.outline",
    userId: job.userId,
    workspaceId: job.workspaceId,
    systemPrompt: STEP2_IMAGE_OUTLINE_PROMPT,
    context: prompt,
    signal: context.signal,
    maxModelAttempts: 3,
    validate: (value) => {
      const rawImages = Array.isArray(value?.secondaryImages) ? value.secondaryImages : [];
      const substantive = rawImages.filter((image: any) => String(image?.purpose || "").trim() || String(image?.contentBrief || "").trim());
      const imageNumbers = new Set(substantive.map((image: any) => Number(image?.imageNumber)).filter((value: number) => value >= 2 && value <= 7));
      if (substantive.length < 5 || imageNumbers.size < 5) throw new Error("图片大纲必须完整包含辅图2-7");
      const normalized = normalizeImageOutline(value, { forceDefaultAplus: true, recoverMissingSecondaryContent: true });
      const incomplete = normalized.secondaryImages.find((image: any) => !String(image?.purpose || "").trim() || !String(image?.contentBrief || "").trim());
      if (incomplete) throw new Error(`图片大纲缺少辅图${incomplete.imageNumber}的完整内容`);
      return normalized;
    },
  });
}

async function generateStep3(job: AiJobSnapshot, context: AiJobHandlerContext, project: any, session: any) {
  if (!session.step2Confirmed) throw new Error("请先确认 Step 2 图片大纲");
  const profile = await devDb.getDevProductProfile(Number(job.projectId));
  const colorInfo = profile?.appearanceColors ? `产品外观颜色: ${profile.appearanceColors}` : "";
  const kbReference = compactText(await getKBReference(project.category || "", job.userId), 2_000);
  let kbStylesText = "";
  try {
    const images = await kbDb.listAllImages(job.userId, "all", { tagCategory: project.category || undefined });
    const styles = [...new Set((images as any[]).map((image) => image.tagDesignStyleV2 || image.tagDesignStyle).filter(Boolean))].slice(0, 50);
    if (styles.length) kbStylesText = `\n\n--- 知识库现有设计风格（请优先推荐）---\n${styles.join("、")}`;
  } catch (error) {
    console.warn("[Image Step 3] Failed to load knowledge-base styles:", error);
  }
  const step2 = compactText(session.step2UserEdit || session.step2AiResult, 8_000);
  const step1 = compactText(session.step1UserEdit || session.step1AiResult, 3_000);
  return callImageWorkflowSkill({
    skillSlug: "image.step3.style",
    userId: job.userId,
    workspaceId: job.workspaceId,
    systemPrompt: STEP3_STYLE_PROMPT,
    context: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || "未指定"}\n类目: ${project.category || "未指定"}\n${colorInfo}\n\n--- 已确认的卖点 ---\n${step1}\n\n--- 已确认的图片大纲 ---\n${step2}${kbReference}${kbStylesText}\n\n请参考知识库中同类目高分图片的风格分布，推荐3-4个适合的视觉风格方案。`,
    signal: context.signal,
    maxModelAttempts: 3,
    validate: (value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("风格推荐结果格式无效");
      return value;
    },
  });
}

export async function runImageStepGenerationJob(job: AiJobSnapshot, context: AiJobHandlerContext) {
  const input = imageStepGenerationJobInput.parse(job.input);
  const project = await db.getProjectByIdAdmin(input.projectId);
  if (!project) throw new Error("项目不存在");
  const storedSession = await db.getImageWorkflowSessionById(input.sessionId);
  if (!storedSession || storedSession.projectId !== input.projectId) throw new Error("图片建议工作流不存在");
  if (Number(storedSession[`step${input.step}Confirmed` as keyof typeof storedSession] || 0) === 1) {
    throw new Error(`Step ${input.step} 已确认，请先解锁后再重新生成`);
  }
  const session = await hydrateImageWorkflowSessionFromArtifacts(storedSession, {
    consumerType: "ai_job",
    consumerId: job.runId,
    runId: input.agentRunId || null,
    nodeId: `step${input.step}_skill`,
  }, { onlyBusinessConfirmedSteps: true });

  await reportProgress(job, input.step, 15, input.agentRunId);
  let result: any;
  try {
    if (input.step === 0) result = await generateStep0(job, context, project);
    else if (input.step === 1) result = await generateStep1(job, context, project);
    else if (input.step === 2) result = await generateStep2(job, context, project, session);
    else result = await generateStep3(job, context, project, session);
  } catch (error) {
    throw normalizeJobError(error, STEP_CONFIG[input.step].label);
  }
  if (result?.skipped) return result;
  assertNotCanceled(context, STEP_CONFIG[input.step].label);
  const latestJob = await getLatestImageStepGenerationJob(job.userId, input.projectId, input.step);
  if (!latestJob || latestJob.runId !== job.runId) return { skipped: true, reason: `A newer Step ${input.step} job exists` };
  const latestSession = await db.getImageWorkflowSessionById(input.sessionId);
  if (!latestSession || Number(latestSession[`step${input.step}Confirmed` as keyof typeof latestSession] || 0) === 1) {
    return { skipped: true, reason: `Step ${input.step} session is no longer writable` };
  }
  await reportProgress(job, input.step, 90, input.agentRunId);
  await db.updateImageWorkflowSession(input.sessionId, {
    [`step${input.step}AiResult`]: JSON.stringify(result),
    currentStep: input.step,
  });
  return result;
}

export async function startImageStepGenerationJob(input: {
  projectId: number;
  sessionId: number;
  step: ImageGenerationStep;
  userId: number;
  workspaceId?: number | null;
  agentRunId?: string | null;
}) {
  const active = await getLatestImageStepGenerationJob(input.userId, input.projectId, input.step);
  if (active?.status === "queued" || active?.status === "running") {
    const sync = active.status === "running" ? syncStepJobRunningToAgent : syncStepJobQueuedToAgent;
    await sync({
      agentRunId: input.agentRunId,
      stepNumber: input.step,
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      aiJobRunId: active.runId,
      aiJobAttempt: active.attempt,
      aiJobMaxAttempts: active.maxAttempts,
      progress: active.progress,
    });
    return active;
  }
  const config = STEP_CONFIG[input.step];
  const agentRunId = input.agentRunId || await ensureImageWorkflowAgentRun({
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
  });
  if (!agentRunId) throw new Error("图片工作流无法创建 Agent Run，任务未入队");
  const job = await createAiJobRun({
    kind: config.kind,
    module: JOB_MODULE,
    procedure: "imageWorkflow.startStepGeneration",
    workspaceId: input.workspaceId ?? null,
    userId: input.userId,
    projectId: input.projectId,
    skillSlug: config.skillSlug,
    input: {
      projectId: input.projectId,
      sessionId: input.sessionId,
      step: input.step,
      agentRunId,
      agentNodeId: imageWorkflowSkillNodeId(input.step),
    },
    progress: 5,
    maxAttempts: 3,
    timeoutSeconds: 20 * 60,
  });
  await syncStepJobQueuedToAgent({
    agentRunId,
    stepNumber: input.step,
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: input.workspaceId,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
    aiJobMaxAttempts: job.maxAttempts,
    progress: job.progress,
  });
  try {
    await scheduleAiJobRun(job.runId);
  } catch (error) {
    await cancelAiJob(job.runId, `${config.label}任务调度失败`).catch(() => null);
    await syncStepJobFailedToAgent({
      agentRunId,
      stepNumber: input.step,
      projectId: input.projectId,
      userId: input.userId,
      workspaceId: input.workspaceId,
      aiJobRunId: job.runId,
      aiJobAttempt: job.attempt,
      aiJobMaxAttempts: job.maxAttempts,
      errorMessage: error instanceof Error ? error.message : String(error || "任务调度失败"),
      finalAttempt: true,
      failureKind: "error",
    });
    throw error;
  }
  return job;
}

export async function cancelImageStepGenerationJob(input: {
  userId: number;
  projectId: number;
  step: ImageGenerationStep;
  agentRunId?: string | null;
}) {
  const job = await getLatestImageStepGenerationJob(input.userId, input.projectId, input.step);
  if (!job || (job.status !== "queued" && job.status !== "running")) return job;
  const canceled = await cancelAiJob(job.runId, `用户取消 Step ${input.step} ${STEP_CONFIG[input.step].label}`);
  await syncStepJobFailedToAgent({
    agentRunId: input.agentRunId,
    stepNumber: input.step,
    projectId: input.projectId,
    userId: input.userId,
    workspaceId: job.workspaceId,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
    aiJobMaxAttempts: job.maxAttempts,
    errorMessage: canceled?.error || "任务已取消",
    finalAttempt: true,
    failureKind: "cancel",
  });
  return canceled;
}

registerAiJobHandler({
  id: "imageWorkflow.stepGeneration0To3",
  match: (job) => Object.values(STEP_CONFIG).some((config) => config.kind === job.kind),
  handler: async (job, context) => {
    const input = imageStepGenerationJobInput.parse(job.input);
    const storedSession = input.agentRunId ? null : await db.getImageWorkflowSessionById(input.sessionId).catch(() => null);
    const syncInput = {
      agentRunId: input.agentRunId || storedSession?.agentRunId || null,
      stepNumber: input.step,
      projectId: input.projectId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      aiJobRunId: job.runId,
      aiJobAttempt: job.attempt,
      aiJobMaxAttempts: job.maxAttempts,
    };
    await syncStepJobRunningToAgent({ ...syncInput, progress: 15 });
    try {
      const result = await runImageStepGenerationJob(job, context);
      if (!result?.skipped) await syncStepJobWaitingHumanToAgent({ ...syncInput, output: result });
      return result;
    } catch (error) {
      const abortReason = context.signal.aborted ? String(context.signal.reason || "") : "";
      const timeout = /timed?\s*out|timeout/i.test(abortReason);
      const finalAttempt = job.attempt >= job.maxAttempts || (context.signal.aborted && !timeout);
      await syncStepJobFailedToAgent({
        ...syncInput,
        finalAttempt,
        errorMessage: error instanceof Error ? error.message : String(error || "图片工作流任务失败"),
        failureKind: context.signal.aborted ? (timeout ? "timeout" : "cancel") : "error",
      });
      throw error;
    }
  },
});
