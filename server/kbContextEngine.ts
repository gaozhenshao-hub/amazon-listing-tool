/**
 * kbContextEngine.ts — 知识库三层加载核心服务（Context Engineering）
 * 
 * L1 索引层（~50 tokens/条）：标题+类型+标签+评分，用于快速全局扫描
 * L2 摘要层（~200 tokens/条）：简介+关键要点+优势，确认相关性后加载
 * L3 详情层（~1000+ tokens/条）：完整内容+图片+AI分析，真正需要引用时加载
 */

import { getDb } from "./db";
import { eq, and, desc, like, or, sql, inArray } from "drizzle-orm";
import {
  kbProductInnovations,
  kbListingCopywriting,
  kbImageSets,
  kbImages,
  kbOperationSkills,
  kbVideos,
} from "../drizzle/schema";

async function db() {
  const d = await getDb();
  if (!d) throw new Error("Database not available");
  return d;
}

// ═══════════════════════════════════════════════════
// ─── Types ───────────────────────────────────────
// ═══════════════════════════════════════════════════

export type KbItemType = "product" | "listing" | "image" | "skill" | "video";
export type ScopeType = "mine" | "shared" | "all";

export interface L1Item {
  id: number;
  type: KbItemType;
  title: string;
  asin: string;
  category: string;
  tags: string;
  score: number | null;
  status: string;
  source: "internal" | "external";
  userId: number;
}

export interface L2Item extends L1Item {
  summary: string;
  keyPoints: string;
  strengths: string;
}

export interface L3Item extends L2Item {
  fullContent: string;
  imageUrls: string;
  aiAnalysis: string;
  originalUrl: string;
}

export interface SearchPath {
  level: "L1" | "L2" | "L3";
  scannedCount: number;
  matchedCount: number;
  tokensUsed: number;
}

export interface SmartRouteResult {
  suggestedTypes: KbItemType[];
  suggestedFilters: Record<string, string>;
  estimatedTokens: number;
}

// ═══════════════════════════════════════════════════
// ─── Scope Helpers ───────────────────────────────
// ═══════════════════════════════════════════════════

function buildScopeCondition(table: any, userId: number, scope: ScopeType) {
  if (scope === "mine") {
    return eq(table.userId, userId);
  }
  if (scope === "shared") {
    return eq(table.status, "confirmed");
  }
  // "all" — no filter (admin use)
  return sql`1=1`;
}

// ═══════════════════════════════════════════════════
// ─── L1 Index Layer (~50 tokens/item) ────────────
// ═══════════════════════════════════════════════════

