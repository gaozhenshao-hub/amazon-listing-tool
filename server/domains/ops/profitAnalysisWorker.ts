import { randomUUID } from "node:crypto";
import type { RuntimeRole } from "../../_core/runtime";
import { buildProfitAnalysisEvidence, validateProfitAnalysisResultAgainstEvidence } from "../../../shared/profitAnalysis";
import { profitAnalysisJobRepository, ProfitAnalysisJobStorageError,
  type ProfitAnalysisJobLease, type ProfitAnalysisJobRun, type ProfitAnalysisJobSession } from "./profitAnalysisJobRepository";
import { profitAnalysisRuntime, ProfitAnalysisRuntimeError, type ProfitAnalysisRuntime } from "./profitAnalysisRuntime";
import { profitAnalysisService, profitAnalysisWorkerEnabled } from "./profitAnalysisService";
import { profitAnalysisQueue, type ProfitAnalysisQueueHint } from "./profitAnalysisQueue";
import type { StrictSkillDispatchReceipt } from "../ai_os/services/skillRunner";

type Report = (state: "discovery_failed" | "processing_failed" | "outcome_unknown" | "drain_timeout") => void;
type Hooks = Pick<typeof profitAnalysisService, "authorize" | "capture" | "configuration">;
type Input = ProfitAnalysisQueueHint & { workerId: string; signal: AbortSignal };
type Dependencies = { repository: Pick<typeof profitAnalysisJobRepository, "transaction">; hooks: Hooks;
  runtime: ProfitAnalysisRuntime; enabled: () => boolean; report: Report };
const leaseSeconds = 120;
function code(error: unknown) {
  const result = error instanceof ProfitAnalysisJobStorageError || error instanceof ProfitAnalysisRuntimeError ? error.code : "PROCESSING_FAILED";
  return /^[A-Z][A-Z0-9_]{0,99}$/u.test(result) ? result : "PROCESSING_FAILED";
}

/** A private financial run has one durable provider fence. Expired dispatched
 * work is unknown, not a new provider request. Network work never holds a TX. */
