import { describe, expect, it } from "vitest";
import { ContextScopedCache, ScopedTtlCache, createScopedCacheKey } from "./infrastructure/cache/scopedCache";
import { currentOpsCacheScope, runWithOpsWorkspace } from "./domains/ops/workspaceContext";

describe("tenant scoped cache", () => {
  it("isolates tenants, workspaces, and user-private values", () => {
    const cache = new ScopedTtlCache<string>({
      namespace: "test.private",
      visibility: "user",
      defaultTtlMs: 1000,
      maxEntries: 10,
    });
    const scope = { tenantId: "tenant-a", workspaceId: 1, userId: 10 };
    cache.set(scope, { query: "same" }, "secret-a");
    expect(cache.get(scope, { query: "same" })).toBe("secret-a");
    expect(cache.get({ ...scope, tenantId: "tenant-b" }, { query: "same" })).toBeNull();
    expect(cache.get({ ...scope, workspaceId: 2 }, { query: "same" })).toBeNull();
    expect(cache.get({ ...scope, userId: 11 }, { query: "same" })).toBeNull();
  });

  it("uses stable hashed inputs without exposing query values", () => {
    const scope = { tenantId: "tenant-a", workspaceId: 1, userId: 10 };
    const first = createScopedCacheKey(scope, "search", { b: 2, a: "sensitive phrase" });
    const second = createScopedCacheKey(scope, "search", { a: "sensitive phrase", b: 2 });
    expect(first).toBe(second);
    expect(first).not.toContain("sensitive phrase");
  });

  it("expires entries and enforces an LRU capacity", () => {
    let now = 1000;
    const cache = new ScopedTtlCache<number>({
      namespace: "bounded",
      visibility: "workspace",
      defaultTtlMs: 100,
      maxEntries: 2,
      now: () => now,
    });
    const scope = { tenantId: "tenant-a", workspaceId: 1 };
    cache.set(scope, "a", 1);
    cache.set(scope, "b", 2);
    expect(cache.get(scope, "a")).toBe(1);
    cache.set(scope, "c", 3);
    expect(cache.get(scope, "b")).toBeNull();
    now += 101;
    expect(cache.get(scope, "a")).toBeNull();
    expect(cache.size).toBe(0);
  });

  it("injects the active request scope into map-like business caches", async () => {
    const cache = new ContextScopedCache<string>({
      namespace: "contextual",
      visibility: "user",
      defaultTtlMs: 1000,
      maxEntries: 10,
    }, () => currentOpsCacheScope("user"));
    await runWithOpsWorkspace({ workspaceId: 1, tenantId: "tenant-a", userId: 10 }, async () => {
      cache.set("same", "user-10");
      expect(cache.get("same")).toBe("user-10");
    });
    await runWithOpsWorkspace({ workspaceId: 1, tenantId: "tenant-a", userId: 11 }, async () => {
      expect(cache.get("same")).toBeNull();
    });
  });

  it("invalidates one user scope or every entry in a workspace", () => {
    const cache = new ScopedTtlCache<string>({
      namespace: "invalidate",
      visibility: "user",
      defaultTtlMs: 1000,
      maxEntries: 10,
    });
    const user10 = { tenantId: "tenant-a", workspaceId: 1, userId: 10 };
    const user11 = { tenantId: "tenant-a", workspaceId: 1, userId: 11 };
    cache.set(user10, "same", "ten");
    cache.set(user11, "same", "eleven");
    expect(cache.invalidateScope(user10)).toBe(1);
    expect(cache.get(user11, "same")).toBe("eleven");
    expect(cache.invalidateWorkspace(user11)).toBe(1);
    expect(cache.size).toBe(0);
  });
});
