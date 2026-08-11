import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as vsDb from "../videoScriptDb";
import { generateVideoScriptExcel } from "../videoScriptExcel";
import { storagePut } from "../storage";
import {
  registerVideoArtifact,
} from "../domains/ai_os/services/businessArtifactRegistry";
import {
  VIDEO_TYPE_SPECS,
  STYLE_PRESETS,
  getVideoTypeSpec,
} from "../videoScriptPrompts";
import {
  queueVideoGenerationJob,
  type VideoGenerationOperation,
} from "../domains/video/videoGenerationJob";
import { confirmVideoStage, type VideoStage } from "../domains/video/videoAgent";

async function queueVideoJob(input: {
  videoScriptId: number;
  operation: VideoGenerationOperation;
  userId: number;
  workspaceId?: number | null;
  projectId?: number;
  competitorScriptId?: number;
  rawContent?: string;
}) {
  const script = await vsDb.getVideoScriptById(input.videoScriptId);
  if (!script) throw new Error("视频脚本不存在");
  return queueVideoGenerationJob({
    videoScriptId: input.videoScriptId,
    projectId: input.projectId || script.projectId,
    operation: input.operation,
    competitorScriptId: input.competitorScriptId,
    rawContent: input.rawContent,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
  });
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
    .mutation(async ({ input, ctx }) => {
      const competitor = await vsDb.getCompetitorScriptById(input.competitorScriptId);
      if (!competitor) throw new Error("竞品脚本不存在");
      return queueVideoJob({
        videoScriptId: competitor.videoScriptId,
        operation: "competitor_analysis",
        competitorScriptId: input.competitorScriptId,
        rawContent: input.rawContent,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
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
    .mutation(async ({ input, ctx }) => {
      return queueVideoJob({
        videoScriptId: input.videoScriptId,
        operation: "competitor_summary",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
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
    .mutation(async ({ input, ctx }) => {
      return queueVideoJob({
        ...input,
        operation: "product_info",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
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
      return queueVideoJob({
        ...input,
        operation: "sections",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
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
    .mutation(async ({ input, ctx }) => {
      return queueVideoJob({
        videoScriptId: input.videoScriptId,
        operation: "subtopics",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
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
      return queueVideoJob({
        videoScriptId: input.videoScriptId,
        operation: "shots",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
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
    .mutation(async ({ input, ctx }) => {
      return queueVideoJob({
        videoScriptId: input.videoScriptId,
        operation: "edit_scripts",
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
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
      await registerVideoArtifact(input.videoScriptId, "user_edit", { confirmed: true });
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
      await registerVideoArtifact(version.videoScriptId, "user_edit", { confirmed: true });
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
    .mutation(async ({ input, ctx }) => {
      const script = await vsDb.getVideoScriptById(input.videoScriptId);
      if (!script) throw new Error("Video script not found");
      const stageStatus = typeof script.stageStatus === "string"
        ? JSON.parse(script.stageStatus)
        : script.stageStatus || {};
      stageStatus[input.stage] = "confirmed";
      await vsDb.updateVideoScript(input.videoScriptId, {
        stageStatus: JSON.stringify(stageStatus),
      });
      await confirmVideoStage({
        videoScriptId: input.videoScriptId,
        projectId: script.projectId,
        stage: input.stage as VideoStage,
        userId: ctx.user.id,
        workspaceId: ctx.workspaceId,
      });
      await registerVideoArtifact(input.videoScriptId, "user_edit", { confirmed: true });
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
