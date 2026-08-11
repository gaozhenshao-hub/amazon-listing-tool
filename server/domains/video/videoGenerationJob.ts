import { z } from "zod";
import * as db from "../../repositories";
import * as vsDb from "../../videoScriptDb";
import {
  COMPETITOR_SCRIPT_ANALYSIS_PROMPT,
  COMPETITOR_SUMMARY_PROMPT,
  EDIT_SCRIPT_PROMPT,
  PRODUCT_INFO_EXTRACTION_PROMPT,
  SECTION_PLANNING_PROMPT,
  SHOT_DETAIL_PROMPT,
  SUBTOPIC_EXPANSION_PROMPT,
  buildStylePresetPrompt,
  getVideoTypeTemplate,
} from "../../videoScriptPrompts";
import { getL1Index, getL2Summary, formatForPrompt, logKbCallBatch } from "../../kbContextEngine";
import {
  registerVideoArtifact,
  recordBusinessArtifactUse,
  resolveCurrentBusinessArtifact,
} from "../ai_os/services/businessArtifactRegistry";
import {
  cancelAiJob,
  generateAiJobRunId,
  getAiJobRun,
  listAiJobRunsForUser,
  recoverAiJob,
  registerAiJobHandler,
  startRegisteredAiJob,
  updateAiJobProgress,
  type AiJobSnapshot,
} from "../ai_os/services/jobRunner";
import { runEmperorSkill, safeParseSkillJSON } from "../ai_os/services/skillRunner";
import {
  businessJobCheckpointBinder,
  classifyBusinessJobFailure,
} from "../ai_os/services/businessJobCheckpointBinder";
import {
  ensureVideoAgentRun,
  getVideoAgentDag,
  VIDEO_OPERATION_NODE_MAP,
  type VideoStage,
} from "./videoAgent";

export const VIDEO_JOB_KIND = "video.generation";
export const VIDEO_JOB_MODULE = "videoScript";

export const videoGenerationOperationSchema = z.enum([
  "competitor_analysis",
  "competitor_summary",
  "product_info",
  "sections",
  "subtopics",
  "shots",
  "edit_scripts",
]);
export type VideoGenerationOperation = z.infer<typeof videoGenerationOperationSchema>;

const videoGenerationJobInputSchema = z.object({
  videoScriptId: z.number().int().positive(),
  projectId: z.number().int().positive(),
  operation: videoGenerationOperationSchema,
  competitorScriptId: z.number().int().positive().optional(),
  rawContent: z.string().optional(),
  agentRunId: z.string().min(1),
  agentNodeId: z.string().min(1),
});

const operationConfig: Record<VideoGenerationOperation, {
  skillSlug: string;
  procedure: string;
  stage: VideoStage;
  timeoutSeconds: number;
}> = {
  competitor_analysis: { skillSlug: "video.competitor.analysis", procedure: "videoScript.analyzeCompetitorScript", stage: "stage_0a", timeoutSeconds: 420 },
  competitor_summary: { skillSlug: "video.competitor.analysis", procedure: "videoScript.generateCompetitorSummary", stage: "stage_0a", timeoutSeconds: 420 },
  product_info: { skillSlug: "video.section.plan", procedure: "videoScript.extractProductInfo", stage: "stage_0b", timeoutSeconds: 420 },
  sections: { skillSlug: "video.section.plan", procedure: "videoScript.generateSections", stage: "stage_1", timeoutSeconds: 600 },
  subtopics: { skillSlug: "video.section.plan", procedure: "videoScript.generateSubtopics", stage: "stage_2", timeoutSeconds: 600 },
  shots: { skillSlug: "video.shot.detail", procedure: "videoScript.generateShots", stage: "stage_3", timeoutSeconds: 1200 },
  edit_scripts: { skillSlug: "video.edit.script", procedure: "videoScript.generateEditScripts", stage: "stage_4", timeoutSeconds: 600 },
};

