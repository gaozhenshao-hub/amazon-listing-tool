import { protectedProcedure, router } from "../_core/trpc";
import { ProfitBoardReadInputSchema } from "../../shared/profitBoardRead";
import { profitBoardReadRepository } from "../domains/ops/profitBoardReadRepository";

export const profitBoardReadRouter = router({
  get: protectedProcedure.input(ProfitBoardReadInputSchema).query(({ ctx, input }) => profitBoardReadRepository.get(ctx, input)),
});
