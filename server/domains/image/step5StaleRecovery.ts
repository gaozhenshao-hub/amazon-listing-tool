export const STEP5_STALE_RUN_GRACE_MS = 5 * 60 * 1000 + 30_000;

export function isStaleActiveStep5Run(input: {
  status: string | null | undefined;
  startedAt: Date | string | null | undefined;
  now?: number;
}) {
  if (input.status !== "queued" && input.status !== "running") return false;
  const startedAt = input.startedAt ? new Date(input.startedAt).getTime() : Number.NaN;
  if (!Number.isFinite(startedAt)) return false;
  return (input.now ?? Date.now()) - startedAt > STEP5_STALE_RUN_GRACE_MS;
}

export const STALE_STEP5_RUN_ERROR = "Step 5任务超过允许执行窗口仍未收敛，系统已自动回收，可直接重新生成";

export async function recoverStaleStep5Run<T extends {
  id: number;
  step5RunId: string | null;
  step5RunStatus: string | null;
  step5RunStartedAt: Date | string | null;
}>(input: {
  session: T;
  cancelRun: (runId: string, reason: string) => Promise<unknown>;
  persist: (sessionId: number, update: Record<string, unknown>) => Promise<unknown>;
  now?: number;
}) {
  if (!input.session.step5RunId || !isStaleActiveStep5Run({
    status: input.session.step5RunStatus,
    startedAt: input.session.step5RunStartedAt,
    now: input.now,
  })) {
    return { recovered: false, session: input.session };
  }
  const update = {
    step5RunStatus: "failed",
    step5RunProgress: 100,
    step5RunError: STALE_STEP5_RUN_ERROR,
    step5RunFailedGroup: "stale_recovery",
    step5RunFailedModule: null,
    step5RunCompletedAt: new Date(input.now ?? Date.now()),
  };
  await input.cancelRun(input.session.step5RunId, STALE_STEP5_RUN_ERROR).catch(() => null);
  await input.persist(input.session.id, update);
  return { recovered: true, session: { ...input.session, ...update } };
}
