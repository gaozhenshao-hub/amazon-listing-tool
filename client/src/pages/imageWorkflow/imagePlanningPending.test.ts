// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { imagePlanningPendingKey, imagePlanningPendingCanonical as canonical, readImagePlanningPending, reserveImagePlanningPending,
  releaseImagePlanningPending, subscribeImagePlanningPending, withImagePlanningPendingLock, type ImagePlanningPending } from "./imagePlanningPending";
const context = { userId: 7, workspaceId: 11, projectId: 8, sessionId: 19 };
const first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
const pending = (): ImagePlanningPending => ({ version: 1, context, kind: "start", operationId: first, runOperationId: first,
  requestHash: "a".repeat(64), sourceHash: "b".repeat(64), runtimeHash: "c".repeat(64), resultHash: null });
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, "locks", { configurable: true,
  value: { request: vi.fn(async (_key, _options, work) => work()) } }); });
describe("image planning metadata recovery", () => {
  it("stores only identifiers and hashes; reads remain possible without locks", () => {
    reserveImagePlanningPending(context, pending()); expect(readImagePlanningPending(context)).toEqual(pending());
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    expect(readImagePlanningPending(context)).toEqual(pending());
    expect(Object.keys(JSON.parse(localStorage.getItem(imagePlanningPendingKey(context))!))).toEqual(["context", "kind", "operationId", "requestHash", "resultHash", "runOperationId", "runtimeHash", "sourceHash", "version"]);
  });
  it.each(["userId", "workspaceId", "projectId", "sessionId"] as const)("isolates %s", field => {
    reserveImagePlanningPending(context, pending()); expect(readImagePlanningPending({ ...context, [field]: 99 })).toBeNull();
  });
  it("keeps a different unresolved UUID and releases only the exact UUID", () => {
    reserveImagePlanningPending(context, pending());
    expect(() => reserveImagePlanningPending(context, { ...pending(), operationId: second, runOperationId: second })).toThrow("PLANNING_PENDING_EXISTS");
    expect(releaseImagePlanningPending(context, second)).toBe(false); expect(readImagePlanningPending(context)).toEqual(pending());
    expect(releaseImagePlanningPending(context, first)).toBe(true);
  });
  it.each([{ tags: { category: "private" } }, { base64: "pixels" }, { url: "private" }, { request: {} }])("rejects business payload %j without deleting it", extra => {
    const raw = canonical({ ...pending(), ...extra }); localStorage.setItem(imagePlanningPendingKey(context), raw);
    expect(() => readImagePlanningPending(context)).toThrow("PLANNING_PENDING_INVALID"); expect(localStorage.getItem(imagePlanningPendingKey(context))).toBe(raw);
  });
  it.each([{ kind: "apply", runtimeHash: null, resultHash: "d".repeat(64) }, { runtimeHash: null }, { resultHash: "d".repeat(64) }, { operationId: first.toUpperCase() + "X" }])("rejects contradictory recovery metadata %j", extra => {
    expect(() => reserveImagePlanningPending(context, { ...pending(), ...extra } as ImagePlanningPending)).toThrow();
  });
  it("accepts independently identified apply metadata", () => {
    const value: ImagePlanningPending = { ...pending(), kind: "apply", operationId: second, runtimeHash: null, resultHash: "d".repeat(64) };
    reserveImagePlanningPending(context, value); expect(readImagePlanningPending(context)).toEqual(value);
  });
  it("records an observed server UUID without fabricating a submitted request body or hash", () => {
    const value: ImagePlanningPending = { ...pending(), kind: "observed", requestHash: null, sourceHash: null, runtimeHash: null };
    reserveImagePlanningPending(context, value); expect(readImagePlanningPending(context)).toEqual(value);
    expect(() => reserveImagePlanningPending({ ...context, projectId: 8, sessionId: 20 }, { ...value, context: { ...context, projectId: 8, sessionId: 20 }, requestHash: "a".repeat(64) })).toThrow();
  });
  it("preserves malformed or noncanonical stored data", () => {
    localStorage.setItem(imagePlanningPendingKey(context), "{broken"); expect(() => readImagePlanningPending(context)).toThrow();
    expect(localStorage.getItem(imagePlanningPendingKey(context))).toBe("{broken");
    localStorage.setItem(imagePlanningPendingKey(context), JSON.stringify(pending())); expect(() => readImagePlanningPending(context)).toThrow();
  });
  it("uses exact browser locks; abort and missing locks never fall back", async () => {
    const signal = new AbortController().signal;
    await withImagePlanningPendingLock(context, signal, async () => reserveImagePlanningPending(context, pending()));
    expect(navigator.locks.request).toHaveBeenCalledWith(imagePlanningPendingKey(context), { mode: "exclusive", signal }, expect.any(Function));
    const controller = new AbortController(); controller.abort(); const work = vi.fn();
    await expect(withImagePlanningPendingLock(context, controller.signal, work)).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(withImagePlanningPendingLock(context, signal, work)).rejects.toThrow("PLANNING_LOCK_UNAVAILABLE");
  });
  it("notifies cross-view changes but does not interrupt equivalent reservations", () => {
    const listener = vi.fn(), stop = subscribeImagePlanningPending(context, listener);
    reserveImagePlanningPending(context, pending()); reserveImagePlanningPending(context, pending()); expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: imagePlanningPendingKey(context) })); expect(listener).toHaveBeenCalledTimes(2);
    stop(); releaseImagePlanningPending(context, first); expect(listener).toHaveBeenCalledTimes(2);
  });
});
