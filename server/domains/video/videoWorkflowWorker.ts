import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireDb } from "../../repositories/dbClient";
import { VideoWorkflowIdSchema, VideoWorkflowUuidSchema } from "../../../shared/videoWorkflow";
import { videoWorkflowRows, type VideoWorkflowExecutor } from "./videoWorkflowSource";
import { VIDEO_WORKFLOW_JOB_KIND } from "./videoWorkflowRepository";
import { assertVideoWorkflowSchema } from "./videoWorkflowSource";
import { videoWorkflowRepository, videoWorkflowWorkerEnabled, loadVideoWorkflowConfiguration, videoWorkflowReason } from "./videoWorkflowService";
import { videoWorkflowRuntimes } from "./videoWorkflowService";
import { VideoConfiguredDispatchReceiptSchema } from "./videoConfiguredRuntimeContract";

const hintSchema = z.object({ id: VideoWorkflowIdSchema, workspaceId: VideoWorkflowIdSchema, userId: VideoWorkflowIdSchema,
  projectId: VideoWorkflowIdSchema, videoScriptId: VideoWorkflowIdSchema, operationId: VideoWorkflowUuidSchema }).strict();
export type VideoWorkflowQueueHint = z.infer<typeof hintSchema>;
export function createVideoWorkflowQueue(deps: { database?: () => Promise<{ transaction<T>(work: (tx: VideoWorkflowExecutor) => Promise<T>): Promise<T> } | null>;
  enabled?: () => boolean; schemaReady?: typeof assertVideoWorkflowSchema } = {}) {
  const enabled = deps.enabled ?? videoWorkflowWorkerEnabled, database = deps.database ?? (() => requireDb("Video workflow queue"));
  return async (afterId = 0, limit = 10): Promise<VideoWorkflowQueueHint[]> => {
    z.number().int().min(0).max(2147483647).parse(afterId); z.number().int().min(1).max(25).parse(limit);
    if (!enabled()) return [];
    const db = await database(); if (!db || typeof db.transaction !== "function") throw new Error("VIDEO_WORKFLOW_QUEUE_UNAVAILABLE");
    return db.transaction(async tx => {
      if (!enabled()) return []; await (deps.schemaReady ?? assertVideoWorkflowSchema)(tx); if (!enabled()) return [];
      const rows = await videoWorkflowRows(tx, "SELECT id,workspaceId,userId,projectId,JSON_EXTRACT(input,'$.request.videoScriptId') AS videoScriptId,JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.operationId')) AS operationId FROM ai_jobs WHERE kind=? AND id>? AND status IN ('queued','running') AND (leaseUntil IS NULL OR leaseUntil<=NOW(6)) ORDER BY id LIMIT ?", [VIDEO_WORKFLOW_JOB_KIND, afterId, limit], limit);
      const result = rows.map(row => hintSchema.parse(row));
      if (result.some((row, index) => row.id <= (index ? result[index - 1].id : afterId))) throw new Error("VIDEO_WORKFLOW_QUEUE_INVALID");
      return enabled() ? result : [];
    });
  };
}
export function createVideoWorkflowProcessor(deps: Partial<{ repository: typeof videoWorkflowRepository; runtimes: typeof videoWorkflowRuntimes;
  loadConfiguration: typeof loadVideoWorkflowConfiguration; enabled: () => boolean; heartbeatMs: number; workerId: string }> = {}) {
  const repo = deps.repository ?? videoWorkflowRepository, runtimes = deps.runtimes ?? videoWorkflowRuntimes,
    loadConfiguration = deps.loadConfiguration ?? loadVideoWorkflowConfiguration, enabled = deps.enabled ?? videoWorkflowWorkerEnabled;
  return async (raw: VideoWorkflowQueueHint, signal?: AbortSignal) => {
    const hint = hintSchema.parse(raw), identity = { userId: hint.userId, workspaceId: hint.workspaceId }, scope = {
      expectedWorkspaceId: hint.workspaceId, projectId: hint.projectId, videoScriptId: hint.videoScriptId, operationId: hint.operationId };
    if (!enabled() || signal?.aborted) return;
    const lease = await repo.claim(identity, scope, deps.workerId ?? "video-workflow-worker"); if (!lease) return;
    const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true });
    // Abort events are not replayed when a listener is attached after claim.
    // A shutdown that won while the lease TX was pending must still block fees.
    if (signal?.aborted) controller.abort();
    let heartbeatWork = Promise.resolve(), heartbeatFailed = false, resultCommitAttempted = false;
    const active = () => { if (!enabled() || controller.signal.aborted || heartbeatFailed) throw new Error("PROCESSOR_STOPPED"); };
    const timer = setInterval(() => { heartbeatWork = heartbeatWork.then(async () => {
      if (!enabled() || controller.signal.aborted) { controller.abort(); return; }
      try { await repo.heartbeat(lease); } catch { heartbeatFailed = true; controller.abort(); }
    }); }, deps.heartbeatMs ?? 30000); timer.unref?.();
    try {
      active();
      const stage = await repo.prepareStage(lease, async (executor, run, source) => ({ operation: run.request.operation, prepared: await runtimes[run.request.operation].prepareStage({ executor, identity, sourceHash: source.sourceHash, sourceContext: source.context,
        operationId: hint.operationId, configuration: await loadConfiguration(executor, identity), runtimeSnapshot: run.runtimeSnapshot }) }));
      const prepared = stage.prepared, runtime = runtimes[stage.operation];
      active();
      const result = await runtime.executeStage(prepared, { signal: controller.signal, beforeDispatch: async (receipt, verifyFresh) => {
        active(); await repo.dispatch(lease, { receipt: VideoConfiguredDispatchReceiptSchema.parse(receipt), contextHash: prepared.contextHash, snapshotHash: prepared.snapshotHash,
          bindingHash: prepared.bindingHash, providerRequestHash: prepared.providerRequestHash }, async (executor, run, source) => {
          active(); const configuration = await loadConfiguration(executor, identity);
          if (configuration.hash !== run.configuration.hash || configuration.revision !== run.configuration.revision) throw new Error("CONFIGURATION_CHANGED");
          await verifyFresh(executor, configuration, source.sourceHash, source.context); active();
        });
      } });
      clearInterval(timer); await heartbeatWork;
      // A paid, verified reply is not erased by local stop/flag-off. This short
      // commit still rechecks current authority, lease and cancellation in SQL.
      resultCommitAttempted = true; await repo.candidate(lease, result);
    } catch (error) {
      if (!resultCommitAttempted) { try { await repo.failure(lease, videoWorkflowReason(error)); } catch { /* Never redispatch after an unverified checkpoint. */ } }
    } finally { clearInterval(timer); await heartbeatWork; signal?.removeEventListener("abort", abort); }
  };
}
export function createVideoWorkflowWorker(deps: { discover?: ReturnType<typeof createVideoWorkflowQueue>; process?: ReturnType<typeof createVideoWorkflowProcessor>;
  enabled?: () => boolean; intervalMs?: number } = {}) {
  const enabled = deps.enabled ?? videoWorkflowWorkerEnabled, discover = deps.discover ?? createVideoWorkflowQueue(), process = deps.process ?? createVideoWorkflowProcessor({ workerId: `video-workflow-${randomUUID()}` });
  const controller = new AbortController(); let running: Promise<void> | null = null, afterId = 0;
  const tick = (): Promise<void> => {
    if (!enabled() || controller.signal.aborted) return Promise.resolve();
    if (running) return running;
    running = (async () => {
      try {
        const hints = await discover(afterId, 10); if (!hints.length) { afterId = 0; return; }
        for (const hint of hints) { if (!enabled() || controller.signal.aborted) break; afterId = hint.id; await process(hint, controller.signal); }
      } catch { /* Discovery failure never runs a model or leaks DB details. */ }
    })().finally(() => { running = null; }); return running;
  };
  const timer = setInterval(() => { void tick(); }, deps.intervalMs ?? 3000); timer.unref?.();
  return { tick, async stop(timeoutMs = 30000) {
    controller.abort(); clearInterval(timer);
    if (!running) return;
    const waitMs = Number.isFinite(timeoutMs) ? Math.max(1, Math.min(timeoutMs, 60000)) : 30000;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([running, new Promise<void>(resolve => { timeout = setTimeout(resolve, waitMs); })]);
    } finally { if (timeout) clearTimeout(timeout); }
    // A surviving in-flight operation retains its durable dispatch/lease fence;
    // returning from shutdown never makes it eligible for another paid call.
  } };
}
export function startVideoWorkflowWorker(role: string) {
  if (!["worker", "all"].includes(role) || !videoWorkflowWorkerEnabled()) return null;
  return createVideoWorkflowWorker();
}
