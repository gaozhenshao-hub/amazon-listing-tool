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

  // Generate title
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
          { role: "user", content: `Generate optimized Amazon titles for this product. REMEMBER: Each title MUST be exactly 180-200 characters long. Count carefully.\n\n${context}` },
        ],
        response_format: { type: "json_object" },
      });

      const content = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);

      try {
        const parsed = JSON.parse(content);
        // Add actual character counts for verification
        if (parsed.titles && Array.isArray(parsed.titles)) {
          for (const t of parsed.titles) {
            t.actualCharacterCount = t.title ? t.title.length : 0;
            t.characterCount = t.actualCharacterCount;
            t.inRange = t.actualCharacterCount >= 180 && t.actualCharacterCount <= 200;
          }
        }
        if (parsed.recommendedTitle) {
          parsed.recommendedTitleCharCount = parsed.recommendedTitle.length;
          parsed.recommendedTitleInRange = parsed.recommendedTitle.length >= 180 && parsed.recommendedTitle.length <= 200;
        }
        return parsed;
      } catch {
        return { raw: content };
      }
    }),

  // Generate bullet points
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
          { role: "user", content: `Generate 5 optimized Amazon bullet points for this product. REMEMBER: Each bullet point (subtitle + fullText) MUST be between 200-280 characters. NEVER exceed 280 characters. Count carefully.\n\n${context}` },
        ],
        response_format: { type: "json_object" },
      });

      const content = typeof response.choices[0].message.content === "string"
        ? response.choices[0].message.content
        : JSON.stringify(response.choices[0].message.content);

      try {
        const parsed = JSON.parse(content);
        // Add actual character counts for verification
        if (parsed.bulletPoints && Array.isArray(parsed.bulletPoints)) {
          let totalCount = 0;
          for (const bp of parsed.bulletPoints) {
            const fullBullet = bp.subtitle && bp.fullText
              ? `${bp.subtitle} ${bp.fullText}`
              : bp.fullText || bp.subtitle || "";
            bp.actualCharacterCount = fullBullet.length;
            bp.characterCount = bp.actualCharacterCount;
            bp.inRange = bp.actualCharacterCount >= 200 && bp.actualCharacterCount <= 280;
            totalCount += bp.actualCharacterCount;
          }
          parsed.totalCharacterCount = totalCount;
        }
        return parsed;
      } catch {
        return { raw: content };
      }
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

  // Generate full listing (all components at once)
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
            { role: "user", content: `Generate optimized Amazon titles. REMEMBER: Each title MUST be exactly 180-200 characters long. Count carefully.\n\n${context}` },
          ],
          response_format: { type: "json_object" },
        }),
        invokeLLM({
          messages: [
            { role: "system", content: BULLET_POINTS_PROMPT },
            { role: "user", content: `Generate 5 optimized Amazon bullet points. REMEMBER: Each bullet point (subtitle + fullText) MUST be between 200-280 characters. NEVER exceed 280 characters. Count carefully.\n\n${context}` },
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

      const titleData = parse(titleRes);
      const bulletData = parse(bulletRes);
      const descData = parse(descRes);
      const searchData = parse(searchRes);
      const imageData = parse(imageRes);

      // Add actual character counts for title verification
      if (titleData.titles && Array.isArray(titleData.titles)) {
        for (const t of titleData.titles) {
          t.actualCharacterCount = t.title ? t.title.length : 0;
          t.characterCount = t.actualCharacterCount;
          t.inRange = t.actualCharacterCount >= 180 && t.actualCharacterCount <= 200;
        }
      }
      if (titleData.recommendedTitle) {
        titleData.recommendedTitleCharCount = titleData.recommendedTitle.length;
        titleData.recommendedTitleInRange = titleData.recommendedTitle.length >= 180 && titleData.recommendedTitle.length <= 200;
      }

      // Add actual character counts for bullet points verification
      if (bulletData.bulletPoints && Array.isArray(bulletData.bulletPoints)) {
        let totalCount = 0;
        for (const bp of bulletData.bulletPoints) {
          const fullBullet = bp.subtitle && bp.fullText
            ? `${bp.subtitle} ${bp.fullText}`
            : bp.fullText || bp.subtitle || "";
          bp.actualCharacterCount = fullBullet.length;
          bp.characterCount = bp.actualCharacterCount;
          bp.inRange = bp.actualCharacterCount >= 200 && bp.actualCharacterCount <= 280;
          totalCount += bp.actualCharacterCount;
        }
        bulletData.totalCharacterCount = totalCount;
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
