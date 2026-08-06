import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import * as db from "./repository";
import { devDb, kbDb } from "./repository";
import {
  STEP0_COMPETITOR_IMAGE_ANALYSIS_PROMPT,
  STEP0_COMPETITOR_SUMMARY_PROMPT,
  STEP1_SELLING_POINTS_PROMPT,
  STEP2_IMAGE_OUTLINE_PROMPT,
  STEP2_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP3_STYLE_PROMPT,
  STEP4_REFERENCE_PROMPT,
  STEP5_FINAL_SUGGESTION_PROMPT,
  STEP4_REOPTIMIZE_WITH_REFS_PROMPT,
  STEP5_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP5_SINGLE_APLUS_MODULE_OPTIMIZE_PROMPT,
  STEP5_APLUS_COMBO_RECOMMEND_PROMPT,
} from "../../imageWorkflowPrompts";
import { IMAGE_ADVICE_TRANSLATION_PROMPT } from "../../prompts";
import { invokeBusinessSkill, storagePut } from "./service";
import { runEmperorSkill, safeParseSkillJSON } from "../ai_os/services/skillRunner";
import {
  hydrateImageWorkflowSessionFromArtifacts,
  recordBusinessArtifactUse,
  resolveCurrentBusinessArtifact,
} from "../ai_os/services/businessArtifactRegistry";
import {
  applyImageWorkflowAplusStyle,
  findImageWorkflowAplusModule,
  normalizeImageOutline,
  normalizeSecondaryImageSlots,
} from "@shared/imageWorkflow";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
} from "./service";
import {
  ensureBusinessManagedRun,
  markBusinessManagedNodeWaitingHuman,
  markBusinessManagedNodeConfirmed,
} from "../ai_os/services/businessManagedAgent";
export {
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
  db,
  devDb,
  invokeBusinessSkill,
  kbDb,
  protectedProcedure,
  registerAiJobHandler,
  router,
  startRegisteredAiJob,
  storagePut,
  applyImageWorkflowAplusStyle,
  findImageWorkflowAplusModule,
  normalizeImageOutline,
  normalizeSecondaryImageSlots,
  z,
  ensureBusinessManagedRun,
  markBusinessManagedNodeWaitingHuman,
  markBusinessManagedNodeConfirmed,
};

export const APLUS_MODULE_STYLE_GUIDE = [
  "premium_full_image: 高级完整图片，单张全宽大图，1464x600px",
  "premium_bg_image_text: 高级背景图像+文本，单张背景图叠字，1464x600px",
  "premium_four_image_text: 高级四图片+文本，4张子图，每图300x225px",
  "premium_dual_image_text: 高级双图片+文本，2张并列图，每图650x350px",
  "premium_single_image_text: 高级单图+文本，单张说明图，800x600px",
  "premium_nav_carousel: 高级导航轮播，2-5张轮播面板，每面板1464x600px",
  "premium_rule_carousel: 高级规则轮播，2-5张轮播面板，每面板1464x600px",
  "premium_simple_carousel: 高级简单图像轮播，2-6张轮播面板，每面板1464x600px",
  "premium_video_carousel: 高级视频图像轮播，2-6个视频或图片面板，每面板800x600px",
  "premium_hotspot_1/premium_hotspot_2: 高级热点，1张底图+2-6个热点",
  "premium_comparison_1/2/3: 高级比较表，按产品列和特征行拆分",
  "premium_qa: 高级问答，2-5组问答内容",
  "premium_tech_specs: 高级技术规格，3-15个规格项",
  "brand_highlight: 品牌亮点，3-4个品牌亮点卡片",
  "standard_four_image: 标准四图，4张子图",
  "standard_comparison: 标准对比表，最多5列对比",
  "standard_single_image/standard_image_text: 标准单图或图文",
].join("\n");

export const step5JobInput = z.object({
  projectId: z.number(),
  sessionId: z.number(),
});

