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

function mergeStep4DraftVersions(confirmedRaw: unknown, latestRaw: unknown) {
  const confirmed = parseStoredJson(String(confirmedRaw || "{}")) as Record<string, any> | null;
  const latest = parseStoredJson(String(latestRaw || "{}")) as Record<string, any> | null;
  if (!confirmed && !latest) return null;
  if (!confirmed) return latest;
  if (!latest) return confirmed;

  const confirmedRefs: any[] = confirmed.imageReferences || [];
  const latestRefs: any[] = latest.imageReferences || [];
  const imageReferences = Array.from({ length: Math.max(confirmedRefs.length, latestRefs.length) }, (_, index) => {
    const confirmedRef = confirmedRefs[index] || {};
    const latestRef = latestRefs[index] || {};
    return {
      ...confirmedRef,
      ...latestRef,
      compositionRefImageUrl: confirmedRef.compositionRefImageUrl || latestRef.compositionRefImageUrl,
      effectRefImageUrl: confirmedRef.effectRefImageUrl || latestRef.effectRefImageUrl,
      kbReferenceImages: confirmedRef.kbReferenceImages || latestRef.kbReferenceImages,
      imageNumber: confirmedRef.imageNumber ?? latestRef.imageNumber,
      imageType: confirmedRef.imageType ?? latestRef.imageType,
      purpose: confirmedRef.purpose ?? latestRef.purpose,
    };
  });
  return { ...confirmed, ...latest, imageReferences };
}

