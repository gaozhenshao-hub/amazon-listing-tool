import { describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { createImagePlanningQueue, createImagePlanningWorker, createImagePlanningProcessor, type ImagePlanningQueueHint } from "./imagePlanningWorker";
import { createImagePlanningTestFixture, planningOperation } from "./imagePlanning.testFixture";
const hint: ImagePlanningQueueHint = { id: 1, workspaceId: 7, userId: 3, projectId: 8, sessionId: 9, operationId: planningOperation };
function queueFixture(records: unknown[] = [hint]) {
  const control = { enabled: true }, queries: string[] = [], dialect = new MySqlDialect();
  const tx = { execute: vi.fn(async query => { queries.push(dialect.sqlToQuery(query).sql); return [records, []]; }) };
  const database = vi.fn(async () => ({ transaction: async <T,>(work: (executor: typeof tx) => Promise<T>) => work(tx) }));
  const schemaReady = vi.fn(async () => {});
  return { control, tx, queries, database, schemaReady, read: createImagePlanningQueue({ enabled: () => control.enabled, database, schemaReady }) };
}
describe("image planning bounded private queue and worker", () => {
  it("disabled discovery makes no database calls and rejects invalid bounds before I/O", async () => {
    const f = queueFixture(); f.control.enabled = false; expect(await f.read()).toEqual([]); expect(f.database).not.toHaveBeenCalled();
    await expect(f.read(-1)).rejects.toThrow(); await expect(f.read(0, 26)).rejects.toThrow(); expect(f.database).not.toHaveBeenCalled();
  });
  it("reads only ordered ID hints for the exact private kind, never body/result or SQL writes", async () => {
    const f = queueFixture(); expect(await f.read()).toEqual([hint]); expect(f.schemaReady).toHaveBeenCalledTimes(1);
    const query = f.queries[0]; expect(query).toContain("kind=?"); expect(query).toContain("leaseUntil<=NOW(6)"); expect(query).toContain("ORDER BY id LIMIT ?");
    expect(query).not.toMatch(/SELECT \*|contentJson|sourceHash|candidate|INSERT|UPDATE|DELETE/u);
  });
  it.each([{ records: [{ ...hint, workspaceId: null }] }, { records: [{ ...hint, id: 0 }] }, { records: [{ ...hint, operationId: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" }] }, { records: [hint, hint] }, { records: [{ ...hint, privateBody: "NO" }] }])("rejects invalid hint records without partial delivery", async ({ records }) => {
    const f = queueFixture(records); await expect(f.read()).rejects.toThrow();
  });
  it("rechecks disablement inside transaction and after the last read", async () => {
    const f = queueFixture(); f.schemaReady.mockImplementation(async () => { f.control.enabled = false; }); expect(await f.read()).toEqual([]); expect(f.tx.execute).not.toHaveBeenCalled();
    const g = queueFixture(); g.tx.execute.mockImplementation(async () => { g.control.enabled = false; return [[hint], []]; }); expect(await g.read()).toEqual([]);
  });
  it("restarting an expired dispatched job marks unknown without another provider attempt", async () => {
    const f = createImagePlanningTestFixture(); await f.submitted();
    f.control.afterDispatch = async () => { f.control.now += 121; throw new Error("SYNTHETIC_PROCESS_CRASH"); };
    const process = createImagePlanningProcessor({ repository: f.repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => true });
    await process(hint); expect((await f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).run?.state).toBe("dispatched");
    await process(hint); expect((await f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).run?.state).toBe("outcome_unknown"); expect(f.providerContexts).toHaveLength(1);
  });
  it("does not dispatch when shutdown happens while the lease transaction is pending", async () => {
    const f = createImagePlanningTestFixture(); await f.submitted(); const controller = new AbortController();
    const original = f.repository.claim.bind(f.repository);
    const repository = { ...f.repository, claim: async (...args: Parameters<typeof original>) => {
      const lease = await original(...args); controller.abort(); return lease;
    } };
    const process = createImagePlanningProcessor({ repository, runtime: f.runtime, loadConfiguration: async () => f.configuration, enabled: () => true });
    await process(hint, controller.signal);
    expect(f.providerContexts).toHaveLength(0);
    expect((await f.repository.check(f.identity, { ...f.scope, operationId: planningOperation })).run?.dispatch).toBeNull();
  });
  it("coalesces ticks, advances the fair cursor and stops without starting new work", async () => {
    let finish!: () => void;
    const process = vi.fn(async (_hint: ImagePlanningQueueHint, signal?: AbortSignal) => { await new Promise<void>(resolve => { finish = resolve; }); expect(signal?.aborted).toBe(true); });
    const discover = vi.fn(async () => [hint]), worker = createImagePlanningWorker({ discover, process, enabled: () => true, intervalMs: 100000 });
    const first = worker.tick(), second = worker.tick(); expect(first).toBe(second); await Promise.resolve(); expect(process).toHaveBeenCalledTimes(1);
    const stop = worker.stop(); finish(); await stop; await worker.tick(); expect(discover).toHaveBeenCalledTimes(1);
  });
  it("moves past previous hints, then resets the cursor only after the end of the bounded queue", async () => {
    const discover = vi.fn(async () => [] as ImagePlanningQueueHint[]).mockResolvedValueOnce([hint]), process = vi.fn(async () => {});
    const worker = createImagePlanningWorker({ discover, process, enabled: () => true, intervalMs: 100000 });
    await worker.tick(); await worker.tick(); await worker.tick(); await worker.stop();
    expect(discover.mock.calls).toEqual([[0, 10], [1, 10], [0, 10]]);
  });
  it("bounds shutdown even if an in-flight provider ignores abort, without starting another job", async () => {
    let finish!: () => void;
    const process = vi.fn(async (_hint: ImagePlanningQueueHint, signal?: AbortSignal) => {
      await new Promise<void>(resolve => { finish = resolve; }); expect(signal?.aborted).toBe(true);
    });
    const discover = vi.fn(async () => [hint]), worker = createImagePlanningWorker({ discover, process, enabled: () => true, intervalMs: 100000 });
    const running = worker.tick(); await Promise.resolve(); expect(process).toHaveBeenCalledOnce();
    await worker.stop(1); await worker.tick();
    expect(process).toHaveBeenCalledOnce(); expect(discover).toHaveBeenCalledOnce();
    finish(); await running;
  });
});
