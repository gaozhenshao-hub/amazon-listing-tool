import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import { BadRequestError, NotFoundError } from "@shared/_core/errors";
import { ensureImageWorkflowAgentRun, syncStepConfirmToAgent, syncStepUnlockToAgent } from "../imageWorkflowAgentBridge";
import {
  buildStep4ReferenceRecommendation,
  getLatestStep4ReferenceJob,
  startStep4ReferenceJob,
} from "../services/step4ReferenceJob";
import {
  cancelImageStepGenerationJob,
  getLatestImageStepGenerationJob,
  startImageStepGenerationJob,
  type ImageGenerationStep,
} from "../services/stepGenerationJob";

const {
  APLUS_MODULE_STYLE_GUIDE,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
  STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT,
  STEP0_COMPETITOR_SUMMARY_PROMPT,
  STEP1_SELLING_POINTS_PROMPT,
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP2_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP3_STYLE_PROMPT,
  STEP4_REOPTIMIZE_WITH_REFS_PROMPT,
  STEP5_APLUS_COMBO_RECOMMEND_PROMPT,
  STEP5_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP5_FINAL_SUGGESTION_PROMPT,
  STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
  buildImageWorkflowContext,
  buildStep5FinalSuggestion,
  buildStep5RunSnapshot,
  callImageWorkflowSkill,
  callLLMWithRetry,
  db,
  devDb,
  ensureWriteAccess,
  generateStep5RunId,
  getKBReference,
  isActiveStep5Run,
  kbDb,
  parseStoredJson,
  applyImageWorkflowAplusStyle,
  findImageWorkflowAplusModule,
  normalizeImageOutline,
  persistStep5ListingAdvice,
  protectedProcedure,
  registerAiJobHandler,
  resolveProjectAccess,
  resolveSessionAccess,
  resolveSessionForExecution,
  router,
  runStep5GenerationJob,
  serializeStep5Error,
  startRegisteredAiJob,
  step5JobInput,
  storagePut,
  z,
} = shared;

function compactPromptText(value: unknown, maxChars: number) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;

  const tailChars = Math.min(1_500, Math.floor(maxChars * 0.2));
  const headChars = maxChars - tailChars;
  return `${text.slice(0, headChars)}\n\n[上下文已压缩，省略${text.length - maxChars}字符]\n\n${text.slice(-tailChars)}`;
}

async function startGenerationForRequest(input: {
  projectId: number;
  step: ImageGenerationStep;
  user: { id: number; role: string };
  workspaceId?: number | null;
}) {
  const project = await resolveProjectAccess(input.projectId, input.user);
  ensureWriteAccess(project, input.user);
  let session = await resolveSessionAccess(input.projectId, input.user);
  if (!session) {
    session = await db.createImageWorkflowSession({
      projectId: input.projectId,
      userId: input.user.id,
      currentStep: input.step,
    });
  }
  const agentRunId = session.agentRunId || await ensureImageWorkflowAgentRun({
    projectId: input.projectId,
    userId: input.user.id,
    workspaceId: input.workspaceId ?? null,
  });
  if (agentRunId && agentRunId !== session.agentRunId) {
    await db.updateImageWorkflowSession(session.id, { agentRunId });
  }
  return startImageStepGenerationJob({
    projectId: input.projectId,
    sessionId: session.id,
    step: input.step,
    userId: input.user.id,
    workspaceId: input.workspaceId,
    agentRunId,
  });
}

