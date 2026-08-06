import * as shared from "../routerContext";

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
} = shared;

export const listingVersionProcedures = {


  // ─── Version History Procedures ───

  // Get version history for a project
  getVersionHistory: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return db.getListingVersionsByProject(input.projectId);
    }),


  // Rollback to a specific version
  rollbackToVersion: protectedProcedure
    .input(z.object({
      versionId: z.number(),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const version = await db.getListingVersionById(input.versionId);
      if (!version) throw new Error("Version not found");
      if (version.projectId !== input.projectId) throw new Error("Version does not belong to this project");

      const listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) throw new Error("No active listing found");

      // Save current state as a version before rollback
      await saveListingVersion(listing, ctx.user.id, "manual_edit", `回滚前的状态备份`);

      // Apply the version snapshot to the active listing
      const updated = await db.updateListing(listing.id, {
        title: version.title,
        bulletPoints: version.bulletPoints,
        description: version.description,
        searchTerms: version.searchTerms,
        titleCn: version.titleCn,
        bulletPointsCn: version.bulletPointsCn,
        descriptionCn: version.descriptionCn,
        searchTermsCn: version.searchTermsCn,
      });

      // Save the rollback as a new version
      if (updated) {
        await saveListingVersion(updated, ctx.user.id, "manual_edit", `回滚到版本 #${version.versionNumber}`);
      }

      return { listing: updated, rolledBackTo: version.versionNumber };
    }),
};