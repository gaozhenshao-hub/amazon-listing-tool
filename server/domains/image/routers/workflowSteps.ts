import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import { BadRequestError, NotFoundError } from "@shared/_core/errors";
import { TRPCError } from "@trpc/server";
import { ensureImageWorkflowAgentRun, syncStepConfirmToAgent, syncStepUnlockToAgent } from "../imageWorkflowAgentBridge";
import {
  buildStep4ReferenceRecommendation,
  getLatestStep4ReferenceJob,
  startStep4ReferenceJob,
} from "../services/step4ReferenceJob";
import {
  cancelImageStepGenerationJob,
  getLatestImageStepGenerationJob,
  type ImageGenerationStep,
} from "../services/stepGenerationJob";
import { startImageStepGenerationForUser } from "../services/startImageStepGeneration";
import { registerImageWorkflowAplusSubmoduleArtifact, registerImageWorkflowStepArtifact } from "../../ai_os/services/businessArtifactRegistry";
import { buildStep4ConfirmedSnapshot } from "../step4Snapshot";
import { preserveLockedAplusSubmodules } from "../step2AplusLockedSubmodules";

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

const STEP4_ARTIFACT_REGISTRATION_TIMEOUT_MS = 5_000;

export async function awaitStep4ArtifactRegistration<T>(input: {
  registration: Promise<T>;
  timeoutMs?: number;
  onError?: (error: unknown) => void;
}): Promise<{ artifact: T | null; timedOut: boolean }> {
  const registration = input.registration
    .then((artifact) => ({ kind: "completed" as const, artifact }))
    .catch((error) => {
      input.onError?.(error);
      return { kind: "failed" as const, artifact: null };
    });
  const timeoutMs = input.timeoutMs ?? STEP4_ARTIFACT_REGISTRATION_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<{ kind: "timeout"; artifact: null }>((resolve) => {
    timeoutId = setTimeout(() => resolve({ kind: "timeout", artifact: null }), timeoutMs);
  });
  const result = await Promise.race([registration, timeout]);
  if (timeoutId) clearTimeout(timeoutId);
  if (result.kind === "timeout") {
    // registration 已绑定错误处理；保留其后台完成机会，避免短暂的Artifact存储延迟阻塞业务确认。
    void registration;
    return { artifact: null, timedOut: true };
  }
  return { artifact: result.artifact, timedOut: false };
}


