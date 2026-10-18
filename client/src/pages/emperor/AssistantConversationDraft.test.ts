// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  conversationPendingKey, readConversationPending, reserveConversationPending, releaseConversationPending,
  validateConversationFiles, readConversationFiles, disposeConversationFiles, type ConversationPending,
} from "./AssistantConversationDraft";
const owner = { userId: 7, workspaceId: 11, agentKey: "listing" as const };
const operationId = "11111111-1111-4111-8111-111111111111";
const pending: ConversationPending = { version: 1, ...owner, threadId: "22222222-2222-4222-8222-222222222222", operationId, expectedThreadVersion: 1, configurationRevision: 3 };
beforeEach(() => {
  localStorage.clear();
  let queue = Promise.resolve();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn((_key, options, callback) => {
    const next = queue.then(() => { if (options.signal.aborted) throw new Error("aborted"); return callback(); });
    queue = next.catch(() => undefined); return next;
  }) } });
  URL.createObjectURL = vi.fn(() => "blob:synthetic-preview"); URL.revokeObjectURL = vi.fn();
});
afterEach(() => vi.restoreAllMocks());
describe("conversation metadata-only atomic recovery", () => {
  it("persists only strict actor/agent/thread/UUID metadata", async () => {
    await reserveConversationPending(owner, pending, new AbortController().signal);
    expect(readConversationPending(owner)).toEqual(pending);
    expect(JSON.parse(localStorage.getItem(conversationPendingKey(owner))!)).toEqual(pending);
    expect(readConversationPending({ ...owner, userId: 8 })).toBeNull();
    expect(readConversationPending({ ...owner, agentKey: "images" })).toBeNull();
  });
  it("serializes concurrent reservations and never overwrites an unknown UUID", async () => {
    const result = await Promise.allSettled([
      reserveConversationPending(owner, pending, new AbortController().signal),
      reserveConversationPending(owner, { ...pending, operationId: "33333333-3333-4333-8333-333333333333" }, new AbortController().signal),
    ]);
    expect(result.map(item => item.status)).toEqual(["fulfilled", "rejected"]);
    expect(readConversationPending(owner)?.operationId).toBe(operationId);
  });
  it("release checks the exact UUID inside the same owner lock", async () => {
    await reserveConversationPending(owner, pending, new AbortController().signal);
    await expect(releaseConversationPending(owner, "33333333-3333-4333-8333-333333333333", new AbortController().signal)).rejects.toThrow("OPERATION_CHANGED");
    expect(readConversationPending(owner)).toEqual(pending);
    await releaseConversationPending(owner, operationId, new AbortController().signal);
    expect(readConversationPending(owner)).toBeNull();
  });
  it("does not downgrade to unsafe get/set when Web Locks are unsupported", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(reserveConversationPending(owner, pending, new AbortController().signal)).rejects.toThrow("BROWSER_LOCK_REQUIRED");
    expect(localStorage.length).toBe(0);
  });
  it("an aborted owner cannot reserve or release an operation", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(reserveConversationPending(owner, pending, controller.signal)).rejects.toThrow();
    expect(readConversationPending(owner)).toBeNull();
  });
  it.each([{ message: "private" }, { base64: "secret" }, { userId: 8 }, { threadId: "title" }, { operationId: "UNKNOWN" }])("rejects corrupt, foreign or payload-containing metadata %j", patch => {
    localStorage.setItem(conversationPendingKey(owner), JSON.stringify({ ...pending, ...patch }));
    expect(() => readConversationPending(owner)).toThrow();
  });
});
describe("bounded local-only attachment draft", () => {
  it.each(["empty", "html", "path", "whitespace", "oversized"])("rejects invalid file %s", kind => {
    const file = kind === "empty" ? new File([], "empty.txt") : kind === "oversized" ? new File([new Uint8Array(3 * 1024 * 1024 + 1)], "large.txt") : new File(["x"], kind === "html" ? "unsafe.html" : kind === "path" ? "../file.txt" : " file.txt");
    expect(() => validateConversationFiles([file], 0)).toThrow();
  });
  it("rejects more than three including existing drafts before any reading", () => {
    expect(() => validateConversationFiles([new File(["a"], "a.txt")], 3)).toThrow("最多 3");
  });
  it("reads text bytes faithfully without a preview or persistence", async () => {
    const files = await readConversationFiles([new File(["正文 😀"], "input.txt")], 0, new AbortController().signal);
    expect(files[0]).toMatchObject({ name: "input.txt", previewUrl: null, sizeBytes: 11 });
    expect(files[0].base64).toBe(Buffer.from("正文 😀").toString("base64"));
    expect(localStorage.length).toBe(0);
  });
  it("creates and revokes a local image preview only", async () => {
    const files = await readConversationFiles([new File(["synthetic"], "sample.png")], 0, new AbortController().signal);
    expect(files[0].previewUrl).toBe("blob:synthetic-preview"); disposeConversationFiles(files);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:synthetic-preview");
  });
  it("does not read files after identity abort", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(readConversationFiles([new File(["private"], "a.txt")], 0, controller.signal)).rejects.toThrow("已取消");
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});
