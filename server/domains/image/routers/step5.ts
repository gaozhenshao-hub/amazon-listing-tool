import { TRPCError } from "@trpc/server";
import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import {
  ensureImageWorkflowAgentRun,
  syncStepConfirmToAgent,
  syncStepJobFailedToAgent,
  syncStepJobQueuedToAgent,
  syncStepJobRunningToAgent,
} from "../imageWorkflowAgentBridge";
import {
  cancelAiJob,
  createAiJobRun,
  getAiJobRun,
  scheduleAiJobRun,
} from "../../ai_os/services/jobRunner";

const {
  APLUS_MODULE_STYLE_GUIDE,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
  STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT,
  STEP0_COMPETITOR_SUMMARY_PROMPT,
  STEP1_SELLING_POINTS_PROMPT,
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP3_STYLE_PROMPT,
  STEP4_REFERENCE_PROMPT,
  STEP4_REOPTIMIZE_WITH_REFS_PROMPT,
  STEP5_APLUS_COMBO_RECOMMEND_PROMPT,
  STEP5_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP5_FINAL_SUGGESTION_PROMPT,
  STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
  buildImageWorkflowContext,
  buildStep5FinalSuggestion,
  buildStep5RunSnapshot,
  callLLMWithRetry,
  db,
  devDb,
  ensureWriteAccess,
  generateStep5RunId,
  getKBReference,
  invokeBusinessSkill,
  isActiveStep5Run,
  kbDb,
  parseLLMJson,
  parseStoredJson,
  normalizeSecondaryImageSlots,
  persistStep5ListingAdvice,
  protectedProcedure,
  resolveProjectAccess,
  resolveSessionAccess,
  resolveSessionForExecution,
  router,
  serializeStep5Error,
  storagePut,
  z,
} = shared;

