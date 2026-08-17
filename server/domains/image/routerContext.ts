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
  hydrateLockedImageWorkflowAplusSubmodules,
  hydrateImageWorkflowSessionFromArtifacts,
  recordBusinessArtifactUse,
  resolveCurrentBusinessArtifact,
} from "../ai_os/services/businessArtifactRegistry";
import { enrichStep5AplusSubmodules } from "./step5AplusSubmodules";
import { describeStep5SegmentFailure } from "./step5SegmentFailure";
import { findIncompleteStep5Segment } from "./step5SegmentValidation";
import {
  applyImageWorkflowAplusStyle,
  buildImageWorkflowReferenceTargets,
  findImageWorkflowAplusModule,
  normalizeImageOutline,
  normalizeSecondaryImageSlots,
} from "@shared/imageWorkflow";
import {
  registerAiJobHandler,
  startRegisteredAiJob,
} from "./service";
import { updateAiJobProgress } from "../ai_os/services/jobRunner";
import {
  syncStepJobFailedToAgent,
  syncStepJobRunningToAgent,
  syncStepJobWaitingHumanToAgent,
} from "./imageWorkflowAgentBridge";
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
  agentRunId: z.string().max(80).optional(),
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
function extractBalancedJsonBlock(content: string): string | null {
  const firstObject = content.indexOf("{");
  const firstArray = content.indexOf("[");
  const start = firstObject === -1
    ? firstArray
    : firstArray === -1
      ? firstObject
      : Math.min(firstObject, firstArray);
  if (start < 0) return null;

  const opening = content[start];
  const closing = opening === "{" ? "}" : "]";
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === opening) depth += 1;
    if (char === closing) {
      depth -= 1;
      if (depth === 0) return content.slice(start, index + 1);
    }
  }
  return null;
}

export function parseLooseLlmJson(value: unknown): any {
  let content = String(value || "");
  content = content.replace(/^\uFEFF|\u200B/g, "");
  // Strip markdown code blocks (```json ... ``` or ``` ... ```)
  const mdMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (mdMatch) content = mdMatch[1].trim();
  // Preserve only the first complete JSON value. Long skill responses sometimes
  // append explanation text or an unclosed markdown fence after valid JSON.
  const balanced = extractBalancedJsonBlock(content);
  if (balanced) content = balanced;
  // Models occasionally emit literal control characters inside JSON strings.
  // Preserve the semantic value while escaping those characters before parsing.
  let escaped = "";
  let inString = false;
  let escapedChar = false;
  for (const char of content) {
    if (escapedChar) {
      escaped += char;
      escapedChar = false;
      continue;
    }
    if (char === "\\") {
      escaped += char;
      escapedChar = true;
      continue;
    }
    if (char === '"') {
      inString = !inString;
      escaped += char;
      continue;
    }
    if (inString && char.charCodeAt(0) < 0x20) {
      escaped += char === "\n" ? "\\n" : char === "\r" ? "\\r" : char === "\t" ? "\\t" : "";
      continue;
    }
    escaped += char;
  }
  escaped = escaped.replace(/,\s*([}\]])/g, "$1");
  try {
    return JSON.parse(escaped);
  } catch (error) {
    return { raw: content, parseError: error instanceof Error ? error.message : String(error) };
  }
}

export function parseLLMJson(response: any): any {
  const content = typeof response.choices[0].message.content === "string"
    ? response.choices[0].message.content
    : JSON.stringify(response.choices[0].message.content);
  return parseLooseLlmJson(content);
}

