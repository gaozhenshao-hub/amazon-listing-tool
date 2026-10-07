import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import { syncStepConfirmToAgent } from "../imageWorkflowAgentBridge";
import { requireConfirmedPrimaryGallery } from "../competitorGalleryService";
import { getConfirmedCompositeContext, requireConfirmedCompositeForSelections } from "../expressionLinkageService";
import { validateImageBytes } from "../services/validateImageBytes";
import { TRPCError } from "@trpc/server";

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
  asImageWorkflowVersionTrpcError,
  callLLMWithRetry,
  confirmHumanImageWorkflowStage,
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
      await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      const images = await db.getCompetitorImagesByProject(input.projectId);
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
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
      imageData: z.string().max(28_000_000), // base64 encoded; actual bytes checked below
      fileName: z.string(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      // Legacy tRPC upload remains research-only, with the same byte and
      // decoder policy as the controlled multipart endpoint.
      const buffer = Buffer.from(input.imageData, "base64");
      const { extension: ext, mimeType } = await validateImageBytes(buffer);
      const safeName = input.competitorName.replace(/[^a-zA-Z0-9\u4e00-\u9fa5_-]/g, "-").slice(0, 80);
      const key = `image-workflow/${input.projectId}/step0-competitor/${safeName}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, buffer, mimeType);

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
      await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      throw new Error("旧版单图同步分析已停用，请在 Step 0 使用后台分析并生成总结");
    }),


  // ─── Step 0: Update competitor image analysis (user edit) ──────
  updateCompetitorImageAnalysis: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number().int().positive(),
      userEdit: z.string(),
      imageType: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      const updated = await db.updateCompetitorImage(input.imageId, input.projectId, {
        userEdit: input.userEdit,
        imageType: input.imageType || null,
      });
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "竞品图片不存在于当前项目" });
      return { success: true };
    }),


  // ─── Step 0: Delete competitor image ───────────────────────────
  deleteCompetitorImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number().int().positive(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      const deleted = await db.deleteCompetitorImage(input.imageId, input.projectId);
      if (!deleted) throw new TRPCError({ code: "NOT_FOUND", message: "竞品图片不存在于当前项目" });
      return { success: true };
    }),


  // ─── Step 0: Confirm Step 0 (generate summary) ─────────────────
  confirmStep0: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      const workspaceId = Number(project.workspaceId || ctx.workspaceId || 0);
      await requireConfirmedPrimaryGallery(workspaceId, input.projectId);
      await requireConfirmedCompositeForSelections(workspaceId, input.projectId);
      const compositeContext = await getConfirmedCompositeContext(workspaceId, input.projectId);
      if (!session.step0AiResult && !compositeContext) throw new Error("请先完成手工表达图片总结，或确认图库联动综合结论");
      let summaryResult: any;
      try {
        summaryResult = JSON.parse(input.userEdit || session.step0AiResult || compositeContext);
      } catch {
        throw new Error("竞品分析总结格式无效，请重新生成");
      }
      const confirmation = await confirmHumanImageWorkflowStage({
        workspaceId,
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        step: 0,
        content: summaryResult,
      }).catch(asImageWorkflowVersionTrpcError);
      // Sync to Agent DAG (best-effort)
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 0,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: summaryResult,
        userEdit: summaryResult,
      });
      return { success: true, summary: summaryResult, version: confirmation.snapshot.version, scopeRevision: confirmation.scopeRevision };
    }),
};
