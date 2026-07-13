import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import {
  createAdStructure, getAdStructuresByProject, getAdStructureById,
  updateAdStructure, deleteAdStructure, getProjectById,
  getKeywordsByProject, getCompetitorAnalysesByProject,
} from "../db";
import { AD_STRUCTURE_PROMPT } from "../adStructurePrompt";
import { diagnoseAdViaEmperor, adviseAdSearchTermsViaEmperor, generateAdNegativeViaEmperor, allocateAdBudgetViaEmperor, generateAdStructureViaEmperor, suggestAdDaypartingViaEmperor } from "../emperorClient";

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

// Helper: build keyword data summary for the prompt
function buildKeywordSummary(keywords: any[]): string {
  if (!keywords.length) return "暂无关键词数据";

  const grouped: Record<string, any[]> = {};
  for (const kw of keywords) {
    const cat = kw.strategyCategory || "unclassified";
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(kw);
  }

  const lines: string[] = [];
  for (const [cat, kws] of Object.entries(grouped)) {
    lines.push(`\n### ${cat} (${kws.length}个):`);
    for (const kw of kws.slice(0, 20)) {
      const parts = [`- ${kw.keyword}`];
      if (kw.relevance) parts.push(`相关性:${kw.relevance}`);
      if (kw.trafficLevel) parts.push(`流量:${kw.trafficLevel}`);
      if (kw.competition) parts.push(`竞争:${kw.competition}`);
      if (kw.monthlySearchVolume) parts.push(`月搜索量:${kw.monthlySearchVolume}`);
      if (kw.ppcBid) parts.push(`PPC竞价:${kw.ppcBid}`);
      if (kw.spr) parts.push(`SPR:${kw.spr}`);
      if (kw.sceneTags) {
        try {
          const tags = JSON.parse(kw.sceneTags);
          if (tags.length) parts.push(`场景:${tags.join(",")}`);
        } catch { /* ignore */ }
      }
      lines.push(parts.join(" | "));
    }
    if (kws.length > 20) lines.push(`  ... 还有 ${kws.length - 20} 个`);
  }
  return lines.join("\n");
}

// Helper: build competitor summary from actual competitor analysis data
function buildCompetitorSummary(project: any, competitors: any[]): string {
  const parts: string[] = [];
  if (project.brand) parts.push(`自有品牌: ${project.brand}`);

  if (!competitors.length) {
    parts.push("暂无竞品分析数据");
    return parts.join("\n");
  }

  parts.push(`\n共有 ${competitors.length} 个竞品分析数据:\n`);

  for (const comp of competitors) {
    const compParts: string[] = [];
    compParts.push(`#### 竞品 ASIN: ${comp.asin}`);
    if (comp.title) compParts.push(`  标题: ${comp.title}`);
    if (comp.price) compParts.push(`  价格: ${comp.price}`);
    if (comp.rating) compParts.push(`  评分: ${comp.rating}`);
    if (comp.reviewCount) compParts.push(`  评论数: ${comp.reviewCount}`);

    // Extract keywords from competitor
    if (comp.keywords) {
      try {
        const kwData = JSON.parse(comp.keywords);
        const allKws: string[] = [];
        if (kwData.core) allKws.push(...kwData.core.slice(0, 5));
        if (kwData.longTail) allKws.push(...kwData.longTail.slice(0, 5));
        if (kwData.traffic) allKws.push(...kwData.traffic.slice(0, 5));
        if (allKws.length) compParts.push(`  关键词: ${allKws.join(", ")}`);
      } catch { /* ignore */ }
    }

    // Extract review insights
    if (comp.reviewAnalysis) {
      try {
        const review = JSON.parse(comp.reviewAnalysis);
        if (review.painPoints?.length) {
          compParts.push(`  痛点: ${review.painPoints.slice(0, 3).map((p: any) => typeof p === 'string' ? p : p.point || p.description).join("; ")}`);
        }
        if (review.delightPoints?.length) {
          compParts.push(`  好评点: ${review.delightPoints.slice(0, 3).map((p: any) => typeof p === 'string' ? p : p.point || p.description).join("; ")}`);
        }
      } catch { /* ignore */ }
    }

    // Extract bullet points for competitive intelligence
    if (comp.bulletPoints) {
      try {
        const bullets = JSON.parse(comp.bulletPoints);
        if (bullets.length) compParts.push(`  卖点数: ${bullets.length}条`);
      } catch { /* ignore */ }
    }

    parts.push(compParts.join("\n"));
  }

  parts.push(`\n竞品ASIN列表（可用于定投）: ${competitors.map((c: any) => c.asin).join(", ")}`);

  return parts.join("\n");
}

