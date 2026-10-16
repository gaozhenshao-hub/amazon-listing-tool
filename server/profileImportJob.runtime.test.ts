import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AiJob } from "../drizzle/schema";
import { PROFILE_IMPORT_JOB_KIND } from "../shared/profileImportJob";

const mocks = vi.hoisted(() => ({
  get: vi.fn(), owned: vi.fn(), update: vi.fn(), create: vi.fn(), retry: vi.fn(), claim: vi.fn(),
  heartbeat: vi.fn(), release: vi.fn(), metric: vi.fn(), deadLetter: vi.fn(), workerHeartbeat: vi.fn(),
}));
vi.mock("./repositories/ai_os", () => ({
  getAiJobByRunId: mocks.get, updateOwnedProfileImportJob: mocks.owned,
  updateAiJobByRunId: mocks.update, createAiJob: mocks.create, retryAiJobByRunId: mocks.retry,
  claimAiJobByRunId: mocks.claim, heartbeatAiJobLease: mocks.heartbeat, releaseAiJobLease: mocks.release,
  createAiJobDeadLetter: mocks.deadLetter, heartbeatAiJobWorker: mocks.workerHeartbeat,
  listAiJobDeadLetters: vi.fn(), listAiJobsForUser: vi.fn(), listAiJobWorkers: vi.fn(),
  listRecoverableAiJobs: vi.fn(), markAiJobWorkerStopped: vi.fn(),
}));
vi.mock("./domains/ai_os/services/observability", () => ({ recordAiOsMetric: mocks.metric }));
vi.mock("./_core/runtime", () => ({ shouldProcessAiJobs: () => false }));
import {
  cancelAiJob, completeAiJob, createAiJobRun, failAiJob, getAiJobWorkerId, recoverAiJob,
  retryAiJob, runAiJobInProcess, startRegisteredAiJob, updateAiJobProgress,
} from "./domains/ai_os/services/jobRunner";

const NOW = new Date("2026-10-16T00:00:00.000Z");
let row: AiJob;
const guard = () => ({ expectedWorkerId: getAiJobWorkerId(), expectedAttempt: 2 });
function fixture(patch: Partial<AiJob> = {}): AiJob {
  return { id: 1, runId: "profile-anchor", kind: PROFILE_IMPORT_JOB_KIND, module: "listing", status: "running",
    progress: 20, attempt: 2, maxAttempts: 10, timeoutSeconds: 30, lockedBy: getAiJobWorkerId(),
    leaseUntil: new Date(NOW.getTime() + 60_000), input: { checkpoint: "analysis_ready", result: "PRIVATE" },
    output: null, userId: 7, createdAt: NOW, updatedAt: NOW, ...patch } as AiJob;
}
beforeEach(() => {
  vi.clearAllMocks(); vi.useFakeTimers(); vi.setSystemTime(NOW); row = fixture();
  mocks.get.mockImplementation(async () => structuredClone(row));
  mocks.update.mockImplementation(async (_id, patch) => Object.assign(row, patch));
  mocks.workerHeartbeat.mockResolvedValue(undefined); mocks.metric.mockResolvedValue(undefined);
  mocks.release.mockResolvedValue(row); mocks.heartbeat.mockResolvedValue(row);
  mocks.claim.mockImplementation(async () => structuredClone(row));
  mocks.owned.mockImplementation(async (_id, change, ownership) => {
    if (row.status !== "running" || !row.leaseUntil || row.leaseUntil <= new Date()
      || ownership.expectedWorkerId !== row.lockedBy || ownership.expectedAttempt !== row.attempt) return null;
    if (change.type === "progress") row.progress = Math.min(99, Math.floor(change.progress));
    if (change.type === "fail") Object.assign(row, { status: "failed", errorMessage: change.errorMessage, lockedBy: null, leaseUntil: null });
    if (change.type === "release") Object.assign(row, { lockedBy: null, leaseUntil: null });
    return structuredClone(row);
  });
});
afterEach(() => vi.useRealTimers());