export async function getL1Index(filters: {
  types?: KbItemType[];
  category?: string;
  keyword?: string;
  scope?: ScopeType;
  userId: number;
}): Promise<L1Item[]> {
  const _d = await db();
  const { types, category, keyword, scope = "shared", userId } = filters;
  const targetTypes = types && types.length > 0 ? types : ["product", "listing", "image", "skill", "video"] as KbItemType[];
  
  const results: L1Item[] = [];

  if (targetTypes.includes("product")) {
    const conditions: any[] = [buildScopeCondition(kbProductInnovations, userId, scope)];
    if (category) conditions.push(like(kbProductInnovations.category, `%${category}%`));
    if (keyword) conditions.push(or(
      like(kbProductInnovations.productTitle, `%${keyword}%`),
      like(kbProductInnovations.asin, `%${keyword}%`),
      like(kbProductInnovations.category, `%${keyword}%`),
      like(kbProductInnovations.tags, `%${keyword}%`)
    ));
    const rows = await _d.select({
      id: kbProductInnovations.id,
      title: kbProductInnovations.productTitle,
      asin: kbProductInnovations.asin,
      category: kbProductInnovations.category,
      tags: kbProductInnovations.tags,
      score: kbProductInnovations.overallScore,
      status: kbProductInnovations.status,
      userId: kbProductInnovations.userId,
    }).from(kbProductInnovations).where(and(...conditions));
    results.push(...rows.map(r => ({
      ...r,
      type: "product" as KbItemType,
      title: r.title || "",
      asin: r.asin || "",
      category: r.category || "",
      tags: r.tags || "",
      score: r.score ? Number(r.score) : null,
      source: "internal" as const,
    })));
  }

  if (targetTypes.includes("listing")) {
    const conditions: any[] = [buildScopeCondition(kbListingCopywriting, userId, scope)];
    if (category) conditions.push(like(kbListingCopywriting.category, `%${category}%`));
    if (keyword) conditions.push(or(
      like(kbListingCopywriting.productTitle, `%${keyword}%`),
      like(kbListingCopywriting.asin, `%${keyword}%`),
      like(kbListingCopywriting.category, `%${keyword}%`),
      like(kbListingCopywriting.tags, `%${keyword}%`)
    ));
    const rows = await _d.select({
      id: kbListingCopywriting.id,
      title: kbListingCopywriting.productTitle,
      asin: kbListingCopywriting.asin,
      category: kbListingCopywriting.category,
      tags: kbListingCopywriting.tags,
      score: kbListingCopywriting.overallScore,
      status: kbListingCopywriting.status,
      userId: kbListingCopywriting.userId,
    }).from(kbListingCopywriting).where(and(...conditions));
    results.push(...rows.map(r => ({
      ...r,
      type: "listing" as KbItemType,
      title: r.title || "",
      asin: r.asin || "",
      category: r.category || "",
      tags: r.tags || "",
      score: r.score ? Number(r.score) : null,
      source: "internal" as const,
    })));
  }

  if (targetTypes.includes("image")) {
    const conditions: any[] = [buildScopeCondition(kbImageSets, userId, scope)];
    if (category) conditions.push(like(kbImageSets.category, `%${category}%`));
    if (keyword) conditions.push(or(
      like(kbImageSets.productTitle, `%${keyword}%`),
      like(kbImageSets.asin, `%${keyword}%`),
      like(kbImageSets.category, `%${keyword}%`)
    ));
    const rows = await _d.select({
      id: kbImageSets.id,
      title: kbImageSets.productTitle,
      asin: kbImageSets.asin,
      category: kbImageSets.category,
      score: kbImageSets.overallScore,
      status: kbImageSets.status,
      userId: kbImageSets.userId,
    }).from(kbImageSets).where(and(...conditions));
    results.push(...rows.map(r => ({
      ...r,
      type: "image" as KbItemType,
      title: r.title || "",
      asin: r.asin || "",
      category: r.category || "",
      tags: "",
      score: r.score ? Number(r.score) : null,
      source: "internal" as const,
    })));
  }

  if (targetTypes.includes("skill")) {
    const conditions: any[] = [buildScopeCondition(kbOperationSkills, userId, scope)];
    if (category) conditions.push(like(kbOperationSkills.categories, `%${category}%`));
    if (keyword) conditions.push(or(
      like(kbOperationSkills.title, `%${keyword}%`),
      like(kbOperationSkills.tags, `%${keyword}%`),
      like(kbOperationSkills.categories, `%${keyword}%`)
    ));
    const rows = await _d.select({
      id: kbOperationSkills.id,
      title: kbOperationSkills.title,
      categories: kbOperationSkills.categories,
      tags: kbOperationSkills.tags,
      score: kbOperationSkills.practicalityScore,
      status: kbOperationSkills.status,
      userId: kbOperationSkills.userId,
    }).from(kbOperationSkills).where(and(...conditions));
    results.push(...rows.map(r => ({
      ...r,
      type: "skill" as KbItemType,
      asin: "",
      category: r.categories || "",
      tags: r.tags || "",
      score: r.score ? Number(r.score) : null,
      source: "internal" as const,
    })));
  }

  if (targetTypes.includes("video")) {
    const conditions: any[] = [buildScopeCondition(kbVideos, userId, scope)];
    if (category) conditions.push(like(kbVideos.category, `%${category}%`));
    if (keyword) conditions.push(or(
      like(kbVideos.videoTitle, `%${keyword}%`),
      like(kbVideos.asin, `%${keyword}%`),
      like(kbVideos.category, `%${keyword}%`),
      like(kbVideos.tags, `%${keyword}%`)
    ));
    const rows = await _d.select({
      id: kbVideos.id,
      title: kbVideos.videoTitle,
      asin: kbVideos.asin,
      category: kbVideos.category,
      tags: kbVideos.tags,
      score: kbVideos.overallScore,
      status: kbVideos.status,
      userId: kbVideos.userId,
    }).from(kbVideos).where(and(...conditions));
    results.push(...rows.map(r => ({
      ...r,
      type: "video" as KbItemType,
      title: r.title || "",
      asin: r.asin || "",
      category: r.category || "",
      tags: r.tags || "",
      score: r.score ? Number(r.score) : null,
      source: "internal" as const,
    })));
  }

  return results;
}

