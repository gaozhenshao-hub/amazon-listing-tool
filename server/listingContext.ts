/**
 * Listing Context Builder — Unified 4-module data aggregation layer
 * 
 * Module 1: Rufus Attributes (projectFiles, fileType='product_attributes')
 * Module 2: Competitor Insights (competitorAnalyses + reviewAggregations)
 * Module 3: COSMO Scenes (keywords.sceneTags + intentTag)
 * Module 4: A9 Keywords (keywords.strategyCategory + listingPlacement)
 */
import * as db from "./db";

// ─── Type Definitions ────────────────────────────────────────────

export interface RufusAttributes {
  rawText: string;
  uniqueSellingPoints: string[];
  coreSpecs: Array<{ attribute: string; value: string }>;
  materialBuild: Array<{ attribute: string; value: string; sellingPoint: string }>;
  performance: Array<{ metric: string; value: string }>;
  safetyCompliance: Array<{ certification: string; detail: string }>;
  rufusFriendlyAttributes: string[];
  suggestedKeywords: string[];
}

export interface CompetitorInsights {
  competitors: Array<{
    asin: string;
    title: string;
    bulletPoints: string[];
    price: string;
    rating: string;
    reviewCount: string;
    keywords: { core: string[]; longTail: string[]; traffic: string[] };
    reviewAnalysis: any;
  }>;
  aggregatedReviews: {
    painPoints: Array<{ point: string; frequency: number; severity: string; sourceAsins?: string[]; listingAdvice?: string }>;
    itchPoints: Array<{ point: string; frequency: number; importance: string; sourceAsins?: string[]; listingAdvice?: string }>;
    delightPoints: Array<{ point: string; frequency: number; impact: string; sourceAsins?: string[]; listingAdvice?: string }>;
    keyThemes: string[];
    overallSentiment: string;
  };
  parityPoints: string[];
  gapOpportunities: string[];
}

export interface CosmoScenes {
  topScenes: Array<{ scene: string; frequency: number; totalVolume: number; keywords: string[] }>;
  intentDistribution: Record<string, { count: number; volume: number; keywords: string[] }>;
}

export interface KeywordStrategy {
  byStrategy: Record<string, Array<{
    keyword: string;
    searchVolume: number;
    spr: number | null;
    placement: string | null;
  }>>;
  byPlacement: Record<string, Array<{
    keyword: string;
    strategy: string | null;
    searchVolume: number;
  }>>;
  titleKeywords: string[];
  bulletKeywords: string[];
  searchTermKeywords: string[];
  rootGroups: Record<string, string[]>;
  holidayKeywords: string[];
}

export interface ListingContext {
  productAttributes: RufusAttributes | null;
  competitorInsights: CompetitorInsights | null;
  cosmoScenes: CosmoScenes | null;
  keywordStrategy: KeywordStrategy | null;
}

export interface DataReadiness {
  module1: { ready: boolean; detail: string };
  module2: { ready: boolean; detail: string; competitorCount: number; reviewAggReady: boolean };
  module3: { ready: boolean; detail: string; sceneTagCount: number; completionRate: number };
  module4: { ready: boolean; detail: string; keywordCount: number; strategyTaggedCount: number };
}

// ─── Build Functions ─────────────────────────────────────────────

function safeParseJSON(str: string | null | undefined, fallback: any = null): any {
  if (!str) return fallback;
  try { return JSON.parse(str); } catch { return fallback; }
}

async function buildModule1(projectId: number): Promise<RufusAttributes | null> {
  const files = await db.getProjectFilesByProject(projectId);
  const attrFile = files.find(f => f.fileType === "product_attributes" && f.status === "completed" && f.analysisResult);
  if (!attrFile) return null;

  const parsed = safeParseJSON(attrFile.analysisResult);
  if (!parsed) return null;

  return {
    rawText: attrFile.rawContent || "",
    uniqueSellingPoints: parsed.uniqueSellingPoints || [],
    coreSpecs: parsed.coreSpecs || [],
    materialBuild: parsed.materialBuild || [],
    performance: parsed.performance || [],
    safetyCompliance: parsed.safetyCompliance || [],
    rufusFriendlyAttributes: parsed.rufusFriendlyAttributes || [],
    suggestedKeywords: parsed.suggestedKeywordsFromAttributes || [],
  };
}

