import { InventorySnapshotReadInputSchema } from "../../shared/inventorySnapshotRead";
import { protectedProcedure, router } from "../_core/trpc";
import { inventorySnapshotReadRepository } from "../domains/ops/inventorySnapshotReadRepository";

/** Saved data only: deliberately no refresh/sync/assignment mutations. */
export const inventorySnapshotReadRouter = router({
  get: protectedProcedure.input(InventorySnapshotReadInputSchema)
    .query(({ ctx, input }) => inventorySnapshotReadRepository.get(ctx, input)),
});
