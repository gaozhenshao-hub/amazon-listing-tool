import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createInventoryCollectionWorker, shouldProcessInventoryCollections, startInventoryCollectionWorker } from "./inventoryCollectionWorker";
import { InventoryCollectionTransportError } from "./inventoryCollectionTransport";
import type { InventoryCollectionClaim } from "./inventoryCollectionRepository";
import { inventoryCollectionPageRequest } from "../../../shared/inventorySnapshotCollection";
const claim: InventoryCollectionClaim = { jobId: 1, identity: { userId: 3, workspaceId: 7 }, operationId: "12345678-1234-4234-8234-123456789abc", leaseToken: "f".repeat(64), leaseExpiresAt: 120000, context: { workspaceId: 7, connectionVersion: "a".repeat(64), mappingVersion: "b".repeat(64) } };
function setup() {
  let enabled = true;
  const repository = { claimNext: vi.fn().mockResolvedValue(structuredClone(claim)), heartbeat: vi.fn().mockResolvedValue(true), complete: vi.fn().mockResolvedValue({ outcome: "committed" }), fail: vi.fn().mockResolvedValue({ outcome: "failed" }) };
  const credentials = vi.fn().mockResolvedValue({ workspaceId: 7, appId: "synthetic", secret: "private", connectionVersion: claim.context.connectionVersion });
  const transportRead = vi.fn().mockResolvedValue({}), transport = vi.fn().mockReturnValue(transportRead), collect = vi.fn().mockResolvedValue({ sources: {}, proof: {} }), report = vi.fn();
  return { repository, credentials, transportRead, transport, collect, report, setEnabled: (value: boolean) => { enabled = value; }, worker: createInventoryCollectionWorker({ repository, credentials, transport, collect, report, enabled: () => enabled }) };
}
beforeEach(() => vi.useFakeTimers());
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });
describe("manual collection runtime", () => {
  it.each(["web", "worker", "scheduler", "all"] as const)("default off for %s", role => expect(shouldProcessInventoryCollections(role, {})).toBe(false));
  it("requires explicit embedded opt-in and never starts scheduler as collector", () => {
    const env = { ENABLE_MERGED_OPS_INVENTORY_COLLECTION: "true" };
    expect(shouldProcessInventoryCollections("web", env)).toBe(false); expect(shouldProcessInventoryCollections("scheduler", env)).toBe(false);
    expect(shouldProcessInventoryCollections("worker", env)).toBe(true); expect(shouldProcessInventoryCollections("all", env)).toBe(true);
    expect(shouldProcessInventoryCollections("web", { ...env, INVENTORY_COLLECTION_IN_PROCESS: "true" })).toBe(true);
  });
  it("off start creates no timer or queue read", async () => { vi.stubEnv("ENABLE_MERGED_OPS_INVENTORY_COLLECTION", "false"); const stop = startInventoryCollectionWorker("all"); expect(vi.getTimerCount()).toBe(0); await stop(); });
  it("off tick and empty queue do not read vendor or create work", async () => { const t = setup(); t.setEnabled(false); await t.worker.tick(); expect(t.repository.claimNext).not.toHaveBeenCalled(); t.setEnabled(true); t.repository.claimNext.mockResolvedValue(null); await t.worker.tick(); expect(t.credentials).not.toHaveBeenCalled(); expect(t.collect).not.toHaveBeenCalled(); });
  it("hydrates credentials only after fresh claim heartbeat, and completes once", async () => { const t = setup(); await t.worker.tick(); expect(t.repository.heartbeat).toHaveBeenCalledTimes(2); expect(t.repository.complete).toHaveBeenCalledWith({ jobId: 1, leaseToken: claim.leaseToken, sources: {}, proof: {} }); expect(t.repository.fail).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); });
  it("lost claim acknowledgement has no credential/fetch or fail replay", async () => { const t = setup(); t.repository.claimNext.mockRejectedValue(new Error("private DB")); await t.worker.tick(); expect(t.credentials).not.toHaveBeenCalled(); expect(t.repository.fail).not.toHaveBeenCalled(); expect(t.report).toHaveBeenCalledWith("tick_failed"); });
  it("lost complete acknowledgement never turns a possibly committed snapshot into failure", async () => { const t = setup(); t.repository.complete.mockRejectedValue(new Error("ACK lost")); await t.worker.tick(); expect(t.repository.complete).toHaveBeenCalledTimes(1); expect(t.repository.fail).not.toHaveBeenCalled(); expect(t.collect).toHaveBeenCalledTimes(1); expect(t.report).toHaveBeenCalledWith("result_unknown"); });
  it("failed first heartbeat prevents credentials and collection", async () => { const t = setup(); t.repository.heartbeat.mockResolvedValue(false); await t.worker.tick(); expect(t.credentials).not.toHaveBeenCalled(); expect(t.repository.complete).not.toHaveBeenCalled(); expect(t.repository.fail).toHaveBeenCalledWith({ jobId: 1, leaseToken: claim.leaseToken, reasonCode: "lease_or_authority_lost" }); });
  it("changed credential workspace/version never invokes transport", async () => { const t = setup(); t.credentials.mockResolvedValue({ workspaceId: 8, connectionVersion: "x" }); await t.worker.tick(); expect(t.transport).not.toHaveBeenCalled(); expect(t.repository.complete).not.toHaveBeenCalled(); });
  it("sanitizes arbitrary failure reason while keeping known transport code", async () => { const a = setup(); a.collect.mockRejectedValue(new Error("sensitive rows")); await a.worker.tick(); expect(a.repository.fail.mock.calls[0][0].reasonCode).toBe("collection_failed"); const b = setup(); b.collect.mockRejectedValue(new InventoryCollectionTransportError("collection_deadline")); await b.worker.tick(); expect(b.repository.fail.mock.calls[0][0].reasonCode).toBe("collection_deadline"); });
  it("flag off during collect prevents publish", async () => { const t = setup(); t.collect.mockImplementation(async () => { t.setEnabled(false); return { sources: {}, proof: {} }; }); await t.worker.tick(); expect(t.repository.complete).not.toHaveBeenCalled(); expect(t.repository.fail.mock.calls[0][0].reasonCode).toBe("collection_disabled"); });
  it("wraps every vendor call with current flag check and meaningful source progress", async () => { const t = setup(); t.collect.mockImplementation(async ({ read }) => { await read(inventoryCollectionPageRequest("fba", 1)); await vi.advanceTimersByTimeAsync(30000); t.setEnabled(false); await read(inventoryCollectionPageRequest("shipping", 1)); }); await t.worker.tick(); expect(t.transportRead).toHaveBeenCalledTimes(1); expect(t.repository.heartbeat).toHaveBeenCalledWith({ jobId: 1, leaseToken: claim.leaseToken, progress: { source: "fba", completedSources: 2, totalSources: 10 } }); expect(t.repository.complete).not.toHaveBeenCalled(); });
  it("stop is permanent and idle stop has no new claim", async () => { const t = setup(); await t.worker.stop(); await t.worker.tick(); expect(t.repository.claimNext).not.toHaveBeenCalled(); });
});
