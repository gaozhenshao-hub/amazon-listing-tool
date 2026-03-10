import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import {
  createKeyword, bulkCreateKeywords, getKeywordsByProject,
  getKeywordById, updateKeyword, bulkUpdateKeywords,
  deleteKeyword, deleteKeywordsByProject, getKeywordStats,
  createNegativeKeyword, bulkCreateNegativeKeywords,
  getNegativeKeywordsByProject, deleteNegativeKeyword,
  deleteNegativeKeywordsByProject, getProjectById,
} from "../db";
import {
  KEYWORD_SEMANTIC_FILTER_PROMPT,
  KEYWORD_SCENE_TAG_PROMPT,
  KEYWORD_ROOT_CLASSIFY_PROMPT,
  KEYWORD_STRATEGY_MATRIX_PROMPT,
  KEYWORD_LISTING_LAYOUT_PROMPT,
} from "../keywordPrompts";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";

// Helper: build product context string for AI prompts
function buildProductContext(project: any): string {
  const parts: string[] = [];
  if (project.name) parts.push(`Product: ${project.name}`);
  if (project.brand) parts.push(`Brand: ${project.brand}`);
  if (project.productName) parts.push(`Product Name: ${project.productName}`);
  if (project.category) parts.push(`Category: ${project.category}`);
  if (project.targetMarket) parts.push(`Target Market: ${project.targetMarket}`);
  if (project.productFeatures) {
    try {
      const features = JSON.parse(project.productFeatures);
      parts.push(`Features: ${features.join(", ")}`);
    } catch { /* ignore */ }
  }
  return parts.join("\n");
}

// Helper: chunk array for batch AI processing
function chunkArray<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

