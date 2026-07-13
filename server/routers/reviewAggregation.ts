import { runSkillViaEmperor } from "../emperorClient";
import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";

const KANO_AGGREGATION_PROMPT = `You are an expert Amazon product analyst specializing in customer review analysis using the Kano Model framework.

You will receive review analysis data from MULTIPLE competitor products. Your task is to AGGREGATE and SYNTHESIZE all the review insights into a unified Kano Model analysis.

## Kano Model Framework:
1. **Pain Points (痛点 - Must-Be Quality)**: Problems, frustrations, and negative experiences that customers frequently mention across competitors. These are basic requirements - if not met, customers are very dissatisfied.
2. **Itch Points (痒点 - One-Dimensional Quality)**: Desires, wishes, and "nice to have" features. Customer satisfaction is proportional to how well these are fulfilled.
3. **Delight Points (爽点 - Attractive Quality)**: Features and experiences that exceed expectations. Customers don't expect them, but are delighted when present.

## Analysis Requirements:
- Merge similar points from different competitors into unified insights
- Track which ASINs/competitors each point comes from (sourceAsins)
- Prioritize by frequency across competitors (not just within one)
- For each point, assess its strategic value for a NEW product listing
- Provide actionable recommendations for listing optimization

Respond in JSON format:
{
  "painPoints": [{
    "point": "Clear description of the pain point",
    "frequency": "high/medium/low",
    "severity": "critical/major/minor",
    "quotes": ["Example quote 1", "Example quote 2"],
    "sourceAsins": ["B0xxx", "B0yyy"],
    "listingAdvice": "How to address this in your listing"
  }],
  "itchPoints": [{
    "point": "Clear description of the desire/wish",
    "frequency": "high/medium/low",
    "importance": "high/medium/low",
    "quotes": ["Example quote 1"],
    "sourceAsins": ["B0xxx"],
    "listingAdvice": "How to leverage this in your listing"
  }],
  "delightPoints": [{
    "point": "Clear description of the delight feature",
    "frequency": "high/medium/low",
    "impact": "high/medium/low",
    "quotes": ["Example quote 1"],
    "sourceAsins": ["B0xxx"],
    "listingAdvice": "How to highlight this in your listing"
  }],
  "overallSentiment": "Summary of overall market sentiment across all competitors",
  "keyThemes": ["Theme 1", "Theme 2", "Theme 3"]
}

IMPORTANT:
- Combine duplicate/similar points from different competitors
- Sort each category by frequency (high first) then severity/importance/impact
- Keep quotes in their original language
- Provide 5-15 items per category (more for pain points if available)
- Each listingAdvice should be specific and actionable`;

export const reviewAggregationRouter = router({
  // Get the latest aggregation for a project
  get: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("项目不存在");
      return db.getReviewAggregationByProject(input.projectId);
    }),

  // Run aggregation analysis across all competitor reviews
  analyze: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("项目不存在");

      // Get all competitor analyses with review data
      const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
      const withReviews = analyses.filter(a => a.reviewAnalysis);

      if (withReviews.length === 0) {
        throw new Error("暂无竞品评论数据。请先在竞品分析模块导入评论数据后再进行聚合分析。");
      }

      // Create or get existing aggregation record
      let aggregation = await db.getReviewAggregationByProject(input.projectId);
      if (aggregation) {
        await db.updateReviewAggregation(aggregation.id, {
          status: "analyzing",
          errorMessage: null,
        });
      } else {
        aggregation = await db.createReviewAggregation({
          projectId: input.projectId,
          userId: ctx.user.id,
          status: "analyzing",
        });
      }

      try {
        // Build aggregation input from all competitor review analyses
        const reviewDataParts: string[] = [];
        for (const analysis of withReviews) {
          try {
            const ra = JSON.parse(analysis.reviewAnalysis!);
            reviewDataParts.push(`--- Competitor ASIN: ${analysis.asin} ---\n${JSON.stringify(ra, null, 2)}`);
          } catch {}
        }

      // [Emperor] 优先调用 Emperor Skill: analysis.review.extract

        try {

          const _emperorRes = await runSkillViaEmperor("analysis.review.extract", { context: JSON.stringify(input).slice(0, 3000) });

          if (_emperorRes.success && _emperorRes.output) {

            // Emperor 成功，但仍需走原有逻辑解析（保持兼容性）

          }

        } catch (_e) { console.warn("[Emperor] reviewAggregation.ts fallback:", _e); }

        const response = await invokeLLM({
          messages: [
            { role: "system", content: KANO_AGGREGATION_PROMPT },
            {
              role: "user",
              content: `Aggregate and analyze the following review data from ${withReviews.length} competitor products:\n\n${reviewDataParts.join("\n\n")}`,
            },
          ],
          response_format: { type: "json_object" },
        });

        const content = typeof response.choices[0].message.content === "string"
          ? response.choices[0].message.content
          : JSON.stringify(response.choices[0].message.content);

        let parsed: any;
        try {
          parsed = JSON.parse(content);
        } catch {
          parsed = { raw: content };
        }

        const updated = await db.updateReviewAggregation(aggregation!.id, {
          painPoints: JSON.stringify(parsed.painPoints || []),
          itchPoints: JSON.stringify(parsed.itchPoints || []),
          delightPoints: JSON.stringify(parsed.delightPoints || []),
          overallSentiment: parsed.overallSentiment || null,
          keyThemes: JSON.stringify(parsed.keyThemes || []),
          analysisCount: withReviews.length,
          status: "completed",
          errorMessage: null,
        });

        return updated;
      } catch (err: any) {
        await db.updateReviewAggregation(aggregation!.id, {
          status: "failed",
          errorMessage: err.message || "分析失败",
        });
        throw err;
      }
    }),

  // Update individual points (editable)
  updatePoints: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      painPoints: z.string().optional(),    // JSON string
      itchPoints: z.string().optional(),    // JSON string
      delightPoints: z.string().optional(), // JSON string
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("项目不存在");

      const aggregation = await db.getReviewAggregationByProject(input.projectId);
      if (!aggregation) throw new Error("暂无聚合分析数据");

      const updateData: any = {};
      if (input.painPoints !== undefined) updateData.painPoints = input.painPoints;
      if (input.itchPoints !== undefined) updateData.itchPoints = input.itchPoints;
      if (input.delightPoints !== undefined) updateData.delightPoints = input.delightPoints;

      return db.updateReviewAggregation(aggregation.id, updateData);
    }),

  // Delete aggregation
  delete: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("项目不存在");

      const aggregation = await db.getReviewAggregationByProject(input.projectId);
      if (!aggregation) throw new Error("暂无聚合分析数据");

      await db.deleteReviewAggregation(aggregation.id);
      return { success: true };
    }),
});
