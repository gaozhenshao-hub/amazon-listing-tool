import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import { scoreListing } from "../scoringEngine";

// Dimension-specific optimization prompts
const OPTIMIZE_PROMPTS: Record<string, (current: string, issues: string[], keywords: string[]) => string> = {
  "Title Optimization": (current, issues, keywords) => `You are a senior Amazon listing optimization expert with 10 years of experience.

Current product title:
${current}

Issues found in scoring:
${issues.map(i => `- ${i}`).join("\n")}

${keywords.length > 0 ? `Core keywords that MUST be included:\n${keywords.slice(0, 20).join(", ")}` : ""}

Requirements:
1. Title must be 180-200 characters (this is CRITICAL - fully utilize the space)
2. Follow Amazon title formula: Brand + Core Keyword + Key Feature + Use Case + Differentiator
3. Capitalize first letter of each major word (Title Case)
4. Do NOT use special characters, emojis, or all caps
5. Front-load the most important keywords
6. Fix all the issues listed above

Return ONLY the optimized title text, nothing else. No quotes, no explanation.`,

  "Bullet Points Quality": (current, issues, keywords) => `You are a senior Amazon listing optimization expert with 10 years of experience.

Current bullet points (JSON):
${current}

Issues found in scoring:
${issues.map(i => `- ${i}`).join("\n")}

${keywords.length > 0 ? `Core keywords to incorporate:\n${keywords.slice(0, 20).join(", ")}` : ""}

Requirements:
1. Each bullet point MUST be 200-280 characters (CRITICAL)
2. Each bullet must have a clear subtitle (ALL CAPS) followed by descriptive text
3. Exactly 5 bullet points
4. Start each with a benefit-driven subtitle
5. Include specific data, numbers, or measurements where possible
6. Distribute keywords naturally across all 5 bullets
7. Fix all the issues listed above

Return ONLY valid JSON in this exact format:
{
  "bulletPoints": [
    {
      "subtitle": "SUBTITLE IN CAPS",
      "fullText": "SUBTITLE IN CAPS - detailed description text here",
      "characterCount": 250,
      "keywordsUsed": ["keyword1", "keyword2"]
    }
  ]
}`,

  "Description Quality": (current, issues, keywords) => `You are a senior Amazon listing optimization expert with 10 years of experience.

Current product description:
${current}

Issues found in scoring:
${issues.map(i => `- ${i}`).join("\n")}

${keywords.length > 0 ? `Core keywords to incorporate:\n${keywords.slice(0, 15).join(", ")}` : ""}

Requirements:
1. Description should be 1500-2000 characters
2. Use HTML formatting: <br>, <b>, <ul>, <li> tags
3. Include a compelling opening paragraph
4. Cover: product features, use cases, specifications, and call to action
5. Naturally incorporate keywords without stuffing
6. Fix all the issues listed above

Return ONLY the optimized description text with HTML formatting. No JSON wrapper.`,

  "Search Terms Optimization": (current, issues, keywords) => `You are a senior Amazon listing optimization expert with 10 years of experience.

Current search terms:
${current}

Issues found in scoring:
${issues.map(i => `- ${i}`).join("\n")}

${keywords.length > 0 ? `Available keywords pool:\n${keywords.join(", ")}` : ""}

Requirements:
1. Total search terms MUST be under 250 bytes
2. Use only lowercase letters
3. No punctuation, no brand names, no ASINs
4. No duplicate words (each word appears only once)
5. Do NOT repeat words already in title or bullet points
6. Separate words with single spaces
7. Include misspellings and synonyms
8. Fix all the issues listed above

Return ONLY the optimized search terms text. No quotes, no explanation.`,
};

