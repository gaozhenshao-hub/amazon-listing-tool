import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import {
  getKeywordsByProject,
  updateKeyword,
  createNegativeKeyword,
  getProjectById,
} from "../db";
import {
  KEYWORD_SEMANTIC_FILTER_PROMPT,
  KEYWORD_SCENE_TAG_PROMPT,
  KEYWORD_ROOT_CLASSIFY_PROMPT,
  KEYWORD_STRATEGY_MATRIX_PROMPT,
  KEYWORD_LISTING_LAYOUT_PROMPT,
  KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT,
} from "../keywordPrompts";
import { buildProductContext, chunkArray } from "./keywordHelpers";

export const keywordAiRouter = router({
  // ─── AI Semantic Filter (Step 5) ────────────────────────────

  aiSemanticFilter: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keywordIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, keywordIds } = input;
      const project = await getProjectById(projectId, ctx.user!.id);
      if (!project) throw new Error("项目不存在");

      const allKeywords = await getKeywordsByProject(projectId);
      const toFilter = keywordIds
        ? allKeywords.filter(k => keywordIds.includes(k.id) && k.skipSemanticFilter !== 1)
        : allKeywords.filter(k => (k.status === "raw" || k.status === "cleaned") && k.skipSemanticFilter !== 1);

      // Auto-advance keywords that should skip semantic filter (restored from negative library)
      const skippedKws = keywordIds
        ? allKeywords.filter(k => keywordIds.includes(k.id) && k.skipSemanticFilter === 1)
        : allKeywords.filter(k => (k.status === "raw" || k.status === "cleaned") && k.skipSemanticFilter === 1);
      for (const kw of skippedKws) {
        await updateKeyword(kw.id, { status: "cleaned" });
      }

      if (toFilter.length === 0) return { filtered: 0, kept: 0, removed: 0 };

      const productContext = buildProductContext(project);
      const chunks = chunkArray(toFilter, 30);
      let kept = 0, removed = 0;

      for (const chunk of chunks) {
        const kwList = chunk.map(k => k.keyword).join("\n");
        const prompt = KEYWORD_SEMANTIC_FILTER_PROMPT
          .replace("{productContext}", productContext)
          .replace("{keywords}", kwList);

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "You are an Amazon keyword specialist. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
          });

          const content = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(content);
          const results = parsed.results || [];

          for (const result of results) {
            const kw = chunk.find(k => k.keyword.toLowerCase() === result.keyword?.toLowerCase());
            if (!kw) continue;

            if (result.action === "remove") {
              await updateKeyword(kw.id, {
                status: "negative",
                isNegative: 1,
                relevance: "none",
              });
              await createNegativeKeyword({
                projectId,
                userId: ctx.user!.id,
                keyword: kw.keyword,
                reason: result.reason || "AI语义过滤移除",
                reasonCn: result.reason ? `AI语义过滤: ${result.reason}` : "AI语义过滤移除",
                source: "ai_suggest",
                matchType: "exact",
              });
              removed++;
            } else {
              const newRelevance = result.relevance || kw.relevance;
              await updateKeyword(kw.id, {
                status: "cleaned",
                relevance: newRelevance,
              });
              kept++;
            }
          }
        } catch (e) {
          console.error("AI semantic filter error:", e);
        }
      }

      return { filtered: toFilter.length, kept, removed };
    }),

  // ─── AI Scene Tagging (COSMO) ───────────────────────────────

  aiSceneTag: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keywordIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, keywordIds } = input;
      const project = await getProjectById(projectId, ctx.user!.id);
      if (!project) throw new Error("项目不存在");

      const allKeywords = await getKeywordsByProject(projectId);
      const toTag = keywordIds
        ? allKeywords.filter(k => keywordIds.includes(k.id))
        : allKeywords.filter(k => k.status === "cleaned" || k.status === "scored");

      if (toTag.length === 0) return { tagged: 0 };

      const productContext = buildProductContext(project);
      const chunks = chunkArray(toTag, 30);
      let tagged = 0;

      for (const chunk of chunks) {
        const kwList = chunk.map(k => k.keyword).join("\n");
        const prompt = KEYWORD_SCENE_TAG_PROMPT
          .replace("{productContext}", productContext)
          .replace("{keywords}", kwList);

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "You are an Amazon COSMO algorithm specialist. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
          });

          const content = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(content);
          const results = parsed.results || [];

          for (const result of results) {
            const kw = chunk.find(k => k.keyword.toLowerCase() === result.keyword?.toLowerCase());
            if (!kw) continue;

            await updateKeyword(kw.id, {
              sceneTags: JSON.stringify(result.sceneTags || []),
              intentTag: result.intentTag || null,
              status: "tagged",
            });
            tagged++;
          }
        } catch (e) {
          console.error("AI scene tag error:", e);
        }
      }

      return { tagged };
    }),

  // ─── AI Word Root Classification ────────────────────────────

  aiRootClassify: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keywordIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, keywordIds } = input;
      const project = await getProjectById(projectId, ctx.user!.id);
      if (!project) throw new Error("项目不存在");

      const allKeywords = await getKeywordsByProject(projectId);
      const toClassify = keywordIds
        ? allKeywords.filter(k => keywordIds.includes(k.id))
        : allKeywords.filter(k => k.isNegative === 0);

      if (toClassify.length === 0) return { classified: 0 };

      const productContext = buildProductContext(project);
      const chunks = chunkArray(toClassify, 30);
      let classified = 0;

      for (const chunk of chunks) {
        const kwList = chunk.map(k => k.keyword).join("\n");
        const prompt = KEYWORD_ROOT_CLASSIFY_PROMPT
          .replace("{productContext}", productContext)
          .replace("{keywords}", kwList);

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "You are an Amazon SEO expert. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
          });

          const content = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(content);
          const results = parsed.results || [];

          for (const result of results) {
            const kw = chunk.find(k => k.keyword.toLowerCase() === result.keyword?.toLowerCase());
            if (!kw) continue;

            await updateKeyword(kw.id, {
              rootWord: result.rootWord || null,
              rootCategory: result.rootCategory || null,
              rootImpact: result.rootImpact || null,
            });
            classified++;
          }
        } catch (e) {
          console.error("AI root classify error:", e);
        }
      }

      return { classified };
    }),

  // ─── AI 3D Strategy Matrix ──────────────────────────────────

  aiStrategyMatrix: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keywordIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, keywordIds } = input;
      const project = await getProjectById(projectId, ctx.user!.id);
      if (!project) throw new Error("项目不存在");

      const allKeywords = await getKeywordsByProject(projectId);
      const toMatrix = keywordIds
        ? allKeywords.filter(k => keywordIds.includes(k.id))
        : allKeywords.filter(k => k.isNegative === 0);

      if (toMatrix.length === 0) return { categorized: 0 };

      const productContext = buildProductContext(project);
      const chunks = chunkArray(toMatrix, 25);
      let categorized = 0;

      for (const chunk of chunks) {
        const kwList = chunk.map(k => {
          return `${k.keyword} | traffic: ${k.trafficLevel} | relevance: ${k.relevance} | competition: ${k.competition} | SPR: ${k.spr || "N/A"} | monthly_search: ${k.monthlySearchVolume || "N/A"}`;
        }).join("\n");

        const prompt = KEYWORD_STRATEGY_MATRIX_PROMPT
          .replace("{productContext}", productContext)
          .replace("{keywords}", kwList);

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "You are an Amazon advertising strategist. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
          });

          const content = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(content);
          const results = parsed.results || [];

          for (const result of results) {
            const kw = chunk.find(k => k.keyword.toLowerCase() === result.keyword?.toLowerCase());
            if (!kw) continue;

            const updateData: any = {
              strategyCategory: result.strategyCategory || null,
              listingPlacement: result.listingPlacement || null,
              status: "finalized",
            };

            if (result.strategyCategory === "negative") {
              updateData.isNegative = 1;
              updateData.status = "negative";
              await createNegativeKeyword({
                projectId,
                userId: ctx.user!.id,
                keyword: kw.keyword,
                reason: "3D矩阵分析标记为否定词",
                source: "ai_suggest",
                matchType: "exact",
              });
            }

            await updateKeyword(kw.id, updateData);
            categorized++;
          }
        } catch (e) {
          console.error("AI strategy matrix error:", e);
        }
      }

      return { categorized };
    }),

  // ─── AI Listing Layout Suggestion ───────────────────────────

  aiListingLayout: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const { projectId } = input;
      const project = await getProjectById(projectId, ctx.user!.id);
      if (!project) throw new Error("项目不存在");

      const allKeywords = await getKeywordsByProject(projectId);
      if (allKeywords.length === 0) throw new Error("没有关键词数据，请先导入关键词");

      const productContext = buildProductContext(project);

      // Build root classification summary
      const rootGroups: Record<string, string[]> = {};
      for (const kw of allKeywords) {
        if (kw.rootCategory) {
          if (!rootGroups[kw.rootCategory]) rootGroups[kw.rootCategory] = [];
          rootGroups[kw.rootCategory].push(kw.keyword);
        }
      }
      const rootClassification = Object.entries(rootGroups)
        .map(([cat, kws]) => `${cat}: ${kws.slice(0, 10).join(", ")}${kws.length > 10 ? ` (+${kws.length - 10} more)` : ""}`)
        .join("\n");

      // Build strategy matrix summary
      const stratGroups: Record<string, string[]> = {};
      for (const kw of allKeywords) {
        if (kw.strategyCategory) {
          if (!stratGroups[kw.strategyCategory]) stratGroups[kw.strategyCategory] = [];
          stratGroups[kw.strategyCategory].push(kw.keyword);
        }
      }
      const strategyMatrix = Object.entries(stratGroups)
        .map(([cat, kws]) => `${cat}: ${kws.slice(0, 8).join(", ")}${kws.length > 8 ? ` (+${kws.length - 8} more)` : ""}`)
        .join("\n");

      const prompt = KEYWORD_LISTING_LAYOUT_PROMPT
        .replace("{productContext}", productContext)
        .replace("{rootClassification}", rootClassification || "No root classification data")
        .replace("{strategyMatrix}", strategyMatrix || "No strategy matrix data");

      const response = await invokeLLM({
        messages: [
          { role: "system", content: "You are an Amazon Listing optimization expert. Respond only in valid JSON. CRITICAL: All keyword fields must contain the exact original English keywords from the input. Never translate keywords." },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
      });

      const content = String(response.choices?.[0]?.message?.content || "{}");
      return JSON.parse(content);
    }),

  // ─── Run Full Pipeline ──────────────────────────────────────
  // Runs all AI steps sequentially: traffic/competition classify → filter → tag → classify → matrix
  runFullPipeline: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }): Promise<{
      trafficCompetition: { classified: number; thresholds: any };
      filter: { filtered: number; kept: number; removed: number };
      tag: { tagged: number };
      classify: { classified: number };
      matrix: { categorized: number };
    }> => {
      const { projectId } = input;
      const project = await getProjectById(projectId, ctx.user!.id);
      if (!project) throw new Error("项目不存在");

      const allKeywords = await getKeywordsByProject(projectId);
      const productContext = buildProductContext(project);

      // Step 0: AI Traffic & Competition Classification
      let tcClassified = 0;
      let tcThresholds: any = null;
      const kwsWithData = allKeywords.filter(k => k.isNegative === 0 && ((k.monthlySearchVolume && k.monthlySearchVolume > 0) || (k.spr && k.spr > 0)));
      if (kwsWithData.length > 0) {
        const tcChunks = chunkArray(kwsWithData, 50);
        for (const chunk of tcChunks) {
          const kwData = chunk.map(k => `${k.keyword} | ${k.monthlySearchVolume || "N/A"} | ${k.spr || "N/A"}`).join("\n");
          const prompt = KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT.replace("{productContext}", productContext).replace("{keywordsData}", kwData);
          try {
            const resp = await invokeLLM({ messages: [{ role: "system", content: "You are an Amazon keyword data analyst. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." }, { role: "user", content: prompt }], response_format: { type: "json_object" } });
            const parsed = JSON.parse(String(resp.choices?.[0]?.message?.content || "{}"));
            if (parsed.analysis) tcThresholds = parsed.analysis;
            for (const r of (parsed.results || [])) {
              const kw = chunk.find(k => k.keyword.toLowerCase() === r.keyword?.toLowerCase());
              if (!kw) continue;
              const upd: any = {};
              if (r.trafficLevel && ["high", "medium", "low"].includes(r.trafficLevel)) upd.trafficLevel = r.trafficLevel;
              if (r.competition && ["high", "medium", "low"].includes(r.competition)) upd.competition = r.competition;
              if (Object.keys(upd).length > 0) { await updateKeyword(kw.id, upd); tcClassified++; }
            }
          } catch (e) { console.error("Pipeline traffic/competition classify error:", e); }
        }
      }

      // Step 1: AI Semantic Filter
      let kept = 0, removed = 0;
      const rawKws = allKeywords.filter(k => k.status === "raw" || k.status === "cleaned");
      const filterChunks = chunkArray(rawKws, 30);
      for (const chunk of filterChunks) {
        const kwList = chunk.map(k => k.keyword).join("\n");
        const prompt = KEYWORD_SEMANTIC_FILTER_PROMPT.replace("{productContext}", productContext).replace("{keywords}", kwList);
        try {
          const resp = await invokeLLM({ messages: [{ role: "system", content: "You are an Amazon keyword specialist. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." }, { role: "user", content: prompt }], response_format: { type: "json_object" } });
          const parsed = JSON.parse(String(resp.choices?.[0]?.message?.content || "{}"));
          for (const r of (parsed.results || [])) {
            const kw = chunk.find(k => k.keyword.toLowerCase() === r.keyword?.toLowerCase());
            if (!kw) continue;
            if (r.action === "remove") {
              await updateKeyword(kw.id, { status: "negative", isNegative: 1, relevance: "none" });
              await createNegativeKeyword({ projectId, userId: ctx.user!.id, keyword: kw.keyword, reason: r.reason || "AI语义过滤移除", reasonCn: r.reason ? `AI语义过滤: ${r.reason}` : "AI语义过滤移除", source: "ai_suggest", matchType: "exact" });
              removed++;
            } else {
              await updateKeyword(kw.id, { status: "cleaned", relevance: r.relevance || kw.relevance });
              kept++;
            }
          }
        } catch (e) { console.error("Pipeline filter error:", e); }
      }

      // Step 2: AI Scene Tagging
      let tagged = 0;
      const cleanedKws = (await getKeywordsByProject(projectId)).filter(k => k.status === "cleaned" || k.status === "scored");
      const tagChunks = chunkArray(cleanedKws, 30);
      for (const chunk of tagChunks) {
        const kwList = chunk.map(k => k.keyword).join("\n");
        const prompt = KEYWORD_SCENE_TAG_PROMPT.replace("{productContext}", productContext).replace("{keywords}", kwList);
        try {
          const resp = await invokeLLM({ messages: [{ role: "system", content: "You are an Amazon COSMO algorithm specialist. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." }, { role: "user", content: prompt }], response_format: { type: "json_object" } });
          const parsed = JSON.parse(String(resp.choices?.[0]?.message?.content || "{}"));
          for (const r of (parsed.results || [])) {
            const kw = chunk.find(k => k.keyword.toLowerCase() === r.keyword?.toLowerCase());
            if (!kw) continue;
            await updateKeyword(kw.id, { sceneTags: JSON.stringify(r.sceneTags || []), intentTag: r.intentTag || null, status: "tagged" });
            tagged++;
          }
        } catch (e) { console.error("Pipeline tag error:", e); }
      }

      // Step 3: AI Root Classification
      let classified = 0;
      const taggedKws = (await getKeywordsByProject(projectId)).filter(k => k.isNegative === 0);
      const classChunks = chunkArray(taggedKws, 30);
      for (const chunk of classChunks) {
        const kwList = chunk.map(k => k.keyword).join("\n");
        const prompt = KEYWORD_ROOT_CLASSIFY_PROMPT.replace("{productContext}", productContext).replace("{keywords}", kwList);
        try {
          const resp = await invokeLLM({ messages: [{ role: "system", content: "You are an Amazon SEO expert. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." }, { role: "user", content: prompt }], response_format: { type: "json_object" } });
          const parsed = JSON.parse(String(resp.choices?.[0]?.message?.content || "{}"));
          for (const r of (parsed.results || [])) {
            const kw = chunk.find(k => k.keyword.toLowerCase() === r.keyword?.toLowerCase());
            if (!kw) continue;
            await updateKeyword(kw.id, { rootWord: r.rootWord || null, rootCategory: r.rootCategory || null, rootImpact: r.rootImpact || null });
            classified++;
          }
        } catch (e) { console.error("Pipeline classify error:", e); }
      }

      // Step 4: AI Strategy Matrix
      let categorized = 0;
      const allKwsFinal = (await getKeywordsByProject(projectId)).filter(k => k.isNegative === 0);
      const matrixChunks = chunkArray(allKwsFinal, 25);
      for (const chunk of matrixChunks) {
        const kwList = chunk.map(k => `${k.keyword} | traffic: ${k.trafficLevel} | relevance: ${k.relevance} | competition: ${k.competition} | SPR: ${k.spr || "N/A"} | monthly_search: ${k.monthlySearchVolume || "N/A"}`).join("\n");
        const prompt = KEYWORD_STRATEGY_MATRIX_PROMPT.replace("{productContext}", productContext).replace("{keywords}", kwList);
        try {
          const resp = await invokeLLM({ messages: [{ role: "system", content: "You are an Amazon advertising strategist. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." }, { role: "user", content: prompt }], response_format: { type: "json_object" } });
          const parsed = JSON.parse(String(resp.choices?.[0]?.message?.content || "{}"));
          for (const r of (parsed.results || [])) {
            const kw = chunk.find(k => k.keyword.toLowerCase() === r.keyword?.toLowerCase());
            if (!kw) continue;
            const updateData: any = { strategyCategory: r.strategyCategory || null, listingPlacement: r.listingPlacement || null, status: "finalized" as const };
            if (r.strategyCategory === "negative") {
              updateData.isNegative = 1;
              updateData.status = "negative";
              await createNegativeKeyword({ projectId, userId: ctx.user!.id, keyword: kw.keyword, reason: "3D matrix analysis marked as negative", reasonCn: "3D矩阵分析标记为否定词", source: "ai_suggest", matchType: "exact" });
            }
            await updateKeyword(kw.id, updateData);
            categorized++;
          }
        } catch (e) { console.error("Pipeline matrix error:", e); }
      }

      return {
        trafficCompetition: { classified: tcClassified, thresholds: tcThresholds },
        filter: { filtered: rawKws.length, kept, removed },
        tag: { tagged },
        classify: { classified },
        matrix: { categorized },
      };
    }),

  // ─── AI Traffic & Competition Classification ──────────────
  // Uses AI to intelligently classify traffic level and competition
  // based on the overall data distribution (not fixed thresholds)
  aiClassifyTrafficCompetition: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keywordIds: z.array(z.number()).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, keywordIds } = input;
      const project = await getProjectById(projectId, ctx.user!.id);
      if (!project) throw new Error("项目不存在");

      const allKeywords = await getKeywordsByProject(projectId);
      const toClassify = keywordIds
        ? allKeywords.filter(k => keywordIds.includes(k.id))
        : allKeywords.filter(k => k.isNegative === 0);

      if (toClassify.length === 0) return { classified: 0, thresholds: null };

      // Collect all search volumes and SPRs for distribution analysis
      const searchVolumes = toClassify
        .map(k => k.monthlySearchVolume)
        .filter((v): v is number => v != null && v > 0);
      const sprs = toClassify
        .map(k => k.spr)
        .filter((v): v is number => v != null && v > 0);

      // If no numeric data at all, skip AI and keep defaults
      if (searchVolumes.length === 0 && sprs.length === 0) {
        return { classified: 0, thresholds: null, reason: "No search volume or SPR data available" };
      }

      const productContext = buildProductContext(project);
      const chunks = chunkArray(toClassify, 50);
      let classifiedCount = 0;
      let thresholds: any = null;

      for (const chunk of chunks) {
        const kwData = chunk.map(k =>
          `${k.keyword} | ${k.monthlySearchVolume || "N/A"} | ${k.spr || "N/A"}`
        ).join("\n");

        const prompt = KEYWORD_TRAFFIC_COMPETITION_CLASSIFY_PROMPT
          .replace("{productContext}", productContext)
          .replace("{keywordsData}", kwData);

        try {
          const response = await invokeLLM({
            messages: [
              { role: "system", content: "You are an Amazon keyword data analyst. Respond only in valid JSON. CRITICAL: The keyword field must contain the exact original English keyword from the input. Never translate keywords." },
              { role: "user", content: prompt },
            ],
            response_format: { type: "json_object" },
          });

          const content = String(response.choices?.[0]?.message?.content || "{}");
          const parsed = JSON.parse(content);

          if (parsed.analysis) {
            thresholds = parsed.analysis;
          }

          for (const result of (parsed.results || [])) {
            const kw = chunk.find(k => k.keyword.toLowerCase() === result.keyword?.toLowerCase());
            if (!kw) continue;

            const updateData: any = {};
            if (result.trafficLevel && ["high", "medium", "low"].includes(result.trafficLevel)) {
              updateData.trafficLevel = result.trafficLevel;
            }
            if (result.competition && ["high", "medium", "low"].includes(result.competition)) {
              updateData.competition = result.competition;
            }

            if (Object.keys(updateData).length > 0) {
              await updateKeyword(kw.id, updateData);
              classifiedCount++;
            }
          }
        } catch (e) {
          console.error("AI traffic/competition classify error:", e);
        }
      }

      return { classified: classifiedCount, thresholds };
    }),
});
