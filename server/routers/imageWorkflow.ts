import { z } from "zod";
import { analyzeImageViaEmperor, generateImageAdviceViaEmperor } from "../emperorClient";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import * as devDb from "../devDb";
import * as kbDb from "../kbDb";
import {
  STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT,
  STEP0_COMPETITOR_SUMMARY_PROMPT,
  STEP1_SELLING_POINTS_PROMPT,
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP3_STYLE_PROMPT,
  STEP4_REFERENCE_PROMPT,
  STEP5_FINAL_SUGGESTION_PROMPT,
  STEP4_REOPTIMIZE_WITH_REFS_PROMPT,
  STEP5_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP5_APLUS_COMBO_RECOMMEND_PROMPT,
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

// ─── Helper: Get KB reference for image workflow (Phase 7 联动) ─────
async function getKBReference(category: string, userId: number): Promise<string> {
  try {
    // 1. Get confirmed high-score image sets in the same category
    const allSets = await kbDb.listImageSets(userId, "all");
    const relevantSets = (allSets as any[]).filter((s: any) =>
      s.status === "confirmed" &&
      s.category === category &&
      (s.overallScore ?? 0) >= 70
    );
    if (relevantSets.length === 0) return "";

    // 2. Style distribution statistics
    const styleDistribution: Record<string, number> = {};
    relevantSets.forEach((s: any) => {
      if (s.setStyle) styleDistribution[s.setStyle] = (styleDistribution[s.setStyle] || 0) + 1;
    });

    // 3. Get high-score individual images for type distribution
    const allImages = await kbDb.listAllImages(userId, "all", { tagCategory: category });
    const highScoreImages = (allImages as any[]).filter((i: any) => (i.singleImageScore ?? 0) >= 8);
    const imageTypeDistribution: Record<string, number> = {};
    highScoreImages.forEach((i: any) => {
      const typeMain = i.tagImageTypeMain || i.tagImageType;
      if (typeMain) imageTypeDistribution[typeMain] = (imageTypeDistribution[typeMain] || 0) + 1;
    });

    // 4. Build reference text
    const parts: string[] = ["\n--- 知识库参考（同类目高分图片集） ---"];

    // Top 3 reference sets
    const topSets = relevantSets
      .sort((a: any, b: any) => (b.overallScore ?? 0) - (a.overallScore ?? 0))
      .slice(0, 3);
    parts.push(`参考高分图片集: ${topSets.map((s: any) => `${s.asin}(风格:${s.setStyle || '未标注'}, 分数:${s.overallScore})`).join("; ")}`);

    // Style distribution
    const topStyles = Object.entries(styleDistribution)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);
    if (topStyles.length > 0) {
      parts.push(`风格分布: ${topStyles.map(([style, count]) => `${style}(${count}套)`).join(", ")}`);
    }

    // Image type distribution
    const topTypes = Object.entries(imageTypeDistribution)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 6);
    if (topTypes.length > 0) {
      parts.push(`高分图片类型分布: ${topTypes.map(([type, count]) => `${type}(${count}张)`).join(", ")}`);
    }

    // Style params from top set
    if (topSets[0]?.setStyleParams) {
      try {
        const params = JSON.parse(topSets[0].setStyleParams);
        if (params.aiKeywords) {
          parts.push(`推荐AI关键词: ${params.aiKeywords}`);
        }
        if (params.materialKeywords) {
          parts.push(`推荐材质: ${params.materialKeywords}`);
        }
        if (params.tabooElements) {
          parts.push(`禁忌元素: ${params.tabooElements}`);
        }
      } catch {}
    }

    return parts.join("\n");
  } catch {
    return "";
  }
}

