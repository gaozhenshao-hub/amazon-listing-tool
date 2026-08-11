import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import { syncStepConfirmToAgent } from "../imageWorkflowAgentBridge";

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

export const imageCompetitorProcedures = {



  // ─── Step 0: Get competitor images ─────────────────────────────
  getStep0Data: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      const images = await db.getCompetitorImagesByProject(input.projectId);
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      return {
        images,
        step0AiResult: session?.step0AiResult || null,
        step0UserEdit: session?.step0UserEdit || null,
        step0Confirmed: session?.step0Confirmed || 0,
      };
    }),


  // ─── Step 0: Upload competitor image ───────────────────────────
  uploadCompetitorImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      competitorName: z.string(),
      imageData: z.string(), // base64 encoded
      fileName: z.string(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      // Upload to S3
      const buffer = Buffer.from(input.imageData, "base64");
      const ext = input.fileName.split(".").pop() || "png";
      const key = `image-workflow/${input.projectId}/step0-competitor/${input.competitorName}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, buffer, `image/${ext}`);

      const record = await db.insertCompetitorImage({
        projectId: input.projectId,
        userId: ctx.user.id,
        competitorName: input.competitorName,
        imageUrl: url,
        sortOrder: input.sortOrder || 0,
      });

      return { id: record.insertId, url, competitorName: input.competitorName };
    }),


  // ─── Step 0: Analyze single competitor image ───────────────────
  analyzeCompetitorImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      throw new Error("旧版单图同步分析已停用，请在 Step 0 使用后台分析并生成总结");
    }),


  // ─── Step 0: Update competitor image analysis (user edit) ──────
  updateCompetitorImageAnalysis: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number(),
      userEdit: z.string(),
      imageType: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      await db.updateCompetitorImage(input.imageId, {
        userEdit: input.userEdit,
        imageType: input.imageType || null,
      });
      return { success: true };
    }),


  // ─── Step 0: Delete competitor image ───────────────────────────
  deleteCompetitorImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      await db.deleteCompetitorImage(input.imageId);
      return { success: true };
    }),


  // ─── Step 0: Confirm Step 0 (generate summary) ─────────────────
  confirmStep0: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      if (!session.step0AiResult) throw new Error("请先运行竞品图片分析并等待总结生成完成");
      let summaryResult: any;
      try {
        summaryResult = JSON.parse(input.userEdit || session.step0AiResult);
      } catch {
        throw new Error("竞品分析总结格式无效，请重新生成");
      }

      await db.updateImageWorkflowSession(session.id, {
        step0AiResult: session.step0AiResult,
        step0UserEdit: input.userEdit || null,
        step0Confirmed: 1,
        currentStep: 1,
      });
      // Sync to Agent DAG (best-effort)
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 0,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: summaryResult,
        userEdit: input.userEdit ? JSON.parse(input.userEdit) : summaryResult,
      });
      return { success: true, summary: summaryResult };
    }),
};
