import { protectedProcedure, router } from "../_core/trpc";
import { InventorySnapshotRefreshOptionsInputSchema, InventorySnapshotRefreshStartInputSchema, InventorySnapshotRefreshReadRunInputSchema, InventorySnapshotRefreshRecoverInputSchema } from "../../shared/inventorySnapshotRefresh";
import { inventoryCollectionRepository } from "../domains/ops/inventoryCollectionRepository";
export const inventorySnapshotRefreshRouter = router({
  options: protectedProcedure.input(InventorySnapshotRefreshOptionsInputSchema).query(({ ctx, input }) => inventoryCollectionRepository.options(ctx, input)),
  refresh: protectedProcedure.input(InventorySnapshotRefreshStartInputSchema).mutation(({ ctx, input }) => inventoryCollectionRepository.refresh(ctx, input)),
  readRun: protectedProcedure.input(InventorySnapshotRefreshReadRunInputSchema).query(({ ctx, input }) => inventoryCollectionRepository.readRun(ctx, input)),
  recover: protectedProcedure.input(InventorySnapshotRefreshRecoverInputSchema).mutation(({ ctx, input }) => inventoryCollectionRepository.recover(ctx, input)),
});