// ─── Helper: Parse LLM JSON response ─────────────────────
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


  // ─── Step 0: Get competitor images ─────────────────────────────
  getStep0Data: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      const images = await db.getCompetitorImagesByProject(input.projectId);
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      return {
        images,
        step0AiResult: session?.step0AiResult || null,
        step0UserEdit: session?.step0UserEdit || null,
        step0Confirmed: session?.step0Confirmed || 0,
      };
    }),

  // ─── Step 0: Upload competitor image ───────────────────────────
  uploadCompetitorImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      competitorName: z.string(),
      imageData: z.string(), // base64 encoded
      fileName: z.string(),
      sortOrder: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);

      // Upload to S3
      const buffer = Buffer.from(input.imageData, "base64");
      const ext = input.fileName.split(".").pop() || "png";
      const key = `image-workflow/${input.projectId}/step0-competitor/${input.competitorName}-${Date.now()}.${ext}`;
      const { url } = await storagePut(key, buffer, `image/${ext}`);

      const record = await db.insertCompetitorImage({
        projectId: input.projectId,
        userId: ctx.user.id,
        competitorName: input.competitorName,
        imageUrl: url,
        sortOrder: input.sortOrder || 0,
      });

      return { id: record.insertId, url, competitorName: input.competitorName };
    }),

  // ─── Step 0: Analyze single competitor image ───────────────────
  analyzeCompetitorImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      const images = await db.getCompetitorImagesByProject(input.projectId);
      const image = images.find((img) => img.id === input.imageId);
      if (!image) throw new Error("Image not found");

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT },
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: image.imageUrl, detail: "high" },
              },
              {
                type: "text",
                text: `请分析这张竞品图片（竞争对手: ${image.competitorName}），输出JSON格式的分析结果。`,
              },
            ],
          },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
      const resultStr = JSON.stringify(result);

      await db.updateCompetitorImage(input.imageId, {
        aiAnalysis: resultStr,
        imageType: result.imageType || null,
      });

      return result;
    }),

  // ─── Step 0: Update competitor image analysis (user edit) ──────
  updateCompetitorImageAnalysis: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number(),
      userEdit: z.string(),
      imageType: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      await db.updateCompetitorImage(input.imageId, {
        userEdit: input.userEdit,
        imageType: input.imageType || null,
      });
      return { success: true };
    }),

  // ─── Step 0: Delete competitor image ───────────────────────────
  deleteCompetitorImage: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      await db.deleteCompetitorImage(input.imageId);
      return { success: true };
    }),

  // ─── Step 0: Confirm Step 0 (generate summary) ─────────────────
  confirmStep0: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      userEdit: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const session = await resolveSessionAccess(input.projectId, ctx.user);
      if (!session) throw new Error("No workflow session found");

      const images = await db.getCompetitorImagesByProject(input.projectId);
      if (images.length === 0) throw new Error("No competitor images uploaded");

      // Build summary from all analyzed images
      const analyzedImages = images.filter((img) => img.aiAnalysis || img.userEdit);
      const imagesSummary = analyzedImages.map((img) => {
        const analysis = img.userEdit || img.aiAnalysis || "{}";
        return `竞品: ${img.competitorName}, 图片类型: ${img.imageType || "未标注"}, 分析: ${analysis}`;
      }).join("\n\n");

      // Generate overall summary via LLM
      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP0_COMPETITOR_SUMMARY_PROMPT },
          {
            role: "user",
            content: `以下是对多个竞品图片的逐张分析结果，请生成整体总结报告：\n\n${imagesSummary}`,
          },
        ],
        response_format: { type: "json_object" },
      });

      const summaryResult = parseLLMJson(response);
      const summaryStr = input.userEdit || JSON.stringify(summaryResult);

      await db.updateImageWorkflowSession(session.id, {
        step0AiResult: JSON.stringify(summaryResult),
        step0UserEdit: input.userEdit || null,
        step0Confirmed: 1,
        currentStep: 1,
      });

      return { success: true, summary: summaryResult };
    }),

  // ─── Step 0: Expression Group CRUD ─────────────────────────────
  getExpressionGroups: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      return db.getExpressionGroupsByProject(input.projectId);
    }),

  createExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      expressionName: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const groups = await db.getExpressionGroupsByProject(input.projectId);
      const result = await db.insertExpressionGroup({
        projectId: input.projectId,
        userId: ctx.user.id,
        expressionName: input.expressionName,
        sortOrder: groups.length,
      });
      return { id: result.insertId };
    }),

  updateExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
      expressionName: z.string().optional(),
      userEdit: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      const patch: Record<string, any> = {};
      if (input.expressionName !== undefined) patch.expressionName = input.expressionName;
      if (input.userEdit !== undefined) patch.userEdit = input.userEdit;
      await db.updateExpressionGroup(input.groupId, patch);
      return { success: true };
    }),

  deleteExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      await db.deleteExpressionGroup(input.groupId);
      return { success: true };
    }),

  addImageToGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
      competitorName: z.string(),
      imageUrl: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user);
      if (!project) throw new Error("Project not found");
      ensureWriteAccess(project, ctx.user);
      // Enforce max 5 images per group
      const count = await db.countExpressionGroupImages(input.groupId);
      if (count >= 5) throw new Error("每个表达方向最多上传5张参考图");
      const result = await db.insertExpressionGroupImage({
        groupId: input.groupId,
        projectId: input.projectId,
        userId: ctx.user.id,
        competitorName: input.competitorName,
        imageUrl: input.imageUrl,
        sortOrder: count,
      });
      return { id: result.insertId };
    }),

  removeImageFromGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      imageId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      await db.deleteExpressionGroupImage(input.imageId);
      return { success: true };
    }),

  analyzeExpressionGroup: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      groupId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      await resolveProjectAccess(input.projectId, ctx.user);
      const groups = await db.getExpressionGroupsByProject(input.projectId);
      const group = groups.find(g => g.id === input.groupId);
      if (!group) throw new Error("Group not found");
      if (group.images.length === 0) throw new Error("请先上传图片");

      // Build multi-image message
      const userContent: any[] = [
        { type: "text", text: `请分析以下${group.images.length}张竞品图片，它们都属于同一卖点表达方向：「${group.expressionName}」。请从构图方式、配色方案、卖点表达方式、亮点等维度进行综合分析，输出JSON格式结果。` },
      ];
      for (const img of group.images) {
        userContent.push({ type: "image_url", image_url: { url: img.imageUrl, detail: "high" } });
        userContent.push({ type: "text", text: `竞品: ${img.competitorName || "未知"}` });
      }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT },
          { role: "user", content: userContent },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
      await db.updateExpressionGroup(input.groupId, { aiAnalysis: JSON.stringify(result) });
      return result;
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
      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return { en: emperorRes.output, cn: null };
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

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

      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

      // Load Step0 competitor summary if available
      const step0Summary = session.step0AiResult
        ? `\n\n--- 竞品图片分析总结 ---\n${session.step0AiResult.substring(0, 2000)}`
        : "";

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP2_IMAGE_OUTLINE_PROMPT },
          { role: "user", content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${sellingPoints}\n\n--- 产品背景信息 ---\n${context}${step0Summary}\n\n请根据以上卖点体系和竞品分析，规划每张图片的内容大纲，并在辅图的referenceHighlights字段中引用竞品亮点。` },
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
      // Phase 7: Get KB reference for style recommendations
      const kbReference = await getKBReference(project.category || '', ctx.user.id);
      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return { en: emperorRes.output, cn: null };
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP3_STYLE_PROMPT },
          { role: "user", content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n${colorInfo}\n\n--- 已确认的卖点 ---\n${session.step1UserEdit || session.step1AiResult}\n\n--- 已确认的图片大纲 ---\n${session.step2UserEdit || session.step2AiResult}${kbReference}\n\n请参考知识库中同类目高分图片的风格分布，推荐3-4个适合的视觉风格方案。` },
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

      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

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

      // Truncate step inputs to reduce token count and avoid LLM timeout
      const truncate = (s: string | null, maxLen = 3000) => s ? s.substring(0, maxLen) : '';
      const step1Content = truncate(session.step1UserEdit || session.step1AiResult, 4000);
      const step2Content = truncate(session.step2UserEdit || session.step2AiResult, 4000);
      const step3Content = truncate(session.step3UserEdit || session.step3AiResult, 3000);
      const step4Content = truncate(session.step4UserEdit || session.step4AiResult, 3000);

      // Phase 7: Get KB reference for same-category high-score images
      const kbReference = await getKBReference(project.category || '', ctx.user.id);

      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return { en: emperorRes.output, cn: null };
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: STEP5_FINAL_SUGGESTION_PROMPT },
          { role: "user", content: `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${step1Content}\n\n--- 已确认的图片大纲 ---\n${step2Content}\n\n--- 已确认的风格方案 ---\n${step3Content}\n\n--- 已确认的参考图 ---\n${step4Content}${kbReference}\n\n请综合以上所有确认结果（包括知识库参考），输出每张图的完整图片建议。` },
        ],
        response_format: { type: "json_object" },
      });

      const result = parseLLMJson(response);
      const resultStr = JSON.stringify(result);

      // Save English result immediately so user sees it fast
      await db.updateImageWorkflowSession(session.id, {
        step5AiResult: resultStr,
        step5AiResultCn: null, // Will be filled by async translation
        currentStep: 5,
      });

      // Also save to the active listing for backward compatibility
      try {
        const existingListings = await db.getListingsByProject(input.projectId);
        const activeListing = existingListings.find((l) => l.isActive === 1);
        if (activeListing) {
          await db.updateListing(activeListing.id, {
            imageAdvice: resultStr,
            imageAdviceCn: null,
          });
        }
      } catch {}

      return { en: result, cn: null };
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

      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

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

      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return { en: emperorRes.output, cn: null };
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

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

      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return { en: emperorRes.output, cn: null };
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

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

      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return emperorRes.output;
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

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
      const session = await getOrCreateSession(input.projectId, ctx.user.id);
      let uploads: any[] = [];
      try { uploads = JSON.parse(session.step5DesignerUploads || '[]'); } catch {}
      const idx = uploads.findIndex((u: any) => u.imageNumber === input.imageNumber);
      const entry = { id: Date.now(), imageUrl: input.imageUrl, imageNumber: input.imageNumber, notes: input.notes || '', uploadedAt: new Date().toISOString() };
      if (idx >= 0) uploads[idx] = entry;
      else uploads.push(entry);
      await db.updateSession(session.id, { step5DesignerUploads: JSON.stringify(uploads) });
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
      const session = await getOrCreateSession(input.projectId, ctx.user.id);
      let uploads: any[] = [];
      try { uploads = JSON.parse(session.step5DesignerUploads || '[]'); } catch {}
      uploads = uploads.filter((u: any) => u.imageNumber !== input.imageNumber);
      await db.updateSession(session.id, { step5DesignerUploads: JSON.stringify(uploads) });
      return { success: true, uploads };
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
        clearData.step5SelectedModule = null;
        clearData.step5OptimizedResult = null;
        clearData.step5OptimizedResultCn = null;
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

      // Emperor Skill 优先 - 图片工作流
      try {
        const emperorRes = await generateImageAdviceViaEmperor(JSON.stringify(input).slice(0, 2000));
        if (emperorRes.success && emperorRes.output) return { en: emperorRes.output, cn: null };
      } catch (e) { console.warn("[Emperor] imageWorkflow fallback:", e); }

      const response = await invokeLLM({
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
});
