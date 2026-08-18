import { describe, expect, it } from "vitest";
import { isStaleActiveStep5Run, recoverStaleStep5Run, resolveStep5Restart, STEP5_STALE_RUN_GRACE_MS } from "./step5StaleRecovery";

describe("Step5历史卡住任务自动回收判定", () => {
  it("仅将超过5分钟宽限窗口的活动任务判为卡住", () => {
    const now = Date.UTC(2026, 7, 18, 4, 0, 0);
    expect(isStaleActiveStep5Run({ status: "running", startedAt: new Date(now - STEP5_STALE_RUN_GRACE_MS - 1), now })).toBe(true);
    expect(isStaleActiveStep5Run({ status: "queued", startedAt: new Date(now - STEP5_STALE_RUN_GRACE_MS), now })).toBe(false);
    expect(isStaleActiveStep5Run({ status: "succeeded", startedAt: new Date(now - STEP5_STALE_RUN_GRACE_MS - 1), now })).toBe(false);
    expect(isStaleActiveStep5Run({ status: "running", startedAt: null, now })).toBe(false);
  });

  it("自动取消历史卡住任务并将会话持久化为可重新生成的失败状态", async () => {
    const now = Date.UTC(2026, 7, 18, 4, 0, 0);
    const cancelled: string[] = [];
    const updates: Array<{ id: number; update: Record<string, unknown> }> = [];
    const recovered = await recoverStaleStep5Run({
      session: { id: 780001, step5RunId: "stale-run", step5RunStatus: "running", step5RunStartedAt: new Date(now - STEP5_STALE_RUN_GRACE_MS - 1) },
      cancelRun: async (runId) => { cancelled.push(runId); },
      persist: async (id, update) => { updates.push({ id, update }); },
      now,
    });

    expect(recovered.recovered).toBe(true);
    expect(cancelled).toEqual(["stale-run"]);
    expect(updates[0]).toMatchObject({ id: 780001, update: { step5RunStatus: "failed", step5RunFailedGroup: "stale_recovery", step5RunProgress: 100 } });
    expect(recovered.session.step5RunStatus).toBe("failed");
  });

  it("启动路由守卫会先回收过期运行，再允许创建新的Step5任务", async () => {
    const now = Date.now();
    const cancelled: string[] = [];
    const updates: Record<string, unknown>[] = [];
    const outcome = await resolveStep5Restart({
      session: { id: 780001, step5RunId: "stale-run", step5RunStatus: "running", step5RunStartedAt: new Date(now - STEP5_STALE_RUN_GRACE_MS - 1) },
      cancelRun: async (runId) => { cancelled.push(runId); },
      persist: async (_id, update) => { updates.push(update); },
      getRun: async () => ({ status: "running" }),
      isActiveJob: (job) => job.status === "running",
    });

    expect(outcome.kind).toBe("recovered");
    expect(cancelled).toEqual(["stale-run"]);
    expect(updates[0]).toMatchObject({ step5RunStatus: "failed", step5RunFailedGroup: "stale_recovery" });
  });

  it("启动路由守卫保留未过期的活动任务，避免重复创建", async () => {
    const outcome = await resolveStep5Restart({
      session: { id: 780001, step5RunId: "active-run", step5RunStatus: "running", step5RunStartedAt: new Date() },
      cancelRun: async () => undefined,
      persist: async () => undefined,
      getRun: async () => ({ status: "running", runId: "active-run" }),
      isActiveJob: (job) => job.status === "running",
    });

    expect(outcome).toMatchObject({ kind: "active", activeJob: { runId: "active-run" } });
  });
});
