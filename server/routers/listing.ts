import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import {
  TITLE_GENERATION_PROMPT,
  BULLET_POINTS_PROMPT,
  DESCRIPTION_PROMPT,
  SEARCH_TERMS_PROMPT,
  IMAGE_ADVICE_PROMPT,
  CHINESE_TRANSLATION_PROMPT,
  IMAGE_ADVICE_TRANSLATION_PROMPT,
} from "../prompts";

const MAX_RETRIES = 2;

// Helper: create a version snapshot of the current listing state
async function saveListingVersion(
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
      bulletPoints: listing.bulletPoints || null,
      description: listing.description || null,
      searchTerms: listing.searchTerms || null,
      titleCn: listing.titleCn || null,
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
function validateBullets(bulletData: any): { valid: boolean; issues: string[] } {
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
function validateTitles(titleData: any): { valid: boolean; issues: string[] } {
  const issues: string[] = [];
  if (titleData.titles && Array.isArray(titleData.titles)) {
    for (let i = 0; i < titleData.titles.length; i++) {
      const t = titleData.titles[i];
      t.actualCharacterCount = t.title ? t.title.length : 0;
      t.characterCount = t.actualCharacterCount;
      t.inRange = t.actualCharacterCount >= 180 && t.actualCharacterCount <= 200;
      if (t.actualCharacterCount > 200) {
        issues.push(`Title ${i + 1} is ${t.actualCharacterCount} chars (max 200)`);
      } else if (t.actualCharacterCount < 180) {
        issues.push(`Title ${i + 1} is only ${t.actualCharacterCount} chars (min 180)`);
      }
    }
  }
  if (titleData.recommendedTitle) {
    titleData.recommendedTitleCharCount = titleData.recommendedTitle.length;
    titleData.recommendedTitleInRange = titleData.recommendedTitle.length >= 180 && titleData.recommendedTitle.length <= 200;
  }
  return { valid: issues.length === 0, issues };
}

// Ask AI to refine bullet points that are out of range
async function refineBullets(bulletData: any, issues: string[]): Promise<any> {
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

  const content = typeof response.choices[0].message.content === "string"
    ? response.choices[0].message.content
    : JSON.stringify(response.choices[0].message.content);

  try {
    return JSON.parse(content);
  } catch {
    return bulletData; // Return original if parsing fails
  }
}

// Ask AI to refine titles that are out of range
async function refineTitles(titleData: any, issues: string[]): Promise<any> {
  const refinementPrompt = `You previously generated Amazon product titles, but some do NOT meet the character requirements.

ISSUES:
${issues.join("\n")}

CURRENT TITLES:
${JSON.stringify(titleData.titles, null, 2)}

RULES:
- Each title MUST be 180-200 characters. NO EXCEPTIONS.
- If a title is TOO LONG (>200): condense by removing less important modifiers, combining phrases, or using shorter synonyms. Do NOT just cut off the end.
- If a title is TOO SHORT (<180): add more relevant keywords, specs, use cases, compatible models, or descriptive details.
- Keep the same core keywords and brand positioning.
- Count EVERY character including spaces, commas, and hyphens.

Return the CORRECTED titles in the same JSON format:
{
  "titles": [
    {
      "title": "",
      "characterCount": 0,
      "coreKeywords": [],
      "strategy": ""
    }
  ],
  "recommendedTitle": "",
  "reasoning": ""
}`;

  const response = await invokeLLM({
    messages: [
      { role: "system", content: `You are an expert Amazon listing copywriter. Your ONLY job right now is to fix character count issues in titles. Each title MUST be 180-200 characters. Count precisely.` },
      { role: "user", content: refinementPrompt },
    ],
    response_format: { type: "json_object" },
  });

  const content = typeof response.choices[0].message.content === "string"
    ? response.choices[0].message.content
    : JSON.stringify(response.choices[0].message.content);

  try {
    return JSON.parse(content);
  } catch {
    return titleData;
  }
}

// Generate Chinese translation for listing content
async function generateChineseTranslation(
  title: string,
  bulletPoints: any[],
  description: string,
  searchTerms: string
): Promise<{ titleCn: string; bulletPointsCn: any[]; descriptionCn: string; searchTermsCn: string }> {
  const inputContent = {
    title,
    bulletPoints: bulletPoints.map(bp => ({
      subtitle: bp.subtitle || "",
      fullText: bp.fullText || bp.sellingPoint || "",
    })),
    description,
    searchTerms,
  };

  const response = await invokeLLM({
    messages: [
      { role: "system", content: CHINESE_TRANSLATION_PROMPT },
      { role: "user", content: `Please translate the following Amazon listing content into Chinese:\n\n${JSON.stringify(inputContent, null, 2)}` },
    ],
    response_format: { type: "json_object" },
  });

  const content = typeof response.choices[0].message.content === "string"
    ? response.choices[0].message.content
    : JSON.stringify(response.choices[0].message.content);

  try {
    const parsed = JSON.parse(content);
    return {
      titleCn: parsed.titleCn || "",
      bulletPointsCn: parsed.bulletPointsCn || [],
      descriptionCn: parsed.descriptionCn || "",
      searchTermsCn: parsed.searchTermsCn || "",
    };
  } catch {
    return { titleCn: "", bulletPointsCn: [], descriptionCn: "", searchTermsCn: "" };
  }
}

async function translateImageAdviceToChinese(imageAdviceJson: string): Promise<string | null> {
  try {
    const imageAdvice = JSON.parse(imageAdviceJson);
    const response = await invokeLLM({
      messages: [
        { role: "system", content: IMAGE_ADVICE_TRANSLATION_PROMPT },
        { role: "user", content: `Please translate the following Amazon product image advice into Chinese:\n\n${JSON.stringify(imageAdvice, null, 2)}` },
      ],
      response_format: { type: "json_object" },
    });

    const content = typeof response.choices[0].message.content === "string"
      ? response.choices[0].message.content
      : JSON.stringify(response.choices[0].message.content);

    // Validate it's valid JSON
    JSON.parse(content);
    return content;
  } catch {
    return null;
  }
}

function buildProductContext(project: any, analyses: any[], enrichedData?: {
  productAttributes?: any;
  competitorComparison?: any;
  keywordSceneTags?: any;
  keywordStrategyMatrix?: any;
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

      // Extract review insights
      if (analysis.reviewAnalysis) {
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

    // Gap: pain points from reviews = opportunities for differentiation
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
async function loadEnrichedData(projectId: number) {
  const result: {
    productAttributes?: any;
    competitorComparison?: any;
    keywordSceneTags?: any;
    keywordStrategyMatrix?: any;
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

  return result;
}

export const listingRouter = router({
  // Get listings for a project
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      return db.getListingsByProject(input.projectId);
    }),

  // Get active listing
  getActive: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      return db.getActiveListingByProject(input.projectId);
    }),

  // Generate title with AI retry
  generateTitle: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: TITLE_GENERATION_PROMPT },
          { role: "user", content: `Generate optimized Amazon titles for this product. Each title MUST be exactly 180-200 characters. Count every character precisely before outputting.\n\n${context}` },
        ],
        response_format: { type: "json_object" },
      });

      const content = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        return { raw: content };
      }

      // Validate and retry if needed
      let validation = validateTitles(parsed);
      if (!validation.valid) {
        for (let retry = 0; retry < MAX_RETRIES && !validation.valid; retry++) {
          parsed = await refineTitles(parsed, validation.issues);
          validation = validateTitles(parsed);
        }
      }

      return parsed;
    }),

  // Generate bullet points with AI retry
  generateBulletPoints: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: BULLET_POINTS_PROMPT },
          { role: "user", content: `Generate 5 optimized Amazon bullet points for this product.\n\nCRITICAL: Each bullet (subtitle + space + fullText) MUST be 200-280 characters. Count every character precisely before outputting. If any bullet is outside 200-280, revise it before responding.\n\n${context}` },
        ],
        response_format: { type: "json_object" },
      });

      const content = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);

      let parsed;
      try {
        parsed = JSON.parse(content);
      } catch {
        return { raw: content };
      }

      // Validate and retry if needed
      let validation = validateBullets(parsed);
      if (!validation.valid) {
        for (let retry = 0; retry < MAX_RETRIES && !validation.valid; retry++) {
          parsed = await refineBullets(parsed, validation.issues);
          validation = validateBullets(parsed);
        }
      }

      return parsed;
    }),

  // Generate description
  generateDescription: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: DESCRIPTION_PROMPT },
          { role: "user", content: `Generate an optimized Amazon product description:\n\n${context}` },
        ],
        response_format: { type: "json_object" },
      });

      const content = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);

      try {
        return JSON.parse(content);
      } catch {
        return { raw: content };
      }
    }),

  // Generate search terms
  generateSearchTerms: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      existingTitle: z.string().optional(),
      emphasis: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      let extraContext = "";
      if (input.existingTitle) {
        extraContext = `\n\nCurrent Title (do NOT repeat these words): ${input.existingTitle}`;
      }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: SEARCH_TERMS_PROMPT },
          { role: "user", content: `Generate backend search terms for this product:\n\n${context}${extraContext}` },
        ],
        response_format: { type: "json_object" },
      });

      const content = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);

      try {
        return JSON.parse(content);
      } catch {
        return { raw: content };
      }
    }),

  // Generate image advice
  generateImageAdvice: protectedProcedure
    .input(z.object({ projectId: z.number(), emphasis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis] ---\n用户希望重点突出：${input.emphasis.trim()}`;
      }

      const response = await invokeLLM({
        messages: [
          { role: "system", content: IMAGE_ADVICE_PROMPT },
          { role: "user", content: `Provide image recommendations for this product:\n\n${context}` },
        ],
        response_format: { type: "json_object" },
      });

      const content = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);

      try {
        return JSON.parse(content);
      } catch {
        return { raw: content };
      }
    }),

  // Generate full listing (all components at once) with AI retry for char limits
  generateFull: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      emphasis: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      await db.updateProject(input.projectId, ctx.user.id, { status: "generating" });

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      let context = buildProductContext(project, analyses, enrichedData);

      // Inject user emphasis into context
      if (input.emphasis?.trim()) {
        context += `\n\n--- [User Emphasis / 用户重点强调] ---\n用户希望在Listing中重点突出以下卖点或场景，请在标题、五点、描述中优先体现这些内容：\n${input.emphasis.trim()}`;
      }

      // Generate all components in parallel
      const [titleRes, bulletRes, descRes, searchRes, imageRes] = await Promise.all([
        invokeLLM({
          messages: [
            { role: "system", content: TITLE_GENERATION_PROMPT },
            { role: "user", content: `Generate optimized Amazon titles. Each title MUST be exactly 180-200 characters. Count every character precisely before outputting.\n\n${context}` },
          ],
          response_format: { type: "json_object" },
        }),
        invokeLLM({
          messages: [
            { role: "system", content: BULLET_POINTS_PROMPT },
            { role: "user", content: `Generate 5 optimized Amazon bullet points. Each bullet (subtitle + space + fullText) MUST be 200-280 characters. Count every character precisely before outputting.\n\n${context}` },
          ],
          response_format: { type: "json_object" },
        }),
        invokeLLM({
          messages: [
            { role: "system", content: DESCRIPTION_PROMPT },
            { role: "user", content: `Generate an optimized Amazon product description:\n\n${context}` },
          ],
          response_format: { type: "json_object" },
        }),
        invokeLLM({
          messages: [
            { role: "system", content: SEARCH_TERMS_PROMPT },
            { role: "user", content: `Generate backend search terms:\n\n${context}` },
          ],
          response_format: { type: "json_object" },
        }),
        invokeLLM({
          messages: [
            { role: "system", content: IMAGE_ADVICE_PROMPT },
            { role: "user", content: `Provide image recommendations:\n\n${context}` },
          ],
          response_format: { type: "json_object" },
        }),
      ]);

      const parse = (res: any) => {
        const c = typeof res.choices[0].message.content === "string"
          ? res.choices[0].message.content
          : JSON.stringify(res.choices[0].message.content);
        try { return JSON.parse(c); } catch { return { raw: c }; }
      };

      let titleData = parse(titleRes);
      let bulletData = parse(bulletRes);
      const descData = parse(descRes);
      const searchData = parse(searchRes);
      const imageData = parse(imageRes);

      // Validate titles and retry if needed
      let titleValidation = validateTitles(titleData);
      if (!titleValidation.valid) {
        for (let retry = 0; retry < MAX_RETRIES && !titleValidation.valid; retry++) {
          titleData = await refineTitles(titleData, titleValidation.issues);
          titleValidation = validateTitles(titleData);
        }
      }

      // Validate bullets and retry if needed
      let bulletValidation = validateBullets(bulletData);
      if (!bulletValidation.valid) {
        for (let retry = 0; retry < MAX_RETRIES && !bulletValidation.valid; retry++) {
          bulletData = await refineBullets(bulletData, bulletValidation.issues);
          bulletValidation = validateBullets(bulletData);
        }
      }

      // Generate Chinese translation
      const englishTitle = titleData.recommendedTitle || titleData.titles?.[0]?.title || "";
      const englishBullets = bulletData.bulletPoints || [];
      const englishDesc = descData.description || descData.htmlDescription || "";
      const englishSearchTerms = searchData.searchTerms || "";

      let cnData = { titleCn: "", bulletPointsCn: [] as any[], descriptionCn: "", searchTermsCn: "" };
      try {
        cnData = await generateChineseTranslation(
          englishTitle,
          englishBullets,
          englishDesc,
          englishSearchTerms
        );
      } catch (err) {
        console.error("Chinese translation failed:", err);
        // Continue without Chinese translation - it can be generated later
      }

      // Get existing listings count for versioning
      const existingListings = await db.getListingsByProject(input.projectId);
      const nextVersion = existingListings.length + 1;

      // Deactivate previous listings
      for (const listing of existingListings) {
        if (listing.isActive) {
          await db.updateListing(listing.id, { isActive: 0 });
        }
      }

      // Translate image advice to Chinese
      const imageAdviceJsonStr = JSON.stringify(imageData);
      const imageAdviceCnStr = await translateImageAdviceToChinese(imageAdviceJsonStr);

      // Save the new listing with Chinese translations
      const savedListing = await db.createListing({
        projectId: input.projectId,
        title: englishTitle,
        bulletPoints: JSON.stringify(bulletData.bulletPoints || []),
        description: englishDesc,
        searchTerms: englishSearchTerms,
        imageAdvice: imageAdviceJsonStr,
        imageAdviceCn: imageAdviceCnStr || null,
        titleCn: cnData.titleCn || null,
        bulletPointsCn: cnData.bulletPointsCn.length > 0 ? JSON.stringify(cnData.bulletPointsCn) : null,
        descriptionCn: cnData.descriptionCn || null,
        searchTermsCn: cnData.searchTermsCn || null,
        version: nextVersion,
        isActive: 1,
      });

      await db.updateProject(input.projectId, ctx.user.id, { status: "completed" });

      // Save version snapshot
      await saveListingVersion(savedListing, ctx.user.id, "generate", `全量生成 v${nextVersion}`);

      return {
        listing: savedListing,
        titleOptions: titleData,
        bulletPointsData: bulletData,
        descriptionData: descData,
        searchTermsData: searchData,
        imageAdviceData: imageData,
        chineseTranslation: cnData,
      };
    }),

  // Translate existing listing to Chinese
  translateToChinese: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) throw new Error("No active listing found. Please generate a listing first.");

      let bulletPoints: any[] = [];
      try {
        bulletPoints = listing.bulletPoints ? JSON.parse(listing.bulletPoints) : [];
      } catch {
        bulletPoints = [];
      }

      const cnData = await generateChineseTranslation(
        listing.title || "",
        bulletPoints,
        listing.description || "",
        listing.searchTerms || ""
      );

      // Translate image advice to Chinese if available
      let imageAdviceCnStr: string | null = null;
      if (listing.imageAdvice) {
        imageAdviceCnStr = await translateImageAdviceToChinese(listing.imageAdvice);
      }

      // Save Chinese translations to the listing
      const updated = await db.updateListing(listing.id, {
        titleCn: cnData.titleCn,
        bulletPointsCn: JSON.stringify(cnData.bulletPointsCn),
        descriptionCn: cnData.descriptionCn,
        searchTermsCn: cnData.searchTermsCn,
        imageAdviceCn: imageAdviceCnStr,
      });

      // Save version snapshot after translation
      await saveListingVersion(
        { ...listing, titleCn: cnData.titleCn, bulletPointsCn: JSON.stringify(cnData.bulletPointsCn), descriptionCn: cnData.descriptionCn, searchTermsCn: cnData.searchTermsCn },
        ctx.user.id, "translate", "添加中文翻译"
      );

      return {
        ...cnData,
        listing: updated,
      };
    }),

  // Update a listing (for manual edits)
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      title: z.string().optional(),
      bulletPoints: z.string().optional(),
      description: z.string().optional(),
      searchTerms: z.string().optional(),
      titleCn: z.string().optional(),
      bulletPointsCn: z.string().optional(),
      descriptionCn: z.string().optional(),
      searchTermsCn: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...data } = input;
      const result = await db.updateListing(id, data);
      // Save version snapshot after manual edit
      if (result && ctx.user) {
        const updatedFields = Object.keys(data).filter(k => (data as any)[k] !== undefined);
        const fieldMap: Record<string, string> = { title: '标题', bulletPoints: '卖点', description: '描述', searchTerms: '搜索词', titleCn: '中文标题', bulletPointsCn: '中文卖点', descriptionCn: '中文描述', searchTermsCn: '中文搜索词' };
        const fieldNames = updatedFields.map(f => fieldMap[f] || f).join('、');
        await saveListingVersion(result, ctx.user.id, "manual_edit", `手动编辑: ${fieldNames}`);
      }
      return result;
    }),

  // Generate A/B test variants - 3 different styles for title and bullet points
  generateABTest: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      // Which components to generate variants for
      components: z.array(z.enum(["title", "bulletPoints"])).default(["title", "bulletPoints"]),
      // Optional custom style instruction from user
      customStyle: z.object({
        name: z.string(),
        instruction: z.string(),
      }).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const enrichedData = await loadEnrichedData(input.projectId);
      const context = buildProductContext(project, analyses, enrichedData);

      const styles: Array<{
        id: string; name: string; nameEn: string; description: string;
        titleInstruction: string; bulletInstruction: string;
      }> = [
        {
          id: "professional",
          name: "专业技术型",
          nameEn: "Professional & Technical",
          description: "强调产品规格参数、技术优势、专利认证，适合注重品质和性能的买家",
          titleInstruction: "Focus on technical specifications, certifications, material quality, and performance metrics. Use precise numbers and professional terminology. Appeal to informed buyers who compare specs.",
          bulletInstruction: "Lead each bullet with a technical feature or specification. Use precise measurements, material names, and performance data. Include certifications, test results, and engineering details. Evidence should cite specific numbers and standards.",
        },
        {
          id: "emotional",
          name: "情感场景型",
          nameEn: "Emotional & Lifestyle",
          description: "强调使用场景、情感共鸣、生活方式，适合注重体验和感受的买家",
          titleInstruction: "Focus on lifestyle benefits, usage scenarios, and emotional outcomes. Paint a picture of how the product improves daily life. Use warm, relatable language that connects with the buyer's aspirations.",
          bulletInstruction: "Lead each bullet with a relatable scenario or emotional benefit. Describe how the product fits into the buyer's life, solves daily frustrations, or creates joyful moments. Use vivid, sensory language. Evidence should reference real customer experiences.",
        },
        {
          id: "datadriven",
          name: "数据驱动型",
          nameEn: "Data-Driven & Comparative",
          description: "强调数据对比、量化优势、竞品差异化，适合理性决策的买家",
          titleInstruction: "Focus on quantifiable advantages and comparative benefits. Use numbers, percentages, and measurable improvements. Highlight what makes this product X% better, X times stronger, or X units more efficient than alternatives.",
          bulletInstruction: "Lead each bullet with a quantified claim or data comparison. Use percentages, multipliers, and measurable outcomes (e.g., '3X faster', '50% lighter', 'supports 300lbs'). Compare against industry standards or common alternatives. Evidence should be data-backed with specific numbers.",
        },
      ];

      // Add custom style if provided by user
      if (input.customStyle) {
        styles.push({
          id: "custom",
          name: input.customStyle.name || "自定义风格",
          nameEn: "Custom Style",
          description: input.customStyle.instruction,
          titleInstruction: input.customStyle.instruction + " Write the title following this custom style direction from the user.",
          bulletInstruction: input.customStyle.instruction + " Write the bullet points following this custom style direction from the user.",
        });
      }

      const variants: any[] = [];

      // Generate all style variants in parallel (3 default + optional custom)
      const variantPromises = styles.map(async (style) => {
        const variant: any = { id: style.id, name: style.name, nameEn: style.nameEn, description: style.description };

        if (input.components.includes("title")) {
          const titleResponse = await invokeLLM({
            messages: [
              { role: "system", content: TITLE_GENERATION_PROMPT },
              {
                role: "user",
                content: `Generate optimized Amazon titles for this product. Each title MUST be exactly 180-200 characters.\n\nSTYLE INSTRUCTION: ${style.titleInstruction}\n\n${context}`,
              },
            ],
            response_format: { type: "json_object" },
          });

          const titleContent = typeof titleResponse.choices[0].message.content === "string"
            ? titleResponse.choices[0].message.content
            : JSON.stringify(titleResponse.choices[0].message.content);

          try {
            let titleData = JSON.parse(titleContent);
            let validation = validateTitles(titleData);
            if (!validation.valid) {
              for (let retry = 0; retry < MAX_RETRIES && !validation.valid; retry++) {
                titleData = await refineTitles(titleData, validation.issues);
                validation = validateTitles(titleData);
              }
            }
            variant.titleData = titleData;
          } catch {
            variant.titleData = { raw: titleContent };
          }
        }

        if (input.components.includes("bulletPoints")) {
          const bulletResponse = await invokeLLM({
            messages: [
              { role: "system", content: BULLET_POINTS_PROMPT },
              {
                role: "user",
                content: `Generate 5 optimized Amazon bullet points. Each bullet (subtitle + space + fullText) MUST be 200-280 characters.\n\nSTYLE INSTRUCTION: ${style.bulletInstruction}\n\n${context}`,
              },
            ],
            response_format: { type: "json_object" },
          });

          const bulletContent = typeof bulletResponse.choices[0].message.content === "string"
            ? bulletResponse.choices[0].message.content
            : JSON.stringify(bulletResponse.choices[0].message.content);

          try {
            let bulletData = JSON.parse(bulletContent);
            let validation = validateBullets(bulletData);
            if (!validation.valid) {
              for (let retry = 0; retry < MAX_RETRIES && !validation.valid; retry++) {
                bulletData = await refineBullets(bulletData, validation.issues);
                validation = validateBullets(bulletData);
              }
            }
            variant.bulletData = bulletData;
          } catch {
            variant.bulletData = { raw: bulletContent };
          }
        }

        return variant;
      });

      const results = await Promise.all(variantPromises);
      // Maintain order
      for (const style of styles) {
        const found = results.find((r) => r.id === style.id);
        if (found) variants.push(found);
      }

      return { variants, projectId: input.projectId };
    }),

  // Apply a selected A/B variant to the active listing
  applyABVariant: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      // The selected variant data to apply
      title: z.string().optional(),
      bulletPoints: z.string().optional(), // JSON string of bullet points array
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) throw new Error("No active listing found. Please generate a listing first.");

      const updateData: Record<string, any> = {};
      if (input.title) updateData.title = input.title;
      if (input.bulletPoints) updateData.bulletPoints = input.bulletPoints;

      if (Object.keys(updateData).length === 0) {
        throw new Error("No data to apply");
      }

      // Generate Chinese translation for the updated content
      const newTitle = input.title || listing.title || "";
      let newBullets: any[] = [];
      try {
        newBullets = input.bulletPoints ? JSON.parse(input.bulletPoints) : (listing.bulletPoints ? JSON.parse(listing.bulletPoints) : []);
      } catch {
        newBullets = [];
      }

      try {
        const cnData = await generateChineseTranslation(
          newTitle,
          newBullets,
          listing.description || "",
          listing.searchTerms || ""
        );
        if (input.title && cnData.titleCn) updateData.titleCn = cnData.titleCn;
        if (input.bulletPoints && cnData.bulletPointsCn?.length > 0) {
          updateData.bulletPointsCn = JSON.stringify(cnData.bulletPointsCn);
        }
      } catch (err) {
        console.error("Chinese translation for A/B variant failed:", err);
      }

      const updated = await db.updateListing(listing.id, updateData);

      // Save version snapshot after A/B variant applied
      if (updated) {
        const appliedParts = [];
        if (input.title) appliedParts.push("标题");
        if (input.bulletPoints) appliedParts.push("卖点");
        await saveListingVersion(updated, ctx.user.id, "ab_apply", `应用A/B测试方案: ${appliedParts.join("、")}`);
      }

      return { listing: updated, applied: Object.keys(updateData) };
    }),

  // ─── Version History Procedures ───

  // Get version history for a project
  getVersionHistory: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return db.getListingVersionsByProject(input.projectId);
    }),

  // Rollback to a specific version
  rollbackToVersion: protectedProcedure
    .input(z.object({
      versionId: z.number(),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const version = await db.getListingVersionById(input.versionId);
      if (!version) throw new Error("Version not found");
      if (version.projectId !== input.projectId) throw new Error("Version does not belong to this project");

      const listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) throw new Error("No active listing found");

      // Save current state as a version before rollback
      await saveListingVersion(listing, ctx.user.id, "manual_edit", `回滚前的状态备份`);

      // Apply the version snapshot to the active listing
      const updated = await db.updateListing(listing.id, {
        title: version.title,
        bulletPoints: version.bulletPoints,
        description: version.description,
        searchTerms: version.searchTerms,
        titleCn: version.titleCn,
        bulletPointsCn: version.bulletPointsCn,
        descriptionCn: version.descriptionCn,
        searchTermsCn: version.searchTermsCn,
      });

      // Save the rollback as a new version
      if (updated) {
        await saveListingVersion(updated, ctx.user.id, "manual_edit", `回滚到版本 #${version.versionNumber}`);
      }

      return { listing: updated, rolledBackTo: version.versionNumber };
    }),
});
