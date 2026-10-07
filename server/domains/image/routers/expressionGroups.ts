import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import { ensureImageWorkflowAgentRun } from "../imageWorkflowAgentBridge";
import { startImageStepGenerationJob } from "../services/stepGenerationJob";
import { requireImageAssetReceipt } from "../services/imageAssetReceipt";

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

function ensureProjectInCurrentWorkspace(
  project: { workspaceId?: number | null },
  workspaceId?: number | null,
) {
  if ((project.workspaceId ?? null) !== (workspaceId ?? null)) {
    // Keep the existing project-not-found contract so callers cannot use this
    // endpoint to discover projects outside their active workspace.
    throw new Error("Project not found");
  }
}

export const imageExpressionGroupProcedures = {


  // ─── Step 0: Expression Group CRUD ─────────────────────────────
  getExpressionGroups: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      ensureProjectInCurrentWorkspace(project, ctx.workspaceId);
      return db.getExpressionGroupsByProject(input.projectId);
    }),


  createExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      expressionName: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureProjectInCurrentWorkspace(project, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      const groups = await db.getExpressionGroupsByProject(input.projectId);
      const result = await db.insertExpressionGroup({
        projectId: input.projectId,
        userId: ctx.user.id,
        expressionName: input.expressionName,
        sortOrder: groups.length,
      });
      return { id: result.insertId };
    }),


  updateExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
      expressionName: z.string().optional(),
      userEdit: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureProjectInCurrentWorkspace(project, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      const group = await db.getExpressionGroupByProject(input.groupId, input.projectId);
      if (!group) throw new Error("Group not found");
      const patch: Record<string, any> = {};
      if (input.expressionName !== undefined) patch.expressionName = input.expressionName;
      if (input.userEdit !== undefined) patch.userEdit = input.userEdit;
      await db.updateExpressionGroup(input.groupId, patch, input.projectId);
      return { success: true };
    }),


  deleteExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureProjectInCurrentWorkspace(project, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      const group = await db.getExpressionGroupByProject(input.groupId, input.projectId);
      if (!group) throw new Error("Group not found");
      await db.deleteExpressionGroup(input.groupId, input.projectId);
      return { success: true };
    }),


  addImageToGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
      competitorName: z.string(),
      imageUrl: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      ensureProjectInCurrentWorkspace(project, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      const group = await db.getExpressionGroupByProject(input.groupId, input.projectId);
      if (!group) throw new Error("Group not found");
      // Enforce max 5 images per group
      const count = await db.countExpressionGroupImages(input.groupId, input.projectId);
      if (count >= 5) throw new Error("每个表达方向最多上传5张参考图");
      const receipt = requireImageAssetReceipt({ reference: input.imageUrl,
        kind: "expression-group", projectId: input.projectId, userId: ctx.user.id });
      const result = await db.insertExpressionGroupImage({
        groupId: input.groupId,
        projectId: input.projectId,
        userId: ctx.user.id,
        competitorName: input.competitorName,
        imageUrl: receipt.url,
        sortOrder: count,
      });
      return { id: result.insertId };
    }),


  removeImageFromGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      ensureProjectInCurrentWorkspace(project, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      const image = await db.getExpressionGroupImageByProject(input.imageId, input.projectId);
      if (!image) throw new Error("Image not found");
      await db.deleteExpressionGroupImage(input.imageId, input.projectId);
      return { success: true };
    }),


  analyzeExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      ensureProjectInCurrentWorkspace(project, ctx.workspaceId);
      ensureWriteAccess(project, ctx.user);
      const groups = await db.getExpressionGroupsByProject(input.projectId);
      const group = groups.find(g => g.id === input.groupId);
      if (!group) throw new Error("Group not found");
      if (group.images.length === 0) throw new Error("请先上传图片");
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      const agentRunId = session.agentRunId || await ensureImageWorkflowAgentRun({
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
      });
      if (agentRunId && agentRunId !== session.agentRunId) {
        await db.updateImageWorkflowSession(session.id, { agentRunId });
      }
      return startImageStepGenerationJob({
        projectId: input.projectId,
        sessionId: session.id,
        step: 0,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
        agentRunId,
      });
    }),
};
