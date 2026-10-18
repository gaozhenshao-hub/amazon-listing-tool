import { protectedProcedure, router } from "../_core/trpc";
import { ProductBoardReadInputSchema } from "../../shared/productBoardRead";
import { productBoardReadRepository } from "../domains/ops/productBoardReadRepository";

export const productBoardReadRouter = router({
  get: protectedProcedure.input(ProductBoardReadInputSchema).query(({ ctx, input }) => productBoardReadRepository.get(ctx, input)),
});
