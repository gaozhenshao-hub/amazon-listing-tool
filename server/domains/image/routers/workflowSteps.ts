import * as shared from "../routerContext";
import type { Step5RunStatus } from "../routerContext";
import { BadRequestError, NotFoundError } from "@shared/_core/errors";
import { syncStepConfirmToAgent } from "../imageWorkflowAgentBridge";

const {
  APLUS_MODULE_STYLE_GUIDE,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
  STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT,
  STEP0_COMPETITOR_SUMMARY_PROMPT,
  STEP1_SELLING_POINTS_PROMPT,
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP2_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
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
  callImageWorkflowSkill,
  callLLMWithRetry,
  db,
  devDb,
  ensureWriteAccess,
  generateStep5RunId,
  getKBReference,
  isActiveStep5Run,
  kbDb,
  parseStoredJson,
  applyImageWorkflowAplusStyle,
  findImageWorkflowAplusModule,
  normalizeImageOutline,
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

function compactPromptText(value: unknown, maxChars: number) {
  const text = String(value || "").trim();
  if (text.length <= maxChars) return text;

  const tailChars = Math.min(1_500, Math.floor(maxChars * 0.2));
  const headChars = maxChars - tailChars;
  return `${text.slice(0, headChars)}\n\n[上下文已压缩，省略${text.length - maxChars}字符]\n\n${text.slice(-tailChars)}`;
}

export const imageWorkflowStepProcedures = {


  // ─── Step 1: Generate selling points ───────────────────────────
  generateStep1: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      let session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) {
        session = await db.createImageWorkflowSession({
          projectId: input.projectId,
          userId: ctx.user.id,
          currentStep: 1,
        });
      }

      const context = await buildImageWorkflowContext(input.projectId);
      // If context is empty, add a fallback hint so LLM can still generate content
      const contextHint = context.trim()
        ? context
        : "暂无竞品分析数据、评论数据或关键词数据。请根据产品名称、品牌和类目，结合你的亚马逊运营经验，自行推断并生成完整的卖点体系。";

      const userMsg = `请为以下产品梳理卖点体系：\n\n产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n${contextHint}`;

      let result = await callLLMWithRetry(STEP1_SELLING_POINTS_PROMPT, userMsg, 2, "image.step1.sellingpoints");
      await db.updateImageWorkflowSession(session.id, {
        step1AiResult: JSON.stringify(result),
        currentStep: 1,
      });
      return result;
    }),

  // ─── Step 1: Save user edits and confirm ───────────────────────
  confirmStep1: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(), // JSON string of edited selling points
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step1UserEdit: input.userEdit,
        step1Confirmed: 1,
        currentStep: 2,
      });
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 1,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: session.step1AiResult ? JSON.parse(session.step1AiResult) : null,
        userEdit: JSON.parse(input.userEdit),
      });
      return { success: true };
    }),


  // ─── Step 2: Generate image outline ────────────────────────────
  generateStep2: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw NotFoundError("项目不存在");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step2.generate:${input.projectId}`);
      if (!session) throw NotFoundError("图片建议工作流不存在");
      if (!session.step1Confirmed) throw BadRequestError("请先确认 Step 1 卖点梳理");

      const sellingPoints = compactPromptText(session.step1UserEdit || session.step1AiResult, 8_000);
      const context = compactPromptText(await buildImageWorkflowContext(input.projectId), 12_000);


      // Load Step0 competitor summary if available
      const step0Summary = session.step0AiResult
        ? `\n\n--- 竞品图片分析总结 ---\n${compactPromptText(session.step0AiResult, 3_000)}`
        : "";

      const contextHint2 = context.trim()
        ? context
        : "暂无竞品分析数据。请根据产品名称、品牌和类目，结合亚马逊运营经验，自行推断并生成完整的图片大纲。";

      const userMsg2 = `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${sellingPoints}\n\n--- 产品背景信息 ---\n${contextHint2}${step0Summary}\n\n--- 可选亚马逊A+模块样式 ---\n${APLUS_MODULE_STYLE_GUIDE}\n\n请根据以上卖点体系和竞品分析规划图片大纲。secondaryImages必须恰好生成6项，imageNumber依次为2、3、4、5、6、7，并在referenceHighlights中引用竞品亮点。首次生成时所有A+模块一律使用premium_full_image（高级完整图片、1464x600px、单张全宽大图），不要自行选择其他模块；用户改选后会通过专用皇帝Skill单独重新优化。`;

      const result = await callImageWorkflowSkill({
        skillSlug: "image.step2.outline",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
        systemPrompt: STEP2_IMAGE_OUTLINE_PROMPT,
        context: userMsg2,
        validate: (value) => {
          const rawSecondaryImages = Array.isArray(value?.secondaryImages) ? value.secondaryImages : [];
          const substantiveImages = rawSecondaryImages.filter((image: any) =>
            String(image?.purpose || "").trim() || String(image?.contentBrief || "").trim(),
          );
          const validImageNumbers = new Set(
            substantiveImages
              .map((image: any) => Number(image?.imageNumber))
              .filter((imageNumber: number) => imageNumber >= 2 && imageNumber <= 7),
          );
          if (substantiveImages.length < 5 || validImageNumbers.size < 5) {
            throw new Error("图片大纲必须完整包含辅图2-7");
          }
          const normalized = normalizeImageOutline(value, {
            forceDefaultAplus: true,
            recoverMissingSecondaryContent: true,
          });
          const incompleteImage = normalized.secondaryImages.find((image: any) =>
            !String(image?.purpose || "").trim() || !String(image?.contentBrief || "").trim(),
          );
          if (incompleteImage) throw new Error(`图片大纲缺少辅图${incompleteImage.imageNumber}的完整内容`);
          return normalized;
        },
      });
      await db.updateImageWorkflowSession(session.id, {
        step2AiResult: JSON.stringify(result),
        currentStep: 2,
      });

      return result;
    }),


  // ─── Step 2: Save user edits and confirm ───────────────────────
  confirmStep2: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw NotFoundError("图片建议工作流不存在");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      let parsed: any;
      try {
        parsed = JSON.parse(input.userEdit);
      } catch {
        throw BadRequestError("图片大纲数据格式无效，请重新生成后再确认");
      }
      const normalized = normalizeImageOutline(parsed);
      const incompleteImage = normalized.secondaryImages.find((image: any) =>
        !String(image?.purpose || "").trim() || !String(image?.contentBrief || "").trim(),
      );
      if (incompleteImage) {
        throw BadRequestError(`请补全辅图${incompleteImage.imageNumber}的目的和内容后再确认`, {
          imageNumber: incompleteImage.imageNumber,
        });
      }

      await db.updateImageWorkflowSession(session.id, {
        step2UserEdit: JSON.stringify(normalized),
        step2Confirmed: 1,
        currentStep: 3,
      });
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 2,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: session.step2AiResult ? JSON.parse(session.step2AiResult) : null,
        userEdit: normalized,
      });
      return { success: true };
    }),


  // ─── Step 2: Re-optimize one A+ module after the user changes style ─
  optimizeStep2AplusModule: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      moduleIndex: z.number().int().min(0),
      moduleType: z.string().min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step2.aplus.optimize:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");
      if (session.step2Confirmed) throw new Error("请先解锁图片大纲，再调整A+模块");

      const selectedModule = findImageWorkflowAplusModule(input.moduleType);
      if (!selectedModule) throw new Error("不支持的A+模块样式");

      const storedOutline = parseStoredJson(session.step2UserEdit || session.step2AiResult) as Record<string, any> | null;
      if (!storedOutline) throw new Error("请先生成图片大纲");
      const outline = normalizeImageOutline(storedOutline);
      const currentModule = outline.aPlusModules?.[input.moduleIndex];
      if (!currentModule) throw new Error("A+模块不存在");

      if (currentModule.selectedModuleType === selectedModule.id) {
        return { outline, module: currentModule };
      }

      const context = `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || "未指定"}\n类目: ${project.category || "未指定"}\n\n--- 已确认卖点体系 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 当前A+模块 ---\n${JSON.stringify(currentModule)}\n\n--- 用户选择的目标模块 ---\n${JSON.stringify(selectedModule)}\n\n请只按目标模块结构重新优化当前这一个A+模块。`;
      const optimized = await callImageWorkflowSkill({
        skillSlug: "image.step2.aplus.single.optimize",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
        systemPrompt: STEP2_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
        context,
        validate: (value) => {
          if (!value || typeof value !== "object" || Array.isArray(value)) {
            throw new Error("A+模块优化结果无效");
          }
          return value;
        },
      });

      const mergedModule = {
        ...currentModule,
        ...optimized,
        moduleNumber: currentModule.moduleNumber ?? input.moduleIndex + 1,
        moduleOptimizedForType: selectedModule.id,
      };
      outline.aPlusModules[input.moduleIndex] = applyImageWorkflowAplusStyle(mergedModule, selectedModule.id);

      await db.updateImageWorkflowSession(session.id, {
        step2UserEdit: JSON.stringify(outline),
        currentStep: 2,
      });

      return { outline, module: outline.aPlusModules[input.moduleIndex] };
    }),


  // ─── Step 2: Unlock outline without deleting the current draft ──
  unlockStep2: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step2Confirmed: 0,
        currentStep: 2,
        step3AiResult: null,
        step3UserEdit: null,
        step3Confirmed: 0,
        step4AiResult: null,
        step4UserEdit: null,
        step4Confirmed: 0,
        step4CompositionRefs: null,
        step4EffectRefs: null,
        step5AiResult: null,
        step5AiResultCn: null,
        step5UserEdit: null,
        step5Confirmed: 0,
        step5RunId: null,
        step5RunStatus: "idle",
        step5RunProgress: 0,
        step5RunError: null,
        step5RunStartedAt: null,
        step5RunCompletedAt: null,
        step5SelectedModule: null,
        step5OptimizedResult: null,
        step5OptimizedResultCn: null,
        status: "in_progress",
      });

      return { success: true };
    }),


  // ─── Step 3: Generate style recommendations ───────────────────
  generateStep3: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step3.generate:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");
      if (!session.step2Confirmed) throw new Error("Step 2 not confirmed yet");

            // Load product profile for color info
      const profile = await devDb.getDevProductProfile(input.projectId);
      let colorInfo = "";
      if (profile?.appearanceColors) {
        try {
          colorInfo = `产品外观颜色: ${profile.appearanceColors}`;
        } catch {}
      }
      // Phase 7: Get KB reference for style recommendations
      const kbReference = await getKBReference(project.category || '', ctx.user.id);

      // 从知识库获取现有设计风格列表（按类目过滤，限制50个）
      let kbStylesText = "";
      try {
        const catImages = await kbDb.listAllImages(ctx.user.id, "all", {
          tagCategory: project.category || undefined,
        });
        const kbStyles = [...new Set(
          (catImages as any[]).map((i: any) => i.tagDesignStyleV2 || i.tagDesignStyle).filter(Boolean)
        )].slice(0, 50);
        if (kbStyles.length > 0) {
          kbStylesText = `\n\n--- 知识库现有设计风格（请优先从这些风格中推荐）---\n${kbStyles.join("、")}`;
        }
      } catch (e) { console.warn("[Step3] Failed to load KB styles:", e); }

      // 内容裁剪：防止 Prompt 过大导致 LLM 返回空/非 JSON
      const truncateStr = (s: string | null | undefined, max: number) =>
        s ? (s.length > max ? s.slice(0, max) + "…(已截断)" : s) : "";

      // step2 内容：先尝试 parseJSON 规范化，再限制 8k 字符
      let step2Content: string;
      try {
        const step2Raw = session.step2UserEdit || session.step2AiResult;
        const step2Parsed = step2Raw ? JSON.parse(step2Raw) : null;
        step2Content = step2Parsed ? JSON.stringify(step2Parsed, null, 0) : String(step2Raw || "");
      } catch {
        step2Content = String(session.step2UserEdit || session.step2AiResult || "");
      }
      step2Content = truncateStr(step2Content, 8000);
      const step1Content = truncateStr(session.step1UserEdit || session.step1AiResult, 3000);
      const kbRef2 = truncateStr(kbReference, 2000);

      const userMsg3 = `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n${colorInfo}\n\n--- 已确认的卖点 ---\n${step1Content}\n\n--- 已确认的图片大纲 ---\n${step2Content}${kbRef2}${kbStylesText}\n\n请参考知识库中同类目高分图片的风格分布，推荐3-4个适合的视觉风格方案。`;
      console.log(`[Step3] prompt length: ${userMsg3.length}, step2: ${step2Content.length}, kbRef: ${kbRef2.length}, kbStyles: ${kbStylesText.length}`);
      const result = await callLLMWithRetry(STEP3_STYLE_PROMPT, userMsg3, 2, "image.step3.style");
      await db.updateImageWorkflowSession(session.id, {
        step3AiResult: JSON.stringify(result),
        currentStep: 3,
      });

      return result;
    }),


  // ─── Step 3: Save user selection and confirm ──────────────────
  confirmStep3: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(), // JSON: selected style IDs and any modifications
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step3UserEdit: input.userEdit,
        step3Confirmed: 1,
        currentStep: 4,
      });
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 3,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: session.step3AiResult ? JSON.parse(session.step3AiResult) : null,
        userEdit: JSON.parse(input.userEdit),
      });
      return { success: true };
    }),


  // ─── Step 4: Generate reference image recommendations ─────────
  generateStep4: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step4.generate:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");
      if (!session.step3Confirmed) throw new Error("Step 3 not confirmed yet");

      // Try to load knowledge base images for reference
      let kbImageInfo = "";
      try {
        const kbImages = await kbDb.listAllImages(ctx.user.id, "mine", {});
        if (kbImages.length > 0) {
          kbImageInfo = "\n--- 知识库图片参考 ---\n";
          kbImageInfo += kbImages.slice(0, 20).map((img: any) =>
            `[${img.tagImageType || '未分类'}] ${img.tagCategory || ''} - ${img.tagDesignStyle || ''} (${img.imagePosition || ''})`
          ).join("\n");
        }
      } catch {}


      const step4Context = `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的图片大纲 ---\n${session.step2UserEdit || session.step2AiResult}\n\n--- 已确认的风格方案 ---\n${session.step3UserEdit || session.step3AiResult}\n${kbImageInfo}\n\n请为主图、全部辅图2-7和每个A+模块推荐构图参考和效果图参考，不得遗漏辅图7。若图片大纲中的A+模块包含selectedModuleType/selectedModuleName/selectedModuleStructure，必须按该模块结构生成参考：轮播模块拆成每个面板的构图/效果参考，四图模块拆成4张子图，热点模块包含底图和各热点位置，比较表模块包含产品列和特征行布局。`;
      const result = await callImageWorkflowSkill({
        skillSlug: "image.step4.reference",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
        systemPrompt: STEP4_REFERENCE_PROMPT,
        context: step4Context,
        validate: (value) => {
          const references = Array.isArray(value?.imageReferences) ? value.imageReferences : [];
          const secondaryNumbers = new Set(
            references
              .filter((reference: any) => !String(reference?.imageType || "").toLowerCase().includes("a+"))
              .map((reference: any) => Number(reference?.imageNumber)),
          );
          if ([2, 3, 4, 5, 6, 7].some((imageNumber) => !secondaryNumbers.has(imageNumber))) {
            throw new Error("构图参考必须完整覆盖辅图2-7");
          }
          return value;
        },
      });
      await db.updateImageWorkflowSession(session.id, {
        step4AiResult: JSON.stringify(result),
        currentStep: 4,
      });

      return result;
    }),


  // ─── Step 4: Save user edits and confirm ──────────────────────
  confirmStep4: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step4UserEdit: input.userEdit,
        step4Confirmed: 1,
        currentStep: 5,
      });
      void syncStepConfirmToAgent({
        agentRunId: session.agentRunId,
        stepNumber: 4,
        projectId: input.projectId,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId ?? null,
        aiResult: session.step4AiResult ? JSON.parse(session.step4AiResult) : null,
        userEdit: JSON.parse(input.userEdit),
      });
      return { success: true };
    }),
};