export const adStructureRouter = router({
  // Generate ad structure recommendation
  generate: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ input, ctx }) => {
      const project = await getProjectById(input.projectId, ctx.user!.id);
      if (!project) throw new Error("Project not found");

      // Create record first
      const record = await createAdStructure({
        projectId: input.projectId,
        userId: ctx.user!.id,
        status: "generating",
      });

      try {
        // Get keywords and competitor data for this project
        const [keywords, competitors] = await Promise.all([
          getKeywordsByProject(input.projectId),
          getCompetitorAnalysesByProject(input.projectId),
        ]);

        const productContext = buildProductContext(project);
        const keywordData = buildKeywordSummary(keywords);
        const competitorSummary = buildCompetitorSummary(project, competitors);

        const prompt = AD_STRUCTURE_PROMPT
          .replace("{productContext}", productContext)
          .replace("{keywordData}", keywordData)
          .replace("{competitorSummary}", competitorSummary);

        // Emperor Skill 优先 - 广告结构生成
        try {
          const emperorRes = await generateAdStructureViaEmperor(JSON.stringify(input).slice(0, 2000));
          if (emperorRes.success && emperorRes.output) return emperorRes.output;
        } catch (e) { console.warn("[Emperor] generateAdStructure fallback:", e); }

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "你是一位资深亚马逊PPC广告专家，擅长设计广告架构和关键词投放策略。请严格按照JSON格式输出。所有keyword字段和negativeKeywords字段必须保留英文原文，严禁翻译成中文。" },
            { role: "user", content: prompt },
          ],
        });

        const rawContent = response.choices?.[0]?.message?.content;
        const content = typeof rawContent === "string" ? rawContent : "";

        // Extract JSON from response
        let structureData: any;
        try {
          const jsonMatch = content.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            structureData = JSON.parse(jsonMatch[0]);
          } else {
            throw new Error("No JSON found in response");
          }
        } catch (parseErr) {
          throw new Error(`Failed to parse AI response: ${parseErr}`);
        }

        // Count campaigns and keywords
        const campaigns = structureData.adStructure?.campaigns || [];
        const totalKeywords = campaigns.reduce((sum: number, c: any) => sum + (c.keywords?.length || 0), 0);

        await updateAdStructure(record.id, {
          structureData: JSON.stringify(structureData),
          keywordCount: totalKeywords,
          campaignCount: campaigns.length,
          status: "completed",
        });

        return {
          id: record.id,
          structureData,
          keywordCount: totalKeywords,
          campaignCount: campaigns.length,
        };
      } catch (error: any) {
        await updateAdStructure(record.id, {
          status: "failed",
          errorMessage: error.message || "Unknown error",
        });
        throw error;
      }
    }),

  // Update ad structure (save user edits)
  update: protectedProcedure
    .input(z.object({
      id: z.number(),
      structureData: z.any(), // Full JSON structure data
    }))
    .mutation(async ({ input }) => {
      const existing = await getAdStructureById(input.id);
      if (!existing) throw new Error("Ad structure not found");

      // Recalculate counts from the edited data
      const campaigns = input.structureData?.adStructure?.campaigns || [];
      const totalKeywords = campaigns.reduce((sum: number, c: any) => sum + (c.keywords?.length || 0), 0);

      await updateAdStructure(input.id, {
        structureData: JSON.stringify(input.structureData),
        keywordCount: totalKeywords,
        campaignCount: campaigns.length,
      });

      return {
        id: input.id,
        structureData: input.structureData,
        keywordCount: totalKeywords,
        campaignCount: campaigns.length,
      };
    }),

  // Get all ad structures for a project
  getByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input }) => {
      const structures = await getAdStructuresByProject(input.projectId);
      return structures.map((s: any) => ({
        ...s,
        structureData: s.structureData ? JSON.parse(s.structureData) : null,
        structureDataCn: s.structureDataCn ? JSON.parse(s.structureDataCn) : null,
      }));
    }),

  // Get a single ad structure by ID
  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ input }) => {
      const structure = await getAdStructureById(input.id);
      if (!structure) return null;
      return {
        ...structure,
        structureData: structure.structureData ? JSON.parse(structure.structureData) : null,
        structureDataCn: structure.structureDataCn ? JSON.parse(structure.structureDataCn) : null,
      };
    }),

  // Estimate competitor ASIN targeting effectiveness
  estimateTargeting: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ input, ctx }) => {
      const project = await getProjectById(input.projectId, ctx.user!.id);
      if (!project) throw new Error("Project not found");

      const [competitors, keywords] = await Promise.all([
        getCompetitorAnalysesByProject(input.projectId),
        getKeywordsByProject(input.projectId),
      ]);

      if (!competitors.length) return { estimates: [], summary: null };

      // Build our keyword set for overlap calculation
      const ourKeywords = new Set(keywords.map(k => k.keyword.toLowerCase()));

      const estimates = competitors.map((comp: any) => {
        // 1. Rating score (lower rating = better opportunity, max 25)
        const rating = parseFloat(comp.rating) || 4.0;
        const ratingScore = rating <= 3.5 ? 25 : rating <= 4.0 ? 20 : rating <= 4.3 ? 15 : rating <= 4.5 ? 10 : 5;

        // 2. Review count score (more reviews = harder to compete, max 25)
        const reviewCount = parseInt(comp.reviewCount) || 0;
        const reviewScore = reviewCount < 100 ? 25 : reviewCount < 500 ? 20 : reviewCount < 1000 ? 15 : reviewCount < 5000 ? 10 : 5;

        // 3. Price gap score (higher competitor price = better opportunity for us, max 25)
        // Since project doesn't have a price field, we compare among competitors
        // Higher-priced competitors are better targets (customers may seek cheaper alternatives)
        let priceScore = 15; // default
        const compPrice = comp.price ? parseFloat(String(comp.price).replace(/[^0-9.]/g, "")) : 0;
        if (compPrice > 0) {
          // Calculate median competitor price for relative comparison
          const allPrices = competitors
            .map((c: any) => c.price ? parseFloat(String(c.price).replace(/[^0-9.]/g, "")) : 0)
            .filter((p: number) => p > 0);
          const avgPrice = allPrices.length > 0 ? allPrices.reduce((a: number, b: number) => a + b, 0) / allPrices.length : compPrice;
          const priceDiff = ((compPrice - avgPrice) / avgPrice) * 100;
          priceScore = priceDiff > 20 ? 25 : priceDiff > 5 ? 20 : priceDiff > -5 ? 15 : priceDiff > -20 ? 10 : 5;
        }

        // 4. Keyword overlap score (more overlap = more relevant target, max 25)
        let kwOverlap = 0;
        let compKeywords: string[] = [];
        if (comp.keywords) {
          try {
            const kwData = JSON.parse(comp.keywords);
            const allKws: string[] = [];
            if (kwData.core) allKws.push(...kwData.core);
            if (kwData.longTail) allKws.push(...kwData.longTail);
            if (kwData.traffic) allKws.push(...kwData.traffic);
            compKeywords = allKws.map(k => typeof k === 'string' ? k : '');
            if (compKeywords.length > 0 && ourKeywords.size > 0) {
              const overlap = compKeywords.filter(k => ourKeywords.has(k.toLowerCase())).length;
              kwOverlap = Math.round((overlap / Math.max(compKeywords.length, 1)) * 100);
            }
          } catch { /* ignore */ }
        }
        const kwScore = kwOverlap > 50 ? 25 : kwOverlap > 30 ? 20 : kwOverlap > 15 ? 15 : kwOverlap > 5 ? 10 : 5;

        const totalScore = ratingScore + reviewScore + priceScore + kwScore;
        const priority = totalScore >= 75 ? "high" : totalScore >= 55 ? "medium" : "low";

        // Extract review pain points for targeting rationale
        let painPoints: string[] = [];
        let delightPoints: string[] = [];
        if (comp.reviewAnalysis) {
          try {
            const review = JSON.parse(comp.reviewAnalysis);
            painPoints = (review.painPoints || []).slice(0, 3).map((p: any) => typeof p === 'string' ? p : p.point || p.description || '');
            delightPoints = (review.delightPoints || []).slice(0, 3).map((p: any) => typeof p === 'string' ? p : p.point || p.description || '');
          } catch { /* ignore */ }
        }

        return {
          asin: comp.asin,
          title: comp.title || "未知",
          brand: comp.brand || "未知",
          price: comp.price || "N/A",
          rating: rating,
          reviewCount: reviewCount,
          scores: {
            rating: ratingScore,
            review: reviewScore,
            price: priceScore,
            keywordOverlap: kwScore,
            total: totalScore,
          },
          priority,
          keywordOverlapPercent: kwOverlap,
          sharedKeywords: compKeywords.filter(k => ourKeywords.has(k.toLowerCase())).slice(0, 10),
          painPoints,
          delightPoints,
          recommendation: totalScore >= 75
            ? "强烈推荐定投：该竞品存在明显弱点，定投ROI预期较高"
            : totalScore >= 55
            ? "建议定投：该竞品有一定机会，可作为次要定投目标"
            : "观察为主：该竞品竞争力较强，建议谨慎投放或低竞价测试",
        };
      });

      // Sort by total score descending
      estimates.sort((a: any, b: any) => b.scores.total - a.scores.total);

      const summary = {
        totalCompetitors: estimates.length,
        highPriority: estimates.filter((e: any) => e.priority === "high").length,
        mediumPriority: estimates.filter((e: any) => e.priority === "medium").length,
        lowPriority: estimates.filter((e: any) => e.priority === "low").length,
        avgScore: Math.round(estimates.reduce((sum: number, e: any) => sum + e.scores.total, 0) / estimates.length),
      };

      return { estimates, summary };
    }),

  // Delete an ad structure
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return deleteAdStructure(input.id);
    }),
});
