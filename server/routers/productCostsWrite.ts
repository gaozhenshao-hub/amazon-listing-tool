import { protectedProcedure, router } from "../_core/trpc";
import { OperationsCostSheetWriteOptionsInputSchema, OperationsCostSheetWriteSaveInputSchema, OperationsCostSheetWriteRecoverInputSchema } from "../../shared/operationsCostSheetWrite";
import { costSheetWriteRepository } from "../domains/ops/costSheetWriteRepository";

export const productCostsWriteRouter = router({
  options: protectedProcedure.input(OperationsCostSheetWriteOptionsInputSchema).query(({ ctx, input }) => costSheetWriteRepository.options(ctx, input)),
  save: protectedProcedure.input(OperationsCostSheetWriteSaveInputSchema).mutation(({ ctx, input }) => costSheetWriteRepository.save(ctx, input)),
  recover: protectedProcedure.input(OperationsCostSheetWriteRecoverInputSchema).mutation(({ ctx, input }) => costSheetWriteRepository.recover(ctx, input)),
});
