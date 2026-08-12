import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import { ensureImageWorkflowAgentRun, syncStepUnlockToAgent } from "../imageWorkflowAgentBridge";

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
  resolveSessionForDisplay,
  router,
  runStep5GenerationJob,
  serializeStep5Error,
  startRegisteredAiJob,
  step5JobInput,
  storagePut,
  z,
} = shared;

function parseExportJson(value: unknown) {
  if (!value || typeof value !== "string") return {};
  try { return JSON.parse(value); } catch { return {}; }
}

function selectedAsinSetIds(session: any): number[] {
  const step3 = parseExportJson(session?.step3UserEdit || session?.step3AiResult);
  const styles = Array.isArray(step3?.selectedStyles) ? step3.selectedStyles : [];
  const ids = styles
    .filter((style: any) => style?.source === "kb_asin" && Number.isFinite(Number(style?.asinSetId)))
    .map((style: any) => Number(style.asinSetId)) as number[];
  return [...new Set<number>(ids)];
}

export const imageSessionProcedures = {


  // ─── Get or create workflow session ────────────────────────────
  getSession: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      const session = await resolveSessionForDisplay(input.projectId, ctx.user);
      return session;
    }),

  // ─── Complete export bundle (Step0-5 + selected reference assets) ─────────
  getExportBundle: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      const session = await resolveSessionForDisplay(input.projectId, ctx.user);
      if (!session) throw new Error("请先创建图片工作流");

      const asinSetIds = selectedAsinSetIds(session);
      const [expressionGroups, asinReferenceSets] = await Promise.all([
        db.getExpressionGroupsByProject(input.projectId),
        Promise.all(asinSetIds.map(async (setId) => {
          const set = await kbDb.getImageSetById(setId);
          if (!set) return null;
          const images = await kbDb.listImagesBySetLight(setId);
          return { ...set, images };
        })),
      ]);

      return {
        session,
        expressionGroups,
        asinReferenceSets: asinReferenceSets.filter(Boolean),
      };
    }),


  // ─── Create new workflow session ───────────────────────────────
  createSession: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      // Delete existing session if any
      const existing = await resolveSessionAccess(input.projectId, ctx.user);
      if (existing) {
        await db.deleteImageWorkflowSession(existing.id);
      }
      // Create session
      const session = await db.createImageWorkflowSession({
        projectId: input.projectId,
        userId: ctx.user.id,
        currentStep: 1,
      });
      // Start Agent Run for DAG tracking (non-blocking, best-effort)
      try {
        const agentRunId = await ensureImageWorkflowAgentRun({
          projectId: input.projectId,
          userId: ctx.user.id,
          workspaceId: ctx.workspaceId ?? null,
        });
        if (agentRunId) {
          await db.updateImageWorkflowSession(session.id, { agentRunId });
          return { ...session, agentRunId };
        }
      } catch (err) {
        console.warn("[ImageWorkflow] Failed to start Agent Run:", err);
      }
      return session;
    }),


  // ─── Reset to a specific step ─────────────────────────────────
  resetToStep: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      step: z.number().min(0).max(5),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      // Clear data for steps >= target step
      const clearData: any = { currentStep: input.step };
      if (input.step <= 0) {
        clearData.step0AiResult = null;
        clearData.step0UserEdit = null;
        clearData.step0Confirmed = 0;
      }
      if (input.step <= 1) {
        clearData.step1AiResult = null;
        clearData.step1UserEdit = null;
        clearData.step1Confirmed = 0;
      }
      if (input.step <= 2) {
        clearData.step2AiResult = null;
        clearData.step2UserEdit = null;
        clearData.step2Confirmed = 0;
      }
      if (input.step <= 3) {
        clearData.step3AiResult = null;
        clearData.step3UserEdit = null;
        clearData.step3Confirmed = 0;
      }
      if (input.step <= 4) {
        clearData.step4AiResult = null;
        clearData.step4UserEdit = null;
        clearData.step4Confirmed = 0;
        clearData.step4CompositionRefs = null;
        clearData.step4EffectRefs = null;
      }
      if (input.step <= 5) {
        clearData.step5AiResult = null;
        clearData.step5AiResultCn = null;
        clearData.step5UserEdit = null;
        clearData.step5Confirmed = 0;
        clearData.step5RunId = null;
        clearData.step5RunStatus = "idle";
        clearData.step5RunProgress = 0;
        clearData.step5RunError = null;
        clearData.step5RunStartedAt = null;
        clearData.step5RunCompletedAt = null;
        clearData.step5SelectedModule = null;
        clearData.step5OptimizedResult = null;
        clearData.step5OptimizedResultCn = null;
      }

      clearData.status = "in_progress";

      await db.updateImageWorkflowSession(session.id, clearData);
      void syncStepUnlockToAgent({
        agentRunId: session.agentRunId,
        stepNumber: input.step,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
      });
      return { success: true };
    }),
};
