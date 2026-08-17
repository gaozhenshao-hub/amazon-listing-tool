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
import { buildImageWorkflowReferenceTargets, normalizeImageOutline } from "@shared/imageWorkflow";
import { hydrateLockedImageWorkflowAplusSubmodules } from "../../ai_os/services/businessArtifactRegistry";
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

function buildStep4FallbackReference(target: any) {
  const isBrand = /品牌故事/.test(String(target?.imageType || ""));
  return {
    imageKey: target.imageKey,
    imageNumber: /A\+|品牌故事/.test(String(target?.imageType || "")) ? 0 : (target.imageNumber || 0),
    imageType: target.imageType,
    parentModuleNumber: target.parentModuleNumber ?? null,
    subModuleNumber: target.subModuleNumber ?? null,
    compositionReference: {
      compositionType: isBrand ? "品牌叙事横幅构图" : "基于大纲的重点构图",
      layout: "围绕当前图片大纲的核心目标组织产品、场景和说明元素",
      focalPoint: target.purpose || "突出当前模块的核心价值",
      visualFlow: "核心主体→关键信息→补充说明",
      elementRatio: "核心主体65%，说明元素20%，留白15%",
    },
    effectReference: {
      colorApplication: "继承当前确认的品牌主色、辅色与强调色，保证系列一致性",
      typographyApplication: "沿用整套图片的层级、字重和可读性规范",
      iconApplication: "仅使用服务于核心卖点的简洁图标",
      visualMood: "与当前确认风格保持一致的专业视觉氛围",
      lightingStyle: "与整套图片保持统一的产品与场景光线风格",
    },
    designNotes: "皇帝Skill未返回该目标的完整参考方案，系统已按当前大纲补齐可编辑基础方案；可对该图单独重新生成。",
    isBackfilledFromOutline: true,
  };
}

export function validateStep4ReferenceResult(value: any, referenceTargets?: any[]) {
  const rawReferences = Array.isArray(value?.imageReferences)
    ? value.imageReferences
    : Array.isArray(value?.references)
      ? value.references
      : [];
  const references = referenceTargets?.length
    ? referenceTargets.map((target) => {
        const targetType = String(target?.imageType || "");
        const matched = rawReferences.find((reference: any) => String(reference?.imageKey || "") === String(target?.imageKey || ""))
          || rawReferences.find((reference: any) =>
            String(reference?.parentModuleNumber ?? "") === String(target?.parentModuleNumber ?? "")
            && String(reference?.subModuleNumber ?? "") === String(target?.subModuleNumber ?? "")
            && String(reference?.imageType || "") === targetType,
          )
          || rawReferences.find((reference: any) =>
            !/A\+|品牌故事/.test(targetType)
            && Number(reference?.imageNumber) === Number(target?.imageNumber)
            && !/A\+|品牌故事/.test(String(reference?.imageType || "")),
          );
        return {
          ...buildStep4FallbackReference(target),
          ...(matched || {}),
          imageKey: target.imageKey,
          imageType: target.imageType,
          imageNumber: /A\+|品牌故事/.test(targetType) ? 0 : (target.imageNumber || 0),
          parentModuleNumber: target.parentModuleNumber ?? null,
          subModuleNumber: target.subModuleNumber ?? null,
        };
      })
    : rawReferences;
  const secondaryNumbers = new Set(
    references
      .filter((reference: any) => !String(reference?.imageType || "").toLowerCase().includes("a+"))
      .map((reference: any) => Number(reference?.imageNumber)),
  );
  const expectedSecondaryNumbers = referenceTargets?.length
    ? referenceTargets
        .filter((target: any) => !/A\+|品牌故事/.test(String(target?.imageType || "")))
        .map((target: any) => Number(target?.imageNumber))
        .filter((imageNumber) => imageNumber >= 2 && imageNumber <= 7)
    : [2, 3, 4, 5, 6, 7];
  const missingNumbers = expectedSecondaryNumbers.filter((imageNumber) => !secondaryNumbers.has(imageNumber));
  if (missingNumbers.length > 0) {
    throw new Error(`构图参考必须完整覆盖辅图2-7，当前缺少辅图: ${missingNumbers.join(", ")}`);
  }
  return {
    ...(value && typeof value === "object" ? value : {}),
    imageReferences: references,
  };
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

  const draftOutline = normalizeImageOutline(JSON.parse(input.session.step2UserEdit || input.session.step2AiResult || "{}"));
  const { outline: outlineData, consumedRefs } = await hydrateLockedImageWorkflowAplusSubmodules({
    sessionId: input.session.id,
    projectId: input.project.id,
    outline: draftOutline,
  });
  const outline = compactPromptText(JSON.stringify(outlineData), 9_000);
  const referenceTargets = buildImageWorkflowReferenceTargets(outlineData);
  const style = compactPromptText(input.session.step3UserEdit || input.session.step3AiResult, 6_000);
  const lockedAssetNote = consumedRefs.length ? `\n--- 已锁定A+子图资产 ---\n以下子图为用户确认版本，必须以其内容为准：${consumedRefs.join(", ")}` : "";
  const context = `产品名称: ${input.project.productName || input.project.name}\n品牌: ${input.project.brand || "未指定"}\n类目: ${input.project.category || "未指定"}\n\n--- 已确认的图片大纲 ---\n${outline}${lockedAssetNote}\n\n--- 已确认的风格方案 ---\n${style}\n${kbImageInfo}\n\n--- 必须逐项输出参考方案的图片目标 ---\n${JSON.stringify(referenceTargets)}\n\n请为每个目标生成一项 imageReferences，并原样保留 imageKey、imageNumber、imageType、parentModuleNumber 和 subModuleNumber。不得遗漏辅图2-7。A+多图模块的每张子图是独立目标，例如A+模块8的四张轮播图必须分别输出A+模块8.1、8.2、8.3、8.4的构图和效果参考。`;

  return callImageWorkflowSkill({
    skillSlug: "image.step4.reference",
    userId: input.userId,
    workspaceId: input.workspaceId ?? input.project.workspaceId ?? null,
    systemPrompt: STEP4_REFERENCE_PROMPT,
    context,
    maxModelAttempts: 3,
    validate: (value) => validateStep4ReferenceResult(value, referenceTargets),
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
