import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireDb } from "../../../repositories/dbClient";
import { ImagePlanningIdSchema, ImagePlanningUuidSchema } from "../../../../shared/imagePlanning";
import { imagePlanningRows, type ImagePlanningExecutor } from "./imagePlanningSource";
import { IMAGE_PLANNING_JOB_KIND } from "./imagePlanningRepository";
import { assertImagePlanningSchema } from "./imagePlanningSchemaAdmission";
import { imagePlanningRepository, imagePlanningWorkerEnabled, loadImagePlanningConfiguration, imagePlanningReason } from "./imagePlanningService";
import { imagePlanningRuntime, imagePlanningSourceContext } from "./imagePlanningRuntime";
import { ImagePlanningDispatchReceiptSchema } from "./imagePlanningRuntimeContract";

const hintSchema = z.object({ id: ImagePlanningIdSchema, workspaceId: ImagePlanningIdSchema, userId: ImagePlanningIdSchema,
  projectId: ImagePlanningIdSchema, sessionId: ImagePlanningIdSchema, operationId: ImagePlanningUuidSchema }).strict();
export type ImagePlanningQueueHint = z.infer<typeof hintSchema>;
export function createImagePlanningQueue(deps: { database?: () => Promise<{ transaction<T>(work: (tx: ImagePlanningExecutor) => Promise<T>): Promise<T> } | null>;
  enabled?: () => boolean; schemaReady?: typeof assertImagePlanningSchema } = {}) {
  const enabled = deps.enabled ?? imagePlanningWorkerEnabled, database = deps.database ?? (() => requireDb("Image planning queue"));
  return async (afterId = 0, limit = 10): Promise<ImagePlanningQueueHint[]> => {
    z.number().int().min(0).max(2147483647).parse(afterId); z.number().int().min(1).max(25).parse(limit);
    if (!enabled()) return [];
    const db = await database(); if (!db || typeof db.transaction !== "function") throw new Error("IMAGE_PLANNING_QUEUE_UNAVAILABLE");
    return db.transaction(async tx => {
      if (!enabled()) return []; await (deps.schemaReady ?? assertImagePlanningSchema)(tx); if (!enabled()) return [];
      const rows = await imagePlanningRows(tx, "SELECT id,workspaceId,userId,projectId,JSON_EXTRACT(input,'$.request.sessionId') AS sessionId,JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.operationId')) AS operationId FROM ai_jobs WHERE kind=? AND id>? AND status IN ('queued','running') AND (leaseUntil IS NULL OR leaseUntil<=NOW(6)) ORDER BY id LIMIT ?", [IMAGE_PLANNING_JOB_KIND, afterId, limit], limit);
      const result = rows.map(row => hintSchema.parse(row));
      if (result.some((row, index) => row.id <= (index ? result[index - 1].id : afterId))) throw new Error("IMAGE_PLANNING_QUEUE_INVALID");
      return enabled() ? result : [];
    });
  };
}
export function createImagePlanningProcessor(deps: Partial<{ repository: typeof imagePlanningRepository; runtime: typeof imagePlanningRuntime;
  loadConfiguration: typeof loadImagePlanningConfiguration; enabled: () => boolean; heartbeatMs: number; workerId: string }> = {}) {
  const repo = deps.repository ?? imagePlanningRepository, runtime = deps.runtime ?? imagePlanningRuntime,
    loadConfiguration = deps.loadConfiguration ?? loadImagePlanningConfiguration, enabled = deps.enabled ?? imagePlanningWorkerEnabled;
  return async (raw: ImagePlanningQueueHint, signal?: AbortSignal) => {
    const hint = hintSchema.parse(raw), identity = { userId: hint.userId, workspaceId: hint.workspaceId }, scope = {
      expectedWorkspaceId: hint.workspaceId, projectId: hint.projectId, sessionId: hint.sessionId, operationId: hint.operationId };
    if (!enabled() || signal?.aborted) return;
    const lease = await repo.claim(identity, scope, deps.workerId ?? "image-planning-worker"); if (!lease) return;
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
      const prepared = await repo.prepareStage(lease, async (executor, run, source) => runtime.prepareStage({ executor, source,
        operationId: hint.operationId, configuration: await loadConfiguration(executor, identity), runtimeSnapshot: run.runtimeSnapshot }));
      active();
      const result = await runtime.executeStage(prepared, { signal: controller.signal, beforeDispatch: async (receipt, verifyFresh) => {
        active(); await repo.dispatch(lease, { receipt: ImagePlanningDispatchReceiptSchema.parse(receipt), contextHash: prepared.contextHash, snapshotHash: prepared.snapshotHash,
          bindingHash: prepared.bindingHash, providerRequestHash: prepared.providerRequestHash }, async (executor, run, source) => {
          active(); const configuration = await loadConfiguration(executor, identity);
          if (configuration.hash !== run.configuration.hash || configuration.revision !== run.configuration.revision) throw new Error("CONFIGURATION_CHANGED");
          await verifyFresh(executor, configuration, source.sourceHash, imagePlanningSourceContext(source)); active();
        });
      } });
      clearInterval(timer); await heartbeatWork;
      // A paid, verified reply is not erased by local stop/flag-off. This short
      // commit still rechecks current authority, lease and cancellation in SQL.
      resultCommitAttempted = true; await repo.candidate(lease, result);
    } catch (error) {
      if (!resultCommitAttempted) { try { await repo.failure(lease, imagePlanningReason(error)); } catch { /* Never redispatch after an unverified checkpoint. */ } }
    } finally { clearInterval(timer); await heartbeatWork; signal?.removeEventListener("abort", abort); }
  };
}
export function createImagePlanningWorker(deps: { discover?: ReturnType<typeof createImagePlanningQueue>; process?: ReturnType<typeof createImagePlanningProcessor>;
  enabled?: () => boolean; intervalMs?: number } = {}) {
  const enabled = deps.enabled ?? imagePlanningWorkerEnabled, discover = deps.discover ?? createImagePlanningQueue(), process = deps.process ?? createImagePlanningProcessor({ workerId: `image-planning-${randomUUID()}` });
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
export function startImagePlanningWorker(role: string) {
  if (!["worker", "all"].includes(role) || !imagePlanningWorkerEnabled()) return null;
  return createImagePlanningWorker();
}
