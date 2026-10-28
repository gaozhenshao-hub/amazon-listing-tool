import { describe, expect, it, vi } from "vitest";
import { createFinancialSourceCache, type CompactFinancialSource } from "./financialSourceCache";

const source = (id: number): CompactFinancialSource => ({ id, fileHash: "a".repeat(64), rows: [] });
describe("bounded immutable financial source cache", () => {
  it("coalesces concurrent cold reads, isolates their results, and retries failed loads", async () => {
    const cache = createFinancialSourceCache();
    const loader = vi.fn(async () => source(1));
    const [first, second] = await Promise.all([cache.load("same", loader), cache.load("same", loader)]);
    expect(loader).toHaveBeenCalledOnce();
    first.fileHash = "changed";
    expect(second.fileHash).toBe("a".repeat(64));
    const failure = vi.fn(async () => { throw new Error("source unavailable"); });
    await expect(cache.load("failed", failure)).rejects.toThrow("source unavailable");
    await expect(cache.load("failed", loader)).resolves.toMatchObject({id: 1});
  });
  it("isolates caller mutations and workspaces, expires without extending lifetime on reads", () => {
    let now = 0;
    const cache = createFinancialSourceCache({ now: () => now, ttlMs: 100 });
    const original = source(1);
    cache.set("workspace7:1", original);
    original.fileHash = "mutated";
    const read = cache.get("workspace7:1")!;
    expect(read.fileHash).toBe("a".repeat(64));
    read.fileHash = "also mutated";
    expect(cache.get("workspace8:1")).toBeUndefined();
    now = 99; expect(cache.get("workspace7:1")!.fileHash).toBe("a".repeat(64));
    now = 100; expect(cache.get("workspace7:1")).toBeUndefined();
    expect(cache.size()).toEqual({ entries: 0, bytes: 0 });
  });
  it("evicts least-recently-used entries and refuses oversized values", () => {
    const cache = createFinancialSourceCache({ maxEntries: 2, maxBytes: 300 });
    cache.set("a", source(1)); cache.set("b", source(2)); cache.get("a"); cache.set("c", source(3));
    expect(cache.get("b")).toBeUndefined(); expect(cache.get("a")?.id).toBe(1);
    cache.set("huge", { ...source(4), fileHash: "x".repeat(400) });
    expect(cache.get("huge")).toBeUndefined(); expect(cache.size().bytes).toBeLessThanOrEqual(300);
  });
});
