// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { developmentMarketPendingKey, readDevelopmentMarketPending, saveDevelopmentMarketPending, releaseDevelopmentMarketPending,
  withDevelopmentMarketLock, type DevelopmentMarketPending } from "./developmentMarketPending";
const scope = { userId: 3, workspaceId: 7, devProjectId: 5 }, first = "11111111-1111-4111-8111-111111111111", second = "22222222-2222-4222-8222-222222222222";
const value = (): DevelopmentMarketPending => ({ version: 1, ...scope, operationId: first, runOperationId: null, action: "start", requestHash: "a".repeat(64) });
beforeEach(() => { localStorage.clear(); Object.defineProperty(navigator, "locks", { configurable: true, value: { request: vi.fn(async (_key, _options, work) => work({ name: "synthetic" })) } }); });
describe("Development market fixed UUID metadata recovery", () => {
  it("stores metadata only and observes original reservation idempotently", () => {
    saveDevelopmentMarketPending(scope, value()); expect(saveDevelopmentMarketPending(scope, value())).toEqual(value());
    expect(readDevelopmentMarketPending(scope)).toEqual(value()); expect(localStorage.getItem(developmentMarketPendingKey(scope))).not.toMatch(/source|rules|prompt|stats|content|model/u);
  });
  it.each(["userId", "workspaceId", "devProjectId"] as const)("isolates %s", field => { saveDevelopmentMarketPending(scope, value()); expect(readDevelopmentMarketPending({ ...scope, [field]: 99 })).toBeNull(); });
  it("rejects new UUID and same UUID changed request until explicit exact replacement", () => {
    saveDevelopmentMarketPending(scope, value()); expect(() => saveDevelopmentMarketPending(scope, { ...value(), operationId: second })).toThrow();
    expect(() => saveDevelopmentMarketPending(scope, { ...value(), requestHash: "b".repeat(64) })).toThrow();
    const applied = { ...value(), operationId: second, runOperationId: first, action: "apply" as const };
    expect(saveDevelopmentMarketPending(scope, applied, first)).toEqual(applied); releaseDevelopmentMarketPending(scope, first); expect(readDevelopmentMarketPending(scope)).toEqual(applied);
    releaseDevelopmentMarketPending(scope, second); expect(readDevelopmentMarketPending(scope)).toBeNull();
  });
  it.each([{ rawResult: "private" }, { source: {} }, { url: "private" }, { base64: "pixels" }])("rejects business payload without deleting evidence", extra => {
    const raw = JSON.stringify({ ...value(), ...extra }); localStorage.setItem(developmentMarketPendingKey(scope), raw);
    expect(() => readDevelopmentMarketPending(scope)).toThrow(); expect(localStorage.getItem(developmentMarketPendingKey(scope))).toBe(raw);
  });
  it("malformed/contradictory data blocks writes; no browser-lock fallback authorizes mutation", async () => {
    expect(() => saveDevelopmentMarketPending(scope, { ...value(), action: "apply" })).toThrow();
    localStorage.setItem(developmentMarketPendingKey(scope), "{broken"); expect(() => readDevelopmentMarketPending(scope)).toThrow();
    Object.defineProperty(navigator, "locks", { configurable: true, value: undefined }); const body = vi.fn();
    await expect(withDevelopmentMarketLock(scope, body)).rejects.toThrow(); expect(body).not.toHaveBeenCalled();
  });
});
