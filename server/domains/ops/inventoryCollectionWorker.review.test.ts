import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./inventoryCollectionRepository", () => ({ inventoryCollectionRepository: {} }));
vi.mock("../../repositories/dbClient", () => ({ getDb: () => { throw new Error("real DB forbidden"); } }));
vi.mock("../ai_os/services/toolGateway/governanceCore", () => ({ decryptToolSecretValue: () => { throw new Error("real credentials forbidden"); } }));
import { createInventoryCollectionWorker, shouldProcessInventoryCollections } from "./inventoryCollectionWorker";
import { InventoryCollectionTransportError } from "./inventoryCollectionTransport";
import type { InventoryCollectionClaim } from "./inventoryCollectionRepository";
import type { InventorySnapshotCollection } from "../../../shared/inventorySnapshotCollection";

const claim: InventoryCollectionClaim = { jobId: 9, identity: { workspaceId: 7, userId: 3 }, operationId: "11111111-1111-4111-8111-111111111111", leaseToken: "a".repeat(64), leaseExpiresAt: 999999, context: { workspaceId: 7, connectionVersion: "b".repeat(64), mappingVersion: "c".repeat(64) } };
// Worker scheduling tests mock the collection boundary; source/proof validation
// is covered independently by the 101 shared collector tests and repository.
const collected = { sources: {}, proof: {} } as InventorySnapshotCollection;
function fixture() {
  const repository = { claimNext: vi.fn(async () => structuredClone(claim)), heartbeat: vi.fn(async () => true), complete: vi.fn(async () => null), fail: vi.fn(async () => null) };
  const credentials = vi.fn(async () => ({ workspaceId: 7, appId: "test-app", secret: "test-secret", connectionVersion: claim.context.connectionVersion }));
  const transport = vi.fn(() => vi.fn(async () => ({ httpStatus: 200, body: {}, receivedAt: 1, wireByteLength: 2 })));
  const collect = vi.fn(async () => collected), report = vi.fn(), enabled = vi.fn(() => true);
  const worker = createInventoryCollectionWorker({ repository, credentials, transport, collect, report, enabled });
  return { repository, credentials, transport, collect, report, enabled, worker };
}
afterEach(() => { vi.useRealTimers(); });

