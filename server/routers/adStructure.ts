import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import {
  createAdStructure, getAdStructuresByProject, getAdStructureById,
  updateAdStructure, deleteAdStructure, getProjectById,
  getKeywordsByProject,
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

// Helper: build competitor summary
function buildCompetitorSummary(project: any): string {
  // This will be enhanced later with actual competitor data
  const parts: string[] = [];
  if (project.brand) parts.push(`自有品牌: ${project.brand}`);
  parts.push("(竞品数据将从竞品分析模块获取)");
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
        // Get keywords for this project
        const keywords = await getKeywordsByProject(input.projectId);

        const productContext = buildProductContext(project);
        const keywordData = buildKeywordSummary(keywords);
        const competitorSummary = buildCompetitorSummary(project);

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