const legacySystemPrompts: Record<VideoGenerationOperation, string> = {
  competitor_analysis: "你是一位资深的亚马逊产品视频分析师。请严格输出JSON格式。",
  competitor_summary: "你是一位资深的亚马逊视频策略分析师。请严格输出JSON格式。",
  product_info: "你是一位亚马逊产品视频策划专家。请严格输出JSON格式。",
  sections: "你是一位资深的亚马逊产品视频编导。请严格输出JSON格式。",
  subtopics: "你是一位亚马逊产品视频的分镜师。请严格输出JSON格式。",
  shots: "你是一位专业的亚马逊产品视频分镜师。请严格输出JSON格式，每个镜头包含完整的14字段数据。",
  edit_scripts: "你是一位资深的亚马逊视频剪辑策划师。请严格输出JSON格式。",
};

const VALID_SHOOTING_METHODS = ["model_narration", "live_action", "ai_generated", "mixed", "screen_recording"] as const;

function sanitizeShootingMethod(value: string | undefined | null): typeof VALID_SHOOTING_METHODS[number] {
  if (!value) return "live_action";
  const firstValue = value.split("|")[0].trim().toLowerCase();
  if (VALID_SHOOTING_METHODS.includes(firstValue as any)) return firstValue as typeof VALID_SHOOTING_METHODS[number];
  return VALID_SHOOTING_METHODS.find((method) => firstValue.includes(method)) || "live_action";
}

async function updateVideoStageStatus(videoScriptId: number, stage: VideoStage, status: string) {
  const script = await vsDb.getVideoScriptById(videoScriptId);
  if (!script) return;
  let stageStatus: Record<string, unknown> = {};
  try {
    stageStatus = typeof script.stageStatus === "string" ? JSON.parse(script.stageStatus) : (script.stageStatus || {}) as Record<string, unknown>;
  } catch {
    stageStatus = {};
  }
  stageStatus[stage] = status;
  await vsDb.updateVideoScript(videoScriptId, {
    stageStatus: JSON.stringify(stageStatus),
    currentStage: stage as any,
    status: "in_progress",
  });
}

async function buildProductContext(projectId: number) {
  const parts: string[] = [];
  const files = await db.getProjectFilesByProject(projectId);
  for (const file of files) {
    if (file.status !== "completed" || !file.analysisResult) continue;
    try {
      const artifact = await resolveCurrentBusinessArtifact({
        domain: "listing",
        artifactKey: `project_file.${file.fileType}.analysis`,
        sourceTable: "projectFiles",
        sourceRowId: file.id,
        projectId,
      }).catch(() => null);
      if (artifact) {
        await recordBusinessArtifactUse({
          artifact,
          consumerDomain: "video",
          consumerType: "business_operation",
          consumerId: `video.context:${projectId}`,
          projectId,
          metadata: { source: "project_file", fileType: file.fileType },
        });
      }
      const parsed: any = artifact?.content || JSON.parse(file.analysisResult);
      if (file.fileType === "product_attributes") {
        parts.push("--- 产品属性 ---");
        if (parsed.uniqueSellingPoints?.length) parts.push(`独特卖点: ${parsed.uniqueSellingPoints.join("; ")}`);
        if (parsed.coreSpecs?.length) parts.push(`核心参数: ${parsed.coreSpecs.map((spec: any) => `${spec.attribute}: ${spec.value}`).join("; ")}`);
      }
    } catch {}
  }
  const analyses = await db.getCompetitorAnalysesByProject(projectId);
  if (analyses.length) {
    parts.push("\n--- 竞品分析 ---");
    for (const row of analyses) {
      const artifact = await resolveCurrentBusinessArtifact({
        domain: "listing",
        artifactKey: `listing.competitor_analysis.${row.asin}`,
        sourceTable: "competitorAnalyses",
        sourceRowId: row.id,
        projectId,
      }).catch(() => null);
      const analysis: any = artifact?.content && typeof artifact.content === "object" ? { ...row, ...artifact.content } : row;
      parts.push(`竞品 ASIN: ${analysis.asin}`);
      if (analysis.title) parts.push(`标题: ${analysis.title}`);
      if (analysis.bulletPoints) parts.push(`五点: ${analysis.bulletPoints}`);
    }
  }
  const listingArtifact = await resolveCurrentBusinessArtifact({ domain: "listing", artifactKey: "listing.content", projectId }).catch(() => null);
  const listings = listingArtifact?.content && typeof listingArtifact.content === "object"
    ? [((listingArtifact.content as any).listing)].filter(Boolean)
    : await db.getListingsByProject(projectId);
  if (listings.length) {
    parts.push("\n--- Listing内容 ---");
    for (const listing of listings) {
      if (listing.title) parts.push(`标题: ${listing.title}`);
      if (listing.bulletPoints) parts.push(`五点: ${listing.bulletPoints}`);
      if (listing.description) parts.push(`描述: ${listing.description}`);
    }
  }
  const review = await db.getReviewAggregationByProject(projectId);
  if (review) {
    parts.push("\n--- 评论分析 ---");
    if (review.painPoints) parts.push(`痛点: ${review.painPoints}`);
    if (review.keyThemes) parts.push(`关键主题: ${review.keyThemes}`);
    if (review.overallSentiment) parts.push(`整体情感: ${review.overallSentiment}`);
  }
  return parts.join("\n");
}

