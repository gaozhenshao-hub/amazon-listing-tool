import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { scoreListing } from "../scoringEngine";

export const scoringRouter = router({
  // Score the active listing for a project
  scoreListing: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await db.getProjectById(input.projectId, ctx.user.id);
      if (!project) throw new Error("Project not found");

      const listing = await db.getActiveListingByProject(input.projectId);
      if (!listing) {
        return null;
      }

      // Load A9 keyword data if available
      let a9Keywords: any = null;
      let coreKeywords: string[] = [];

      try {
        const database = await db.getDb();
        if (database) {
          const { projectFiles } = await import("../../drizzle/schema");
          const { eq, and } = await import("drizzle-orm");

          // Get A9 keywords file
          const a9Files = await database
            .select()
            .from(projectFiles)
            .where(
              and(
                eq(projectFiles.projectId, input.projectId),
                eq(projectFiles.fileType, "aba_keywords"),
                eq(projectFiles.status, "completed")
              )
            );

          if (a9Files.length > 0 && a9Files[0].analysisResult) {
            try {
              a9Keywords = JSON.parse(a9Files[0].analysisResult);
              
              // Extract core keywords from A9 data
              const titleKws = a9Keywords.titleMustHaveKeywords || a9Keywords.titleKeywords || [];
              const bulletKws = a9Keywords.bulletPointKeywords || a9Keywords.bulletKeywords || [];
              const goldenKws = a9Keywords.goldenLongTailKeywords || a9Keywords.goldenKeywords || [];
              
              coreKeywords = [
                ...titleKws.map((kw: any) => typeof kw === "string" ? kw : kw.keyword || kw.term || ""),
                ...bulletKws.map((kw: any) => typeof kw === "string" ? kw : kw.keyword || kw.term || ""),
                ...goldenKws.map((kw: any) => typeof kw === "string" ? kw : kw.keyword || kw.term || ""),
              ].filter(Boolean);
            } catch {}
          }

          // Also try to extract keywords from competitor analyses
          if (coreKeywords.length === 0) {
            const analyses = await db.getCompetitorAnalysesByProject(input.projectId);
            for (const analysis of analyses) {
              if (analysis.keywords) {
                try {
                  const kwData = JSON.parse(analysis.keywords);
                  if (kwData.coreKeywords) coreKeywords.push(...kwData.coreKeywords);
                  if (kwData.longTailKeywords) coreKeywords.push(...kwData.longTailKeywords.slice(0, 5));
                  if (kwData.trafficKeywords) coreKeywords.push(...kwData.trafficKeywords.slice(0, 5));
                } catch {}
              }
            }
          }
        }
      } catch (err) {
        console.warn("[Scoring] Failed to load keyword data:", err);
      }

      // Deduplicate keywords
      coreKeywords = Array.from(new Set(coreKeywords.map(k => k.toLowerCase())));

      return scoreListing(
        {
          title: listing.title,
          bulletPoints: listing.bulletPoints,
          description: listing.description,
          searchTerms: listing.searchTerms,
          titleCn: listing.titleCn,
          bulletPointsCn: listing.bulletPointsCn,
          descriptionCn: listing.descriptionCn,
          searchTermsCn: listing.searchTermsCn,
          imageAdvice: listing.imageAdvice,
        },
        a9Keywords,
        coreKeywords
      );
    }),
});
