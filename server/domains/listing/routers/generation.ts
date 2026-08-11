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
      const project = await resolveProjectAccess(input.projectId, ctx.user);
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
      const project = await resolveProjectAccess(input.projectId, ctx.user);
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
      const project = await resolveProjectAccess(input.projectId, ctx.user);
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
      const project = await resolveProjectAccess(input.projectId, ctx.user);
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
      const project = await resolveProjectAccess(input.projectId, ctx.user);
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

      if (activeListing) {
        await db.updateListing(activeListing.id, {
          imageAdvice: imageAdviceJsonStr,
          imageAdviceCn: imageAdviceCnStr || null,
        });
      } else {
        // Create a minimal listing to store image advice
        await db.createListing({
          projectId: input.projectId,
          imageAdvice: imageAdviceJsonStr,
          imageAdviceCn: imageAdviceCnStr || null,
          version: 1,
          isActive: 1,
        });
      }

      return imageData;
    }),


  // Generate full listing (all components at once) with AI retry for char limits
  generateFull: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      emphasis: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      await db.updateProject(input.projectId, ctx.user.id, { status: "generating" });

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);

      // Inject user emphasis into context
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis / 用户重点强调] ---\n用户希望在Listing中重点突出以下卖点或场景，请在标题、五点、描述中优先体现这些内容：\n${input.emphasis.trim()}`;
      }

      const commonVariables = { project, analyses, enrichedData };
      const [titleDataRaw, bulletDataRaw, descData, searchData, imageData] = await Promise.all([
        executeListingSkill<any>("listing.title.generate", ctx.user.id, context, commonVariables, input.emphasis),
        executeListingSkill<any>("listing.bullets.generate", ctx.user.id, context, commonVariables, input.emphasis),
        executeListingSkill<any>("listing.description.generate", ctx.user.id, context, commonVariables, input.emphasis),
        executeListingSkill<any>("listing.searchterms.generate", ctx.user.id, context, commonVariables, input.emphasis),
        executeListingSkill<any>("listing.image.advice", ctx.user.id, context, commonVariables, input.emphasis),
      ]);

      let titleData = titleDataRaw;
      let bulletData = bulletDataRaw;

      // Validate titles and retry if needed
      let titleValidation = validateTitles(titleData);
      if (!titleValidation.valid) {
        for (let retry = 0; retry < MAX_RETRIES && !titleValidation.valid; retry++) {
          titleData = await refineTitles(titleData, titleValidation.issues);
          titleValidation = validateTitles(titleData);
        }
      }

      // Validate bullets and retry if needed
      let bulletValidation = validateBullets(bulletData);
      if (!bulletValidation.valid) {
        for (let retry = 0; retry < MAX_RETRIES && !bulletValidation.valid; retry++) {
          bulletData = await refineBullets(bulletData, bulletValidation.issues);
          bulletValidation = validateBullets(bulletData);
        }
      }

      // Generate Chinese translation
      const englishTitle = titleData.recommendedTitle || titleData.titles?.[0]?.title || "";
      const englishItemHighlights = titleData.recommendedItemHighlights || titleData.titles?.[0]?.itemHighlights || "";
      const englishBullets = bulletData.bulletPoints || [];
      const englishDesc = descData.description || descData.htmlDescription || "";
      const englishSearchTerms = searchData.searchTerms || "";

      let cnData = { titleCn: "", itemHighlightsCn: "", bulletPointsCn: [] as any[], descriptionCn: "", searchTermsCn: "" };
      try {
        cnData = await generateChineseTranslation(
          englishTitle,
          englishBullets,
          englishDesc,
          englishSearchTerms,
          undefined,
          englishItemHighlights,
          ctx.user.id,
        );
      } catch (err) {
        console.error("Chinese translation failed:", err);
        // Continue without Chinese translation - it can be generated later
      }

      // Get existing listings count for versioning
      const existingListings = await db.getListingsByProject(input.projectId);
      const nextVersion = existingListings.length + 1;

      // Deactivate previous listings
      for (const listing of existingListings) {
        if (listing.isActive) {
          await db.updateListing(listing.id, { isActive: 0 });
        }
      }

      // Translate image advice to Chinese
      const imageAdviceJsonStr = JSON.stringify(imageData);
      const imageAdviceCnStr = await translateImageAdviceToChinese(imageAdviceJsonStr);

      // Save the new listing with Chinese translations
      const savedListing = await db.createListing({
        projectId: input.projectId,
        title: englishTitle,
        itemHighlights: englishItemHighlights || null,
        bulletPoints: JSON.stringify(bulletData.bulletPoints || []),
        description: englishDesc,
        searchTerms: englishSearchTerms,
        imageAdvice: imageAdviceJsonStr,
        imageAdviceCn: imageAdviceCnStr || null,
        titleCn: cnData.titleCn || null,
        itemHighlightsCn: cnData.itemHighlightsCn || null,
        bulletPointsCn: cnData.bulletPointsCn.length > 0 ? JSON.stringify(cnData.bulletPointsCn) : null,
        descriptionCn: cnData.descriptionCn || null,
        searchTermsCn: cnData.searchTermsCn || null,
        version: nextVersion,
        isActive: 1,
      });

      await db.updateProject(input.projectId, ctx.user.id, { status: "completed" });

      // Save version snapshot
      await saveListingVersion(savedListing, ctx.user.id, "generate", `全量生成 v${nextVersion}`);

      return {
        listing: savedListing,
        titleOptions: titleData,
        bulletPointsData: bulletData,
        descriptionData: descData,
        searchTermsData: searchData,
        imageAdviceData: imageData,
        chineseTranslation: cnData,
      };
    }),


  // Translate existing listing to Chinese
  translateToChinese: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) throw new Error("No active listing found. Please generate a listing first.");

      let bulletPoints: any[] = [];
      try {
        bulletPoints = listing.bulletPoints ? JSON.parse(listing.bulletPoints) : [];
      } catch {
        bulletPoints = [];
      }

      const cnData = await generateChineseTranslation(
        listing.title || "",
        bulletPoints,
        listing.description || "",
        listing.searchTerms || "",
        listing.qaContent || undefined,
        listing.itemHighlights || undefined,
        ctx.user.id,
      );

      // Translate image advice to Chinese if available
      let imageAdviceCnStr: string | null = null;
      if (listing.imageAdvice) {
        imageAdviceCnStr = await translateImageAdviceToChinese(listing.imageAdvice);
      }

      // Save Chinese translations to the listing
      const updateData: any = {
        titleCn: cnData.titleCn,
        bulletPointsCn: JSON.stringify(cnData.bulletPointsCn),
        descriptionCn: cnData.descriptionCn,
        searchTermsCn: cnData.searchTermsCn,
        imageAdviceCn: imageAdviceCnStr,
      };
      if (cnData.qaContentCn) {
        updateData.qaContentCn = cnData.qaContentCn;
      }
      const updated = await db.updateListing(listing.id, updateData);

      // Save version snapshot after translation
      await saveListingVersion(
        { ...listing, titleCn: cnData.titleCn, bulletPointsCn: JSON.stringify(cnData.bulletPointsCn), descriptionCn: cnData.descriptionCn, searchTermsCn: cnData.searchTermsCn },
        ctx.user.id, "translate", "添加中文翻译"
      );

      return {
        ...cnData,
        listing: updated,
      };
    }),
};

async function queueListingJob(ctx: any, input: { projectId: number; emphasis?: string; existingTitle?: string }, operation: "bullets" | "title" | "description" | "searchTerms" | "batch", nodeId: "G1" | "G2" | "G3" | "G4") {
  const project = await resolveProjectAccess(input.projectId, ctx.user);
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
