import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { invokeLLM } from "../_core/llm";
import * as db from "../db";
import { COMPETITOR_ANALYSIS_PROMPT, REVIEW_ANALYSIS_PROMPT } from "../prompts";

export const analysisRouter = router({
  // Get all analyses for a project
  listByProject: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      // Verify project ownership
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");
      return db.getCompetitorAnalysesByProject(input.projectId);
    }),

  // Analyze a competitor ASIN - uses LLM to simulate data extraction and analysis
  analyzeAsin: protectedProcedure
    .input(z.object({
      projectId: z.number(),
      asin: z.string().min(10).max(10),
      competitorTitle: z.string().optional(),
      competitorBulletPoints: z.string().optional(),
      competitorReviews: z.string().optional(),
      competitorPrice: z.string().optional(),
      competitorRating: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      // Update project status
      await db.updateProject(input.projectId, ctx.user.id, { status: "analyzing" });

      // Build context for LLM analysis
      const contextParts: string[] = [];
      contextParts.push(`ASIN: ${input.asin}`);
      if (input.competitorTitle) contextParts.push(`Title: ${input.competitorTitle}`);
      if (input.competitorBulletPoints) contextParts.push(`Bullet Points:\n${input.competitorBulletPoints}`);
      if (input.competitorPrice) contextParts.push(`Price: ${input.competitorPrice}`);
      if (input.competitorRating) contextParts.push(`Rating: ${input.competitorRating}`);

      // Analyze competitor data with LLM
      const analysisResponse = await invokeLLM({
        messages: [
          { role: "system", content: COMPETITOR_ANALYSIS_PROMPT },
          { role: "user", content: `Analyze this competitor product:\n\n${contextParts.join("\n\n")}` },
        ],
        response_format: { type: "json_object" },
      });

      const analysisContent = typeof analysisResponse.choices[0].message.content === "string"
        ? analysisResponse.choices[0].message.content
        : JSON.stringify(analysisResponse.choices[0].message.content);

      let analysisData: any = {};
      try {
        analysisData = JSON.parse(analysisContent);
      } catch {
        analysisData = { raw: analysisContent };
      }

      // If reviews are provided, analyze them separately
      let reviewAnalysis: any = null;
      if (input.competitorReviews) {
        const reviewResponse = await invokeLLM({
          messages: [
            { role: "system", content: REVIEW_ANALYSIS_PROMPT },
            { role: "user", content: `Analyze these customer reviews:\n\n${input.competitorReviews}` },
          ],
          response_format: { type: "json_object" },
        });

        const reviewContent = typeof reviewResponse.choices[0].message.content === "string"
          ? reviewResponse.choices[0].message.content
          : JSON.stringify(reviewResponse.choices[0].message.content);

        try {
          reviewAnalysis = JSON.parse(reviewContent);
        } catch {
          reviewAnalysis = { raw: reviewContent };
        }
      }

      // Save analysis to database
      const saved = await db.createCompetitorAnalysis({
        projectId: input.projectId,
        asin: input.asin,
        title: input.competitorTitle ?? null,
        bulletPoints: input.competitorBulletPoints ? JSON.stringify(input.competitorBulletPoints.split("\n").filter(Boolean)) : null,
        price: input.competitorPrice ?? null,
        rating: input.competitorRating ?? null,
        reviewAnalysis: reviewAnalysis ? JSON.stringify(reviewAnalysis) : null,
        keywords: analysisData.keywords ? JSON.stringify(analysisData.keywords) : null,
        rawData: JSON.stringify(analysisData),
      });

      return {
        ...saved,
        parsedAnalysis: analysisData,
        parsedReviewAnalysis: reviewAnalysis,
      };
    }),

  // Delete an analysis
  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ input }) => {
      return db.deleteCompetitorAnalysis(input.id);
    }),
});