export function createProfitAnalysisProcessor(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { repository: profitAnalysisJobRepository, hooks: profitAnalysisService,
    runtime: profitAnalysisRuntime, enabled: profitAnalysisWorkerEnabled,
    report: state => console.warn("[ProfitAnalysis]", { state }), ...overrides };
  return async (input: Input): Promise<void> => {
    if (!deps.enabled() || input.signal.aborted) return;
    const owner = { workspaceId: input.workspaceId, userId: input.userId }, controller = new AbortController();
    const abort = () => controller.abort(); input.signal.addEventListener("abort", abort, { once: true });
    let lease: ProfitAnalysisJobLease | null = null, expectedSnapshot: string | null = null;
    let timer: ReturnType<typeof setInterval> | undefined, heartbeat: Promise<void> | null = null;
    let resultCommitAttempted = false;
    const active = () => { if (!deps.enabled() || input.signal.aborted) controller.abort(); controller.signal.throwIfAborted(); };
    async function authorized(session: ProfitAnalysisJobSession): Promise<ProfitAnalysisJobRun> {
      await deps.hooks.authorize(session, "run");
      const run = await session.runById(input.id, input.operationId);
      if (!run || run.id !== input.id || run.operationId !== input.operationId || run.workspaceId !== owner.workspaceId || run.userId !== owner.userId
        || expectedSnapshot !== null && run.snapshotHash !== expectedSnapshot) throw new ProfitAnalysisJobStorageError("RUN_UNAVAILABLE");
      return run;
    }
    const beat = (): Promise<void> => {
      if (heartbeat) return heartbeat;
      heartbeat = (async () => {
        try {
          active();
          await deps.repository.transaction(owner, async session => {
            const run = await authorized(session);
            // Fresh owner permissions, not the UUID or frozen snapshot, decide
            // whether this user may continue seeing/processing this scope.
            await deps.hooks.capture(session, run.target, "run");
            active(); await session.heartbeat(lease!, leaseSeconds);
          });
        } catch { controller.abort(); }
        finally { heartbeat = null; }
      })();
      return heartbeat;
    };
    async function finish() {
      active(); if (heartbeat) await heartbeat; active(); resultCommitAttempted = true;
      await deps.repository.transaction(owner, async session => {
        const run = await authorized(session); active();
        if (!run.snapshot || !run.result || run.state !== "result_ready") throw new ProfitAnalysisJobStorageError("CHECKPOINT_CONFLICT");
        await deps.hooks.capture(session, run.target, "run");
        validateProfitAnalysisResultAgainstEvidence(run.result, run.snapshot.evidence);
        active(); await session.finish(lease!);
      });
    }
    try {
      const claimed = await deps.repository.transaction(owner, async session => {
        const run = await authorized(session); active();
        await deps.hooks.capture(session, run.target, "run"); active();
        return session.claim({ target: run.target, operationId: input.operationId, workerId: input.workerId, leaseSeconds });
      });
      lease = claimed.lease;
      if (!lease) return; // Includes dispatched -> unknown recovery; never retry.
      expectedSnapshot = claimed.run.snapshotHash;
      timer = setInterval(() => { void beat(); }, 30_000); timer.unref();
      if (claimed.run.state === "result_ready") { await finish(); return; }
      const prepared = await deps.repository.transaction(owner, async session => {
        const run = await authorized(session); active(); await session.heartbeat(lease!, leaseSeconds);
        if (run.state !== "queued" || !run.snapshot) throw new ProfitAnalysisJobStorageError("CHECKPOINT_CONFLICT");
        const current = await deps.hooks.capture(session, run.target, "run"), evidence = buildProfitAnalysisEvidence(current);
        if (current.sourceHash !== run.snapshot.source.sourceHash || current.authorizationHash !== run.snapshot.source.authorizationHash
          || current.selectionHash !== run.snapshot.source.selectionHash) throw new ProfitAnalysisJobStorageError("SOURCE_CHANGED");
        if (!evidence.evidence.length) {
          const result = deps.runtime.deterministic({ identity: owner, source: current, evidence });
          validateProfitAnalysisResultAgainstEvidence(result, run.snapshot.evidence);
          active(); return { kind: "deterministic" as const, result };
        }
        const configuration = await deps.hooks.configuration(session);
        if (!configuration) throw new ProfitAnalysisJobStorageError("CONFIGURATION_UNAVAILABLE");
        const stage = await deps.runtime.prepareStage({ executor: session.executor, identity: owner, operationId: run.operationId,
          configuration, source: current, evidence, runtimeSnapshot: run.snapshot.runtime });
        active(); return { kind: "model" as const, stage };
      });
      if (prepared.kind === "deterministic") {
        active(); resultCommitAttempted = true;
        await deps.repository.transaction(owner, async session => {
          const run = await authorized(session), current = await deps.hooks.capture(session, run.target, "run"); active();
          if (current.sourceHash !== run.snapshot?.source.sourceHash || current.authorizationHash !== run.snapshot.source.authorizationHash) throw new ProfitAnalysisJobStorageError("SOURCE_CHANGED");
          await session.resultReady(lease!, prepared.result);
        });
        resultCommitAttempted = false; await finish(); return;
      }
      const stage = prepared.stage;
      let dispatched: StrictSkillDispatchReceipt | null = null;
      const paid = await deps.runtime.executeStage(stage, { signal: controller.signal, beforeDispatch: async (receipt, verifyFresh) => {
        active(); if (heartbeat) await heartbeat; active();
        if (receipt.stage !== "profit_analysis" || receipt.bindingHash !== stage.bindingHash) throw new ProfitAnalysisJobStorageError("DISPATCH_RECEIPT_INVALID");
        await deps.repository.transaction(owner, async session => {
          const run = await authorized(session), current = await deps.hooks.capture(session, run.target, "run"), configuration = await deps.hooks.configuration(session);
          if (!configuration || run.state !== "queued") throw new ProfitAnalysisJobStorageError("CHECKPOINT_CONFLICT");
          await verifyFresh(session.executor, configuration, current, buildProfitAnalysisEvidence(current)); active();
          await session.dispatch(lease!, { strictDispatch: receipt, runtimeSnapshotHash: stage.snapshotHash, contextHash: stage.contextHash, bindingHash: stage.bindingHash });
        });
        dispatched = receipt; active();
      } });
      // A stop/gate change must prevent new provider work, not discard a reply
      // already paid for. Persist that reply in a short, freshly authorized TX;
      // cancellation and lease fencing still take precedence in resultReady.
      if (timer) { clearInterval(timer); timer = undefined; }
      if (heartbeat) await heartbeat;
      const receipt = dispatched as StrictSkillDispatchReceipt | null;
      if (!receipt || paid.stage !== "profit_analysis" || paid.runId !== receipt.runId || paid.bindingHash !== stage.bindingHash
        || paid.contextHash !== stage.contextHash || paid.snapshotHash !== stage.snapshotHash) throw new ProfitAnalysisJobStorageError("RESULT_RECEIPT_INVALID");
      // A lost commit acknowledgement must not overwrite a durable paid result
      // with failure. The next claim inspects dispatched/result_ready state.
      resultCommitAttempted = true;
      await deps.repository.transaction(owner, async session => {
        const run = await authorized(session);
        await deps.hooks.capture(session, run.target, "run");
        const stored = run.dispatchReceipt as { strictDispatch?: StrictSkillDispatchReceipt; runtimeSnapshotHash?: unknown; contextHash?: unknown; bindingHash?: unknown } | null;
        if (!run.snapshot || run.state !== "dispatched" || stored?.strictDispatch?.runId !== receipt.runId
          || stored.strictDispatch.requestHash !== receipt.requestHash || stored.runtimeSnapshotHash !== stage.snapshotHash
          || stored.contextHash !== stage.contextHash || stored.bindingHash !== stage.bindingHash) throw new ProfitAnalysisJobStorageError("RESULT_RECEIPT_INVALID");
        validateProfitAnalysisResultAgainstEvidence(paid.result, run.snapshot.evidence);
        await session.resultReady(lease!, paid.result);
      });
      resultCommitAttempted = false; await finish();
    } catch (error) {
      if (!lease || resultCommitAttempted) { deps.report(resultCommitAttempted ? "outcome_unknown" : "processing_failed"); return; }
      try {
        await deps.repository.transaction(owner, async session => {
          const run = await authorized(session);
          if (run.state !== "result_ready") await session.fail(lease!, code(error));
        });
      } catch { deps.report("outcome_unknown"); }
    } finally {
      if (timer) clearInterval(timer);
      if (heartbeat) await heartbeat;
      input.signal.removeEventListener("abort", abort);
    }
  };
}

