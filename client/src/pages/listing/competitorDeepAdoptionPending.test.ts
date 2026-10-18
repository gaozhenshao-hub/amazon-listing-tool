// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { deepAdoptionPendingKey, readDeepAdoptionPending, reserveDeepAdoptionPending, releaseDeepAdoptionPending,
  withDeepAdoptionLock, subscribeDeepAdoptionPending, type CompetitorDeepAdoptionPending } from "./competitorDeepAdoptionPending";
const context = { userId: 7, workspaceId: 11, projectId: 5, analysisId: 3, asin: "B000000003" };
const pending: CompetitorDeepAdoptionPending = { version: 1, context, operation: { projectId: 5, analysisId: 3, expectedWorkspaceId: 11,
  operationId: "11111111-1111-4111-8111-111111111111", jobRunId: "synthetic-job" }, expectedRevision: "a".repeat(64), expectedResultHash: "b".repeat(64),
  expectedEvidenceHash: "c".repeat(64), requestHash: "d".repeat(64), summaryHash: "e".repeat(64) };
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key, _options, work) => work()) } }); });
describe("human adoption independent recovery metadata", () => {
  it("retains exact scoped metadata but rejects private body and forged contexts", () => {
    reserveDeepAdoptionPending(context, pending); expect(readDeepAdoptionPending(context)).toEqual(pending);
    expect(readDeepAdoptionPending({ ...context, userId: 8 })).toBeNull(); expect(readDeepAdoptionPending({ ...context, workspaceId: null })).toBeNull();
    expect(() => reserveDeepAdoptionPending(context, { ...pending, summary: "private" } as typeof pending)).toThrow();
    expect(() => reserveDeepAdoptionPending(context, { ...pending, operation: { ...pending.operation, projectId: 9 } })).toThrow();
    expect(localStorage.getItem(deepAdoptionPendingKey(context))).not.toContain("private");
  });
  it("never overwrites or releases a different unresolved UUID", () => {
    reserveDeepAdoptionPending(context, pending); const other = "22222222-2222-4222-8222-222222222222";
    expect(() => reserveDeepAdoptionPending(context, { ...pending, operation: { ...pending.operation, operationId: other } })).toThrow();
    expect(releaseDeepAdoptionPending(context, other)).toBe(false); expect(readDeepAdoptionPending(context)).toEqual(pending);
  });
  it("retains malformed/noncanonical records and refuses unsupported locking", async () => {
    const key = deepAdoptionPendingKey(context); localStorage.setItem(key, "bad"); expect(() => readDeepAdoptionPending(context)).toThrow();
    expect(localStorage.getItem(key)).toBe("bad"); const abort = new AbortController(); abort.abort();
    await expect(withDeepAdoptionLock(context, abort.signal, async () => undefined)).rejects.toThrow();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); expect(() => releaseDeepAdoptionPending(context, pending.operation.operationId)).toThrow();
  });
  it("notifies same-tab and foreign changes but no-op reserve is silent", () => {
    const callback = vi.fn(), stop = subscribeDeepAdoptionPending(context, callback); reserveDeepAdoptionPending(context, pending); reserveDeepAdoptionPending(context, pending);
    expect(callback).toHaveBeenCalledTimes(1); window.dispatchEvent(new StorageEvent("storage", { key: deepAdoptionPendingKey(context) }));
    expect(callback).toHaveBeenCalledTimes(2); expect(releaseDeepAdoptionPending(context, pending.operation.operationId)).toBe(true);
    expect(readDeepAdoptionPending(context)).toBeNull(); stop();
  });
});