// ─── Helper: Build context from project data ─────────────────────
export async function buildImageWorkflowContext(projectId: number) {
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
          consumerDomain: "image",
          consumerType: "business_operation",
          consumerId: `image.context:${projectId}`,
          projectId,
          metadata: { source: "project_file", fileType: file.fileType },
        });
      }
      const parsed = artifact?.content || JSON.parse(file.analysisResult);
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
    for (const row of analyses) {
      const artifact = await resolveCurrentBusinessArtifact({
        domain: "listing",
        artifactKey: `listing.competitor_analysis.${row.asin}`,
        sourceTable: "competitorAnalyses",
        sourceRowId: row.id,
        projectId,
      }).catch(() => null);
      if (artifact) {
        await recordBusinessArtifactUse({
          artifact,
          consumerDomain: "image",
          consumerType: "business_operation",
          consumerId: `image.context:${projectId}`,
          projectId,
          metadata: { source: "competitor_analysis", asin: row.asin },
        });
      }
      const a = artifact?.content && typeof artifact.content === "object"
        ? { ...row, ...(artifact.content as Record<string, unknown>) }
        : row;
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
export async function getKBReference(category: string, userId: number): Promise<string> {
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
export function parseLLMJson(response: any): any {
  let content = typeof response.choices[0].message.content === "string"
    ? response.choices[0].message.content
    : JSON.stringify(response.choices[0].message.content);
  // Strip markdown code blocks (```json ... ``` or ``` ... ```)
  const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) content = mdMatch[1].trim();
  // Find first { or [ and last } or ] to extract JSON
  const firstBrace = content.indexOf('{');
  const firstBracket = content.indexOf('[');
  let start = -1;
  if (firstBrace !== -1 && (firstBracket === -1 || firstBrace < firstBracket)) start = firstBrace;
  else if (firstBracket !== -1) start = firstBracket;
  if (start > 0) content = content.slice(start);
  const lastBrace = content.lastIndexOf('}');
  const lastBracket = content.lastIndexOf(']');
  const end = Math.max(lastBrace, lastBracket);
  if (end !== -1 && end < content.length - 1) content = content.slice(0, end + 1);
  try {
    return JSON.parse(content);
  } catch {
    return { raw: content };
  }
}

export async function callImageWorkflowSkill<T = any>(input: {
  skillSlug: string;
  userId: number;
  workspaceId?: number | null;
  systemPrompt: string;
  context: string;
  attachments?: any[];
  validate?: (value: any) => T;
}): Promise<T> {
  const result = await runEmperorSkill<T>({
    skillSlug: input.skillSlug,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    context: input.context,
    variables: {},
    attachments: input.attachments,
    legacySystemPrompt: input.systemPrompt,
    migrationSource: input.skillSlug === "image.step2.outline"
      ? "drizzle/0122_image_outline_reliability.sql"
      : "drizzle/0120_image_workflow_outline_contract.sql",
    validate: (content) => {
      const parsed = safeParseSkillJSON<any>(content);
      if (parsed && typeof parsed === "object" && "raw" in parsed) {
        throw new Error("皇帝 Skill 未返回有效 JSON");
      }
      return input.validate ? input.validate(parsed) : parsed as T;
    },
  });
  return result.parsed;
}

// ─── Helper: Call LLM with automatic retry on empty/invalid response ─────
export async function callLLMWithRetry(systemPrompt: string, userMessage: string, maxRetries = 2, skillSlug?: string): Promise<any> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const response = await invokeBusinessSkill({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      response_format: { type: "json_object" },
      ...(skillSlug ? { emperorSkill: { slug: skillSlug } } : {}),
    });
    const result = parseLLMJson(response);
    // If result has 'raw' field, it means LLM returned invalid/empty JSON - retry
    if (result && !result.raw) {
      return result;
    }
    console.warn(`[LLM Retry] Attempt ${attempt + 1} returned invalid JSON (raw field present). Retrying...`);
    // Small delay before retry
    if (attempt < maxRetries - 1) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }
  // Last attempt without json_object mode as fallback
  console.warn('[LLM Retry] All json_object attempts failed, trying without response_format...');
  const fallbackResponse = await invokeBusinessSkill({
    messages: [
      { role: "system", content: systemPrompt + "\n\n重要：你必须只输出纯JSON格式，不要有任何其他文字，不要使用markdown代码块。" },
      { role: "user", content: userMessage },
    ],
    ...(skillSlug ? { emperorSkill: { slug: skillSlug } } : {}),
  });
  return parseLLMJson(fallbackResponse);
}

