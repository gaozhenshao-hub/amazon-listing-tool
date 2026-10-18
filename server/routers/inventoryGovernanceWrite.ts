import { protectedProcedure, router } from "../_core/trpc";
import { InventoryGovernanceReadInputSchema, InventoryGovernanceExecuteInputSchema, InventoryGovernanceRecoverInputSchema } from "../../shared/inventoryGovernanceWrite";
import { inventoryGovernanceWriteRepository } from "../domains/ops/inventoryGovernanceWriteRepository";

export const inventoryGovernanceWriteRouter = router({
  read: protectedProcedure.input(InventoryGovernanceReadInputSchema).query(({ ctx, input }) => inventoryGovernanceWriteRepository.read(ctx, input)),
  execute: protectedProcedure.input(InventoryGovernanceExecuteInputSchema).mutation(({ ctx, input }) => inventoryGovernanceWriteRepository.execute(ctx, input)),
  recover: protectedProcedure.input(InventoryGovernanceRecoverInputSchema).mutation(({ ctx, input }) => inventoryGovernanceWriteRepository.recover(ctx, input)),
});
