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

export const imageExpressionGroupProcedures = {


  // ─── Step 0: Expression Group CRUD ─────────────────────────────
  getExpressionGroups: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      return db.getExpressionGroupsByProject(input.projectId);
    }),


  createExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      expressionName: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
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
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const patch: Record<string, any> = {};
      if (input.expressionName !== undefined) patch.expressionName = input.expressionName;
      if (input.userEdit !== undefined) patch.userEdit = input.userEdit;
      await db.updateExpressionGroup(input.groupId, patch);
      return { success: true };
    }),


  deleteExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      await db.deleteExpressionGroup(input.groupId);
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
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      // Enforce max 5 images per group
      const count = await db.countExpressionGroupImages(input.groupId);
      if (count >= 5) throw new Error("每个表达方向最多上传5张参考图");
      const result = await db.insertExpressionGroupImage({
        groupId: input.groupId,
        projectId: input.projectId,
        userId: ctx.user.id,
        competitorName: input.competitorName,
        imageUrl: input.imageUrl,
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
      await resolveProjectAccess(input.projectId, ctx.user);
      await db.deleteExpressionGroupImage(input.imageId);
      return { success: true };
    }),


  analyzeExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      const groups = await db.getExpressionGroupsByProject(input.projectId);
      const group = groups.find(g => g.id === input.groupId);
      if (!group) throw new Error("Group not found");
      if (group.images.length === 0) throw new Error("请先上传图片");

      // Build multi-image message
      const userContent: any[] = [
        { type: "text", text: `请分析以下${group.images.length}张竞品图片，它们都属于同一卖点表达方向：「${group.expressionName}」。请从构图方式、配色方案、卖点表达方式、亮点等维度进行综合分析，输出JSON格式结果。` },
      ];
      for (const img of group.images) {
        userContent.push({ type: "image_url", image_url: { url: img.imageUrl, detail: "high" } });
        userContent.push({ type: "text", text: `竞品: ${img.competitorName || "未知"}` });
      }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
      await db.updateExpressionGroup(input.groupId, { aiAnalysis: JSON.stringify(result) });
      return result;
    }),
};