async function startGenerationForRequest(input: {
  projectId: number;
  step: ImageGenerationStep;
  user: { id: number; role: string };
  workspaceId?: number | null;
}) {
  return startImageStepGenerationForUser(input);
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


  // ─── Step 2: Save editable outline draft without confirming ─────
  saveStep2Draft: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw NotFoundError("图片建议工作流不存在");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      if (session.step2Confirmed) {
        throw BadRequestError("图片大纲已锁定，请先点击“解锁编辑”后再保存草稿");
      }

      let parsed: any;
      try {
        parsed = JSON.parse(input.userEdit);
      } catch {
        throw BadRequestError("图片大纲草稿格式无效");
      }
      const normalized = normalizeImageOutline(parsed);
      await db.updateImageWorkflowSession(session.id, {
        step2UserEdit: JSON.stringify(normalized),
        currentStep: 2,
      });
      return { outline: normalized };
    }),


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
      // 发布当前确认的大纲版本，避免Agent资产仍显示为空或读取较早快照。
      await registerImageWorkflowStepArtifact(session.id, 2, "user_edit");
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 2,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        // Step2 锁定后的业务确认版本（含多图 A+ 的 subModules）才是后续
        // Artifact 水合的权威内容；不能继续向 skill 节点发布旧的原始 AI 结果。
        aiResult: normalized,
        userEdit: normalized,
      });
      return { success: true };
    }),

  // ─── Step 2: Lock a single image of a multi-image A+ module ──────
  lockStep2AplusSubmodule: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      moduleIndex: z.number().int().min(0),
      submoduleIndex: z.number().int().min(0),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw NotFoundError("图片建议工作流不存在");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      const outline = parseStoredJson(session.step2UserEdit || session.step2AiResult) as Record<string, any> | null;
      const module = outline?.aPlusModules?.[input.moduleIndex];
      const submodule = module?.subModules?.[input.submoduleIndex];
      if (!outline || !module || !submodule) throw BadRequestError("A+子模块不存在，请重新生成图片大纲");

      const updatedOutline = normalizeImageOutline({
        ...outline,
        aPlusModules: outline.aPlusModules.map((item: any, moduleIndex: number) => moduleIndex !== input.moduleIndex
          ? item
          : {
              ...item,
              subModules: item.subModules.map((child: any, submoduleIndex: number) => submoduleIndex !== input.submoduleIndex
                ? child
                : { ...child, isLocked: true, lockedAt: new Date().toISOString(), lockedBy: ctx.user.id }),
            }),
      });
      await db.updateImageWorkflowSession(session.id, { step2UserEdit: JSON.stringify(updatedOutline) });
      const artifact = await registerImageWorkflowAplusSubmoduleArtifact({
        sessionId: session.id,
        moduleIndex: input.moduleIndex,
        submoduleIndex: input.submoduleIndex,
        sourceType: "user_edit",
        status: "final",
      });
      return { outline: updatedOutline, artifactRef: artifact?.ref || null };
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
      if (session.step2Confirmed) {
        throw BadRequestError("图片大纲已锁定，请先点击“解锁编辑”后再调整A+模块样式");
      }

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
        subModuleRemark: currentModule.subModuleRemark ?? optimized.subModuleRemark,
        subModuleCount: currentModule.subModuleCount ?? optimized.subModuleCount,
      };
      const styledModule = applyImageWorkflowAplusStyle(mergedModule, selectedModule.id);
      outline.aPlusModules[input.moduleIndex] = preserveLockedAplusSubmodules(currentModule, styledModule);
      const normalizedOutline = normalizeImageOutline(outline);

      await db.updateImageWorkflowSession(session.id, {
        step2UserEdit: JSON.stringify(normalizedOutline),
        currentStep: 2,
      });

      return { outline: normalizedOutline, module: normalizedOutline.aPlusModules[input.moduleIndex] };
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
      if (!session.step3Confirmed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请先在 Step 3 确认视觉风格，再生成或重新推荐参考图",
        });
      }

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
      if (!session.step3Confirmed) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "请先在 Step 3 确认视觉风格，再生成或重新推荐参考图",
        });
      }

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
      const requestedSnapshot = parseStoredJson(input.userEdit) as Record<string, any> | null;
      const requestedRefs = requestedSnapshot?.imageReferences || [];
      const confirmedVersions = await db.getCurrentStep4ImageVersions(session.id);
      const versionByIndex = new Map(confirmedVersions.map((version: any) => [Number(version.imageIndex), parseStoredJson(version.content)]));
      const completeSnapshot = buildStep4ConfirmedSnapshot(requestedSnapshot, versionByIndex);
      const completeUserEdit = JSON.stringify(completeSnapshot);

      await db.updateImageWorkflowSession(session.id, {
        step4AiResult: completeUserEdit,
        step4UserEdit: completeUserEdit,
        step4Confirmed: 1,
        currentStep: 5,
      });
      // Step4 锁定时必须等待完整快照成为当前正式 Artifact。
      // 否则页面展示层会从较旧的已确认 Artifact 水合，覆盖刚确认的参考图与方案。
      const artifactResult = await awaitStep4ArtifactRegistration({
        registration: registerImageWorkflowStepArtifact(session.id, 4, "user_edit"),
        onError: (error) => console.warn(`[Step4] Artifact registration failed after session confirmation: session=${session.id}`, error),
      });
      if (!artifactResult.artifact) {
        console.warn(
          `[Step4] Complete snapshot was saved to the session but Artifact registration ${artifactResult.timedOut ? "timed out" : "was unavailable"}: session=${session.id}`,
        );
      }
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 4,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: completeSnapshot,
        userEdit: completeSnapshot,
      });
      return { success: true };
    }),
};
