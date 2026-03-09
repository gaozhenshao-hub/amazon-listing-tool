import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import {
  createAdStructure, getAdStructuresByProject, getAdStructureById,
  updateAdStructure, deleteAdStructure, getProjectById,
  getKeywordsByProject, getCompetitorAnalysesByProject,
} from "../db";
import { AD_STRUCTURE_PROMPT } from "../adStructurePrompt";

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

        const response = await invokeLLM({
          messages: [
            { role: "system", content: "你是一位资深亚马逊PPC广告专家，擅长设计广告架构和关键词投放策略。请严格按照JSON格式输出。" },
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

  // Delete an ad structure
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return deleteAdStructure(input.id);
    }),
});
