// @vitest-environment jsdom
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { operationsBoardEditionCanonical } from "@shared/operationsBoardEdition";
import { boardOperationContext, boardPendingKey, readBoardPending, reserveBoardPending, releaseBoardPending, withBoardPendingLock, subscribeBoardPending,
  subscribeBoardEditionChanges, publishBoardEditionChange, type BoardPendingOperation } from "./operationsBoardEditionClientState";

const owner = { userId: 7, workspaceId: 11, role: "admin" }, scope = { storeName: "SYNTHETIC Store", country: "US" };
const context = boardOperationContext(owner, scope), id = "11111111-1111-4111-8111-111111111111", other = "22222222-2222-4222-8222-222222222222";
const pending = (): BoardPendingOperation => ({ version: 1, context, operationId: id, requestHash: "a".repeat(64), action: "saveNote", editionId: 9, parentAsin: "SYNTHETIC-PARENT" });
const cleanups: (() => void)[] = [];
function locks() {
  let tail = Promise.resolve();
  const request = vi.fn(async (_key: string, options: LockOptions, work: () => Promise<unknown>) => {
    const old = tail; let release!: () => void; tail = new Promise<void>(yes => { release = yes; }); await old;
    try { if (options.signal?.aborted) throw new Error("aborted"); return await work(); } finally { release(); }
  });
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request } }); return request;
}
beforeEach(() => { vi.restoreAllMocks(); localStorage.clear(); locks(); });
afterEach(() => { cleanups.splice(0).forEach(stop => stop()); vi.restoreAllMocks(); });

describe("board metadata-only durable pending", () => {
  it("roundtrips strict note metadata without any note text or financial rows", () => {
    reserveBoardPending(context, pending()); expect(readBoardPending(context)).toEqual(pending());
    const raw = localStorage.getItem(boardPendingKey(context))!; expect(raw.length).toBeLessThan(8192);
    for (const key of ['"note"', '"rows"', '"raw"', '"request"', '"members"']) expect(raw).not.toContain(key);
  });
  it.each(["note", "rows", "payload", "request", "model", "ownerIds"])("rejects extra private field %s", key => {
    expect(() => reserveBoardPending(context, { ...pending(), [key]: "private" } as BoardPendingOperation)).toThrow(); expect(localStorage.length).toBe(0);
  });
  it("separates actor/workspace/exact scope and partner namespaces", () => {
    const values = [context, boardOperationContext({ ...owner, userId: 8 }, scope), boardOperationContext({ ...owner, workspaceId: 12 }, scope),
      boardOperationContext(owner, { ...scope, storeName: "OTHER" }), boardOperationContext(owner, { ...scope, country: "CA" }), boardOperationContext(owner, null)];
    expect(new Set(values.map(boardPendingKey)).size).toBe(6);
    reserveBoardPending(context, pending()); for (const otherContext of values.slice(1)) expect(readBoardPending(otherContext)).toBeNull();
  });
  it("will not overwrite a different UUID, changed hash, or release someone else's operation", () => {
    reserveBoardPending(context, pending());
    expect(() => reserveBoardPending(context, { ...pending(), operationId: other })).toThrow();
    expect(() => reserveBoardPending(context, { ...pending(), requestHash: "b".repeat(64) })).toThrow();
    expect(releaseBoardPending(context, other)).toBe(false); expect(readBoardPending(context)).toEqual(pending());
    expect(releaseBoardPending(context, id)).toBe(true); expect(readBoardPending(context)).toBeNull();
  });
  it.each(["broken", "{}", "null", "x".repeat(8193)])("preserves corrupt/oversized records rather than dropping the unknown ID", raw => {
    localStorage.setItem(boardPendingKey(context), raw); expect(() => readBoardPending(context)).toThrow(); expect(localStorage.getItem(boardPendingKey(context))).toBe(raw);
  });
  it("rejects cross-context metadata and duplicate-key/noncanonical serialized input", () => {
    localStorage.setItem(boardPendingKey(context), operationsBoardEditionCanonical({ ...pending(), context: boardOperationContext(owner, null) }));
    expect(() => readBoardPending(context)).toThrow();
    localStorage.setItem(boardPendingKey(context), JSON.stringify(pending())); expect(() => readBoardPending(context)).toThrow();
  });
  it("serializes two tab reservations and leaves the losing UUID unsent", async () => {
    const work = async (operationId: string) => withBoardPendingLock(context, new AbortController().signal, async () => reserveBoardPending(context, { ...pending(), operationId }));
    const values = await Promise.allSettled([work(id), work(other)]); expect(values.map(value => value.status)).toEqual(["fulfilled", "rejected"]); expect(readBoardPending(context)?.operationId).toBe(id);
  });
  it("forbids reserve/release when Web Locks are unavailable but still reads recovery metadata", async () => {
    reserveBoardPending(context, pending()); Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    expect(readBoardPending(context)?.operationId).toBe(id); expect(() => releaseBoardPending(context, id)).toThrow();
    await expect(withBoardPendingLock(context, new AbortController().signal, async () => undefined)).rejects.toThrow();
    expect(readBoardPending(context)?.operationId).toBe(id);
  });
  it("aborted lock never enters work", async () => {
    const controller = new AbortController(); controller.abort(); const work = vi.fn();
    await expect(withBoardPendingLock(context, controller.signal, work)).rejects.toThrow(); expect(work).not.toHaveBeenCalled();
  });
  it("notifies local and same-context storage changes, including malformed values", () => {
    const listener = vi.fn(); cleanups.push(subscribeBoardPending(context, listener));
    reserveBoardPending(context, pending()); expect(listener).toHaveBeenCalledTimes(1);
    reserveBoardPending(context, pending()); expect(listener).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new StorageEvent("storage", { key: boardPendingKey(context), newValue: "corrupt" })); expect(listener).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new StorageEvent("storage", { key: "unrelated" })); expect(listener).toHaveBeenCalledTimes(2);
  });
  it("broadcasts only metadata and ignores invalid external notices", () => {
    const listener = vi.fn(); cleanups.push(subscribeBoardEditionChanges(listener));
    publishBoardEditionChange({ workspaceId: 11, scope, action: "note" }); expect(listener).toHaveBeenCalledWith({ workspaceId: 11, scope, action: "note" });
    const raw = localStorage.getItem("ops-board-changed:v1")!; expect(raw).not.toContain("note正文");
    window.dispatchEvent(new StorageEvent("storage", { key: "ops-board-changed:v1", newValue: '{"scope":null}' })); expect(listener).toHaveBeenCalledTimes(1);
  });
});
