import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiJobs, type AiJob } from "../drizzle/schema";

const mocks = vi.hoisted(() => ({ requireDb: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({
  requireDb: mocks.requireDb,
  withDbTransaction: vi.fn(() => { throw new Error("Unexpected transaction in queue scan"); }),
}));

import { listRecoverableAiJobs } from "./repositories/ai_os/aiJobRepository";

const NOW = new Date("2026-10-10T02:00:00.000Z");
const PAST = new Date("2026-10-10T01:00:00.000Z");
const FUTURE = new Date("2026-10-10T03:00:00.000Z");
const recoverableSql = "((`ai_jobs`.`status` = ? and (`ai_jobs`.`nextRunAt` is null or `ai_jobs`.`nextRunAt` < ?)) or (`ai_jobs`.`status` = ? and (`ai_jobs`.`leaseUntil` is null or `ai_jobs`.`leaseUntil` < ?)))";
type JobFixture = Pick<AiJob, "id" | "status" | "priority" | "nextRunAt" | "leaseUntil" | "createdAt"> & Partial<AiJob>;
type RecordedQuery = { sql: string; params: unknown[]; method: string };

function job(id: number, overrides: Partial<JobFixture> = {}): JobFixture {
  return {
    id, runId: `queue-test-${id}`, kind: "analysis.import.reviews", module: "listing",
    status: "queued", progress: 0, priority: 10, nextRunAt: null, leaseUntil: null,
    createdAt: new Date(PAST.getTime() + id * 1000), updatedAt: PAST,
    attempt: 0, maxAttempts: 1, timeoutSeconds: 7200, userId: 7, queueName: "analysis",
    retentionClass: "hot", input: { fileBase64: "test-payload", filename: "reviews.csv" },
    output: { preserved: id }, ...overrides,
  };
}

/**
 * Run the production repository through Drizzle's real MySQL query builder.
 * Its proxy transport is entirely in memory: SQL is checked before applying the
 * known queue predicate to fixtures, and full rows deliberately arrive unordered.
 */
function queueDatabase(initialRows: JobFixture[], options: {
  afterCandidates?: (rows: JobFixture[]) => void;
  failAtQuery?: number;
  databaseError?: Error;
} = {}) {
  const rows = [...initialRows];
  const calls: RecordedQuery[] = [];
  const columns = Object.values(getTableColumns(aiJobs));
  const encodedNow = aiJobs.nextRunAt.mapToDriverValue(NOW);
  const recoverableParams = ["queued", encodedNow, "running", encodedNow];
  const isRecoverable = (row: JobFixture) => (
    row.status === "queued" && (row.nextRunAt === null || row.nextRunAt.getTime() < NOW.getTime())
  ) || (
    row.status === "running" && (row.leaseUntil === null || row.leaseUntil.getTime() < NOW.getTime())
  );
  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql, params, method });
    if (options.failAtQuery === calls.length) throw options.databaseError;
    expect(method).toBe("all");
    expect(sql).toContain(" from `ai_jobs` where ");
    // Missing/reduced predicates fail here, rather than letting the mock silently
    // filter rows on behalf of a regressed production query.
    expect(sql).toContain(recoverableSql);

    if (calls.length === 1) {
      expect(sql).toMatch(/^select `id` from `ai_jobs` where /);
      expect(sql).toContain(" order by `ai_jobs`.`priority` desc, `ai_jobs`.`nextRunAt` asc, `ai_jobs`.`createdAt` asc limit ?");
      expect(params.slice(0, 4)).toEqual(recoverableParams);
      const limit = params.at(-1) as number;
      const candidates = rows.filter(isRecoverable).sort((a, b) =>
        b.priority - a.priority ||
        (a.nextRunAt?.getTime() ?? Number.NEGATIVE_INFINITY) - (b.nextRunAt?.getTime() ?? Number.NEGATIVE_INFINITY) ||
        a.createdAt.getTime() - b.createdAt.getTime()
      ).slice(0, limit).map(row => [row.id]);
      options.afterCandidates?.(rows);
      return { rows: candidates };
    }

    expect(calls.length).toBe(2);
    expect(sql).not.toMatch(/\border by\b|\blimit\b/i);
    expect(sql).toMatch(/where \(`ai_jobs`\.`id` in \(\?(?:, \?)*\) and /);
    expect(params.slice(-4)).toEqual(recoverableParams);
    const ids = new Set(params.slice(0, -4));
    const hydrated = rows.filter(row => ids.has(row.id) && isRecoverable(row)).reverse();
    return {
      rows: hydrated.map(row => columns.map(column => {
        const value = row[column.name as keyof JobFixture];
        if (value == null) return null;
        // mysql2 supplies JSON values already decoded; timestamps are driver strings.
        return value instanceof Date ? column.mapToDriverValue(value as never) : value;
      })),
    };
  });
  mocks.requireDb.mockResolvedValue(db);
  return { calls, rows };
}

beforeEach(() => {
  mocks.requireDb.mockReset();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
});
afterEach(() => vi.useRealTimers());