export const imageReferenceProcedures = {

  // ─── Step 4: Persist an editable draft without locking the step ─────────
  saveStep4Draft: protectedProcedure
    .input(z.object({ projectId: z.number(), userEdit: z.string().min(2) }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      const draft = parseStoredJson(input.userEdit) as Record<string, any> | null;
      if (!Array.isArray(draft?.imageReferences)) throw new Error("Step4 草稿缺少图片参考方案");

      await db.updateImageWorkflowSession(session.id, {
        step4UserEdit: input.userEdit,
        step4Confirmed: 0,
        currentStep: 4,
        status: "in_progress",
      });
      return { success: true };
    }),

  confirmStep4ImageVersion: protectedProcedure
    .input(z.object({ projectId: z.number(), imageIndex: z.number().int().min(0), content: z.string().min(2) }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      const reference = parseStoredJson(input.content) as Record<string, any> | null;
      if (!reference) throw new Error("单图确认内容无效");
      const version = await db.confirmStep4ImageVersion({ sessionId: session.id, projectId: input.projectId, userId: ctx.user.id, imageIndex: input.imageIndex, imageKey: `step4-ref-${input.imageIndex}`, content: JSON.stringify(reference) });
      return { success: true, version };
    }),

  unlockStep4ImageVersion: protectedProcedure
    .input(z.object({ projectId: z.number(), imageIndex: z.number().int().min(0) }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      await db.unlockStep4ImageVersion(session.id, input.imageIndex);
      return { success: true };
    }),

  // ─── Step 4: Unlock while retaining the confirmed plan and selected refs ─
  unlockStep4ForEditing: protectedProcedure
    .input(z.object({ projectId: z.number(), userEdit: z.string().min(2).optional() }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);
      const visibleSnapshot = input.userEdit ? parseStoredJson(input.userEdit) as Record<string, any> | null : null;
      const draft = visibleSnapshot?.imageReferences?.length
        ? visibleSnapshot
        : mergeStep4DraftVersions(session.step4UserEdit, session.step4AiResult);
      if (!draft) throw new Error("当前没有可编辑的参考图方案");
      const userEdit = JSON.stringify(draft);

      await db.updateImageWorkflowSession(session.id, {
        step4UserEdit: userEdit,
        step4Confirmed: 0,
        currentStep: 4,
        status: "in_progress",
      });
      return { success: true, userEdit };
    }),


  // ─── Step 4: Upload composition/effect reference images ────────
  uploadStep4RefImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageKey: z.string(), // e.g. "mainImage", "secondary-2", "aplus-1"
      refType: z.enum(["composition", "effect"]),
      imageData: z.string(), // base64 encoded image data
      fileName: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      // Upload to S3
      const buffer = Buffer.from(input.imageData, "base64");
      const ext = input.fileName.split(".").pop() || "png";
      const key = `image-workflow/${input.projectId}/step4-refs/${input.refType}-${input.imageKey}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, buffer, `image/${ext}`);

      // Update the refs JSON in DB
      const field = input.refType === "composition" ? "step4CompositionRefs" : "step4EffectRefs";
      const existingRefs = session[field] ? JSON.parse(session[field] as string) : {};
      existingRefs[input.imageKey] = url;

      await db.updateImageWorkflowSession(session.id, {
        [field]: JSON.stringify(existingRefs),
      });

      return { url, imageKey: input.imageKey, refType: input.refType };
    }),


  // ─── Step 4: Re-optimize single image reference with uploaded refs ─
  reoptimizeStep4WithRefs: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageKey: z.string(),
      compositionRefUrl: z.string().optional(),
      effectRefUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step4.refs.optimize:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");

      // Build context with reference images
      const messages: any[] = [
        { role: "system", content: STEP4_REOPTIMIZE_WITH_REFS_PROMPT },
      ];

      const userContent: any[] = [];
      userContent.push({
        type: "text",
        text: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n\n--- 已确认的图片大纲 ---\n${session.step2UserEdit || session.step2AiResult}\n\n--- 已确认的风格方案 ---\n${session.step3UserEdit || session.step3AiResult}\n\n--- 当前图片参考方案 ---\n${session.step4AiResult}\n\n目标图片: ${input.imageKey}\n\n请根据上传的参考图重新优化该图的构图参考和效果参考方案。`,
      });

      if (input.compositionRefUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: input.compositionRefUrl, detail: "high" },
        });
        userContent.push({ type: "text", text: "[上面是构图参考图]" });
      }
      if (input.effectRefUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: input.effectRefUrl, detail: "high" },
        });
        userContent.push({ type: "text", text: "[上面是效果参考图]" });
      }

      messages.push({ role: "user", content: userContent });


      const response = await invokeBusinessSkill({
        messages,
        response_format: { type: "json_object" },
        emperorSkill: { slug: "image.step4.reoptimize" },
      });

      // Parse AI result and merge with the existing image ref to preserve client-side fields
      const aiResult = parseLLMJson(response);
      // Get the current image ref from session to preserve uploaded URLs
      const currentStep4 = parseStoredJson(session.step4UserEdit || session.step4AiResult || "{}") as Record<string, any> | null;
      const imageRefs: any[] = (currentStep4 as any)?.imageReferences || [];
      const targetKey = input.imageKey; // e.g. "step4-ref-2"
      // Find the matching ref by imageKey or by index extracted from key
      const idxMatch = targetKey.match(/step4-ref-(\d+)/);
      const targetIdx = idxMatch ? parseInt(idxMatch[1], 10) : -1;
      const existingRef = targetIdx >= 0 ? imageRefs[targetIdx] : null;
      // Merge: AI fields override, but preserve client-side image URLs
      const merged = {
        ...(existingRef || {}),
        ...aiResult,
        compositionRefImageUrl: existingRef?.compositionRefImageUrl,
        effectRefImageUrl: existingRef?.effectRefImageUrl,
        kbReferenceImages: existingRef?.kbReferenceImages,
        imageNumber: existingRef?.imageNumber ?? aiResult?.imageNumber,
        imageType: existingRef?.imageType ?? aiResult?.imageType,
        purpose: existingRef?.purpose ?? aiResult?.purpose,
      };
      const updatedRefs = [...imageRefs];
      if (targetIdx >= 0) updatedRefs[targetIdx] = merged;
      const updatedResult = { ...(currentStep4 || {}), imageReferences: updatedRefs };
      await db.updateImageWorkflowSession(session.id, {
        step4AiResult: JSON.stringify(updatedResult),
        step4UserEdit: JSON.stringify(updatedResult),
        step4Confirmed: 0,
      });
      return merged;
    }),


  // ─── Step 4: Regenerate ALL image references from KB refs + notes ─
  regenerateAllFromReferences: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      kbImages: z.array(z.object({
        url: z.string(),
        note: z.string().optional(),
        position: z.string().optional(),
      })),
      compositionRefUrl: z.string().optional(),
      effectRefUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.references.regenerate-all:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");

      // Build multimodal messages with all reference images + notes
      const userContent: any[] = [];

      // Text context
      userContent.push({
        type: "text",
        text: `产品名称: ${project.productName || project.name}
品牌: ${project.brand || '未指定'}

--- 已确认的图片大纲 ---
${session.step2UserEdit || session.step2AiResult}

--- 已确认的风格方案 ---
${session.step3UserEdit || session.step3AiResult}

请根据以下参考图和备注，重新生成完整的图片参考方案（imageReferences数组）。`,
      });

      // Add KB reference images with notes
      let kbImageIndex = 1;
      for (const kbImg of input.kbImages) {
        userContent.push({
          type: "image_url",
          image_url: { url: kbImg.url, detail: "high" },
        });
        const noteText = kbImg.note
          ? `[知识库参考图${kbImageIndex}，备注: ${kbImg.note}${kbImg.position ? '，图片位置: ' + kbImg.position : ''}]`
          : `[知识库参考图${kbImageIndex}${kbImg.position ? '，图片位置: ' + kbImg.position : ''}]`;
        userContent.push({ type: "text", text: noteText });
        kbImageIndex++;
      }

      // Add composition ref if provided
      if (input.compositionRefUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: input.compositionRefUrl, detail: "high" },
        });
        userContent.push({ type: "text", text: "[构图参考图：请参考此图的构图布局]" });
      }

      // Add effect ref if provided
      if (input.effectRefUrl) {
        userContent.push({
          type: "image_url",
          image_url: { url: input.effectRefUrl, detail: "high" },
        });
        userContent.push({ type: "text", text: "[效果参考图：请参考此图的视觉效果和风格]" });
      }

      const messages: any[] = [
        { role: "system", content: STEP4_REFERENCE_PROMPT },
        { role: "user", content: userContent },
      ];


      const response = await invokeBusinessSkill({
        messages,
        response_format: { type: "json_object" },
        emperorSkill: { slug: "image.step4.reference" },
      });

      const result = parseLLMJson(response);

      // Save the regenerated result back to session
      await db.updateImageWorkflowSession(session.id, {
        step4AiResult: JSON.stringify(result),
      });

      return result;
    }),


  // ─── Step 4: Regenerate single image from references ──────────────
  regenerateSingleImageFromRef: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageIndex: z.number(),
      kbImages: z.array(z.object({
        url: z.string(),
        note: z.string().optional(),
        position: z.string().optional(),
      })),
      compositionRefUrl: z.string().optional(),
      effectRefUrl: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.references.regenerate-one:${input.projectId}:${input.imageIndex}`);
      if (!session) throw new Error("No workflow session found");

      // Parse current step4 result to get the specific image info
      let currentStep4: any = {};
      try {
        const raw = session.step4UserEdit || session.step4AiResult;
        if (raw) currentStep4 = JSON.parse(raw);
      } catch {}
      const imageRefs = currentStep4.imageReferences || [];
      const targetImage = imageRefs[input.imageIndex];
      if (!targetImage) throw new Error(`Image at index ${input.imageIndex} not found`);

      // Build multimodal messages for single image regeneration
      const userContent: any[] = [];
      userContent.push({
        type: "text",
        text: `产品名称: ${project.productName || project.name}
