import { protectedProcedure, router } from "../_core/trpc";
import { ProductTaskListInputSchema, ProductTaskDetailInputSchema } from "../../shared/productTaskRead";
import { productTaskReadRepository } from "../domains/ops/productTaskReadRepository";

export const productTaskReadRouter = router({
  list: protectedProcedure.input(ProductTaskListInputSchema).query(({ ctx, input }) => productTaskReadRepository.list(ctx, input)),
  detail: protectedProcedure.input(ProductTaskDetailInputSchema).query(({ ctx, input }) => productTaskReadRepository.detail(ctx, input)),
});
