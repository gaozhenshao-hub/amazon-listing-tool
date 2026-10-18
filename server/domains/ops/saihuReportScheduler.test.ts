import { afterEach, describe, expect, it, vi } from "vitest";
import { createSaihuReportScheduler } from "./saihuReportScheduler";
import { createSaihuReportScheduleTestFixture } from "./saihuReportScheduleTestFixture";
afterEach(() => vi.useRealTimers());
describe("Saihu leader-owned queue-only scheduler slice", () => {
  it("default off never discovers workspaces, seeds, reads provider or queues", async () => {
    const discover = vi.fn(),
      s = createSaihuReportScheduler({ enabled: () => false, discover });
    await s.start()();
    await s.tick();
    expect(discover).not.toHaveBeenCalled();
  });
  it("two competing ticks use the actual same-TX plan cursor and produce one immutable occurrence/job", async () => {
    const f = createSaihuReportScheduleTestFixture();
    await f.save();
    await f.activate();
    const deps = {
        repository: f.schedules,
        enabled: () => true,
        discover: async () => [{ identity: f.identity, planId: f.planId }],
      },
      a = createSaihuReportScheduler(deps),
      b = createSaihuReportScheduler(deps);
    await Promise.all([a.tick(), b.tick()]);
    expect(f.state.jobs).toHaveLength(1);
    expect(f.state.artifacts).toHaveLength(1);
    expect(f.state.daily).toHaveLength(0);
    await a.stop();
    await b.stop();
  });
  it("stop drains an accepted queue commit; it does not just clear the timer or declare an unknown commit complete", async () => {
    vi.useFakeTimers();
    const f = createSaihuReportScheduleTestFixture();
    let entered!: () => void, release!: () => void;
    const started = new Promise<void>(resolve => {
        entered = resolve;
      }),
      blocked = new Promise<void>(resolve => {
        release = resolve;
      });
    const enqueue = vi
      .spyOn(f.schedules, "enqueueDueOccurrence")
      .mockImplementation(async () => {
        entered();
        await blocked;
        return { state: "not_active", operationId: null };
      });
    const s = createSaihuReportScheduler({
        repository: f.schedules,
        enabled: () => true,
        discover: async () => [{ identity: f.identity, planId: f.planId }],
        intervalMs: 20,
      }),
      stop = s.start();
    await started;
    let drained = false;
    const stopping = stop().then(() => {
      drained = true;
    });
    await vi.advanceTimersByTimeAsync(100);
    expect(drained).toBe(false);
    expect(enqueue).toHaveBeenCalledTimes(1);
    release();
    await stopping;
    expect(drained).toBe(true);
    await vi.advanceTimersByTimeAsync(100);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });
});
