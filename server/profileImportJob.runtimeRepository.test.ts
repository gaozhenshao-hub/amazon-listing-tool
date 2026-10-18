import { getTableColumns } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql-proxy";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aiJobs, type AiJob } from "../drizzle/schema";
import { PROFILE_IMPORT_JOB_KIND } from "../shared/profileImportJob";
import { COMPETITOR_RESEARCH_JOB_KIND } from "../shared/competitorResearchJob";
import { COMPETITOR_DEEP_EXECUTION_JOB_KIND } from "../shared/competitorDeepExecutionJob";
import { isCheckpointedListingJob } from "../shared/checkpointedListingJob";
import { PRIVATE_IMAGE_TAGGING_JOB_KIND } from "./repositories/ai_os/dedicatedJobPolicy";

const mocks = vi.hoisted(() => ({ requireDb: vi.fn() }));
vi.mock("./repositories/dbClient", () => ({ requireDb: mocks.requireDb, withDbTransaction: vi.fn() }));
import { claimAiJobByRunId, updateOwnedProfileImportJob } from "./repositories/ai_os/aiJobRepository";

const NOW = new Date("2026-10-16T00:00:00.000Z");
const guard = { expectedWorkerId: "worker-A", expectedAttempt: 2 };
const predicate = "where (`ai_jobs`.`runId` = ? and `ai_jobs`.`kind` in (?, ?, ?) and `ai_jobs`.`status` = ? and `ai_jobs`.`lockedBy` = ? and `ai_jobs`.`attempt` = ? and `ai_jobs`.`leaseUntil` > NOW())";
let currentKind: string = PROFILE_IMPORT_JOB_KIND;
type Change = Parameters<typeof updateOwnedProfileImportJob>[1];
function fixture(patch: Partial<AiJob> = {}): AiJob {
  return { id: 1, runId: "profile-anchor", kind: currentKind, module: "listing", status: "running",
    attempt: 2, progress: 20, lockedBy: "worker-A", leaseUntil: new Date(NOW.getTime() + 60_000),
    input: { checkpoint: "analysis_ready", privateModel: "private-model-result" }, output: { fileId: 19 },
    userId: 7, createdAt: NOW, updatedAt: NOW, ...patch } as AiJob;
}

/** Real Drizzle SQL builder, in-memory transport. Match predicates are asserted
 * before the fixture engine applies them; this is not a real MySQL lease test. */
function database(row = fixture(), beforeUpdate?: (row: AiJob) => void, forcedAffected?: number) {
  const calls: { sql: string; params: unknown[]; method: string }[] = [];
  const columns = Object.values(getTableColumns(aiJobs));
  const db = drizzle(async (sql, params, method) => {
    calls.push({ sql, params, method });
    if (method === "execute") {
      expect(sql).toContain(predicate);
      expect(params.slice(-7)).toEqual(["profile-anchor", PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND, COMPETITOR_DEEP_EXECUTION_JOB_KIND, "running", "worker-A", 2]);
      const setSql = sql.split(" where ")[0];
      expect(setSql).not.toMatch(/`input`|`output`|`attempt`|`runId`/);
      beforeUpdate?.(row);
      const eligible = row.runId === "profile-anchor" && isCheckpointedListingJob(row.kind)
        && row.status === "running" && row.lockedBy === "worker-A" && row.attempt === 2
        && row.leaseUntil instanceof Date && row.leaseUntil > NOW;
      if (eligible) {
        if (setSql.includes("`status` = ?")) Object.assign(row, { status: "failed", progress: 100, lockedBy: null, leaseUntil: null });
        else if (setSql.includes("DATE_ADD")) row.leaseUntil = new Date(NOW.getTime() + Number(params[0]) * 1000);
        else if (setSql.includes("`progress` = ?")) row.progress = params[0] as number;
        else Object.assign(row, { lockedBy: null, leaseUntil: null });
      }
      return { rows: [{ affectedRows: forcedAffected ?? Number(eligible) }] };
    }
    expect(method).toBe("all");
    expect(sql).toContain("from `ai_jobs` where (`ai_jobs`.`runId` = ? and `ai_jobs`.`kind` <> ?) limit ?");
    expect(params).toEqual(["profile-anchor", PRIVATE_IMAGE_TAGGING_JOB_KIND, 1]);
    return { rows: row.kind === PRIVATE_IMAGE_TAGGING_JOB_KIND ? [] : [columns.map(column => {
      const value = row[column.name as keyof AiJob];
      return value instanceof Date ? column.mapToDriverValue(value as never) : value ?? null;
    })] };
  });
  mocks.requireDb.mockResolvedValue(db);
  return { row, calls };
}

beforeEach(() => { mocks.requireDb.mockReset(); vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(NOW); });
afterEach(() => vi.useRealTimers());

