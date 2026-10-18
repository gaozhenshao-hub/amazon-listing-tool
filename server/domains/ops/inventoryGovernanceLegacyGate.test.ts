import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { assertLegacyInventoryGovernanceWriteAllowed } from "./inventoryGovernanceLegacyGate";

afterEach(() => vi.unstubAllEnvs());
describe("inventory governance legacy cutoff", () => {
  it.each([undefined, "", "false", "TRUE", "1"])("keeps old entry behavior before explicit true rollout (%s)", value => {
    vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES", value);
    expect(() => assertLegacyInventoryGovernanceWriteAllowed()).not.toThrow();
  });
  it("blocks legacy callers with an explicit upgrade message while enabled", () => {
    vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES", "true");
    expect(() => assertLegacyInventoryGovernanceWriteAllowed()).toThrow("INVENTORY_GOVERNANCE_UPGRADE_CLIENT");
    expect(() => assertLegacyInventoryGovernanceWriteAllowed(false)).not.toThrow();
  });
  it("cuts off the manual legacy handler after input parsing and before database access", () => {
    const source = readFileSync(new URL("../../routers/dataImport.ts", import.meta.url), "utf8");
    const handler = source.slice(source.indexOf("  restoreAsinLifecycleStatus:"), source.indexOf("  confirmLocalInventory:"));
    expect(handler.indexOf(".input(")).toBeLessThan(handler.indexOf("assertLegacyInventoryGovernanceWriteAllowed();"));
    expect(handler.indexOf("assertLegacyInventoryGovernanceWriteAllowed();")).toBeLessThan(handler.indexOf("await getDb()"));
  });
  it("both existing automatic callers use the same gate-routed export without changing the old helper", () => {
    const data = readFileSync(new URL("../../routers/dataImport.ts", import.meta.url), "utf8"), lx = readFileSync(new URL("../../routers/lingxingSync.ts", import.meta.url), "utf8");
    expect(data).toContain('process.env.ENABLE_MERGED_OPS_INVENTORY_GOVERNANCE_WRITES === "true"');
    expect(data).toContain("await refreshGovernedZeroValueDiscontinuationStatuses(db, workspaceId)");
    expect(data.match(/await refreshZeroValueDiscontinuationStatuses\(/gu)?.length).toBeGreaterThanOrEqual(1);
    expect(lx).toContain('await import("./dataImport")'); expect(lx).toContain("await refreshZeroValueDiscontinuationStatuses(db, workspaceId)");
  });
});
