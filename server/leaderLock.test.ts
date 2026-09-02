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

  it("stops the heartbeat and notifies the scheduler exactly once when the lock connection is lost", () => {
    const onConnectionLost = vi.fn();
    const lock = new MysqlLeaderLock("test-scheduler", "test-owner", "", { onConnectionLost });
    const closedConnection = { ping: vi.fn() } as any;
    const heartbeat = setInterval(() => undefined, 60_000);
    const error = new Error("Can't add new command when connection is in closed state");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    (lock as any).connection = closedConnection;
    (lock as any).heartbeat = heartbeat;

    (lock as any).handleHeartbeatFailure(closedConnection, error);
    (lock as any).handleHeartbeatFailure(closedConnection, error);

    expect((lock as any).connection).toBeNull();
    expect((lock as any).heartbeat).toBeNull();
    expect(onConnectionLost).toHaveBeenCalledTimes(1);
    expect(onConnectionLost).toHaveBeenCalledWith(error);
    consoleError.mockRestore();
  });
});