async function callVideoSkill(input: {
  operation: VideoGenerationOperation;
  prompt: string;
  job: AiJobSnapshot;
  signal: AbortSignal;
}) {
  const config = operationConfig[input.operation];
  const result = await runEmperorSkill<Record<string, any>>({
    skillSlug: config.skillSlug,
    userId: input.job.userId,
    workspaceId: input.job.workspaceId,
    context: JSON.stringify({
      task: input.operation,
      legacyTaskPrompt: input.prompt,
      outputContract: "Return valid JSON only. Preserve all requested fields and arrays.",
    }),
    variables: { operation: input.operation },
    legacySystemPrompt: legacySystemPrompts[input.operation],
    migrationSource: "server/domains/video/videoGenerationJob.ts",
    maxModelAttempts: 1,
    signal: input.signal,
    validate: (content) => {
      const parsed = safeParseSkillJSON<Record<string, any>>(content);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || "raw" in parsed) {
        throw new Error(`皇帝 Skill ${config.skillSlug} 未返回有效 JSON`);
      }
      return parsed;
    },
  });
  return result.parsed;
}

async function ensureCurrentVideoJob(job: AiJobSnapshot, input: z.infer<typeof videoGenerationJobInputSchema>) {
  const jobs = await listAiJobRunsForUser(job.userId, { module: VIDEO_JOB_MODULE, projectId: input.projectId, limit: 100 });
  const newer = jobs.find((candidate) => {
    if (candidate.runId === job.runId || candidate.createdAt.getTime() <= job.createdAt.getTime()) return false;
    const parsed = videoGenerationJobInputSchema.safeParse(candidate.input);
    return parsed.success
      && parsed.data.videoScriptId === input.videoScriptId
      && parsed.data.agentNodeId === input.agentNodeId
      && (input.competitorScriptId === undefined || parsed.data.competitorScriptId === input.competitorScriptId);
  });
  if (newer) throw new Error(`视频任务已被更新的任务 ${newer.runId} 替代`);
}

