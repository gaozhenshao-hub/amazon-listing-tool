import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ startIntel: vi.fn(), startTodo: vi.fn(), startSaihu: vi.fn(), stopIntel: vi.fn(), stopTodo: vi.fn(), stopOps: vi.fn(), stopSaihu: vi.fn(), release: vi.fn(), close: vi.fn(), acquire: vi.fn(), lost: null as null | (() => void) }));
vi.mock("dotenv/config", () => ({}));
vi.mock("../intelAutoCollect", () => ({ intelScheduler: { start: state.startIntel, stop: state.stopIntel } }));
vi.mock("../todoReminder", () => ({ startTodoReminderScheduler: state.startTodo, stopTodoReminderScheduler: state.stopTodo }));
vi.mock("./leaderLock", () => ({ createSchedulerLeaderLock: (options: { onConnectionLost: () => void }) => { state.lost = options.onConnectionLost; return { acquire: state.acquire, release: state.release }; } }));
vi.mock("../repositories/dbClient", () => ({ closeDbConnection: state.close }));
vi.mock("./startupValidation", () => ({ assertStartupConfig: () => ({ role: "scheduler" }) }));
vi.mock("../domains/ai_os/services/operationalScheduler", () => ({ startAiOsOperationalScheduler: () => state.stopOps }));
vi.mock("../domains/ops/saihuScheduleService", () => ({ startSaihuSyncScheduler: () => async () => {} }));
vi.mock("../domains/ops/saihuReportScheduler", () => ({ startSaihuReportScheduler: state.startSaihu }));
function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
let handlers: Record<string, (...args: unknown[]) => void>, priorExitCode: typeof process.exitCode;
beforeEach(() => { vi.resetModules(); vi.clearAllMocks(); vi.useFakeTimers(); handlers = {}; priorExitCode = process.exitCode; vi.stubEnv("APP_PROCESS_ROLE", "scheduler"); vi.stubEnv("SCHEDULER_SHUTDOWN_GRACE_MS", "1000");
  vi.spyOn(process, "once").mockImplementation(((event: string, callback: (...args: unknown[]) => void) => { handlers[event] = callback; return process; }) as typeof process.once);
  vi.spyOn(process, "exit").mockImplementation((() => undefined) as never); vi.spyOn(console, "log").mockImplementation(() => {}); vi.spyOn(console, "error").mockImplementation(() => {});
  state.acquire.mockResolvedValue({ acquired: true, lockName: "synthetic-lock", ownerId: "synthetic-owner" }); state.release.mockResolvedValue(undefined); state.close.mockResolvedValue(undefined);
  for (const stop of [state.stopIntel, state.stopTodo, state.stopOps, state.stopSaihu]) stop.mockResolvedValue(undefined);
  state.startSaihu.mockReturnValue(state.stopSaihu);
});
afterEach(() => { process.exitCode = priorExitCode; vi.useRealTimers(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });
describe("scheduler entrypoint real stop composition", () => {
  it("closes all retained triggers first and does not release/close after the former fixed five seconds", async () => { const work = deferred(); state.stopOps.mockReturnValue(work.promise); await import("./scheduler"); await vi.advanceTimersByTimeAsync(0); handlers.SIGTERM(); expect(state.stopIntel).not.toHaveBeenCalled(); expect(state.stopTodo).toHaveBeenCalledTimes(1); expect(state.stopOps).toHaveBeenCalledTimes(1); expect(state.stopSaihu).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5001); expect(state.release).not.toHaveBeenCalled(); expect(state.close).not.toHaveBeenCalled(); expect(console.error).toHaveBeenCalledWith(expect.stringContaining("NOT DRAINED")); expect(process.exit).not.toHaveBeenCalled(); work.resolve(); await vi.advanceTimersByTimeAsync(0); expect(state.release).toHaveBeenCalledTimes(1); expect(state.close).toHaveBeenCalledTimes(1); expect(state.release.mock.invocationCallOrder[0]).toBeLessThan(state.close.mock.invocationCallOrder[0]); });
  it("lost leadership stops triggers but exits only after drain without claiming/releasing ownership", async () => { const work = deferred(); state.stopOps.mockReturnValue(work.promise); await import("./scheduler"); await vi.advanceTimersByTimeAsync(0); state.lost!(); await vi.advanceTimersByTimeAsync(5001); expect(state.release).not.toHaveBeenCalled(); expect(state.close).not.toHaveBeenCalled(); expect(process.exit).not.toHaveBeenCalled(); work.resolve(); await vi.advanceTimersByTimeAsync(0); expect(state.close).toHaveBeenCalledTimes(1); expect(state.release).not.toHaveBeenCalled(); expect(process.exit).toHaveBeenCalledWith(1); });
  it("waits for a queued Saihu occurrence transaction before releasing the leader lock", async () => { const work = deferred(); state.stopSaihu.mockReturnValue(work.promise); await import("./scheduler"); await vi.advanceTimersByTimeAsync(0); handlers.SIGTERM(); await vi.advanceTimersByTimeAsync(5001); expect(state.release).not.toHaveBeenCalled(); expect(state.close).not.toHaveBeenCalled(); work.resolve(); await vi.advanceTimersByTimeAsync(0); expect(state.release).toHaveBeenCalledTimes(1); expect(state.close).toHaveBeenCalledTimes(1); });
  it("never starts timers when another scheduler owns the leader lock", async () => { state.acquire.mockResolvedValue({ acquired: false, lockName: "synthetic-lock", ownerId: "synthetic-owner" }); await import("./scheduler"); await vi.advanceTimersByTimeAsync(0); expect(state.startIntel).not.toHaveBeenCalled(); expect(state.startTodo).not.toHaveBeenCalled(); expect(state.startSaihu).not.toHaveBeenCalled(); expect(state.release).toHaveBeenCalledTimes(1); expect(state.close).not.toHaveBeenCalled(); });
});