// ═══════════════════════════════════════════════════
// ─── L2 Summary Layer (~200 tokens/item) ─────────
// ═══════════════════════════════════════════════════

export async function getL2Summary(ids: number[], types: KbItemType[]): Promise<L2Item[]> {
  const _d = await db();
  const results: L2Item[] = [];

  // Group ids by type
  const idsByType: Record<KbItemType, number[]> = { product: [], listing: [], image: [], skill: [], video: [] };
  // If single type provided, all ids belong to it; otherwise need per-item type info
  if (types.length === 1) {
    idsByType[types[0]] = ids;
  } else {
    // Caller should provide matching types array
    ids.forEach((id, i) => {
      const t = types[i] || types[0];
      idsByType[t].push(id);
    });
  }

  if (idsByType.product.length > 0) {
    const rows = await _d.select({
      id: kbProductInnovations.id,
      title: kbProductInnovations.productTitle,
      asin: kbProductInnovations.asin,
      category: kbProductInnovations.category,
      tags: kbProductInnovations.tags,
      score: kbProductInnovations.overallScore,
      status: kbProductInnovations.status,
      userId: kbProductInnovations.userId,
      aiAnalysis: kbProductInnovations.aiAnalysis,
      bulletPoints: kbProductInnovations.bulletPoints,
    }).from(kbProductInnovations).where(inArray(kbProductInnovations.id, idsByType.product));
    results.push(...rows.map(r => {
      const analysis = r.aiAnalysis ? (typeof r.aiAnalysis === "string" ? r.aiAnalysis : JSON.stringify(r.aiAnalysis)) : "";
      const summary = analysis.slice(0, 400);
      return {
        id: r.id,
        type: "product" as KbItemType,
        title: r.title || "",
        asin: r.asin || "",
        category: r.category || "",
        tags: r.tags || "",
        score: r.score ? Number(r.score) : null,
        status: r.status,
        source: "internal" as const,
        userId: r.userId,
        summary,
        keyPoints: r.bulletPoints ? (typeof r.bulletPoints === "string" ? r.bulletPoints.slice(0, 300) : JSON.stringify(r.bulletPoints).slice(0, 300)) : "",
        strengths: "",
      };
    }));
  }

  if (idsByType.listing.length > 0) {
    const rows = await _d.select({
      id: kbListingCopywriting.id,
      title: kbListingCopywriting.productTitle,
      asin: kbListingCopywriting.asin,
      category: kbListingCopywriting.category,
      tags: kbListingCopywriting.tags,
      score: kbListingCopywriting.overallScore,
      status: kbListingCopywriting.status,
      userId: kbListingCopywriting.userId,
      aiAnalysis: kbListingCopywriting.aiAnalysis,
      titleText: kbListingCopywriting.titleText,
      bulletPoints: kbListingCopywriting.bulletPoints,
    }).from(kbListingCopywriting).where(inArray(kbListingCopywriting.id, idsByType.listing));
    results.push(...rows.map(r => {
      const analysis = r.aiAnalysis ? (typeof r.aiAnalysis === "string" ? r.aiAnalysis : JSON.stringify(r.aiAnalysis)) : "";
      return {
        id: r.id,
        type: "listing" as KbItemType,
        title: r.title || "",
        asin: r.asin || "",
        category: r.category || "",
        tags: r.tags || "",
        score: r.score ? Number(r.score) : null,
        status: r.status,
        source: "internal" as const,
        userId: r.userId,
        summary: analysis.slice(0, 400),
        keyPoints: r.bulletPoints ? (typeof r.bulletPoints === "string" ? r.bulletPoints.slice(0, 300) : JSON.stringify(r.bulletPoints).slice(0, 300)) : "",
        strengths: r.titleText || "",
      };
    }));
  }

  if (idsByType.image.length > 0) {
    const rows = await _d.select({
      id: kbImageSets.id,
      title: kbImageSets.productTitle,
      asin: kbImageSets.asin,
      category: kbImageSets.category,
      score: kbImageSets.overallScore,
      status: kbImageSets.status,
      userId: kbImageSets.userId,
      overallAnalysis: kbImageSets.overallAnalysis,
    }).from(kbImageSets).where(inArray(kbImageSets.id, idsByType.image));
    results.push(...rows.map(r => ({
      id: r.id,
      type: "image" as KbItemType,
      title: r.title || "",
      asin: r.asin || "",
      category: r.category || "",
      tags: "",
      score: r.score ? Number(r.score) : null,
      status: r.status,
      source: "internal" as const,
      userId: r.userId,
      summary: r.overallAnalysis ? (typeof r.overallAnalysis === "string" ? r.overallAnalysis.slice(0, 400) : JSON.stringify(r.overallAnalysis).slice(0, 400)) : "",
      keyPoints: "",
      strengths: "",
    })));
  }

  if (idsByType.skill.length > 0) {
    const rows = await _d.select({
      id: kbOperationSkills.id,
      title: kbOperationSkills.title,
      categories: kbOperationSkills.categories,
      tags: kbOperationSkills.tags,
      score: kbOperationSkills.practicalityScore,
      status: kbOperationSkills.status,
      userId: kbOperationSkills.userId,
      aiSummary: kbOperationSkills.aiSummary,
      extractedContent: kbOperationSkills.extractedContent,
    }).from(kbOperationSkills).where(inArray(kbOperationSkills.id, idsByType.skill));
    results.push(...rows.map(r => ({
      id: r.id,
      type: "skill" as KbItemType,
      title: r.title || "",
      asin: "",
      category: r.categories || "",
      tags: r.tags || "",
      score: r.score ? Number(r.score) : null,
      status: r.status,
      source: "internal" as const,
      userId: r.userId,
      summary: r.aiSummary || "",
      keyPoints: r.extractedContent ? r.extractedContent.slice(0, 300) : "",
      strengths: "",
    })));
  }

  if (idsByType.video.length > 0) {
    const rows = await _d.select({
      id: kbVideos.id,
      title: kbVideos.videoTitle,
      asin: kbVideos.asin,
      category: kbVideos.category,
      tags: kbVideos.tags,
      score: kbVideos.overallScore,
      status: kbVideos.status,
      userId: kbVideos.userId,
      aiAnalysis: kbVideos.aiAnalysis,
      transcriptText: kbVideos.transcriptText,
    }).from(kbVideos).where(inArray(kbVideos.id, idsByType.video));
    results.push(...rows.map(r => {
      const analysis = r.aiAnalysis ? (typeof r.aiAnalysis === "string" ? r.aiAnalysis : JSON.stringify(r.aiAnalysis)) : "";
      return {
        id: r.id,
        type: "video" as KbItemType,
        title: r.title || "",
        asin: r.asin || "",
        category: r.category || "",
        tags: r.tags || "",
        score: r.score ? Number(r.score) : null,
        status: r.status,
        source: "internal" as const,
        userId: r.userId,
        summary: analysis.slice(0, 400),
        keyPoints: r.transcriptText ? r.transcriptText.slice(0, 300) : "",
        strengths: "",
      };
    }));
  }

  return results;
}

