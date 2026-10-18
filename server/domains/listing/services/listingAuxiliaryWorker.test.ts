import { describe, expect, it, vi } from "vitest";
import { createListingAuxiliaryTestFixture, listingOperationId } from "./listingAuxiliary.testFixture";
import { createListingAuxiliaryQueue, createListingAuxiliaryProcessor, createListingAuxiliaryWorker } from "./listingAuxiliaryWorker";
const queue = (f: ReturnType<typeof createListingAuxiliaryTestFixture>) => createListingAuxiliaryQueue({ database: async () => f.database, schema: async () => undefined, enabled: () => f.control.enabled });
describe("configured Listing dedicated queue and bounded stop", () => {
  it("discovers only metadata from canonical scalar job input and applies the keyset", async () => {
    const f = createListingAuxiliaryTestFixture(); await f.submitted();
    expect(await queue(f)()).toEqual([{ id: 101, ...f.identity, projectId: 8, operationId: listingOperationId }]);
    expect(await queue(f)(101)).toEqual([]);
    expect(f.calls.filter(call => call.sql.includes("WHERE kind=?")).every(call => call.sql.includes("CAST(JSON_UNQUOTE(input) AS JSON)") && !call.sql.includes("SELECT *"))).toBe(true);
  });
  it("does not discover a fresh lease or a terminal unknown dispatch for generic retry", async () => {
    const f = createListingAuxiliaryTestFixture(); await f.submitted();
    f.state.jobs[0].leaseUntil = f.control.now + 1; expect(await queue(f)()).toEqual([]);
    f.state.jobs[0].leaseUntil = null; f.state.jobs[0].status = "failed"; expect(await queue(f)()).toEqual([]);
  });
  it("flags off performs no database discovery", async () => {
    const database = vi.fn(); expect(await createListingAuxiliaryQueue({ database, enabled: () => false })()).toEqual([]); expect(database).not.toHaveBeenCalled();
  });
  it("abort while claim awaits cannot dispatch a provider", async () => {
    const f = createListingAuxiliaryTestFixture(); await f.submitted(); const controller = new AbortController();
    const repository = { ...f.repository, claim: async (...args: Parameters<typeof f.repository.claim>) => { const lease = await f.repository.claim(...args); controller.abort(); return lease; } };
    await createListingAuxiliaryProcessor({ repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => true })({ id: 101, ...f.identity, projectId: 8, operationId: listingOperationId }, controller.signal);
    expect(f.providerInputs).toHaveLength(0); expect(JSON.parse(String(f.state.jobs[0].output)).steps).toEqual([]);
  });
  it("rejects a stop timeout while paid cleanup remains active, then drains its actual settlement", async () => {
    const f = createListingAuxiliaryTestFixture(); await f.submitted();
    let entered!: () => void, release!: () => void;
    const cleaning = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
    const repository = { ...f.repository, returned: async (...args: Parameters<typeof f.repository.returned>) => { entered(); await held; return f.repository.returned(...args); } };
    const process = createListingAuxiliaryProcessor({ repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => f.control.enabled });
    vi.useFakeTimers();
    const worker = createListingAuxiliaryWorker({ discover: queue(f), process, enabled: () => f.control.enabled, intervalMs: 100000 });
    const work = worker.tick();
    try {
      await cleaning; expect(f.providerInputs).toHaveLength(1);
      const stopped = expect(worker.stop(10)).rejects.toThrow("LISTING_AUXILIARY_WORKER_STOP_TIMEOUT");
      await vi.advanceTimersByTimeAsync(10); await stopped;
      expect(JSON.parse(String(f.state.jobs[0].output)).state).toBe("dispatched");
      let drained = false; const laterStop = worker.stop(1000).then(() => { drained = true; });
      await Promise.resolve(); expect(drained).toBe(false);
      f.control.enabled = false; release(); await work; await laterStop;
      expect(JSON.parse(String(f.state.jobs[0].output)).state).toBe("succeeded");
      expect(drained).toBe(true); expect(f.providerInputs).toHaveLength(1);
      await worker.stop(); await worker.tick(); expect(f.providerInputs).toHaveLength(1);
    } finally { release(); await work; vi.useRealTimers(); }
  });
  it("deduplicates concurrent ticks and drains the same active processor on stop", async () => {
    let release!: () => void; let signal: AbortSignal | undefined;
    const discover = vi.fn(async () => [{ id: 101, userId: 3, workspaceId: 7, projectId: 8, operationId: listingOperationId }]);
    const process = vi.fn(async (_hint, current: AbortSignal | undefined) => { signal = current; await new Promise<void>(resolve => { release = resolve; }); });
    const worker = createListingAuxiliaryWorker({ discover, process, enabled: () => true, intervalMs: 100000 });
    const first = worker.tick(); expect(worker.tick()).toBe(first); await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const stopped = worker.stop(); expect(signal?.aborted).toBe(true); release(); await Promise.all([first, stopped]); await worker.tick();
    expect(process).toHaveBeenCalledOnce(); expect(discover).toHaveBeenCalledOnce();
  });
});