describe("AI job queue scans keep payloads outside MySQL sorting", () => {
  it("sorts only IDs, fetches payloads without ORDER BY, and restores candidate priority order in JS", async () => {
    const largePayload = "x".repeat(1024 * 1024);
    const { calls } = queueDatabase([
      job(1, { priority: 0 }),
      job(2, { priority: 50, nextRunAt: PAST }),
      job(3, { priority: 50, input: { fileBase64: largePayload } }),
      job(4, { priority: 50, nextRunAt: PAST, createdAt: new Date(PAST.getTime() - 1000) }),
    ]);
    const result = await listRecoverableAiJobs({ limit: 25 });
    expect(result.map(row => row.id)).toEqual([3, 4, 2, 1]);
    expect(result[0].input).toEqual({ fileBase64: largePayload });
    expect(result[1].output).toEqual({ preserved: 4 });
    expect(calls).toHaveLength(2);
    expect(calls[0].sql.split(" from ")[0]).toBe("select `id`");
    expect(calls[0].sql).not.toContain("`input`");
    expect(calls[0].sql).not.toContain("`output`");
    expect(calls[1].sql.split(" from ")[0]).toContain("`input`");
    expect(calls[1].sql.split(" from ")[0]).toContain("`output`");
    expect(calls[1].params.slice(0, -4)).toEqual([3, 4, 2, 1]);
  });

  it("avoids the payload query for an empty candidate set", async () => {
    const { calls } = queueDatabase([]);
    await expect(listRecoverableAiJobs({ limit: 25 })).resolves.toEqual([]);
    expect(calls).toHaveLength(1);
  });

  it("selects queued due jobs and expired leases but excludes future schedules, active leases, and terminal rows", async () => {
    queueDatabase([
      job(1), job(2, { nextRunAt: PAST }),
      job(3, { status: "running", leaseUntil: PAST }), job(4, { status: "running", leaseUntil: null }),
      job(5, { nextRunAt: FUTURE }), job(6, { status: "running", leaseUntil: FUTURE }),
      job(7, { status: "succeeded" }), job(8, { status: "failed" }), job(9, { status: "canceled" }),
      job(10, { nextRunAt: NOW }), job(11, { status: "running", leaseUntil: NOW }),
    ]);
    const result = await listRecoverableAiJobs({ limit: 25 });
    expect(new Set(result.map(row => row.id))).toEqual(new Set([1, 2, 3, 4]));
  });

  it("skips rows deleted, completed, canceled, rescheduled, newly claimed, or lease-renewed between queries", async () => {
    const initial = [...Array.from({ length: 8 }, (_, index) => job(index + 1)), job(9, { status: "running", leaseUntil: PAST })];
    const { calls } = queueDatabase(initial, {
      afterCandidates(rows) {
        rows.splice(rows.findIndex(row => row.id === 2), 1);
        rows.find(row => row.id === 3)!.status = "succeeded";
        Object.assign(rows.find(row => row.id === 4)!, { status: "running", leaseUntil: FUTURE, lockedBy: "other-worker" });
        rows.find(row => row.id === 5)!.nextRunAt = FUTURE;
        rows.find(row => row.id === 6)!.status = "failed";
        rows.find(row => row.id === 7)!.status = "canceled";
        rows.find(row => row.id === 9)!.leaseUntil = FUTURE;
        // A newly queued row was not in the original candidate set.
        rows.push(job(99, { priority: 1000 }));
      },
    });
    const result = await listRecoverableAiJobs({ limit: 25 });
    expect(result.map(row => row.id)).toEqual([1, 8]);
    expect(calls[1].params.slice(0, -4)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("returns no stale candidate placeholders if every selected row disappears", async () => {
    const { calls } = queueDatabase([job(1), job(2)], { afterCandidates: rows => { rows.length = 0; } });
    await expect(listRecoverableAiJobs()).resolves.toEqual([]);
    expect(calls).toHaveLength(2);
  });

  it.each([
    { requested: undefined, bounded: 50 }, { requested: 0, bounded: 50 },
    { requested: -1, bounded: 1 }, { requested: 1, bounded: 1 },
    { requested: 25, bounded: 25 }, { requested: 200, bounded: 200 },
    { requested: 201, bounded: 200 },
  ])("preserves the existing scan limit $requested → $bounded in both candidate selection and hydration", async ({ requested, bounded }) => {
    const { calls } = queueDatabase(Array.from({ length: 205 }, (_, index) => job(index + 1)));
    const result = await listRecoverableAiJobs({ limit: requested });
    expect(calls[0].params.at(-1)).toBe(bounded);
    expect(result).toHaveLength(bounded);
    expect(calls[1].params.slice(0, -4)).toHaveLength(bounded);
    expect(result.map(row => row.id)).toEqual(Array.from({ length: bounded }, (_, index) => index + 1));
  });

  it.each([1, 2])("propagates database failures from query %s rather than disguising them as an empty queue", async failAtQuery => {
    const databaseError = Object.assign(new Error("simulated MySQL failure"), { code: "ER_OUT_OF_SORTMEMORY" });
    const { calls } = queueDatabase([job(1)], { failAtQuery, databaseError });
    await expect(listRecoverableAiJobs({ limit: 25 })).rejects.toMatchObject({ cause: databaseError });
    expect(calls).toHaveLength(failAtQuery);
  });

  it("propagates failure to obtain a database connection before issuing any query", async () => {
    const error = new Error("AI Job repository: database not available");
    mocks.requireDb.mockRejectedValue(error);
    await expect(listRecoverableAiJobs()).rejects.toBe(error);
  });
});
