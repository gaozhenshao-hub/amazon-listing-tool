import { TRPCError } from "@trpc/server";

/** Rollout requires draining the old writers before enabling this boundary. */
export function assertLegacyInventoryGovernanceWriteAllowed(
  enabled = process.env.ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES === "true",
): void {
  if (enabled) throw new TRPCError({
    code: "PRECONDITION_FAILED",
    message: "INVENTORY_GOVERNANCE_UPGRADE_CLIENT: 旧库存治理接口已暂停，请刷新页面，使用带范围、版本和操作编号核对的新入口。",
  });
}
