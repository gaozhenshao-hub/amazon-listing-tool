import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import * as devDb from "../devDb";
import * as kbDb from "../kbDb";
import {
  STEP1_SELLING_POINTS_PROMPT,
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP3_STYLE_PROMPT,
  STEP4_REFERENCE_PROMPT,
  STEP5_FINAL_SUGGESTION_PROMPT,
  STEP5_TRANSLATION_PROMPT,
  STEP4_REOPTIMIZE_WITH_REFS_PROMPT,
  STEP5_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP5_APLUS_COMBO_RECOMMEND_PROMPT,
  STEP6_AI_PROMPT_GENERATION,
  STEP6_TRANSLATION_PROMPT,
} from "../imageWorkflowPrompts";
import { IMAGE_ADVICE_TRANSLATION_PROMPT } from "../prompts";
import { storagePut } from "../storage";

// ─── Helper: Build context from project data ─────────────────────
async function buildImageWorkflowContext(projectId: number) {
  const parts: string[] = [];

  // Load project info
  const projects = await db.getProjectsByUser(0); // We'll get it differently
  // Actually we need to load by projectId - let's use the analyses route
  const analyses = await db.getCompetitorAnalysesByProject(projectId);

  // Load product attributes from file analysis
  const files = await db.getProjectFilesByProject(projectId);
  for (const file of files) {
    if (file.status !== "completed" || !file.analysisResult) continue;
    try {
      const parsed = JSON.parse(file.analysisResult);
      if (file.fileType === "product_attributes") {
        parts.push("--- 产品属性 ---");
        if (parsed.uniqueSellingPoints?.length) {
          parts.push(`独特卖点: ${parsed.uniqueSellingPoints.join("; ")}`);
        }
        if (parsed.coreSpecs?.length) {
          parts.push(`核心参数: ${parsed.coreSpecs.map((s: any) => `${s.attribute}: ${s.value}`).join("; ")}`);
        }
        if (parsed.materialBuild?.length) {
          parts.push(`材质工艺: ${parsed.materialBuild.map((m: any) => `${m.attribute}: ${m.value}`).join("; ")}`);
        }
      }
    } catch {}
  }

  // Load competitor analyses
  if (analyses.length > 0) {
    parts.push("\n--- 竞品分析 ---");
    for (const a of analyses) {
      parts.push(`竞品 ASIN: ${a.asin}`);
      if (a.title) parts.push(`标题: ${a.title}`);
      if (a.rawData) {
        try {
          const parsed = JSON.parse(a.rawData);
          if (parsed.advantages?.length) parts.push(`优势: ${parsed.advantages.join("; ")}`);
          if (parsed.weaknesses?.length) parts.push(`弱点: ${parsed.weaknesses.join("; ")}`);
        } catch {}
      }
      // Include review data
      if (a.reviewAnalysis) {
        try {
          const reviews = JSON.parse(a.reviewAnalysis);
          if (reviews.painPoints?.length) parts.push(`差评痛点: ${reviews.painPoints.map((p: any) => typeof p === 'string' ? p : p.point || JSON.stringify(p)).join("; ")}`);
          if (reviews.delightPoints?.length) parts.push(`好评亮点: ${reviews.delightPoints.map((p: any) => typeof p === 'string' ? p : p.point || JSON.stringify(p)).join("; ")}`);
          if (reviews.itchPoints?.length) parts.push(`用户期望: ${reviews.itchPoints.map((p: any) => typeof p === 'string' ? p : p.point || JSON.stringify(p)).join("; ")}`);
        } catch {}
      }
    }
  }

  // Load review aggregation (Kano model)
  const reviewAgg = await db.getReviewAggregationByProject(projectId);
  if (reviewAgg && reviewAgg.status === "completed") {
    parts.push("\n--- 评论聚合分析 ---");
    if (reviewAgg.painPoints) {
      try {
        const painPts = JSON.parse(reviewAgg.painPoints);
        if (painPts?.length) parts.push(`痛点: ${painPts.map((p: any) => typeof p === 'string' ? p : p.point || JSON.stringify(p)).join("; ")}`);
      } catch {}
    }
    if (reviewAgg.itchPoints) {
      try {
        const itchPts = JSON.parse(reviewAgg.itchPoints);
        if (itchPts?.length) parts.push(`期望点: ${itchPts.map((p: any) => typeof p === 'string' ? p : p.point || JSON.stringify(p)).join("; ")}`);
      } catch {}
    }
    if (reviewAgg.delightPoints) {
      try {
        const delightPts = JSON.parse(reviewAgg.delightPoints);
        if (delightPts?.length) parts.push(`亮点: ${delightPts.map((p: any) => typeof p === 'string' ? p : p.point || JSON.stringify(p)).join("; ")}`);
      } catch {}
    }
  }

  // Load keyword scene data
  const allKeywords = await db.getKeywordsByProject(projectId);
  if (allKeywords.length > 0) {
    const sceneVolumes: Record<string, number> = {};
    for (const kw of allKeywords) {
      const vol = kw.monthlySearchVolume || 0;
      if (kw.sceneTags) {
        try {
          const tags = JSON.parse(kw.sceneTags);
          if (Array.isArray(tags)) {
            tags.forEach((tag: string) => {
              sceneVolumes[tag] = (sceneVolumes[tag] || 0) + vol;
            });
          }
        } catch {}
      }
    }
    const topScenes = Object.entries(sceneVolumes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8);
    if (topScenes.length > 0) {
      parts.push(`\n--- 关键词场景 ---`);
      parts.push(topScenes.map(([scene, vol]) => `${scene} (搜索量: ${vol})`).join("; "));
    }
  }

  // Load product profile from Module 1 (if exists)
  const profile = await devDb.getDevProductProfile(projectId);
  if (profile) {
    parts.push("\n--- 产品画像 ---");
    if (profile.appearanceColors) {
      try {
        const colors = JSON.parse(profile.appearanceColors);
        parts.push(`外观颜色: ${JSON.stringify(colors)}`);
      } catch {}
    }
    if (profile.mainFunctions) {
      try {
        const funcs = JSON.parse(profile.mainFunctions);
        parts.push(`主要功能: ${JSON.stringify(funcs)}`);
      } catch {}
    }
    if (profile.userPersona) {
      try {
        const persona = JSON.parse(profile.userPersona);
        parts.push(`用户画像: ${JSON.stringify(persona)}`);
      } catch {}
    }
    if (profile.usageScenarios) {
      try {
        const scenarios = JSON.parse(profile.usageScenarios);
        parts.push(`使用场景: ${JSON.stringify(scenarios)}`);
      } catch {}
    }
  }

  // Load active listing (if exists)
  const activeListing = await db.getActiveListingByProject(projectId);
  if (activeListing) {
    parts.push("\n--- 当前Listing ---");
    if (activeListing.title) parts.push(`标题: ${activeListing.title}`);
    if (activeListing.bulletPoints) {
      try {
        const bullets = JSON.parse(activeListing.bulletPoints);
        if (Array.isArray(bullets)) {
          parts.push(`五点描述:\n${bullets.map((b: any, i: number) => `${i + 1}. ${typeof b === 'string' ? b : b.text || b.content || JSON.stringify(b)}`).join("\n")}`);
        }
      } catch {}
    }
  }

  return parts.join("\n");
}