// ═══════════════════════════════════════════════════
// ─── L3 Detail Layer (~1000+ tokens/item) ────────
// ═══════════════════════════════════════════════════

export async function getL3Detail(ids: number[], types: KbItemType[]): Promise<L3Item[]> {
  const _d = await db();
  const results: L3Item[] = [];

  const idsByType: Record<KbItemType, number[]> = { product: [], listing: [], image: [], skill: [], video: [] };
  if (types.length === 1) {
    idsByType[types[0]] = ids;
  } else {
    ids.forEach((id, i) => {
      const t = types[i] || types[0];
      idsByType[t].push(id);
    });
  }

  if (idsByType.product.length > 0) {
    const rows = await _d.select().from(kbProductInnovations).where(inArray(kbProductInnovations.id, idsByType.product));
    results.push(...rows.map(r => ({
      id: r.id,
      type: "product" as KbItemType,
      title: r.productTitle || "",
      asin: r.asin || "",
      category: r.category || "",
      tags: r.tags || "",
      score: r.overallScore ? Number(r.overallScore) : null,
      status: r.status,
      source: "internal" as const,
      userId: r.userId,
      summary: r.aiAnalysis ? (typeof r.aiAnalysis === "string" ? r.aiAnalysis.slice(0, 400) : JSON.stringify(r.aiAnalysis).slice(0, 400)) : "",
      keyPoints: r.bulletPoints ? (typeof r.bulletPoints === "string" ? r.bulletPoints : JSON.stringify(r.bulletPoints)) : "",
      strengths: "",
      fullContent: JSON.stringify({
        bulletPoints: r.bulletPoints,
        crawledData: r.crawledData,
        userEditedAnalysis: r.userEditedAnalysis,
      }),
      imageUrls: r.imageUrls ? (typeof r.imageUrls === "string" ? r.imageUrls : JSON.stringify(r.imageUrls)) : "",
      aiAnalysis: r.aiAnalysis ? (typeof r.aiAnalysis === "string" ? r.aiAnalysis : JSON.stringify(r.aiAnalysis)) : "",
      originalUrl: r.productUrl || "",
    })));
  }

  if (idsByType.listing.length > 0) {
    const rows = await _d.select().from(kbListingCopywriting).where(inArray(kbListingCopywriting.id, idsByType.listing));
    results.push(...rows.map(r => ({
      id: r.id,
      type: "listing" as KbItemType,
      title: r.productTitle || "",
      asin: r.asin || "",
      category: r.category || "",
      tags: r.tags || "",
      score: r.overallScore ? Number(r.overallScore) : null,
      status: r.status,
      source: "internal" as const,
      userId: r.userId,
      summary: r.aiAnalysis ? (typeof r.aiAnalysis === "string" ? r.aiAnalysis.slice(0, 400) : JSON.stringify(r.aiAnalysis).slice(0, 400)) : "",
      keyPoints: r.bulletPoints ? (typeof r.bulletPoints === "string" ? r.bulletPoints : JSON.stringify(r.bulletPoints)) : "",
      strengths: r.titleText || "",
      fullContent: JSON.stringify({
        titleText: r.titleText,
        bulletPoints: r.bulletPoints,
        longDescription: r.longDescription,
        aPlusContent: r.aPlusContent,
        qaContent: r.qaContent,
        userEditedAnalysis: r.userEditedAnalysis,
      }),
      imageUrls: "",
      aiAnalysis: r.aiAnalysis ? (typeof r.aiAnalysis === "string" ? r.aiAnalysis : JSON.stringify(r.aiAnalysis)) : "",
      originalUrl: "",
    })));
  }

  if (idsByType.image.length > 0) {
    const rows = await _d.select().from(kbImageSets).where(inArray(kbImageSets.id, idsByType.image));
    // Also fetch images for each set
    const imageSetIds = rows.map(r => r.id);
    const allImages = imageSetIds.length > 0
      ? await _d.select().from(kbImages).where(inArray(kbImages.imageSetId, imageSetIds)).orderBy(kbImages.positionIndex)
      : [];
    const imagesBySet = new Map<number, typeof allImages>();
    allImages.forEach(img => {
      const list = imagesBySet.get(img.imageSetId) || [];
      list.push(img);
      imagesBySet.set(img.imageSetId, list);
    });

    results.push(...rows.map(r => {
      const setImages = imagesBySet.get(r.id) || [];
      return {
        id: r.id,
        type: "image" as KbItemType,
        title: r.productTitle || "",
        asin: r.asin || "",
        category: r.category || "",
        tags: "",
        score: r.overallScore ? Number(r.overallScore) : null,
        status: r.status,
        source: "internal" as const,
        userId: r.userId,
        summary: r.overallAnalysis ? (typeof r.overallAnalysis === "string" ? r.overallAnalysis.slice(0, 400) : JSON.stringify(r.overallAnalysis).slice(0, 400)) : "",
        keyPoints: "",
        strengths: "",
        fullContent: JSON.stringify({
          overallAnalysis: r.overallAnalysis,
          userEditedOverallAnalysis: r.userEditedOverallAnalysis,
          images: setImages.map(img => ({
            id: img.id,
            position: img.imagePosition,
            url: img.imageUrl,
            analysis: img.aiDimensionAnalysis,
            score: img.singleImageScore,
            tags: { category: img.tagCategory, colorScheme: img.tagColorScheme, imageType: img.tagImageType, designStyle: img.tagDesignStyle },
          })),
        }),
        imageUrls: JSON.stringify(setImages.map(img => img.imageUrl)),
        aiAnalysis: r.overallAnalysis ? (typeof r.overallAnalysis === "string" ? r.overallAnalysis : JSON.stringify(r.overallAnalysis)) : "",
        originalUrl: "",
      };
    }));
  }

  if (idsByType.skill.length > 0) {
    const rows = await _d.select().from(kbOperationSkills).where(inArray(kbOperationSkills.id, idsByType.skill));
    results.push(...rows.map(r => ({
      id: r.id,
      type: "skill" as KbItemType,
      title: r.title || "",
      asin: "",
      category: r.categories || "",
      tags: r.tags || "",
      score: r.practicalityScore ? Number(r.practicalityScore) : null,
      status: r.status,
      source: "internal" as const,
      userId: r.userId,
      summary: r.aiSummary || "",
      keyPoints: r.extractedContent ? r.extractedContent.slice(0, 300) : "",
      strengths: "",
      fullContent: JSON.stringify({
        extractedContent: r.extractedContent,
        userEditedSummary: r.userEditedSummary,
        accessLevel: r.accessLevel,
        allowedRoles: r.allowedRoles,
      }),
      imageUrls: "",
      aiAnalysis: r.aiSummary || "",
      originalUrl: r.sourceUrl || "",
    })));
  }

  if (idsByType.video.length > 0) {
    const rows = await _d.select().from(kbVideos).where(inArray(kbVideos.id, idsByType.video));
    results.push(...rows.map(r => ({
      id: r.id,
      type: "video" as KbItemType,
      title: r.videoTitle || "",
      asin: r.asin || "",
      category: r.category || "",
      tags: r.tags || "",
      score: r.overallScore ? Number(r.overallScore) : null,
      status: r.status,
      source: "internal" as const,
      userId: r.userId,
      summary: r.aiAnalysis ? (typeof r.aiAnalysis === "string" ? r.aiAnalysis.slice(0, 400) : JSON.stringify(r.aiAnalysis).slice(0, 400)) : "",
      keyPoints: r.transcriptText ? r.transcriptText.slice(0, 300) : "",
      strengths: "",
      fullContent: JSON.stringify({
        transcriptText: r.transcriptText,
        userEditedAnalysis: r.userEditedAnalysis,
        keyframeUrls: r.keyframeUrls,
      }),
      imageUrls: r.keyframeUrls ? (typeof r.keyframeUrls === "string" ? r.keyframeUrls : JSON.stringify(r.keyframeUrls)) : "",
      aiAnalysis: r.aiAnalysis ? (typeof r.aiAnalysis === "string" ? r.aiAnalysis : JSON.stringify(r.aiAnalysis)) : "",
      originalUrl: r.videoUrl || "",
    })));
  }

  return results;
}