export function shouldProcessProfitAnalysis(role: RuntimeRole, env: NodeJS.ProcessEnv = process.env) {
  return role === "worker" && env.ENABLE_PROFIT_ANALYSIS_WRITES === "true" && env.ENABLE_PROFIT_ANALYSIS_WORKER === "true";
}
export function createProfitAnalysisWorker(options: { discover?: typeof profitAnalysisQueue.discover;
  processRun?: ReturnType<typeof createProfitAnalysisProcessor>; enabled?: () => boolean; report?: Report; workerId?: string } = {}) {
  const enabled = options.enabled ?? profitAnalysisWorkerEnabled, discover = options.discover ?? profitAnalysisQueue.discover;
  const report: Report = options.report ?? (state => console.warn("[ProfitAnalysis]", { state }));
  const processRun = options.processRun ?? createProfitAnalysisProcessor({ enabled, report }), workerId = options.workerId ?? `profit-${randomUUID()}`;
  let stopped = false, cursor = 0, active: Promise<void> | null = null;
  const controller = new AbortController();
  return {
    tick(): Promise<void> {
      if (stopped || !enabled()) return Promise.resolve(); if (active) return active;
      active = (async () => {
        let hints: ProfitAnalysisQueueHint[];
        try { hints = await discover({ afterId: cursor, limit: 10 }); } catch { report("discovery_failed"); return; }
        if (!hints.length) { cursor = 0; return; }
        for (const hint of hints) { if (stopped || !enabled()) return; cursor = hint.id;
          try { await processRun({ ...hint, workerId, signal: controller.signal }); } catch { report("processing_failed"); }
        }
      })().finally(() => { active = null; }); return active;
    },
    stop(): Promise<void> { stopped = true; controller.abort(); return active ?? Promise.resolve(); },
  };
}
export function startProfitAnalysisWorker(role: RuntimeRole) {
  if (!shouldProcessProfitAnalysis(role)) return async () => {};
  const worker = createProfitAnalysisWorker();
  const timer = setInterval(() => { void worker.tick(); }, 5000); timer.unref(); void worker.tick();
  return async () => {
    clearInterval(timer); let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      const drained = await Promise.race([worker.stop().then(() => true), new Promise<false>(resolve => { timeout = setTimeout(() => resolve(false), 5000); })]);
      if (!drained) console.warn("[ProfitAnalysis]", { state: "drain_timeout" });
    } finally { if (timeout) clearTimeout(timeout); }
  };
}
