import { describe, expect, it, vi } from "vitest";
import { createSchedulerShutdown } from "./schedulerShutdown";
import { createTrackedSchedulerWork } from "./trackedSchedulerWork";
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
describe("actual scheduler drain and cleanup boundary", () => {
  it("stops all admissions immediately but retains the lock and DB through work plus bookkeeping", async () => {
    const fetch = deferred(), commit = deferred(), tracker = createTrackedSchedulerWork(), events: string[] = [];
    void tracker.run(async () => { events.push("started"); await fetch.promise; events.push("bookkeeping"); await commit.promise; });
    const shutdown = createSchedulerShutdown({ stops: [() => { events.push("stop-a"); tracker.stop(); return tracker.drain(); }, () => { events.push("stop-b"); }], graceMs: 1000,
      releaseLock: async () => { events.push("release"); }, closeDatabase: async () => { events.push("close"); }, onDeadline: vi.fn(), onDrained: () => { events.push("drained"); } });
    const stopped = shutdown("SIGTERM"); expect(events).toEqual(["stop-a", "stop-b"]); await delay(2); expect(events).toEqual(["stop-a", "stop-b", "started"]);
    fetch.resolve(); await delay(2); expect(events).toContain("bookkeeping"); expect(events).not.toContain("release");
    await tracker.run(async () => { events.push("late-new-work"); }); commit.resolve(); await stopped;
    expect(events).toEqual(["stop-a", "stop-b", "started", "bookkeeping", "release", "close", "drained"]);
  });
  it("a real timer deadline reports not-drained and never races cleanup ahead of delayed work", async () => {
    const work = deferred(), release = vi.fn(async () => {}), close = vi.fn(async () => {}), deadline = vi.fn(), drained = vi.fn();
    const stop = createSchedulerShutdown({ stops: [() => work.promise], graceMs: 5, releaseLock: release, closeDatabase: close, onDeadline: deadline, onDrained: drained });
    const result = stop("SIGTERM"); await delay(15); expect(deadline).toHaveBeenCalledWith(false); expect(release).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(drained).not.toHaveBeenCalled();
    expect(stop("SIGINT")).toBe(result); work.resolve(); await result; expect(release).toHaveBeenCalledTimes(1); expect(close).toHaveBeenCalledTimes(1); expect(drained).toHaveBeenCalledWith(false);
  });
  it("leader loss during draining updates ownership and never releases a lock it no longer owns", async () => {
    const work = deferred(), release = vi.fn(async () => {}), close = vi.fn(async () => {}), drained = vi.fn();
    const stop = createSchedulerShutdown({ stops: [() => work.promise], graceMs: 1000, releaseLock: release, closeDatabase: close, onDeadline: vi.fn(), onDrained: drained });
    const result = stop("SIGTERM"); expect(stop("leader_lock_lost")).toBe(result); expect(close).not.toHaveBeenCalled(); work.resolve(); await result;
    expect(release).not.toHaveBeenCalled(); expect(close).toHaveBeenCalledTimes(1); expect(drained).toHaveBeenCalledWith(true);
  });
  it("a synchronous stop failure still closes every other admission but cannot claim verified cleanup", async () => {
    const second = vi.fn(), release = vi.fn(async () => {}), close = vi.fn(async () => {}), drained = vi.fn();
    const stop = createSchedulerShutdown({ stops: [() => { throw new Error("synthetic stop failure"); }, second], graceMs: 1000, releaseLock: release, closeDatabase: close, onDeadline: vi.fn(), onDrained: drained });
    await expect(stop("SIGTERM")).rejects.toThrow("SCHEDULER_DRAIN_UNVERIFIED"); expect(second).toHaveBeenCalledTimes(1); expect(release).not.toHaveBeenCalled(); expect(close).not.toHaveBeenCalled(); expect(drained).not.toHaveBeenCalled();
  });
  it("tracks dynamically accepted child work and rejected work until settled", async () => {
    const child = deferred(), tracker = createTrackedSchedulerWork(); let running: Promise<void> | undefined;
    await tracker.run(async () => { running = tracker.run(async () => { await child.promise; throw new Error("synthetic business failure"); }); void running.catch(() => undefined); });
    tracker.stop(); let done = false; const drain = tracker.drain().then(() => { done = true; }); await delay(2); expect(done).toBe(false); child.resolve(); await drain; expect(tracker.pendingCount).toBe(0); await expect(running).rejects.toThrow("synthetic business failure");
  });
});