// Helper: resolve project access for imageWorkflow based on user role
export async function resolveProjectAccess(projectId: number, user: { id: number; role: string }) {
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
export async function resolveSessionAccess(projectId: number, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin' || user.role === 'designer') {
    return db.getImageWorkflowSessionByProject(projectId);
  }
  return db.getImageWorkflowSession(projectId, user.id);
}

export async function resolveSessionForExecution(
  projectId: number,
  user: { id: number; role: string },
  consumerId: string,
) {
  const session = await resolveSessionAccess(projectId, user);
  if (!session) return null;
  return hydrateImageWorkflowSessionFromArtifacts(session, {
    consumerType: "business_operation",
    consumerId,
  });
}

export async function resolveSessionForDisplay(projectId: number, user: { id: number; role: string }) {
  const session = await resolveSessionAccess(projectId, user);
  if (!session) return null;
  return hydrateImageWorkflowSessionFromArtifacts(session, undefined, {
    onlyBusinessConfirmedSteps: true,
  });
}

// Helper: ensure write access for imageWorkflow mutations
export function ensureWriteAccess(project: { userId: number }, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin') return;
  if (user.role === 'designer' && project.userId !== user.id) {
    throw new Error("Designer角色只能查看他人项目的图片建议，不能修改");
  }
}

export type Step5RunStatus = "idle" | "queued" | "running" | "succeeded" | "failed" | "canceled";

