import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as vsDb from "../videoScriptDb";
import * as db from "../db";
import { generateVideoScriptExcel } from "../videoScriptExcel";
import { storagePut } from "../storage";
import { getL1Index, getL2Summary, formatForPrompt, logKbCallBatch } from "../kbContextEngine";
import {
  COMPETITOR_SCRIPT_ANALYSIS_PROMPT,
  COMPETITOR_SUMMARY_PROMPT,
  PRODUCT_INFO_EXTRACTION_PROMPT,
  SECTION_PLANNING_PROMPT,
  SUBTOPIC_EXPANSION_PROMPT,
  SHOT_DETAIL_PROMPT,
  EDIT_SCRIPT_PROMPT,
  VIDEO_TYPE_SPECS,
  STYLE_PRESETS,
  getVideoTypeTemplate,
  getVideoTypeSpec,
  buildStylePresetPrompt,
} from "../videoScriptPrompts";

// Helper: safely parse LLM JSON response
function parseLLMJson(content: string): any {
  try {
    // Try to extract JSON from markdown code blocks
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) return JSON.parse(jsonMatch[1].trim());
    return JSON.parse(content);
  } catch {
    return null;
  }
}

// Helper: sanitize shooting method to valid enum value
const VALID_SHOOTING_METHODS = ["model_narration", "live_action", "ai_generated", "mixed", "screen_recording"] as const;
function sanitizeShootingMethod(value: string | undefined | null): string {
  if (!value) return "live_action";
  // If the value contains pipe separator (e.g. "live_action|mixed"), take the first one
  const firstVal = value.split("|")[0].trim().toLowerCase();
  if (VALID_SHOOTING_METHODS.includes(firstVal as any)) return firstVal;
  // Try to find a partial match
  const match = VALID_SHOOTING_METHODS.find(m => firstVal.includes(m));
  return match || "live_action";
}

// Helper: build product context from project data
async function buildProductContext(projectId: number): Promise<string> {
  const parts: string[] = [];

  // Load project files for product attributes
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
      }
    } catch {}
  }

  // Load competitor analyses
  const analyses = await db.getCompetitorAnalysesByProject(projectId);
  if (analyses.length > 0) {
    parts.push("\n--- 竞品分析 ---");
    for (const a of analyses) {
      parts.push(`竞品 ASIN: ${a.asin}`);
      if (a.title) parts.push(`标题: ${a.title}`);
      if (a.bulletPoints) parts.push(`五点: ${a.bulletPoints}`);
    }
  }

  // Load listings
  const listings = await db.getListingsByProject(projectId);
  if (listings.length > 0) {
    parts.push("\n--- Listing内容 ---");
    for (const l of listings) {
      if (l.title) parts.push(`标题: ${l.title}`);
      if (l.bulletPoints) parts.push(`五点: ${l.bulletPoints}`);
      if (l.description) parts.push(`描述: ${l.description}`);
    }
  }

  // Load review aggregation
  const review = await db.getReviewAggregationByProject(projectId);
  if (review) {
    parts.push("\n--- 评论分析 ---");
    if (review.painPoints) parts.push(`痛点: ${review.painPoints}`);
    if (review.keyThemes) parts.push(`关键主题: ${review.keyThemes}`);
    if (review.overallSentiment) parts.push(`整体情感: ${review.overallSentiment}`);
  }

  return parts.join("\n");
}

