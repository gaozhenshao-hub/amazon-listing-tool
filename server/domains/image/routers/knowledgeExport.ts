import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import { requireImageDeliverableAccess } from "../services/imageApprovedExport";
import { asImageWorkflowVersionTrpcError, getApprovedImageWorkflowExport } from "../services/imageWorkflowVersionPolicy";

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
  resolveSessionForExecution,
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
      return kbDb.listAllImages(ctx.user.id, ctx.workspaceId!, scope, filters);
    }),


  // Get distinct tag values for filter dropdowns (V2 fields only, scope-aware)
  getKbImageFilterOptions: protectedProcedure
    .input(z.object({ scope: z.enum(["mine", "shared", "all"]).optional().default("all") }).optional())
    .query(async ({ ctx, input }) => {
      const scope = input?.scope ?? "all";
      const allImages = await kbDb.listAllImages(ctx.user.id, ctx.workspaceId!, scope);
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
      if (ctx.user.role !== "super_admin") {
        requireImageDeliverableAccess({ role: ctx.user.role, workspaceId: ctx.workspaceId, project: {} });
      }
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!project) throw new Error("Project not found");
      requireImageDeliverableAccess({ role: ctx.user.role, workspaceId: ctx.workspaceId, project });
      const session = await resolveSessionAccess(input.projectId, ctx.user, ctx.workspaceId);
      if (!session) throw new Error("No workflow session found");
      const approved = await getApprovedImageWorkflowExport({
        workspaceId: Number(project.workspaceId || ctx.workspaceId || 0),
        projectId: input.projectId,
        sessionId: session.id,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
      }).catch(asImageWorkflowVersionTrpcError);
      const section = (step: number) => approved.sections.find(candidate => candidate.step === step)?.content ?? null;

      // Compatibility fields are derived only from the immutable manifest. The
      // PDF renderer must not read legacy session drafts or machine translations.
      return {
        approved,
        en: section(5),
        cn: null,
        sellingPoints: section(1),
        outline: section(2),
        style: section(3),
        references: section(4),
      };
    }),
};