describe.each([PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND, COMPETITOR_DEEP_EXECUTION_JOB_KIND])("%s atomic runner mutations", kind => {
  beforeEach(() => { currentKind = kind; });
  it.each([0, 12.8, 130])("progress %s has the full SQL fence and never changes the checkpoint", async progress => {
    const { row, calls } = database();
    const input = structuredClone(row.input), output = structuredClone(row.output);
    const updated = await updateOwnedProfileImportJob(row.runId, { type: "progress", progress }, guard);
    expect(updated?.progress).toBe(Math.min(99, Math.floor(progress)));
    expect(row.input).toEqual(input); expect(row.output).toEqual(output);
    expect(calls).toHaveLength(2);
  });

  it("failure retains the same private anchor and only records safe fixed failure metadata", async () => {
    const { row, calls } = database();
    const input = structuredClone(row.input), output = structuredClone(row.output);
    await updateOwnedProfileImportJob(row.runId, { type: "fail", errorMessage: "PROFILE_IMPORT_FAILED_REVIEW_REQUIRED" }, guard);
    expect(row.status).toBe("failed"); expect(row.input).toEqual(input); expect(row.output).toEqual(output);
    expect(calls[0].params).toContain("PROFILE_IMPORT_FAILED_REVIEW_REQUIRED");
    expect(row.lockedBy).toBeNull(); expect(row.leaseUntil).toBeNull();
  });

  it.each([
    {}, { expectedWorkerId: "worker-A" }, { expectedAttempt: 2 }, { ...guard, expectedWorkerId: " " },
    { ...guard, expectedWorkerId: "a".repeat(129) }, { ...guard, expectedAttempt: 0 },
    { ...guard, expectedAttempt: 1.2 }, { ...guard, expectedAttempt: Number.MAX_SAFE_INTEGER + 1 },
  ])("missing or invalid ownership %# performs no DB IO", async invalid => {
    await expect(updateOwnedProfileImportJob("profile-anchor", { type: "progress", progress: 1 }, invalid)).resolves.toBeNull();
    expect(mocks.requireDb).not.toHaveBeenCalled();
  });

  it.each([NaN, Infinity, -Infinity])("invalid progress %s is rejected before DB IO", async progress => {
    await expect(updateOwnedProfileImportJob("profile-anchor", { type: "progress", progress }, guard)).resolves.toBeNull();
    expect(mocks.requireDb).not.toHaveBeenCalled();
  });

  const stale: Partial<AiJob>[] = [{ status: "queued" }, { status: "succeeded" }, { status: "canceled" },
    { status: "failed" }, { kind: "legacy" }, { kind: PRIVATE_IMAGE_TAGGING_JOB_KIND }, { attempt: 3 }, { lockedBy: "worker-B" },
    { leaseUntil: null }, { leaseUntil: NOW }, { leaseUntil: new Date(NOW.getTime() - 1) }];
  it.each(stale)("read/write race %# cannot overwrite a new owner or terminal row", async changed => {
    for (const change of [{ type: "progress", progress: 80 }, { type: "fail", errorMessage: "safe" },
      { type: "heartbeat", leaseSeconds: 60 }, { type: "release" }] as Change[]) {
      const { row, calls } = database(fixture(), row => Object.assign(row, changed));
      await expect(updateOwnedProfileImportJob(row.runId, change, guard)).resolves.toBeNull();
      expect(row).toMatchObject(changed); expect(calls).toHaveLength(1);
      expect(row.input).toEqual(fixture().input); expect(row.output).toEqual(fixture().output);
    }
  });

  it("heartbeat is fenced and clamps the requested lease; release shares the exact attempt fence", async () => {
    const { row, calls } = database();
    await updateOwnedProfileImportJob(row.runId, { type: "heartbeat", leaseSeconds: 99_999 }, guard);
    expect(calls[0].params[0]).toBe(7200);
    await updateOwnedProfileImportJob(row.runId, { type: "release" }, guard);
    expect(row.lockedBy).toBeNull(); expect(calls).toHaveLength(4);
  });

  it("does not report success or hydrate when the affected row count is not exactly one", async () => {
    const { calls } = database(fixture(), undefined, 2);
    await expect(updateOwnedProfileImportJob("profile-anchor", { type: "progress", progress: 30 }, guard)).resolves.toBeNull();
    expect(calls).toHaveLength(1);
  });

  it("propagates database failure without a fallback mutation", async () => {
    mocks.requireDb.mockRejectedValue(new Error("database unavailable"));
    await expect(updateOwnedProfileImportJob("profile-anchor", { type: "progress", progress: 30 }, guard)).rejects.toThrow("database unavailable");
    expect(mocks.requireDb).toHaveBeenCalledTimes(1);
  });
});

