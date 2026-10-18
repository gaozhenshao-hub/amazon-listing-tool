import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { aiJobs, type AiJob, type InsertAiJob } from "../drizzle/schema";
import { PRIVATE_IMAGE_TAGGING_JOB_KIND as kind } from "./repositories/ai_os/dedicatedJobPolicy";

const io = vi.hoisted(() => ({ requireDb: vi.fn(), transaction: vi.fn(), metric: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ requireDb: io.requireDb, getDb: io.requireDb, withDbTransaction: io.transaction }));
vi.mock("./domains/ai_os/services/observability", () => ({ recordAiOsMetric: io.metric }));
import * as repo from "./repositories/ai_os/aiJobRepository";
import * as runner from "./domains/ai_os/services/jobRunner";
import { assertBusinessJobAgentBinding } from "./domains/ai_os/services/businessJobBindingPolicy";

const calls: Array<{ sql: string; params: unknown[] }> = [];
let legacy = false;
const row = { id: 1, runId: "same-known-run-id", workspaceId: 42, userId: 7, kind,
  module: "knowledge", status: "running", input: { private: "original-source" }, output: { private: "candidate" },
  progress: 10, attempt: 1, maxAttempts: 1, timeoutSeconds: 60, createdAt: new Date(0), updatedAt: new Date(0) };
beforeEach(() => {
  vi.clearAllMocks(); calls.length = 0; legacy = false;
  const columns = Object.values(getTableColumns(aiJobs));
  const db = drizzle(async (sql, params) => {
    calls.push({ sql, params });
    // Interpret the real emitted SQL guard, never return a private payload and
    // rely on the test mock to hide it after an unguarded SELECT/UPDATE.
    expect(sql).toMatch(/kind[` ]*(?:<>|!=)|kind`? in/i);
    if (/kind`? in/i.test(sql)) expect(params).not.toContain(kind);
    else expect(params).toContain(kind);
    if (/^\s*select/i.test(sql)) return { rows: legacy && sql.includes("from `ai_jobs`") ? [columns.map(column => {
      const value = ({ ...row, kind: "legacy.analysis" } as Record<string, unknown>)[column.name];
      return value instanceof Date ? column.mapToDriverValue(value as never) : value ?? null;
    })] : [] };
    return { rows: [{ affectedRows: 0, insertId: 0 }] };
  });
  io.requireDb.mockResolvedValue(db);
  io.transaction.mockImplementation(async (_label: string, body: (tx: typeof db) => Promise<unknown>) => body(db));
  io.metric.mockResolvedValue(undefined);
});

describe("private image tagging jobs cannot enter generic infrastructure", () => {
  it.each([
    ["read", () => repo.getAiJobByRunId(row.runId)],
    ["claim", () => repo.claimAiJobByRunId(row.runId, { workerId: "generic" })],
    ["update", () => repo.updateAiJobByRunId(row.runId, { status: "succeeded", output: { forged: true } })],
    ["retry", () => repo.retryAiJobByRunId(row.runId, { errorMessage: "retry", nextRunAt: new Date() })],
    ["heartbeat", () => repo.heartbeatAiJobLease(row.runId, "generic")],
    ["release", () => repo.releaseAiJobLease(row.runId, "generic")],
    ["unowned release", () => repo.releaseAiJobLease(row.runId)],
    ["list", () => repo.listAiJobsForUser(7)],
    ["dead letters", () => repo.listAiJobDeadLetters()],
  ] as const)("%s excludes the known ID in SQL, independent of owner/admin claims", async (_name, run) => {
    const result = await run(); expect(result === null || Array.isArray(result) && result.length === 0).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
  });

  it.each([
    ["status", () => runner.getAiJobRun(row.runId)],
    ["progress", () => runner.updateAiJobProgress(row.runId, 99)],
    ["complete", () => runner.completeAiJob(row.runId, { forged: true })],
    ["fail", () => runner.failAiJob(row.runId, "failed")],
    ["retry", () => runner.retryAiJob(row.runId, "retry")],
    ["cancel", () => runner.cancelAiJob(row.runId)],
  ] as const)("generic %s cannot publish, retry, or cancel a private operation", async (_name, run) => {
    await expect(run()).resolves.toBeNull(); expect(io.metric).not.toHaveBeenCalled();
  });

  it("does not generate a new operation ID on generic recovery or invoke a supplied handler", async () => {
    await expect(runner.recoverAiJob(row.runId)).rejects.toThrow("AI job not found");
    const handler = vi.fn();
    await expect(runner.runAiJobInProcess(row.runId, handler)).rejects.toThrow("AI job not found");
    expect(handler).not.toHaveBeenCalled(); expect(calls.every(call => /^\s*select/i.test(call.sql))).toBe(true);
  });

  it("rejects generic creation, dead-letter capture, binding and snapshot serialization before I/O", async () => {
    await expect(repo.createAiJob(row as InsertAiJob)).rejects.toThrow("USE_DEDICATED_ENDPOINT");
    await expect(repo.createAiJobDeadLetter({ job: row as AiJob, reason: "failed" })).rejects.toThrow("USE_DEDICATED_ENDPOINT");
    await expect(runner.createAiJobRun({ kind, module: "knowledge", userId: 7, input: {} })).rejects.toThrow("USE_DEDICATED_ENDPOINT");
    expect(() => assertBusinessJobAgentBinding({ kind, module: "knowledge", input: { agentRunId: "spoof", agentNodeId: "N1" } })).toThrow("USE_DEDICATED_ENDPOINT");
    expect(() => runner.buildAiJobSnapshot(row as AiJob)).toThrow("USE_DEDICATED_ENDPOINT");
    expect(calls).toEqual([]);
  });

  it("does not resolve the private kind even if a broad generic handler claims to match", () => {
    runner.registerAiJobHandler({ id: "test-private-broad-match", match: () => true, handler: vi.fn() });
    expect(runner.resolveAiJobHandler({ kind } as runner.AiJobSnapshot)).toBeNull();
  });

  it("keeps ordinary legacy jobs available", async () => {
    legacy = true;
    expect(await runner.getAiJobRun(row.runId)).toMatchObject({ runId: row.runId, kind: "legacy.analysis" });
    expect(await runner.listAiJobRunsForUser(7)).toHaveLength(1);
  });
});
