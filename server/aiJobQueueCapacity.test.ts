import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const store = vi.hoisted(() => ({ rows: new Map<string, any>() }));
vi.mock("./repositories/ai_os", () => ({
  getAiJobByRunId: vi.fn(async (id: string) => store.rows.get(id)),
  claimAiJobByRunId: vi.fn(async (id: string, opts: any) => {
    const row = store.rows.get(id);
    if (row.status !== "queued") return null;
    Object.assign(row, { status: "running", lockedBy: opts.workerId, attempt: 1 });
    return row;
  }),
  updateAiJobByRunId: vi.fn(async (id: string, patch: any) => Object.assign(store.rows.get(id), patch)),
  releaseAiJobLease: vi.fn(async () => null),
  heartbeatAiJobWorker: vi.fn(async () => null),
  heartbeatAiJobLease: vi.fn(async () => null),
  listRecoverableAiJobs: vi.fn(async () => [...store.rows.values()].filter(row => row.status === "queued")),
}));
vi.mock("./domains/ai_os/services/observability", () => ({ recordAiOsMetric: vi.fn(async () => null) }));

describe("queue capacity after collection schedules tagging", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    vi.stubEnv("AI_JOB_MAX_CONCURRENCY", "2");
    vi.stubEnv("APP_PROCESS_ROLE", "all");
    store.rows.clear();
  });
  afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); vi.unstubAllEnvs(); });

  it.each(["worker", "inline"])("drains queued children without blocking capacity in %s mode", async mode => {
    vi.stubEnv("AI_JOB_RUNNER_MODE", mode);
    const runner = await import("./domains/ai_os/services/jobRunner");
    const now = new Date();
    for (const id of ["batch-1", "batch-2", ...Array.from({ length: 5 }, (_, i) => `tag-${i}`)]) {
      store.rows.set(id, { id: store.rows.size + 1, runId: id, kind: "test.queue", module: "test", status: "queued",
        userId: 1, workspaceId: 1, createdAt: now, updatedAt: now, timeoutSeconds: 60, attempt: 0 });
    }
    let finish!: () => void;
    const gate = new Promise<void>(resolve => { finish = resolve; });
    let active = 0, peak = 0;
    const handled: string[] = [];
    runner.registerAiJobHandler({ id: "capacity-test", match: job => job.kind === "test.queue", handler: async job => {
      active++; peak = Math.max(peak, active);
      try {
        if (job.runId.startsWith("batch")) await gate;
        handled.push(job.runId);
        return { ok: true };
      } finally { active--; }
    } });
    await runner.scheduleAiJobRun("batch-1");
    await runner.scheduleAiJobRun("batch-2");
    await vi.advanceTimersByTimeAsync(1);
    expect(runner.getAiJobRuntimeStatus().runningCount).toBe(2);
    for (let i = 0; i < 5; i++) {
      await runner.scheduleAiJobRun(`tag-${i}`);
      await runner.scheduleAiJobRun(`tag-${i}`); // Repeated enqueue must not execute twice.
    }
    finish();
    await vi.advanceTimersByTimeAsync(1);
    for (let i = 0; i < 5; i++) {
      await runner.drainAiJobQueue();
      await vi.advanceTimersByTimeAsync(1100);
    }
    expect(handled.sort()).toEqual([...store.rows.keys()].sort());
    expect(peak).toBeLessThanOrEqual(2);
    expect([...store.rows.values()].every(row => row.status === "succeeded")).toBe(true);
    expect(runner.getAvailableAiJobSlots()).toBe(2);
  });
});
