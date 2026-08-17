import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import { ensureImageWorkflowAgentRun, syncStepUnlockToAgent } from "../imageWorkflowAgentBridge";
import { buildImageWorkflowReferenceTargets, normalizeImageOutline } from "@shared/imageWorkflow";
import { mergeStep4LatestWithUserAssets } from "../step4Snapshot";

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

async function applyCurrentStep4ImageVersions(session: any) {
  if (!session) return session;
  const versions = await db.getCurrentStep4ImageVersions(session.id);
  const base = mergeStep4LatestWithUserAssets(
    parseExportJson(session.step4UserEdit),
    parseExportJson(session.step4AiResult),
  ) || parseExportJson(session.step4UserEdit || session.step4AiResult);
  if (!versions.length || !session.step4Confirmed) {
    const rebuilt = rebuildStep4DisplaySnapshot(session, base);
    return { ...session, step4UserEdit: JSON.stringify(rebuilt), step4AiResult: JSON.stringify(rebuilt) };
  }
  const byIndex = new Map(versions.map((version: any) => [Number(version.imageIndex), parseExportJson(version.content)]));
  const imageReferences = (base.imageReferences || []).map((reference: any, index: number) => {
    const confirmed = byIndex.get(index);
    return confirmed ? { ...reference, ...confirmed, isLocked: true, lockedSnapshot: confirmed, lockedAt: confirmed.lockedAt || confirmed.confirmedAt } : reference;
  });
  const snapshot = { ...base, imageReferences };
  return { ...session, step4UserEdit: JSON.stringify(rebuildStep4DisplaySnapshot(session, snapshot)), step4AiResult: JSON.stringify(rebuildStep4DisplaySnapshot(session, snapshot)) };
}

export function rebuildStep4DisplaySnapshot(session: any, snapshot: Record<string, any>) {
  const outline = normalizeImageOutline(parseExportJson(session.step2UserEdit || session.step2AiResult));
  const targets = buildImageWorkflowReferenceTargets(outline || {}).filter((target: any) => target.imageType);
  if (!targets.length) return snapshot;
  const existing = Array.isArray(snapshot.imageReferences) ? snapshot.imageReferences : [];
  const historicalAplus = existing.filter((reference: any) => /^A\+模块/.test(String(reference?.imageType || "")));
  const historicalBrand = existing.find((reference: any) => /品牌故事/.test(String(reference?.imageType || "")));
  let aplusIndex = 0;
  return {
    ...snapshot,
    imageReferences: targets.map((target: any, index: number) => {
      const isAplus = /^A\+模块/.test(target.imageType);
      const isBrand = /品牌故事/.test(target.imageType);
      const matched = isAplus
        ? historicalAplus[aplusIndex++]
        : isBrand
          ? historicalBrand
          : existing.find((reference: any) => String(reference?.imageType || "") === target.imageType) || existing[index];
      const fallbackReference = !matched ? {
        imageKey: target.imageKey,
        compositionReference: isBrand
          ? {
            compositionType: "品牌叙事横幅构图",
            focalPoint: target.purpose || "品牌核心价值",
            layout: "以品牌核心场景为主视觉，辅以材料、服务或应用细节，形成从产品能力到品牌承诺的叙事路径",
            proportions: "品牌主视觉60%，核心承诺25%，信任元素15%",
            visualFlow: "品牌主视觉→核心承诺→信任与服务要素",
          }
          : {
            compositionType: "基于大纲的重点构图",
            focalPoint: target.purpose || "核心信息",
            layout: "围绕当前图片大纲的核心目标组织产品、场景和说明元素",
            proportions: "核心主体65%，说明元素20%，留白15%",
            visualFlow: "核心主体→关键信息→补充说明",
          },
        effectReference: {
          atmosphere: isBrand ? "专业、可信赖且具有品牌延续性的叙事氛围" : "与当前确认风格保持一致的专业视觉氛围",
          colorApplication: "继承当前确认的品牌主色、辅色与强调色，保证系列一致性",
          iconApplication: isBrand ? "品牌信任、材料或服务承诺图标" : "仅使用服务于核心卖点的简洁图标",
          lightingStyle: "与整套图片保持统一的产品与场景光线风格",
          textureStyle: "突出与卖点相关的材质和使用质感",
          typographyApplication: "沿用整套图片的层级、字重和可读性规范",
        },
        designNotes: "此目标在历史参考图结果中缺失，系统已按当前大纲生成可编辑的基础参考方案；可使用单图重新生成进一步获取AI推荐。",
        isBackfilledFromOutline: true,
      } : {};
      return {
        ...fallbackReference,
        ...(matched || {}),
        imageKey: target.imageKey,
        imageType: target.imageType,
        imageNumber: isAplus || isBrand ? 0 : (target.imageNumber || matched?.imageNumber || 0),
        parentModuleNumber: target.parentModuleNumber ?? matched?.parentModuleNumber ?? null,
        subModuleNumber: target.subModuleNumber ?? matched?.subModuleNumber ?? null,
        purpose: matched?.purpose || target.purpose || target.contentBrief || "",
        ...(isBrand ? { isBrandStory: true } : {}),
      };
    }),
  };
}

export const imageSessionProcedures = {


  // ─── Get or create workflow session ────────────────────────────
  getSession: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      const session = await resolveSessionForDisplay(input.projectId, ctx.user);
      return applyCurrentStep4ImageVersions(session);
    }),

  // ─── Complete export bundle (Step0-5 + selected reference assets) ─────────
  getExportBundle: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      const session = await applyCurrentStep4ImageVersions(await resolveSessionForDisplay(input.projectId, ctx.user));
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
