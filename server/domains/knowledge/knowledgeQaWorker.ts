import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireDb } from "../../repositories/dbClient";
import { KnowledgeQaIdSchema, KnowledgeQaUuidSchema } from "../../../shared/knowledgeQa";
import { assertKnowledgeQaSchema, knowledgeQaRows, type KnowledgeQaExecutor } from "./knowledgeQaStorePrimitives";
import { KNOWLEDGE_QA_JOB_KIND, nextKnowledgeQaStage } from "./knowledgeQaRepository";
import { knowledgeQaRepository, knowledgeQaWorkerEnabled, loadKnowledgeQaConfiguration, knowledgeQaReason } from "./knowledgeQaService";
import { knowledgeQaRuntime } from "./knowledgeQaRuntime";
const hintSchema = z.object({ id: KnowledgeQaIdSchema, workspaceId: KnowledgeQaIdSchema, userId: KnowledgeQaIdSchema, threadId: KnowledgeQaUuidSchema, operationId: KnowledgeQaUuidSchema }).strict();
export type KnowledgeQaQueueHint = z.infer<typeof hintSchema>;
export function createKnowledgeQaQueue(deps: { database?: () => Promise<{ transaction<T>(work: (tx: KnowledgeQaExecutor) => Promise<T>): Promise<T> } | null>; enabled?: () => boolean; schemaReady?: typeof assertKnowledgeQaSchema } = {}) {
  const enabled = deps.enabled ?? knowledgeQaWorkerEnabled, database = deps.database ?? (() => requireDb("Knowledge QA queue"));
  return async (afterId = 0, limit = 10): Promise<KnowledgeQaQueueHint[]> => {
    z.number().int().min(0).max(2147483647).parse(afterId); z.number().int().min(1).max(25).parse(limit); if (!enabled()) return [];
    const db = await database(); if (!db || typeof db.transaction !== "function") throw new Error("KNOWLEDGE_QA_QUEUE_UNAVAILABLE");
    return db.transaction(async tx => { if (!enabled()) return []; await (deps.schemaReady ?? assertKnowledgeQaSchema)(tx); if (!enabled()) return [];
      const rows = await knowledgeQaRows(tx, "SELECT id,workspaceId,userId,JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.threadId')) AS threadId,JSON_UNQUOTE(JSON_EXTRACT(input,'$.request.operationId')) AS operationId FROM ai_jobs WHERE kind=? AND id>? AND status IN ('queued','running') AND (leaseUntil IS NULL OR leaseUntil<=NOW(6)) ORDER BY id LIMIT ?", [KNOWLEDGE_QA_JOB_KIND, afterId, limit], limit);
      const result = rows.map(row => hintSchema.parse(row)); if (result.some((row, i) => row.id <= (i ? result[i - 1].id : afterId))) throw new Error("KNOWLEDGE_QA_QUEUE_INVALID"); return enabled() ? result : [];
    });
  };
}
export function createKnowledgeQaProcessor(deps: Partial<{ repository: typeof knowledgeQaRepository; runtime: typeof knowledgeQaRuntime; loadConfiguration: typeof loadKnowledgeQaConfiguration; enabled: () => boolean; workerId: string; heartbeatMs: number }> = {}) {
  const repo = deps.repository ?? knowledgeQaRepository, runtime = deps.runtime ?? knowledgeQaRuntime, configuration = deps.loadConfiguration ?? loadKnowledgeQaConfiguration, enabled = deps.enabled ?? knowledgeQaWorkerEnabled;
  return async (raw: KnowledgeQaQueueHint, signal?: AbortSignal) => {
    const hint = hintSchema.parse(raw), identity = { userId: hint.userId, workspaceId: hint.workspaceId }, scope = { expectedWorkspaceId: hint.workspaceId, threadId: hint.threadId, operationId: hint.operationId };
    if (!enabled() || signal?.aborted) return; const lease = await repo.claim(identity, scope, deps.workerId ?? "knowledge-qa-worker"); if (!lease) return;
    const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) controller.abort();
    let heartbeat = Promise.resolve(), heartbeatFailed = false, checkpointAttempted = false;
    const active = () => { if (!enabled() || controller.signal.aborted || heartbeatFailed) throw new Error("PROCESSOR_STOPPED"); };
    const timer = setInterval(() => { heartbeat = heartbeat.then(async () => { if (!enabled() || controller.signal.aborted) { controller.abort(); return; } try { await repo.heartbeat(lease); } catch { heartbeatFailed = true; controller.abort(); } }); }, deps.heartbeatMs ?? 30000); timer.unref?.();
    try {
      for (let step = 0; step < 3; step++) {
        // A stopped worker leaves an already-paid intermediate checkpoint
        // resumable. It must not convert that durable result into a failure.
        active(); checkpointAttempted = false;
        const current = await repo.stage(lease, async (executor, run, source) => { const next = nextKnowledgeQaStage(run); if (!next) return null;
          if (next.deterministic) return { deterministic: true as const, next };
          const prepared = await runtime.prepareStage({ executor, source, operationId: hint.operationId, configuration: await configuration(executor, identity), runtimeSnapshot: run.runtimeSnapshot, stageKey: next.stageKey, indices: next.indices });
          return { deterministic: false as const, prepared };
        });
        if (!current) break; active();
        if (current.deterministic) { const value = await repo.deterministic(lease); if (value.state === "succeeded") break; continue; }
        const result = await runtime.executeStage(current.prepared, { signal: controller.signal, beforeDispatch: async (receipt, verifyFresh) => {
          active(); await repo.dispatch(lease, current.prepared, receipt, async (executor, run, source) => { active(); const saved = await configuration(executor, identity);
            if (saved.hash !== run.configuration.hash || saved.revision !== run.configuration.revision) throw new Error("CONFIGURATION_CHANGED"); await verifyFresh(executor, saved, source); active(); });
        } });
        await heartbeat; checkpointAttempted = true;
        // A verified paid result may be committed after local stop/flag-off.
        // SQL still checks fresh authority, cancellation and the original lease.
        const value = await repo.checkpoint(lease, result); if (value.state === "succeeded") break;
      }
    } catch (error) {
      // Local shutdown/gate-off or a lost heartbeat is not a business failure.
      // This also covers abort during claim of an earlier paid checkpoint.
      // Retain its exact lease and checkpoints; an expired dispatched stage is
      // still fenced to unknown by claim(), never sent to the model again.
      if (!checkpointAttempted && !controller.signal.aborted && !heartbeatFailed && enabled()) {
        try { await repo.failure(lease, knowledgeQaReason(error)); } catch { /* Never repeat an uncertain dispatch/checkpoint. */ }
      }
    }
    finally { clearInterval(timer); await heartbeat; signal?.removeEventListener("abort", abort); }
  };
}
export function createKnowledgeQaWorker(deps: { discover?: ReturnType<typeof createKnowledgeQaQueue>; process?: ReturnType<typeof createKnowledgeQaProcessor>; enabled?: () => boolean; intervalMs?: number } = {}) {
  const enabled = deps.enabled ?? knowledgeQaWorkerEnabled, discover = deps.discover ?? createKnowledgeQaQueue(), process = deps.process ?? createKnowledgeQaProcessor({ workerId: `knowledge-qa-${randomUUID()}` });
  const controller = new AbortController(); let running: Promise<void> | null = null, afterId = 0;
  const tick = (): Promise<void> => { if (!enabled() || controller.signal.aborted) return Promise.resolve(); if (running) return running;
    running = (async () => { try { const hints = await discover(afterId, 10); if (!hints.length) { afterId = 0; return; } for (const hint of hints) { if (!enabled() || controller.signal.aborted) break; afterId = hint.id; await process(hint, controller.signal); } } catch { /* Safe discovery failure; no provider fallback. */ } })().finally(() => { running = null; }); return running;
  };
  const timer = setInterval(() => { void tick(); }, deps.intervalMs ?? 3000); timer.unref?.();
  return { tick, async stop(timeoutMs = 30000) { controller.abort(); clearInterval(timer); if (!running) return; let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([running, new Promise<void>(resolve => { timeoutTimer = setTimeout(resolve, Math.max(1, Math.min(timeoutMs, 60000))); })]); } finally { if (timeoutTimer) clearTimeout(timeoutTimer); } } };
}
export function startKnowledgeQaWorker(role: string) { return ["worker", "all"].includes(role) && knowledgeQaWorkerEnabled() ? createKnowledgeQaWorker() : null; }
