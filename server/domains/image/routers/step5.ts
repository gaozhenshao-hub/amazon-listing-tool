import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";

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
  invokeLLM,
  isActiveStep5Run,
  kbDb,
  parseLLMJson,
  parseStoredJson,
  persistStep5ListingAdvice,
  protectedProcedure,
  registerAiJobHandler,
  resolveProjectAccess,
  resolveSessionAccess,
  router,
  runStep5GenerationJob,
  serializeStep5Error,
  startRegisteredAiJob,
  step5JobInput,
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

      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      if (!session.step4Confirmed) throw new Error("Step 4 not confirmed yet");

      if (session.step5RunId && isActiveStep5Run(session.step5RunStatus)) {
        return buildStep5RunSnapshot(session);
      }

      const runId = generateStep5RunId();
      const startedAt = new Date();
      const queuedSession = await db.updateImageWorkflowSession(session.id, {
        step5RunId: runId,
        step5RunStatus: "queued",
        step5RunProgress: 5,
        step5RunError: null,
        step5RunStartedAt: startedAt,
        step5RunCompletedAt: null,
        step5Confirmed: 0,
        currentStep: 5,
        status: "in_progress",
      });
      await startRegisteredAiJob({
        runId,
        kind: "image.step5.finalSuggestion",
        module: "imageWorkflow",
        procedure: "imageWorkflow.startStep5Generation",
        userId: ctx.user.id,
        projectId: input.projectId,
        skillSlug: "image.step5.final.suggestion",
        input: {
          projectId: input.projectId,
          sessionId: session.id,
        },
        progress: 5,
      });

      return buildStep5RunSnapshot(queuedSession);
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
      return {
        ...buildStep5RunSnapshot(session),
        isCurrent: !input.runId || session.step5RunId === input.runId,
      };
    }),


  // ─── Step 5: Generate final image suggestions (sync compatibility) ──
  generateStep5: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      if (!session.step4Confirmed) throw new Error("Step 4 not confirmed yet");

      const runId = generateStep5RunId();
      await db.updateImageWorkflowSession(session.id, {
        step5RunId: runId,
        step5RunStatus: "running",
        step5RunProgress: 20,
        step5RunError: null,
        step5RunStartedAt: new Date(),
        step5RunCompletedAt: null,
        step5Confirmed: 0,
      });

      try {
        const result = await buildStep5FinalSuggestion(project, session, ctx.user.id);
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

      await db.updateImageWorkflowSession(session.id, {
        step5UserEdit: input.userEdit,
        step5Confirmed: 1,
        status: "completed",
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