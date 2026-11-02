import * as shared from "../routerContext";
import { syncGenerationToAgent } from "../listingAgentBridge";
import { startListingJobForContext } from "./jobControl";

const {
  BULLET_POINTS_PROMPT,
  CHINESE_TRANSLATION_PROMPT,
  DESCRIPTION_PROMPT,
  EVALUATE_BULLET_CHECKLIST_PROMPT,
  EVALUATE_DESCRIPTION_CHECKLIST_PROMPT,
  EVALUATE_QA_CHECKLIST_PROMPT,
  EVALUATE_SEARCH_TERMS_CHECKLIST_PROMPT,
  EVALUATE_TITLE_CHECKLIST_PROMPT,
  EXPAND_KEYWORD_TO_FABE_PROMPT,
  IMAGE_ADVICE_PROMPT,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
  MAX_RETRIES,
  QA_GENERATION_PROMPT,
  SEARCH_TERMS_PROMPT,
  SELLING_POINTS_CORE_PROMPT,
  SINGLE_BULLET_PROMPT,
  TITLE_GENERATION_PROMPT,
  TRPCError,
  buildListingContext,
  buildProductContext,
  checkDataReadiness,
  contextToPromptText,
  db,
  ensureWriteAccess,
  executeListingSkill,
  generateChineseTranslation,
  invokeBusinessSkill,
  loadEnrichedData,
  parseJsonOrThrow,
  protectedProcedure,
  refineBullets,
  refineTitles,
  resolveProjectAccess,
  router,
  runEmperorSkill,
  safeParseJSON,
  saveListingVersion,
  translateImageAdviceToChinese,
  validateBullets,
  validateTitles,
  z,
  ensureListingAgentRun,
} = shared;