export async function callImageWorkflowSkill<T = any>(input: {
  skillSlug: string;
  userId: number;
  workspaceId?: number | null;
  systemPrompt: string;
  context: string;
  attachments?: any[];
  maxModelAttempts?: number;
  signal?: AbortSignal;
  validate?: (value: any) => T;
}): Promise<T> {
  const result = await runEmperorSkill<T>({
    skillSlug: input.skillSlug,
    userId: input.userId,
    workspaceId: input.workspaceId ?? null,
    context: input.context,
    variables: {},
    attachments: input.attachments,
    maxModelAttempts: input.maxModelAttempts,
    signal: input.signal,
    legacySystemPrompt: input.systemPrompt,
    migrationSource: input.skillSlug === "image.step2.outline"
      ? "drizzle/0122_image_outline_reliability.sql"
      : "drizzle/0120_image_workflow_outline_contract.sql",
      validate: (content) => {
        const parsed = safeParseSkillJSON<any>(content);
        if (parsed && typeof parsed === "object" && "raw" in parsed) {
          // 尝试更激进的 JSON 提取：找到最外层的 { } 对
          const rawStr = (parsed as any).raw as string;
          const recovered = parseLooseLlmJson(rawStr);
          if (recovered && typeof recovered === "object" && !("raw" in recovered)) {
            return input.validate ? input.validate(recovered) : recovered as T;
          }
          const firstBrace = rawStr.indexOf("{");
          const lastBrace = rawStr.lastIndexOf("}");
          if (firstBrace >= 0 && lastBrace > firstBrace) {
            try {
              const extracted = JSON.parse(rawStr.slice(firstBrace, lastBrace + 1));
              return input.validate ? input.validate(extracted) : extracted as T;
            } catch {
              // 提取失败，继续报错
            }
          }
          console.error(`[callImageWorkflowSkill] Skill ${input.skillSlug} returned non-JSON content (length=${rawStr.length}, parseError=${(parsed as any).parseError || "unknown"}): head=${rawStr.slice(0, 200)} tail=${rawStr.slice(-200)}`);
          throw new Error(`皇帝 Skill 未返回有效 JSON (rawLen=${rawStr.length})`);
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
  }, {
    // 解锁后数据库中的stepConfirmed会变为0。只水合当前仍被确认的步骤，
    // 避免历史current Artifact把已解锁的步骤重新覆盖为确认状态。
    onlyBusinessConfirmedSteps: true,
  });
}

export async function resolveSessionForDisplay(projectId: number, user: { id: number; role: string }) {
  const session = await resolveSessionAccess(projectId, user);
  if (!session) return null;
  let hydrated = await hydrateImageWorkflowSessionFromArtifacts(session, undefined, {
    onlyBusinessConfirmedSteps: true,
  });
  // 解锁编辑中的Step2草稿必须始终优先于旧的父级Artifact；否则刷新后会回退为旧单图样式。
  if (Number(session.step2Confirmed) !== 1 && session.step2UserEdit) {
    const sessionStep2 = parseStoredJson(session.step2UserEdit);
    if (sessionStep2 && typeof sessionStep2 === "object") {
      const { outline: completeStep2 } = await hydrateLockedImageWorkflowAplusSubmodules({
        sessionId: session.id,
        projectId: session.projectId,
        outline: normalizeImageOutline(sessionStep2 as Record<string, any>),
      });
      const completeStep2Json = JSON.stringify(completeStep2);
      hydrated = {
        ...hydrated,
        step2AiResult: completeStep2Json,
        step2UserEdit: completeStep2Json,
      };
    }
  }
  // Step2 的确认快照包含多图 A+ 的 subModules。旧 skill Artifact 可能仍是
  // 父模块版本；锁定态展示必须以会话确认快照为权威，避免刷新后逐图内容消失。
  if (Number(session.step2Confirmed) === 1 && session.step2UserEdit) {
    const sessionStep2 = parseStoredJson(session.step2UserEdit);
    if (sessionStep2 && typeof sessionStep2 === "object") {
      const { outline: completeStep2 } = await hydrateLockedImageWorkflowAplusSubmodules({
        sessionId: session.id,
        projectId: session.projectId,
        outline: normalizeImageOutline(sessionStep2 as Record<string, any>),
      });
      const completeStep2Json = JSON.stringify(completeStep2);
      hydrated = {
        ...hydrated,
        step2AiResult: completeStep2Json,
        step2UserEdit: completeStep2Json,
      };
    }
  }
  // Step4 的用户确认快照包含构图图、效果图及知识库图等页面资产。
  // 旧 Artifact 可能在补写前仍是 current；展示时以会话中刚确认的快照为文本权威，
  // 再用 Artifact 仅补齐会话没有的图片资产，避免页面回退到旧方案。
  if (Number(session.step4Confirmed) !== 1 || !session.step4UserEdit) return hydrated;
  const sessionStep4 = parseStoredJson(session.step4UserEdit) as Record<string, any> | null;
  const artifactStep4 = parseStoredJson(hydrated.step4UserEdit) as Record<string, any> | null;
  if (!Array.isArray(sessionStep4?.imageReferences)) return hydrated;
  const mergedReferences = sessionStep4.imageReferences.map((sessionRef: any, index: number) => {
    const artifactRef = artifactStep4?.imageReferences?.[index] || {};
    return {
      ...artifactRef,
      ...sessionRef,
      compositionRefImageUrl: sessionRef.compositionRefImageUrl || artifactRef.compositionRefImageUrl,
      effectRefImageUrl: sessionRef.effectRefImageUrl || artifactRef.effectRefImageUrl,
      kbReferenceImages: sessionRef.kbReferenceImages?.length
        ? sessionRef.kbReferenceImages
        : artifactRef.kbReferenceImages || [],
    };
  });
  const completeStep4 = { ...artifactStep4, ...sessionStep4, imageReferences: mergedReferences };
  const completeStep4Json = JSON.stringify(completeStep4);
  const step2Outline = parseStoredJson(session.step2UserEdit || hydrated.step2UserEdit) as Record<string, any> | null;
  const step5Source = parseStoredJson(session.step5UserEdit || session.step5OptimizedResult || session.step5AiResult) as Record<string, any> | null;
  const completeStep5 = step2Outline && step5Source
    ? enrichStep5AplusSubmodules({ result: step5Source, outline: step2Outline, step4Snapshot: completeStep4 })
    : null;
  const completeStep5Json = completeStep5 ? JSON.stringify(completeStep5) : null;
  return {
    ...hydrated,
    step4AiResult: completeStep4Json,
    step4UserEdit: completeStep4Json,
    ...(completeStep5Json ? {
      step5AiResult: completeStep5Json,
      step5UserEdit: completeStep5Json,
      step5OptimizedResult: completeStep5Json,
    } : {}),
  };
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

/**
 * Agent DAG同步仅用于可观测性。同步服务异常或卡住时，不能阻塞Step5的
 * 皇帝Skill调用、结果保存和AI Job终态提交。
 */
export async function settleStep5AgentSync(sync: Promise<void>, timeoutMs = 5_000): Promise<"synced" | "timed_out"> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const outcome = await Promise.race([
      sync.then(() => "synced" as const),
      new Promise<"timed_out">((resolve) => {
        timer = setTimeout(() => resolve("timed_out"), timeoutMs);
      }),
    ]);
    if (outcome === "timed_out") {
      console.warn("[Step5] Agent sync exceeded timeout; continuing business AI Job without blocking");
    }
    return outcome;
  } finally {
    if (timer) clearTimeout(timer);
  }
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
    segments: parseStoredJson(session?.step5RunSegments) || [],
    failedGroup: session?.step5RunFailedGroup || null,
    failedModule: session?.step5RunFailedModule || null,
    startedAt: session?.step5RunStartedAt || null,
    completedAt: session?.step5RunCompletedAt || null,
    en: parseStoredJson(session?.step5UserEdit || session?.step5OptimizedResult || session?.step5AiResult),
    cn: parseStoredJson(session?.step5AiResultCn || session?.step5OptimizedResultCn),
  };
}