async function buildModule2(projectId: number): Promise<CompetitorInsights | null> {
  const analyses = await db.getCompetitorAnalysesByProject(projectId);
  const reviewAgg = await db.getReviewAggregationByProject(projectId);

  if (analyses.length === 0 && !reviewAgg) return null;

  // Build competitor data
  const competitors = analyses.map(a => ({
    asin: a.asin,
    title: a.title || "",
    bulletPoints: safeParseJSON(a.bulletPoints, []),
    price: a.price || "",
    rating: a.rating || "",
    reviewCount: a.reviewCount || "",
    keywords: (() => {
      const kw = safeParseJSON(a.keywords, {});
      return {
        core: (kw.core || []).map((k: any) => k.keyword || k),
        longTail: (kw.longTail || []).map((k: any) => k.keyword || k),
        traffic: (kw.traffic || []).map((k: any) => k.keyword || k),
      };
    })(),
    reviewAnalysis: safeParseJSON(a.reviewAnalysis),
  }));

  // Build aggregated reviews from Kano model
  const aggregatedReviews = {
    painPoints: [] as any[],
    itchPoints: [] as any[],
    delightPoints: [] as any[],
    keyThemes: [] as string[],
    overallSentiment: "",
  };

  if (reviewAgg && reviewAgg.status === "completed") {
    aggregatedReviews.painPoints = safeParseJSON(reviewAgg.painPoints, []);
    aggregatedReviews.itchPoints = safeParseJSON(reviewAgg.itchPoints, []);
    aggregatedReviews.delightPoints = safeParseJSON(reviewAgg.delightPoints, []);
    aggregatedReviews.keyThemes = safeParseJSON(reviewAgg.keyThemes, []);
    aggregatedReviews.overallSentiment = reviewAgg.overallSentiment || "";
  } else {
    // Fallback: aggregate from individual competitor review analyses
    for (const c of competitors) {
      if (c.reviewAnalysis) {
        if (c.reviewAnalysis.painPoints) aggregatedReviews.painPoints.push(...c.reviewAnalysis.painPoints);
        if (c.reviewAnalysis.itchPoints) aggregatedReviews.itchPoints.push(...c.reviewAnalysis.itchPoints);
        if (c.reviewAnalysis.delightPoints) aggregatedReviews.delightPoints.push(...c.reviewAnalysis.delightPoints);
      }
    }
  }

  // Extract parity points (common selling points across competitors)
  const sellingPointCounts: Record<string, number> = {};
  for (const c of competitors) {
    for (const bp of c.bulletPoints) {
      const key = (typeof bp === "string" ? bp : "").substring(0, 80).toLowerCase();
      if (key) sellingPointCounts[key] = (sellingPointCounts[key] || 0) + 1;
    }
  }
  const parityPoints = Object.entries(sellingPointCounts)
    .filter(([_, count]) => count >= 2)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 10)
    .map(([point]) => point);

  // Gap opportunities from pain points
  const gapOpportunities = aggregatedReviews.painPoints
    .sort((a, b) => (b.frequency || 0) - (a.frequency || 0))
    .slice(0, 8)
    .map(p => p.point || p.issue || String(p));

  return { competitors, aggregatedReviews, parityPoints, gapOpportunities };
}