// ═══════════════════════════════════════════════════
// ─── Smart Route ─────────────────────────────────
// ═══════════════════════════════════════════════════

/**
 * 根据用户查询自动判断需要检索哪些知识库类型和过滤条件
 */
export function smartRoute(query: string): SmartRouteResult {
  const q = query.toLowerCase();
  const suggestedTypes: KbItemType[] = [];
  const suggestedFilters: Record<string, string> = {};

  // 类型推断
  if (q.includes("图片") || q.includes("主图") || q.includes("副图") || q.includes("a+") || q.includes("视觉") || q.includes("拍摄")) {
    suggestedTypes.push("image");
  }
  if (q.includes("listing") || q.includes("标题") || q.includes("五点") || q.includes("文案") || q.includes("描述") || q.includes("bullet")) {
    suggestedTypes.push("listing");
  }
  if (q.includes("产品") || q.includes("选品") || q.includes("创意") || q.includes("开发") || q.includes("竞品")) {
    suggestedTypes.push("product");
  }
  if (q.includes("sop") || q.includes("流程") || q.includes("操作") || q.includes("教程") || q.includes("步骤") || q.includes("运营")) {
    suggestedTypes.push("skill");
  }
  if (q.includes("视频") || q.includes("video") || q.includes("广告片")) {
    suggestedTypes.push("video");
  }

  // 如果没有匹配到具体类型，搜索全部
  if (suggestedTypes.length === 0) {
    suggestedTypes.push("product", "listing", "image", "skill", "video");
  }

  // 估算token消耗
  const estimatedTokens = suggestedTypes.length * 50 * 50; // 每种类型假设50条 × 50 tokens

  return { suggestedTypes, suggestedFilters, estimatedTokens };
}

