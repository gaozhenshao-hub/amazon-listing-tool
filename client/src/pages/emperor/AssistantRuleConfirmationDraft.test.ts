// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { conversationPendingKey } from "./AssistantConversationDraft";
import { RuleConfirmationPendingSchema, readRuleConfirmationPending, releaseRuleConfirmation, reserveRuleConfirmation, ruleConfirmationPendingKey } from "./AssistantRuleConfirmationDraft";

const owner = { userId: 7, workspaceId: 11, agentKey: "listing" as const };
const pending = { version: 1 as const, ...owner, threadId: "11111111-1111-4111-8111-111111111111", operationId: "22222222-2222-4222-8222-222222222222", confirmationId: "33333333-3333-4333-8333-333333333333", baseRevision: 3, baseHash: "a".repeat(64), proposalHash: "b".repeat(64) };
const signal = () => new AbortController().signal;
beforeEach(() => {
  localStorage.clear();
  let lane = Promise.resolve();
  Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn((_name, options, callback) => { const result = lane.then(() => { options.signal.throwIfAborted(); return callback(); }); lane = result.catch(() => undefined); return result; }) } });
});
describe("rule confirmation recovery metadata", () => {
  it("keeps the rule UUID and lock separate from the original conversation", async () => {
    localStorage.setItem(conversationPendingKey(owner), "original conversation marker");
    await reserveRuleConfirmation(owner, pending, signal());
    expect(readRuleConfirmationPending(owner)).toEqual(pending);
    await releaseRuleConfirmation(owner, pending.confirmationId, signal());
    expect(readRuleConfirmationPending(owner)).toBeNull();
    expect(localStorage.getItem(conversationPendingKey(owner))).toBe("original conversation marker");
    expect(navigator.locks.request).toHaveBeenCalledWith(ruleConfirmationPendingKey(owner), expect.objectContaining({ mode: "exclusive" }), expect.any(Function));
  });
  it("reserves atomically across two callers without replacing an unknown UUID", async () => {
    const second = { ...pending, confirmationId: "44444444-4444-4444-8444-444444444444" };
    const result = await Promise.allSettled([reserveRuleConfirmation(owner, pending, signal()), reserveRuleConfirmation(owner, second, signal())]);
    expect(result.map(item => item.status)).toEqual(["fulfilled", "rejected"]);
    expect(readRuleConfirmationPending(owner)?.confirmationId).toBe(pending.confirmationId);
    await expect(releaseRuleConfirmation(owner, second.confirmationId, signal())).rejects.toThrow("CHANGED");
    expect(readRuleConfirmationPending(owner)?.confirmationId).toBe(pending.confirmationId);
  });
  it.each(["rules", "message", "base64", "rawBody"])("rejects business content field %s", field => {
    expect(RuleConfirmationPendingSchema.safeParse({ ...pending, [field]: "private" }).success).toBe(false);
  });
  it("rejects corrupt/foreign metadata instead of silently losing the original operation", () => {
    localStorage.setItem(ruleConfirmationPendingKey(owner), JSON.stringify({ ...pending, userId: 9 }));
    expect(() => readRuleConfirmationPending(owner)).toThrow();
    localStorage.setItem(ruleConfirmationPendingKey(owner), "broken"); expect(() => readRuleConfirmationPending(owner)).toThrow();
  });
  it("refuses the original turn UUID as a confirmation recovery UUID", () => {
    localStorage.setItem(ruleConfirmationPendingKey(owner), JSON.stringify({ ...pending, confirmationId: pending.operationId }));
    expect(() => readRuleConfirmationPending(owner)).toThrow();
  });
  it("never falls back to unsafe storage without WebLocks", async () => {
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined });
    await expect(reserveRuleConfirmation(owner, pending, signal())).rejects.toThrow("BROWSER_LOCK_REQUIRED");
    expect(localStorage.length).toBe(0);
  });
  it("does not reserve after the owning identity has been aborted", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(reserveRuleConfirmation(owner, pending, controller.signal)).rejects.toThrow(); expect(localStorage.length).toBe(0);
  });
});