describe.each([PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND, COMPETITOR_DEEP_EXECUTION_JOB_KIND])("%s claims require an actual unique lease transition", kind => {
  beforeEach(() => { currentKind = kind; });
  function claimDatabase(row: AiJob, affectedOverride?: number) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const columns = Object.values(getTableColumns(aiJobs));
    const db = drizzle(async (sql, params, method) => {
      calls.push({ sql, params });
      if (method === "execute") {
        const normalized = sql.replace(/\s+/g, " ");
        expect(normalized).toContain("WHERE runId = ? AND kind <> ? AND status IN ('queued', 'running')");
        expect(normalized).toContain("AND (nextRunAt IS NULL OR nextRunAt <= NOW())");
        expect(normalized).toContain("AND (lockedBy IS NULL OR lockedBy = ? OR leaseUntil IS NULL OR leaseUntil < NOW())");
        expect(normalized).toContain("AND (kind NOT IN (?, ?, ?) OR (status = 'queued' AND lockedBy IS NULL AND leaseUntil IS NULL) OR (status = 'running' AND leaseUntil < NOW()))");
        expect(params).toEqual([10, "worker-A", 900, "profile-anchor", PRIVATE_IMAGE_TAGGING_JOB_KIND, "worker-A", PROFILE_IMPORT_JOB_KIND, COMPETITOR_RESEARCH_JOB_KIND, COMPETITOR_DEEP_EXECUTION_JOB_KIND]);
        const priorEligible = row.kind !== PRIVATE_IMAGE_TAGGING_JOB_KIND && ["queued", "running"].includes(row.status)
          && (!row.nextRunAt || row.nextRunAt <= NOW)
          && (!row.lockedBy || row.lockedBy === "worker-A" || !row.leaseUntil || row.leaseUntil < NOW);
        const profileEligible = !isCheckpointedListingJob(row.kind)
          || (row.status === "queued" && row.lockedBy === null && row.leaseUntil === null)
          || (row.status === "running" && row.leaseUntil !== null && row.leaseUntil < NOW);
        const affectedRows = affectedOverride ?? Number(priorEligible && profileEligible);
        if (affectedRows === 1) Object.assign(row, { status: "running", lockedBy: "worker-A", attempt: row.attempt + 1,
          leaseUntil: new Date(NOW.getTime() + 900_000) });
        return { rows: [{ affectedRows }] };
      }
      expect(params).toEqual(["profile-anchor", PRIVATE_IMAGE_TAGGING_JOB_KIND, 1]);
      return { rows: row.kind === PRIVATE_IMAGE_TAGGING_JOB_KIND ? [] : [columns.map(column => {
        const value = row[column.name as keyof AiJob];
        return value instanceof Date ? column.mapToDriverValue(value as never) : value ?? null;
      })] };
    });
    mocks.requireDb.mockResolvedValue(db);
    return { row, calls };
  }

  it("claims queued/unowned once and rejects a same-worker second active claim", async () => {
    const { row } = claimDatabase(fixture({ status: "queued", lockedBy: null, leaseUntil: null, attempt: 0 }));
    await expect(claimAiJobByRunId(row.runId, { workerId: "worker-A" })).resolves.toMatchObject({ attempt: 1, status: "running" });
    await expect(claimAiJobByRunId(row.runId, { workerId: "worker-A" })).resolves.toBeNull();
    expect(row.attempt).toBe(1); expect(row.input).toEqual(fixture().input);
  });

  it.each([
    { status: "running", leaseUntil: NOW }, { status: "running", leaseUntil: null },
    { status: "running", leaseUntil: new Date(NOW.getTime() + 1) },
    { status: "queued", lockedBy: "worker-A", leaseUntil: null },
    { status: "queued", lockedBy: null, leaseUntil: new Date(NOW.getTime() - 1) },
    { status: "succeeded" }, { status: "failed" }, { status: "canceled" },
    { kind: PRIVATE_IMAGE_TAGGING_JOB_KIND, status: "queued", lockedBy: null, leaseUntil: null },
  ] satisfies Partial<AiJob>[])("denies nonclaimable state %# even when the read-back owner matches", async patch => {
    const { row } = claimDatabase(fixture(patch));
    await expect(claimAiJobByRunId(row.runId, { workerId: "worker-A" })).resolves.toBeNull();
    expect(row.attempt).toBe(2);
  });

  it("expired running lease can be claimed but preserves model-dispatched checkpoint", async () => {
    const { row } = claimDatabase(fixture({ lockedBy: "old-worker", leaseUntil: new Date(NOW.getTime() - 1), input: { checkpoint: "model_dispatched" } }));
    await expect(claimAiJobByRunId(row.runId, { workerId: "worker-A" })).resolves.toMatchObject({ attempt: 3, input: { checkpoint: "model_dispatched" } });
  });

  it.each([0, 2])("affectedRows %s is not accepted as a successful newkind claim", async affectedRows => {
    const { row } = claimDatabase(fixture(), affectedRows);
    await expect(claimAiJobByRunId(row.runId, { workerId: "worker-A" })).resolves.toBeNull();
  });

  it("keeps legacy same-worker active claim behavior", async () => {
    const { row } = claimDatabase(fixture({ kind: "legacy.kind" }));
    await expect(claimAiJobByRunId(row.runId, { workerId: "worker-A" })).resolves.toMatchObject({ attempt: 3 });
  });
});
