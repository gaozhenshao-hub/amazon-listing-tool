import { protectedProcedure, router } from "../_core/trpc";
import {
  MonthlyFinancialWriteOptionsInputSchema, MonthlyFinancialWriteUploadInputSchema, MonthlyFinancialWriteInspectInputSchema,
  MonthlyFinancialWriteConfirmInputSchema, MonthlyFinancialWriteRevokeInputSchema, MonthlyFinancialWriteRecoverInputSchema, MonthlyFinancialWriteDownloadInputSchema,
} from "../../shared/monthlyFinancialWrite";
import { monthlyFinancialWriteRepository } from "../domains/ops/monthlyFinancialWriteRepository";

export const monthlyFinancialWriteRouter = router({
  options: protectedProcedure.input(MonthlyFinancialWriteOptionsInputSchema).query(({ ctx, input }) => monthlyFinancialWriteRepository.options(ctx, input)),
  upload: protectedProcedure.input(MonthlyFinancialWriteUploadInputSchema).mutation(({ ctx, input }) => monthlyFinancialWriteRepository.upload(ctx, input)),
  inspect: protectedProcedure.input(MonthlyFinancialWriteInspectInputSchema).query(({ ctx, input }) => monthlyFinancialWriteRepository.inspect(ctx, input)),
  confirm: protectedProcedure.input(MonthlyFinancialWriteConfirmInputSchema).mutation(({ ctx, input }) => monthlyFinancialWriteRepository.confirm(ctx, input)),
  revoke: protectedProcedure.input(MonthlyFinancialWriteRevokeInputSchema).mutation(({ ctx, input }) => monthlyFinancialWriteRepository.revoke(ctx, input)),
  recover: protectedProcedure.input(MonthlyFinancialWriteRecoverInputSchema).mutation(({ ctx, input }) => monthlyFinancialWriteRepository.recover(ctx, input)),
  download: protectedProcedure.input(MonthlyFinancialWriteDownloadInputSchema).mutation(({ ctx, input }) => monthlyFinancialWriteRepository.download(ctx, input)),
});