export const videoScriptRouter = router({
  // ─── CRUD: Video Script Projects ──────────────────────────────

  create: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      scriptName: z.string().min(1),
      productName: z.string().optional(),
      videoType: z.enum(["main_video", "ad_spv", "ad_sbv", "aplus_video", "social_media", "other"]).optional(),
      stylePreset: z.string().optional(),
      targetDuration: z.number().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const videoType = input.videoType || "main_video";
      const spec = getVideoTypeSpec(videoType);
      const targetDuration = input.targetDuration || spec.recommendedDuration[1];
      const id = await vsDb.createVideoScript({
        ...input,
        userId: ctx.user!.id,
        targetDuration: targetDuration.toString(),
        stylePreset: input.stylePreset || "minimal_white",
        status: "draft",
        currentStage: "stage_0a",
        stageStatus: JSON.stringify({
          stage_0a: "pending", stage_0b: "pending",
          stage_1: "pending", stage_2: "pending",
          stage_3: "pending", stage_4: "pending",
        }),
      });
      return { id, spec };
    }),

  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getVideoScriptsByProject(input.projectId);
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getVideoScriptById(input.id);
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      scriptName: z.string().optional(),
      productName: z.string().optional(),
      videoType: z.enum(["main_video", "ad_spv", "ad_sbv", "aplus_video", "social_media", "other"]).optional(),
      stylePreset: z.string().optional(),
      targetDuration: z.number().optional(),
      currentStage: z.enum(["stage_0a", "stage_0b", "stage_1", "stage_2", "stage_3", "stage_4", "completed"]).optional(),
      status: z.enum(["draft", "in_progress", "completed", "archived"]).optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, targetDuration, ...rest } = input;
      await vsDb.updateVideoScript(id, {
        ...rest,
        ...(targetDuration !== undefined ? { targetDuration: targetDuration.toString() } : {}),
      });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await vsDb.deleteVideoScript(input.id);
      return { success: true };
    }),

  // ─── Stage 0A: Competitor Script Analysis ─────────────────────

  addCompetitorScript: protectedProcedure
    .input(z.object({
      videoScriptId: z.number(),
      competitorName: z.string().optional(),
      competitorAsin: z.string().optional(),
      inputType: z.enum(["excel_upload", "video_url", "knowledge_base", "listing_extract"]),
      sourceUrl: z.string().optional(),
      sourceFileKey: z.string().optional(),
      sourceKbVideoId: z.number().optional(),
      rawContent: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await vsDb.addCompetitorScript(input);
      return { id };
    }),

  getCompetitorScripts: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getCompetitorScriptsByVideoScript(input.videoScriptId);
    }),

  deleteCompetitorScript: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await vsDb.deleteCompetitorScript(input.id);
      return { success: true };
    }),

  analyzeCompetitorScript: protectedProcedure
    .input(z.object({
      competitorScriptId: z.number(),
      rawContent: z.string(),
    }))
    .mutation(async ({ input }) => {
      const prompt = COMPETITOR_SCRIPT_ANALYSIS_PROMPT.replace("{competitor_content}", input.rawContent);
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是一位资深的亚马逊产品视频分析师。请严格输出JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      const content = typeof response.choices[0]?.message?.content === "string"
        ? response.choices[0].message.content
        : "";
      const analysis = parseLLMJson(content);
      if (analysis) {
        await vsDb.updateCompetitorScript(input.competitorScriptId, {
          rawContent: input.rawContent,
          structureAnalysis: JSON.stringify(analysis.structure_analysis || {}),
          visualLanguage: JSON.stringify(analysis.visual_language || {}),
          copywritingAnalysis: JSON.stringify(analysis.copywriting_analysis || {}),
          strengths: JSON.stringify(analysis.strengths || []),
          weaknesses: JSON.stringify(analysis.weaknesses || []),
          reusablePatterns: JSON.stringify(analysis.reusable_patterns || []),
        });
      }
      return { analysis, raw: content };
    }),

  updateCompetitorScriptEdits: protectedProcedure
    .input(z.object({
      id: z.number(),
      userEdits: z.any(),
      userConfirmed: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      await vsDb.updateCompetitorScript(input.id, {
        userEdits: JSON.stringify(input.userEdits),
        userConfirmed: input.userConfirmed ? 1 : 0,
      });
      return { success: true };
    }),

  generateCompetitorSummary: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .mutation(async ({ input }) => {
      const competitors = await vsDb.getCompetitorScriptsByVideoScript(input.videoScriptId);
      const analysesData = competitors.map(c => ({
        name: c.competitorName,
        asin: c.competitorAsin,
        structure: c.structureAnalysis,
        visual: c.visualLanguage,
        copywriting: c.copywritingAnalysis,
        strengths: c.strengths,
        weaknesses: c.weaknesses,
      }));
      const prompt = COMPETITOR_SUMMARY_PROMPT.replace("{competitor_analyses}", JSON.stringify(analysesData, null, 2));
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是一位资深的亚马逊视频策略分析师。请严格输出JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      const content = typeof response.choices[0]?.message?.content === "string"
        ? response.choices[0].message.content
        : "";
      const summary = parseLLMJson(content);
      if (summary) {
        await vsDb.upsertCompetitorSummary({
          videoScriptId: input.videoScriptId,
          competitorScriptIds: JSON.stringify(competitors.map(c => c.id)),
          commonStructure: JSON.stringify(summary.common_structure || {}),
          optimalDurationAllocation: JSON.stringify(summary.optimal_duration_allocation || []),
          differentiableOpportunities: JSON.stringify(summary.differentiable_opportunities || []),
          recommendedStructure: JSON.stringify(summary.recommended_structure || {}),
        });
      }
      return { summary, raw: content };
    }),

  getCompetitorSummary: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getCompetitorSummary(input.videoScriptId);
    }),

  // ─── Stage 0B: Product Info Extraction ────────────────────────

  extractProductInfo: protectedProcedure
    .input(z.object({
      videoScriptId: z.number(),
      projectId: z.number(),
    }))
    .mutation(async ({ input }) => {
      const productContext = await buildProductContext(input.projectId);
      const prompt = PRODUCT_INFO_EXTRACTION_PROMPT.replace("{product_data}", productContext);
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是一位亚马逊产品视频策划专家。请严格输出JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      const content = typeof response.choices[0]?.message?.content === "string"
        ? response.choices[0].message.content
        : "";
      const productInfo = parseLLMJson(content);
      if (productInfo) {
        await vsDb.upsertProductSnapshot({
          videoScriptId: input.videoScriptId,
          basicInfo: JSON.stringify(productInfo.basic_info || {}),
          sellingPointsHierarchy: JSON.stringify(productInfo.selling_points_hierarchy || []),
          painPoints: JSON.stringify(productInfo.pain_points_from_reviews || []),
          keywords: JSON.stringify(productInfo.keywords_for_overlay || []),
          productSpecs: JSON.stringify(productInfo.key_specs || []),
          dataSources: JSON.stringify({ projectId: input.projectId, extractedAt: new Date().toISOString() }),
        });
      }
      return { productInfo, raw: content };
    }),

  getProductSnapshot: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getProductSnapshot(input.videoScriptId);
    }),

  updateProductSnapshot: protectedProcedure
    .input(z.object({
      videoScriptId: z.number(),
      userEdits: z.any(),
      userConfirmed: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      await vsDb.upsertProductSnapshot({
        videoScriptId: input.videoScriptId,
        userEdits: JSON.stringify(input.userEdits),
        userConfirmed: input.userConfirmed ? 1 : 0,
      });
      return { success: true };
    }),

  // ─── Stage 1: Section Planning ────────────────────────────────

  generateSections: protectedProcedure
    .input(z.object({
      videoScriptId: z.number(),
      projectId: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      const script = await vsDb.getVideoScriptById(input.videoScriptId);
      const snapshot = await vsDb.getProductSnapshot(input.videoScriptId);
      const summary = await vsDb.getCompetitorSummary(input.videoScriptId);

      const productInfo = snapshot ? JSON.stringify({
        basicInfo: snapshot.basicInfo,
        sellingPoints: snapshot.sellingPointsHierarchy,
        painPoints: snapshot.painPoints,
        keywords: snapshot.keywords,
      }) : "无产品信息";

      const competitorRef = summary ? JSON.stringify({
        recommendedStructure: summary.recommendedStructure,
        differentiableOpportunities: summary.differentiableOpportunities,
      }) : "无竞品参考";

      const videoType = script?.videoType || "main_video";
      const stylePreset = (script as any)?.stylePreset || "minimal_white";

      // ─── Knowledge Base Injection: fetch relevant video examples ───
      let kbExamplesText = "暂无知识库案例";
      try {
        const kbL1 = await getL1Index({
          userId: ctx.user.id,
          types: ["video"],
          keyword: script?.scriptName || "",
          scope: "all",
        });
        if (kbL1.length > 0) {
          // Load L2 summaries for top results
          const topIds = kbL1.slice(0, 5).map(item => item.id);
          const kbL2 = await getL2Summary(topIds, ["video"]);
          kbExamplesText = formatForPrompt(kbL2.length > 0 ? kbL2 : kbL1, kbL2.length > 0 ? "L2" : "L1");
          // Log KB call for tracking
          await logKbCallBatch(topIds.map(id => ({
            userId: ctx.user.id,
            callerModule: "video_script",
            callerAction: "generateSections",
            kbItemId: id,
            kbItemType: "video",
            loadLevel: kbL2.length > 0 ? "L2" as const : "L1" as const,
          })));
        }
      } catch (e) {
        console.warn("[VideoScript] KB injection failed, continuing without KB context:", e);
      }

      const prompt = SECTION_PLANNING_PROMPT
        .replace("{product_info}", productInfo)
        .replace("{competitor_reference}", competitorRef)
        .replace("{knowledge_base_examples}", kbExamplesText)
        .replace("{video_type}", videoType)
        .replace("{video_type_template}", getVideoTypeTemplate(videoType))
        .replace("{style_preset}", buildStylePresetPrompt(stylePreset))
        .replace("{target_duration}", script?.targetDuration?.toString() || "60")
        .replace("{spv_segment_index}", "N/A");

      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是一位资深的亚马逊产品视频编导。请严格输出JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      const content = typeof response.choices[0]?.message?.content === "string"
        ? response.choices[0].message.content
        : "";
      const result = parseLLMJson(content);
      if (result?.sections) {
        const savedSections = await vsDb.saveSections(input.videoScriptId, result.sections.map((s: any, i: number) => ({
          videoScriptId: input.videoScriptId,
          sectionCode: s.section_code || `MBP${i + 1}`,
          sectionName: s.section_name || s.scene_name,
          sectionNameEn: s.section_name_en,
          shootingMethod: sanitizeShootingMethod(s.shooting_method),
          durationBudget: s.duration_budget?.toString(),
          sellingPointRefs: JSON.stringify(s.selling_point_refs || []),
          painPointRefs: JSON.stringify(s.pain_point_refs || []),
          description: s.description || "",
          shotTypeSuggestion: s.shot_type_suggestion || "",
          propsSuggestion: JSON.stringify(s.props_suggestion || []),
          sortOrder: i,
        })));
        return { sections: savedSections, raw: content };
      }
      return { sections: [], raw: content };
    }),

  getSections: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getSections(input.videoScriptId);
    }),

  updateSection: protectedProcedure
    .input(z.object({
      id: z.number(),
      sectionName: z.string().optional(),
      sectionNameEn: z.string().optional(),
      shootingMethod: z.enum(["model_narration", "live_action", "ai_generated", "mixed", "screen_recording"]).optional(),
      durationBudget: z.number().optional(),
      sellingPointRefs: z.any().optional(),
      painPointRefs: z.any().optional(),
      userConfirmed: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, durationBudget, sellingPointRefs, painPointRefs, userConfirmed, ...rest } = input;
      await vsDb.updateSection(id, {
        ...rest,
        ...(durationBudget !== undefined ? { durationBudget: durationBudget.toString() } : {}),
        ...(sellingPointRefs !== undefined ? { sellingPointRefs: JSON.stringify(sellingPointRefs) } : {}),
        ...(painPointRefs !== undefined ? { painPointRefs: JSON.stringify(painPointRefs) } : {}),
        ...(userConfirmed !== undefined ? { userConfirmed: userConfirmed ? 1 : 0 } : {}),
      });
      return { success: true };
    }),

  // ─── Stage 2: Subtopic Expansion ──────────────────────────────

  generateSubtopics: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .mutation(async ({ input }) => {
      const sections = await vsDb.getSections(input.videoScriptId);
      const snapshot = await vsDb.getProductSnapshot(input.videoScriptId);

      const prompt = SUBTOPIC_EXPANSION_PROMPT
        .replace("{sections}", JSON.stringify(sections))
        .replace("{product_info}", snapshot ? JSON.stringify({
          sellingPoints: snapshot.sellingPointsHierarchy,
          painPoints: snapshot.painPoints,
        }) : "无产品信息");

      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是一位亚马逊产品视频的分镜师。请严格输出JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      const content = typeof response.choices[0]?.message?.content === "string"
        ? response.choices[0].message.content
        : "";
      const result = parseLLMJson(content);
      if (result?.sections) {
        for (const sec of result.sections) {
          const dbSection = sections.find(s => s.sectionCode === sec.section_code);
          if (dbSection && sec.subtopics) {
            await vsDb.saveSubtopics(dbSection.id, sec.subtopics.map((sub: any, i: number) => ({
              sectionId: dbSection.id,
              subtopicName: sub.subtopic_name,
              subtopicNameEn: sub.subtopic_name_en,
              durationBudget: sub.duration_budget?.toString(),
              shotCount: sub.shot_count || 1,
              sellingPointRef: sub.selling_point_ref,
              sortOrder: i,
            })));
          }
        }
      }
      const allSubtopics = await vsDb.getSubtopicsByVideoScript(input.videoScriptId);
      return { subtopics: allSubtopics, raw: content };
    }),

  getSubtopics: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getSubtopicsByVideoScript(input.videoScriptId);
    }),

  // ─── Stage 3: Shot Details ────────────────────────────────────

  generateShots: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const sections = await vsDb.getSections(input.videoScriptId);
      const snapshot = await vsDb.getProductSnapshot(input.videoScriptId);
      const summary = await vsDb.getCompetitorSummary(input.videoScriptId);

      // Build subtopics structure
      const subtopicsStructure = [];
      for (const sec of sections) {
        const subs = await vsDb.getSubtopicsBySection(sec.id);
        subtopicsStructure.push({
          section_code: sec.sectionCode,
          section_name: sec.sectionName,
          shooting_method: sec.shootingMethod,
          subtopics: subs.map(s => ({
            name: s.subtopicName,
            name_en: s.subtopicNameEn,
            duration: s.durationBudget,
            shot_count: s.shotCount,
          })),
        });
      }

      const script = await vsDb.getVideoScriptById(input.videoScriptId);
      const videoType = script?.videoType || "main_video";
      const stylePreset = (script as any)?.stylePreset || "minimal_white";

      // ─── Knowledge Base Injection for shot details ───
      let kbShotRef = "";
      try {
        const kbL1 = await getL1Index({
          userId: ctx.user.id,
          types: ["video"],
          keyword: script?.scriptName || "",
          scope: "all",
        });
        if (kbL1.length > 0) {
          const topIds = kbL1.slice(0, 3).map(item => item.id);
          const kbL2 = await getL2Summary(topIds, ["video"]);
          kbShotRef = kbL2.length > 0 ? `\n\n--- 知识库视频参考（镜头语言参考） ---\n${formatForPrompt(kbL2, "L2")}` : "";
          await logKbCallBatch(topIds.map(id => ({
            userId: ctx.user.id,
            callerModule: "video_script",
            callerAction: "generateShots",
            kbItemId: id,
            kbItemType: "video",
            loadLevel: "L2" as const,
          })));
        }
      } catch (e) {
        console.warn("[VideoScript] KB injection for shots failed:", e);
      }

      const prompt = SHOT_DETAIL_PROMPT
        .replace("{subtopics_structure}", JSON.stringify(subtopicsStructure, null, 2))
        .replace("{product_info}", snapshot ? JSON.stringify({
          basicInfo: snapshot.basicInfo,
          sellingPoints: snapshot.sellingPointsHierarchy,
          specs: snapshot.productSpecs,
        }) : "无产品信息")
        .replace("{competitor_reference}", (summary ? JSON.stringify({
          recommendedStructure: summary.recommendedStructure,
        }) : "无竞品参考") + kbShotRef)
        .replace("{video_type}", videoType)
        .replace("{video_type_template}", getVideoTypeTemplate(videoType))
        .replace("{style_preset}", buildStylePresetPrompt(stylePreset));

      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是一位专业的亚马逊产品视频分镜师。请严格输出JSON格式，每个镜头包含完整的14字段数据。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        maxTokens: 8000,
      });
      const content = typeof response.choices[0]?.message?.content === "string"
        ? response.choices[0].message.content
        : "";
      const result = parseLLMJson(content);
      if (result?.shots) {
        // Group shots by section and subtopic
        for (const sec of sections) {
          const subs = await vsDb.getSubtopicsBySection(sec.id);
          for (const sub of subs) {
            const matchingShots = result.shots.filter((s: any) =>
              s.section_code === sec.sectionCode && s.subtopic_name === sub.subtopicName
            );
            if (matchingShots.length > 0) {
              await vsDb.saveShots(sub.id, sec.id, matchingShots.map((s: any, i: number) => ({
                subtopicId: sub.id,
                sectionId: sec.id,
                shotCode: s.shot_code,
                duration: s.duration?.toString(),
                shotDescription: s.shot_description,
                sceneLocation: s.scene_location,
                cameraAngle: s.camera_angle,
                cameraMovement: s.camera_movement,
                overlayTextEn: s.overlay_text_en,
                overlayTextCn: s.overlay_text_cn,
                narrationEn: s.narration_en,
                narrationCn: s.narration_cn,
                subtitleEn: s.subtitle_en || "",
                subtitleCn: s.subtitle_cn || "",
                narratorType: s.narrator_type || "voiceover",
                generationStrategy: s.generation_strategy || "real_shoot",
                reuseFromShotCode: s.reuse_from_shot_code,
                colorScheme: s.color_scheme,
                props: JSON.stringify(s.props || []),
                notes: s.notes || "",
                sortOrder: i,
              })));
            }
          }
        }
      }
      const allShots = await vsDb.getAllShotsByVideoScript(input.videoScriptId);
      return { shots: allShots, raw: content };
    }),

  getShots: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getAllShotsByVideoScript(input.videoScriptId);
    }),

  updateShot: protectedProcedure
    .input(z.object({
      id: z.number(),
      shotDescription: z.string().optional(),
      sceneLocation: z.string().optional(),
      cameraAngle: z.enum(["extreme_closeup", "closeup", "medium_closeup", "medium", "medium_wide", "wide", "extreme_wide"]).optional(),
      cameraMovement: z.string().optional(),
      overlayTextEn: z.string().optional(),
      overlayTextCn: z.string().optional(),
      narrationEn: z.string().optional(),
      narrationCn: z.string().optional(),
      subtitleEn: z.string().optional(),
      subtitleCn: z.string().optional(),
      narratorType: z.enum(["voiceover", "model_narration", "text_only", "none"]).optional(),
      generationStrategy: z.enum(["real_shoot", "ai_image", "ai_video", "stock_footage", "screen_record", "mixed"]).optional(),
      duration: z.number().optional(),
      colorScheme: z.string().optional(),
      props: z.any().optional(),
      notes: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, duration, props, ...rest } = input;
      await vsDb.updateShot(id, {
        ...rest,
        ...(duration !== undefined ? { duration: duration.toString() } : {}),
        ...(props !== undefined ? { props: JSON.stringify(props) } : {}),
      });
      return { success: true };
    }),

  deleteShot: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      await vsDb.deleteShot(input.id);
      return { success: true };
    }),

  // ─── Stage 4: Edit Scripts ────────────────────────────────────

  generateEditScripts: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .mutation(async ({ input }) => {
      const sections = await vsDb.getSections(input.videoScriptId);
      const allShots = await vsDb.getAllShotsByVideoScript(input.videoScriptId);

      const sectionsWithShots = sections.map(sec => ({
        section_code: sec.sectionCode,
        section_name: sec.sectionName,
        duration: sec.durationBudget,
        shooting_method: sec.shootingMethod,
        shot_count: allShots.filter(s => s.sectionCode === sec.sectionCode).length,
      }));

      const prompt = EDIT_SCRIPT_PROMPT.replace("{sections_with_shots}", JSON.stringify(sectionsWithShots, null, 2));
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "你是一位资深的亚马逊视频剪辑策划师。请严格输出JSON格式。" },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });
      const content = typeof response.choices[0]?.message?.content === "string"
        ? response.choices[0].message.content
        : "";
      const result = parseLLMJson(content);
      if (result?.edit_scripts) {
        const saved = await vsDb.saveEditScripts(input.videoScriptId, result.edit_scripts.map((es: any, i: number) => ({
          videoScriptId: input.videoScriptId,
          editName: es.edit_name,
          videoPurpose: es.video_purpose || "main_listing",
          maxDuration: es.max_duration?.toString(),
          editStyle: es.edit_style,
          sectionMapping: JSON.stringify(es.section_mapping || []),
          description: es.description,
          sortOrder: i,
        })));
        return { editScripts: saved, raw: content };
      }
      return { editScripts: [], raw: content };
    }),

  getEditScripts: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getEditScripts(input.videoScriptId);
    }),

  updateEditScript: protectedProcedure
    .input(z.object({
      id: z.number(),
      editName: z.string().optional(),
      videoPurpose: z.enum(["spv_ad", "sbv_ad", "main_listing", "aplus", "social_media", "other"]).optional(),
      maxDuration: z.number().optional(),
      editStyle: z.string().optional(),
      sectionMapping: z.any().optional(),
      description: z.string().optional(),
      userConfirmed: z.boolean().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, maxDuration, sectionMapping, userConfirmed, ...rest } = input;
      await vsDb.updateEditScript(id, {
        ...rest,
        ...(maxDuration !== undefined ? { maxDuration: maxDuration.toString() } : {}),
        ...(sectionMapping !== undefined ? { sectionMapping: JSON.stringify(sectionMapping) } : {}),
        ...(userConfirmed !== undefined ? { userConfirmed: userConfirmed ? 1 : 0 } : {}),
      });
      return { success: true };
    }),

  // ─── Stage Advancement ────────────────────────────────────────

  advanceStage: protectedProcedure
    .input(z.object({
      videoScriptId: z.number(),
      fromStage: z.string(),
      toStage: z.string(),
    }))
    .mutation(async ({ input }) => {
      const script = await vsDb.getVideoScriptById(input.videoScriptId);
      if (!script) throw new Error("Video script not found");
      const stageStatus = typeof script.stageStatus === "string"
        ? JSON.parse(script.stageStatus)
        : script.stageStatus || {};
      stageStatus[input.fromStage] = "completed";
      stageStatus[input.toStage] = "in_progress";
      await vsDb.updateVideoScript(input.videoScriptId, {
        currentStage: input.toStage as any,
        stageStatus: JSON.stringify(stageStatus),
        status: "in_progress",
      });
      return { success: true };
    }),

  // ─── Video Type Specs & Style Presets (Static Data) ──────────

  getVideoTypeSpecs: protectedProcedure
    .query(async () => {
      return { specs: VIDEO_TYPE_SPECS, presets: STYLE_PRESETS };
    }),

  getVideoTypeSpec: protectedProcedure
    .input(z.object({ videoType: z.string() }))
    .query(async ({ input }) => {
      return getVideoTypeSpec(input.videoType);
    }),

  // ─── Version Management ──────────────────────────────────────

  createVersion: protectedProcedure
    .input(z.object({
      videoScriptId: z.number(),
      versionNote: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const script = await vsDb.getVideoScriptById(input.videoScriptId);
      if (!script) throw new Error("Video script not found");
      const sections = await vsDb.getSections(input.videoScriptId);
      const subtopics = await vsDb.getSubtopicsByVideoScript(input.videoScriptId);
      const shots = await vsDb.getAllShotsByVideoScript(input.videoScriptId);
      const editScripts = await vsDb.getEditScripts(input.videoScriptId);
      const currentVersion = (script as any).version || 1;
      const snapshotData = { script, sections, subtopics, shots, editScripts };
      const id = await vsDb.createVersion({
        videoScriptId: input.videoScriptId,
        version: currentVersion,
        versionNote: input.versionNote || `版本 ${currentVersion}`,
        snapshotData: JSON.stringify(snapshotData),
        createdBy: ctx.user!.id,
      });
      await vsDb.updateVideoScript(input.videoScriptId, {
        version: currentVersion + 1,
        versionNote: input.versionNote,
      } as any);
      return { id, version: currentVersion };
    }),

  getVersions: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getVersionsByVideoScript(input.videoScriptId);
    }),

  rollbackVersion: protectedProcedure
    .input(z.object({ versionId: z.number() }))
    .mutation(async ({ input }) => {
      const version = await vsDb.getVersionById(input.versionId);
      if (!version) throw new Error("Version not found");
      const snapshot = typeof version.snapshotData === "string"
        ? JSON.parse(version.snapshotData)
        : version.snapshotData;
      if (snapshot.sections) {
        await vsDb.saveSections(version.videoScriptId, snapshot.sections);
      }
      return { success: true, restoredVersion: version.version };
    }),

  // ─── SPV Segments ────────────────────────────────────────────

  saveSpvSegments: protectedProcedure
    .input(z.object({
      videoScriptId: z.number(),
      segments: z.array(z.object({
        segmentName: z.string(),
        focusDimension: z.string().optional(),
        descriptionText: z.string().optional(),
        maxDuration: z.number().optional(),
      })),
    }))
    .mutation(async ({ input }) => {
      const saved = await vsDb.saveSpvSegments(input.videoScriptId, input.segments.map((s, i) => ({
        videoScriptId: input.videoScriptId,
        segmentIndex: i + 1,
        segmentName: s.segmentName,
        focusDimension: s.focusDimension,
        descriptionText: s.descriptionText,
        maxDuration: s.maxDuration?.toString() || "25.0",
        sortOrder: i,
      })));
      return { segments: saved };
    }),

  getSpvSegments: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      return vsDb.getSpvSegments(input.videoScriptId);
    }),

  // ─── Reorder Operations ──────────────────────────────────────

  reorderSections: protectedProcedure
    .input(z.object({
      videoScriptId: z.number(),
      sectionIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      await vsDb.reorderSections(input.videoScriptId, input.sectionIds);
      return { success: true };
    }),

  reorderShots: protectedProcedure
    .input(z.object({
      subtopicId: z.number(),
      shotIds: z.array(z.number()),
    }))
    .mutation(async ({ input }) => {
      await vsDb.reorderShots(input.subtopicId, input.shotIds);
      return { success: true };
    }),

  addShot: protectedProcedure
    .input(z.object({
      subtopicId: z.number(),
      sectionId: z.number(),
      shotDescription: z.string().optional(),
      duration: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const id = await vsDb.addShotToSubtopic(input.subtopicId, input.sectionId, {
        shotDescription: input.shotDescription || "新镜头",
        duration: input.duration?.toString() || "3.0",
      });
      return { id };
    }),

  // ─── Stage Confirmation ──────────────────────────────────────

  confirmStage: protectedProcedure
    .input(z.object({
      videoScriptId: z.number(),
      stage: z.string(),
    }))
    .mutation(async ({ input }) => {
      const script = await vsDb.getVideoScriptById(input.videoScriptId);
      if (!script) throw new Error("Video script not found");
      const stageStatus = typeof script.stageStatus === "string"
        ? JSON.parse(script.stageStatus)
        : script.stageStatus || {};
      stageStatus[input.stage] = "confirmed";
      await vsDb.updateVideoScript(input.videoScriptId, {
        stageStatus: JSON.stringify(stageStatus),
      });
      return { success: true };
    }),

  // ─── Full Data Export ─────────────────────────────────────────

  getFullScript: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .query(async ({ input }) => {
      const script = await vsDb.getVideoScriptById(input.videoScriptId);
      const competitors = await vsDb.getCompetitorScriptsByVideoScript(input.videoScriptId);
      const summary = await vsDb.getCompetitorSummary(input.videoScriptId);
      const snapshot = await vsDb.getProductSnapshot(input.videoScriptId);
      const sections = await vsDb.getSections(input.videoScriptId);
      const subtopics = await vsDb.getSubtopicsByVideoScript(input.videoScriptId);
      const shots = await vsDb.getAllShotsByVideoScript(input.videoScriptId);
      const editScripts = await vsDb.getEditScripts(input.videoScriptId);
      const spvSegments = await vsDb.getSpvSegments(input.videoScriptId);
      const versions = await vsDb.getVersionsByVideoScript(input.videoScriptId);
      return { script, competitors, summary, snapshot, sections, subtopics, shots, editScripts, spvSegments, versions };
    }),

  // ═══════════════════════════════════════════════════════
  // Excel 导出
  // ═══════════════════════════════════════════════════════
  exportToExcel: protectedProcedure
    .input(z.object({ videoScriptId: z.number() }))
    .mutation(async ({ input }) => {
      // 1. 加载全部数据
      const script = await vsDb.getVideoScriptById(input.videoScriptId);
      if (!script) throw new Error("视频脚本不存在");
      const sections = await vsDb.getSections(input.videoScriptId);
      const subtopics = await vsDb.getSubtopicsByVideoScript(input.videoScriptId);
      const shots = await vsDb.getAllShotsByVideoScript(input.videoScriptId);
      const editScripts = await vsDb.getEditScripts(input.videoScriptId);

      // 2. 生成 Excel Buffer
      const buffer = await generateVideoScriptExcel({
        script, sections, subtopics, shots, editScripts,
      });

      // 3. 上传到 S3
      const timestamp = Date.now();
      const safeName = (script.scriptName || "视频脚本").replace(/[^\w\u4e00-\u9fff-]/g, "_");
      const fileKey = `video-scripts/${script.id}/${safeName}_${timestamp}.xlsx`;
      const { url } = await storagePut(fileKey, buffer, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");

      return { url, fileName: `${safeName}.xlsx` };
    }),
});
