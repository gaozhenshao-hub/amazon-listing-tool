// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { competitorDeepPendingKey, readCompetitorDeepPending, reserveCompetitorDeepPending, releaseCompetitorDeepPending,
  subscribeCompetitorDeepPending, withCompetitorDeepPendingLock, type CompetitorDeepPending } from "./competitorDeepPending";
const context = { userId: 7, workspaceId: 11, projectId: 3, analysisId: 8, asin: "B000000008" };
const pending: CompetitorDeepPending = { version: 1, context, operationId: "11111111-1111-4111-8111-111111111111", expectedRevision: "a".repeat(64), expectedEvidenceHash: "b".repeat(64) };
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key, _options, work) => work()) } }); });
describe("four-column original-operation metadata", () => {
  it("stores only strict recovery metadata and scopes by numeric identity and row", async () => {
    await withCompetitorDeepPendingLock(context, new AbortController().signal, async () => reserveCompetitorDeepPending(context, pending));
    expect(readCompetitorDeepPending(context)).toEqual(pending);
    expect(readCompetitorDeepPending({ ...context, userId: 9 })).toBeNull();
    expect(readCompetitorDeepPending({ ...context, workspaceId: null })).toBeNull();
    expect(() => reserveCompetitorDeepPending(context, { ...pending, note: "PRIVATE" } as typeof pending)).toThrow();
    expect(localStorage.getItem(competitorDeepPendingKey(context))).not.toContain("PRIVATE");
  });
  it("does not overwrite another operation or revise a stored request", () => {
    reserveCompetitorDeepPending(context, pending);
    expect(() => reserveCompetitorDeepPending(context, { ...pending, operationId: "22222222-2222-4222-8222-222222222222" })).toThrow();
    expect(() => reserveCompetitorDeepPending(context, { ...pending, expectedRevision: "c".repeat(64) })).toThrow();
    expect(releaseCompetitorDeepPending(context, "22222222-2222-4222-8222-222222222222")).toBe(false);
    expect(readCompetitorDeepPending(context)).toEqual(pending);
  });
  it("retains corrupt or noncanonical storage rather than clearing unknown requests", () => {
    const key = competitorDeepPendingKey(context); localStorage.setItem(key, "bad");
    expect(() => readCompetitorDeepPending(context)).toThrow(); expect(() => reserveCompetitorDeepPending(context, pending)).toThrow();
    expect(localStorage.getItem(key)).toBe("bad");
  });
  it("requires Web Locks for mutations and refuses aborted queued work", async () => {
    const abort = new AbortController(); abort.abort();
    await expect(withCompetitorDeepPendingLock(context, abort.signal, async () => reserveCompetitorDeepPending(context, pending))).rejects.toThrow();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    expect(() => reserveCompetitorDeepPending(context, pending)).toThrow(); expect(readCompetitorDeepPending(context)).toBeNull();
  });
  it("notifies local and matching cross-tab updates, and removes only acknowledged UUID", () => {
    const notified = vi.fn(), stop = subscribeCompetitorDeepPending(context, notified);
    reserveCompetitorDeepPending(context, pending); expect(notified).toHaveBeenCalledTimes(1);
    reserveCompetitorDeepPending(context, pending); expect(notified).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: competitorDeepPendingKey(context) })); expect(notified).toHaveBeenCalledTimes(2);
    expect(releaseCompetitorDeepPending(context, pending.operationId)).toBe(true); expect(readCompetitorDeepPending(context)).toBeNull();
    expect(notified).toHaveBeenCalledTimes(3); stop();
  });
});