export const keywordRouter = router({
  // ─── CRUD Operations ────────────────────────────────────────

  // List all keywords for a project
  list: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return getKeywordsByProject(input.projectId);
    }),

  // Get keyword stats
  stats: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return getKeywordStats(input.projectId);
    }),

  // Add single keyword manually
  add: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keyword: z.string().min(1),
      source: z.enum(["manual", "csv_import", "asin_reverse", "search_suggest", "review_extract", "ai_expand"]).default("manual"),
      relevance: z.enum(["high", "medium", "low", "none"]).optional(),
      monthlySearchVolume: z.number().optional(),
      spr: z.number().optional(),
      ppcBid: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      return createKeyword({
        ...input,
        userId: ctx.user!.id,
      });
    }),

  // Update a keyword
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      relevance: z.enum(["high", "medium", "low", "none"]).optional(),
      trafficLevel: z.enum(["high", "medium", "low"]).optional(),
      competition: z.enum(["high", "medium", "low"]).optional(),
      monthlySearchVolume: z.number().nullable().optional(),
      spr: z.number().nullable().optional(),
      ppcBid: z.string().nullable().optional(),
      sceneTags: z.string().nullable().optional(),
      intentTag: z.string().nullable().optional(),
      rootCategory: z.enum(["core", "function", "scene", "audience", "spec", "painpoint", "gift_holiday"]).nullable().optional(),
      rootWord: z.string().nullable().optional(),
      rootImpact: z.enum(["high", "medium", "low"]).nullable().optional(),
      strategyCategory: z.enum(["core_main", "sub_core", "precise_longtail", "scene_intent", "longtail_main", "observe_test", "negative"]).nullable().optional(),
      listingPlacement: z.enum(["title_front", "title_mid", "title_end", "bullet_first", "bullet_body", "aplus", "search_term", "not_use"]).nullable().optional(),
      status: z.enum(["raw", "cleaned", "scored", "tagged", "finalized", "negative"]).optional(),
      isNegative: z.number().optional(),
    }))
    .mutation(async ({ input }) => {
      const { id, ...data } = input;
      return updateKeyword(id, data);
    }),

  // Delete a keyword
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return deleteKeyword(input.id);
    }),

  // Bulk delete keywords
  bulkDelete: protectedProcedure
    .input(z.object({ ids: z.array(z.number()) }))
    .mutation(async ({ input }) => {
      for (const id of input.ids) {
        await deleteKeyword(id);
      }
      return { success: true, count: input.ids.length };
    }),

  // Clear all keywords for a project
  clearAll: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }) => {
      return deleteKeywordsByProject(input.projectId);
    }),

  // ─── CSV / XLSX Import ──────────────────────────────────────

  importCsv: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      csvContent: z.string(),
      source: z.enum(["csv_import", "asin_reverse", "search_suggest"]).default("csv_import"),
      sourceDetail: z.string().optional(),
      isXlsx: z.boolean().optional(), // true when csvContent is base64-encoded XLSX
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, csvContent, source, sourceDetail, isXlsx } = input;
      const userId = ctx.user!.id;

      let records: any[];

      if (isXlsx) {
        // Parse XLSX from base64
        try {
          const buffer = Buffer.from(csvContent, "base64");
          const workbook = XLSX.read(buffer, { type: "buffer" });
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) throw new Error("XLSX文件中没有工作表");
          const sheet = workbook.Sheets[sheetName];
          records = XLSX.utils.sheet_to_json(sheet, { defval: "" });
        } catch (e: any) {
          throw new Error(`XLSX解析失败: ${e.message}`);
        }
      } else {
        // Parse CSV
        try {
          records = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            bom: true,
            relax_column_count: true,
          });
        } catch (e: any) {
          throw new Error(`CSV解析失败: ${e.message}`);
        }
      }

      if (records.length === 0) {
        throw new Error(isXlsx ? "XLSX文件为空或格式不正确" : "CSV文件为空或格式不正确");
      }

      // Detect column mapping (support both Chinese and English headers)
      const cols = Object.keys(records[0]);
      const colMap = detectColumnMapping(cols);

      const keywordsToInsert = records.map((row: any) => {
        const keyword = getColumnValue(row, colMap.keyword);
        if (!keyword) return null;

        const monthlySearchVolume = parseInt(getColumnValue(row, colMap.searchVolume) || "0") || undefined;
        const spr = parseInt(getColumnValue(row, colMap.spr) || "0") || undefined;
        const ppcBid = getColumnValue(row, colMap.ppcBid) || undefined;
        const naturalRank = parseInt(getColumnValue(row, colMap.naturalRank) || "0") || undefined;
        const trafficScore = parseInt(getColumnValue(row, colMap.trafficScore) || "0") || undefined;

        // Auto-determine traffic level from search volume
        let trafficLevel: "high" | "medium" | "low" = "medium";
        if (monthlySearchVolume) {
          if (monthlySearchVolume >= 10000) trafficLevel = "high";
          else if (monthlySearchVolume >= 1000) trafficLevel = "medium";
          else trafficLevel = "low";
        }

        // Auto-determine competition from SPR
        let competition: "high" | "medium" | "low" = "medium";
        if (spr) {
          if (spr < 30) competition = "low";
          else if (spr < 100) competition = "medium";
          else competition = "high";
        }

        // Detect relevance from CSV if available
        let relevance: "high" | "medium" | "low" | "none" = "medium";
        const relVal = getColumnValue(row, colMap.relevance);
        if (relVal) {
          const lower = relVal.toLowerCase();
          if (lower.includes("强") || lower.includes("high") || lower.includes("强相关")) relevance = "high";
          else if (lower.includes("高") || lower.includes("高相关")) relevance = "high";
          else if (lower.includes("中") || lower.includes("medium") || lower.includes("中相关")) relevance = "medium";
          else if (lower.includes("极低") || lower.includes("none") || lower.includes("极低相关")) relevance = "none";
          else if (lower.includes("低") || lower.includes("low") || lower.includes("低相关")) relevance = "low";
        }

        return {
          projectId,
          userId,
          keyword: keyword.trim(),
          source,
          sourceDetail: sourceDetail || undefined,
          relevance,
          trafficLevel,
          competition,
          monthlySearchVolume,
          spr,
          ppcBid,
          naturalRank,
          trafficScore,
          status: "raw" as const,
          isNegative: 0,
        };
      }).filter(Boolean) as any[];

      if (keywordsToInsert.length === 0) {
        throw new Error("未找到有效的关键词数据");
      }

      // Bulk insert in batches of 100
      const batches = chunkArray(keywordsToInsert, 100);
      let totalInserted = 0;
      for (const batch of batches) {
        await bulkCreateKeywords(batch);
        totalInserted += batch.length;
      }

      return {
        success: true,
        imported: totalInserted,
        columns: cols,
        detectedMapping: colMap,
      };
    }),

  // ─── AI Semantic Filter (Step 5) ────────────────────────────

  aiSemanticFilter: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keywordIds: z.array(z.number()).optional(), // if empty, filter all raw keywords
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, keywordIds } = input;
      const project = await getProjectById(projectId, ctx.user!.id);
      if (!project) throw new Error("项目不存在");

      const allKeywords = await getKeywordsByProject(projectId);
      const toFilter = keywordIds
        ? allKeywords.filter(k => keywordIds.includes(k.id))
        : allKeywords.filter(k => k.status === "raw" || k.status === "cleaned");

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
              // Also add to negative keywords library
              await createNegativeKeyword({
                projectId,
                userId: ctx.user!.id,
                keyword: kw.keyword,
                reason: result.reason || "AI语义过滤移除",
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

            // If categorized as negative, mark it
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
  // Runs all AI steps sequentially: filter → tag → classify → matrix
  // Returns a summary of each step's results
  runFullPipeline: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }): Promise<{
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
              await createNegativeKeyword({ projectId, userId: ctx.user!.id, keyword: kw.keyword, reason: r.reason || "AI语义过滤移除", source: "ai_suggest", matchType: "exact" });
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
              await createNegativeKeyword({ projectId, userId: ctx.user!.id, keyword: kw.keyword, reason: "3D矩阵分析标记为否定词", source: "ai_suggest", matchType: "exact" });
            }
            await updateKeyword(kw.id, updateData);
            categorized++;
          }
        } catch (e) { console.error("Pipeline matrix error:", e); }
      }

      return {
        filter: { filtered: rawKws.length, kept, removed },
        tag: { tagged },
        classify: { classified },
        matrix: { categorized },
      };
    }),

  // ─── Negative Keywords ──────────────────────────────────────

  negativeList: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      return getNegativeKeywordsByProject(input.projectId);
    }),

  addNegative: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      keyword: z.string().min(1),
      isRoot: z.number().default(0),
      reason: z.string().optional(),
      matchType: z.enum(["exact", "phrase", "broad"]).default("exact"),
    }))
    .mutation(async ({ ctx, input }) => {
      return createNegativeKeyword({
        ...input,
        userId: ctx.user!.id,
        source: "manual",
      });
    }),

  deleteNegative: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return deleteNegativeKeyword(input.id);
    }),

  clearNegatives: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input }) => {
      return deleteNegativeKeywordsByProject(input.projectId);
    }),

  // Move keyword to negative list
  moveToNegative: protectedProcedure
    .input(z.object({
      keywordId: z.number(),
      reason: z.string().optional(),
      matchType: z.enum(["exact", "phrase", "broad"]).default("exact"),
    }))
    .mutation(async ({ ctx, input }) => {
      const kw = await getKeywordById(input.keywordId);
      if (!kw) throw new Error("关键词不存在");

      // Mark as negative in keywords table
      await updateKeyword(kw.id, {
        status: "negative",
        isNegative: 1,
      });

      // Add to negative keywords library
      return createNegativeKeyword({
        projectId: kw.projectId,
        userId: ctx.user!.id,
        keyword: kw.keyword,
        reason: input.reason || "手动移入否定词库",
        source: "manual",
        matchType: input.matchType,
      });
    }),

  // Bulk update (for manual scoring adjustments)
  bulkUpdate: protectedProcedure
    .input(z.object({
      ids: z.array(z.number()),
      data: z.object({
        relevance: z.enum(["high", "medium", "low", "none"]).optional(),
        trafficLevel: z.enum(["high", "medium", "low"]).optional(),
        competition: z.enum(["high", "medium", "low"]).optional(),
        status: z.enum(["raw", "cleaned", "scored", "tagged", "finalized", "negative"]).optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      return bulkUpdateKeywords(input.ids, input.data);
    }),
});

// ─── CSV Column Detection Helpers ─────────────────────────────

interface ColumnMapping {
  keyword: string[];
  searchVolume: string[];
  spr: string[];
  ppcBid: string[];
  naturalRank: string[];
  trafficScore: string[];
  relevance: string[];
}

function detectColumnMapping(cols: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    keyword: [],
    searchVolume: [],
    spr: [],
    ppcBid: [],
    naturalRank: [],
    trafficScore: [],
    relevance: [],
  };

  for (const col of cols) {
    const lower = col.toLowerCase().trim();
    // Keyword column
    if (lower.includes("keyword") || lower.includes("关键词") || lower.includes("搜索词") || lower.includes("search term") || lower === "词") {
      mapping.keyword.push(col);
    }
    // Search volume
    if (lower.includes("search volume") || lower.includes("搜索量") || lower.includes("月搜索量") || lower.includes("monthly") || lower.includes("searches")) {
      mapping.searchVolume.push(col);
    }
    // SPR
    if (lower.includes("spr") || lower.includes("product rank") || lower.includes("推广难度")) {
      mapping.spr.push(col);
    }
    // PPC Bid
    if (lower.includes("ppc") || lower.includes("bid") || lower.includes("竞价") || lower.includes("cpc") || lower.includes("广告费")) {
      mapping.ppcBid.push(col);
    }
    // Natural rank
    if (lower.includes("rank") || lower.includes("排名") || lower.includes("自然排名") || lower.includes("organic")) {
      if (!lower.includes("spr") && !lower.includes("product rank")) {
        mapping.naturalRank.push(col);
      }
    }
    // Traffic score
    if (lower.includes("traffic") || lower.includes("流量") || lower.includes("得分") || lower.includes("score")) {
      mapping.trafficScore.push(col);
    }
    // Relevance
    if (lower.includes("relevance") || lower.includes("相关") || lower.includes("相关性") || lower.includes("关联")) {
      mapping.relevance.push(col);
    }
  }

  return mapping;
}

function getColumnValue(row: any, possibleCols: string[]): string | undefined {
  for (const col of possibleCols) {
    if (row[col] !== undefined && row[col] !== null && row[col] !== "") {
      return String(row[col]);
    }
  }
  return undefined;
}
