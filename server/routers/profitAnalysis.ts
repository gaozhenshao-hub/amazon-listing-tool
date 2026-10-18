import { protectedProcedure, router } from "../_core/trpc";
import { ProfitAnalysisPreviewInputSchema, ProfitAnalysisPreviewResultSchema } from "../../shared/profitAnalysis";
import { profitAnalysisSnapshotRepository } from "../domains/ops/profitAnalysisSnapshotRepository";

/** Read-only evidence preparation. No mutation or Skill dispatch is exposed
 * until the dedicated durable workflow and Qingdao source approval are ready. */
export const profitAnalysisRouter = router({
  preview: protectedProcedure.input(ProfitAnalysisPreviewInputSchema).output(ProfitAnalysisPreviewResultSchema)
    .query(({ ctx, input }) => profitAnalysisSnapshotRepository.get(ctx, input)),
});
