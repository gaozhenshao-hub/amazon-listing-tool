import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import { scoreListing } from "../scoringEngine";

// Dimension-specific optimization prompts
const OPTIMIZE_PROMPTS: Record<string, (current: string, issues: string[], keywords: string[]) => string> = {
  "Title Optimization": (current, issues, keywords) => `You are a senior Amazon listing optimization expert with 10 years of experience.

Current product title (TWO-STAGE FORMAT):
${current}

Issues found in scoring:
${issues.map(i => `- ${i}`).join("\n")}

${keywords.length > 0 ? `Core keywords that MUST be included:\n${keywords.slice(0, 20).join(", ")}` : ""}

Requirements (TWO-STAGE TITLE FORMAT - Amazon 2026 Policy):
1. Layer 1 (Title): MUST be ≤75 characters. Contains Brand + Core Keyword + Differentiator.
2. Layer 2 (Item Highlights): MUST be ≤125 characters. Contains specs, scenes, secondary keywords.
3. NO word repetition between Layer 1 and Layer 2.
4. Capitalize first letter of each major word (Title Case)
5. Do NOT use special characters, emojis, or all caps
6. Front-load the most important keywords in Layer 1
7. Fix all the issues listed above

Return the result as JSON: {"title": "Layer 1 text", "itemHighlights": "Layer 2 text"}`,

  "Bullet Points Quality": (current, issues, keywords) => `You are a senior Amazon listing optimization expert with 10 years of experience.

Current bullet points (JSON):
${current}

Issues found in scoring:
${issues.map(i => `- ${i}`).join("\n")}

${keywords.length > 0 ? `Core keywords to incorporate:\n${keywords.slice(0, 20).join(", ")}` : ""}

Requirements:
1. Each bullet point MUST be 200-280 characters (CRITICAL)
2. Each bullet must have a clear subtitle (ALL CAPS) followed by descriptive text
3. 5-9 bullet points (keep the same count as current)
4. Start each with a benefit-driven subtitle
5. Include specific data, numbers, or measurements where possible
6. Distribute keywords naturally across all bullets
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

/**
 * Load keywords from the keywords management module for scoring.
 * Returns structured keyword data categorized by listing placement and strategy.
 */
async function loadKeywordsFromModule(projectId: number): Promise<{
  coreKeywords: string[];
  keywordsByPlacement: {
    titleFront: string[];
    titleMid: string[];
    titleEnd: string[];
    bulletFirst: string[];
    bulletBody: string[];
    aplus: string[];
    searchTerm: string[];
  };
  keywordsByStrategy: {
    coreMain: string[];
    subCore: string[];
    preciseLongtail: string[];
    sceneIntent: string[];
    longtailMain: string[];
  };
  totalKeywords: number;
}> {
  const result = {
    coreKeywords: [] as string[],
    keywordsByPlacement: {
      titleFront: [] as string[],
      titleMid: [] as string[],
      titleEnd: [] as string[],
      bulletFirst: [] as string[],
      bulletBody: [] as string[],
      aplus: [] as string[],
      searchTerm: [] as string[],
    },
    keywordsByStrategy: {
      coreMain: [] as string[],
      subCore: [] as string[],
      preciseLongtail: [] as string[],
      sceneIntent: [] as string[],
      longtailMain: [] as string[],
    },
    totalKeywords: 0,
  };

  try {
    const kwList = await db.getKeywordsByProject(projectId);
    result.totalKeywords = kwList.length;

    if (kwList.length === 0) return result;

    // Sort by search volume (descending) for priority
    const sorted = [...kwList].sort((a, b) => (b.monthlySearchVolume || 0) - (a.monthlySearchVolume || 0));

    // Categorize by listing placement
    for (const kw of sorted) {
      const keyword = kw.keyword;
      switch (kw.listingPlacement) {
        case "title_front":
          result.keywordsByPlacement.titleFront.push(keyword);
          break;
        case "title_mid":
          result.keywordsByPlacement.titleMid.push(keyword);
          break;
        case "title_end":
          result.keywordsByPlacement.titleEnd.push(keyword);
          break;
        case "bullet_first":
          result.keywordsByPlacement.bulletFirst.push(keyword);
          break;
        case "bullet_body":
          result.keywordsByPlacement.bulletBody.push(keyword);
          break;
        case "aplus":
          result.keywordsByPlacement.aplus.push(keyword);
          break;
        case "search_term":
          result.keywordsByPlacement.searchTerm.push(keyword);
          break;
      }
    }

    // Categorize by strategy
    for (const kw of sorted) {
      const keyword = kw.keyword;
      switch (kw.strategyCategory) {
        case "core_main":
          result.keywordsByStrategy.coreMain.push(keyword);
          break;
        case "sub_core":
          result.keywordsByStrategy.subCore.push(keyword);
          break;
        case "precise_longtail":
          result.keywordsByStrategy.preciseLongtail.push(keyword);
          break;
        case "scene_intent":
          result.keywordsByStrategy.sceneIntent.push(keyword);
          break;
        case "longtail_main":
          result.keywordsByStrategy.longtailMain.push(keyword);
          break;
      }
    }

    // Build core keywords list: prioritize by strategy importance
    // 1. Core main keywords (highest priority)
    // 2. Sub-core keywords
    // 3. Title-placement keywords
    // 4. High relevance keywords
    const coreSet = new Set<string>();

    // Add core_main and sub_core first
    for (const kw of result.keywordsByStrategy.coreMain) coreSet.add(kw.toLowerCase());
    for (const kw of result.keywordsByStrategy.subCore) coreSet.add(kw.toLowerCase());

    // Add title placement keywords
    for (const kw of result.keywordsByPlacement.titleFront) coreSet.add(kw.toLowerCase());
    for (const kw of result.keywordsByPlacement.titleMid) coreSet.add(kw.toLowerCase());

    // Add high relevance keywords
    for (const kw of sorted) {
      if (kw.relevance === "high") coreSet.add(kw.keyword.toLowerCase());
    }

    // Add remaining keywords by search volume
    for (const kw of sorted) {
      if (coreSet.size >= 50) break;
      coreSet.add(kw.keyword.toLowerCase());
    }

    result.coreKeywords = Array.from(coreSet);
  } catch (err) {
    console.warn("[Scoring] Failed to load keywords from module:", err);
  }

  return result;
}

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

      // Load keyword data from keywords management module
      const kwData = await loadKeywordsFromModule(input.projectId);

      return scoreListing(
        {
          title: listing.title,
          itemHighlights: listing.itemHighlights,
          bulletPoints: listing.bulletPoints,
          description: listing.description,
          searchTerms: listing.searchTerms,
          titleCn: listing.titleCn,
          itemHighlightsCn: listing.itemHighlightsCn,
          bulletPointsCn: listing.bulletPointsCn,
          descriptionCn: listing.descriptionCn,
          searchTermsCn: listing.searchTermsCn,
          imageAdvice: listing.imageAdvice,
        },
        kwData,
        kwData.coreKeywords
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
          // Pass both layers as JSON for the optimization prompt
          currentContent = JSON.stringify({ title: listing.title || "", itemHighlights: listing.itemHighlights || "" });
          updateField = "title"; // Will handle specially below
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

      // Load keywords from keywords management module
      const kwData = await loadKeywordsFromModule(input.projectId);
      const coreKeywords = kwData.coreKeywords;

      // Build the prompt
      const prompt = promptBuilder(currentContent, input.issues, coreKeywords);

      // Call LLM
      // [Emperor-Ready] 此调用已标记为 Emperor Skill 迁移候选
      // TODO: 替换为对应的 emperorClient 函数调用

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

      // Save optimized content - handle title specially for two-stage format
      if (input.dimension === "Title Optimization") {
        // Parse the JSON response for two-stage title
        try {
          let titleResult: { title: string; itemHighlights: string };
          const jsonMatch = optimizedContent.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            titleResult = JSON.parse(jsonMatch[0]);
          } else {
            // Fallback: treat as single title (legacy)
            titleResult = { title: optimizedContent.slice(0, 75), itemHighlights: optimizedContent.slice(75) };
          }
          await db.updateListing(listing.id, {
            title: titleResult.title || optimizedContent,
            itemHighlights: titleResult.itemHighlights || null,
          });
        } catch {
          // Fallback: save as title only
          await db.updateListing(listing.id, { title: optimizedContent });
        }
      } else {
        await db.updateListing(listing.id, { [updateField]: optimizedContent });
      }

      // Save version snapshot after optimization
      try {
        const updatedListing = await db.getListingById(listing.id);
        if (updatedListing) {
          const dimMap: Record<string, string> = { "Title Optimization": "标题", "Bullet Points Quality": "卖点", "Description Quality": "描述", "Search Terms Optimization": "搜索词" };
          const latestVer = await db.getLatestListingVersionNumber(listing.id);
          await db.createListingVersion({
            listingId: listing.id,
            projectId: updatedListing.projectId,
            userId: ctx.user.id,
            versionNumber: latestVer + 1,
            changeType: "optimize",
            changeDescription: `AI优化: ${dimMap[input.dimension] || input.dimension}`,
            title: updatedListing.title || null,
            itemHighlights: updatedListing.itemHighlights || null,
            bulletPoints: updatedListing.bulletPoints || null,
            description: updatedListing.description || null,
            searchTerms: updatedListing.searchTerms || null,
            titleCn: updatedListing.titleCn || null,
            itemHighlightsCn: updatedListing.itemHighlightsCn || null,
            bulletPointsCn: updatedListing.bulletPointsCn || null,
            descriptionCn: updatedListing.descriptionCn || null,
            searchTermsCn: updatedListing.searchTermsCn || null,
          });
        }
      } catch (err) {
        console.error("Failed to save version after optimization:", err);
      }

      return {
        dimension: input.dimension,
        field: updateField,
        optimized: true,
        content: optimizedContent,
      };
    }),
});
