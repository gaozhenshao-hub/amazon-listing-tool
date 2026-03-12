import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import * as kbDb from "../kbDb";

export const kbSearchRouter = router({
  // Cross-module search
  search: protectedProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return kbDb.searchKnowledgeBase(ctx.user.id, input.query);
    }),

  // Get overall KB stats
  stats: protectedProcedure.query(async ({ ctx }) => {
    return kbDb.getKbStats(ctx.user.id);
  }),
});
