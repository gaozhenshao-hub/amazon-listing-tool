import { z } from "zod";
import { protectedProcedure, router } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { invokeLLM } from "../../_core/llm";
import * as db from "./repository";
import { runEmperorSkill } from "./service";
import {
  TITLE_GENERATION_PROMPT,
  BULLET_POINTS_PROMPT,
  DESCRIPTION_PROMPT,
  SEARCH_TERMS_PROMPT,
  IMAGE_ADVICE_PROMPT,
  CHINESE_TRANSLATION_PROMPT,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
  SELLING_POINTS_CORE_PROMPT,
  SINGLE_BULLET_PROMPT,
  EXPAND_KEYWORD_TO_FABE_PROMPT,
  QA_GENERATION_PROMPT,
  EVALUATE_BULLET_CHECKLIST_PROMPT,
  EVALUATE_TITLE_CHECKLIST_PROMPT,
  EVALUATE_DESCRIPTION_CHECKLIST_PROMPT,
  EVALUATE_SEARCH_TERMS_CHECKLIST_PROMPT,
  EVALUATE_QA_CHECKLIST_PROMPT,
} from "../../prompts";
import { buildListingContext, checkDataReadiness, contextToPromptText } from "./service";
export {
  BULLET_POINTS_PROMPT,
  CHINESE_TRANSLATION_PROMPT,
  DESCRIPTION_PROMPT,
  EVALUATE_BULLET_CHECKLIST_PROMPT,
  EVALUATE_DESCRIPTION_CHECKLIST_PROMPT,
  EVALUATE_QA_CHECKLIST_PROMPT,
  EVALUATE_SEARCH_TERMS_CHECKLIST_PROMPT,
  EVALUATE_TITLE_CHECKLIST_PROMPT,
  EXPAND_KEYWORD_TO_FABE_PROMPT,
  IMAGE_ADVICE_PROMPT,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
  QA_GENERATION_PROMPT,
  SEARCH_TERMS_PROMPT,
  SELLING_POINTS_CORE_PROMPT,
  SINGLE_BULLET_PROMPT,
  TITLE_GENERATION_PROMPT,
  TRPCError,
  buildListingContext,
  checkDataReadiness,
  contextToPromptText,
  db,
  invokeLLM,
  protectedProcedure,
  router,
  runEmperorSkill,
  z,
};

export const MAX_RETRIES = 2;

/**
 * safeParseJSON — 公共容错 JSON 解析函数
 * 处理以下情况：
 * 1. Gemini thinking 标签残留 (<thinking>...</thinking>)
 * 2. Markdown 代码围栏 (```json ... ```)
 * 3. JSON 前后有多余文本（提取首个完整 JSON 对象）
 */
export function safeParseJSON<T = any>(raw: unknown, fallback?: T): T | { raw: string } {
  // Guard: handle undefined/null gracefully
  if (raw === undefined || raw === null) {
    if (fallback !== undefined) return fallback;
    return { raw: String(raw) };
  }
  const str = typeof raw === "string" ? raw : (JSON.stringify(raw) ?? "");
  if (!str) {
    if (fallback !== undefined) return fallback;
    return { raw: "" };
  }
  // Step 1: strip thinking tags
  let cleaned = str.replace(/<thinking>[\s\S]*?<\/thinking>/gi, "");
  // Step 2: strip markdown code fences
  cleaned = cleaned.replace(/^```(?:json)?\s*/im, "").replace(/\s*```\s*$/im, "").trim();
  // Step 3: try direct parse
  try {
    return JSON.parse(cleaned) as T;
  } catch { /* continue */ }
  // Step 4: extract first JSON object or array
  const objStart = cleaned.indexOf("{");
  const objEnd = cleaned.lastIndexOf("}");
  if (objStart >= 0 && objEnd > objStart) {
    try { return JSON.parse(cleaned.slice(objStart, objEnd + 1)) as T; } catch { /* continue */ }
  }
  const arrStart = cleaned.indexOf("[");
  const arrEnd = cleaned.lastIndexOf("]");
  if (arrStart >= 0 && arrEnd > arrStart) {
    try { return JSON.parse(cleaned.slice(arrStart, arrEnd + 1)) as T; } catch { /* continue */ }
  }
  // Fallback
  if (fallback !== undefined) return fallback;
  return { raw: str };
}

export function parseJsonOrThrow<T = any>(content: string): T {
  const parsed = safeParseJSON<T>(content);
  if ((parsed as any).raw) {
    throw new Error("AI response format error");
  }
  return parsed as T;
}

export async function executeListingSkill<T = any>(
  skillSlug: string,
  userId: number,
  context: string,
  variables: Record<string, unknown> = {},
  emphasis?: string,
): Promise<T> {
  const result = await runEmperorSkill<T>({
    skillSlug,
    userId,
    context,
    emphasis,
    variables: {
      context,
      emphasis: emphasis || "",
      ...variables,
    },
    validate: parseJsonOrThrow,
  });
  return result.parsed;
}