async function buildModule3(projectId: number): Promise<CosmoScenes | null> {
  const allKeywords = await db.getKeywordsByProject(projectId);
  if (allKeywords.length === 0) return null;

  const sceneMap: Record<string, { count: number; volume: number; keywords: string[] }> = {};
  const intentMap: Record<string, { count: number; volume: number; keywords: string[] }> = {};

  for (const kw of allKeywords) {
    if (kw.isNegative === 1) continue;
    const vol = kw.monthlySearchVolume || 0;

    if (kw.sceneTags) {
      const tags = safeParseJSON(kw.sceneTags, []);
      if (Array.isArray(tags)) {
        for (const tag of tags) {
          if (!sceneMap[tag]) sceneMap[tag] = { count: 0, volume: 0, keywords: [] };
          sceneMap[tag].count++;
          sceneMap[tag].volume += vol;
          if (sceneMap[tag].keywords.length < 10) sceneMap[tag].keywords.push(kw.keyword);
        }
      }
    }

    if (kw.intentTag) {
      if (!intentMap[kw.intentTag]) intentMap[kw.intentTag] = { count: 0, volume: 0, keywords: [] };
      intentMap[kw.intentTag].count++;
      intentMap[kw.intentTag].volume += vol;
      if (intentMap[kw.intentTag].keywords.length < 10) intentMap[kw.intentTag].keywords.push(kw.keyword);
    }
  }

  if (Object.keys(sceneMap).length === 0 && Object.keys(intentMap).length === 0) return null;

  const topScenes = Object.entries(sceneMap)
    .sort(([, a], [, b]) => b.volume - a.volume)
    .slice(0, 15)
    .map(([scene, data]) => ({
      scene,
      frequency: data.count,
      totalVolume: data.volume,
      keywords: data.keywords,
    }));

  return { topScenes, intentDistribution: intentMap };
}

async function buildModule4(projectId: number): Promise<KeywordStrategy | null> {
  const allKeywords = await db.getKeywordsByProject(projectId);
  if (allKeywords.length === 0) return null;

  const byStrategy: Record<string, Array<{ keyword: string; searchVolume: number; spr: number | null; placement: string | null }>> = {};
  const byPlacement: Record<string, Array<{ keyword: string; strategy: string | null; searchVolume: number }>> = {};
  const rootGroups: Record<string, string[]> = {};
  const titleKeywords: string[] = [];
  const bulletKeywords: string[] = [];
  const searchTermKeywords: string[] = [];
  const holidayKeywords: string[] = [];

  for (const kw of allKeywords) {
    if (kw.isNegative === 1) continue;
    const vol = kw.monthlySearchVolume || 0;

    if (kw.strategyCategory && kw.strategyCategory !== "negative") {
      if (!byStrategy[kw.strategyCategory]) byStrategy[kw.strategyCategory] = [];
      byStrategy[kw.strategyCategory].push({
        keyword: kw.keyword,
        searchVolume: vol,
        spr: kw.spr || null,
        placement: kw.listingPlacement || null,
      });
    }

    if (kw.listingPlacement) {
      if (!byPlacement[kw.listingPlacement]) byPlacement[kw.listingPlacement] = [];
      byPlacement[kw.listingPlacement].push({
        keyword: kw.keyword,
        strategy: kw.strategyCategory || null,
        searchVolume: vol,
      });

      // Collect by placement type
      if (kw.listingPlacement.startsWith("title_")) titleKeywords.push(kw.keyword);
      if (kw.listingPlacement.startsWith("bullet_")) bulletKeywords.push(kw.keyword);
      if (kw.listingPlacement === "search_term") searchTermKeywords.push(kw.keyword);
    }

    if (kw.rootCategory) {
      if (!rootGroups[kw.rootCategory]) rootGroups[kw.rootCategory] = [];
      rootGroups[kw.rootCategory].push(kw.keyword);
      if (kw.rootCategory === "gift_holiday") holidayKeywords.push(kw.keyword);
    }
  }

  // Sort each group by search volume descending
  for (const key of Object.keys(byStrategy)) {
    byStrategy[key].sort((a, b) => b.searchVolume - a.searchVolume);
  }
  for (const key of Object.keys(byPlacement)) {
    byPlacement[key].sort((a, b) => b.searchVolume - a.searchVolume);
  }

  if (Object.keys(byStrategy).length === 0 && Object.keys(byPlacement).length === 0) return null;

  return { byStrategy, byPlacement, titleKeywords, bulletKeywords, searchTermKeywords, rootGroups, holidayKeywords };
}

