import { createHash } from "node:crypto";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({
  jobs: new Map<string, any>(), registrations: [] as any[],
  execute: vi.fn(), start: vi.fn(), getProject: vi.fn(),
  selected: [] as any[], analyses: [] as any[], updates: [] as any[], statements: [] as any[], activeRunId: "", packet: 64 * 1024 * 1024,
}));
vi.mock("./repositories", () => ({ getProjectById: state.getProject, getCompetitorAnalysesByProject: vi.fn(async () => state.analyses) }));
vi.mock("./services/aiJobRunner", () => ({
  getAiJobRun: vi.fn(async (runId: string) => state.jobs.get(runId) || null),
  registerAiJobHandler: (registration: any) => state.registrations.push(registration),
  createAiJobRun: state.start,
  scheduleAiJobRun: vi.fn(async () => null),
  updateAiJobProgress: vi.fn(async () => null),
}));
vi.mock("./services/analysisImportExecution", () => ({
  retainSavedImportResults: (results: any[], analyses: any[]) => results.filter(row => row.status !== "failed" && analyses.some(analysis => analysis.id === row.analysisId)),
  executeReviewImport: state.execute, executeSellerSpriteImport: state.execute,
}));
vi.mock("./domains/listing/listingAgentBridge", () => ({
  ensureListingAgentRun: vi.fn(async () => "agent-1"),
  syncListingNodeJobQueued: vi.fn(), syncListingNodeJobRunning: vi.fn(),
  syncListingNodeJobWaitingHuman: vi.fn(), syncListingNodeJobFailed: vi.fn(),
}));
vi.mock("./repositories/dbClient", () => ({
  requireDb: vi.fn(async () => ({
    execute: vi.fn(async (statement: any) => { state.statements.push(statement); return [[{ maxPacket: state.packet }]]; }),
    update: () => ({ set: (value: any) => ({ where: async () => {
      state.updates.push(value);
      const job = state.jobs.get(state.activeRunId);
      if (job) job.output = structuredClone(value.output);
    } }) }),
    select: (fields: any) => ({ from: () => ({ where: () => ({
      orderBy: () => ({ limit: async () => state.selected }),
      limit: async () => fields.lockedBy ? [state.jobs.get(state.activeRunId)].filter(Boolean) : state.selected,
    }) }) }),
  })),
}));

import {
  decodeImportFile, importJobIdentity, compactImportJob, startAnalysisImportJob,
  getAnalysisImportJob, listAnalysisImportJobs, runAnalysisImportJob, MAX_IMPORT_FILE_BYTES,
} from "./services/analysisImportJob";

const scope = { userId: 7, workspaceId: 2 };
const input = { projectId: 9, kind: "reviews" as const, filename: "评论.csv", fileBase64: Buffer.from("ASIN,Content\nB000000001,good product").toString("base64") };
beforeEach(() => {
  vi.clearAllMocks();
  state.jobs.clear(); state.selected = []; state.updates = []; state.statements = []; state.activeRunId = ""; state.packet = 64 * 1024 * 1024;
  const sourceHash = createHash("sha256").update(Buffer.from(input.fileBase64, "base64")).digest("hex");
  state.analyses = [{ id: 1, asin: "B000000001", rawData: JSON.stringify({ reviewImport: { sourceHash } }) }];
  state.getProject.mockImplementation(async (id: number, userId: number, workspaceId: number) => (
    id === 9 && userId === 7 && workspaceId === 2 ? { id: 9, workspaceId: 2 } : null
  ));
  state.start.mockImplementation(async (args: any) => {
    if (state.jobs.has(args.runId)) throw Object.assign(new Error("Duplicate entry"), { code: "ER_DUP_ENTRY" });
    const job = { ...args, status: "queued", progress: 0, output: null, error: null, attempt: 0,
      createdAt: new Date(), updatedAt: new Date() };
    state.jobs.set(args.runId, job); return job;
  });
});

