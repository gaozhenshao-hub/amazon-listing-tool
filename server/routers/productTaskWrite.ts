import { protectedProcedure, router } from "../_core/trpc";
import { ProductTaskWriteOptionsInputSchema, ProductTaskWriteProductsInputSchema, ProductTaskWriteExecuteInputSchema, ProductTaskWriteRecoverInputSchema, ProductTaskWriteDownloadInputSchema } from "../../shared/productTaskWrite";
import { productTaskWriteRepository } from "../domains/ops/productTaskWriteRepository";

export const productTaskWriteRouter = router({
  options: protectedProcedure.input(ProductTaskWriteOptionsInputSchema).query(({ ctx, input }) => productTaskWriteRepository.options(ctx, input)),
  products: protectedProcedure.input(ProductTaskWriteProductsInputSchema).query(({ ctx, input }) => productTaskWriteRepository.products(ctx, input)),
  execute: protectedProcedure.input(ProductTaskWriteExecuteInputSchema).mutation(({ ctx, input }) => productTaskWriteRepository.execute(ctx, input)),
  recover: protectedProcedure.input(ProductTaskWriteRecoverInputSchema).mutation(({ ctx, input }) => productTaskWriteRepository.recover(ctx, input)),
  download: protectedProcedure.input(ProductTaskWriteDownloadInputSchema).mutation(({ ctx, input }) => productTaskWriteRepository.download(ctx, input)),
});
