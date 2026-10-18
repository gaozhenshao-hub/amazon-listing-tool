import { protectedProcedure, router } from "../_core/trpc";
import { InventoryPlanningReadInputSchema, InventoryPlanningExecuteInputSchema, InventoryPlanningRecoverInputSchema } from "../../shared/inventoryPlanningWrite";
import { inventoryPlanningWriteRepository } from "../domains/ops/inventoryPlanningWriteRepository";

export const inventoryPlanningWriteRouter = router({
  read: protectedProcedure.input(InventoryPlanningReadInputSchema).query(({ ctx, input }) => inventoryPlanningWriteRepository.read(ctx, input)),
  execute: protectedProcedure.input(InventoryPlanningExecuteInputSchema).mutation(({ ctx, input }) => inventoryPlanningWriteRepository.execute(ctx, input)),
  recover: protectedProcedure.input(InventoryPlanningRecoverInputSchema).mutation(({ ctx, input }) => inventoryPlanningWriteRepository.recover(ctx, input)),
});
