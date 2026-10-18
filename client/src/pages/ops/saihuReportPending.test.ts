// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  clearSaihuReportPending,
  persistSaihuReportPending,
  readSaihuReportPending,
  type SaihuReportPending,
} from "./saihuReportPending";
const identity = { userId: 3, workspaceId: 7 },
  operation: SaihuReportPending = {
    version: 1,
    identity,
    operationId: "11111111-1111-4111-8111-111111111111",
    runOperationId: "22222222-2222-4222-8222-222222222222",
    action: "apply",
    requestHash: "a".repeat(64),
  };
beforeEach(() => {
  localStorage.clear();
  let tail = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn((_key, _options, body) => {
        const work = tail.then(body);
        tail = work.then(
          () => undefined,
          () => undefined
        );
        return work;
      }),
    },
  });
});
describe("Saihu metadata-only original UUID recovery", () => {
  it("persists only strict metadata and blocks replacement UUIDs before resolution", async () => {
    await persistSaihuReportPending(operation);
    expect(readSaihuReportPending(identity)).toEqual(operation);
    expect(localStorage.getItem(localStorage.key(0)!)).toBe(
      JSON.stringify(operation)
    );
    await expect(
      persistSaihuReportPending({
        ...operation,
        operationId: "33333333-3333-4333-8333-333333333333",
      })
    ).rejects.toThrow("RESOLVE_ORIGINAL_OPERATION_FIRST");
  });
  it.each([
    { rows: [] },
    { url: "https://vendor.invalid" },
    { credentials: "secret" },
    { scope: { start: "2026-10-01" } },
  ])("rejects private payload in recovery metadata %j", async patch => {
    await expect(
      persistSaihuReportPending({ ...operation, ...patch })
    ).rejects.toThrow();
    expect(localStorage.length).toBe(0);
  });
  it("isolates actor/workspace and never clears another unknown operation", async () => {
    await persistSaihuReportPending(operation);
    expect(readSaihuReportPending({ ...identity, userId: 4 })).toBeNull();
    expect(readSaihuReportPending({ ...identity, workspaceId: 8 })).toBeNull();
    await clearSaihuReportPending({
      ...operation,
      operationId: "33333333-3333-4333-8333-333333333333",
    });
    expect(readSaihuReportPending(identity)).not.toBeNull();
    await clearSaihuReportPending(operation);
    expect(readSaihuReportPending(identity)).toBeNull();
  });
  it("cannot lose another tab's original UUID during interleaved read-then-write", async () => {
    const original = Storage.prototype.getItem;
    let second: Promise<boolean> = Promise.resolve(false);
    const other = {
      ...operation,
      operationId: "33333333-3333-4333-8333-333333333333",
    };
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementationOnce(function (this: Storage, target: string) {
        const stale = original.call(this, target);
        // Model two independent tabs: B reserves while A has observed empty
        // storage but has not yet written its operation. No network is involved.
        second = Promise.resolve(persistSaihuReportPending(other)).then(
          () => true,
          () => false
        );
        return stale;
      });
    try {
      await persistSaihuReportPending(operation);
      expect(await second).toBe(false);
      expect(readSaihuReportPending(identity)?.operationId).toBe(
        operation.operationId
      );
    } finally {
      get.mockRestore();
    }
  });
  it("fails closed without cross-tab locking and never clears mismatched recovery metadata", async () => {
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    await expect(persistSaihuReportPending(operation)).rejects.toThrow(
      "RECOVERY_LOCK_UNAVAILABLE"
    );
    expect(localStorage.length).toBe(0);
  });
  it("clears only exact original metadata under the same identity lock", async () => {
    await persistSaihuReportPending(operation);
    await clearSaihuReportPending({
      ...operation,
      requestHash: "b".repeat(64),
    });
    expect(readSaihuReportPending(identity)).toEqual(operation);
    await clearSaihuReportPending(operation);
    expect(readSaihuReportPending(identity)).toBeNull();
    expect(navigator.locks.request).toHaveBeenCalledWith(
      "saihu-report-pending:v1:3:7",
      { mode: "exclusive" },
      expect.any(Function)
    );
  });
});