export function buildStep5SegmentPersistenceUpdate(
  segments: Step5RunSegment[],
  failure?: { group: string; module?: string | null },
) {
  return {
    step5RunSegments: JSON.stringify(segments),
    ...(failure ? {
      step5RunFailedGroup: failure.group,
      step5RunFailedModule: failure.module || null,
    } : {}),
  };
}

type Step5SegmentStatus = "pending" | "running" | "succeeded" | "failed" | "fallback";
type Step5RunSegment = {
  id: string;
  label: string;
  group: "main" | "secondary" | "aplus" | "brand_story" | "merge";
  status: Step5SegmentStatus;
  error?: string;
};

export async function buildStep5FinalSuggestion(
  project: any,
  session: any,
  userId: number,
  workspaceId?: number | null,
  options?: {
    onProgress?: (progress: number) => Promise<void> | void;
    onSegmentsChange?: (segments: Step5RunSegment[], failure?: { group: string; module?: string | null }) => Promise<void> | void;
  },
) {
  const reportProgress = async (progress: number) => {
    await options?.onProgress?.(progress);
  };
  const truncate = (s: string | null, maxLen = 3000) => s ? s.substring(0, maxLen) : "";
  const step1Content = truncate(session.step1UserEdit || session.step1AiResult, 4000);
  const step2Draft = normalizeImageOutline(parseStoredJson(session.step2UserEdit || session.step2AiResult || "{}") || {});
  const { outline: step2Outline, consumedRefs } = await hydrateLockedImageWorkflowAplusSubmodules({
    sessionId: session.id,
    projectId: project.id,
    outline: step2Draft,
  });
  const step2Content = truncate(JSON.stringify(step2Outline), 4000);
  const step3Content = truncate(session.step3UserEdit || session.step3AiResult, 3000);
  const step4Content = truncate(session.step4UserEdit || session.step4AiResult, 3000);
  const aplusSubmoduleTargets = buildImageWorkflowReferenceTargets(step2Outline)
    .filter((target) => target.subModuleNumber !== null && target.subModuleNumber !== undefined)
    .map((target) => ({
      imageKey: target.imageKey,
      imageType: target.imageType,
      subModuleRemark: target.subModuleRemark,
      subModuleCount: target.subModuleCount,
      subModuleTopic: target.subModuleTopic,
      purpose: target.purpose,
    }));

  const kbReference = await getKBReference(project.category || "", userId);
  const lockedAssetNote = consumedRefs.length ? `\n--- 已锁定A+子图资产 ---\n以下子图必须严格使用已确认版本：${consumedRefs.join(", ")}` : "";
  const context = `产品名称: ${project.productName || project.name}\n品牌: ${project.brand || '未指定'}\n类目: ${project.category || '未指定'}\n\n--- 已确认的卖点体系 ---\n${step1Content}\n\n--- 已确认的图片大纲 ---\n${step2Content}${lockedAssetNote}\n\n--- 已确认的风格方案 ---\n${step3Content}\n\n--- 已确认的参考图 ---\n${step4Content}${kbReference}\n\n--- A+备注驱动的逐图目标（必须逐项保留） ---\n${JSON.stringify(aplusSubmoduleTargets)}\n\n请综合以上所有确认结果（包括知识库参考），输出每张图的完整图片建议。secondaryImages必须恰好包含6项，imageNumber依次且仅为2、3、4、5、6、7，不得遗漏辅图7。A+内容必须继承图片大纲里已选择的selectedModuleType/selectedModuleName/selectedModuleStructure；轮播、四图、比较表、热点等多图/多面板模块必须输出对应面板、子图、热点或表格布局，不要再退化成单张普通图片建议。对于A+子图，必须遵守subModuleRemark、subModuleCount与subModuleTopic，按每个目标分别输出独立构图和作图建议。`;

  const skillArgs = { userId, workspaceId: workspaceId ?? project?.workspaceId ?? null };
  const getAplusModules = (value: any) => Array.isArray(value?.aPlusModules)
    ? value.aPlusModules
    : Array.isArray(value?.aplusModules)
      ? value.aplusModules
      : Array.isArray(value?.aPlusContent?.sections)
        ? value.aPlusContent.sections
        : Array.isArray(value?.aplusContent?.sections)
          ? value.aplusContent.sections
          : [];
  const getBrandStory = (value: any) => value?.brandStory
    || value?.brand_story
    || value?.aPlusContent?.brandStory
    || value?.aplusContent?.brandStory
    || null;
  const outlineAplusModules = Array.isArray(step2Outline?.aPlusModules)
    ? step2Outline.aPlusModules
    : [];
  const outlineBrandStory = step2Outline?.brandStory || step2Outline?.brandStoryModule || step2Outline?.aPlusBrandStory || null;
  let segments: Step5RunSegment[] = [
    { id: "main", label: "主图", group: "main", status: "pending" },
    { id: "secondary", label: "辅图 2–7", group: "secondary", status: "pending" },
    ...outlineAplusModules.map((module: any, index: number) => ({
      id: `aplus_${Number(module?.moduleNumber || index + 1)}`,
      label: `A+ ${Number(module?.moduleNumber || index + 1)}`,
      group: "aplus" as const,
      status: "pending" as const,
    })),
    ...(outlineBrandStory ? [{ id: "brand_story", label: "品牌故事", group: "brand_story" as const, status: "pending" as const }] : []),
    { id: "merge", label: "合并与保存", group: "merge", status: "pending" },
  ];
  const publishSegments = async (failure?: { group: string; module?: string | null }) => {
    await options?.onSegmentsChange?.(segments, failure);
  };
  const setSegment = async (id: string, status: Step5SegmentStatus, error?: unknown) => {
    segments = segments.map((segment) => segment.id === id
      ? { ...segment, status, ...(error ? { error: serializeStep5Error(error) } : {}) }
      : segment);
    await publishSegments(status === "failed" ? describeStep5SegmentFailure(segments.find((segment) => segment.id === id)) : undefined);
  };
  const runSegment = async <T,>(id: string, action: () => Promise<T>): Promise<T> => {
    await setSegment(id, "running");
    try {
      const value = await action();
      await setSegment(id, "succeeded");
      return value;
    } catch (error) {
      await setSegment(id, "failed", error);
      throw error;
    }
  };
  await publishSegments();
  let result: any;
  try {
    await reportProgress(30);
    const [mainSegment, secondarySegment] = await Promise.all([
      runSegment("main", () => callImageWorkflowSkill({
        ...skillArgs,
        skillSlug: "image.step5.main.segment",
        systemPrompt: "只输出主图建议的结构化JSON，保留mainImage与designGuidelines字段。",
        context: `${context}\n\n本次仅负责主图#1，不要输出secondaryImages或A+模块。`,
      })),
      runSegment("secondary", () => callImageWorkflowSkill({
        ...skillArgs,
        skillSlug: "image.step5.secondary.segment",
        systemPrompt: "只输出6张辅图建议的结构化JSON，保留secondaryImages字段。",
        context: `${context}\n\n本次仅负责辅图#2至#7，必须输出6项secondaryImages。`,
      })),
    ]);
    await reportProgress(55);
    // A+ 7个模块与品牌故事在一个响应中会被模型截断。按模块独立调用同一皇帝Skill，
    // 保持小JSON响应，并以图片大纲的模块编号作为唯一合并顺序。
    const aplusRequests = [
      ...outlineAplusModules.map((module: any, index: number) => ({
        kind: "module" as const,
        moduleNumber: Number(module?.moduleNumber || index + 1),
        context: `${context}\n\n本次只负责以下单个A+模块，绝不输出其他A+模块、主图或辅图。\n${JSON.stringify(module)}\n\n必须返回合法JSON：{"aPlusModules":[{"moduleNumber":${Number(module?.moduleNumber || index + 1)},"title":"","purpose":"","content":"","composition":"","imageDescription":""}],"brandStory":null}`,
      })),
      ...(outlineBrandStory ? [{
        kind: "brand_story" as const,
        moduleNumber: null,
        context: `${context}\n\n本次只负责独立品牌故事，绝不输出任何A+模块、主图或辅图。\n${JSON.stringify(outlineBrandStory)}\n\n必须返回合法JSON：{"aPlusModules":[],"brandStory":{"title":"","purpose":"","content":"","composition":"","imageDescription":""}}`,
      }] : []),
    ];
    await reportProgress(65);
    const aplusSegments = await Promise.all(aplusRequests.map(async (request) => {
      const segmentId = request.kind === "brand_story" ? "brand_story" : `aplus_${request.moduleNumber}`;
      return runSegment(segmentId, () => callImageWorkflowSkill({
          ...skillArgs,
          skillSlug: "image.step5.aplus.segment",
          systemPrompt: request.kind === "brand_story"
            ? "只输出独立品牌故事的结构化JSON，保留brandStory字段；aPlusModules必须为空数组。"
            : "只输出一个A+模块的结构化JSON，aPlusModules必须为仅含一个对象的数组。",
          context: request.context,
        }));
    }));
    const aplusModules = aplusSegments.flatMap((segment) => getAplusModules(segment));
    const brandStory = aplusSegments.map((segment) => getBrandStory(segment)).find(Boolean) || null;
    await reportProgress(82);
    const completenessFailure = findIncompleteStep5Segment({
      mainSegment,
      secondarySegment,
      aplusModules,
      outlineAplusModules,
      requiresBrandStory: Boolean(outlineBrandStory),
      brandStory,
    });
    if (completenessFailure) {
      const segmentId = completenessFailure.module === "品牌故事"
        ? "brand_story"
        : completenessFailure.module?.startsWith("A+ ")
          ? `aplus_${completenessFailure.module.replace("A+ ", "")}`
          : completenessFailure.group;
      const error = new Error(`${completenessFailure.module || completenessFailure.group}分段Skill返回内容不完整`);
      await setSegment(segmentId, "failed", error);
      throw error;
    }
    result = {
      ...mainSegment,
      designGuidelines: mainSegment.designGuidelines || secondarySegment.designGuidelines,
      secondaryImages: secondarySegment.secondaryImages,
      aPlusModules: aplusModules,
      aPlusContent: {
        sections: aplusModules,
      },
      brandStory,
      segmentedGeneration: {
        mode: "emperor_segments",
        groups: ["main", "secondary", "aplus"],
        aplusSubtasks: aplusRequests.map((request) => request.kind === "brand_story" ? "brand_story" : `module_${request.moduleNumber}`),
      },
    };
  } catch (segmentError) {
    console.warn("[Step5] 分段Skill失败，回退完整Skill", segmentError);
    const failedSegment = segments.find((segment) => segment.status === "failed");
    const failure = describeStep5SegmentFailure(failedSegment);
    segments = segments.map((segment) => segment.status === "failed" ? { ...segment, status: "fallback" } : segment);
    await publishSegments(failure);
    await reportProgress(70);
    const completeResult = await callImageWorkflowSkill({
      skillSlug: "image.step5.final.suggestion",
      ...skillArgs,
      systemPrompt: STEP5_FINAL_SUGGESTION_PROMPT,
      context,
      validate: (value) => {
        if (!Array.isArray(value?.secondaryImages) || value.secondaryImages.length < 5) {
          throw new Error("最终图片建议辅图数量不足");
        }
        return value;
      },
    });
    // 完整Skill的历史契约可能使用aPlusContent.sections而非顶层aPlusModules。
    // 在进入统一回填前同步两种结构，避免分段失败回退后A+内容被前台判空。
    result = {
      ...completeResult,
      aPlusModules: getAplusModules(completeResult),
      aPlusContent: {
        ...(completeResult?.aPlusContent || completeResult?.aplusContent || {}),
        sections: getAplusModules(completeResult),
      },
      brandStory: getBrandStory(completeResult),
      segmentedGeneration: { mode: "full_skill_fallback", failedGroup: failure.group, failedModule: failure.module },
    };
  }
  await setSegment("merge", "running");
  await reportProgress(90);
  const step4Snapshot = parseStoredJson(session.step4UserEdit || session.step4AiResult || "{}") as Record<string, any> | null;
  const enriched = enrichStep5AplusSubmodules({ result, outline: step2Outline, step4Snapshot });
  await setSegment("merge", "succeeded");
  return enriched;
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
  workspaceId?: number | null;
  attempt?: number;
  maxAttempts?: number;
  signal?: AbortSignal;
}) {
  const { runId, projectId, sessionId, userId } = args;

  const updateIfCurrent = async (data: Record<string, unknown>) => {
    const latest = await db.getImageWorkflowSessionById(sessionId);
    if (!latest || latest.step5RunId !== runId) return null;
    return db.updateImageWorkflowSession(sessionId, data as any);
  };

  try {
    if (args.signal?.aborted) throw new Error(String(args.signal.reason || "图片建议任务已取消"));
    const session = await updateIfCurrent({
      step5RunStatus: "running",
      step5RunProgress: 20,
      step5RunError: null,
      step5RunSegments: null,
      step5RunFailedGroup: null,
      step5RunFailedModule: null,
    });
    if (!session) return { skipped: true, reason: "Step 5 run is no longer current" };
    await updateAiJobProgress(runId, 20, { expectedAttempt: args.attempt });

    const project = await db.getProjectByIdAdmin(projectId);
    if (!project) throw new Error("Project not found");

    let selectedSession: typeof session;
    try {
      selectedSession = await hydrateImageWorkflowSessionFromArtifacts(session, {
        consumerType: "ai_job",
        consumerId: runId,
        runId,
        nodeId: "image_suggestion",
      });
    } catch (hydrateError) {
      // Fallback to raw session if artifact hydration fails (e.g. DB connection lost)
      console.warn(`[Step5] hydrateImageWorkflowSessionFromArtifacts failed, using raw session: ${hydrateError}`);
      selectedSession = session;
    }
    const result = await buildStep5FinalSuggestion(project, selectedSession, userId, args.workspaceId, {
      onProgress: async (progress) => {
        await updateIfCurrent({ step5RunProgress: progress, step5RunError: null });
        await updateAiJobProgress(runId, progress, { expectedAttempt: args.attempt });
      },
      onSegmentsChange: async (segments, failure) => {
        await updateIfCurrent(buildStep5SegmentPersistenceUpdate(segments, failure));
      },
    });
    if (args.signal?.aborted) throw new Error(String(args.signal.reason || "图片建议任务已取消"));
    await updateAiJobProgress(runId, 90, { expectedAttempt: args.attempt });
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
    const abortReason = args.signal?.aborted ? String(args.signal.reason || "") : "";
    const isTimeout = /timed?\s*out|timeout/i.test(abortReason);
    const isCanceled = Boolean(args.signal?.aborted && !isTimeout);
    const finalAttempt = isCanceled || Number(args.attempt || 1) >= Number(args.maxAttempts || 1);
    await updateIfCurrent({
      step5RunStatus: isCanceled ? "canceled" : finalAttempt ? "failed" : "queued",
      step5RunProgress: finalAttempt ? 100 : 20,
      step5RunError: serializeStep5Error(error),
      step5RunCompletedAt: finalAttempt ? new Date() : null,
    });
    throw error;
  }
}