// ─── Main Entry Point ────────────────────────────────────────────

export async function buildListingContext(projectId: number): Promise<ListingContext> {
  const [m1, m2, m3, m4] = await Promise.all([
    buildModule1(projectId),
    buildModule2(projectId),
    buildModule3(projectId),
    buildModule4(projectId),
  ]);
  return {
    productAttributes: m1,
    competitorInsights: m2,
    cosmoScenes: m3,
    keywordStrategy: m4,
  };
}

// ─── Data Readiness Check ────────────────────────────────────────

export async function checkDataReadiness(projectId: number): Promise<DataReadiness> {
  const files = await db.getProjectFilesByProject(projectId);
  const attrFile = files.find(f => f.fileType === "product_attributes" && f.status === "completed");

  const analyses = await db.getCompetitorAnalysesByProject(projectId);
  const reviewAgg = await db.getReviewAggregationByProject(projectId);

  const allKeywords = await db.getKeywordsByProject(projectId);
  const activeKeywords = allKeywords.filter(k => k.isNegative !== 1);
  const sceneTagged = activeKeywords.filter(k => k.sceneTags && safeParseJSON(k.sceneTags, []).length > 0);
  const strategyTagged = activeKeywords.filter(k => k.strategyCategory && k.strategyCategory !== "negative");

  const sceneRate = activeKeywords.length > 0 ? Math.round((sceneTagged.length / activeKeywords.length) * 100) : 0;

  return {
    module1: {
      ready: !!attrFile,
      detail: attrFile ? "本品属性表已上传并解析" : "本品属性表未上传",
    },
    module2: {
      ready: analyses.length > 0,
      detail: analyses.length > 0
        ? `已分析${analyses.length}个竞品ASIN${reviewAgg?.status === "completed" ? " + 评论聚合已完成" : ""}`
        : "未添加竞品分析",
      competitorCount: analyses.length,
      reviewAggReady: reviewAgg?.status === "completed" || false,
    },
    module3: {
      ready: sceneTagged.length > 0,
      detail: sceneTagged.length > 0
        ? `关键词场景打标完成率 ${sceneRate}%${sceneRate < 80 ? " (建议≥80%)" : ""}`
        : "关键词场景打标未完成",
      sceneTagCount: sceneTagged.length,
      completionRate: sceneRate,
    },
    module4: {
      ready: strategyTagged.length > 0,
      detail: strategyTagged.length > 0
        ? `关键词3D策略矩阵已完成 (${strategyTagged.length}个关键词)`
        : "关键词3D策略矩阵未完成",
      keywordCount: activeKeywords.length,
      strategyTaggedCount: strategyTagged.length,
    },
  };
}

// ─── Context to Text (for LLM prompts) ──────────────────────────