describe("persisted competitor import jobs", () => {
  it("queues without executing AI and omits the uploaded payload from responses", async () => {
    const job = await startAnalysisImportJob(input, scope);
    expect(job.status).toBe("queued");
    expect(job.filename).toBe(input.filename);
    expect(state.execute).not.toHaveBeenCalled();
    expect(JSON.stringify(job)).not.toContain(input.fileBase64);
    expect(state.start.mock.calls[0][0]).toMatchObject({ module: "listing", maxAttempts: 1, input: { agentRunId: "agent-1", agentNodeId: "N5" } });
  });
  it("deduplicates simultaneous and completed submissions across requests", async () => {
    const [first, second] = await Promise.all([startAnalysisImportJob(input, scope), startAnalysisImportJob(input, scope)]);
    expect(first.runId).toBe(second.runId);
    expect(state.jobs.size).toBe(1);
    state.jobs.get(first.runId).status = "succeeded";
    state.jobs.get(first.runId).output = { results: [{ asin: "B000000001", status: "matched", analysisId: 1 }] };
    const third = await startAnalysisImportJob(input, scope);
    expect(third.runId).toBe(first.runId);
    expect(third.status).toBe("succeeded");
  });
  it("rebuilds an old success if the user deleted the saved analysis", async () => {
    const first = await startAnalysisImportJob(input, scope);
    Object.assign(state.jobs.get(first.runId), { status: "succeeded", output: { results: [{ asin: "B000000001", status: "matched", analysisId: 1 }] } });
    state.analyses = [];
    const next = await startAnalysisImportJob(input, scope);
    expect(next.runId).not.toBe(first.runId);
    expect(state.jobs.get(next.runId).input.completedResults).toEqual([]);
  });
  it("keeps owner-visible legacy projects with no workspace importable", async () => {
    state.getProject.mockResolvedValue({ id: 9, workspaceId: null });
    const first = await startAnalysisImportJob(input, scope);
    const next = await startAnalysisImportJob(input, scope);
    expect(next.runId).toBe(first.runId);
    expect(state.jobs.get(first.runId).workspaceId).toBeNull();
  });
  it("scopes identity by user/project and normalizes selected ASIN order", () => {
    const first = importJobIdentity({ ...input, selectedAsins: ["B000000001", "B000000002"] }, scope);
    expect(importJobIdentity({ ...input, selectedAsins: ["B000000002", "B000000001", "B000000001"] }, scope)).toBe(first);
    expect(importJobIdentity(input, { ...scope, userId: 8 })).not.toBe(importJobIdentity(input, scope));
    expect(importJobIdentity({ ...input, projectId: 10 }, scope)).not.toBe(importJobIdentity(input, scope));
  });
  it("persists partial progress and retries only failed items on explicit resubmission", async () => {
    const queued = await startAnalysisImportJob(input, scope);
    const job = state.jobs.get(queued.runId);
    Object.assign(job, { status: "running", lockedBy: "worker", attempt: 1 });
    state.activeRunId = job.runId;
    const rows = [{ asin: "B000000001", status: "matched", analysisId: 1 }, { asin: "B000000002", status: "failed", error: "provider failed" }];
    state.execute.mockImplementation(async (_input, _user, options) => {
      await options.onProgress(rows, 2); return { results: rows };
    });
    const signal = new AbortController().signal;
    await expect(runAnalysisImportJob(job, { signal })).rejects.toThrow("1 个成功，1 个失败");
    expect(job.output).toMatchObject({ succeeded: 1, failed: 1, results: rows });
    expect(state.execute.mock.calls[0][2].signal).toBe(signal);
    job.status = "failed";
    const retried = await startAnalysisImportJob(input, scope);
    expect(retried.runId).not.toBe(job.runId);
    expect(state.jobs.get(retried.runId).input.completedResults).toEqual([rows[0]]);
    expect(state.jobs.get(retried.runId).maxAttempts).toBe(1);
  });
  it("rejects cross-user and cross-workspace reads/start before accessing jobs", async () => {
    await expect(startAnalysisImportJob(input, { ...scope, userId: 8 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(getAnalysisImportJob({ projectId: 9, runId: "other" }, { ...scope, workspaceId: 3 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listAnalysisImportJobs({ projectId: 9 }, { ...scope, userId: 8 })).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(state.start).not.toHaveBeenCalled();
  });
  it("validates decoded size/encoding and MySQL capacity without a schema migration", async () => {
    expect(() => decodeImportFile("!!!!")).toThrow("文件编码无效");
    expect(() => decodeImportFile(Buffer.alloc(MAX_IMPORT_FILE_BYTES + 1).toString("base64"))).toThrow("20 MB");
    state.packet = 1024;
    await expect(startAnalysisImportJob(input, scope)).rejects.toThrow("数据库上传容量");
    expect(state.start).not.toHaveBeenCalled();
  });
  it("does not begin model execution when a worker is canceled", async () => {
    const queued = await startAnalysisImportJob(input, scope);
    const controller = new AbortController(); controller.abort(new Error("canceled"));
    await expect(runAnalysisImportJob(state.jobs.get(queued.runId), { signal: controller.signal })).rejects.toThrow("canceled");
    expect(state.execute).not.toHaveBeenCalled();
  });
  it("gives the Agent node the same runtime budget and does not time out queue waits", async () => {
    const queued = await startAnalysisImportJob(input, scope);
    const dialect = new MySqlDialect();
    expect(state.statements.map(statement => dialect.sqlToQuery(statement).sql).some(query => query.includes("timeoutAt=NULL"))).toBe(true);
    const job = state.jobs.get(queued.runId);
    const claimedAt = new Date("2026-10-09T10:00:00Z");
    Object.assign(job, { status: "running", lockedBy: "worker", attempt: 1, claimedAt });
    state.activeRunId = job.runId;
    state.execute.mockResolvedValue({ results: [{ asin: "B000000001", status: "matched", analysisId: 1 }] });
    await runAnalysisImportJob(job, { signal: new AbortController().signal });
    const deadlineQueries = state.statements.map(statement => dialect.sqlToQuery(statement)).filter(query => query.sql.includes("timeoutAt=?"));
    expect(deadlineQueries.length).toBeGreaterThan(0);
    expect(deadlineQueries.every(query => query.params[0] instanceof Date && query.params[0].getTime() === claimedAt.getTime() + 7_260_000)).toBe(true);
  });
  it("stops if another process revokes the running job while a model is executing", async () => {
    const queued = await startAnalysisImportJob(input, scope);
    const job = state.jobs.get(queued.runId);
    Object.assign(job, { status: "running", lockedBy: "worker", attempt: 1 });
    state.activeRunId = job.runId;
    state.execute.mockImplementation(async (_input, _user, options) => {
      job.status = "failed";
      await options.assertActive();
      throw new Error("unreachable");
    });
    await expect(runAnalysisImportJob(job, { signal: new AbortController().signal })).rejects.toThrow("执行权已变更");
    expect(state.updates).toEqual([]);
  });
  it("does not swallow a genuine database failure as a duplicate submission", async () => {
    state.start.mockRejectedValue(Object.assign(new Error("Database unavailable"), { code: "ECONNREFUSED" }));
    await expect(startAnalysisImportJob(input, scope)).rejects.toThrow("Database unavailable");
  });
  it("compacts old and failed job snapshots without returning internal input", () => {
    const job = compactImportJob({ runId: "x", kind: "analysis.import.sellersprite", input: { filename: "products.xlsx", fileBase64: "sensitive" }, output: null, status: "failed", progress: 100, error: "failed" } as any);
    expect(job).toMatchObject({ kind: "sellersprite", filename: "products.xlsx", status: "failed", result: null });
    expect(job).not.toHaveProperty("input");
    expect(JSON.stringify(job)).not.toContain("sensitive");
  });
});
