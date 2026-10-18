import { TRPCError } from "@trpc/server";

/** Old clients cannot bypass full-record CAS while the governed editor is on.
 * Rolling the feature back retains legacy compatibility; it never replays a
 * pending governed operation, whose UUID remains recoverable separately. */
export function assertLegacyInventoryPlanningWriteAllowed(
  enabled = process.env.ENABLE_MERGED_OPS_INVENTORY_PLANNING_WRITES === "true",
): void {
  if (enabled) throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "INVENTORY_PLANNING_UPGRADE_CLIENT: 请刷新页面，使用带版本核对的人工库存与参数编辑器；旧保存接口已暂停。",
  });
}