async function knowledgeBaseExamples(job: AiJobSnapshot, script: any, action: string, limit: number) {
  try {
    const levelOne = await getL1Index({ userId: job.userId, types: ["video"], keyword: script?.scriptName || "", scope: "all" });
    if (!levelOne.length) return "";
    const ids = levelOne.slice(0, limit).map((item) => item.id);
    const levelTwo = await getL2Summary(ids, ["video"]);
    await logKbCallBatch(ids.map((id) => ({
      userId: job.userId,
      callerModule: "video_script",
      callerAction: action,
      kbItemId: id,
      kbItemType: "video",
      loadLevel: levelTwo.length ? "L2" as const : "L1" as const,
    })));
    return formatForPrompt(levelTwo.length ? levelTwo : levelOne, levelTwo.length ? "L2" : "L1");
  } catch (error) {
    console.warn(`[Video Job] ${action} knowledge base context unavailable:`, error);
    return "";
  }
}

async function executeVideoOperation(job: AiJobSnapshot, signal: AbortSignal, input: z.infer<typeof videoGenerationJobInputSchema>) {
  await ensureCurrentVideoJob(job, input);
  if (input.operation === "competitor_analysis") {
    if (!input.competitorScriptId || !input.rawContent) throw new Error("竞品脚本内容不能为空");
    const prompt = COMPETITOR_SCRIPT_ANALYSIS_PROMPT.replace("{competitor_content}", input.rawContent);
    const analysis = await callVideoSkill({ operation: input.operation, prompt, job, signal });
    await ensureCurrentVideoJob(job, input);
    await vsDb.updateCompetitorScript(input.competitorScriptId, {
      rawContent: input.rawContent,
      structureAnalysis: JSON.stringify(analysis.structure_analysis || {}),
      visualLanguage: JSON.stringify(analysis.visual_language || {}),
      copywritingAnalysis: JSON.stringify(analysis.copywriting_analysis || {}),
      strengths: JSON.stringify(analysis.strengths || []),
      weaknesses: JSON.stringify(analysis.weaknesses || []),
      reusablePatterns: JSON.stringify(analysis.reusable_patterns || []),
    });
    return { analysis };
  }
  if (input.operation === "competitor_summary") {
    const competitors = await vsDb.getCompetitorScriptsByVideoScript(input.videoScriptId);
    const prompt = COMPETITOR_SUMMARY_PROMPT.replace("{competitor_analyses}", JSON.stringify(competitors.map((competitor) => ({
      name: competitor.competitorName,
      asin: competitor.competitorAsin,
      structure: competitor.structureAnalysis,
      visual: competitor.visualLanguage,
      copywriting: competitor.copywritingAnalysis,
      strengths: competitor.strengths,
      weaknesses: competitor.weaknesses,
    })), null, 2));
    const summary = await callVideoSkill({ operation: input.operation, prompt, job, signal });
    await ensureCurrentVideoJob(job, input);
    await vsDb.upsertCompetitorSummary({
      videoScriptId: input.videoScriptId,
      competitorScriptIds: JSON.stringify(competitors.map((competitor) => competitor.id)),
      commonStructure: JSON.stringify(summary.common_structure || {}),
      optimalDurationAllocation: JSON.stringify(summary.optimal_duration_allocation || []),
      differentiableOpportunities: JSON.stringify(summary.differentiable_opportunities || []),
      recommendedStructure: JSON.stringify(summary.recommended_structure || {}),
    });
    return { summary };
  }
  if (input.operation === "product_info") {
    const prompt = PRODUCT_INFO_EXTRACTION_PROMPT.replace("{product_data}", await buildProductContext(input.projectId));
    const productInfo = await callVideoSkill({ operation: input.operation, prompt, job, signal });
    await ensureCurrentVideoJob(job, input);
    await vsDb.upsertProductSnapshot({
      videoScriptId: input.videoScriptId,
      basicInfo: JSON.stringify(productInfo.basic_info || {}),
      sellingPointsHierarchy: JSON.stringify(productInfo.selling_points_hierarchy || []),
      painPoints: JSON.stringify(productInfo.pain_points_from_reviews || []),
      keywords: JSON.stringify(productInfo.keywords_for_overlay || []),
      productSpecs: JSON.stringify(productInfo.key_specs || []),
      dataSources: JSON.stringify({ projectId: input.projectId, extractedAt: new Date().toISOString() }),
    });
    return { productInfo };
  }
  if (input.operation === "sections") {
    const [script, snapshot, summary] = await Promise.all([
      vsDb.getVideoScriptById(input.videoScriptId),
      vsDb.getProductSnapshot(input.videoScriptId),
      vsDb.getCompetitorSummary(input.videoScriptId),
    ]);
    const examples = await knowledgeBaseExamples(job, script, "generateSections", 5);
    const videoType = script?.videoType || "main_video";
    const stylePreset = (script as any)?.stylePreset || "minimal_white";
    const prompt = SECTION_PLANNING_PROMPT
      .replace("{product_info}", snapshot ? JSON.stringify({ basicInfo: snapshot.basicInfo, sellingPoints: snapshot.sellingPointsHierarchy, painPoints: snapshot.painPoints, keywords: snapshot.keywords }) : "无产品信息")
      .replace("{competitor_reference}", summary ? JSON.stringify({ recommendedStructure: summary.recommendedStructure, differentiableOpportunities: summary.differentiableOpportunities }) : "无竞品参考")
      .replace("{knowledge_base_examples}", examples || "暂无知识库案例")
      .replace("{video_type}", videoType)
      .replace("{video_type_template}", getVideoTypeTemplate(videoType))
      .replace("{style_preset}", buildStylePresetPrompt(stylePreset))
      .replace("{target_duration}", script?.targetDuration?.toString() || "60")
      .replace("{spv_segment_index}", "N/A");
    const result = await callVideoSkill({ operation: input.operation, prompt, job, signal });
    await ensureCurrentVideoJob(job, input);
    const sections = Array.isArray(result.sections) ? await vsDb.saveSections(input.videoScriptId, result.sections.map((section: any, index: number) => ({
      videoScriptId: input.videoScriptId,
      sectionCode: section.section_code || `MBP${index + 1}`,
      sectionName: section.section_name || section.scene_name,
      sectionNameEn: section.section_name_en,
      shootingMethod: sanitizeShootingMethod(section.shooting_method),
      durationBudget: section.duration_budget?.toString(),
      sellingPointRefs: JSON.stringify(section.selling_point_refs || []),
      painPointRefs: JSON.stringify(section.pain_point_refs || []),
      description: section.description || "",
      shotTypeSuggestion: section.shot_type_suggestion || "",
      propsSuggestion: JSON.stringify(section.props_suggestion || []),
      sortOrder: index,
    }))) : [];
    return { sections };
  }
  if (input.operation === "subtopics") {
    const [sections, snapshot] = await Promise.all([
      vsDb.getSections(input.videoScriptId),
      vsDb.getProductSnapshot(input.videoScriptId),
    ]);
    const prompt = SUBTOPIC_EXPANSION_PROMPT
      .replace("{sections}", JSON.stringify(sections))
      .replace("{product_info}", snapshot ? JSON.stringify({ sellingPoints: snapshot.sellingPointsHierarchy, painPoints: snapshot.painPoints }) : "无产品信息");
    const result = await callVideoSkill({ operation: input.operation, prompt, job, signal });
    await ensureCurrentVideoJob(job, input);
    for (const section of Array.isArray(result.sections) ? result.sections : []) {
      const dbSection = sections.find((candidate) => candidate.sectionCode === section.section_code);
      if (!dbSection || !Array.isArray(section.subtopics)) continue;
      await vsDb.saveSubtopics(dbSection.id, section.subtopics.map((subtopic: any, index: number) => ({
        sectionId: dbSection.id,
        subtopicName: subtopic.subtopic_name,
        subtopicNameEn: subtopic.subtopic_name_en,
        durationBudget: subtopic.duration_budget?.toString(),
        shotCount: subtopic.shot_count || 1,
        sellingPointRef: subtopic.selling_point_ref,
        sortOrder: index,
      })));
    }
    return { subtopics: await vsDb.getSubtopicsByVideoScript(input.videoScriptId) };
  }
  if (input.operation === "shots") {
    const [sections, snapshot, summary, script] = await Promise.all([
      vsDb.getSections(input.videoScriptId),
      vsDb.getProductSnapshot(input.videoScriptId),
      vsDb.getCompetitorSummary(input.videoScriptId),
      vsDb.getVideoScriptById(input.videoScriptId),
    ]);
    const subtopicsStructure = [];
    for (const section of sections) {
      const subtopics = await vsDb.getSubtopicsBySection(section.id);
      subtopicsStructure.push({
        section_code: section.sectionCode,
        section_name: section.sectionName,
        shooting_method: section.shootingMethod,
        subtopics: subtopics.map((subtopic) => ({ name: subtopic.subtopicName, name_en: subtopic.subtopicNameEn, duration: subtopic.durationBudget, shot_count: subtopic.shotCount })),
      });
    }
    const examples = await knowledgeBaseExamples(job, script, "generateShots", 3);
    const videoType = script?.videoType || "main_video";
    const prompt = SHOT_DETAIL_PROMPT
      .replace("{subtopics_structure}", JSON.stringify(subtopicsStructure, null, 2))
      .replace("{product_info}", snapshot ? JSON.stringify({ basicInfo: snapshot.basicInfo, sellingPoints: snapshot.sellingPointsHierarchy, specs: snapshot.productSpecs }) : "无产品信息")
      .replace("{competitor_reference}", `${summary ? JSON.stringify({ recommendedStructure: summary.recommendedStructure }) : "无竞品参考"}${examples ? `\n\n--- 知识库视频参考 ---\n${examples}` : ""}`)
      .replace("{video_type}", videoType)
      .replace("{video_type_template}", getVideoTypeTemplate(videoType))
      .replace("{style_preset}", buildStylePresetPrompt((script as any)?.stylePreset || "minimal_white"));
    const result = await callVideoSkill({ operation: input.operation, prompt, job, signal });
    await ensureCurrentVideoJob(job, input);
    const generatedShots = Array.isArray(result.shots) ? result.shots : [];
    for (const section of sections) {
      const subtopics = await vsDb.getSubtopicsBySection(section.id);
      for (const subtopic of subtopics) {
        const matching = generatedShots.filter((shot: any) => shot.section_code === section.sectionCode && shot.subtopic_name === subtopic.subtopicName);
        if (!matching.length) continue;
        await vsDb.saveShots(subtopic.id, section.id, matching.map((shot: any, index: number) => ({
          subtopicId: subtopic.id,
          sectionId: section.id,
          shotCode: shot.shot_code,
          duration: shot.duration?.toString(),
          shotDescription: shot.shot_description,
          sceneLocation: shot.scene_location,
          cameraAngle: shot.camera_angle,
          cameraMovement: shot.camera_movement,
          overlayTextEn: shot.overlay_text_en,
          overlayTextCn: shot.overlay_text_cn,
          narrationEn: shot.narration_en,
          narrationCn: shot.narration_cn,
          subtitleEn: shot.subtitle_en || "",
          subtitleCn: shot.subtitle_cn || "",
          narratorType: shot.narrator_type || "voiceover",
          generationStrategy: shot.generation_strategy || "real_shoot",
          reuseFromShotCode: shot.reuse_from_shot_code,
          colorScheme: shot.color_scheme,
          props: JSON.stringify(shot.props || []),
          notes: shot.notes || "",
          sortOrder: index,
        })));
      }
    }
    return { shots: await vsDb.getAllShotsByVideoScript(input.videoScriptId) };
  }
  const sections = await vsDb.getSections(input.videoScriptId);
  const allShots = await vsDb.getAllShotsByVideoScript(input.videoScriptId);
  const prompt = EDIT_SCRIPT_PROMPT.replace("{sections_with_shots}", JSON.stringify(sections.map((section) => ({
    section_code: section.sectionCode,
    section_name: section.sectionName,
    duration: section.durationBudget,
    shooting_method: section.shootingMethod,
    shot_count: allShots.filter((shot) => shot.sectionCode === section.sectionCode).length,
  })), null, 2));
  const result = await callVideoSkill({ operation: input.operation, prompt, job, signal });
  await ensureCurrentVideoJob(job, input);
  const editScripts = Array.isArray(result.edit_scripts) ? await vsDb.saveEditScripts(input.videoScriptId, result.edit_scripts.map((editScript: any, index: number) => ({
    videoScriptId: input.videoScriptId,
    editName: editScript.edit_name,
    videoPurpose: editScript.video_purpose || "main_listing",
    maxDuration: editScript.max_duration?.toString(),
    editStyle: editScript.edit_style,
    sectionMapping: JSON.stringify(editScript.section_mapping || []),
    description: editScript.description,
    sortOrder: index,
  }))) : [];
  return { editScripts };
}

