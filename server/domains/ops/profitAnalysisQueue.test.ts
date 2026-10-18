import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { ProfitAnalysisJobDatabase, ProfitAnalysisJobExecutor } from "./profitAnalysisJobRepository";

const defaults = vi.hoisted(() => ({ requireDb: vi.fn(), schemaReady: vi.fn() }));
vi.mock("../../repositories/dbClient", () => ({ requireDb: defaults.requireDb }));
vi.mock("./profitAnalysisJobRepository", () => ({ profitAnalysisJobSchemaReady: defaults.schemaReady }));
import { createProfitAnalysisQueue, profitAnalysisWorkerEnabled } from "./profitAnalysisQueue";

const hint = { id: 3, workspaceId: 7, userId: 11, operationId: "a0000000-0000-4000-8000-000000000001" };
function setup(rows: unknown = [hint]) {
  let gate = true;
  const execute = vi.fn().mockResolvedValue([rows, []]);
  const transaction = vi.fn(async <T>(body: (tx: ProfitAnalysisJobExecutor) => Promise<T>) => body({ execute }));
  const database = vi.fn().mockResolvedValue({ transaction });
  const schemaReady = vi.fn().mockResolvedValue(true);
  return { execute, transaction, database, schemaReady, setEnabled: (value: boolean) => { gate = value; },
    queue: createProfitAnalysisQueue({ database, schemaReady, enabled: () => gate }) };
}
beforeEach(() => { vi.clearAllMocks(); defaults.schemaReady.mockResolvedValue(true); });
afterEach(() => vi.unstubAllEnvs());