// ═══════════════════════════════════════════════════
// ─── Format for Prompt ───────────────────────────
// ═══════════════════════════════════════════════════

const TYPE_LABELS: Record<KbItemType, string> = {
  product: "产品创意",
  listing: "Listing文案",
  image: "图片参考",
  skill: "运营SOP",
  video: "视频参考",
};

export function formatForPrompt(items: L1Item[] | L2Item[] | L3Item[], level: "L1" | "L2" | "L3"): string {
  if (items.length === 0) return "（知识库中暂无匹配内容）";

  return items.map((item, i) => {
    const base = `[${i + 1}] [${TYPE_LABELS[item.type]}] ${item.title}${item.asin ? ` (${item.asin})` : ""}${item.score ? ` 评分:${item.score}` : ""}`;

    if (level === "L1") {
      return `${base}${item.category ? ` | 类目:${item.category}` : ""}${item.tags ? ` | 标签:${item.tags}` : ""}`;
    }

    const l2 = item as L2Item;
    if (level === "L2") {
      return `${base}\n  摘要: ${l2.summary || "无"}\n  要点: ${l2.keyPoints || "无"}`;
    }

    const l3 = item as L3Item;
    return `${base}\n  摘要: ${l3.summary || "无"}\n  完整内容: ${l3.fullContent?.slice(0, 2000) || "无"}\n  AI分析: ${l3.aiAnalysis?.slice(0, 1000) || "无"}`;
  }).join("\n\n");
}