// ─── Helper: Parse LLM JSON response ─────────────────────────────
function parseLLMJson(response: any): any {
  const content = typeof response.choices[0].message.content === "string"
    ? response.choices[0].message.content
    : JSON.stringify(response.choices[0].message.content);
  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}


// Helper: resolve project access for imageWorkflow based on user role
async function resolveProjectAccess(projectId: number, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'designer') {
    const project = await db.getProjectByIdAdmin(projectId);
    if (!project) throw new Error("Project not found");
    return project;
  }
  const project = await db.getProjectById(projectId, user.id);
  if (!project) throw new Error("Project not found");
  return project;
}

// Helper: resolve session access - designer/admin can view any project's session
async function resolveSessionAccess(projectId: number, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'designer') {
    return db.getImageWorkflowSessionByProject(projectId);
  }
  return db.getImageWorkflowSession(projectId, user.id);
}

// Helper: ensure write access for imageWorkflow mutations
function ensureWriteAccess(project: { userId: number }, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin') return;
  if (user.role === 'designer' && project.userId !== user.id) {
    throw new Error("Designer角色只能查看他人项目的图片建议，不能修改");
  }
}

// ═══════════════════════════════════════════════════════════════════
export const imageWorkflowRouter = router({

  // ─── Get or create workflow session ────────────────────────────
  getSession: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      return session;
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
      return db.createImageWorkflowSession({
        projectId: input.projectId,
        userId: ctx.user.id,
        currentStep: 1,
      });
    }),

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
      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP1_SELLING_POINTS_PROMPT },
          { role: "user", content: `请为以下产品梳理卖点体系：\n\n产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n${context}` },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
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

      return { success: true };
    }),

  // ─── Step 2: Generate image outline ────────────────────────────
  generateStep2: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      if (!session.step1Confirmed) throw new Error("Step 1 not confirmed yet");

      const sellingPoints = session.step1UserEdit || session.step1AiResult;
      const context = await buildImageWorkflowContext(input.projectId);

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP2_IMAGE_OUTLINE_PROMPT },
          { role: "user", content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${sellingPoints}\n\n--- 产品背景信息 ---\n${context}\n\n请根据以上卖点体系，规划每张图片的内容大纲。` },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
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
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step2UserEdit: input.userEdit,
        step2Confirmed: 1,
        currentStep: 3,
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

      const session = await resolveSessionAccess(input.projectId, ctx.user);
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

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP3_STYLE_PROMPT },
          { role: "user", content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n${colorInfo}\n\n--- 已确认的卖点 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 已确认的图片大纲 ---\n${session.step2UserEdit || session.step2AiResult}\n\n请推荐3-4个适合的视觉风格方案。` },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
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

      return { success: true };
    }),

  // ─── Step 4: Generate reference image recommendations ─────────
  generateStep4: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionAccess(input.projectId, ctx.user);
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

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP4_REFERENCE_PROMPT },
          { role: "user", content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的图片大纲 ---\n${session.step2UserEdit || session.step2AiResult}\n\n--- 已确认的风格方案 ---\n${session.step3UserEdit || session.step3AiResult}\n${kbImageInfo}\n\n请为每张图推荐构图参考和效果图参考。` },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
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

      return { success: true };
    }),

  // ─── Step 5: Generate final image suggestions ─────────────────
  generateStep5: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      if (!session.step4Confirmed) throw new Error("Step 4 not confirmed yet");

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP5_FINAL_SUGGESTION_PROMPT },
          { role: "user", content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 已确认的图片大纲 ---\n${session.step2UserEdit || session.step2AiResult}\n\n--- 已确认的风格方案 ---\n${session.step3UserEdit || session.step3AiResult}\n\n--- 已确认的参考图 ---\n${session.step4UserEdit || session.step4AiResult}\n\n请综合以上所有确认结果，输出每张图的完整图片建议。` },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
      const resultStr = JSON.stringify(result);

      // Also generate Chinese translation
      let cnStr: string | null = null;
      try {
        const cnResponse = await invokeLLM({
          messages: [
            { role: "system", content: STEP5_TRANSLATION_PROMPT },
            { role: "user", content: `请将以下图片建议翻译为简体中文：\n\n${resultStr}` },
          ],
          response_format: { type: "json_object" },
        });
        const cnContent = typeof cnResponse.choices[0].message.content === "string"
          ? cnResponse.choices[0].message.content
          : JSON.stringify(cnResponse.choices[0].message.content);
        JSON.parse(cnContent); // validate
        cnStr = cnContent;
      } catch (err) {
        console.error("Step 5 CN translation failed:", err);
      }

      await db.updateImageWorkflowSession(session.id, {
        step5AiResult: resultStr,
        step5AiResultCn: cnStr,
        currentStep: 5,
      });

      // Also save to the active listing for backward compatibility
      try {
        const existingListings = await db.getListingsByProject(input.projectId);
        const activeListing = existingListings.find((l) => l.isActive === 1);
        if (activeListing) {
          await db.updateListing(activeListing.id, {
            imageAdvice: resultStr,
            imageAdviceCn: cnStr || null,
          });
        }
      } catch {}

      return { en: result, cn: cnStr ? JSON.parse(cnStr) : null };
    }),

  // ─── Step 5: Save user edits and confirm ──────────────────────
  confirmStep5: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step5UserEdit: input.userEdit,
        step5Confirmed: 1,
        status: "completed",
      });

      return { success: true };
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
      const session = await resolveSessionAccess(input.projectId, ctx.user);
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

      const response = await invokeLLM({
        messages,
        response_format: { type: "json_object" },
      });

      return parseLLMJson(response);
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
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      if (!session.step5AiResult) throw new Error("Step 5 not generated yet");

      const currentSuggestions = session.step5UserEdit || session.step5AiResult;

      const response = await invokeLLM({
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

      await db.updateImageWorkflowSession(session.id, {
        step5SelectedModule: JSON.stringify(input.selectedModules),
        step5OptimizedResult: JSON.stringify(result.en || result),
        step5OptimizedResultCn: result.cn ? JSON.stringify(result.cn) : null,
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
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      if (!session.step5AiResult) throw new Error("Step 5 not generated yet");

      const currentSuggestions = session.step5UserEdit || session.step5AiResult;
      let currentData: any;
      try { currentData = JSON.parse(currentSuggestions); } catch { throw new Error("Invalid step5 data"); }

      const currentSection = currentData?.aPlusContent?.sections?.[input.sectionIndex];
      if (!currentSection) throw new Error(`A+ section at index ${input.sectionIndex} not found`);

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT },
          {
            role: "user",
            content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 当前该模块的建议内容 ---\n${JSON.stringify(currentSection)}\n\n--- 用户为该模块选择的A+样式 ---\n模块类型: ${input.moduleType}\n模块名称: ${input.moduleName}\n模块位置: A+模块 ${input.sectionIndex + 1}\n\n请根据用户选择的A+模块样式，重新优化该模块的建议内容，严格按照模块规格要求（尺寸、字符数限制）来输出内容。`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
      return { en: result.en || result, cn: result.cn || null };
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
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");

      // Gather product context
      const sellingPoints = session.step1UserEdit || session.step1AiResult || '';
      let spCount = 0;
      try {
        const spData = JSON.parse(sellingPoints);
        spCount = (spData.coreSellingPoints?.length || 0) + (spData.secondarySellingPoints?.length || 0);
      } catch { spCount = 5; }

      const response = await invokeLLM({
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

  // ─── Step 6: Generate AI prompts ──────────────────────────────
  generateStep6: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      if (!session.step5Confirmed) throw new Error("Step 5 not confirmed yet");

      const step5Data = session.step5OptimizedResult || session.step5UserEdit || session.step5AiResult;

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP6_AI_PROMPT_GENERATION },
          {
            role: "user",
            content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 已确认的图片大纲 ---\n${session.step2UserEdit || session.step2AiResult}\n\n--- 已确认的风格方案 ---\n${session.step3UserEdit || session.step3AiResult}\n\n--- 已确认的参考图 ---\n${session.step4UserEdit || session.step4AiResult}\n\n--- 已确认的图片建议 ---\n${step5Data}\n\n请为每张图生成可直接使用的AI图片生成提示词（prompt），包含正面提示词、负面提示词和推荐参数。`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
      const resultStr = JSON.stringify(result);

      // Generate Chinese translation
      let cnStr: string | null = null;
      try {
        const cnResponse = await invokeLLM({
          messages: [
            { role: "system", content: STEP6_TRANSLATION_PROMPT },
            { role: "user", content: `请将以下AI提示词建议翻译为简体中文：\n\n${resultStr}` },
          ],
          response_format: { type: "json_object" },
        });
        const cnContent = typeof cnResponse.choices[0].message.content === "string"
          ? cnResponse.choices[0].message.content
          : JSON.stringify(cnResponse.choices[0].message.content);
        JSON.parse(cnContent); // validate
        cnStr = cnContent;
      } catch (err) {
        console.error("Step 6 CN translation failed:", err);
      }

      await db.updateImageWorkflowSession(session.id, {
        step6AiResult: resultStr,
        step6AiResultCn: cnStr,
        currentStep: 6,
      });

      return { en: result, cn: cnStr ? JSON.parse(cnStr) : null };
    }),

  // ─── Step 6: Confirm ──────────────────────────────────────────────
  confirmStep6: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      await db.updateImageWorkflowSession(session.id, {
        step6UserEdit: input.userEdit,
        step6Confirmed: 1,
        status: "completed",
      });

      return { success: true };
    }),

  // ─── Reset to a specific step ─────────────────────────────────
  resetToStep: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      step: z.number().min(1).max(6),
    }))
    .mutation(async ({ ctx, input }) => {
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");
      ensureWriteAccess({ userId: session.userId }, ctx.user);

      // Clear data for steps >= target step
      const clearData: any = { currentStep: input.step };
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
        clearData.step5SelectedModule = null;
        clearData.step5OptimizedResult = null;
        clearData.step5OptimizedResultCn = null;
      }
      if (input.step <= 6) {
        clearData.step6AiResult = null;
        clearData.step6AiResultCn = null;
        clearData.step6UserEdit = null;
        clearData.step6Confirmed = 0;
      }
      clearData.status = "in_progress";

      await db.updateImageWorkflowSession(session.id, clearData);
      return { success: true };
    }),

  // ─── Knowledge Base Image Browser for Step 4 ─────────────────
  listKbImages: protectedProcedure
    .input(z.object({
      tagCategory: z.string().optional(),
      tagColorScheme: z.string().optional(),
      tagImageType: z.string().optional(),
      tagDesignStyle: z.string().optional(),
      imagePosition: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      return kbDb.listAllImages(ctx.user.id, "mine", input);
    }),

  // Get distinct tag values for filter dropdowns
  getKbImageFilterOptions: protectedProcedure
    .query(async ({ ctx }) => {
      const allImages = await kbDb.listAllImages(ctx.user.id, "mine");
      const categories = new Set<string>();
      const colorSchemes = new Set<string>();
      const imageTypes = new Set<string>();
      const designStyles = new Set<string>();
      for (const img of allImages) {
        if (img.tagCategory) categories.add(img.tagCategory);
        if (img.tagColorScheme) colorSchemes.add(img.tagColorScheme);
        if (img.tagImageType) imageTypes.add(img.tagImageType);
        if (img.tagDesignStyle) designStyles.add(img.tagDesignStyle);
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
        en: session.step5UserEdit || session.step5AiResult,
        cn: session.step5AiResultCn,
        sellingPoints: session.step1UserEdit || session.step1AiResult,
        outline: session.step2UserEdit || session.step2AiResult,
        style: session.step3UserEdit || session.step3AiResult,
        references: session.step4UserEdit || session.step4AiResult,
      };
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
      const session = await resolveSessionAccess(input.projectId, ctx.user);
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

      const response = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `你是一位拥有10年设计经验的亚马逊运营专家。用户需要微调一张图片的建议内容。

重要规则：
1. 仅修改用户指定的部分，保持其他内容不变
2. 保持与整体风格方案的一致性
3. 输出格式必须与输入格式完全一致（相同的JSON字段结构）
4. 同时输出英文版和中文版
5. 返回JSON格式: { "en": {...修改后的英文版}, "cn": {...修改后的中文版} }${lockedFieldsInstruction}

当前风格方案参考:
${styleContext}`,
          },
          {
            role: "user",
            content: `图片类型: ${imageTypeLabel}

当前内容:
${input.currentContent}

用户修改指令: ${input.instruction}${input.lockedFields && input.lockedFields.length > 0 ? `\n\n🔒 请注意：以下字段已被用户锁定，必须保持原值不变：${input.lockedFields.join("、")}` : ""}

请根据用户的修改指令，微调上述图片建议内容。仅修改用户要求的部分，保持其他内容和整体风格不变。返回完整的修改后JSON（包含en和cn两个版本）。`,
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
});
