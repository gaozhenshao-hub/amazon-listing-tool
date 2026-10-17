import { OperationsCostSheetReadInputSchema } from "../../shared/operationsCostSheetRead";
import { protectedProcedure, router } from "../_core/trpc";
import { costSheetReadRepository } from "../domains/ops/costSheetReadRepository";

/** Separate from legacy parameter reads and the friend's mutation router. */
export const productCostsReadOnlyRouter = router({
  get: protectedProcedure.input(OperationsCostSheetReadInputSchema)
    .query(({ ctx, input }) => costSheetReadRepository.read(ctx, input)),
});