export const imageWorkflowStepProcedures = {

  startStepGeneration: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      step: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    }))
    .mutation(({ ctx, input }) => startGenerationForRequest({
      projectId: input.projectId,
      step: input.step,
      user: ctx.user,
      workspaceId: ctx.workspaceId,
    })),

  getStepGenerationRun: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      step: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    }))
    .query(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      return getLatestImageStepGenerationJob(ctx.user.id, input.projectId, input.step);
    }),

  cancelStepGeneration: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      step: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw NotFoundError("图片建议工作流不存在");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      return cancelImageStepGenerationJob({
        userId: ctx.user.id,
        projectId: input.projectId,
        step: input.step,
        agentRunId: session.agentRunId,
      });
    }),


  // ─── Step 1: Generate selling points ───────────────────────────
  generateStep1: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(({ ctx, input }) => startGenerationForRequest({
      projectId: input.projectId,
      step: 1,
      user: ctx.user,
      workspaceId: ctx.workspaceId,
    })),

  // ─── Step 1: Save user edits and confirm ───────────────────────
  confirmStep1: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(), // JSON string of edited selling points
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step1UserEdit: input.userEdit,
        step1Confirmed: 1,
        currentStep: 2,
      });
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 1,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: session.step1AiResult ? JSON.parse(session.step1AiResult) : null,
        userEdit: JSON.parse(input.userEdit),
      });
      return { success: true };
    }),


  // ─── Step 2: Generate image outline ────────────────────────────
  generateStep2: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(({ ctx, input }) => startGenerationForRequest({
      projectId: input.projectId,
      step: 2,
      user: ctx.user,
      workspaceId: ctx.workspaceId,
    })),


  // ─── Step 2: Save user edits and confirm ───────────────────────
  confirmStep2: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw NotFoundError("图片建议工作流不存在");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      let parsed: any;
      try {
        parsed = JSON.parse(input.userEdit);
      } catch {
        throw BadRequestError("图片大纲数据格式无效，请重新生成后再确认");
      }
      const normalized = normalizeImageOutline(parsed);
      const incompleteImage = normalized.secondaryImages.find((image: any) =>
        !String(image?.purpose || "").trim() || !String(image?.contentBrief || "").trim(),
      );
      if (incompleteImage) {
        throw BadRequestError(`请补全辅图${incompleteImage.imageNumber}的目的和内容后再确认`, {
          imageNumber: incompleteImage.imageNumber,
        });
      }

      await db.updateImageWorkflowSession(session.id, {
        step2UserEdit: JSON.stringify(normalized),
        step2Confirmed: 1,
        currentStep: 3,
      });
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 2,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: session.step2AiResult ? JSON.parse(session.step2AiResult) : null,
        userEdit: normalized,
      });
      return { success: true };
    }),


  // ─── Step 2: Re-optimize one A+ module after the user changes style ─
  optimizeStep2AplusModule: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      moduleIndex: z.number().int().min(0),
      moduleType: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step2.aplus.optimize:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");
      if (session.step2Confirmed) throw new Error("请先解锁图片大纲，再调整A+模块");

      const selectedModule = findImageWorkflowAplusModule(input.moduleType);
      if (!selectedModule) throw new Error("不支持的A+模块样式");

      const storedOutline = parseStoredJson(session.step2UserEdit || session.step2AiResult) as Record<string, any> | null;
      if (!storedOutline) throw new Error("请先生成图片大纲");
      const outline = normalizeImageOutline(storedOutline);
      const currentModule = outline.aPlusModules?.[input.moduleIndex];
      if (!currentModule) throw new Error("A+模块不存在");

      if (currentModule.selectedModuleType === selectedModule.id) {
        return { outline, module: currentModule };
      }

      const context = `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || "未指定"}\n类目: ${project.category || "未指定"}\n\n--- 已确认卖点体系 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 当前A+模块 ---\n${JSON.stringify(currentModule)}\n\n--- 用户选择的目标模块 ---\n${JSON.stringify(selectedModule)}\n\n请只按目标模块结构重新优化当前这一个A+模块。`;
      const optimized = await callImageWorkflowSkill({
        skillSlug: "image.step2.aplus.single.optimize",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
        systemPrompt: STEP2_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
        context,
        validate: (value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("A+模块优化结果无效");
          }
          return value;
        },
      });

      const mergedModule = {
        ...currentModule,
        ...optimized,
        moduleNumber: currentModule.moduleNumber ?? input.moduleIndex + 1,
        moduleOptimizedForType: selectedModule.id,
      };
      outline.aPlusModules[input.moduleIndex] = applyImageWorkflowAplusStyle(mergedModule, selectedModule.id);

      await db.updateImageWorkflowSession(session.id, {
        step2UserEdit: JSON.stringify(outline),
        currentStep: 2,
      });

      return { outline, module: outline.aPlusModules[input.moduleIndex] };
    }),


  // ─── Step 2: Unlock outline without deleting the current draft ──
  unlockStep2: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step2Confirmed: 0,
        currentStep: 2,
        step3AiResult: null,
        step3UserEdit: null,
        step3Confirmed: 0,
        step4AiResult: null,
        step4UserEdit: null,
        step4Confirmed: 0,
        step4CompositionRefs: null,
        step4EffectRefs: null,
        step5AiResult: null,
        step5AiResultCn: null,
        step5UserEdit: null,
        step5Confirmed: 0,
        step5RunId: null,
        step5RunStatus: "idle",
        step5RunProgress: 0,
        step5RunError: null,
        step5RunStartedAt: null,
        step5RunCompletedAt: null,
        step5SelectedModule: null,
        step5OptimizedResult: null,
        step5OptimizedResultCn: null,
        status: "in_progress",
      });

      void syncStepUnlockToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 2,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
      });

      return { success: true };
    }),


  // ─── Step 3: Generate style recommendations ───────────────────
  generateStep3: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(({ ctx, input }) => startGenerationForRequest({
      projectId: input.projectId,
      step: 3,
      user: ctx.user,
      workspaceId: ctx.workspaceId,
    })),


  // ─── Step 3: Save user selection and confirm ──────────────────
  confirmStep3: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(), // JSON: selected style IDs and any modifications
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step3UserEdit: input.userEdit,
        step3Confirmed: 1,
        currentStep: 4,
      });
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 3,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: session.step3AiResult ? JSON.parse(session.step3AiResult) : null,
        userEdit: JSON.parse(input.userEdit),
      });
      return { success: true };
    }),


  // ─── Step 4: Queue reference image recommendations ────────────
  startStep4Generation: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const resolvedSession = await resolveSessionForExecution(input.projectId, ctx.user, `image.step4.generate:${input.projectId}`);
      if (!resolvedSession) throw new Error("No workflow session found");
      let session = resolvedSession;
      if (!session.step3Confirmed) throw new Error("Step 3 not confirmed yet");

      const agentRunId = session.agentRunId || await ensureImageWorkflowAgentRun({
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
      });
      if (agentRunId && agentRunId !== session.agentRunId) {
        await db.updateImageWorkflowSession(session.id, { agentRunId });
        session = { ...session, agentRunId };
      }

      return startStep4ReferenceJob({
        projectId: input.projectId,
        sessionId: session.id,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
        agentRunId,
      });
    }),

  getStep4Run: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      return getLatestStep4ReferenceJob(ctx.user.id, input.projectId);
    }),

  // ─── Step 4: Generate recommendations (legacy sync endpoint) ──
  generateStep4: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step4.generate:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");
      if (!session.step3Confirmed) throw new Error("Step 3 not confirmed yet");

      const result = await buildStep4ReferenceRecommendation({
        project,
        session,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
      await db.updateImageWorkflowSession(session.id, {
        step4AiResult: JSON.stringify(result),
        currentStep: 4,
      });

      return result;
    }),


  // ─── Step 4: Save user edits and confirm ──────────────────────
  confirmStep4: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step4UserEdit: input.userEdit,
        step4Confirmed: 1,
        currentStep: 5,
      });
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 4,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: session.step4AiResult ? JSON.parse(session.step4AiResult) : null,
        userEdit: JSON.parse(input.userEdit),
      });
      return { success: true };
    }),
};
