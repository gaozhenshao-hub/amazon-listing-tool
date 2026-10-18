import { afterEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import { assertLegacyInventoryPlanningWriteAllowed } from "./inventoryPlanningLegacyGate";

afterEach(() => vi.unstubAllEnvs());
describe("legacy inventory planning writer gate", () => {
  it("blocks old writers before any database operation when governed writes are enabled", () => {
    vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_PLANNING_WRITES", "true");
    const database = vi.fn();
    expect(() => { assertLegacyInventoryPlanningWriteAllowed(); database(); }).toThrow(TRPCError);
    expect(database).not.toHaveBeenCalled();
    expect(() => assertLegacyInventoryPlanningWriteAllowed()).toThrow(/UPGRADE_CLIENT/u);
  });
  it.each([undefined, "false", "TRUE", "1", ""]) ("retains compatibility when the explicit release switch is %s", value => {
    vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_PLANNING_WRITES", value);
    expect(() => assertLegacyInventoryPlanningWriteAllowed()).not.toThrow();
  });
  it("supports a stable sampled flag for integration tests without environment mutation", () => {
    expect(() => assertLegacyInventoryPlanningWriteAllowed(false)).not.toThrow();
    expect(() => assertLegacyInventoryPlanningWriteAllowed(true)).toThrow(/请刷新页面/u);
  });
});