function bindingInput(job: AiJobSnapshot, input: z.infer<typeof videoGenerationJobInputSchema>, extra: Record<string, unknown> = {}) {
  return {
    runId: input.agentRunId,
    dag: getVideoAgentDag(),
    nodeId: input.agentNodeId,
    aiJobRunId: job.runId,
    aiJobAttempt: job.attempt,
    maxAttempts: job.maxAttempts,
    userId: job.userId,
    workspaceId: job.workspaceId,
    projectId: input.projectId,
    metadata: { videoScriptId: input.videoScriptId, operation: input.operation, stage: operationConfig[input.operation].stage },
    ...extra,
  };
}

async function handleVideoGenerationJob(job: AiJobSnapshot, { signal }: { signal: AbortSignal }) {
  const input = videoGenerationJobInputSchema.parse(job.input);
  await businessJobCheckpointBinder.sync("running", bindingInput(job, input, { progress: Math.max(job.progress, 10) }));
  await updateVideoStageStatus(input.videoScriptId, operationConfig[input.operation].stage, "running");
  try {
    await updateAiJobProgress(job.runId, 25, { expectedAttempt: job.attempt });
    const output = await executeVideoOperation(job, signal, input);
    await updateAiJobProgress(job.runId, 90, { expectedAttempt: job.attempt });
    await registerVideoArtifact(input.videoScriptId, "ai_output", { confirmed: false });
    await businessJobCheckpointBinder.sync("succeeded", bindingInput(job, input, { output, progress: 100 }));
    await updateVideoStageStatus(input.videoScriptId, operationConfig[input.operation].stage, "generated");
    return output;
  } catch (error) {
    const failure = classifyBusinessJobFailure({ error, signal, attempt: job.attempt, maxAttempts: job.maxAttempts });
    if (/替代/.test(failure.message)) {
      await cancelAiJob(job.runId, failure.message);
      await businessJobCheckpointBinder.sync("canceled", bindingInput(job, input, { errorMessage: failure.message, failureKind: "cancel" }));
      return { canceled: true, reason: failure.message };
    }
    await businessJobCheckpointBinder.sync(failure.lifecycleStatus, bindingInput(job, input, {
      errorMessage: failure.message,
      failureKind: failure.failureKind,
      finalAttempt: failure.finalAttempt,
      progress: failure.finalAttempt ? 100 : Math.max(job.progress, 15),
    })).catch((syncError) => console.warn("[Video Job] Failed to sync failure:", syncError));
    if (failure.finalAttempt) await updateVideoStageStatus(input.videoScriptId, operationConfig[input.operation].stage, failure.lifecycleStatus);
    throw error;
  }
}

