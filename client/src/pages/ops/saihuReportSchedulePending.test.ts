// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  reserveSaihuSchedulePending,
  readSaihuSchedulePending,
  releaseSaihuSchedulePending,
  type SaihuSchedulePending,
} from "./saihuReportSchedulePending";
const identity = { userId: 3, workspaceId: 7 },
  record: SaihuSchedulePending = {
    version: 1,
    identity,
    planId: "11111111-1111-4111-8111-111111111111",
    operationId: "22222222-2222-4222-8222-222222222222",
    action: "save",
    requestHash: "a".repeat(64),
  };
beforeEach(() => {
  localStorage.clear();
  let tail = Promise.resolve();
  Object.defineProperty(navigator, "locks", {
    configurable: true,
    value: {
      request: vi.fn((_key, _options, body) => {
        const p = tail.then(body);
        tail = p.then(
          () => undefined,
          () => undefined
        );
        return p;
      }),
    },
  });
});
describe("metadata-only plan UUID recovery", () => {
  it("one scope cannot overwrite another unresolved UUID even across simultaneous reservations", async () => {
    const results = await Promise.allSettled([
      reserveSaihuSchedulePending(record),
      reserveSaihuSchedulePending({
        ...record,
        operationId: "33333333-3333-4333-8333-333333333333",
      }),
    ]);
    expect(results.map(r => r.status)).toEqual(["fulfilled", "rejected"]);
    expect(readSaihuSchedulePending(identity)).toEqual(record);
    expect(readSaihuSchedulePending({ ...identity, userId: 4 })).toBeNull();
    expect(
      readSaihuSchedulePending({ ...identity, workspaceId: 8 })
    ).toBeNull();
  });
  it("no policy, shop scope, source body or credentials can enter metadata storage", async () => {
    for (const patch of [
      { policy: {} },
      { shops: [] },
      { url: "https://vendor.invalid" },
      { secret: "x" },
    ])
      await expect(
        reserveSaihuSchedulePending({ ...record, ...patch })
      ).rejects.toThrow();
    expect(localStorage.length).toBe(0);
  });
  it("requires browser locking and exact metadata for release", async () => {
    await reserveSaihuSchedulePending(record);
    await expect(
      releaseSaihuSchedulePending({ ...record, requestHash: "b".repeat(64) })
    ).rejects.toThrow("SCHEDULE_RECOVERY_CHANGED");
    expect(readSaihuSchedulePending(identity)).not.toBeNull();
    await releaseSaihuSchedulePending(record);
    Object.defineProperty(navigator, "locks", {
      configurable: true,
      value: undefined,
    });
    await expect(reserveSaihuSchedulePending(record)).rejects.toThrow(
      "SCHEDULE_LOCK_UNAVAILABLE"
    );
    expect(localStorage.length).toBe(0);
  });
});