export const scoringRouter = router({
  // Score the active listing for a project
  scoreListing: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) {
        return null;
      }

      // Load A9 keyword data if available
      let a9Keywords: any = null;
      let coreKeywords: string[] = [];

      try {
        const database = await db.getDb();
        if (database) {
          const { projectFiles } = await import("../../drizzle/schema");
          const { eq, and } = await import("drizzle-orm");

          // Get A9 keywords file
          const a9Files = await database
            .select()
            .from(projectFiles)
            .where(
              and(
                eq(projectFiles.projectId, input.projectId),
                eq(projectFiles.fileType, "aba_keywords"),
                eq(projectFiles.status, "completed")
              )
            );

          if (a9Files.length > 0 && a9Files[0].analysisResult) {
            try {
              a9Keywords = JSON.parse(a9Files[0].analysisResult);
              
              // Extract core keywords from A9 data
              const titleKws = a9Keywords.titleMustHaveKeywords || a9Keywords.titleKeywords || [];
              const bulletKws = a9Keywords.bulletPointKeywords || a9Keywords.bulletKeywords || [];
              const goldenKws = a9Keywords.goldenLongTailKeywords || a9Keywords.goldenKeywords || [];
              
              coreKeywords = [
                ...titleKws.map((kw: any) => typeof kw === "string" ? kw : kw.keyword || kw.term || ""),
                ...bulletKws.map((kw: any) => typeof kw === "string" ? kw : kw.keyword || kw.term || ""),
                ...goldenKws.map((kw: any) => typeof kw === "string" ? kw : kw.keyword || kw.term || ""),
              ].filter(Boolean);
            } catch {}
          }

          // Also try to extract keywords from competitor analyses
          if (coreKeywords.length === 0) {
            const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
            for (const analysis of analyses) {
              if (analysis.keywords) {
                try {
                  const kwData = JSON.parse(analysis.keywords);
                  if (kwData.coreKeywords) coreKeywords.push(...kwData.coreKeywords);
                  if (kwData.longTailKeywords) coreKeywords.push(...kwData.longTailKeywords.slice(0, 5));
                  if (kwData.trafficKeywords) coreKeywords.push(...kwData.trafficKeywords.slice(0, 5));
                } catch {}
              }
            }
          }
        }
      } catch (err) {
        console.warn("[Scoring] Failed to load keyword data:", err);
      }

      // Deduplicate keywords
      coreKeywords = Array.from(new Set(coreKeywords.map(k => k.toLowerCase())));

      return scoreListing(
        {
          title: listing.title,
          bulletPoints: listing.bulletPoints,
          description: listing.description,
          searchTerms: listing.searchTerms,
          titleCn: listing.titleCn,
          bulletPointsCn: listing.bulletPointsCn,
          descriptionCn: listing.descriptionCn,
          searchTermsCn: listing.searchTermsCn,
          imageAdvice: listing.imageAdvice,
        },
        a9Keywords,
        coreKeywords
      );
    }),

  // AI optimize a specific dimension
  optimizeDimension: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      dimension: z.string(), // e.g. "Title Optimization", "Bullet Points Quality"
      issues: z.array(z.string()), // list of issue messages from scoring
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) throw new Error("No active listing found. Please generate a listing first.");

      // Get the prompt builder for this dimension
      const promptBuilder = OPTIMIZE_PROMPTS[input.dimension];
      if (!promptBuilder) throw new Error(`Unsupported dimension: ${input.dimension}`);

      // Get current content for this dimension
      let currentContent = "";
      let updateField = "";
      switch (input.dimension) {
        case "Title Optimization":
          currentContent = listing.title || "";
          updateField = "title";
          break;
        case "Bullet Points Quality":
          currentContent = listing.bulletPoints || "";
          updateField = "bulletPoints";
          break;
        case "Description Quality":
          currentContent = listing.description || "";
          updateField = "description";
          break;
        case "Search Terms Optimization":
          currentContent = listing.searchTerms || "";
          updateField = "searchTerms";
          break;
        default:
          throw new Error(`Cannot optimize dimension: ${input.dimension}. Only Title, Bullet Points, Description, and Search Terms can be optimized.`);
      }

      // Load keywords for context
      let coreKeywords: string[] = [];
      try {
        const database = await db.getDb();
        if (database) {
          const { projectFiles } = await import("../../drizzle/schema");
          const { eq, and } = await import("drizzle-orm");
          const a9Files = await database
            .select()
            .from(projectFiles)
            .where(
              and(
                eq(projectFiles.projectId, input.projectId),
                eq(projectFiles.fileType, "aba_keywords"),
                eq(projectFiles.status, "completed")
              )
            );
          if (a9Files.length > 0 && a9Files[0].analysisResult) {
            try {
              const a9Data = JSON.parse(a9Files[0].analysisResult);
              const titleKws = a9Data.titleMustHaveKeywords || a9Data.titleKeywords || [];
              const bulletKws = a9Data.bulletPointKeywords || a9Data.bulletKeywords || [];
              const goldenKws = a9Data.goldenLongTailKeywords || a9Data.goldenKeywords || [];
              coreKeywords = [
                ...titleKws.map((kw: any) => typeof kw === "string" ? kw : kw.keyword || kw.term || ""),
                ...bulletKws.map((kw: any) => typeof kw === "string" ? kw : kw.keyword || kw.term || ""),
                ...goldenKws.map((kw: any) => typeof kw === "string" ? kw : kw.keyword || kw.term || ""),
              ].filter(Boolean);
            } catch {}
          }
          // Also try keyword table
          if (coreKeywords.length === 0) {
            const kwStats = await db.getKeywordStats(input.projectId);
            if (kwStats.total > 0) {
              const kwList = await db.getKeywordsByProject(input.projectId);
              coreKeywords = kwList
                .filter((k: any) => k.relevance === "high" || k.strategyCategory === "core_must_have")
                .map((k: any) => k.keyword)
                .slice(0, 30);
            }
          }
        }
      } catch {}
      coreKeywords = Array.from(new Set(coreKeywords.map(k => k.toLowerCase())));

      // Build the prompt
      const prompt = promptBuilder(currentContent, input.issues, coreKeywords);

      // Call LLM
      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are an expert Amazon listing optimizer. Return only the optimized content as requested, no explanations." },
          { role: "user", content: prompt },
        ],
      });

      const rawContent = response.choices?.[0]?.message?.content;
      const optimizedContent = typeof rawContent === "string" ? rawContent.trim() : "";
      if (!optimizedContent) throw new Error("AI optimization returned empty result");

      // For bullet points, validate JSON
      if (updateField === "bulletPoints") {
        try {
          const parsed = JSON.parse(optimizedContent);
          if (!parsed.bulletPoints || !Array.isArray(parsed.bulletPoints)) {
            throw new Error("Invalid bullet points format");
          }
        } catch (e: any) {
          // Try to extract JSON from the response
          const jsonMatch = optimizedContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.bulletPoints) {
              await db.updateListing(listing.id, { [updateField]: JSON.stringify(parsed) });
              return { dimension: input.dimension, field: updateField, optimized: true, content: JSON.stringify(parsed) };
            }
          }
          throw new Error("AI returned invalid bullet points JSON: " + e.message);
        }
      }

      // Save optimized content
      await db.updateListing(listing.id, { [updateField]: optimizedContent });

      return {
        dimension: input.dimension,
        field: updateField,
        optimized: true,
        content: optimizedContent,
      };
    }),
});