// Helper: resolve project access based on user role
// designer, admin, super_admin can access any project (designer: read-only for image suggestions)
// regular users can only access their own projects
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

// Helper: ensure the user has write access to the project
// designer can only read, not write to other users' projects
// admin/super_admin can write to any project
export function ensureWriteAccess(project: { userId: number }, user: { id: number; role: string }) {
  if (user.role === 'super_admin' || user.role === 'admin') return;
  if (user.role === 'designer' && project.userId !== user.id) {
    throw new Error("Designer角色只能查看他人项目，不能修改");
  }
}

// Helper: create a version snapshot of the current listing state
export async function saveListingVersion(
  listing: any,
  userId: number,
  changeType: "generate" | "ab_apply" | "optimize" | "manual_edit" | "translate",
  changeDescription: string
) {
  try {
    const latestVersion = await db.getLatestListingVersionNumber(listing.id);
    await db.createListingVersion({
      listingId: listing.id,
      projectId: listing.projectId,
      userId,
      versionNumber: latestVersion + 1,
      changeType,
      changeDescription,
      title: listing.title || null,
      itemHighlights: listing.itemHighlights || null,
      bulletPoints: listing.bulletPoints || null,
      description: listing.description || null,
      searchTerms: listing.searchTerms || null,
      titleCn: listing.titleCn || null,
      itemHighlightsCn: listing.itemHighlightsCn || null,
      bulletPointsCn: listing.bulletPointsCn || null,
      descriptionCn: listing.descriptionCn || null,
      searchTermsCn: listing.searchTermsCn || null,
    });
  } catch (err) {
    console.error("Failed to save listing version:", err);
    // Non-critical - don't throw
  }
}

// Validate bullet points character counts, returns list of out-of-range bullets
export function validateBullets(bulletData: any): { valid: boolean; issues: string[] } {
  if (!bulletData?.bulletPoints || !Array.isArray(bulletData.bulletPoints)) {
    return { valid: false, issues: ["No bullet points found"] };
  }
  const issues: string[] = [];
  for (let i = 0; i < bulletData.bulletPoints.length; i++) {
    const bp = bulletData.bulletPoints[i];
    const combined = bp.subtitle && bp.fullText
      ? `${bp.subtitle} ${bp.fullText}`
      : bp.fullText || bp.subtitle || '';
    bp.actualCharacterCount = combined.length;
    bp.characterCount = combined.length;
    bp.inRange = combined.length >= 200 && combined.length <= 280;
    if (combined.length > 280) {
      issues.push(`Bullet ${i + 1} is ${combined.length} chars (max 280). Content: "${combined.substring(0, 50)}..."`);
    } else if (combined.length < 200) {
      issues.push(`Bullet ${i + 1} is only ${combined.length} chars (min 200). Content: "${combined.substring(0, 50)}..."`);
    }
  }
  // Calculate total
  bulletData.totalCharacterCount = bulletData.bulletPoints.reduce(
    (sum: number, bp: any) => sum + (bp.actualCharacterCount || 0), 0
  );
  return { valid: issues.length === 0, issues };
}

// Validate title character counts
export function validateTitles(titleData: any): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (titleData.titles && Array.isArray(titleData.titles)) {
    for (let i = 0; i < titleData.titles.length; i++) {
      const t = titleData.titles[i];
      // Two-stage title validation
      const titleLen = t.title ? t.title.length : 0;
      const highlightsLen = t.itemHighlights ? t.itemHighlights.length : 0;
      const combinedLen = titleLen + highlightsLen;

      t.titleCharCount = titleLen;
      t.itemHighlightsCharCount = highlightsLen;
      t.combinedCharCount = combinedLen;
      t.titleInRange = titleLen > 0 && titleLen <= 75;
      t.itemHighlightsInRange = highlightsLen > 0 && highlightsLen <= 125;

      // Backward compatibility: also set legacy fields
      t.characterCount = combinedLen;
      t.inRange = t.titleInRange && t.itemHighlightsInRange;

      if (titleLen > 75) {
        issues.push(`Title ${i + 1} Layer 1 is ${titleLen} chars (max 75)`);
      } else if (titleLen === 0) {
        issues.push(`Title ${i + 1} Layer 1 is empty`);
      }
      if (highlightsLen > 125) {
        issues.push(`Title ${i + 1} Layer 2 (Item Highlights) is ${highlightsLen} chars (max 125)`);
      } else if (highlightsLen === 0) {
        issues.push(`Title ${i + 1} Layer 2 (Item Highlights) is empty`);
      }
    }
  }
  if (titleData.recommendedTitle) {
    titleData.recommendedTitleCharCount = titleData.recommendedTitle.length;
    titleData.recommendedTitleInRange = titleData.recommendedTitle.length <= 75 && titleData.recommendedTitle.length > 0;
  }
  if (titleData.recommendedItemHighlights) {
    titleData.recommendedItemHighlightsCharCount = titleData.recommendedItemHighlights.length;
    titleData.recommendedItemHighlightsInRange = titleData.recommendedItemHighlights.length <= 125 && titleData.recommendedItemHighlights.length > 0;
  }
  return { valid: issues.length === 0, issues };
}

