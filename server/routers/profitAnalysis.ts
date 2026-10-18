import { protectedProcedure, router } from "../_core/trpc";
import { ProfitAnalysisPreviewInputSchema, ProfitAnalysisPreviewResultSchema } from "../../shared/profitAnalysis";
import { profitAnalysisSnapshotRepository } from "../domains/ops/profitAnalysisSnapshotRepository";
import { ProfitAnalysisStartInputSchema, ProfitAnalysisOperationInputSchema, ProfitAnalysisSaveInputSchema,
  ProfitAnalysisSaveOperationInputSchema, ProfitAnalysisHistoryInputSchema } from "../../shared/profitAnalysisWorkflow";
import { ProfitAnalysisWorkflowViewResultSchema, ProfitAnalysisWorkflowHistoryResultSchema,
  ProfitAnalysisWorkflowSaveResultSchema, ProfitAnalysisWorkflowCancelResultSchema } from "../../shared/profitAnalysisWorkflowRead";
import { profitAnalysisService } from "../domains/ops/profitAnalysisService";

/** Mutations only persist private jobs or explicitly save a completed draft.
 * HTTP never waits for the model. Writes/worker and approved Qingdao sources
 * remain independently gated; preview retains its existing read-only contract. */
export const profitAnalysisRouter = router({
  preview: protectedProcedure.input(ProfitAnalysisPreviewInputSchema).output(ProfitAnalysisPreviewResultSchema)
    .query(({ ctx, input }) => profitAnalysisSnapshotRepository.get(ctx, input)),
  options: protectedProcedure.input(ProfitAnalysisPreviewInputSchema).output(ProfitAnalysisWorkflowViewResultSchema)
    .query(({ ctx, input }) => profitAnalysisService.options(ctx, input)),
  start: protectedProcedure.input(ProfitAnalysisStartInputSchema).output(ProfitAnalysisWorkflowViewResultSchema)
    .mutation(({ ctx, input }) => profitAnalysisService.start(ctx, input)),
  check: protectedProcedure.input(ProfitAnalysisOperationInputSchema).output(ProfitAnalysisWorkflowViewResultSchema)
    .query(({ ctx, input }) => profitAnalysisService.check(ctx, input)),
  cancel: protectedProcedure.input(ProfitAnalysisOperationInputSchema).output(ProfitAnalysisWorkflowCancelResultSchema)
    .mutation(({ ctx, input }) => profitAnalysisService.cancel(ctx, input)),
  history: protectedProcedure.input(ProfitAnalysisHistoryInputSchema).output(ProfitAnalysisWorkflowHistoryResultSchema)
    .query(({ ctx, input }) => profitAnalysisService.history(ctx, input)),
  save: protectedProcedure.input(ProfitAnalysisSaveInputSchema).output(ProfitAnalysisWorkflowSaveResultSchema)
    .mutation(({ ctx, input }) => profitAnalysisService.save(ctx, input)),
  checkSave: protectedProcedure.input(ProfitAnalysisSaveOperationInputSchema).output(ProfitAnalysisWorkflowSaveResultSchema)
    .query(({ ctx, input }) => profitAnalysisService.checkSave(ctx, input)),
  cancelSave: protectedProcedure.input(ProfitAnalysisSaveOperationInputSchema).output(ProfitAnalysisWorkflowSaveResultSchema)
    .mutation(({ ctx, input }) => profitAnalysisService.cancelSave(ctx, input)),
});
