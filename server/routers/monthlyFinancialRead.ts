import { MonthlyFinancialHistoryInputSchema, MonthlyFinancialBatchInputSchema, MonthlyFinancialSnapshotInputSchema } from "../../shared/monthlyFinancialRead";
import { protectedProcedure, router } from "../_core/trpc";
import { monthlyFinancialReadRepository } from "../domains/ops/monthlyFinancialReadRepository";

/** No upload, confirmation, deletion, refresh, or file-download procedure. */
export const monthlyFinancialReadRouter = router({
  listBatches: protectedProcedure.input(MonthlyFinancialHistoryInputSchema)
    .query(({ ctx, input }) => monthlyFinancialReadRepository.listBatches(ctx, input)),
  getBatch: protectedProcedure.input(MonthlyFinancialBatchInputSchema)
    .query(({ ctx, input }) => monthlyFinancialReadRepository.getBatch(ctx, input)),
  getEffectiveSnapshot: protectedProcedure.input(MonthlyFinancialSnapshotInputSchema)
    .query(({ ctx, input }) => monthlyFinancialReadRepository.getEffectiveSnapshot(ctx, input)),
});