// Ask AI to refine bullet points that are out of range
export async function refineBullets(bulletData: any, issues: string[]): Promise<any> {
  const refinementPrompt = `You previously generated Amazon bullet points, but some do NOT meet the character requirements.

ISSUES:
${issues.join("\n")}

CURRENT BULLET POINTS:
${JSON.stringify(bulletData.bulletPoints, null, 2)}

RULES:
- Each bullet = subtitle + " " + fullText
- Each bullet MUST be 200-280 characters total. NO EXCEPTIONS.
- If a bullet is TOO LONG (>280): condense the text, remove redundant words, simplify phrases. Do NOT just cut off the end.
- If a bullet is TOO SHORT (<200): add more specific details, materials, dimensions, use cases, or benefits.
- Keep the same selling points and FABE structure, just adjust the length.
- Keep subtitles short (under 30 chars including brackets).
- Count EVERY character including spaces, brackets, and punctuation.

Return the CORRECTED bullet points in the same JSON format:
{
  "bulletPoints": [
    {
      "subtitle": "",
      "fullText": "",
      "sellingPoint": "",
      "fabeBreakdown": { "feature": "", "advantage": "", "benefit": "", "evidence": "" },
      "characterCount": 0
    }
  ],
  "totalCharacterCount": 0
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: `You are an expert Amazon listing copywriter. Your ONLY job right now is to fix character count issues in bullet points. Each bullet (subtitle + space + fullText) MUST be 200-280 characters. Count precisely.` },
      { role: "user", content: refinementPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = (response.choices?.[0]?.message?.content ?? "") as string;

  const result = safeParseJSON(content, bulletData);
  return (result as any).raw ? bulletData : result;
}

// Ask AI to refine titles that are out of range (two-stage format)
export async function refineTitles(titleData: any, issues: string[]): Promise<any> {
  const refinementPrompt = `You previously generated Amazon product titles in TWO-STAGE format, but some do NOT meet the character requirements.

ISSUES:
${issues.join("\n")}

CURRENT TITLES:
${JSON.stringify(titleData.titles, null, 2)}

RULES (TWO-STAGE TITLE FORMAT):
- Layer 1 (title): MUST be ≤75 characters. Contains Brand + Core Keyword + Differentiator.
- Layer 2 (itemHighlights): MUST be ≤125 characters. Contains specs, scenes, secondary keywords.
- NO word repetition between Layer 1 and Layer 2.
- If Layer 1 is TOO LONG (>75): move secondary info to Layer 2.
- If Layer 2 is TOO LONG (>125): trim less important modifiers.
- If either layer is EMPTY: generate appropriate content.
- Keep the same core keywords and brand positioning.
- Count EVERY character including spaces, commas, and hyphens.

Return the CORRECTED titles in the same JSON format:
{
  "titles": [
    {
      "title": "",
      "itemHighlights": "",
      "titleCharCount": 0,
      "itemHighlightsCharCount": 0,
      "combinedCharCount": 0,
      "coreKeywords": [],
      "strategy": ""
    }
  ],
  "recommendedTitle": "",
  "recommendedItemHighlights": "",
  "reasoning": ""
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: `You are an expert Amazon listing copywriter. Your ONLY job right now is to fix character count issues in two-stage titles. Layer 1 (title) MUST be ≤75 chars. Layer 2 (itemHighlights) MUST be ≤125 chars. Count precisely.` },
      { role: "user", content: refinementPrompt },
    ],
    response_format: { type: "json_object" },
  });

    const content = (response.choices?.[0]?.message?.content ?? "") as string;
  const result = safeParseJSON(content, titleData);
  return (result as any).raw ? titleData : result;
}
// Generate Chinese translation for listing content
export async function generateChineseTranslation(
  title: string,
  bulletPoints: any[],
  description: string,
  searchTerms: string,
  qaContent?: string,
  itemHighlights?: string,
  userId = 0,
): Promise<{ titleCn: string; itemHighlightsCn: string; bulletPointsCn: any[]; descriptionCn: string; searchTermsCn: string; qaContentCn?: string }> {
  const inputContent: any = {
    title,
    itemHighlights: itemHighlights || "",
    bulletPoints: bulletPoints.map(bp => ({
      subtitle: bp.subtitle || "",
      fullText: bp.fullText || bp.sellingPoint || "",
    })),
    description,
    searchTerms,
  };

  // Add QA content if available
  if (qaContent) {
    try {
      const qaData = JSON.parse(qaContent);
      inputContent.qaItems = qaData.qaItems || qaData;
    } catch {
      // skip if invalid JSON
    }
  }

  const context = `Please translate the following Amazon listing content into Chinese:\n\n${JSON.stringify(inputContent, null, 2)}`;
  const parsed = await executeListingSkill<any>(
    "listing.translate.chinese",
    userId,
    context,
    {
      listing: inputContent,
      includeQA: Boolean(qaContent),
      qaInstruction: qaContent
        ? `ALSO translate the "qaItems" array. For each QA item, translate "question" to "questionZh" and "answer" to "answerZh". Return the translated QA as "qaContentCn" in the response.`
        : "",
    },
  );
  return {
    titleCn: parsed.titleCn || "",
    itemHighlightsCn: parsed.itemHighlightsCn || "",
    bulletPointsCn: parsed.bulletPointsCn || [],
    descriptionCn: parsed.descriptionCn || "",
    searchTermsCn: parsed.searchTermsCn || "",
    qaContentCn: parsed.qaContentCn ? JSON.stringify(parsed.qaContentCn) : undefined,
  };
}