const legacyListingGenerationProcedures = {


  // Generate title with AI retry
  generateTitle: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      let parsed = await executeListingSkill<any>(
        "listing.title.generate",
        ctx.user.id,
        context,
        { project, analyses, enrichedData },
        input.emphasis,
      );
      let validation = validateTitles(parsed);
      if (!validation.valid) {
        for (let retry = 0; retry < MAX_RETRIES && !validation.valid; retry++) {
          parsed = await refineTitles(parsed, validation.issues);
          validation = validateTitles(parsed);
        }
      }
      // Sync to Agent DAG: G2 title node waiting for user review
      const titleListing = await db.getActiveListingByProject(input.projectId);
      void syncGenerationToAgent({
        agentRunId: titleListing?.agentRunId,
        nodeKey: "title",
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiOutput: parsed,
      });
      return parsed;
    }),

  // Generate bullet points with AI retry
  generateBulletPoints: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      let parsed = await executeListingSkill<any>(
        "listing.bullets.generate",
        ctx.user.id,
        context,
        { project, analyses, enrichedData },
        input.emphasis,
      );
      let validation = validateBullets(parsed);
      if (!validation.valid) {
        for (let retry = 0; retry < MAX_RETRIES && !validation.valid; retry++) {
          parsed = await refineBullets(parsed, validation.issues);
          validation = validateBullets(parsed);
        }
      }
      // Sync to Agent DAG: G1 sellingPoints node waiting for user review
      const bpListing = await db.getActiveListingByProject(input.projectId);
      void syncGenerationToAgent({
        agentRunId: bpListing?.agentRunId,
        nodeKey: "sellingPoints",
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiOutput: parsed,
      });
      return parsed;
    }),

  // Generate description
  generateDescription: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      const descParsed = await executeListingSkill<any>(
        "listing.description.generate",
        ctx.user.id,
        context,
        { project, analyses, enrichedData },
        input.emphasis,
      );
      // Sync to Agent DAG: G3 description node waiting for user review
      const descListing = await db.getActiveListingByProject(input.projectId);
      void syncGenerationToAgent({
        agentRunId: descListing?.agentRunId,
        nodeKey: "description",
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiOutput: descParsed,
      });
      return descParsed;
    }),

  // Generate search terms
  generateSearchTerms: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      existingTitle: z.string().optional(),
      emphasis: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      let extraContext = "";
      if (input.existingTitle) {
        extraContext = `\n\nCurrent Title (do NOT repeat these words): ${input.existingTitle}`;
      }

      const fullContext = context + extraContext;
      const stParsed = await executeListingSkill<any>(
        "listing.searchterms.generate",
        ctx.user.id,
        fullContext,
        { project, analyses, enrichedData, existingTitle: input.existingTitle || "" },
        input.emphasis,
      );
      // Sync to Agent DAG: G4 searchTerms node waiting for user review
      const stListing = await db.getActiveListingByProject(input.projectId);
      void syncGenerationToAgent({
        agentRunId: stListing?.agentRunId,
        nodeKey: "searchTerms",
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiOutput: stParsed,
      });
      return stParsed;
    }),

  // Generate image advice
  generateImageAdvice: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      const imageData = await executeListingSkill<any>(
        "listing.image.advice",
        ctx.user.id,
        context,
        { project, analyses, enrichedData },
        input.emphasis,
      );

      // Save image advice to the active listing (or create one if none exists)
      const existingListings = await db.getListingsByProject(input.projectId);
      const activeListing = existingListings.find((l) => l.isActive === 1);
      const imageAdviceJsonStr = JSON.stringify(imageData);

      // Also generate Chinese translation
      let imageAdviceCnStr: string | null = null;
      try {
        imageAdviceCnStr = await translateImageAdviceToChinese(imageAdviceJsonStr);
      } catch (err) {
        console.error("Image advice CN translation failed:", err);
      }

      let savedImageAdviceListing;
      if (activeListing) {
        savedImageAdviceListing = await db.updateListing(activeListing.id, {
          imageAdvice: imageAdviceJsonStr,
          imageAdviceCn: imageAdviceCnStr || null,
        });
      } else {
        // Create a minimal listing to store image advice
        savedImageAdviceListing = await db.createListing({
          projectId: input.projectId,
          imageAdvice: imageAdviceJsonStr,
          imageAdviceCn: imageAdviceCnStr || null,
          version: 1,
          isActive: 1,
        });
      }

      void syncGenerationToAgent({
        agentRunId: savedImageAdviceListing?.agentRunId,
        nodeKey: "imageAdvice",
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiOutput: imageData,
      });

      return imageData;
    }),


  // Legacy full generation published model output directly; preserve the endpoint
  // name but refuse before any model call or Listing write until governed review exists.
  generateFull: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      ensureWriteAccess(project, ctx.user);
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "旧全量AI入口会绕过事实、候选人审和完整快照，现已停用；请逐条审核候选后预览并确认同步" });
    }),

  // The old translation path wrote AI output into the live English/Chinese
  // Listing without a human decision or complete CAS snapshot.
  translateToChinese: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      ensureWriteAccess(project, ctx.user);
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "旧一键翻译会把未经人工审核的AI结果覆盖正式Listing，现已停用；请保留旧内容，待受治理译文候选与人工确认流程接入" });
    }),

};

async function queueListingJob(ctx: any, input: { projectId: number; emphasis?: string; existingTitle?: string }, operation: "bullets" | "title" | "description" | "searchTerms" | "batch", nodeId: "G1" | "G2" | "G3" | "G4") {
  const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
  ensureWriteAccess(project, ctx.user);
  return startListingJobForContext({
    ...input,
    operation,
    nodeId,
    userId: ctx.user.id,
    workspaceId: ctx.workspaceId ?? null,
  });
}

export const listingGenerationProcedures = {
  ...legacyListingGenerationProcedures,
  generateTitle: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(({ ctx, input }) => queueListingJob(ctx, input, "title", "G2")),
  generateBulletPoints: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(({ ctx, input }) => queueListingJob(ctx, input, "bullets", "G1")),
  generateDescription: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(({ ctx, input }) => queueListingJob(ctx, input, "description", "G3")),
  generateSearchTerms: protectedProcedure
    .input(z.object({ projectId: z.number(), existingTitle: z.string().optional(), emphasis: z.string().optional() }))
    .mutation(({ ctx, input }) => queueListingJob(ctx, input, "searchTerms", "G4")),
  generateFull: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(({ ctx, input }) => queueListingJob(ctx, input, "batch", "G1")),
};
