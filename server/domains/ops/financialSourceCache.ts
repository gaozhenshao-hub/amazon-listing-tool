import type { MonthlyFinancialReadRow } from "../../../shared/monthlyFinancialRead";

export type CompactFinancialSource = { id: number; fileHash: string; rows: Omit<MonthlyFinancialReadRow, "details">[] };

/** Only validated immutable imports are cached. Permissions, current owners,
 * parent mappings, winner selection and snapshots are resolved on every read.
 * Process-local and bounded: no originals, credentials or signed URLs. */
export function createFinancialSourceCache({
  maxBytes = 24 * 1024 * 1024,
  maxEntries = 200,
  ttlMs = 30 * 60_000,
  now = Date.now,
} = {}) {
  const entries = new Map<string, { value: CompactFinancialSource; bytes: number; expires: number }>();
  const pending = new Map<string, Promise<CompactFinancialSource>>();
  let bytes = 0;
  const remove = (key: string) => {
    const entry = entries.get(key);
    if (entry) { bytes -= entry.bytes; entries.delete(key); }
  };
  const cache = {
    get(key: string): CompactFinancialSource | undefined {
      const entry = entries.get(key);
      if (!entry) return undefined;
      if (entry.expires <= now()) { remove(key); return undefined; }
      entries.delete(key); entries.set(key, entry);
      return structuredClone(entry.value);
    },
    set(key: string, value: CompactFinancialSource) {
      remove(key);
      const size = Buffer.byteLength(JSON.stringify(value), "utf8");
      if (size > maxBytes || maxEntries < 1) return;
      for (const [id, item] of entries) if (item.expires <= now()) remove(id);
      while (entries.size && (bytes + size > maxBytes || entries.size >= maxEntries)) remove(entries.keys().next().value!);
      entries.set(key, { value: structuredClone(value), bytes: size, expires: now() + ttlMs });
      bytes += size;
    },
    clear() { entries.clear(); bytes = 0; },
    size() { return { entries: entries.size, bytes }; },
    async load(key: string, loader: () => Promise<CompactFinancialSource>): Promise<CompactFinancialSource> {
      const cached = cache.get(key);
      if (cached) return cached;
      const existing = pending.get(key);
      if (existing) return structuredClone(await existing);
      // Metadata is checked by every caller. Only immutable source parsing is
      // shared; authorization and product ownership are never cached here.
      if (pending.size >= maxEntries) return loader();
      const request = Promise.resolve().then(loader);
      pending.set(key, request);
      try {
        const value = await request;
        cache.set(key, value);
        return structuredClone(value);
      } finally { pending.delete(key); }
    },
  };
  return cache;
}

export const financialSourceCache = createFinancialSourceCache();