registerAiJobHandler({
  id: "video-generation",
  match: (job) => job.kind === VIDEO_JOB_KIND,
  handler: handleVideoGenerationJob,
  recoverable: true,
});

export async function queueVideoGenerationJob(input: {
  videoScriptId: number;
  projectId: number;
  operation: VideoGenerationOperation;
  competitorScriptId?: number;
  rawContent?: string;
  userId: number;
  workspaceId?: number | null;
}) {
  const base = videoGenerationJobInputSchema.omit({ agentRunId: true, agentNodeId: true }).parse(input);
  const agent = await ensureVideoAgentRun(input);
  const agentNodeId = VIDEO_OPERATION_NODE_MAP[input.operation];
  const jobs = await listAiJobRunsForUser(input.userId, { module: VIDEO_JOB_MODULE, projectId: input.projectId, limit: 100 });
  const active = jobs.find((job) => {
    const parsed = videoGenerationJobInputSchema.safeParse(job.input);
    return parsed.success
      && parsed.data.videoScriptId === input.videoScriptId
      && parsed.data.agentNodeId === agentNodeId
      && ["queued", "running"].includes(job.status);
  });
  if (active) {
    const parsed = videoGenerationJobInputSchema.parse(active.input);
    await businessJobCheckpointBinder.sync(active.status === "queued" ? "queued" : "running", bindingInput(active, parsed, { progress: active.progress })).catch(() => null);
    return { ...active, alreadyRunning: true, agentRunId: parsed.agentRunId };
  }

  const config = operationConfig[input.operation];
  const runId = generateAiJobRunId(`video_${input.operation}`);
  const job = await startRegisteredAiJob({
    runId,
    kind: VIDEO_JOB_KIND,
    module: VIDEO_JOB_MODULE,
    procedure: config.procedure,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    projectId: input.projectId,
    skillSlug: config.skillSlug,
    input: { ...base, agentRunId: agent.runId, agentNodeId },
    progress: 2,
    priority: 12,
    queueName: "video",
    maxAttempts: 3,
    timeoutSeconds: config.timeoutSeconds,
  });
  const parsed = videoGenerationJobInputSchema.parse(job.input);
  await businessJobCheckpointBinder.sync("queued", bindingInput(job, parsed, { progress: 2 }));
  await updateVideoStageStatus(input.videoScriptId, config.stage, "queued");
  return { ...job, alreadyRunning: false, agentRunId: agent.runId };
}