export function contextToPromptText(ctx: ListingContext, project: any): string {
  const parts: string[] = [];

  // Basic project info
  parts.push(`Product: ${project.productName || project.name}`);
  if (project.brand) parts.push(`Brand: ${project.brand}`);
  if (project.category) parts.push(`Category: ${project.category}`);
  if (project.targetMarket) parts.push(`Target Market: ${project.targetMarket}`);
  if (project.productFeatures) {
    const features = safeParseJSON(project.productFeatures, null);
    if (Array.isArray(features)) {
      parts.push(`Key Features:\n${features.map((f: string) => `- ${f}`).join("\n")}`);
    } else {
      parts.push(`Key Features: ${project.productFeatures}`);
    }
  }
  if (project.productSpecs) {
    const specs = safeParseJSON(project.productSpecs, null);
    if (specs && typeof specs === "object") {
      parts.push(`Specifications:\n${Object.entries(specs).map(([k, v]) => `- ${k}: ${v}`).join("\n")}`);
    } else {
      parts.push(`Specifications: ${project.productSpecs}`);
    }
  }

  // Module 1: Rufus Attributes
  if (ctx.productAttributes) {
    const m1 = ctx.productAttributes;
    parts.push("\n=== [Module 1] Rufus Product Attributes ===");
    if (m1.uniqueSellingPoints.length) parts.push(`USPs: ${m1.uniqueSellingPoints.join("; ")}`);
    if (m1.coreSpecs.length) parts.push(`Core Specs: ${m1.coreSpecs.map(s => `${s.attribute}: ${s.value}`).join("; ")}`);
    if (m1.materialBuild.length) parts.push(`Materials: ${m1.materialBuild.map(m => `${m.attribute}: ${m.value} (${m.sellingPoint})`).join("; ")}`);
    if (m1.performance.length) parts.push(`Performance: ${m1.performance.map(p => `${p.metric}: ${p.value}`).join("; ")}`);
    if (m1.safetyCompliance.length) parts.push(`Certifications: ${m1.safetyCompliance.map(s => `${s.certification}: ${s.detail}`).join("; ")}`);
    if (m1.rufusFriendlyAttributes.length) parts.push(`Rufus Attributes: ${m1.rufusFriendlyAttributes.join("; ")}`);
    if (m1.suggestedKeywords.length) parts.push(`Suggested Keywords: ${m1.suggestedKeywords.join(", ")}`);
  }

  // Module 2: Competitor Insights
  if (ctx.competitorInsights) {
    const m2 = ctx.competitorInsights;
    parts.push("\n=== [Module 2] Multi-Competitor Analysis ===");

    if (m2.parityPoints.length) {
      parts.push("Parity (Must-Have Selling Points):");
      m2.parityPoints.forEach(p => parts.push(`  - ${p}`));
    }

    if (m2.gapOpportunities.length) {
      parts.push("Gap Opportunities (Differentiation):");
      m2.gapOpportunities.forEach(g => parts.push(`  - ${g}`));
    }

    // Kano model
    const agg = m2.aggregatedReviews;
    if (agg.painPoints.length) {
      parts.push("Pain Points (痛点 - Must Address):");
      agg.painPoints.slice(0, 8).forEach(p => {
        parts.push(`  - ${p.point} (frequency: ${p.frequency}, severity: ${p.severity})`);
        if (p.listingAdvice) parts.push(`    → Listing advice: ${p.listingAdvice}`);
      });
    }
    if (agg.itchPoints.length) {
      parts.push("Itch Points (痒点 - Differentiation):");
      agg.itchPoints.slice(0, 6).forEach(p => {
        parts.push(`  - ${p.point} (frequency: ${p.frequency}, importance: ${p.importance})`);
      });
    }
    if (agg.delightPoints.length) {
      parts.push("Delight Points (爽点 - Emphasize):");
      agg.delightPoints.slice(0, 6).forEach(p => {
        parts.push(`  - ${p.point} (frequency: ${p.frequency}, impact: ${p.impact})`);
      });
    }

    // Individual competitor details
    if (m2.competitors.length) {
      parts.push("\nDetailed Competitor Data:");
      for (const c of m2.competitors) {
        parts.push(`\n  ASIN: ${c.asin}`);
        if (c.title) parts.push(`  Title: ${c.title}`);
        if (c.price) parts.push(`  Price: ${c.price}`);
        if (c.rating) parts.push(`  Rating: ${c.rating} (${c.reviewCount} reviews)`);
        if (c.bulletPoints.length) {
          parts.push(`  Bullets:`);
          c.bulletPoints.forEach((bp, i) => parts.push(`    ${i + 1}. ${bp}`));
        }
        if (c.keywords.core.length) parts.push(`  Core Keywords: ${c.keywords.core.join(", ")}`);
      }
    }
  }

  // Module 3: COSMO Scenes
  if (ctx.cosmoScenes) {
    const m3 = ctx.cosmoScenes;
    parts.push("\n=== [Module 3] COSMO Scene Mapping ===");
    if (m3.topScenes.length) {
      parts.push("Top Usage Scenes (by search volume):");
      m3.topScenes.forEach(s => {
        const volStr = s.totalVolume > 0 ? ` [volume: ${s.totalVolume.toLocaleString()}]` : "";
        parts.push(`  - ${s.scene} (${s.frequency} keywords${volStr}): ${s.keywords.slice(0, 5).join(", ")}`);
      });
    }
    if (Object.keys(m3.intentDistribution).length) {
      parts.push("Purchase Intent Distribution:");
      Object.entries(m3.intentDistribution)
        .sort(([, a], [, b]) => b.volume - a.volume)
        .forEach(([intent, data]) => {
          parts.push(`  - ${intent} [volume: ${data.volume.toLocaleString()}]: ${data.keywords.slice(0, 5).join(", ")}`);
        });
    }
  }

  // Module 4: A9 Keywords
  if (ctx.keywordStrategy) {
    const m4 = ctx.keywordStrategy;
    parts.push("\n=== [Module 4] A9 Keyword Strategy ===");

    const categoryLabels: Record<string, string> = {
      core_main: "Core Main (核心主词)",
      sub_core: "Sub-Core (次核心词)",
      precise_longtail: "Precise Long-tail (精准长尾词)",
      scene_intent: "Scene Intent (场景意图词)",
      longtail_main: "Long-tail Main (长尾主词)",
      observe_test: "Observe/Test (观察测试词)",
    };

    for (const [cat, label] of Object.entries(categoryLabels)) {
      const kws = m4.byStrategy[cat];
      if (kws?.length) {
        const details = kws.slice(0, 10).map(k => {
          const metrics: string[] = [];
          if (k.searchVolume > 0) metrics.push(`vol:${k.searchVolume.toLocaleString()}`);
          if (k.spr) metrics.push(`SPR:${k.spr}`);
          return metrics.length ? `${k.keyword}(${metrics.join(",")})` : k.keyword;
        });
        parts.push(`${label}: ${details.join(", ")}${kws.length > 10 ? ` (+${kws.length - 10} more)` : ""}`);
      }
    }

    const placementLabels: Record<string, string> = {
      title_front: "Title Front",
      title_mid: "Title Mid",
      title_end: "Title End",
      bullet_first: "Bullet First-line",
      bullet_body: "Bullet Body",
      aplus: "A+ Content",
      search_term: "Backend Search Terms",
    };

    parts.push("\nKeyword Placement Strategy:");
    for (const [placement, label] of Object.entries(placementLabels)) {
      const kws = m4.byPlacement[placement];
      if (kws?.length) {
        const details = kws.slice(0, 8).map(k =>
          k.searchVolume > 0 ? `${k.keyword}(${k.searchVolume.toLocaleString()})` : k.keyword
        );
        parts.push(`  ${label}: ${details.join(", ")}${kws.length > 8 ? ` (+${kws.length - 8} more)` : ""}`);
      }
    }

    if (m4.rootGroups && Object.keys(m4.rootGroups).length) {
      const rootLabels: Record<string, string> = {
        core: "Core Roots", function: "Function Roots", scene: "Scene Roots",
        audience: "Audience Roots", spec: "Spec Roots", painpoint: "Pain Point Roots",
        gift_holiday: "Gift/Holiday Roots",
      };
      parts.push("\nSemantic Root Map:");
      for (const [root, label] of Object.entries(rootLabels)) {
        const kws = m4.rootGroups[root];
        if (kws?.length) parts.push(`  ${label}: ${kws.slice(0, 8).join(", ")}`);
      }
    }
  }

  return parts.join("\n");
}