export async function translateImageAdviceToChinese(imageAdviceJson: string): Promise<string | null> {
  try {
    const imageAdvice = JSON.parse(imageAdviceJson);
    const response = await invokeLLM({
      messages: [
        { role: "system", content: IMAGE_ADVICE_TRANSLATION_PROMPT },
        { role: "user", content: `Please translate the following Amazon product image advice into Chinese:\n\n${JSON.stringify(imageAdvice, null, 2)}` },
      ],
      response_format: { type: "json_object" },
    });

        const content = (response.choices?.[0]?.message?.content ?? "") as string;
    // Validate and clean via safeParseJSON
    const parsed = safeParseJSON(content);
    if ((parsed as any).raw) return null;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

export function buildProductContext(project: any, analyses: any[], enrichedData?: {
  productAttributes?: any;
  competitorComparison?: any;
  keywordSceneTags?: any;
  keywordStrategyMatrix?: any;
  reviewAggregation?: any;
}) {
  const parts: string[] = [];
  parts.push(`Product: ${project.productName || project.name}`);
  if (project.brand) parts.push(`Brand: ${project.brand}`);
  if (project.category) parts.push(`Category: ${project.category}`);
  if (project.targetMarket) parts.push(`Target Market: ${project.targetMarket}`);

  if (project.productFeatures) {
    try {
      const features = JSON.parse(project.productFeatures);
      if (Array.isArray(features)) {
        parts.push(`Key Features:\n${features.map((f: string) => `- ${f}`).join("\n")}`);
      } else {
        parts.push(`Key Features: ${project.productFeatures}`);
      }
    } catch {
      parts.push(`Key Features: ${project.productFeatures}`);
    }
  }

  if (project.productSpecs) {
    try {
      const specs = JSON.parse(project.productSpecs);
      parts.push(`Specifications:\n${Object.entries(specs).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`);
    } catch {
      parts.push(`Specifications: ${project.productSpecs}`);
    }
  }

  // ─── Module 1: Rufus Attribute Extraction (本品属性表.txt) ─────────
  if (enrichedData?.productAttributes) {
    const attrs = enrichedData.productAttributes;
    parts.push("\n--- [Module 1] Rufus Product Attributes (本品属性表分析) ---");
    if (attrs.uniqueSellingPoints?.length) {
      parts.push(`Unique Selling Points: ${attrs.uniqueSellingPoints.join("; ")}`);
    }
    if (attrs.coreSpecs?.length) {
      parts.push(`Core Specs: ${attrs.coreSpecs.map((s: any) => `${s.attribute}: ${s.value}`).join("; ")}`);
    }
    if (attrs.materialBuild?.length) {
      parts.push(`Material & Build: ${attrs.materialBuild.map((m: any) => `${m.attribute}: ${m.value} (${m.sellingPoint})`).join("; ")}`);
    }
    if (attrs.performance?.length) {
      parts.push(`Performance: ${attrs.performance.map((p: any) => `${p.metric}: ${p.value}`).join("; ")}`);
    }
    if (attrs.safetyCompliance?.length) {
      parts.push(`Safety & Compliance: ${attrs.safetyCompliance.map((s: any) => `${s.certification}: ${s.detail}`).join("; ")}`);
    }
    if (attrs.rufusFriendlyAttributes?.length) {
      parts.push(`Rufus-Friendly Attributes: ${attrs.rufusFriendlyAttributes.join("; ")}`);
    }
    if (attrs.suggestedKeywordsFromAttributes?.length) {
      parts.push(`Keywords from Attributes: ${attrs.suggestedKeywordsFromAttributes.join(", ")}`);
    }
  }

  // ─── Module 2: Multi-Competitor Analysis (竞品对比结果) ────────
  // Data source: competitor ASIN analyses + review analysis results
  if (analyses.length > 0) {
    parts.push("\n--- [Module 2] Multi-Competitor Analysis (竞品格局分析 - 基于竞品对比结果) ---");

    // Extract parity (common selling points across competitors)
    const allSellingPoints: Record<string, number> = {};
    const allPainPoints: string[] = [];
    const allItchPoints: string[] = [];
    const allDelightPoints: string[] = [];
    const allWeaknesses: string[] = [];
    const allAdvantages: string[] = [];

    for (const analysis of analyses) {
      // Extract bullet points as selling points
      if (analysis.bulletPoints) {
        try {
          const bps = JSON.parse(analysis.bulletPoints);
          if (Array.isArray(bps)) {
            bps.forEach((bp: string) => {
              const key = bp.substring(0, 80).toLowerCase();
              allSellingPoints[key] = (allSellingPoints[key] || 0) + 1;
            });
          }
        } catch {}
      }

      // Extract review insights (fallback if no aggregation)
      if (!enrichedData?.reviewAggregation && analysis.reviewAnalysis) {
        try {
          const ra = JSON.parse(analysis.reviewAnalysis);
          if (ra.painPoints) allPainPoints.push(...ra.painPoints.map((p: any) => p.issue || p));
          if (ra.itchPoints) allItchPoints.push(...ra.itchPoints.map((p: any) => p.desire || p));
          if (ra.delightPoints) allDelightPoints.push(...ra.delightPoints.map((p: any) => p.feature || p));
        } catch {}
      }

      // Extract raw data insights
      if (analysis.rawData) {
        try {
          const raw = JSON.parse(analysis.rawData);
          if (raw.advantages) allAdvantages.push(...raw.advantages);
          if (raw.weaknesses) allWeaknesses.push(...raw.weaknesses);
        } catch {}
      }
    }

    // Parity: selling points mentioned by multiple competitors
    const parityPoints = Object.entries(allSellingPoints)
      .filter(([_, count]) => count >= 2)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 10);
    if (parityPoints.length > 0) {
      parts.push("Parity (Must-Have Selling Points - common across competitors):");
      parityPoints.forEach(([point, count]) => {
        parts.push(`  - ${point} [mentioned by ${count} competitors]`);
      });
    }

    // ─── Kano Model Aggregated Review Analysis (if available) ─────
    if (enrichedData?.reviewAggregation) {
      const agg = enrichedData.reviewAggregation;
      parts.push("\nKano Model Aggregated Review Analysis (卡诺模型聚合评论分析):");
      if (agg.painPoints) {
        try {
          const pains = typeof agg.painPoints === 'string' ? JSON.parse(agg.painPoints) : agg.painPoints;
          if (Array.isArray(pains) && pains.length > 0) {
            parts.push("  Pain Points (痛点 - Must-Be Quality):");
            pains.forEach((p: any) => {
              const sources = p.sourceAsins?.length ? ` [from: ${p.sourceAsins.join(", ")}]` : "";
              parts.push(`    - ${p.point} (frequency: ${p.frequency}, severity: ${p.severity})${sources}`);
              if (p.listingAdvice) parts.push(`      → Listing advice: ${p.listingAdvice}`);
            });
          }
        } catch {}
      }
      if (agg.itchPoints) {
        try {
          const itches = typeof agg.itchPoints === 'string' ? JSON.parse(agg.itchPoints) : agg.itchPoints;
          if (Array.isArray(itches) && itches.length > 0) {
            parts.push("  Itch Points (痒点 - One-Dimensional Quality):");
            itches.forEach((p: any) => {
              const sources = p.sourceAsins?.length ? ` [from: ${p.sourceAsins.join(", ")}]` : "";
              parts.push(`    - ${p.point} (frequency: ${p.frequency}, importance: ${p.importance})${sources}`);
              if (p.listingAdvice) parts.push(`      → Listing advice: ${p.listingAdvice}`);
            });
          }
        } catch {}
      }
      if (agg.delightPoints) {
        try {
          const delights = typeof agg.delightPoints === 'string' ? JSON.parse(agg.delightPoints) : agg.delightPoints;
          if (Array.isArray(delights) && delights.length > 0) {
            parts.push("  Delight Points (爽点 - Attractive Quality):");
            delights.forEach((p: any) => {
              const sources = p.sourceAsins?.length ? ` [from: ${p.sourceAsins.join(", ")}]` : "";
              parts.push(`    - ${p.point} (frequency: ${p.frequency}, impact: ${p.impact})${sources}`);
              if (p.listingAdvice) parts.push(`      → Listing advice: ${p.listingAdvice}`);
            });
          }
        } catch {}
      }
      if (agg.overallSentiment) {
        parts.push(`  Overall Market Sentiment: ${agg.overallSentiment}`);
      }
    }

    // Gap: pain points from reviews = opportunities for differentiation (fallback)
    if (allPainPoints.length > 0) {
      const uniquePains = Array.from(new Set(allPainPoints)).slice(0, 8);
      parts.push("Gap Opportunities (from competitor review pain points):");
      uniquePains.forEach(pain => {
        parts.push(`  - ${pain}`);
      });
    }

    // Competitor weaknesses as differentiation opportunities
    if (allWeaknesses.length > 0) {
      const uniqueWeaknesses = Array.from(new Set(allWeaknesses)).slice(0, 6);
      parts.push("Competitor Weaknesses (differentiation opportunities):");
      uniqueWeaknesses.forEach(w => {
        parts.push(`  - ${w}`);
      });
    }

    // Itch points: customer desires not yet met
    if (allItchPoints.length > 0) {
      const uniqueItches = Array.from(new Set(allItchPoints)).slice(0, 6);
      parts.push("Customer Itch Points (unmet desires - differentiation opportunities):");
      uniqueItches.forEach(i => {
        parts.push(`  - ${i}`);
      });
    }

    // Delight points to emulate
    if (allDelightPoints.length > 0) {
      const uniqueDelights = Array.from(new Set(allDelightPoints)).slice(0, 6);
      parts.push("Customer Delight Points (features to emphasize):");
      uniqueDelights.forEach(d => {
        parts.push(`  - ${d}`);
      });
    }

    // Competitor advantages to match or exceed
    if (allAdvantages.length > 0) {
      const uniqueAdvantages = Array.from(new Set(allAdvantages)).slice(0, 6);
      parts.push("Competitor Advantages (features to match or exceed):");
      uniqueAdvantages.forEach(a => {
        parts.push(`  - ${a}`);
      });
    }

    // Individual competitor details
    parts.push("\nDetailed Competitor Data:");
    for (const analysis of analyses) {
      parts.push(`\n  Competitor ASIN: ${analysis.asin}`);
      if (analysis.title) parts.push(`  Title: ${analysis.title}`);
      if (analysis.price) parts.push(`  Price: ${analysis.price}`);
      if (analysis.rating) parts.push(`  Rating: ${analysis.rating}`);
      if (analysis.reviewCount) parts.push(`  Review Count: ${analysis.reviewCount}`);
      // Extract brand from rawData
      if (analysis.rawData) {
        try {
          const raw = JSON.parse(analysis.rawData);
          const brand = raw.scrapedData?.brand || raw.brand;
          if (brand) parts.push(`  Brand: ${brand}`);
        } catch {}
      }
      if (analysis.keywords) {
        try {
          const kw = JSON.parse(analysis.keywords);
          if (kw.core) parts.push(`  Core Keywords: ${kw.core.map((k: any) => k.keyword || k).join(", ")}`);
          if (kw.longTail) parts.push(`  Long-tail Keywords: ${kw.longTail.map((k: any) => k.keyword || k).slice(0, 10).join(", ")}`);
          if (kw.traffic) parts.push(`  Traffic Keywords: ${kw.traffic.map((k: any) => k.keyword || k).slice(0, 10).join(", ")}`);
        } catch {}
      }
      if (analysis.bulletPoints) {
        try {
          const bps = JSON.parse(analysis.bulletPoints);
          if (Array.isArray(bps) && bps.length > 0) {
            parts.push(`  Bullet Points:`);
            bps.forEach((bp: string, i: number) => parts.push(`    ${i + 1}. ${bp}`));
          }
        } catch {}
      }
    }
  }

  // Also include file-based competitor analysis if available (legacy support)
  if (enrichedData?.competitorComparison) {
    const comp = enrichedData.competitorComparison;
    if (comp.parityPoints?.length || comp.gapOpportunities?.length) {
      parts.push("\n--- [Module 2 Supplement] File-based Competitor Analysis ---");
      if (comp.parityPoints?.length) {
        parts.push("Additional Parity Points:");
        comp.parityPoints.slice(0, 10).forEach((p: any) => {
          parts.push(`  - ${p.sellingPoint} [${p.frequency}, ${p.importance}]`);
        });
      }
      if (comp.gapOpportunities?.length) {
        parts.push("Additional Gap Opportunities:");
        comp.gapOpportunities.slice(0, 8).forEach((g: any) => {
          parts.push(`  - ${g.gap} [${g.type}, opportunity: ${g.opportunityLevel}]`);
        });
      }
    }
  }

  // ─── Module 3: COSMO Scene Mapping (关键词模块场景打标) ───────
  // Data source: keyword module AI scene tags with search volume weights
  if (enrichedData?.keywordSceneTags) {
    const scenes = enrichedData.keywordSceneTags;
    parts.push("\n--- [Module 3] COSMO Scene Mapping (关键词场景打标结果) ---");

    if (scenes.sceneGroups && Object.keys(scenes.sceneGroups).length > 0) {
      parts.push("Scene Groups (sorted by total search volume):");
      // Sort by total search volume instead of keyword count
      const sortedScenes = Object.entries(scenes.sceneGroups)
        .sort(([a], [b]) => (scenes.sceneVolumes?.[b] || 0) - (scenes.sceneVolumes?.[a] || 0))
        .slice(0, 10);
      sortedScenes.forEach(([scene, kws]: [string, any]) => {
        const vol = scenes.sceneVolumes?.[scene] || 0;
        const volStr = vol > 0 ? `, total volume: ${vol.toLocaleString()}` : "";
        parts.push(`  - ${scene} (${(kws as string[]).length} keywords${volStr}): ${(kws as string[]).slice(0, 5).join(", ")}${(kws as string[]).length > 5 ? ` (+${(kws as string[]).length - 5} more)` : ""}`);
      });
    }

    if (scenes.intentGroups && Object.keys(scenes.intentGroups).length > 0) {
      parts.push("Purchase Intent Groups (sorted by total search volume):");
      const sortedIntents = Object.entries(scenes.intentGroups)
        .sort(([a], [b]) => (scenes.intentVolumes?.[b] || 0) - (scenes.intentVolumes?.[a] || 0));
      sortedIntents.forEach(([intent, kws]: [string, any]) => {
        const vol = scenes.intentVolumes?.[intent] || 0;
        const volStr = vol > 0 ? ` [volume: ${vol.toLocaleString()}]` : "";
        parts.push(`  - ${intent}${volStr}: ${(kws as string[]).slice(0, 5).join(", ")}`);
      });
    }

    if (scenes.topScenes?.length) {
      parts.push(`Top Scenes by Search Volume: ${scenes.topScenes.join(", ")}`);
    }
  }

  // ─── Module 4: A9 Keyword Grading (关键词3D策略矩阵 + Listing布局建议) ───
  // Data source: keyword module 3D strategy matrix and listing placement
  if (enrichedData?.keywordStrategyMatrix) {
    const matrix = enrichedData.keywordStrategyMatrix;
    parts.push("\n--- [Module 4] A9 Keyword Grading (关键词3D策略矩阵 + Listing布局建议) ---");

    // Strategy categories with search volume and SPR data
    if (matrix.strategyGroups) {
      const categoryLabels: Record<string, string> = {
        core_main: "核心主词 (Core Main)",
        sub_core: "次核心词 (Sub-Core)",
        precise_longtail: "精准长尾词 (Precise Long-tail)",
        scene_intent: "场景意图词 (Scene Intent)",
        longtail_main: "长尾主词 (Long-tail Main)",
        observe_test: "观察测试词 (Observe/Test)",
      };

      for (const [cat, label] of Object.entries(categoryLabels)) {
        const kws = matrix.strategyGroups[cat];
        if (kws?.length) {
          // Show keywords with volume and SPR data
          const kwDetails = kws.slice(0, 10).map((kw: any) => {
            if (typeof kw === "string") return kw;
            const metrics: string[] = [];
            if (kw.vol > 0) metrics.push(`vol:${kw.vol.toLocaleString()}`);
            if (kw.spr) metrics.push(`SPR:${kw.spr}`);
            return metrics.length > 0 ? `${kw.keyword}(${metrics.join(",")})` : kw.keyword;
          });
          const totalVol = kws.reduce((sum: number, kw: any) => sum + (typeof kw === "string" ? 0 : kw.vol || 0), 0);
          const volSuffix = totalVol > 0 ? ` [total volume: ${totalVol.toLocaleString()}]` : "";
          parts.push(`${label}${volSuffix}: ${kwDetails.join(", ")}${kws.length > 10 ? ` (+${kws.length - 10} more)` : ""}`);
        }
      }
    }

    // Listing placement suggestions with search volume data
    if (matrix.placementGroups) {
      const placementLabels: Record<string, string> = {
        title_front: "Title Front Keywords",
        title_mid: "Title Mid Keywords",
        title_end: "Title End Keywords",
        bullet_first: "Bullet First-line Keywords",
        bullet_body: "Bullet Body Keywords",
        aplus: "A+ Content Keywords",
        search_term: "Backend Search Terms",
        not_use: "Do Not Use Keywords",
      };

      parts.push("\nListing Keyword Placement Strategy (sorted by search volume):");
      for (const [placement, label] of Object.entries(placementLabels)) {
        const kws = matrix.placementGroups[placement];
        if (kws?.length) {
          const kwDetails = kws.slice(0, 8).map((kw: any) => {
            if (typeof kw === "string") return kw;
            return kw.vol > 0 ? `${kw.keyword}(${kw.vol.toLocaleString()})` : kw.keyword;
          });
          parts.push(`  ${label}: ${kwDetails.join(", ")}${kws.length > 8 ? ` (+${kws.length - 8} more)` : ""}`);
        }
      }
    }

    // Root classification for semantic map
    if (matrix.rootGroups) {
      const rootLabels: Record<string, string> = {
        core: "核心词根 (Core Roots)",
        function: "功能词根 (Function Roots)",
        scene: "场景词根 (Scene Roots)",
        audience: "人群词根 (Audience Roots)",
        spec: "规格词根 (Spec Roots)",
        painpoint: "痛点词根 (Pain Point Roots)",
        gift_holiday: "节日礼品词根 (Gift/Holiday Roots)",
      };

      parts.push("\nKeyword Root Classification (Semantic Map):");
      for (const [root, label] of Object.entries(rootLabels)) {
        const kws = matrix.rootGroups[root];
        if (kws?.length) {
          parts.push(`  ${label}: ${kws.slice(0, 8).join(", ")}`);
        }
      }
    }
  }

  return parts.join("\n");
}

// Helper: load enriched data for a project from multiple sources
export async function loadEnrichedData(projectId: number) {
  const result: {
    productAttributes?: any;
    competitorComparison?: any;
    keywordSceneTags?: any;
    keywordStrategyMatrix?: any;
    reviewAggregation?: any;
  } = {};

  // Module 1: Load product attributes from file analysis (unchanged)
  const files = await db.getProjectFilesByProject(projectId);
  for (const file of files) {
    if (file.status !== "completed" || !file.analysisResult) continue;
    try {
      const parsed = JSON.parse(file.analysisResult);
      if (file.fileType === "product_attributes") {
        result.productAttributes = parsed;
      }
      // Legacy: also load competitor_listings file analysis as supplement
      if (file.fileType === "competitor_listings") {
        result.competitorComparison = parsed;
      }
    } catch {}
  }

  // Module 3 & 4: Load keyword module data (scene tags + strategy matrix + placement)
  const allKeywords = await db.getKeywordsByProject(projectId);
  if (allKeywords.length > 0) {
    // Build scene tag groups with volume-weighted sorting
    const sceneGroups: Record<string, string[]> = {};
    const sceneVolumes: Record<string, number> = {}; // total search volume per scene
    const intentGroups: Record<string, string[]> = {};
    const intentVolumes: Record<string, number> = {};
    for (const kw of allKeywords) {
      const vol = kw.monthlySearchVolume || 0;
      if (kw.sceneTags) {
        try {
          const tags = JSON.parse(kw.sceneTags);
          if (Array.isArray(tags)) {
            tags.forEach((tag: string) => {
              if (!sceneGroups[tag]) sceneGroups[tag] = [];
              sceneGroups[tag].push(kw.keyword);
              sceneVolumes[tag] = (sceneVolumes[tag] || 0) + vol;
            });
          }
        } catch {}
      }
      if (kw.intentTag) {
        if (!intentGroups[kw.intentTag]) intentGroups[kw.intentTag] = [];
        intentGroups[kw.intentTag].push(kw.keyword);
        intentVolumes[kw.intentTag] = (intentVolumes[kw.intentTag] || 0) + vol;
      }
    }
    // Sort scenes by total search volume (descending)
    const topScenes = Object.entries(sceneVolumes)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 8)
      .map(([scene]) => scene);

    if (Object.keys(sceneGroups).length > 0 || Object.keys(intentGroups).length > 0) {
      result.keywordSceneTags = { sceneGroups, sceneVolumes, intentGroups, intentVolumes, topScenes };
    }

    // Build strategy matrix groups and placement groups with search volume + SPR data
    type KwWithMetrics = { keyword: string; vol: number; spr: number | null; traffic: string; competition: string };
    const strategyGroups: Record<string, KwWithMetrics[]> = {};
    const placementGroups: Record<string, KwWithMetrics[]> = {};
    const rootGroups: Record<string, string[]> = {};
    for (const kw of allKeywords) {
      const kwData: KwWithMetrics = {
        keyword: kw.keyword,
        vol: kw.monthlySearchVolume || 0,
        spr: kw.spr || null,
        traffic: kw.trafficLevel || "medium",
        competition: kw.competition || "medium",
      };
      if (kw.strategyCategory && kw.strategyCategory !== "negative") {
        if (!strategyGroups[kw.strategyCategory]) strategyGroups[kw.strategyCategory] = [];
        strategyGroups[kw.strategyCategory].push(kwData);
      }
      if (kw.listingPlacement) {
        if (!placementGroups[kw.listingPlacement]) placementGroups[kw.listingPlacement] = [];
        placementGroups[kw.listingPlacement].push(kwData);
      }
      if (kw.rootCategory) {
        if (!rootGroups[kw.rootCategory]) rootGroups[kw.rootCategory] = [];
        rootGroups[kw.rootCategory].push(kw.keyword);
      }
    }

    // Sort keywords within each group by search volume (descending)
    for (const key of Object.keys(strategyGroups)) {
      strategyGroups[key].sort((a, b) => b.vol - a.vol);
    }
    for (const key of Object.keys(placementGroups)) {
      placementGroups[key].sort((a, b) => b.vol - a.vol);
    }

    if (Object.keys(strategyGroups).length > 0 || Object.keys(placementGroups).length > 0) {
      result.keywordStrategyMatrix = { strategyGroups, placementGroups, rootGroups };
    }
  }

  // Load Kano model aggregated review analysis (if available)
  const reviewAgg = await db.getReviewAggregationByProject(projectId);
  if (reviewAgg && reviewAgg.status === "completed") {
    result.reviewAggregation = reviewAgg;
  }

  return result;
}