registerAiJobHandler({
  id: "imageWorkflow.step5FinalSuggestion",
  match: (job) => job.kind === "image.step5.finalSuggestion",
  handler: async (job, context) => {
    const input = step5JobInput.parse(job.input);
    const fallbackSession = await db.getImageWorkflowSessionById(input.sessionId).catch(() => null);
    const agentRunId = input.agentRunId || fallbackSession?.agentRunId || null;
    const syncInput = {
      agentRunId,
      stepNumber: 5,
      projectId: input.projectId,
      userId: job.userId,
      workspaceId: job.workspaceId,
      aiJobRunId: job.runId,
      aiJobAttempt: job.attempt,
      aiJobMaxAttempts: job.maxAttempts,
    };

    await settleStep5AgentSync(syncStepJobRunningToAgent({ ...syncInput, progress: 20 }));
    try {
      const result = await runStep5GenerationJob({
        runId: job.runId,
        projectId: input.projectId,
        sessionId: input.sessionId,
        userId: job.userId,
        workspaceId: job.workspaceId,
        attempt: job.attempt,
        maxAttempts: job.maxAttempts,
        signal: context.signal,
      });
      if (!(result as any)?.skipped) {
        await settleStep5AgentSync(syncStepJobWaitingHumanToAgent({ ...syncInput, output: (result as any)?.en ?? result }));
      }
      return result;
    } catch (error) {
      const abortReason = context.signal.aborted ? String(context.signal.reason || "") : "";
      const retryableTimeout = /timed?\s*out|timeout/i.test(abortReason);
      const finalAttempt = job.attempt >= job.maxAttempts || (context.signal.aborted && !retryableTimeout);
      await settleStep5AgentSync(syncStepJobFailedToAgent({
        ...syncInput,
        finalAttempt,
        errorMessage: serializeStep5Error(error),
        failureKind: context.signal.aborted ? (retryableTimeout ? "timeout" : "cancel") : "error",
      }));
      throw error;
    }
  },
});