describe("private profit analysis lightweight queue discovery", () => {
  it("performs zero database or schema IO when disabled", async () => {
    const t = setup(); t.setEnabled(false);
    expect(await t.queue.discover({ afterId: 0, limit: 10 })).toEqual([]);
    expect(t.database).not.toHaveBeenCalled(); expect(t.schemaReady).not.toHaveBeenCalled(); expect(t.execute).not.toHaveBeenCalled();
  });
  it.each([[undefined, undefined], ["true", undefined], [undefined, "true"], ["false", "true"], ["true", "false"], ["TRUE", "true"], ["1", "1"]])("requires both explicit true flags: %s / %s", async (writes, worker) => {
    vi.stubEnv("ENABLE_PROFIT_ANALYSIS_WRITES", writes); vi.stubEnv("ENABLE_PROFIT_ANALYSIS_WORKER", worker);
    expect(profitAnalysisWorkerEnabled()).toBe(false);
    expect(await createProfitAnalysisQueue().discover({ afterId: 0, limit: 10 })).toEqual([]);
    expect(defaults.requireDb).not.toHaveBeenCalled(); expect(defaults.schemaReady).not.toHaveBeenCalled();
  });
  it("uses the exact shared schema admission with a real default database dependency only after the gate", async () => {
    vi.stubEnv("ENABLE_PROFIT_ANALYSIS_WRITES", "true"); vi.stubEnv("ENABLE_PROFIT_ANALYSIS_WORKER", "true");
    const t = setup(); defaults.requireDb.mockResolvedValue({ transaction: t.transaction });
    expect(profitAnalysisWorkerEnabled()).toBe(true);
    expect(await createProfitAnalysisQueue().discover({ afterId: 0, limit: 10 })).toEqual([hint]);
    expect(defaults.requireDb).toHaveBeenCalledWith("Private profit analysis queue");
    expect(defaults.schemaReady).toHaveBeenCalledWith({ execute: t.execute });
  });
  it("uses a bounded numeric cursor and only four lightweight ID columns", async () => {
    const t = setup(); expect(await t.queue.discover({ afterId: 2, limit: 25 })).toEqual([hint]);
    const query = new MySqlDialect().sqlToQuery(t.execute.mock.calls[0][0]);
    expect(query.params).toEqual([2, 25]);
    expect(query.sql).toMatch(/SELECT id, workspace_id AS workspaceId, user_id AS userId,\s+operation_id AS operationId\s+FROM ops_profit_analysis_runs/u);
    expect(query.sql).toContain("state IN ('queued','dispatched','result_ready')");
    expect(query.sql).toContain("lease_expires_at IS NULL OR lease_expires_at <= NOW(3)");
    expect(query.sql).toContain("ORDER BY id ASC LIMIT ?");
    expect(query.sql).not.toMatch(/SELECT\s+\*|snapshot|result_snapshot|request_hash|dispatch_receipt|target_snapshot|source_hash|ai_jobs|INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|FOR UPDATE/iu);
    expect(t.execute).toHaveBeenCalledOnce();
  });
  it("rejects missing exact schema before querying hints", async () => {
    const t = setup(); t.schemaReady.mockResolvedValue(false);
    await expect(t.queue.discover({ afterId: 0, limit: 10 })).rejects.toThrow("PROFIT_ANALYSIS_QUEUE_SCHEMA_UNAVAILABLE");
    expect(t.execute).not.toHaveBeenCalled();
  });
  it("stops before opening a transaction if disabled while obtaining the database", async () => {
    const t = setup(); t.database.mockImplementation(async () => { t.setEnabled(false); return { transaction: t.transaction }; });
    expect(await t.queue.discover({ afterId: 0, limit: 10 })).toEqual([]); expect(t.transaction).not.toHaveBeenCalled();
  });
  it("stops inside a transaction before schema access when the gate changes", async () => {
    const t = setup(); t.transaction.mockImplementation(async body => { t.setEnabled(false); return body({ execute: t.execute }); });
    expect(await t.queue.discover({ afterId: 0, limit: 10 })).toEqual([]); expect(t.schemaReady).not.toHaveBeenCalled(); expect(t.execute).not.toHaveBeenCalled();
  });
  it("does not read hints if disabled during schema admission", async () => {
    const t = setup(); t.schemaReady.mockImplementation(async () => { t.setEnabled(false); return true; });
    expect(await t.queue.discover({ afterId: 0, limit: 10 })).toEqual([]); expect(t.execute).not.toHaveBeenCalled();
  });
  it("discards rows if disabled while the SQL request is in flight", async () => {
    const t = setup(); t.execute.mockImplementation(async () => { t.setEnabled(false); return [[hint], []]; });
    expect(await t.queue.discover({ afterId: 0, limit: 10 })).toEqual([]);
  });
  it("discards hints if disabled while the read transaction is finishing", async () => {
    const t = setup(); t.transaction.mockImplementation(async body => { const value = await body({ execute: t.execute }); t.setEnabled(false); return value; });
    expect(await t.queue.discover({ afterId: 0, limit: 10 })).toEqual([]);
  });
  it.each([0, -1, 26, 1.5, NaN, Infinity, "10", null])("rejects invalid limit %s before any IO", async limit => {
    const t = setup(); await expect(t.queue.discover({ afterId: 0, limit } as never)).rejects.toThrow("PROFIT_ANALYSIS_QUEUE_INVALID"); expect(t.database).not.toHaveBeenCalled();
  });
  it.each([-1, 2.5, 2_147_483_648, NaN, Infinity, "0", null])("rejects invalid afterId %s before any IO", async afterId => {
    const t = setup(); await expect(t.queue.discover({ afterId, limit: 1 } as never)).rejects.toThrow("PROFIT_ANALYSIS_QUEUE_INVALID"); expect(t.database).not.toHaveBeenCalled();
  });
  it("accepts cursor range endpoints without numeric coercion or extra actor filters", async () => {
    const t = setup([]);
    expect(await t.queue.discover({ afterId: 0, limit: 1 })).toEqual([]);
    expect(await t.queue.discover({ afterId: 2_147_483_647, limit: 1 })).toEqual([]);
    await expect(t.queue.discover({ afterId: 0, limit: 1, userId: 8 } as never)).rejects.toThrow("QUEUE_INVALID");
    expect(t.database).toHaveBeenCalledTimes(2);
  });
  it.each([
    null, {}, "private rows", [null], [{ ...hint, id: 0 }], [{ ...hint, workspaceId: "7" }], [{ ...hint, userId: null }],
    [{ ...hint, id: 2_147_483_648 }], [{ ...hint, operationId: hint.operationId.toUpperCase() }], [{ ...hint, operationId: "bad" }],
    [{ ...hint, snapshot: "PRIVATE_BODY" }], [hint, hint], [{ ...hint, id: 4 }, hint], [hint, { ...hint, id: 4 }],
  ].map(rows => ({ rows })))("rejects invalid, duplicate or nonmonotonic hint page %#", async ({ rows }) => {
    const t = setup(rows); await expect(t.queue.discover({ afterId: 0, limit: 10 })).rejects.toThrow("PROFIT_ANALYSIS_QUEUE_INVALID");
  });
  it("does not conflate the same operation UUID owned by different actors or workspaces", async () => {
    const rows = [hint, { ...hint, id: 4, userId: 12 }, { ...hint, id: 5, workspaceId: 8 }];
    const t = setup(rows); expect(await t.queue.discover({ afterId: 0, limit: 10 })).toEqual(rows);
  });
  it("rejects stale cursor rows and an over-limit page rather than slicing it", async () => {
    const t = setup(); await expect(t.queue.discover({ afterId: 3, limit: 1 })).rejects.toThrow("QUEUE_INVALID");
    const many = setup([hint, { ...hint, id: 4, userId: 12 }]); await expect(many.queue.discover({ afterId: 0, limit: 1 })).rejects.toThrow("QUEUE_INVALID");
  });
  it.each([null, {}, [null], "PRIVATE SQL RESPONSE"])("rejects malformed driver wrapper %#", async raw => {
    const t = setup(); t.execute.mockResolvedValue(raw); await expect(t.queue.discover({ afterId: 0, limit: 10 })).rejects.toThrow("QUEUE_INVALID");
  });
  it.each(["database", "transaction", "schema", "execute"])("does not expose private SQL/connection errors from %s", async stage => {
    const t = setup(), privateError = new Error("mysql://PRIVATE_PASSWORD@host SELECT snapshot PRIVATE_BODY");
    if (stage === "database") t.database.mockRejectedValue(privateError);
    if (stage === "transaction") t.transaction.mockRejectedValue(privateError);
    if (stage === "schema") t.schemaReady.mockRejectedValue(privateError);
    if (stage === "execute") t.execute.mockRejectedValue(privateError);
    const error = await t.queue.discover({ afterId: 0, limit: 10 }).catch(value => value);
    expect(error).toMatchObject({ name: "ProfitAnalysisQueueError", code: "UNAVAILABLE", message: "PROFIT_ANALYSIS_QUEUE_UNAVAILABLE" });
    expect(error.cause).toBeUndefined(); expect(String(error)).not.toMatch(/PRIVATE|mysql|SELECT/u);
  });
  it("default schema errors remain sanitized and are never downgraded to valid empty work", async () => {
    const database: () => Promise<ProfitAnalysisJobDatabase> = async () => ({ transaction: async body => body({ execute: async () => { throw new Error("PRIVATE"); } }) });
    const queue = createProfitAnalysisQueue({ database, enabled: () => true, schemaReady: async () => { throw new Error("SELECT PRIVATE_SCHEMA"); } });
    await expect(queue.discover({ afterId: 0, limit: 1 })).rejects.toThrow("PROFIT_ANALYSIS_QUEUE_UNAVAILABLE");
  });
});
