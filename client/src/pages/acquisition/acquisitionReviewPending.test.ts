// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { acquisitionReviewPendingKey, canonicalReviewValue, readAcquisitionReviewPending, releaseAcquisitionReviewPending,
  reserveAcquisitionReviewPending, subscribeAcquisitionReviewPending, withAcquisitionReviewLock, type AcquisitionReviewPending } from "./acquisitionReviewPending";
const context = { userId: 7, workspaceId: 11, projectId: 5, snapshotId: 19 };
const operationId = "11111111-1111-4111-8111-111111111111", otherId = "22222222-2222-4222-8222-222222222222";
const pending = (): AcquisitionReviewPending => ({ version: 1, context, operationId, action: "save", expectedRevisionHash: "a".repeat(64), requestHash: "b".repeat(64) });
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, "locks", { configurable: true,
  value: { request: vi.fn(async (_key, _options, work) => work()) } }); });
describe("snapshot review metadata-only pending recovery", () => {
  it("persists only scope and hashes, and reads with no browser lock dependency", () => {
    reserveAcquisitionReviewPending(context, pending()); expect(readAcquisitionReviewPending(context)).toEqual(pending());
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    expect(readAcquisitionReviewPending(context)).toEqual(pending());
    expect(Object.keys(JSON.parse(localStorage.getItem(acquisitionReviewPendingKey(context))!))).toEqual(["action", "context", "expectedRevisionHash", "operationId", "requestHash", "version"]);
  });
  it.each(["userId", "workspaceId", "projectId", "snapshotId"] as const)("isolates %s", field => {
    reserveAcquisitionReviewPending(context, pending()); expect(readAcquisitionReviewPending({ ...context, [field]: 99 })).toBeNull();
  });
  it("does not replace a different UUID, or release it using a stale UUID", () => {
    reserveAcquisitionReviewPending(context, pending());
    expect(() => reserveAcquisitionReviewPending(context, { ...pending(), operationId: otherId })).toThrow("REVIEW_PENDING_EXISTS");
    expect(releaseAcquisitionReviewPending(context, otherId)).toBe(false); expect(readAcquisitionReviewPending(context)).not.toBeNull();
    expect(releaseAcquisitionReviewPending(context, operationId)).toBe(true); expect(readAcquisitionReviewPending(context)).toBeNull();
  });
  it.each([{ note: "private" }, { base64: "pixels" }, { patch: { title: "secret" } }])("rejects extra body metadata %j", extra => {
    const value = { ...pending(), ...extra };
    localStorage.setItem(acquisitionReviewPendingKey(context), canonicalReviewValue(value));
    expect(() => readAcquisitionReviewPending(context)).toThrow("REVIEW_PENDING_INVALID");
    expect(localStorage.getItem(acquisitionReviewPendingKey(context))).not.toBeNull();
  });
  it("does not discard invalid or noncanonical storage", () => {
    localStorage.setItem(acquisitionReviewPendingKey(context), "{broken");
    expect(() => readAcquisitionReviewPending(context)).toThrow(); expect(localStorage.getItem(acquisitionReviewPendingKey(context))).toBe("{broken");
    localStorage.setItem(acquisitionReviewPendingKey(context), JSON.stringify(pending())); expect(() => readAcquisitionReviewPending(context)).toThrow();
  });
  it("serializes owner-specific changes and denies unsupported locks/aborted work", async () => {
    const signal = new AbortController().signal;
    await withAcquisitionReviewLock(context, signal, async () => reserveAcquisitionReviewPending(context, pending()));
    expect(navigator.locks.request).toHaveBeenCalledWith(acquisitionReviewPendingKey(context), { mode: "exclusive", signal }, expect.any(Function));
    const aborted = new AbortController(); aborted.abort(); const work = vi.fn();
    await expect(withAcquisitionReviewLock(context, aborted.signal, work)).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(withAcquisitionReviewLock(context, signal, work)).rejects.toThrow("REVIEW_LOCK_UNAVAILABLE");
  });
  it("notifies real writes/external storage, but an equivalent reservation does not interrupt itself", () => {
    const callback = vi.fn(), stop = subscribeAcquisitionReviewPending(context, callback);
    reserveAcquisitionReviewPending(context, pending()); expect(callback).toHaveBeenCalledTimes(1);
    reserveAcquisitionReviewPending(context, pending()); expect(callback).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: acquisitionReviewPendingKey(context) })); expect(callback).toHaveBeenCalledTimes(2);
    stop(); releaseAcquisitionReviewPending(context, operationId); expect(callback).toHaveBeenCalledTimes(2);
  });
});
