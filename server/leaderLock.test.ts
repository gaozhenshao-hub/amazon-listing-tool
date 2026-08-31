import { describe, expect, it, vi } from "vitest";
import { MysqlLeaderLock } from "./_core/leaderLock";

describe("MysqlLeaderLock.release", () => {
  it("clears its local connection even when MySQL has already closed it", async () => {
    const closedConnection = {
      query: vi.fn().mockRejectedValue(new Error("Can't add new command when connection is in closed state")),
      end: vi.fn().mockRejectedValue(new Error("Connection is closed")),
    } as any;
    const lock = new MysqlLeaderLock("test-scheduler", "test-owner");
    (lock as any).connection = closedConnection;
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await expect(lock.release()).resolves.toBeUndefined();
    await expect(lock.release()).resolves.toBeUndefined();
    expect(closedConnection.query).toHaveBeenCalledTimes(1);
    expect(closedConnection.end).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });
});