export const imageStep5Procedures = {


  // ─── Step 5: Start async final image suggestions generation ───────
  startStep5Generation: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const resolvedSession = await resolveSessionForExecution(input.projectId, ctx.user, `image.step5.generate:${input.projectId}`);
      if (!resolvedSession) throw new Error("No workflow session found");
      let session = resolvedSession;
      if (!session.step4Confirmed) throw new Error("Step 4 not confirmed yet");

      if (session.step5RunId && isActiveStep5Run(session.step5RunStatus)) {
        const activeJob = await getAiJobRun(session.step5RunId).catch(() => null);
        if (activeJob && isActiveStep5Run(activeJob.status)) {
          const syncActiveJob = activeJob.status === "running"
            ? syncStepJobRunningToAgent
            : syncStepJobQueuedToAgent;
          await syncActiveJob({
            agentRunId: session.agentRunId,
            stepNumber: 5,
            projectId: input.projectId,
            userId: ctx.user.id,
            workspaceId: ctx.workspaceId ?? null,
            aiJobRunId: activeJob.runId,
            aiJobAttempt: activeJob.attempt,
            aiJobMaxAttempts: activeJob.maxAttempts,
            progress: activeJob.progress,
          });
          return {
            ...buildStep5RunSnapshot(session),
            attempt: activeJob.attempt,
            maxAttempts: activeJob.maxAttempts,
            nextRunAt: activeJob.nextRunAt,
          };
        }
      }

      const agentRunId = session.agentRunId || await ensureImageWorkflowAgentRun({
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
      });
      if (!agentRunId) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "图片工作流无法创建 Agent Run，最终建议任务未入队" });
      }
      if (agentRunId && agentRunId !== session.agentRunId) {
        await db.updateImageWorkflowSession(session.id, { agentRunId });
        session = { ...session, agentRunId };
      }

      const runId = generateStep5RunId();
      const startedAt = new Date();
      const queuedSession = await db.updateImageWorkflowSession(session.id, {
        step5RunId: runId,
        step5RunStatus: "queued",
        step5RunProgress: 5,
        step5RunError: null,
        step5RunSegments: null,
        step5RunFailedGroup: null,
        step5RunFailedModule: null,
        step5RunStartedAt: startedAt,
        step5RunCompletedAt: null,
        step5Confirmed: 0,
        currentStep: 5,
        status: "in_progress",
      });
      let job: Awaited<ReturnType<typeof createAiJobRun>>;
      try {
        job = await createAiJobRun({
          runId,
          kind: "image.step5.finalSuggestion",
          module: "imageWorkflow",
          procedure: "imageWorkflow.startStep5Generation",
          workspaceId: ctx.workspaceId ?? null,
          userId: ctx.user.id,
          projectId: input.projectId,
          skillSlug: "image.step5.final.suggestion",
          input: {
            projectId: input.projectId,
            sessionId: session.id,
            agentRunId,
            agentNodeId: "step5_skill",
          },
          progress: 5,
          maxAttempts: 3,
          timeoutSeconds: 15 * 60,
        });
      } catch (error) {
        await db.updateImageWorkflowSession(session.id, {
          step5RunStatus: "failed",
          step5RunProgress: 100,
          step5RunError: serializeStep5Error(error),
          step5RunCompletedAt: new Date(),
        });
        await syncStepJobFailedToAgent({
          agentRunId,
          stepNumber: 5,
          projectId: input.projectId,
          userId: ctx.user.id,
          workspaceId: ctx.workspaceId ?? null,
          aiJobRunId: runId,
          aiJobAttempt: 0,
          aiJobMaxAttempts: 3,
          progress: 100,
          errorMessage: serializeStep5Error(error),
          finalAttempt: true,
        });
        throw error;
      }

      await syncStepJobQueuedToAgent({
        agentRunId,
        stepNumber: 5,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiJobRunId: job.runId,
        aiJobAttempt: job.attempt,
        aiJobMaxAttempts: job.maxAttempts,
        progress: job.progress,
      });
      try {
        await scheduleAiJobRun(job.runId);
      } catch (error) {
        await cancelAiJob(job.runId, "最终图片建议任务调度失败").catch(() => null);
        await db.updateImageWorkflowSession(session.id, {
          step5RunStatus: "failed",
          step5RunProgress: 100,
          step5RunError: serializeStep5Error(error),
          step5RunCompletedAt: new Date(),
        });
        await syncStepJobFailedToAgent({
          agentRunId,
          stepNumber: 5,
          projectId: input.projectId,
          userId: ctx.user.id,
          workspaceId: ctx.workspaceId ?? null,
          aiJobRunId: job.runId,
          aiJobAttempt: job.attempt,
          aiJobMaxAttempts: job.maxAttempts,
          progress: 100,
          errorMessage: serializeStep5Error(error),
          finalAttempt: true,
        });
        throw error;
      }

      return {
        ...buildStep5RunSnapshot(queuedSession),
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        nextRunAt: job.nextRunAt,
      };
    }),


  getStep5Run: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      runId: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      const job = session.step5RunId
        ? await getAiJobRun(session.step5RunId).catch(() => null)
        : null;
      let effectiveSession = session;
      if (
        job &&
        isActiveStep5Run(session.step5RunStatus) &&
        (job.status === "failed" || job.status === "canceled")
      ) {
        const recoveredStatus = job.status === "canceled" ? "canceled" : "failed";
        const recoveredError = job.error || (job.status === "canceled" ? "任务已取消" : "图片建议生成失败");
        const updated = await db.updateImageWorkflowSession(session.id, {
          step5RunStatus: recoveredStatus,
          step5RunProgress: 100,
          step5RunError: recoveredError,
          step5RunCompletedAt: job.completedAt || new Date(),
        });
        if (updated) effectiveSession = { ...session, ...updated };
        await syncStepJobFailedToAgent({
          agentRunId: session.agentRunId,
          stepNumber: 5,
          projectId: input.projectId,
          userId: ctx.user.id,
          workspaceId: ctx.workspaceId ?? null,
          aiJobRunId: job.runId,
          aiJobAttempt: job.attempt,
          aiJobMaxAttempts: job.maxAttempts,
          progress: 100,
          errorMessage: recoveredError,
          finalAttempt: true,
          failureKind: job.status === "canceled" ? "cancel" : "error",
        });
      }
      return {
        ...buildStep5RunSnapshot(effectiveSession),
        isCurrent: !input.runId || effectiveSession.step5RunId === input.runId,
        attempt: job?.attempt ?? 0,
        maxAttempts: job?.maxAttempts ?? 0,
        nextRunAt: job?.nextRunAt ?? null,
        jobStatus: job?.status ?? null,
      };
    }),


  cancelStep5Generation: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      if (!session.step5RunId || !isActiveStep5Run(session.step5RunStatus)) {
        return buildStep5RunSnapshot(session);
      }

      const reason = "用户取消最终图片建议任务";
      const job = await getAiJobRun(session.step5RunId).catch(() => null);
      await cancelAiJob(session.step5RunId, reason);
      const latestSession = await db.getImageWorkflowSessionById(session.id);
      const updated = latestSession?.step5RunId === session.step5RunId
        ? await db.updateImageWorkflowSession(session.id, {
            step5RunStatus: "canceled",
            step5RunProgress: 100,
            step5RunError: reason,
            step5RunCompletedAt: new Date(),
          })
        : latestSession;

      await syncStepJobFailedToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 5,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiJobRunId: session.step5RunId,
        aiJobAttempt: job?.attempt ?? null,
        aiJobMaxAttempts: job?.maxAttempts ?? null,
        progress: 100,
        errorMessage: reason,
        finalAttempt: true,
        failureKind: "cancel",
      });
      return buildStep5RunSnapshot(updated || session);
    }),


  // ─── Step 5: Generate final image suggestions (sync compatibility) ──
  generateStep5: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step5.generate-sync:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");
      if (!session.step4Confirmed) throw new Error("Step 4 not confirmed yet");

      const runId = generateStep5RunId();
      await db.updateImageWorkflowSession(session.id, {
        step5RunId: runId,
        step5RunStatus: "running",
        step5RunProgress: 20,
        step5RunError: null,
        step5RunSegments: null,
        step5RunFailedGroup: null,
        step5RunFailedModule: null,
        step5RunStartedAt: new Date(),
        step5RunCompletedAt: null,
        step5Confirmed: 0,
      });

      try {
        const result = await buildStep5FinalSuggestion(project, session, ctx.user.id, ctx.workspaceId);
        const resultStr = JSON.stringify(result);

        // Save English result immediately so user sees it fast
        await db.updateImageWorkflowSession(session.id, {
          step5AiResult: resultStr,
          step5AiResultCn: null, // Will be filled by async translation
          step5RunStatus: "succeeded",
          step5RunProgress: 100,
          step5RunError: null,
          step5RunCompletedAt: new Date(),
          currentStep: 5,
        });

        // Also save to the active listing for backward compatibility
        await persistStep5ListingAdvice(input.projectId, resultStr);

        return { en: result, cn: null, runId, status: "succeeded" };
      } catch (error) {
        await db.updateImageWorkflowSession(session.id, {
          step5RunStatus: "failed",
          step5RunProgress: 100,
          step5RunError: serializeStep5Error(error),
          step5RunCompletedAt: new Date(),
        });
        throw error;
      }
    }),


  // ─── Step 5: Save user edits and confirm ──────────────────────
  confirmStep5: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      let parsed: any;
      try {
        parsed = JSON.parse(input.userEdit);
      } catch {
        throw new Error("图片建议不是有效JSON");
      }
      const imageNumbers = Array.isArray(parsed?.secondaryImages)
        ? parsed.secondaryImages.map((image: any) => Number(image?.imageNumber))
        : [];
      if (imageNumbers.length !== 6 || imageNumbers.some((imageNumber: number, index: number) => imageNumber !== index + 2)) {
        throw new Error("图片建议必须完整包含辅图2-7，请重新生成后再确认");
      }
      const incompleteImage = parsed.secondaryImages.find((image: any) =>
        !String(image?.title || "").trim() ||
        !String(image?.focus || "").trim() ||
        String(image?.focus || "").trim() === "待补充",
      );
      if (incompleteImage) {
        throw new Error(`辅图${incompleteImage.imageNumber}内容不完整，请重新生成或补充后再确认`);
      }
      parsed.secondaryImages = normalizeSecondaryImageSlots(parsed.secondaryImages, (imageNumber: number) => ({ imageNumber }));

      await db.updateImageWorkflowSession(session.id, {
        step5UserEdit: JSON.stringify(parsed),
        step5Confirmed: 1,
        status: "completed",
      });
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 5,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: session.step5AiResult ? JSON.parse(session.step5AiResult) : null,
        userEdit: parsed,
      });
      return { success: true };
    }),


  // ─── Step 5: Unlock final suggestions without deleting results ─
  unlockStep5: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step5Confirmed: 0,
        currentStep: 5,
        status: "in_progress",
      });

      return { success: true };
    }),
};
