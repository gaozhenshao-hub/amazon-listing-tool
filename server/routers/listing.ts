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
} from "../prompts";

const MAX_RETRIES = 2;

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

function buildProductContext(project: any, analyses: any[], fileAnalyses?: {
  productAttributes?: any;
  competitorListings?: any;
  cosmoScenes?: any;
  a9Keywords?: any;
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

  // ─── Module 1: Rufus Attribute Extraction ─────────────────────
  if (fileAnalyses?.productAttributes) {
    const attrs = fileAnalyses.productAttributes;
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

  // ─── Module 2: Multi-Competitor Analysis ──────────────────────
  if (fileAnalyses?.competitorListings) {
    const comp = fileAnalyses.competitorListings;
    parts.push("\n--- [Module 2] Multi-Competitor Analysis (竞品格局分析) ---");
    if (comp.parityPoints?.length) {
      parts.push("Parity (Must-Have Selling Points):");
      comp.parityPoints.slice(0, 10).forEach((p: any) => {
        parts.push(`  - ${p.sellingPoint} [${p.frequency}, ${p.importance}]`);
      });
    }
    if (comp.gapOpportunities?.length) {
      parts.push("Gap Opportunities (Differentiation):");
      comp.gapOpportunities.slice(0, 8).forEach((g: any) => {
        parts.push(`  - ${g.gap} [${g.type}, opportunity: ${g.opportunityLevel}]`);
      });
    }
    if (comp.strategicRecommendations) {
      const sr = comp.strategicRecommendations;
      if (sr.mustInclude?.length) parts.push(`Must Include: ${sr.mustInclude.join("; ")}`);
      if (sr.differentiators?.length) parts.push(`Differentiators: ${sr.differentiators.join("; ")}`);
      if (sr.avoidCopying?.length) parts.push(`Avoid Copying: ${sr.avoidCopying.join("; ")}`);
    }
  }

  // ─── Module 3: COSMO Scene Mapping ───────────────────────────
  if (fileAnalyses?.cosmoScenes) {
    const cosmo = fileAnalyses.cosmoScenes;
    parts.push("\n--- [Module 3] COSMO Scene Mapping (场景映射) ---");
    if (cosmo.scenesClusters?.length) {
      parts.push("Top Usage Scenes:");
      cosmo.scenesClusters.slice(0, 8).forEach((sc: any) => {
        parts.push(`  - ${sc.sceneName} (${sc.sceneNameCn || ""}) [priority: ${sc.priority}]`);
        if (sc.buyerIntent) parts.push(`    Intent: ${sc.buyerIntent}`);
        if (sc.listingMapping) {
          if (sc.listingMapping.titleKeywords?.length) parts.push(`    Title Keywords: ${sc.listingMapping.titleKeywords.join(", ")}`);
          if (sc.listingMapping.bulletAngle) parts.push(`    Bullet Angle: ${sc.listingMapping.bulletAngle}`);
        }
      });
    }
    if (cosmo.topScenesByVolume?.length) {
      parts.push(`Top Scenes by Volume: ${cosmo.topScenesByVolume.join(", ")}`);
    }
    if (cosmo.seasonalPatterns?.length) {
      parts.push(`Seasonal Patterns: ${cosmo.seasonalPatterns.join(", ")}`);
    }
  }

  // ─── Module 4: A9 Keyword Grading ────────────────────────────
  if (fileAnalyses?.a9Keywords) {
    const a9 = fileAnalyses.a9Keywords;
    parts.push("\n--- [Module 4] A9 Keyword Grading (关键词分级) ---");
    if (a9.titleMustHaveKeywords?.length) {
      parts.push(`Title MUST-HAVE Keywords: ${a9.titleMustHaveKeywords.join(", ")}`);
    }
    if (a9.bulletPriorityKeywords?.length) {
      parts.push(`Bullet Priority Keywords: ${a9.bulletPriorityKeywords.join(", ")}`);
    }
    if (a9.backendKeywords?.length) {
      parts.push(`Backend Search Keywords: ${a9.backendKeywords.join(", ")}`);
    }
    if (a9.goldenKeywords?.length) {
      parts.push(`Golden Keywords (high volume + low competition): ${a9.goldenKeywords.join(", ")}`);
    }
    if (a9.keywordClusters?.length) {
      parts.push("Keyword Clusters:");
      a9.keywordClusters.slice(0, 6).forEach((c: any) => {
        parts.push(`  - ${c.clusterName}: ${(c.keywords || []).join(", ")} [${c.bestPlacement}]`);
      });
    }
    if (a9.keywordStrategy) {
      parts.push(`Keyword Strategy: ${a9.keywordStrategy}`);
    }
  }

  // Add competitor insights from ASIN analyses
  if (analyses.length > 0) {
    parts.push("\n--- Competitor ASIN Insights ---");
    for (const analysis of analyses) {
      parts.push(`\nCompetitor ASIN: ${analysis.asin}`);
      if (analysis.title) parts.push(`Competitor Title: ${analysis.title}`);
      if (analysis.keywords) {
        try {
          const kw = JSON.parse(analysis.keywords);
          if (kw.core) parts.push(`Core Keywords: ${kw.core.map((k: any) => k.keyword || k).join(", ")}`);
        } catch {}
      }
      if (analysis.reviewAnalysis) {
        try {
          const ra = JSON.parse(analysis.reviewAnalysis);
          if (ra.painPoints) parts.push(`Customer Pain Points: ${ra.painPoints.map((p: any) => p.issue).join("; ")}`);
          if (ra.delightPoints) parts.push(`Customer Delight Points: ${ra.delightPoints.map((p: any) => p.feature).join("; ")}`);
        } catch {}
      }
    }
  }

  return parts.join("\n");
}

// Helper: load file analysis data for a project
async function loadFileAnalyses(projectId: number) {
  const files = await db.getProjectFilesByProject(projectId);
  const result: {
    productAttributes?: any;
    competitorListings?: any;
    cosmoScenes?: any;
    a9Keywords?: any;
  } = {};

  for (const file of files) {
    if (file.status !== "completed" || !file.analysisResult) continue;
    try {
      const parsed = JSON.parse(file.analysisResult);
      switch (file.fileType) {
        case "product_attributes":
          result.productAttributes = parsed;
          break;
        case "competitor_listings":
          result.competitorListings = parsed;
          break;
        case "search_term_report":
          result.cosmoScenes = parsed;
          break;
        case "aba_keywords":
          result.a9Keywords = parsed;
          break;
      }
    } catch {}
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
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const fileAnalyses = await loadFileAnalyses(input.projectId);
      const context = buildProductContext(project, analyses, fileAnalyses);

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
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const fileAnalyses = await loadFileAnalyses(input.projectId);
      const context = buildProductContext(project, analyses, fileAnalyses);

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
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const fileAnalyses = await loadFileAnalyses(input.projectId);
      const context = buildProductContext(project, analyses, fileAnalyses);

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
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const fileAnalyses = await loadFileAnalyses(input.projectId);
      const context = buildProductContext(project, analyses, fileAnalyses);

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
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const fileAnalyses = await loadFileAnalyses(input.projectId);
      const context = buildProductContext(project, analyses, fileAnalyses);

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
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      await db.updateProject(input.projectId, ctx.user.id, { status: "generating" });

      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const fileAnalyses = await loadFileAnalyses(input.projectId);
      const context = buildProductContext(project, analyses, fileAnalyses);

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

      // Save the new listing with Chinese translations
      const savedListing = await db.createListing({
        projectId: input.projectId,
        title: englishTitle,
        bulletPoints: JSON.stringify(bulletData.bulletPoints || []),
        description: englishDesc,
        searchTerms: englishSearchTerms,
        imageAdvice: JSON.stringify(imageData),
        titleCn: cnData.titleCn || null,
        bulletPointsCn: cnData.bulletPointsCn.length > 0 ? JSON.stringify(cnData.bulletPointsCn) : null,
        descriptionCn: cnData.descriptionCn || null,
        searchTermsCn: cnData.searchTermsCn || null,
        version: nextVersion,
        isActive: 1,
      });

      await db.updateProject(input.projectId, ctx.user.id, { status: "completed" });

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

      // Save Chinese translations to the listing
      const updated = await db.updateListing(listing.id, {
        titleCn: cnData.titleCn,
        bulletPointsCn: JSON.stringify(cnData.bulletPointsCn),
        descriptionCn: cnData.descriptionCn,
        searchTermsCn: cnData.searchTermsCn,
      });

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
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.updateListing(id, data);
    }),
});