export function generateStep5RunId(): string {
  return `image_step5_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export function isActiveStep5Run(status?: string | null): boolean {
  return status === "queued" || status === "running";
}

export function serializeStep5Error(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error || "生成失败");
}

export function parseStoredJson(value?: string | null): unknown {
  if (!value) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

export function buildStep5RunSnapshot(session: any) {
  const status = (session?.step5RunStatus || "idle") as Step5RunStatus;
  return {
    runId: session?.step5RunId || null,
    status,
    progress: Number(session?.step5RunProgress || (status === "succeeded" ? 100 : 0)),
    error: session?.step5RunError || null,
    startedAt: session?.step5RunStartedAt || null,
    completedAt: session?.step5RunCompletedAt || null,
    en: parseStoredJson(session?.step5UserEdit || session?.step5OptimizedResult || session?.step5AiResult),
    cn: parseStoredJson(session?.step5AiResultCn || session?.step5OptimizedResultCn),
  };
}

export async function buildStep5FinalSuggestion(project: any, session: any, userId: number, workspaceId?: number | null) {
  const truncate = (s: string | null, maxLen = 3000) => s ? s.substring(0, maxLen) : "";
  const step1Content = truncate(session.step1UserEdit || session.step1AiResult, 4000);
  const step2Content = truncate(session.step2UserEdit || session.step2AiResult, 4000);
  const step3Content = truncate(session.step3UserEdit || session.step3AiResult, 3000);
  const step4Content = truncate(session.step4UserEdit || session.step4AiResult, 3000);

  const kbReference = await getKBReference(project.category || "", userId);
  const context = `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${step1Content}\n\n--- 已确认的图片大纲 ---\n${step2Content}\n\n--- 已确认的风格方案 ---\n${step3Content}\n\n--- 已确认的参考图 ---\n${step4Content}${kbReference}\n\n请综合以上所有确认结果（包括知识库参考），输出每张图的完整图片建议。secondaryImages必须恰好包含6项，imageNumber依次且仅为2、3、4、5、6、7，不得遗漏辅图7。A+内容必须继承图片大纲里已选择的selectedModuleType/selectedModuleName/selectedModuleStructure；轮播、四图、比较表、热点等多图/多面板模块必须输出对应面板、子图、热点或表格布局，不要再退化成单张普通图片建议。`;

  return callImageWorkflowSkill({
    skillSlug: "image.step5.final.suggestion",
    userId,
    workspaceId: workspaceId ?? project?.workspaceId ?? null,
    systemPrompt: STEP5_FINAL_SUGGESTION_PROMPT,
    context,
    validate: (value) => {
      const imageNumbers = Array.isArray(value?.secondaryImages)
        ? value.secondaryImages.map((image: any) => Number(image?.imageNumber))
        : [];
      if (imageNumbers.length !== 6 || imageNumbers.some((imageNumber: number, index: number) => imageNumber !== index + 2)) {
        throw new Error("最终图片建议必须完整包含辅图2-7");
      }
      return value;
    },
  });
}

export async function persistStep5ListingAdvice(projectId: number, resultStr: string) {
  try {
    const existingListings = await db.getListingsByProject(projectId);
    const activeListing = existingListings.find((l) => l.isActive === 1);
    if (activeListing) {
      await db.updateListing(activeListing.id, {
        imageAdvice: resultStr,
        imageAdviceCn: null,
      });
    }
  } catch {}
}

export async function runStep5GenerationJob(args: {
  runId: string;
  projectId: number;
  sessionId: number;
  userId: number;
}) {
  const { runId, projectId, sessionId, userId } = args;

  const updateIfCurrent = async (data: Record<string, unknown>) => {
    const latest = await db.getImageWorkflowSessionById(sessionId);
    if (!latest || latest.step5RunId !== runId) return null;
    return db.updateImageWorkflowSession(sessionId, data as any);
  };

  try {
    const session = await updateIfCurrent({
      step5RunStatus: "running",
      step5RunProgress: 20,
      step5RunError: null,
    });
    if (!session) return { skipped: true, reason: "Step 5 run is no longer current" };

    const project = await db.getProjectByIdAdmin(projectId);
    if (!project) throw new Error("Project not found");

    const selectedSession = await hydrateImageWorkflowSessionFromArtifacts(session, {
      consumerType: "ai_job",
      consumerId: runId,
      runId,
      nodeId: "image_suggestion",
    });
    const result = await buildStep5FinalSuggestion(project, selectedSession, userId);
    const resultStr = JSON.stringify(result);

    const updated = await updateIfCurrent({
      step5AiResult: resultStr,
      step5AiResultCn: null,
      step5RunStatus: "succeeded",
      step5RunProgress: 100,
      step5RunError: null,
      step5RunCompletedAt: new Date(),
      currentStep: 5,
    });
    if (!updated) return { skipped: true, reason: "Step 5 run changed before completion" };

    await persistStep5ListingAdvice(projectId, resultStr);
    return buildStep5RunSnapshot(updated);
  } catch (error) {
    await updateIfCurrent({
      step5RunStatus: "failed",
      step5RunProgress: 100,
      step5RunError: serializeStep5Error(error),
      step5RunCompletedAt: new Date(),
    });
    throw error;
  }
}

registerAiJobHandler({
  id: "imageWorkflow.step5FinalSuggestion",
  match: (job) => job.kind === "image.step5.finalSuggestion",
  handler: (job) => {
    const input = step5JobInput.parse(job.input);
    return runStep5GenerationJob({
      runId: job.runId,
      projectId: input.projectId,
      sessionId: input.sessionId,
      userId: job.userId,
    });
  },
});
