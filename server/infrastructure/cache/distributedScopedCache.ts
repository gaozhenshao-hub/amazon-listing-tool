import {
  createScopedCachePrefix,
  stableCacheHash,
  type CacheScope,
  type CacheVisibility,
} from "./scopedCache";

export type RedisCommandClient = {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, options: { PX: number }): Promise<unknown>;
  del(...keys: string[]): Promise<number>;
  incr(key: string): Promise<number>;
};

type DistributedEntry<T> = {
  data: T;
  createdAt: number;
  expiresAt: number;
};

export class DistributedScopedCache<T> {
  constructor(
    private readonly client: RedisCommandClient,
    private readonly options: {
      namespace: string;
      visibility: CacheVisibility;
      defaultTtlMs: number;
      now?: () => number;
    },
  ) {
    if (!Number.isFinite(options.defaultTtlMs) || options.defaultTtlMs <= 0) {
      throw new Error("Distributed scoped cache defaultTtlMs must be positive");
    }
  }

  private now() {
    return this.options.now?.() ?? Date.now();
  }

  private workspaceVersionKey(scope: CacheScope) {
    return `${createScopedCachePrefix(scope, this.options.namespace, "workspace")}:version`;
  }

  private userVersionKey(scope: CacheScope) {
    return `${createScopedCachePrefix(scope, this.options.namespace, this.options.visibility)}:version`;
  }

  private async version(key: string) {
    return (await this.client.get(key)) || "0";
  }

  private async key(scope: CacheScope, input: unknown) {
    const workspaceVersionKey = this.workspaceVersionKey(scope);
    const userVersionKey = this.userVersionKey(scope);
    const [workspaceVersion, userVersion] = workspaceVersionKey === userVersionKey
      ? [await this.version(workspaceVersionKey), "shared"]
      : await Promise.all([this.version(workspaceVersionKey), this.version(userVersionKey)]);
    const prefix = createScopedCachePrefix(scope, this.options.namespace, this.options.visibility);
    return `${prefix}:w${workspaceVersion}:u${userVersion}:${stableCacheHash(input)}`;
  }

  async get(scope: CacheScope, input: unknown): Promise<T | null> {
    const raw = await this.client.get(await this.key(scope, input));
    if (!raw) return null;
    let entry: DistributedEntry<T>;
    try {
      entry = JSON.parse(raw) as DistributedEntry<T>;
    } catch {
      return null;
    }
    if (!Number.isFinite(entry.expiresAt) || entry.expiresAt <= this.now()) return null;
    return entry.data;
  }

  async set(scope: CacheScope, input: unknown, data: T, ttlMs = this.options.defaultTtlMs) {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new Error("Distributed scoped cache ttlMs must be positive");
    const now = this.now();
    const entry: DistributedEntry<T> = { data, createdAt: now, expiresAt: now + ttlMs };
    await this.client.set(await this.key(scope, input), JSON.stringify(entry), { PX: ttlMs });
  }

  async delete(scope: CacheScope, input: unknown) {
    return (await this.client.del(await this.key(scope, input))) > 0;
  }

  async invalidateScope(scope: CacheScope) {
    await this.client.incr(this.userVersionKey(scope));
  }

  async invalidateWorkspace(scope: CacheScope) {
    await this.client.incr(this.workspaceVersionKey(scope));
  }
}

export class DistributedContextScopedCache<T> {
  constructor(
    private readonly cache: DistributedScopedCache<T>,
    private readonly scopeProvider: () => CacheScope,
  ) {}

  get(input: unknown) {
    return this.cache.get(this.scopeProvider(), input);
  }

  set(input: unknown, data: T, ttlMs?: number) {
    return this.cache.set(this.scopeProvider(), input, data, ttlMs);
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
}
