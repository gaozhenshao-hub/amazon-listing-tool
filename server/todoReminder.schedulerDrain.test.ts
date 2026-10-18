import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ database: vi.fn(), rows: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ getDb: state.database }));
import { startTodoReminderScheduler, stopTodoReminderScheduler } from "./todoReminder";
function deferred() { let resolve!: (value: never[]) => void; const promise = new Promise<never[]>(done => { resolve = done; }); return { promise, resolve }; }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); vi.spyOn(console, "log").mockImplementation(() => {}); state.rows.mockResolvedValue([]); state.database.mockResolvedValue({ select: () => ({ from: () => ({ leftJoin: () => ({ where: state.rows }), where: state.rows }) }) }); });
afterEach(async () => { await stopTodoReminderScheduler(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("todo reminder accepted promise drain", () => {
  it("awaits the immediate initial check instead of just clearing its interval", async () => { const rows = deferred(); state.rows.mockReturnValueOnce(rows.promise); startTodoReminderScheduler(100); await vi.advanceTimersByTimeAsync(0); let done = false; const stop = stopTodoReminderScheduler().then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false); rows.resolve([]); await stop; expect(state.rows).toHaveBeenCalledTimes(2); const reads = state.database.mock.calls.length; await vi.advanceTimersByTimeAsync(1000); expect(state.database).toHaveBeenCalledTimes(reads); });
  it("tracks a later periodic check through all its reads", async () => { startTodoReminderScheduler(100); await vi.advanceTimersByTimeAsync(0); expect(state.rows).toHaveBeenCalledTimes(2); const rows = deferred(); state.rows.mockReturnValueOnce(rows.promise); await vi.advanceTimersByTimeAsync(100); let done = false; const stop = stopTodoReminderScheduler().then(() => { done = true; }); await vi.advanceTimersByTimeAsync(500); expect(done).toBe(false); expect(state.database).toHaveBeenCalledTimes(2); rows.resolve([]); await stop; expect(state.rows).toHaveBeenCalledTimes(4); });
});