export async function cancelVideoGenerationJob(input: { runId: string; userId: number }) {
  const job = await getAiJobRun(input.runId);
  if (!job || job.userId !== input.userId || job.module !== VIDEO_JOB_MODULE) throw new Error("视频任务不存在或无权访问");
  const parsed = videoGenerationJobInputSchema.parse(job.input);
  await cancelAiJob(job.runId, "用户取消视频生成任务");
  await businessJobCheckpointBinder.sync("canceled", bindingInput(job, parsed, { errorMessage: "用户取消视频生成任务", failureKind: "cancel", progress: 100 }));
  await updateVideoStageStatus(parsed.videoScriptId, operationConfig[parsed.operation].stage, "canceled");
  return getAiJobRun(job.runId);
}

export async function retryVideoGenerationJob(input: { runId: string; userId: number }) {
  const existing = await getAiJobRun(input.runId);
  if (!existing || existing.userId !== input.userId || existing.module !== VIDEO_JOB_MODULE) throw new Error("视频任务不存在或无权访问");
  const recovered = await recoverAiJob(existing.runId, "用户请求重试视频生成任务");
  const parsed = videoGenerationJobInputSchema.parse(recovered.input);
  await businessJobCheckpointBinder.sync("queued", bindingInput(recovered, parsed, { progress: recovered.progress }));
  await updateVideoStageStatus(parsed.videoScriptId, operationConfig[parsed.operation].stage, "queued");
  return recovered;
}

export function isVideoGenerationJob(job: AiJobSnapshot | null | undefined) {
  return job?.module === VIDEO_JOB_MODULE && job.kind === VIDEO_JOB_KIND;
}
