import { afterEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";
const database = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock("../../repositories/dbClient", async importOriginal => ({ ...await importOriginal<typeof import("../../repositories/dbClient")>(),
  requireDb: database.get, getDb: () => { throw new Error("UNEXPECTED_REAL_DATABASE"); } }));
import { createImageTaggingWorker, discoverImageTagging, shouldProcessImageTagging } from "./imageTaggingWorker";

const operationId = "11111111-1111-4111-8111-111111111111";
const hint = { id: 4, userId: 3, workspaceId: 7, imageSetId: 9, operationId };
afterEach(() => { vi.unstubAllEnvs(); database.get.mockReset(); });
describe("dedicated tagger worker composition", () => {
  it.each(["web", "scheduler", "test"])("never starts model processing in role %s", role => {
    expect(shouldProcessImageTagging(role as "web", { ENABLE_IMAGE_TAGGING_WRITES: "true", ENABLE_IMAGE_TAGGING_WORKER: "true" })).toBe(false);
  });
  it.each([undefined, "1", "TRUE", "false"])("requires both precise true gates: %s", value => {
    expect(shouldProcessImageTagging("worker", { ENABLE_IMAGE_TAGGING_WRITES: value, ENABLE_IMAGE_TAGGING_WORKER: "true" })).toBe(false);
    expect(shouldProcessImageTagging("worker", { ENABLE_IMAGE_TAGGING_WRITES: "true", ENABLE_IMAGE_TAGGING_WORKER: value })).toBe(false);
  });
  it("does not even obtain a DB when discovery is disabled", async () => {
    vi.stubEnv("ENABLE_IMAGE_TAGGING_WRITES", "false"); expect(await discoverImageTagging(0, 10)).toEqual([]); expect(database.get).not.toHaveBeenCalled();
  });
  it("uses exact dedicated kind, actual leaseUntil, bounded metadata and ordered cursor", async () => {
    vi.stubEnv("ENABLE_IMAGE_TAGGING_WRITES", "true"); vi.stubEnv("ENABLE_IMAGE_TAGGING_WORKER", "true");
    const queries: Array<{ sql: string; params: unknown[] }> = [];
    database.get.mockResolvedValue({ execute: async (query: SQL) => { queries.push(new MySqlDialect().sqlToQuery(query)); return [[hint], []]; } });
    expect(await discoverImageTagging(0, 10)).toEqual([hint]);
    expect(queries[0].sql).toContain("kind='knowledge.image_tagging.v1'"); expect(queries[0].sql).toContain("leaseUntil<=NOW(3)");
    expect(queries[0].sql).not.toContain("leaseExpiresAt"); expect(queries[0].sql).not.toMatch(/SELECT \*| AS input| AS output|ai_artifacts/u);
    expect(queries[0].params).toEqual([0, 10]);
  });
  it("rejects duplicate/reversed or body-bearing queue rows", async () => {
    vi.stubEnv("ENABLE_IMAGE_TAGGING_WRITES", "true"); vi.stubEnv("ENABLE_IMAGE_TAGGING_WORKER", "true");
    for (const rows of [[hint, hint], [{ ...hint, input: { secret: "PRIVATE" } }], [{ ...hint, userId: 0 }]]) {
      database.get.mockResolvedValue({ execute: async () => [rows, []] }); await expect(discoverImageTagging(0, 10)).rejects.toThrow();
    }
  });
  it("loses discovery authority when the gate changes while DB read is pending", async () => {
    vi.stubEnv("ENABLE_IMAGE_TAGGING_WRITES", "true"); vi.stubEnv("ENABLE_IMAGE_TAGGING_WORKER", "true");
    database.get.mockResolvedValue({ execute: async () => { vi.stubEnv("ENABLE_IMAGE_TAGGING_WORKER", "false"); return [[hint], []]; } });
    expect(await discoverImageTagging(0, 10)).toEqual([]);
  });
  it("deduplicates overlapping ticks and delivers exact owner plus operation", async () => {
    let release!: (value: typeof hint[]) => void;
    const discover = vi.fn(() => new Promise<typeof hint[]>(resolve => { release = resolve; })), process = vi.fn(async () => {});
    const worker = createImageTaggingWorker({ enabled: () => true, discover, process, workerId: "synthetic-worker" });
    const first = worker.tick(), second = worker.tick(); expect(first).toBe(second); release([hint]); await first;
    expect(discover).toHaveBeenCalledTimes(1); expect(process).toHaveBeenCalledWith({ identity: { userId: 3, workspaceId: 7 }, operation: { expectedWorkspaceId: 7, imageSetId: 9, operationId }, workerId: "synthetic-worker", signal: expect.any(AbortSignal) });
    await worker.stop();
  });
  it("drains and stops rather than starting remaining discovered work", async () => {
    let started!: () => void, finish!: () => void;
    const began = new Promise<void>(resolve => { started = resolve; });
    const process = vi.fn(async () => { started(); await new Promise<void>(resolve => { finish = resolve; }); });
    const worker = createImageTaggingWorker({ enabled: () => true, discover: async () => [hint, { ...hint, id: 5 }], process });
    const tick = worker.tick(); await began; const stopped = worker.stop(); finish(); await stopped; await tick; await worker.tick(); expect(process).toHaveBeenCalledTimes(1);
  });
  it("reports only a safe category when discovery fails", async () => {
    const report = vi.fn(), worker = createImageTaggingWorker({ enabled: () => true, discover: async () => { throw new Error("PRIVATE_SQL_OR_URL"); }, report });
    await worker.tick(); expect(report).toHaveBeenCalledWith("discovery_failed"); expect(JSON.stringify(report.mock.calls)).not.toContain("PRIVATE"); await worker.stop();
  });
});
