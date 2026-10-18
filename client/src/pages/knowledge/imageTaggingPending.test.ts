// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { imageTaggingPendingKey, imageTaggingPendingCanonical as canonical, readImageTaggingPending, reserveImageTaggingPending,
  releaseImageTaggingPending, subscribeImageTaggingPending, withImageTaggingPendingLock, type ImageTaggingPending } from "./imageTaggingPending";
const context = { userId: 7, workspaceId: 11, imageSetId: 19 };
const first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
const pending = (): ImageTaggingPending => ({ version: 1, context, kind: "start", operationId: first, runOperationId: first,
  requestHash: "a".repeat(64), sourceHash: "b".repeat(64), runtimeHash: "c".repeat(64), resultHash: null });
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, "locks", { configurable: true,
  value: { request: vi.fn(async (_key, _options, work) => work()) } }); });
describe("image tagging metadata recovery", () => {
  it("stores only identifiers and hashes; reads remain possible without locks", () => {
    reserveImageTaggingPending(context, pending()); expect(readImageTaggingPending(context)).toEqual(pending());
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    expect(readImageTaggingPending(context)).toEqual(pending());
    expect(Object.keys(JSON.parse(localStorage.getItem(imageTaggingPendingKey(context))!))).toEqual(["context", "kind", "operationId", "requestHash", "resultHash", "runOperationId", "runtimeHash", "sourceHash", "version"]);
  });
  it.each(["userId", "workspaceId", "imageSetId"] as const)("isolates %s", field => {
    reserveImageTaggingPending(context, pending()); expect(readImageTaggingPending({ ...context, [field]: 99 })).toBeNull();
  });
  it("keeps a different unresolved UUID and releases only the exact UUID", () => {
    reserveImageTaggingPending(context, pending());
    expect(() => reserveImageTaggingPending(context, { ...pending(), operationId: second, runOperationId: second })).toThrow("TAGGING_PENDING_EXISTS");
    expect(releaseImageTaggingPending(context, second)).toBe(false); expect(readImageTaggingPending(context)).toEqual(pending());
    expect(releaseImageTaggingPending(context, first)).toBe(true);
  });
  it.each([{ tags: { category: "private" } }, { base64: "pixels" }, { url: "private" }, { request: {} }])("rejects business payload %j without deleting it", extra => {
    const raw = canonical({ ...pending(), ...extra }); localStorage.setItem(imageTaggingPendingKey(context), raw);
    expect(() => readImageTaggingPending(context)).toThrow("TAGGING_PENDING_INVALID"); expect(localStorage.getItem(imageTaggingPendingKey(context))).toBe(raw);
  });
  it.each([{ kind: "apply", runtimeHash: null, resultHash: "d".repeat(64) }, { runtimeHash: null }, { resultHash: "d".repeat(64) }, { operationId: first.toUpperCase() + "X" }])("rejects contradictory recovery metadata %j", extra => {
    expect(() => reserveImageTaggingPending(context, { ...pending(), ...extra } as ImageTaggingPending)).toThrow();
  });
  it("accepts independently identified apply metadata", () => {
    const value: ImageTaggingPending = { ...pending(), kind: "apply", operationId: second, runtimeHash: null, resultHash: "d".repeat(64) };
    reserveImageTaggingPending(context, value); expect(readImageTaggingPending(context)).toEqual(value);
  });
  it("records an observed server UUID without fabricating a submitted request body or hash", () => {
    const value: ImageTaggingPending = { ...pending(), kind: "observed", requestHash: null, sourceHash: null, runtimeHash: null };
    reserveImageTaggingPending(context, value); expect(readImageTaggingPending(context)).toEqual(value);
    expect(() => reserveImageTaggingPending({ ...context, imageSetId: 20 }, { ...value, context: { ...context, imageSetId: 20 }, requestHash: "a".repeat(64) })).toThrow();
  });
  it("preserves malformed or noncanonical stored data", () => {
    localStorage.setItem(imageTaggingPendingKey(context), "{broken"); expect(() => readImageTaggingPending(context)).toThrow();
    expect(localStorage.getItem(imageTaggingPendingKey(context))).toBe("{broken");
    localStorage.setItem(imageTaggingPendingKey(context), JSON.stringify(pending())); expect(() => readImageTaggingPending(context)).toThrow();
  });
  it("uses exact browser locks; abort and missing locks never fall back", async () => {
    const signal = new AbortController().signal;
    await withImageTaggingPendingLock(context, signal, async () => reserveImageTaggingPending(context, pending()));
    expect(navigator.locks.request).toHaveBeenCalledWith(imageTaggingPendingKey(context), { mode: "exclusive", signal }, expect.any(Function));
    const controller = new AbortController(); controller.abort(); const work = vi.fn();
    await expect(withImageTaggingPendingLock(context, controller.signal, work)).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(withImageTaggingPendingLock(context, signal, work)).rejects.toThrow("TAGGING_LOCK_UNAVAILABLE");
  });
  it("notifies cross-view changes but does not interrupt equivalent reservations", () => {
    const listener = vi.fn(), stop = subscribeImageTaggingPending(context, listener);
    reserveImageTaggingPending(context, pending()); reserveImageTaggingPending(context, pending()); expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: imageTaggingPendingKey(context) })); expect(listener).toHaveBeenCalledTimes(2);
    stop(); releaseImageTaggingPending(context, first); expect(listener).toHaveBeenCalledTimes(2);
  });
});
