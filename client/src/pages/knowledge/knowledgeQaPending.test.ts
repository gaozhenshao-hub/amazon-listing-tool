// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { knowledgeQaCanonical as canonical } from "@shared/knowledgeQa";
import { knowledgeQaPendingKey, readKnowledgeQaPending, reserveKnowledgeQaPending, releaseKnowledgeQaPending,
  withKnowledgeQaPendingLock, type KnowledgeQaPending } from "./knowledgeQaPending";
const identity = { userId: 7, workspaceId: 11 }, op = "11111111-1111-4111-8111-111111111111";
const record = (): KnowledgeQaPending => ({ version: 1, identity, threadId: "22222222-2222-4222-8222-222222222222", operationId: op, kind: "start", sourceHash: "a".repeat(64), runtimeHash: "b".repeat(64), requestHash: "c".repeat(64) });
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key, _options, body) => body()) } }); });
describe("knowledge question metadata-only recovery", () => {
  it("uses one owner/workspace lock across threads and persists no question or answer", async () => {
    const value = record(); await withKnowledgeQaPendingLock(identity, new AbortController().signal, async () => reserveKnowledgeQaPending(identity, value));
    expect(readKnowledgeQaPending(identity)).toEqual(value); expect(localStorage.getItem(knowledgeQaPendingKey(identity))).toBe(canonical(value));
    expect(() => reserveKnowledgeQaPending(identity, { ...value, threadId: "33333333-3333-4333-8333-333333333333" })).toThrow("QA_PENDING_EXISTS");
  });
  it.each([{ question: "private" }, { answer: "private" }, { title: "private" }, { identity: { ...identity, workspaceId: 12 } }, { runtimeHash: null }, { kind: "observed" }])("rejects malformed or extra metadata %j", patch => {
    localStorage.setItem(knowledgeQaPendingKey(identity), canonical({ ...record(), ...patch })); expect(() => readKnowledgeQaPending(identity)).toThrow("QA_PENDING_INVALID");
  });
  it("does not delete a different operation and never conflates owners/workspaces", () => {
    reserveKnowledgeQaPending(identity, record()); expect(releaseKnowledgeQaPending(identity, "44444444-4444-4444-8444-444444444444")).toBe(false);
    expect(readKnowledgeQaPending({ ...identity, userId: 8 })).toBeNull(); expect(readKnowledgeQaPending({ ...identity, workspaceId: 12 })).toBeNull(); expect(readKnowledgeQaPending(identity)).not.toBeNull();
  });
  it("refuses mutation without Web Locks and aborted lock requests", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); expect(() => reserveKnowledgeQaPending(identity, record())).toThrow("QA_LOCK_UNAVAILABLE");
    const controller = new AbortController(); controller.abort(); await expect(withKnowledgeQaPendingLock(identity, controller.signal, async () => {})).rejects.toThrow("QA_ABORTED");
  });
});
