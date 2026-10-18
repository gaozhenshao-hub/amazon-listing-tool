// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProfitAnalysisPreviewInput } from "@shared/profitAnalysis";
import {
  PROFIT_ANALYSIS_PENDING_MAX_BYTES, ProfitAnalysisPendingError, pendingOperationId, profitAnalysisPendingKey,
  readProfitAnalysisPending, withProfitAnalysisPendingLock, reserveProfitAnalysisPending, releaseProfitAnalysisPending,
  subscribeProfitAnalysisPending, type ProfitAnalysisPending, type ProfitAnalysisPendingOwner,
} from "./profitAnalysisPending";

const owner: ProfitAnalysisPendingOwner = { userId: 7, workspaceId: 3 };
const input: ProfitAnalysisPreviewInput = { expectedWorkspaceId: 3, month: "2026-09", scope: {
  storeName: "Synthetic Store", country: "US", parentAsin: "B0SYNTHETIC", currency: "USD", basis: "child_rows",
} };
const operationId = "b7d29fe8-2c53-4c34-bfe7-cbe34c102125", secondId = "c7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const saveId = "d7d29fe8-2c53-4c34-bfe7-cbe34c102125";
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function generation(): ProfitAnalysisPending {
  return { version: 1, identity: clone(owner), kind: "generate", request: { ...clone(input), operationId, expectedReportVersion: 0, expectedSourceHash: "a".repeat(64), regenerateConfirmed: false } };
}
function save(): ProfitAnalysisPending {
  return { version: 1, identity: clone(owner), kind: "save", request: { ...clone(input), saveOperationId: saveId, runOperationId: operationId,
    expectedReportVersion: 3, expectedResultHash: "b".repeat(64), expectedSourceHash: "a".repeat(64) } };
}
const key = () => profitAnalysisPendingKey(owner, input);
function defer<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
function installLocks() {
  const tails = new Map<string, Promise<void>>();
  const request = vi.fn(async (name: string, options: LockOptions, work: (lock: Lock) => Promise<unknown>) => {
    const previous = tails.get(name) ?? Promise.resolve(), release = defer<void>(); tails.set(name, release.promise);
    await previous;
    try {
      if (options.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return await work({ name, mode: "exclusive" });
    } finally { release.resolve(); if (tails.get(name) === release.promise) tails.delete(name); }
  });
  Object.defineProperty(window.navigator, "locks", { configurable: true, value: { request } });
  return request;
}
const unsubscribers: Array<() => void> = [];
function subscribe(callback = vi.fn(), own = owner, preview = input) {
  const unsubscribe = subscribeProfitAnalysisPending(own, preview, callback); unsubscribers.push(unsubscribe); return { callback, unsubscribe };
}
beforeEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); window.localStorage.clear(); window.sessionStorage.clear(); installLocks(); });
afterEach(() => { unsubscribers.splice(0).forEach(unsubscribe => unsubscribe()); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("profit recovery exact private scope and strict metadata", () => {
  it("returns absent without inventing a pending operation", () => { expect(readProfitAnalysisPending(owner, input)).toBeNull(); });
  it.each([generation, save])("roundtrips each complete metadata action with no financial or model body", make => {
    const value = make(); reserveProfitAnalysisPending(owner, input, value);
    expect(readProfitAnalysisPending(owner, input)).toEqual(value);
    expect(pendingOperationId(value)).toBe(value.kind === "generate" ? operationId : saveId);
    const raw = window.localStorage.getItem(key())!; expect(new TextEncoder().encode(raw).byteLength).toBeLessThan(PROFIT_ANALYSIS_PENDING_MAX_BYTES);
    for (const forbidden of ['"rows"', '"result"', '"prompt"', '"configuration"', '"raw"']) expect(raw).not.toContain(forbidden);
  });
  it("keys every owner, workspace, store, country, parent, currency, basis and month independently", () => {
    const keys = [key(), profitAnalysisPendingKey({ ...owner, userId: 8 }, input), profitAnalysisPendingKey({ ...owner, workspaceId: 4 }, { ...input, expectedWorkspaceId: 4 }),
      ...[{ storeName: "Another Store" }, { country: "CA" }, { parentAsin: "B0OTHER" }, { currency: "CAD" }, { currency: null }, { basis: "reported_parent_row" as const }]
        .map(scope => profitAnalysisPendingKey(owner, { ...input, scope: { ...input.scope, ...scope } })), profitAnalysisPendingKey(owner, { ...input, month: "2026-08" })];
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("uses shared parsed country normalization rather than a second identity rule", () => {
    expect(profitAnalysisPendingKey(owner, { ...input, scope: { ...input.scope, country: "美国" } })).toBe(key());
    const value = generation(); value.request.scope.country = "美国"; reserveProfitAnalysisPending(owner, input, value);
    expect(readProfitAnalysisPending(owner, input)?.request.scope.country).toBe("US");
  });
  it("has collision-free string boundaries for separator-looking store and parent names", () => {
    const a = { ...input, scope: { ...input.scope, storeName: "A:B", parentAsin: "C" } }, b = { ...input, scope: { ...input.scope, storeName: "A", parentAsin: "B:C" } };
    expect(profitAnalysisPendingKey(owner, a)).not.toBe(profitAnalysisPendingKey(owner, b));
  });
  it("supports multiple scoped operations without overwriting or releasing a neighboring scope", () => {
    const next = { ...input, month: "2026-08" }, other = generation(); other.request.month = next.month;
    reserveProfitAnalysisPending(owner, input, generation()); reserveProfitAnalysisPending(owner, next, other);
    expect(window.localStorage.length).toBe(2); expect(releaseProfitAnalysisPending(owner, input, operationId)).toBe(true);
    expect(readProfitAnalysisPending(owner, next)).toEqual(other);
  });
  it("copies input metadata instead of retaining caller-mutated references", () => {
    const value = generation(); reserveProfitAnalysisPending(owner, input, value); value.request.expectedSourceHash = "c".repeat(64);
    const read = readProfitAnalysisPending(owner, input)!; expect(read.request.expectedSourceHash).toBe("a".repeat(64));
    read.request.expectedSourceHash = "d".repeat(64); expect(readProfitAnalysisPending(owner, input)?.request.expectedSourceHash).toBe("a".repeat(64));
  });
  it.each([0, -1, 1.5, NaN, Infinity, 2147483648])("rejects invalid owner ID %s before touching storage", userId => {
    const get = vi.spyOn(Storage.prototype, "getItem"); expect(() => readProfitAnalysisPending({ ...owner, userId }, input)).toThrow(ProfitAnalysisPendingError); expect(get).not.toHaveBeenCalled();
  });
  it("refuses mismatched workspace and additional owner fields", () => {
    expect(() => profitAnalysisPendingKey(owner, { ...input, expectedWorkspaceId: 4 })).toThrow("SCOPE_MISMATCH");
    expect(() => profitAnalysisPendingKey({ ...owner, admin: true } as ProfitAnalysisPendingOwner, input)).toThrow("INVALID");
  });
  it.each(["1000-01", "2026-13", "2026-9", "2026-09-01"])("rejects invalid analysis month %s", month => { expect(() => profitAnalysisPendingKey(owner, { ...input, month })).toThrow("INVALID"); });
  it.each(["", " ", "US\n"])("rejects malformed scope string %j", country => { expect(() => profitAnalysisPendingKey(owner, { ...input, scope: { ...input.scope, country } })).toThrow("INVALID"); });
  it.each(["rows", "raw", "prompt", "result", "configuration", "authority"])("rejects unknown %s rather than stripping private content", field => {
    const original = generation();
    for (const value of [{ ...original, [field]: "SYNTHETIC_PRIVATE_BODY" }, { ...original, request: { ...original.request, [field]: "SYNTHETIC_PRIVATE_BODY" } }]) {
      expect(() => reserveProfitAnalysisPending(owner, input, value as ProfitAnalysisPending)).toThrow("INVALID"); expect(window.localStorage.length).toBe(0);
    }
  });
  it.each(["identity", "requestScope", "month"])("rejects foreign pending %s", field => {
    const value = generation(); if (field === "identity") value.identity.userId = 8;
    if (field === "requestScope") value.request.scope.storeName = "Other"; if (field === "month") value.request.month = "2026-08";
    expect(() => reserveProfitAnalysisPending(owner, input, value)).toThrow("SCOPE_MISMATCH");
  });
  it.each([operationId.toUpperCase(), "bad", ` ${operationId}`])("rejects invalid UUID %s in both actions", id => {
    const generate = generation(), saving = save(); if (generate.kind === "generate") generate.request.operationId = id; if (saving.kind === "save") saving.request.saveOperationId = id;
    for (const value of [generate, saving]) expect(() => reserveProfitAnalysisPending(owner, input, value)).toThrow("INVALID");
  });
  it("requires separate save UUID and preserves null currency, not an invented USD", () => {
    const value = save(); if (value.kind === "save") value.request.saveOperationId = operationId;
    expect(() => pendingOperationId(value)).toThrow("INVALID");
    const unknown = { ...input, scope: { ...input.scope, currency: null } }, pending = generation(); pending.request.scope.currency = null;
    reserveProfitAnalysisPending(owner, unknown, pending); expect(readProfitAnalysisPending(owner, unknown)?.request.scope.currency).toBeNull();
  });
  it("rejects getter/non-plain/symbol/undefined/cyclic input without invoking getters", () => {
    let calls = 0; const accessor = generation(); Object.defineProperty(accessor, "kind", { enumerable: true, get() { calls++; return "generate"; } });
    expect(() => pendingOperationId(accessor)).toThrow("INVALID"); expect(calls).toBe(0);
    for (const patch of [{ hidden: undefined }, { date: new Date() }, { [Symbol("private")]: "body" }]) expect(() => pendingOperationId({ ...generation(), ...patch })).toThrow("INVALID");
    const cyclic: Record<string, unknown> = generation(); cyclic.self = cyclic; expect(() => pendingOperationId(cyclic as ProfitAnalysisPending)).toThrow("INVALID");
  });
  it("rejects malformed UTF-16 instead of persisting a lossy scope key", () => {
    expect(() => profitAnalysisPendingKey(owner, { ...input, scope: { ...input.scope, storeName: "\ud800" } })).toThrow("INVALID");
  });
});

describe("profit recovery refuses overwrite and preserves unknown storage", () => {
  it("same canonical bytes and UUID is idempotent without emitting or rewriting", () => {
    const watched = subscribe(), value = generation(); reserveProfitAnalysisPending(owner, input, value); watched.callback.mockClear(); const set = vi.spyOn(Storage.prototype, "setItem");
    reserveProfitAnalysisPending(owner, input, { ...value, identity: { workspaceId: owner.workspaceId, userId: owner.userId } });
    expect(set).not.toHaveBeenCalled(); expect(watched.callback).not.toHaveBeenCalled();
  });
  it("different UUID never replaces an unresolved operation", () => {
    reserveProfitAnalysisPending(owner, input, generation()); const before = window.localStorage.getItem(key()), another = generation(); if (another.kind === "generate") another.request.operationId = secondId;
    expect(() => reserveProfitAnalysisPending(owner, input, another)).toThrow("PENDING_CONFLICT"); expect(window.localStorage.getItem(key())).toBe(before);
  });
  it.each(["hash", "version", "regeneration", "kind"])("same UUID with changed %s cannot rewrite its immutable metadata", field => {
    reserveProfitAnalysisPending(owner, input, generation()); const before = window.localStorage.getItem(key()); let another = generation();
    if (field === "hash") another.request.expectedSourceHash = "d".repeat(64);
    if (field === "version") another.request.expectedReportVersion = 1;
    if (field === "regeneration" && another.kind === "generate") another.request.regenerateConfirmed = true;
    if (field === "kind") { another = save(); if (another.kind === "save") { another.request.saveOperationId = operationId; another.request.runOperationId = secondId; } }
    expect(() => reserveProfitAnalysisPending(owner, input, another)).toThrow("CONTENT_CONFLICT"); expect(window.localStorage.getItem(key())).toBe(before);
  });
  it("release is conditional on the exact existing UUID and is idempotent when absent", () => {
    expect(releaseProfitAnalysisPending(owner, input, operationId)).toBe(false); reserveProfitAnalysisPending(owner, input, generation());
    expect(releaseProfitAnalysisPending(owner, input, secondId)).toBe(false); expect(readProfitAnalysisPending(owner, input)).not.toBeNull();
    expect(releaseProfitAnalysisPending(owner, input, operationId)).toBe(true); expect(readProfitAnalysisPending(owner, input)).toBeNull();
    expect(releaseProfitAnalysisPending(owner, input, operationId)).toBe(false);
  });
  it.each(["{", "null", "[]", "{}", " ", "x".repeat(PROFIT_ANALYSIS_PENDING_MAX_BYTES + 1), "界".repeat(3000)])("corrupt metadata never becomes absence or gets silently deleted (%#)", raw => {
    window.localStorage.setItem(key(), raw);
    for (const action of [() => readProfitAnalysisPending(owner, input), () => reserveProfitAnalysisPending(owner, input, generation()), () => releaseProfitAnalysisPending(owner, input, operationId)]) expect(action).toThrow("INVALID");
    expect(window.localStorage.getItem(key())).toBe(raw);
  });
  it("detects stored identity/scope substitution and leaves the original bytes", () => {
    reserveProfitAnalysisPending(owner, input, generation()); const raw = window.localStorage.getItem(key())!.replace('"userId":7', '"userId":8'); window.localStorage.setItem(key(), raw);
    expect(() => readProfitAnalysisPending(owner, input)).toThrow("SCOPE_MISMATCH"); expect(() => releaseProfitAnalysisPending(owner, input, operationId)).toThrow("SCOPE_MISMATCH"); expect(window.localStorage.getItem(key())).toBe(raw);
  });
  it("rejects noncanonical JSON and duplicate keys hiding a private overwritten value", () => {
    reserveProfitAnalysisPending(owner, input, generation()); const raw = window.localStorage.getItem(key())!;
    for (const damaged of [` ${raw}`, raw.replace('"kind":"generate"', '"kind":"SYNTHETIC_PRIVATE_BODY","kind":"generate"')]) {
      window.localStorage.setItem(key(), damaged); expect(() => readProfitAnalysisPending(owner, input)).toThrow("INVALID"); expect(window.localStorage.getItem(key())).toBe(damaged);
    }
  });
  it("storage read failure is unavailable, never absence", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("SYNTHETIC_STORAGE_ERROR"); });
    expect(() => readProfitAnalysisPending(owner, input)).toThrow("STORAGE_UNAVAILABLE");
  });
  it("failed set is uncertain and emits invalidation without removing anything", () => {
    const watched = subscribe(), remove = vi.spyOn(Storage.prototype, "removeItem"); vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("SYNTHETIC_SET_FAILURE"); });
    expect(() => reserveProfitAnalysisPending(owner, input, generation())).toThrow("STORAGE_UNAVAILABLE"); expect(remove).not.toHaveBeenCalled(); expect(watched.callback).toHaveBeenCalledTimes(1);
  });
  it("write succeeded but acknowledgement threw retains the operation for recovery", () => {
    const original = Storage.prototype.setItem, remove = vi.spyOn(Storage.prototype, "removeItem"), set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, name, value) { original.call(this, name, value); throw new Error("SYNTHETIC_LOST_ACK"); });
    expect(() => reserveProfitAnalysisPending(owner, input, generation())).toThrow("STORAGE_UNAVAILABLE"); set.mockRestore();
    expect(readProfitAnalysisPending(owner, input)).toEqual(generation()); expect(remove).not.toHaveBeenCalled();
  });
  it("failed write readback is not success and does not auto-remove the stored UUID", () => {
    const original = Storage.prototype.getItem, remove = vi.spyOn(Storage.prototype, "removeItem"); let reads = 0;
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(function (this: Storage, name) { if (++reads === 2) throw new Error("SYNTHETIC_READBACK_FAILURE"); return original.call(this, name); });
    expect(() => reserveProfitAnalysisPending(owner, input, generation())).toThrow("STORAGE_UNAVAILABLE"); get.mockRestore(); expect(readProfitAnalysisPending(owner, input)).toEqual(generation()); expect(remove).not.toHaveBeenCalled();
  });
  it("silent storage set no-op fails its readback", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {}); expect(() => reserveProfitAnalysisPending(owner, input, generation())).toThrow("STORAGE_UNVERIFIED");
  });
  it("failed/silent removal does not claim the pending record was released", () => {
    reserveProfitAnalysisPending(owner, input, generation()); const remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {});
    expect(() => releaseProfitAnalysisPending(owner, input, operationId)).toThrow("STORAGE_UNVERIFIED"); remove.mockImplementation(() => { throw new Error("SYNTHETIC_DELETE_FAILURE"); });
    expect(() => releaseProfitAnalysisPending(owner, input, operationId)).toThrow("STORAGE_UNAVAILABLE"); expect(readProfitAnalysisPending(owner, input)).toEqual(generation());
  });
  it("failed removal acknowledgement never deletes a replacement operation", () => {
    reserveProfitAnalysisPending(owner, input, generation()); const another = generation(); if (another.kind === "generate") another.request.operationId = secondId;
    const original = Storage.prototype.removeItem, remove = vi.spyOn(Storage.prototype, "removeItem").mockImplementation(function (this: Storage, name) { original.call(this, name); remove.mockRestore(); reserveProfitAnalysisPending(owner, input, another); });
    expect(() => releaseProfitAnalysisPending(owner, input, operationId)).toThrow("STORAGE_UNVERIFIED"); expect(pendingOperationId(readProfitAnalysisPending(owner, input)!)).toBe(secondId);
  });
});

