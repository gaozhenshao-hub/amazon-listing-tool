import { createHash } from "node:crypto";

export type CacheScope = {
  tenantId: string | number;
  workspaceId: string | number;
  userId?: string | number | null;
};

export type CacheVisibility = "workspace" | "user";

type CacheEntry<T> = {
  data: T;
  createdAt: number;
  expiresAt: number;
};

function requiredScopePart(value: string | number | null | undefined, name: string) {
  const normalized = String(value ?? "").trim();
  if (!normalized) throw new Error(`Scoped cache requires ${name}`);
  return normalized;
}

function stableValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (value === null || value === undefined || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (Buffer.isBuffer(value)) return { bufferHash: createHash("sha256").update(value).digest("hex") };
  if (Array.isArray(value)) return value.map((item) => stableValue(item, seen));
  if (typeof value === "object") {
    if (seen.has(value)) throw new Error("Scoped cache input cannot contain circular references");
    seen.add(value);
    const normalized = Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item, seen)]),
    );
    seen.delete(value);
    return normalized;
  }
  return String(value);
}

export function stableCacheHash(input: unknown) {
  return createHash("sha256").update(JSON.stringify(stableValue(input))).digest("hex");
}

export function createScopedCacheKey(
  scope: CacheScope,
  namespace: string,
  input: unknown,
  visibility: CacheVisibility = "user",
) {
  return `${createScopedCachePrefix(scope, namespace, visibility)}:${stableCacheHash(input)}`;
}

export function createScopedCachePrefix(
  scope: CacheScope,
  namespace: string,
  visibility: CacheVisibility = "user",
) {
  const tenantId = requiredScopePart(scope.tenantId, "tenantId");
  const workspaceId = requiredScopePart(scope.workspaceId, "workspaceId");
  const userId = visibility === "user" ? requiredScopePart(scope.userId, "userId") : "shared";
  const normalizedNamespace = requiredScopePart(namespace, "namespace").replace(/[^A-Za-z0-9_.-]/g, "_");
  return ["v1", tenantId, workspaceId, userId, normalizedNamespace].join(":");
}

export class ScopedTtlCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(private readonly options: {
    namespace: string;
    visibility: CacheVisibility;
    defaultTtlMs: number;
    maxEntries: number;
    now?: () => number;
  }) {
    if (options.defaultTtlMs <= 0) throw new Error("Scoped cache defaultTtlMs must be positive");
    if (options.maxEntries <= 0) throw new Error("Scoped cache maxEntries must be positive");
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private key(scope: CacheScope, input: unknown) {
    return createScopedCacheKey(scope, this.options.namespace, input, this.options.visibility);
  }

  private pruneExpired(now = this.now()) {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(key);
    }
  }

  get(scope: CacheScope, input: unknown): T | null {
    const key = this.key(scope, input);
    const entry = this.entries.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.data;
  }

  set(scope: CacheScope, input: unknown, data: T, ttlMs = this.options.defaultTtlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Scoped cache ttlMs must be positive");
    const now = this.now();
    const key = this.key(scope, input);
    this.entries.delete(key);
    this.entries.set(key, { data, createdAt: now, expiresAt: now + ttlMs });
    this.pruneExpired(now);
    while (this.entries.size > this.options.maxEntries) {
      const oldestKey = this.entries.keys().next().value;
      if (!oldestKey) break;
      this.entries.delete(oldestKey);
    }
  }

  delete(scope: CacheScope, input: unknown) {
    return this.entries.delete(this.key(scope, input));
  }

  invalidateScope(scope: CacheScope) {
    const prefix = `${createScopedCachePrefix(scope, this.options.namespace, this.options.visibility)}:`;
    let deleted = 0;
    for (const key of this.entries.keys()) {
      if (key.startsWith(prefix) && this.entries.delete(key)) deleted += 1;
    }
    return deleted;
  }

  invalidateWorkspace(scope: Pick<CacheScope, "tenantId" | "workspaceId">) {
    const tenantId = requiredScopePart(scope.tenantId, "tenantId");
    const workspaceId = requiredScopePart(scope.workspaceId, "workspaceId");
    const namespace = requiredScopePart(this.options.namespace, "namespace").replace(/[^A-Za-z0-9_.-]/g, "_");
    const workspacePrefix = `v1:${tenantId}:${workspaceId}:`;
    let deleted = 0;
    for (const key of this.entries.keys()) {
      const parts = key.split(":");
      if (key.startsWith(workspacePrefix) && parts[4] === namespace && this.entries.delete(key)) deleted += 1;
    }
    return deleted;
  }

  ageSeconds(scope: CacheScope, input: unknown): number | null {
    const entry = this.entries.get(this.key(scope, input));
    if (!entry || entry.expiresAt <= this.now()) return null;
    return Math.floor((this.now() - entry.createdAt) / 1000);
  }

  clear() {
    this.entries.clear();
  }

  get size() {
    this.pruneExpired();
    return this.entries.size;
  }
}

export class ContextScopedCache<T> {
  private readonly cache: ScopedTtlCache<T>;

  constructor(
    options: ConstructorParameters<typeof ScopedTtlCache<T>>[0],
    private readonly scopeProvider: () => CacheScope,
  ) {
    this.cache = new ScopedTtlCache<T>(options);
  }

  get(input: unknown) {
    return this.cache.get(this.scopeProvider(), input);
  }

  set(input: unknown, data: T, ttlMs?: number) {
    this.cache.set(this.scopeProvider(), input, data, ttlMs);
    return this;
  }

  delete(input: unknown) {
    return this.cache.delete(this.scopeProvider(), input);
  }

  invalidateScope() {
    return this.cache.invalidateScope(this.scopeProvider());
  }

  invalidateWorkspace() {
    return this.cache.invalidateWorkspace(this.scopeProvider());
  }

  ageSeconds(input: unknown) {
    return this.cache.ageSeconds(this.scopeProvider(), input);
  }

  clear() {
    this.cache.clear();
  }

  get size() {
    return this.cache.size;
  }
}
