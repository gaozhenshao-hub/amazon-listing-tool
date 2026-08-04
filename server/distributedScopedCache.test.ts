import { describe, expect, it } from "vitest";
import { DistributedScopedCache, type RedisCommandClient } from "./infrastructure/cache/distributedScopedCache";

class FakeRedis implements RedisCommandClient {
  readonly values = new Map<string, string>();

  async get(key: string) {
    return this.values.get(key) ?? null;
  }

  async set(key: string, value: string) {
    this.values.set(key, value);
    return "OK";
  }

  async del(...keys: string[]) {
    return keys.reduce((count, key) => count + Number(this.values.delete(key)), 0);
  }

  async incr(key: string) {
    const next = Number(this.values.get(key) || 0) + 1;
    this.values.set(key, String(next));
    return next;
  }
}

describe("distributed tenant scoped cache", () => {
  it("shares values across instances while isolating tenant, workspace, and user scope", async () => {
    const redis = new FakeRedis();
    const options = { namespace: "shared", visibility: "user" as const, defaultTtlMs: 1000 };
    const writer = new DistributedScopedCache<string>(redis, options);
    const reader = new DistributedScopedCache<string>(redis, options);
    const scope = { tenantId: "tenant-a", workspaceId: 1, userId: 10 };
    await writer.set(scope, { query: "same" }, "value");
    expect(await reader.get(scope, { query: "same" })).toBe("value");
    expect(await reader.get({ ...scope, workspaceId: 2 }, { query: "same" })).toBeNull();
    expect(await reader.get({ ...scope, userId: 11 }, { query: "same" })).toBeNull();
  });

  it("propagates user and workspace invalidation without scanning keys", async () => {
    const redis = new FakeRedis();
    const cache = new DistributedScopedCache<string>(redis, {
      namespace: "invalidate",
      visibility: "user",
      defaultTtlMs: 1000,
    });
    const user10 = { tenantId: "tenant-a", workspaceId: 1, userId: 10 };
    const user11 = { tenantId: "tenant-a", workspaceId: 1, userId: 11 };
    await cache.set(user10, "same", "ten");
    await cache.set(user11, "same", "eleven");
    await cache.invalidateScope(user10);
    expect(await cache.get(user10, "same")).toBeNull();
    expect(await cache.get(user11, "same")).toBe("eleven");
    await cache.invalidateWorkspace(user11);
    expect(await cache.get(user11, "same")).toBeNull();
  });
});