品牌: ${project.brand || "未指定"}
--- 已确认的图片大纲 ---
${session.step2UserEdit || session.step2AiResult}
--- 已确认的风格方案 ---
${session.step3UserEdit || session.step3AiResult}

**任务：仅重新生成第${input.imageIndex + 1}张图（${targetImage.imageType || ""}，目的：${targetImage.purpose || ""}）的参考方案。**
请根据以下参考图和备注，重新生成该张图的构图参考和效果图参考。
返回格式与原来相同，直接返回一个 imageReference 对象（JSON），不要包裹在数组中。`,
      });

      let kbImageIndex = 1;
      for (const kbImg of input.kbImages) {
        userContent.push({ type: "image_url", image_url: { url: kbImg.url, detail: "high" } });
        const noteText = kbImg.note
          ? `[知识库参考图${kbImageIndex}，备注: ${kbImg.note}${kbImg.position ? "，图片位置: " + kbImg.position : ""}]`
          : `[知识库参考图${kbImageIndex}${kbImg.position ? "，图片位置: " + kbImg.position : ""}]`;
        userContent.push({ type: "text", text: noteText });
        kbImageIndex++;
      }
      if (input.compositionRefUrl) {
        userContent.push({ type: "image_url", image_url: { url: input.compositionRefUrl, detail: "high" } });
        userContent.push({ type: "text", text: "[构图参考图：请参考此图的构图布局]" });
      }
      if (input.effectRefUrl) {
        userContent.push({ type: "image_url", image_url: { url: input.effectRefUrl, detail: "high" } });
        userContent.push({ type: "text", text: "[效果参考图：请参考此图的视觉效果和风格]" });
      }

      const singleImagePrompt = STEP4_REFERENCE_PROMPT + "\n\n注意：本次只需输出单张图的方案，直接返回一个 imageReference 对象（JSON），不要包裹在数组中。";
      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: singleImagePrompt },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
        emperorSkill: { slug: "image.step4.reference" },
      });
      const newImageRef = parseLLMJson(response);

      // Merge back into the full step4 result
      const updatedRefs = [...imageRefs];
      const mergedRef = newImageRef.imageReferences?.[0] || newImageRef;
      mergedRef.imageNumber = targetImage.imageNumber ?? (input.imageIndex + 1);
      // Preserve client-side fields that AI doesn't return
      updatedRefs[input.imageIndex] = {
        ...mergedRef,
        compositionRefImageUrl: targetImage.compositionRefImageUrl,
        effectRefImageUrl: targetImage.effectRefImageUrl,
        kbReferenceImages: targetImage.kbReferenceImages,
        imageNumber: targetImage.imageNumber ?? mergedRef.imageNumber ?? (input.imageIndex + 1),
        imageType: targetImage.imageType ?? mergedRef.imageType,
        purpose: targetImage.purpose ?? mergedRef.purpose,
      };

      const updatedResult = { ...currentStep4, imageReferences: updatedRefs };
      await db.updateImageWorkflowSession(session.id, {
        step4AiResult: JSON.stringify(updatedResult),
      });
      return { updatedResult, regeneratedIndex: input.imageIndex, newImageRef: mergedRef };
    }),




  // ─── Step 5: Optimize with A+ module selection ────────────────────
  optimizeWithAplusModule: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      selectedModules: z.array(z.object({
        moduleType: z.string(),
        moduleName: z.string(),
        position: z.number(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step5.aplus.optimize:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");
      if (!session.step5AiResult) throw new Error("Step 5 not generated yet");

      const currentSuggestions = session.step5UserEdit || session.step5OptimizedResult || session.step5AiResult;


      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: STEP5_APLUS_MODULE_OPTIMIZE_PROMPT },
          {
            role: "user",
            content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 当前图片建议 ---\n${currentSuggestions}\n\n--- 用户选择的A+模块 ---\n${JSON.stringify(input.selectedModules)}\n\n请根据用户选择的A+模块类型，重新优化A+内容部分的建议，严格按照各模块的规格要求（尺寸、字符数限制）来输出内容。`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);

      const optimizedEn = result.en || result;
      const optimizedCn = result.cn || null;
      await db.updateImageWorkflowSession(session.id, {
        step5SelectedModule: JSON.stringify(input.selectedModules),
        step5OptimizedResult: JSON.stringify(optimizedEn),
        step5OptimizedResultCn: optimizedCn ? JSON.stringify(optimizedCn) : null,
        step5UserEdit: JSON.stringify(optimizedEn),
        step5AiResultCn: optimizedCn ? JSON.stringify(optimizedCn) : session.step5AiResultCn,
      });

      return result;
    }),


  // ─── Step 5c: Optimize single A+ section with specific module style ──
  optimizeSingleAplusModule: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      sectionIndex: z.number().min(0),
      moduleType: z.string(),
      moduleName: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step5.aplus.optimize-one:${input.projectId}:${input.sectionIndex}`);
      if (!session) throw new Error("No workflow session found");
      if (!session.step5AiResult) throw new Error("Step 5 not generated yet");

      const storedCandidates = [session.step5UserEdit, session.step5OptimizedResult, session.step5AiResult].filter(Boolean);
      let currentData: any = null;
      let currentSection: any = null;
      for (const stored of storedCandidates) {
        try {
          const parsed = JSON.parse(stored!);
          const section = parsed?.aPlusContent?.sections?.[input.sectionIndex];
          if (section) { currentData = parsed; currentSection = section; break; }
        } catch { /* 尝试下一个完整版本 */ }
      }
      if (!currentData || !currentSection) {
        throw new Error(`A+模块 ${input.sectionIndex + 1} 缺少可优化内容，请先生成完整图片建议后再试`);
      }

      const styleGuide = (APLUS_MODULE_STYLE_GUIDE as Record<string, any>)[input.moduleType] || {};
      const normalizedStyle = {
        id: input.moduleType,
        name: input.moduleName || styleGuide.name || input.moduleType,
        category: styleGuide.category || currentSection.selectedModuleCategory || "A+内容模块",
        specs: styleGuide.specs || styleGuide.size || currentSection.selectedModuleSpecs || null,
        structure: styleGuide.structure || currentSection.selectedModuleStructure || null,
      };

      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT },
          {
            role: "user",
            content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 当前该模块的建议内容 ---\n${JSON.stringify(currentSection)}\n\n--- 用户为该模块选择的A+样式（已归一化） ---\n${JSON.stringify(normalizedStyle)}\n模块位置: A+模块 ${input.sectionIndex + 1}\n\n请只返回一个可合并的A+模块JSON对象，保留原模块的moduleNumber、purpose、sellingPointRefs和position，并严格适配目标样式结构。`,
          },
        ],
        response_format: { type: "json_object" },
        emperorSkill: { slug: "image.step2.aplus.single.optimize" },
      });

      const result = parseLLMJson(response);
      const optimizedSectionEn = result.en || result.section || result.module || result;
      const optimizedSectionCn = result.cn || null;
      const sections = [...(currentData.aPlusContent?.sections || [])];
      sections[input.sectionIndex] = {
        ...sections[input.sectionIndex],
        ...optimizedSectionEn,
        selectedModuleType: input.moduleType,
        selectedModuleName: normalizedStyle.name,
        selectedModuleCategory: normalizedStyle.category,
        selectedModuleSpecs: normalizedStyle.specs,
        selectedModuleStructure: normalizedStyle.structure,
      };
      const nextData = { ...currentData, aPlusContent: { ...currentData.aPlusContent, sections } };

      let nextCnData: any | null = null;
      if (optimizedSectionCn) {
        try {
          const rawCn = session.step5AiResultCn || session.step5OptimizedResultCn || "";
          nextCnData = rawCn ? JSON.parse(rawCn) : null;
          if (nextCnData?.aPlusContent?.sections) {
            const cnSections = [...nextCnData.aPlusContent.sections];
            cnSections[input.sectionIndex] = { ...cnSections[input.sectionIndex], ...optimizedSectionCn };
            nextCnData = { ...nextCnData, aPlusContent: { ...nextCnData.aPlusContent, sections: cnSections } };
          }
        } catch {
          nextCnData = null;
        }
      }

      await db.updateImageWorkflowSession(session.id, {
        step5UserEdit: JSON.stringify(nextData),
        step5OptimizedResult: JSON.stringify(nextData),
        step5OptimizedResultCn: nextCnData ? JSON.stringify(nextCnData) : session.step5OptimizedResultCn,
        step5AiResultCn: nextCnData ? JSON.stringify(nextCnData) : session.step5AiResultCn,
      });
      return { en: optimizedSectionEn, cn: optimizedSectionCn };
    }),


  // ─── Step 5d: Recommend A+ module combination ───────────────────
  recommendAplusCombo: protectedProcedure
    .input(z.object({
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionForExecution(input.projectId, ctx.user, `image.step5.aplus.recommend:${input.projectId}`);
      if (!session) throw new Error("No workflow session found");

      // Gather product context
      const sellingPoints = session.step1UserEdit || session.step1AiResult || '';
      let spCount = 0;
      try {
        const spData = JSON.parse(sellingPoints);
        spCount = (spData.coreSellingPoints?.length || 0) + (spData.secondarySellingPoints?.length || 0);
      } catch { spCount = 5; }


      const response = await invokeBusinessSkill({
        messages: [
          { role: "system", content: STEP5_APLUS_COMBO_RECOMMEND_PROMPT },
          {
            role: "user",
            content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n卖点数量: ${spCount}个\n\n--- 已确认的卖点体系 ---\n${sellingPoints}\n\n请根据以上产品信息，推荐3套最佳的A+模块组合方案。`,
          },
        ],
        response_format: { type: "json_object" },
      });

      return parseLLMJson(response);
    }),


  // ─── Step 5: Designer Upload (artwork images) ───────────────────
  addDesignerUpload: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageUrl: z.string(),
      imageNumber: z.string(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error('Project not found');
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error('No workflow session found');
      let uploads: any[] = [];
      try { uploads = JSON.parse(session.step5DesignerUploads || '[]'); } catch {}
      const idx = uploads.findIndex((u: any) => u.imageNumber === input.imageNumber);
      const entry = { id: Date.now(), imageUrl: input.imageUrl, imageNumber: input.imageNumber, notes: input.notes || '', uploadedAt: new Date().toISOString() };
      if (idx >= 0) uploads[idx] = entry;
      else uploads.push(entry);
      await db.updateImageWorkflowSession(session.id, { step5DesignerUploads: JSON.stringify(uploads) });
      return { success: true, uploads };
    }),


  removeDesignerUpload: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageNumber: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error('Project not found');
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error('No workflow session found');
      let uploads: any[] = [];
      try { uploads = JSON.parse(session.step5DesignerUploads || '[]'); } catch {}
      uploads = uploads.filter((u: any) => u.imageNumber !== input.imageNumber);
      await db.updateImageWorkflowSession(session.id, { step5DesignerUploads: JSON.stringify(uploads) });
      return { success: true, uploads };
    }),


  // ─── Refine single image suggestion ─────────────────────────────
  refineSingleImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageType: z.enum(["mainImage", "secondaryImage", "aPlusSection"]),
      imageIndex: z.number().optional(), // index for secondary/aplus
      currentContent: z.string(), // JSON string of current image data
      instruction: z.string(), // user's refinement instruction
      lockedFields: z.array(z.string()).optional(), // fields to keep unchanged
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionForExecution(
        input.projectId,
        ctx.user,
        `image.refine:${input.projectId}:${input.imageType}:${input.imageIndex ?? 0}`,
      );
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      const imageTypeLabel = input.imageType === "mainImage" ? "主图 (Main Image)"
        : input.imageType === "secondaryImage" ? `辅图 ${(input.imageIndex || 0) + 2} (Secondary Image)`
        : `A+ 模块 ${(input.imageIndex || 0) + 1} (A+ Content Section)`;

      // Get the confirmed style for context
      const styleContext = session.step3UserEdit || session.step3AiResult || "";

      // Build locked fields instruction
      const lockedFieldsInstruction = input.lockedFields && input.lockedFields.length > 0
        ? `\n\n🔒 锁定字段（以下字段必须与原内容完全一致，严禁修改）：\n${input.lockedFields.map(f => `- ${f}`).join("\n")}\n\n即使用户的修改指令涉及这些字段，也必须保持原值不变。只能修改未锁定的字段。`
        : "";


      const response = await invokeBusinessSkill({
        messages: [
          {
            role: "system",
            content: `你是一位拥有10年设计经验的亚马逊运营专家。用户需要微调一张图片的建议内容。\n\n重要规则：\n1. 仅修改用户指定的部分，保持其他内容不变\n2. 保持与整体风格方案的一致性\n3. 输出格式必须与输入格式完全一致（相同的JSON字段结构）\n4. 同时输出英文版和中文版\n5. 返回JSON格式: { "en": {...修改后的英文版}, "cn": {...修改后的中文版} }${lockedFieldsInstruction}\n\n当前风格方案参考:\n${styleContext}`,
          },
          {
            role: "user",
            content: `图片类型: ${imageTypeLabel}\n\n当前内容:\n${input.currentContent}\n\n用户修改指令: ${input.instruction}${input.lockedFields && input.lockedFields.length > 0 ? `\n\n🔒 请注意：以下字段已被用户锁定，必须保持原值不变：${input.lockedFields.join("、")}` : ""}\n\n请根据用户的修改指令，微调上述图片建议内容。仅修改用户要求的部分，保持其他内容和整体风格不变。返回完整的修改后JSON（包含en和cn两个版本）。`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);

      // Server-side enforcement: if locked fields were specified, restore original values
      if (input.lockedFields && input.lockedFields.length > 0) {
        try {
          const original = JSON.parse(input.currentContent);
          const originalEn = original.en || original;
          const originalCn = original.cn || {};
          for (const field of input.lockedFields) {
            if (result.en && originalEn[field] !== undefined) {
              result.en[field] = originalEn[field];
            }
            if (result.cn && originalCn[field] !== undefined) {
              result.cn[field] = originalCn[field];
            }
          }
        } catch { /* ignore parse errors for safety */ }
      }

      return result;
    }),
};
