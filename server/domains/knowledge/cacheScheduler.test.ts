import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ sweep: vi.fn(), cleanup: vi.fn() }));
vi.mock("../acquisition/cacheExpiry", () => ({
  sweepKnowledgeCache: mocks.sweep,
}));
vi.mock("./assetLifecycle", () => ({ cleanupKnowledgeObjects: mocks.cleanup }));
vi.mock("../../repositories/dbClient", () => ({ requireDb: async () => ({}) }));
import { startKnowledgeCacheScheduler } from "./cacheScheduler";
beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  mocks.sweep.mockResolvedValue({ checked: 0 });
  mocks.cleanup.mockResolvedValue({ checked: 0 });
});
afterEach(() => vi.useRealTimers());
it("does not overlap work and drains accepted cleanup before shutdown", async () => {
  let resolve!: () => void;
  mocks.sweep.mockReturnValue(
    new Promise<{ checked: number }>(done => {
      resolve = () => done({ checked: 0 });
    })
  );
  const stop = startKnowledgeCacheScheduler();
  await vi.advanceTimersByTimeAsync(16 * 60_000);
  expect(mocks.sweep).toHaveBeenCalledTimes(1);
  let stopped = false;
  const stopping = stop().then(() => {
    stopped = true;
  });
  await Promise.resolve();
  expect(stopped).toBe(false);
  mocks.sweep.mockResolvedValue({ checked: 0 });
  resolve();
  await stopping;
  expect(mocks.cleanup).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(mocks.sweep).toHaveBeenCalledTimes(1);
});
it("cancels timers before the initial sweep if stopped immediately", async () => {
  await startKnowledgeCacheScheduler()();
  await vi.advanceTimersByTimeAsync(60 * 60_000);
  expect(mocks.sweep).not.toHaveBeenCalled();
});
