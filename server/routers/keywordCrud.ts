import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import {
  createKeyword, bulkCreateKeywords, getKeywordsByProject,
  updateKeyword, bulkUpdateKeywords,
  deleteKeyword, deleteKeywordsByProject, getKeywordStats,
  createNegativeKeyword,
  getNegativeKeywordsByProject, deleteNegativeKeyword,
  deleteNegativeKeywordsByProject, getKeywordById,
} from "../db";
import { parse } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { chunkArray } from "./keywordHelpers";

// ─── CSV Column Detection Helpers ─────────────────────────────

interface ColumnMapping {
  keyword: string[];
  translationCn: string[];
  acRecommended: string[];
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
    translationCn: [],
    acRecommended: [],
    searchVolume: [],
    spr: [],
    ppcBid: [],
    naturalRank: [],
    trafficScore: [],
    relevance: [],
  };

  for (const col of cols) {
    const lower = col.toLowerCase().trim();
    // Keyword column - "流量词" is the primary keyword column in SellerSprite reverse ASIN reports
    if (lower === "流量词" || lower.includes("keyword") || lower.includes("搜索词") || lower.includes("search term") || lower === "词") {
      mapping.keyword.push(col);
    }
    // Chinese translation column - "关键词翻译" in SellerSprite
    if (lower === "关键词翻译" || lower.includes("translation") || lower.includes("翻译") || lower.includes("中文")) {
      mapping.translationCn.push(col);
    }
    // AC recommended keyword - "AC推荐词" in SellerSprite
    if (lower === "ac推荐词" || lower.includes("ac") && (lower.includes("推荐") || lower.includes("recommend"))) {
      mapping.acRecommended.push(col);
    }
    // Also match "关键词" but only if "流量词" is not present (fallback for other tools)
    if (lower.includes("关键词") && !lower.includes("翻译") && !lower.includes("类型")) {
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
      if (!lower.includes("spr") && !lower.includes("product rank") && !lower.includes("aba")) {
        mapping.naturalRank.push(col);
      }
    }
    // Traffic score / traffic share
    if (lower.includes("traffic") || lower.includes("流量占比") || lower.includes("得分") || lower.includes("score")) {
      if (!lower.includes("流量词")) {
        mapping.trafficScore.push(col);
      }
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

export const keywordCrudRouter = router({
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
      isXlsx: z.boolean().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { projectId, csvContent, source, sourceDetail, isXlsx } = input;
      const userId = ctx.user!.id;

      let records: any[];

      if (isXlsx) {
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

        const translationCn = getColumnValue(row, colMap.translationCn) || undefined;

        const acVal = getColumnValue(row, colMap.acRecommended);
        const isAcRecommended = acVal && acVal.trim() !== "" ? 1 : 0;

        const trafficLevel: "high" | "medium" | "low" = "medium";
        const competition: "high" | "medium" | "low" = "medium";

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
          translationCn,
          isAcRecommended,
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
          skipSemanticFilter: 0,
        };
      }).filter(Boolean) as any[];

      if (keywordsToInsert.length === 0) {
        throw new Error("未找到有效的关键词数据");
      }

      // ─── Dedup Detection ─────────────────────────────────────
      const existingKeywords = await getKeywordsByProject(projectId);
      const existingMap = new Map<string, any>();
      for (const ek of existingKeywords) {
        existingMap.set(ek.keyword.toLowerCase().trim(), ek);
      }

      const seenInFile = new Map<string, number>();
      const deduplicatedInsert: any[] = [];
      let inFileDuplicates = 0;
      for (const kw of keywordsToInsert) {
        const key = kw.keyword.toLowerCase().trim();
        if (seenInFile.has(key)) {
          const existingIdx = seenInFile.get(key)!;
          const existing = deduplicatedInsert[existingIdx];
          if ((kw.monthlySearchVolume || 0) > (existing.monthlySearchVolume || 0)) {
            deduplicatedInsert[existingIdx] = kw;
          }
          inFileDuplicates++;
        } else {
          seenInFile.set(key, deduplicatedInsert.length);
          deduplicatedInsert.push(kw);
        }
      }

      const newKeywords: any[] = [];
      const duplicateKeywords: { keyword: string; existingId: number }[] = [];
      const mergedKeywords: { id: number; data: any }[] = [];

      for (const kw of deduplicatedInsert) {
        const key = kw.keyword.toLowerCase().trim();
        const existing = existingMap.get(key);
        if (existing) {
          const updateData: any = {};
          if (!existing.monthlySearchVolume && kw.monthlySearchVolume) updateData.monthlySearchVolume = kw.monthlySearchVolume;
          if (!existing.spr && kw.spr) updateData.spr = kw.spr;
          if (!existing.ppcBid && kw.ppcBid) updateData.ppcBid = kw.ppcBid;
          if (!existing.naturalRank && kw.naturalRank) updateData.naturalRank = kw.naturalRank;
          if (!existing.trafficScore && kw.trafficScore) updateData.trafficScore = kw.trafficScore;
          if (kw.monthlySearchVolume && (!existing.monthlySearchVolume || existing.monthlySearchVolume === 0)) {
            updateData.monthlySearchVolume = kw.monthlySearchVolume;
          }
          if (kw.spr && (!existing.spr || existing.spr === 0)) {
            updateData.spr = kw.spr;
          }
          if (Object.keys(updateData).length > 0) {
            mergedKeywords.push({ id: existing.id, data: updateData });
          }
          duplicateKeywords.push({ keyword: kw.keyword, existingId: existing.id });
        } else {
          newKeywords.push(kw);
        }
      }

      let totalInserted = 0;
      if (newKeywords.length > 0) {
        const batches = chunkArray(newKeywords, 100);
        for (const batch of batches) {
          await bulkCreateKeywords(batch);
          totalInserted += batch.length;
        }
      }

      let totalMerged = 0;
      for (const { id, data } of mergedKeywords) {
        await updateKeyword(id, data);
        totalMerged++;
      }

      return {
        success: true,
        imported: totalInserted,
        duplicatesFound: duplicateKeywords.length,
        duplicatesMerged: totalMerged,
        inFileDuplicates,
        totalParsed: keywordsToInsert.length,
        columns: cols,
        detectedMapping: colMap,
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

  // Batch restore keywords from negative library back to active keywords
  batchRestoreFromNegative: protectedProcedure
    .input(z.object({
      negativeKeywordIds: z.array(z.number()),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { negativeKeywordIds, projectId } = input;
      let restored = 0;

      for (const negId of negativeKeywordIds) {
        const negKws = await getNegativeKeywordsByProject(projectId);
        const negKw = negKws.find(n => n.id === negId);
        if (!negKw) continue;

        const allKws = await getKeywordsByProject(projectId);
        const matchedKw = allKws.find(k => k.keyword.toLowerCase() === negKw.keyword.toLowerCase() && k.isNegative === 1);
        if (matchedKw) {
          await updateKeyword(matchedKw.id, {
            status: "raw",
            isNegative: 0,
            skipSemanticFilter: 1,
          });
        }

        await deleteNegativeKeyword(negId);
        restored++;
      }

      return { restored };
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

      await updateKeyword(kw.id, {
        status: "negative",
        isNegative: 1,
      });

      return createNegativeKeyword({
        projectId: kw.projectId,
        userId: ctx.user!.id,
        keyword: kw.keyword,
        reason: input.reason || "手动移入否定词库",
        reasonCn: input.reason ? `手动移入: ${input.reason}` : "手动移入否定词库",
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
        strategyCategory: z.enum(["core_main", "sub_core", "precise_longtail", "scene_intent", "longtail_main", "observe_test", "negative", "brand_offensive"]).nullable().optional(),
        rootCategory: z.enum(["core", "function", "scene", "audience", "spec", "painpoint", "gift_holiday", "brand_competitor"]).nullable().optional(),
        listingPlacement: z.enum(["title_front", "title_mid", "title_end", "bullet_first", "bullet_body", "aplus", "search_term", "not_use"]).nullable().optional(),
      }),
    }))
    .mutation(async ({ input }) => {
      return bulkUpdateKeywords(input.ids, input.data);
    }),
});
