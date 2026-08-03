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

export const imageKnowledgeExportProcedures = {


  // ─── Knowledge Base Image Browser for Step 4 ─────────────────
  listKbImages: protectedProcedure
    .input(z.object({
      scope: z.enum(["mine", "shared", "all"]).optional().default("all"),
      tagCategory: z.string().optional(),
      tagColorSchemeV2: z.string().optional(),
      tagImageTypeMain: z.string().optional(),
      tagDesignStyleV2: z.string().optional(),
      imagePosition: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const { scope = "all", ...filters } = input || {};
      return kbDb.listAllImages(ctx.user.id, scope, filters);
    }),


  // Get distinct tag values for filter dropdowns (V2 fields only, scope-aware)
  getKbImageFilterOptions: protectedProcedure
    .input(z.object({ scope: z.enum(["mine", "shared", "all"]).optional().default("all") }).optional())
    .query(async ({ ctx, input }) => {
      const scope = input?.scope ?? "all";
      const allImages = await kbDb.listAllImages(ctx.user.id, scope);
      const categories = new Set<string>();
      const colorSchemes = new Set<string>();
      const imageTypes = new Set<string>();
      const designStyles = new Set<string>();
      for (const img of allImages) {
        if (img.tagCategory) categories.add(img.tagCategory);
        // V2 fields take priority; fall back to legacy only if V2 is absent
        const cs = (img as any).tagColorSchemeV2 || img.tagColorScheme;
        const it = (img as any).tagImageTypeMain || img.tagImageType;
        const ds = (img as any).tagDesignStyleV2 || img.tagDesignStyle;
        if (cs) colorSchemes.add(cs);
        if (it) imageTypes.add(it);
        if (ds) designStyles.add(ds);
      }
      return {
        categories: Array.from(categories).sort(),
        colorSchemes: Array.from(colorSchemes).sort(),
        imageTypes: Array.from(imageTypes).sort(),
        designStyles: Array.from(designStyles).sort(),
      };
    }),


  // ─── Generate PDF export ──────────────────────────────────────
  exportPdf: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      if (!session.step5AiResult) throw new Error("Step 5 not generated yet");

      // Return the data for client-side PDF generation
      return {
        en: session.step5UserEdit || session.step5OptimizedResult || session.step5AiResult,
        cn: session.step5AiResultCn || session.step5OptimizedResultCn,
        sellingPoints: session.step1UserEdit || session.step1AiResult,
        outline: session.step2UserEdit || session.step2AiResult,
        style: session.step3UserEdit || session.step3AiResult,
        references: session.step4UserEdit || session.step4AiResult,
      };
    }),
};