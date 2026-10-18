import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IntelScheduler } from "./intelAutoCollect";
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
const source = { id: 1, userId: 3, name: "SYNTHETIC", url: "https://example.invalid", sourceType: "rss", autoCollectInterval: "daily", autoCollectCron: null, consecutiveFailures: 0 };
const collectionResult = { totalFound: 1, totalNew: 1, totalRecommended: 0 };
function fixture() {
  const select = vi.fn().mockResolvedValueOnce([source]).mockResolvedValue([]), update = vi.fn().mockResolvedValue(undefined), collect = vi.fn().mockResolvedValue(collectionResult);
  const db = { select: () => ({ from: () => ({ where: select }) }), update: () => ({ set: () => ({ where: update }) }) };
  const database = vi.fn(async () => db);
  const scheduler = new IntelScheduler({ database: database as never, collect: collect as never }); return { scheduler, select, update, collect, database };
}
beforeEach(() => { vi.useFakeTimers(); vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {}); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("Intel scheduler full async drain", () => {
  it("cancels the original ten-second trigger as well as the interval", async () => { const f = fixture(); f.scheduler.start(); await f.scheduler.stop(); await vi.advanceTimersByTimeAsync(120000); expect(f.database).not.toHaveBeenCalled(); expect(f.collect).not.toHaveBeenCalled(); });
  it("waits for a check already reading sources but does not start new collections after stop", async () => { const f = fixture(), rows = deferred<never[]>(); f.select.mockReset().mockReturnValueOnce(rows.promise).mockResolvedValue([]); f.scheduler.start(); await vi.advanceTimersByTimeAsync(10000); let done = false; const stop = f.scheduler.stop().then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false); rows.resolve([source] as never[]); await stop; expect(f.collect).not.toHaveBeenCalled(); expect(f.scheduler.isActive()).toBe(false); });
  it("retains an active background collection through its nextRun bookkeeping", async () => { const f = fixture(), fetch = deferred<unknown>(), commit = deferred<void>(); f.collect.mockReturnValue(fetch.promise); f.update.mockReturnValue(commit.promise); f.scheduler.start(); await vi.advanceTimersByTimeAsync(10000); expect(f.collect).toHaveBeenCalledTimes(1); let done = false; const stop = f.scheduler.stop().then(() => { done = true; }); expect(f.scheduler.getActiveCollections()).toEqual([1]); fetch.resolve(collectionResult); await vi.advanceTimersByTimeAsync(0); expect(f.update).toHaveBeenCalledTimes(1); expect(done).toBe(false); commit.resolve(); await stop; expect(f.scheduler.getActiveCollections()).toEqual([]); await vi.advanceTimersByTimeAsync(120000); expect(f.collect).toHaveBeenCalledTimes(1); });
  it("does not restart a new timer while the preceding stop is still draining", async () => { const f = fixture(), fetch = deferred<unknown>(); f.collect.mockReturnValue(fetch.promise); f.scheduler.start(); await vi.advanceTimersByTimeAsync(10000); const stop = f.scheduler.stop(); f.scheduler.start(); expect(f.scheduler.isActive()).toBe(false); fetch.resolve(collectionResult); await stop; f.scheduler.start(); expect(f.scheduler.isActive()).toBe(true); await f.scheduler.stop(); });
});
