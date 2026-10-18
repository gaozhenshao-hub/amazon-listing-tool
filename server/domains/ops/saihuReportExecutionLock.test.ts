import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createSaihuReportExecutionLock,
  SAIHU_REPORT_EXECUTION_LOCK,
  type SaihuReportLockConnection,
} from "./saihuReportExecutionLock";

export function createSaihuLockFixture() {
  const state = {
    owner: null as number | null,
    nextId: 1,
    fail: false,
    hang: false,
  };
  const calls: Array<{ id: number; sql: string; values: unknown[] }> = [];
  const connections: Array<{ id: number; destroyed: boolean; ended: boolean }> =
    [];
  const connect = async (): Promise<SaihuReportLockConnection> => {
    const session = { id: state.nextId++, destroyed: false, ended: false };
    connections.push(session);
    return {
      async query(options, values) {
        calls.push({ id: session.id, sql: options.sql, values });
        expect(values).toEqual([SAIHU_REPORT_EXECUTION_LOCK]);
        expect(options.timeout).toBeGreaterThan(0);
        if (state.hang) return new Promise(() => {});
        if (state.fail || session.destroyed)
          throw new Error("synthetic connection unavailable");
        if (options.sql.includes("GET_LOCK")) {
          if (state.owner !== null)
            return [[{ acquired: 0, connectionId: session.id }], []];
          state.owner = session.id;
          return [
            [
              {
                acquired: 1,
                connectionId: session.id,
                serverUuid: "00000000-0000-0000-0000-000000000001",
                databaseName: "synthetic",
              },
            ],
            [],
          ];
        }
        if (options.sql.includes("IS_USED_LOCK"))
          return [
            [
              {
                owner: state.owner,
                connectionId: session.id,
                serverUuid: "00000000-0000-0000-0000-000000000001",
                databaseName: "synthetic",
              },
            ],
            [],
          ];
        if (options.sql.includes("RELEASE_LOCK")) {
          if (state.owner !== session.id)
            throw new Error("wrong session release");
          state.owner = null;
          return [[{ released: 1 }], []];
        }
        throw new Error("unhandled synthetic SQL");
      },
      destroy() {
        session.destroyed = true;
        if (state.owner === session.id) state.owner = null;
      },
      async end() {
        session.ended = true;
        if (state.owner === session.id) state.owner = null;
      },
    };
  };
  return { state, calls, connections, connect };
}
afterEach(() => vi.useRealTimers());
describe("Saihu dedicated connection cross-process execution lock", () => {
  it("shares the original lock domain across independent instances and releases only its own session", async () => {
    const f = createSaihuLockFixture();
    const first = await createSaihuReportExecutionLock({
      connect: f.connect,
    })();
    expect(first).not.toBeNull();
    expect(
      await createSaihuReportExecutionLock({ connect: f.connect })()
    ).toBeNull();
    expect(f.state.owner).toBe(1);
    await first!.assertOwned();
    await first!.release();
    await first!.release();
    const second = await createSaihuReportExecutionLock({
      connect: f.connect,
    })();
    expect(second).not.toBeNull();
    await second!.release();
    expect(
      f.calls.filter(q => q.sql.includes("RELEASE_LOCK")).map(q => q.id)
    ).toEqual([1, 3]);
  });
  it("aborts a lost-owner lease without releasing another process's lock", async () => {
    const f = createSaihuLockFixture();
    const lock = await createSaihuReportExecutionLock({ connect: f.connect })();
    f.state.owner = 99;
    await expect(lock!.assertOwned()).rejects.toThrow("EXECUTION_LOCK_LOST");
    expect(lock!.signal.aborted).toBe(true);
    await lock!.release();
    expect(f.state.owner).toBe(99);
    expect(f.calls.some(q => q.sql.includes("RELEASE_LOCK"))).toBe(false);
  });
  it("heartbeat detects loss while HTTP is in flight and bounded query timeout destroys only its session", async () => {
    vi.useFakeTimers();
    const f = createSaihuLockFixture();
    const lock = await createSaihuReportExecutionLock({
      connect: f.connect,
      queryTimeoutMs: 25,
      heartbeatMs: 10,
    })();
    f.state.hang = true;
    await vi.advanceTimersByTimeAsync(35);
    expect(lock!.signal.aborted).toBe(true);
    expect(f.connections[0].destroyed).toBe(true);
    await lock!.release();
    expect(f.calls.filter(q => q.sql.includes("GET_LOCK"))).toHaveLength(1);
  });
  it("ambiguous lock acquisition never retries", async () => {
    const f = createSaihuLockFixture();
    f.state.fail = true;
    await expect(
      createSaihuReportExecutionLock({ connect: f.connect })()
    ).rejects.toThrow("EXECUTION_LOCK_UNAVAILABLE");
    expect(f.calls.filter(q => q.sql.includes("GET_LOCK"))).toHaveLength(1);
    expect(f.connections[0].destroyed).toBe(true);
  });
  it("destroys a late successful connection after timeout without querying or acquiring", async () => {
    vi.useFakeTimers();
    const f = createSaihuLockFixture();
    let resolve!: (value: SaihuReportLockConnection) => void;
    const connecting = new Promise<SaihuReportLockConnection>(done => {
      resolve = done;
    });
    const result = createSaihuReportExecutionLock({
      connect: () => connecting,
      queryTimeoutMs: 25,
    })();
    const expected = expect(result).rejects.toThrow(
      "EXECUTION_LOCK_UNAVAILABLE"
    );
    await vi.advanceTimersByTimeAsync(25);
    await expected;
    resolve(await f.connect());
    await Promise.resolve();
    expect(f.connections[0].destroyed).toBe(true);
    expect(f.calls).toHaveLength(0);
    expect(f.state.owner).toBeNull();
  });
  it("requires the actual business transaction to be on the same server and database", async () => {
    const f = createSaihuLockFixture();
    const lock = await createSaihuReportExecutionLock({ connect: f.connect })();
    await expect(
      lock!.assertDatabase({
        execute: async () => [
          [
            {
              serverUuid: "00000000-0000-0000-0000-000000000001",
              databaseName: "other",
            },
          ],
          [],
        ],
      })
    ).rejects.toThrow("EXECUTION_DATABASE_MISMATCH");
    expect(lock!.signal.aborted).toBe(true);
    await lock!.release();
  });
});
