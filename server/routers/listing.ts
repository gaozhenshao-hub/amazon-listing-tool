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

function buildProductContext(project: any, analyses: any[]) {
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

  // Add competitor insights
  if (analyses.length > 0) {
    parts.push("\n--- Competitor Insights ---");
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
      const context = buildProductContext(project, analyses);

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
      const context = buildProductContext(project, analyses);

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
      const context = buildProductContext(project, analyses);

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
      const context = buildProductContext(project, analyses);

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
      const context = buildProductContext(project, analyses);

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
      const context = buildProductContext(project, analyses);

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

      // Get existing listings count for versioning
      const existingListings = await db.getListingsByProject(input.projectId);
      const nextVersion = existingListings.length + 1;

      // Deactivate previous listings
      for (const listing of existingListings) {
        if (listing.isActive) {
          await db.updateListing(listing.id, { isActive: 0 });
        }
      }

      // Save the new listing
      const savedListing = await db.createListing({
        projectId: input.projectId,
        title: titleData.recommendedTitle || titleData.titles?.[0]?.title || "",
        bulletPoints: JSON.stringify(bulletData.bulletPoints || []),
        description: descData.description || descData.htmlDescription || "",
        searchTerms: searchData.searchTerms || "",
        imageAdvice: JSON.stringify(imageData),
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
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return db.updateListing(id, data);
    }),
});
