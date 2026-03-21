import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as kbDb from "../kbDb";

const scopeSchema = z.enum(["mine", "shared", "all"]).optional();

export const kbSearchRouter = router({
  // Cross-module search (original)
  search: protectedProcedure
    .input(z.object({ query: z.string().min(1), scope: scopeSchema }))
    .query(async ({ ctx, input }) => {
      return kbDb.searchKnowledgeBase(ctx.user.id, input.query, input.scope ?? "mine");
    }),

  // Enhanced search with type filter
  searchByType: protectedProcedure
    .input(z.object({
      query: z.string().min(1),
      type: z.enum(["product", "listing", "image", "skill", "video"]),
      limit: z.number().min(1).max(100).optional(),
      scope: scopeSchema,
    }))
    .query(async ({ ctx, input }) => {
      const allResults = await kbDb.searchKnowledgeBase(ctx.user.id, input.query, input.scope ?? "mine");
      const filtered = (allResults as any[]).filter((r: any) => r.type === input.type);
      return filtered.slice(0, input.limit || 20);
    }),

  // Search by ASIN across all knowledge bases
  searchByAsin: protectedProcedure
    .input(z.object({ asin: z.string().min(1), scope: scopeSchema }))
    .query(async ({ ctx, input }) => {
      const asin = input.asin.trim().toUpperCase();
      const allResults = await kbDb.searchKnowledgeBase(ctx.user.id, asin, input.scope ?? "mine");
      // Group by type for ASIN panoramic view
      const grouped: Record<string, any[]> = { product: [], listing: [], image: [], skill: [], video: [] };
      for (const item of allResults as any[]) {
        if (grouped[item.type]) {
          grouped[item.type].push(item);
        }
      }
      return { asin, results: grouped, totalCount: (allResults as any[]).length };
    }),

  // Get overall KB stats
  stats: protectedProcedure
    .input(z.object({ scope: scopeSchema }).optional())
    .query(async ({ ctx, input }) => {
      return kbDb.getKbStats(ctx.user.id, input?.scope ?? "mine");
    }),

  // Get confirmed knowledge items for RAG/AI reference (cross-module calling API)
  getConfirmedForRAG: protectedProcedure
    .input(z.object({
      type: z.enum(["product", "listing", "image", "skill", "video"]),
      limit: z.number().min(1).max(50).optional(),
      query: z.string().optional(),
    }))
    .query(async ({ ctx, input }) => {
      // RAG always uses "shared" scope to get confirmed items from all users
      if (input.query) {
        const results = await kbDb.searchKnowledgeBase(ctx.user.id, input.query, "shared");
        return (results as any[])
          .filter((r: any) => r.type === input.type && r.status === "confirmed")
          .slice(0, input.limit || 10);
      }
      // Return all confirmed items of the given type
      const allResults = await kbDb.searchKnowledgeBase(ctx.user.id, "", "shared");
      return (allResults as any[])
        .filter((r: any) => r.type === input.type && r.status === "confirmed")
        .slice(0, input.limit || 10);
    }),
});