describe("profit recovery browser locks and independent view invalidations", () => {
  it("holds the matching exclusive lock until the asynchronous callback finishes", async () => {
    const request = installLocks(), entered = defer<void>(), release = defer<void>(), signal = new AbortController().signal; let completed = false;
    const task = withProfitAnalysisPendingLock(owner, input, signal, async () => { entered.resolve(); await release.promise; completed = true; return 42; });
    await entered.promise; expect(completed).toBe(false); expect(request).toHaveBeenCalledWith(key(), { mode: "exclusive", signal }, expect.any(Function)); release.resolve(); expect(await task).toBe(42);
  });
  it("two contenders cannot reserve different UUIDs under the same scope lock", async () => {
    const signal = new AbortController().signal, entered = defer<void>(), release = defer<void>();
    const a = withProfitAnalysisPendingLock(owner, input, signal, async () => { reserveProfitAnalysisPending(owner, input, generation()); entered.resolve(); await release.promise; }); await entered.promise;
    const another = generation(); if (another.kind === "generate") another.request.operationId = secondId;
    const b = withProfitAnalysisPendingLock(owner, input, signal, async () => reserveProfitAnalysisPending(owner, input, another));
    const refused = expect(b).rejects.toThrow("PENDING_CONFLICT"); release.resolve(); await a; await refused;
    expect(pendingOperationId(readProfitAnalysisPending(owner, input)!)).toBe(operationId);
  });
  it("independent months have independent locks and can be reserved simultaneously", async () => {
    const signal = new AbortController().signal, entered = defer<void>(), release = defer<void>(), other = { ...input, month: "2026-08" };
    const first = withProfitAnalysisPendingLock(owner, input, signal, async () => { entered.resolve(); await release.promise; }); await entered.promise;
    const value = generation(); value.request.month = other.month;
    await withProfitAnalysisPendingLock(owner, other, signal, async () => reserveProfitAnalysisPending(owner, other, value)); expect(readProfitAnalysisPending(owner, other)).toEqual(value); release.resolve(); await first;
  });
  it("aborted signals cannot enter work, including a queued lock acquisition", async () => {
    const aborted = new AbortController(); aborted.abort(); const work = vi.fn(async () => {});
    await expect(withProfitAnalysisPendingLock(owner, input, aborted.signal, work)).rejects.toThrow("ABORTED"); expect(work).not.toHaveBeenCalled();
    const entered = defer<void>(), release = defer<void>(), waiting = new AbortController();
    const first = withProfitAnalysisPendingLock(owner, input, new AbortController().signal, async () => { entered.resolve(); await release.promise; }); await entered.promise;
    const next = withProfitAnalysisPendingLock(owner, input, waiting.signal, work), rejected = expect(next).rejects.toThrow(); waiting.abort(); release.resolve(); await first; await rejected; expect(work).not.toHaveBeenCalled();
  });
  it("a throwing lock callback retains metadata and does not leak a held lock", async () => {
    const signal = new AbortController().signal;
    await expect(withProfitAnalysisPendingLock(owner, input, signal, async () => { reserveProfitAnalysisPending(owner, input, generation()); throw new Error("SYNTHETIC_NETWORK_UNKNOWN"); })).rejects.toThrow("NETWORK_UNKNOWN");
    expect(await withProfitAnalysisPendingLock(owner, input, signal, async () => readProfitAnalysisPending(owner, input))).toEqual(generation());
  });
  it("missing lock support permits inspecting metadata but forbids reserve/release", async () => {
    reserveProfitAnalysisPending(owner, input, generation()); Object.defineProperty(window.navigator, "locks", { configurable: true, value: undefined });
    expect(readProfitAnalysisPending(owner, input)).toEqual(generation());
    expect(() => reserveProfitAnalysisPending(owner, input, generation())).toThrow("LOCK_UNAVAILABLE"); expect(() => releaseProfitAnalysisPending(owner, input, operationId)).toThrow("LOCK_UNAVAILABLE");
    await expect(withProfitAnalysisPendingLock(owner, input, new AbortController().signal, async () => {})).rejects.toThrow("LOCK_UNAVAILABLE"); expect(readProfitAnalysisPending(owner, input)).toEqual(generation());
  });
  it("missing window fails closed without accessing Node or external services", async () => {
    vi.stubGlobal("window", undefined);
    expect(() => readProfitAnalysisPending(owner, input)).toThrow("BROWSER_UNAVAILABLE"); expect(() => reserveProfitAnalysisPending(owner, input, generation())).toThrow("BROWSER_UNAVAILABLE");
    await expect(withProfitAnalysisPendingLock(owner, input, new AbortController().signal, async () => {})).rejects.toThrow("BROWSER_UNAVAILABLE");
  });
  it("blocked/unavailable localStorage never appears empty", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new DOMException("Denied", "SecurityError"); });
    expect(() => readProfitAnalysisPending(owner, input)).toThrow("STORAGE_UNAVAILABLE"); expect(() => subscribeProfitAnalysisPending(owner, input, () => {})).toThrow("STORAGE_UNAVAILABLE");
  });
  it("same-tab reserve/release invalidates only matching scopes and unsubscribe is idempotent", () => {
    const current = subscribe(), other = subscribe(vi.fn(), owner, { ...input, month: "2026-08" }); reserveProfitAnalysisPending(owner, input, generation());
    expect(current.callback).toHaveBeenCalledTimes(1); expect(other.callback).not.toHaveBeenCalled(); releaseProfitAnalysisPending(owner, input, operationId); expect(current.callback).toHaveBeenCalledTimes(2);
    current.unsubscribe(); current.unsubscribe(); reserveProfitAnalysisPending(owner, input, generation()); expect(current.callback).toHaveBeenCalledTimes(2);
  });
  it("cross-tab corruption, deletion and clear events notify without parsing or erasing", () => {
    const watched = subscribe(); window.localStorage.setItem(key(), "BROKEN");
    for (const event of [new StorageEvent("storage", { key: key(), newValue: "BROKEN", storageArea: window.localStorage }),
      new StorageEvent("storage", { key: key(), newValue: null, storageArea: window.localStorage }), new StorageEvent("storage", { key: null, storageArea: window.localStorage })]) window.dispatchEvent(event);
    expect(watched.callback).toHaveBeenCalledTimes(3); expect(window.localStorage.getItem(key())).toBe("BROKEN");
  });
  it("unrelated scopes and sessionStorage cannot invalidate a local-storage pending view", () => {
    const watched = subscribe(); window.dispatchEvent(new StorageEvent("storage", { key: "unrelated", storageArea: window.localStorage }));
    window.dispatchEvent(new StorageEvent("storage", { key: key(), storageArea: window.sessionStorage })); expect(watched.callback).not.toHaveBeenCalled();
  });
  it("one throwing subscriber does not hide invalidation from another or make a valid reserve fail", () => {
    subscribe(vi.fn(() => { throw new Error("SYNTHETIC_VIEW_FAILURE"); })); const other = subscribe();
    expect(() => reserveProfitAnalysisPending(owner, input, generation())).not.toThrow(); expect(other.callback).toHaveBeenCalledTimes(1);
  });
});