describe("independent inventory worker concurrency and uncertainty review", () => {
  it("a lost commit acknowledgement is unknown and never overwritten as failure", async () => {
    const f = fixture(); f.repository.complete.mockRejectedValue(new Error("commit acknowledgement lost"));
    await f.worker.tick(); expect(f.repository.complete).toHaveBeenCalledTimes(1); expect(f.repository.fail).not.toHaveBeenCalled(); expect(f.report).toHaveBeenCalledWith("result_unknown");
  });
  it("a lost claim acknowledgement never fetches data or guesses a failed job", async () => {
    const f = fixture(); f.repository.claimNext.mockRejectedValue(new Error("claim acknowledgement lost"));
    await f.worker.tick(); expect(f.collect).not.toHaveBeenCalled(); expect(f.repository.fail).not.toHaveBeenCalled(); expect(f.report).toHaveBeenCalledWith("tick_failed");
  });
  it("a rejected initial heartbeat aborts before reading credentials or source data", async () => {
    const f = fixture(); f.repository.heartbeat.mockResolvedValue(false); await f.worker.tick();
    expect(f.credentials).not.toHaveBeenCalled(); expect(f.transport).not.toHaveBeenCalled(); expect(f.repository.complete).not.toHaveBeenCalled(); expect(f.repository.fail).toHaveBeenCalledWith({ jobId: 9, leaseToken: claim.leaseToken, reasonCode: "lease_or_authority_lost" });
  });
  it("a background lost lease interrupts an in-flight collector and cannot publish", async () => {
    vi.useFakeTimers(); const f = fixture(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    f.repository.heartbeat.mockResolvedValueOnce(true).mockResolvedValue(false);
    f.collect.mockImplementation(async (input?: unknown) => { const signal = (input as { signal: AbortSignal }).signal; entered(); await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })); return collected; });
    const active = f.worker.tick(); await started; await vi.advanceTimersByTimeAsync(30000); await active;
    expect(f.repository.heartbeat).toHaveBeenCalledTimes(2); expect(f.repository.complete).not.toHaveBeenCalled(); expect(f.repository.fail).toHaveBeenCalledTimes(1);
  });
  it("turning the gate off during collection aborts before completion", async () => {
    const f = fixture(); f.collect.mockImplementation(async () => { f.enabled.mockReturnValue(false); return collected; }); await f.worker.tick();
    expect(f.repository.complete).not.toHaveBeenCalled(); expect(f.repository.fail).toHaveBeenCalledWith({ jobId: 9, leaseToken: claim.leaseToken, reasonCode: "collection_disabled" });
  });
  it("stop aborts pending source work and future ticks remain stopped", async () => {
    const f = fixture(); let entered!: () => void; const started = new Promise<void>(resolve => { entered = resolve; });
    f.collect.mockImplementation(async (input?: unknown) => { const signal = (input as { signal: AbortSignal }).signal; entered(); await new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("stopped")), { once: true })); return collected; });
    const active = f.worker.tick(); await started; await f.worker.stop(); await active; await f.worker.tick();
    expect(f.repository.claimNext).toHaveBeenCalledTimes(1); expect(f.repository.complete).not.toHaveBeenCalled(); expect(f.repository.fail).toHaveBeenCalledWith({ jobId: 9, leaseToken: claim.leaseToken, reasonCode: "worker_stopped" });
  });
  it("concurrent ticks share one active claim/collector instead of parallel fetches", async () => {
    const f = fixture(); let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; }); f.collect.mockImplementation(async () => { await gate; return collected; });
    const first = f.worker.tick(), second = f.worker.tick(); expect(first).toBe(second); release(); await first;
    expect(f.repository.claimNext).toHaveBeenCalledTimes(1); expect(f.collect).toHaveBeenCalledTimes(1); expect(f.repository.complete).toHaveBeenCalledTimes(1);
  });
  it.each(["workspace", "version"])("changed credential %s is rejected before transport creation", async field => {
    const f = fixture(); f.credentials.mockResolvedValue({ workspaceId: field === "workspace" ? 8 : 7, appId: "test-app", secret: "test-secret", connectionVersion: field === "version" ? "d".repeat(64) : claim.context.connectionVersion });
    await f.worker.tick(); expect(f.transport).not.toHaveBeenCalled(); expect(f.repository.complete).not.toHaveBeenCalled(); expect(f.repository.fail).toHaveBeenCalledTimes(1);
  });
  it("failed failure acknowledgement is recorded as unknown, not silently retried", async () => {
    const f = fixture(); f.collect.mockRejectedValue(new Error("source invalid")); f.repository.fail.mockRejectedValue(new Error("failure acknowledgement lost")); await f.worker.tick();
    expect(f.collect).toHaveBeenCalledTimes(1); expect(f.repository.fail).toHaveBeenCalledTimes(1); expect(f.report).toHaveBeenCalledWith("failure_unknown");
  });
  it("persists deadline failure explicitly without publishing any collected partial snapshot", async () => {
    const f = fixture(); f.collect.mockRejectedValue(new InventoryCollectionTransportError("collection_deadline")); await f.worker.tick();
    expect(f.repository.complete).not.toHaveBeenCalled(); expect(f.repository.fail).toHaveBeenCalledWith({ jobId: 9, leaseToken: claim.leaseToken, reasonCode: "collection_deadline" });
  });
  it("gate off never claims jobs and default web role does not start collection", async () => {
    const f = fixture(); f.enabled.mockReturnValue(false); await f.worker.tick(); expect(f.repository.claimNext).not.toHaveBeenCalled();
    expect(shouldProcessInventoryCollections("web", {})).toBe(false);
    expect(shouldProcessInventoryCollections("web", { ENABLE_MERGED_OPS_INVENTORY_COLLECTION: "true" })).toBe(false);
    expect(shouldProcessInventoryCollections("worker", { ENABLE_MERGED_OPS_INVENTORY_COLLECTION: "true" })).toBe(true);
    expect(shouldProcessInventoryCollections("scheduler", { ENABLE_MERGED_OPS_INVENTORY_COLLECTION: "true" })).toBe(false);
  });
});