describe("profile import runner is a fenced host, not a second business commit", () => {
  it("routes progress through the atomic repository guard without touching input/output", async () => {
    const input = structuredClone(row.input);
    await updateAiJobProgress(row.runId, 91, guard());
    expect(mocks.owned).toHaveBeenCalledWith(row.runId, { type: "progress", progress: 91 }, guard());
    expect(row.progress).toBe(91); expect(row.input).toEqual(input); expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each([{}, { expectedWorkerId: "old", expectedAttempt: 2 }, { ...guard(), expectedAttempt: 1 }])("missing/stale guard %# has no state update", async ownership => {
    await updateAiJobProgress(row.runId, 90, ownership);
    await failAiJob(row.runId, new Error("PRIVATE provider body"), ownership);
    expect(row.status).toBe("running"); expect(row.progress).toBe(20);
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.deadLetter).not.toHaveBeenCalled();
  });

  it("does not resurrect an expired lease while failing/progressing", async () => {
    row.leaseUntil = NOW;
    await updateAiJobProgress(row.runId, 80, guard()); await failAiJob(row.runId, "secret", guard());
    expect(row.status).toBe("running"); expect(row.progress).toBe(20);
  });

  it("provider failure cannot create a duplicate retry or generic dead-letter copy", async () => {
    const input = structuredClone(row.input);
    await retryAiJob(row.runId, new Error("provider timeout PRIVATE"), guard());
    expect(row.status).toBe("failed"); expect(row.errorMessage).toBe("PROFILE_IMPORT_FAILED_REVIEW_REQUIRED");
    expect(row.input).toEqual(input); expect(row.output).toBeNull();
    for (const fn of [mocks.retry, mocks.create, mocks.update, mocks.metric, mocks.deadLetter]) expect(fn).not.toHaveBeenCalled();
  });

  it("preserves the domain transaction's committed receipt and ignores handler output", async () => {
    Object.assign(row, { status: "succeeded", input: { checkpoint: "file_committed" }, output: { fileId: 37 }, lockedBy: null, leaseUntil: null });
    const result = await completeAiJob(row.runId, { fileId: 999, privateModel: "secret" }, guard());
    expect(result?.output).toEqual({ fileId: 37 }); expect(result?.input).toEqual({ checkpoint: "file_committed" });
    expect(mocks.update).not.toHaveBeenCalled(); expect(mocks.owned).not.toHaveBeenCalled();
  });

  it("returning a value without the business transaction cannot mark success", async () => {
    await expect(completeAiJob(row.runId, { ok: true }, guard())).rejects.toThrow("PROFILE_IMPORT_COMMIT_REQUIRED");
    expect(row.status).toBe("running"); expect(mocks.update).not.toHaveBeenCalled();
  });

  it.each(["queued", "running", "succeeded", "failed", "canceled"] as const)("generic cancel/recover rejects %s without changing the anchor", async status => {
    row.status = status; const before = structuredClone(row);
    await expect(cancelAiJob(row.runId)).rejects.toThrow("PROFILE_IMPORT_USE_DEDICATED_ENDPOINT");
    await expect(recoverAiJob(row.runId)).rejects.toThrow("PROFILE_IMPORT_USE_DEDICATED_ENDPOINT");
    expect(row).toEqual(before); expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });

  it("generic creation cannot introduce a random conversion anchor", async () => {
    const input = { kind: PROFILE_IMPORT_JOB_KIND, module: "listing", userId: 7 };
    await expect(createAiJobRun(input)).rejects.toThrow("PROFILE_IMPORT_USE_DEDICATED_ENDPOINT");
    await expect(startRegisteredAiJob(input)).rejects.toThrow("PROFILE_IMPORT_USE_DEDICATED_ENDPOINT");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("heartbeat and finally use exact claimed attempt; finalization never uses the legacy worker-only release", async () => {
    let finish!: () => void;
    const held = new Promise<void>(resolve => { finish = resolve; });
    const running = runAiJobInProcess(row.runId, async () => {
      await held;
      Object.assign(row, { status: "succeeded", output: { fileId: 7 }, lockedBy: null, leaseUntil: null });
      return { ignored: true };
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.owned).toHaveBeenCalledWith(row.runId, { type: "heartbeat", leaseSeconds: 30 }, guard());
    finish(); await expect(running).resolves.toMatchObject({ status: "succeeded", output: { fileId: 7 } });
    expect(mocks.owned).toHaveBeenCalledWith(row.runId, { type: "release" }, guard());
    expect(mocks.heartbeat).not.toHaveBeenCalled(); expect(mocks.release).not.toHaveBeenCalled();
  });

  it("timeout fails owned attempt once and a late handler cannot overwrite its checkpoint", async () => {
    let late!: () => void;
    const held = new Promise<void>(resolve => { late = resolve; });
    const running = runAiJobInProcess(row.runId, async () => { await held; return { private: "late" }; });
    const rejected = expect(running).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(30_000); await rejected;
    const afterTimeout = structuredClone(row); late(); await vi.advanceTimersByTimeAsync(0);
    expect(row).toEqual(afterTimeout); expect(row.status).toBe("failed"); expect(row.output).toBeNull();
    expect(mocks.retry).not.toHaveBeenCalled(); expect(mocks.update).not.toHaveBeenCalled();
  });

  it("a claim refusal does not release a newly owned lease", async () => {
    mocks.claim.mockResolvedValue(null); const handler = vi.fn();
    await runAiJobInProcess(row.runId, handler);
    expect(handler).not.toHaveBeenCalled(); expect(mocks.release).not.toHaveBeenCalled();
    expect(mocks.owned).toHaveBeenCalledWith(row.runId, { type: "release" }, { expectedWorkerId: getAiJobWorkerId(), expectedAttempt: undefined });
    expect(row.lockedBy).toBe(getAiJobWorkerId());
  });

  it("legacy progress, completion and cancel retain their original mutation lane", async () => {
    row.kind = "legacy.kind";
    await updateAiJobProgress(row.runId, 80, guard());
    expect(mocks.update).toHaveBeenCalledWith(row.runId, expect.objectContaining({ progress: 80 }));
    await completeAiJob(row.runId, { legacy: true }, guard());
    expect(row.status).toBe("succeeded"); expect(row.output).toEqual({ legacy: true });
    await cancelAiJob(row.runId, "old cancellation"); expect(row.status).toBe("canceled");
    expect(mocks.owned).not.toHaveBeenCalled();
  });
});
