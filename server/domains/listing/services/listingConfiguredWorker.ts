import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireDb } from "../../../repositories/dbClient";
import { LISTING_CONFIGURED_KIND, ListingConfiguredIdSchema, ListingConfiguredUuidSchema } from "../../../../shared/listingConfiguredWorkflow";
import { listingConfiguredRows as rows, assertListingConfiguredSchema, type ListingConfiguredExecutor } from "./listingConfiguredSource";
import { listingConfiguredRepository } from "./listingConfiguredRepository";
import { listingConfiguredRuntime } from "./listingConfiguredRuntime";
import { listingConfiguredWorkerEnabled, loadListingConfiguredConfiguration, listingConfiguredReason } from "./listingConfiguredService";
import { ListingConfiguredDispatchSchema } from "./listingConfiguredRuntimeContract";
const hintSchema = z.object({ id: ListingConfiguredIdSchema, workspaceId: ListingConfiguredIdSchema, userId: ListingConfiguredIdSchema,
  projectId: ListingConfiguredIdSchema, operationId: ListingConfiguredUuidSchema }).strict();
export type ListingConfiguredQueueHint = z.infer<typeof hintSchema>;
export function createListingConfiguredQueue(deps: { database?: () => Promise<{ transaction<T>(work: (tx: ListingConfiguredExecutor) => Promise<T>): Promise<T> } | null>;
  enabled?: () => boolean; schema?: typeof assertListingConfiguredSchema } = {}) {
  const enabled = deps.enabled ?? listingConfiguredWorkerEnabled;
  return async (afterId = 0, limit = 10): Promise<ListingConfiguredQueueHint[]> => {
    z.number().int().min(0).max(2147483647).parse(afterId); z.number().int().min(1).max(25).parse(limit);
    if (!enabled()) return []; const db = await (deps.database ?? (() => requireDb("Listing configured queue")))(); if (!db) return [];
    return db.transaction(async tx => { if (!enabled()) return []; await (deps.schema ?? assertListingConfiguredSchema)(tx);
      const found = await rows(tx, "SELECT id,workspaceId,userId,projectId,JSON_UNQUOTE(JSON_EXTRACT(CAST(JSON_UNQUOTE(input) AS JSON),'$.request.operationId')) AS operationId FROM ai_jobs WHERE kind=? AND id>? AND status IN ('queued','running') AND (leaseUntil IS NULL OR leaseUntil<=NOW(6)) ORDER BY id LIMIT ?", [LISTING_CONFIGURED_KIND, afterId, limit], limit);
      const parsed = found.map(row => hintSchema.parse(row)); if (parsed.some((row, index) => row.id <= (index ? parsed[index - 1].id : afterId))) throw new Error("LISTING_CONFIGURED_QUEUE_INVALID"); return enabled() ? parsed : [];
    });
  };
}
export function createListingConfiguredProcessor(deps: Partial<{ repository: typeof listingConfiguredRepository; runtime: typeof listingConfiguredRuntime;
  loadConfiguration: typeof loadListingConfiguredConfiguration; enabled: () => boolean; heartbeatMs: number; workerId: string }> = {}) {
  const repo = deps.repository ?? listingConfiguredRepository, runtime = deps.runtime ?? listingConfiguredRuntime,
    configuration = deps.loadConfiguration ?? loadListingConfiguredConfiguration, enabled = deps.enabled ?? listingConfiguredWorkerEnabled;
  return async (raw: ListingConfiguredQueueHint, signal?: AbortSignal) => {
    const hint = hintSchema.parse(raw), identity = { workspaceId: hint.workspaceId, userId: hint.userId }, scope = { expectedWorkspaceId: hint.workspaceId, projectId: hint.projectId, operationId: hint.operationId };
    if (!enabled() || signal?.aborted) return;
    const lease = await repo.claim(identity, scope, deps.workerId ?? "listing-configured-worker"); if (!lease) return;
    const controller = new AbortController(), abort = () => controller.abort(); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) controller.abort();
    let heartbeat = Promise.resolve(), heartbeatFailed = false, resultCommitAttempted = false;
    const active = () => { if (!enabled() || controller.signal.aborted || heartbeatFailed) throw new Error("PROCESSOR_STOPPED"); };
    const timer = setInterval(() => { heartbeat = heartbeat.then(async () => { if (!enabled() || controller.signal.aborted) { controller.abort(); return; }
      try { await repo.heartbeat(lease); } catch { heartbeatFailed = true; controller.abort(); } }); }, deps.heartbeatMs ?? 30000); timer.unref?.();
    try {
      // Every known response is committed before another attempt. A dispatched
      // checkpoint without its response is never advanced by this loop/restart.
      for (let count = 0; count < 42; count++) {
        active(); resultCommitAttempted = false;
        const prepared = await repo.prepareStage(lease, async (executor, run, source, attempt, previous) => runtime.prepareStage({ executor, source,
          configuration: await configuration(executor, identity), runtimeSnapshot: run.runtimeSnapshot, attempt, previous }));
        active();
        const result = await runtime.executeStage(prepared, { signal: controller.signal, beforeDispatch: async (receipt, verifyFresh) => {
          active(); await repo.dispatch(lease, prepared.attempt, { receipt: ListingConfiguredDispatchSchema.parse(receipt), contextHash: prepared.contextHash,
            snapshotHash: prepared.snapshotHash, bindingHash: prepared.bindingHash, providerRequestHash: prepared.providerRequestHash }, async (executor, run, source) => {
            active(); const saved = await configuration(executor, identity);
            if (saved.hash !== run.configuration.hash || saved.revision !== run.configuration.revision) throw new Error("CONFIGURATION_CHANGED");
            await verifyFresh(executor, source, saved); active();
          });
        } });
        // Paid result cleanup ignores gate/stop, but storage still verifies
        // current owner, lease, cancellation and the exact dispatch receipt.
        resultCommitAttempted = true; const saved = await repo.returned(lease, result);
        if (["succeeded", "failed"].includes(saved.state)) return;
      }
    } catch (error) { if (!resultCommitAttempted) { try { await repo.failure(lease, listingConfiguredReason(error)); } catch { /* Unknown remains fenced. */ } } }
    finally { clearInterval(timer); await heartbeat; signal?.removeEventListener("abort", abort); }
  };
}
export function createListingConfiguredWorker(deps: { discover?: ReturnType<typeof createListingConfiguredQueue>; process?: ReturnType<typeof createListingConfiguredProcessor>;
  enabled?: () => boolean; intervalMs?: number } = {}) {
  const enabled = deps.enabled ?? listingConfiguredWorkerEnabled, discover = deps.discover ?? createListingConfiguredQueue(), process = deps.process ?? createListingConfiguredProcessor({ workerId: `listing-configured-${randomUUID()}` });
  const controller = new AbortController(); let work: Promise<void> | null = null, afterId = 0;
  const tick = (): Promise<void> => {
    if (!enabled() || controller.signal.aborted) return Promise.resolve(); if (work) return work;
    work = (async () => { try { const hints = await discover(afterId, 10); if (!hints.length) { afterId = 0; return; }
      for (const hint of hints) { if (!enabled() || controller.signal.aborted) break; afterId = hint.id; await process(hint, controller.signal); }
    } catch { /* No fee on discovery errors. */ } })().finally(() => { work = null; }); return work;
  };
  const timer = setInterval(() => { void tick(); }, deps.intervalMs ?? 3000); timer.unref?.();
  return { tick, async stop(timeoutMs = 30000) { controller.abort(); clearInterval(timer); if (!work) return;
    let timeout: ReturnType<typeof setTimeout> | undefined; try { await Promise.race([work, new Promise<void>((_resolve, reject) => { timeout = setTimeout(() => reject(new Error("LISTING_CONFIGURED_WORKER_STOP_TIMEOUT")), Math.min(60000, Math.max(1, timeoutMs))); })]); }
    finally { if (timeout) clearTimeout(timeout); }
  } };
}
export function startListingConfiguredWorker(role: string) {
  return ["worker", "all"].includes(role) && listingConfiguredWorkerEnabled() ? createListingConfiguredWorker() : null;
}