// ═══════════════════════════════════════════════════
// ─── Call Log Helpers ────────────────────────────
// ═══════════════════════════════════════════════════

import { kbCallLogs, kbFeedback } from "../drizzle/schema";

export async function logKbCall(data: {
  userId: number;
  callerModule: string;
  callerAction: string;
  kbItemId: number;
  kbItemType: string;
  loadLevel: "L1" | "L2" | "L3";
  relevanceScore?: number;
}) {
  const _d = await db();
  const [result] = await _d.insert(kbCallLogs).values({
    ...data,
    relevanceScore: data.relevanceScore?.toString(),
    createdAt: Date.now(),
  });
  return result.insertId;
}

export async function logKbCallBatch(items: {
  userId: number;
  callerModule: string;
  callerAction: string;
  kbItemId: number;
  kbItemType: string;
  loadLevel: "L1" | "L2" | "L3";
  relevanceScore?: number;
}[]) {
  if (items.length === 0) return;
  const _d = await db();
  await _d.insert(kbCallLogs).values(items.map(item => ({
    ...item,
    relevanceScore: item.relevanceScore?.toString(),
    createdAt: Date.now(),
  })));
}

export async function submitKbFeedback(data: {
  callLogId?: number;
  conversationMessageId?: number;
  userId: number;
  kbItemId: number;
  kbItemType: string;
  rating: "helpful" | "irrelevant" | "wrong";
  comment?: string;
}) {
  const _d = await db();
  const [result] = await _d.insert(kbFeedback).values({
    ...data,
    createdAt: Date.now(),
  });
  return result.insertId;
}

export async function getKbCallStats(userId?: number) {
  const _d = await db();
  const conditions = userId ? [eq(kbCallLogs.userId, userId)] : [];
  
  const [totalCalls] = await _d.select({ count: sql<number>`count(*)` })
    .from(kbCallLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined);

  const topReferenced = await _d.select({
    kbItemId: kbCallLogs.kbItemId,
    kbItemType: kbCallLogs.kbItemType,
    count: sql<number>`count(*)`,
  }).from(kbCallLogs)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(kbCallLogs.kbItemId, kbCallLogs.kbItemType)
    .orderBy(desc(sql`count(*)`))
    .limit(10);

  const feedbackStats = await _d.select({
    rating: kbFeedback.rating,
    count: sql<number>`count(*)`,
  }).from(kbFeedback)
    .where(userId ? eq(kbFeedback.userId, userId) : undefined)
    .groupBy(kbFeedback.rating);

  return {
    totalCalls: totalCalls?.count ?? 0,
    topReferenced,
    feedbackStats,
  };
}
