import { TRPCError } from "@trpc/server";
import {
  createInventoryPlanningStateResolver,
  InventoryPlanningWriteError,
  type InventoryPlanningIdentity,
  type InventoryPlanningScope,
} from "../../../shared/inventoryPlanningWrite";

function unavailable(error: unknown): never {
  const reason = error instanceof InventoryPlanningWriteError ? error.code : "MANUAL_STATE_UNAVAILABLE";
  throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: `INVENTORY_PLANNING_${reason}: 人工库存或规划参数暂不可核验，未使用零库存或默认参数替代。请检查数据或重试。`,
  });
}

/** Read both complete actor-private histories. Missing/failed/invalid reads are
 * not evidence of an empty configuration. Validate/index once for the entire
 * planning table, then preserve child > store-country > workspace precedence. */
export async function loadInventoryPlanningManualReader(input: {
  identity: InventoryPlanningIdentity;
  loadParameters: () => Promise<unknown>;
  loadLocals: () => Promise<unknown>;
}) {
  try {
    const [parameters, locals] = await Promise.all([input.loadParameters(), input.loadLocals()]);
    const resolve = createInventoryPlanningStateResolver({ identity: input.identity, parameters, locals });
    return (scope: InventoryPlanningScope, asOfDate: string) => {
      try { return resolve(scope, asOfDate); } catch (error) { return unavailable(error); }
    };
  } catch (error) { return unavailable(error); }
}
