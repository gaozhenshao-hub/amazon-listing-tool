import { collectInventorySnapshotSources, INVENTORY_COLLECTION_SOURCES, type InventoryCollectionRead } from "../../../shared/inventorySnapshotCollection";
import { inventoryCollectionInitialProgress } from "../../../shared/inventorySnapshotRefresh";
import type { RuntimeRole } from "../../_core/runtime";
import { getDb } from "../../repositories/dbClient";
import { inventoryCollectionCredentials } from "./inventoryCollectionConfig";
import { inventoryCollectionRepository, type InventoryCollectionClaim } from "./inventoryCollectionRepository";
import { createInventoryCollectionTransport, InventoryCollectionTransportError } from "./inventoryCollectionTransport";

export function shouldProcessInventoryCollections(role: RuntimeRole, env: NodeJS.ProcessEnv = process.env) {
  return env.ENABLE_MERGED_OPS_INVENTORY_COLLECTION === "true"
    && (role === "worker" || role === "all" || role === "web" && env.INVENTORY_COLLECTION_IN_PROCESS === "true");
}
type Repository = Pick<typeof inventoryCollectionRepository, "claimNext" | "heartbeat" | "complete" | "fail">;
const enabled = () => process.env.ENABLE_MERGED_OPS_INVENTORY_COLLECTION === "true";
async function credentials(claim: InventoryCollectionClaim) {
  const db = await getDb();
  if (!db || typeof db.transaction !== "function") throw new Error("INVENTORY_COLLECTION_DATABASE_UNAVAILABLE");
  return db.transaction(tx => inventoryCollectionCredentials(tx, claim.identity.workspaceId, claim.context.connectionVersion));
}
type Dependencies = {
  repository: Repository; credentials: typeof credentials; transport: typeof createInventoryCollectionTransport;
  collect: typeof collectInventorySnapshotSources; enabled: () => boolean;
  report: (state: "tick_failed" | "result_unknown" | "failure_unknown") => void;
};

/** Consumes only explicitly queued manual jobs. No seeding, scheduled fetch,
 * periodic refresh of source data, or automatic re-fetch after unknown commit. */
export function createInventoryCollectionWorker(overrides: Partial<Dependencies> = {}) {
  const deps: Dependencies = { repository: inventoryCollectionRepository, credentials, transport: createInventoryCollectionTransport,
    collect: collectInventorySnapshotSources, enabled, report: state => console.warn("[InventoryCollection]", { state }), ...overrides };
  let stopped = false, active: Promise<void> | null = null, abort: AbortController | null = null;
  async function execute() {
    if (stopped || !deps.enabled()) return;
    let claim: InventoryCollectionClaim | null = null, completeAttempted = false;
    let heartbeatTimer: ReturnType<typeof setInterval> | null = null, heartbeatPending: Promise<boolean> | null = null;
    let progress = inventoryCollectionInitialProgress();
    try {
      claim = await deps.repository.claimNext();
      if (!claim) return;
      const current = claim, controller = new AbortController(); abort = controller;
      const check = () => { if (stopped || !deps.enabled()) controller.abort(); controller.signal.throwIfAborted(); };
      const beat = () => {
        if (heartbeatPending) return heartbeatPending;
        heartbeatPending = (async () => {
          try {
            if (stopped || !deps.enabled() || !await deps.repository.heartbeat({ jobId: current.jobId, leaseToken: current.leaseToken, progress })) { controller.abort(); return false; }
            return true;
          } catch { controller.abort(); return false; }
          finally { heartbeatPending = null; }
        })();
        return heartbeatPending;
      };
      check();
      if (!await beat()) throw new Error("INVENTORY_COLLECTION_LEASE_LOST");
      heartbeatTimer = setInterval(() => { void beat(); }, 30_000); heartbeatTimer.unref();
      const auth = await deps.credentials(current); check();
      if (auth.workspaceId !== current.identity.workspaceId || auth.connectionVersion !== current.context.connectionVersion) throw new Error("INVENTORY_COLLECTION_CONFIG_CHANGED");
      const transport = deps.transport(auth, controller.signal);
      const read: InventoryCollectionRead = async request => {
        check();
        if (request.source === "catalogEnd") progress = { source: "details", completedSources: 10, totalSources: 10 };
        else if (request.source !== "catalogStart") progress = { source: request.source, completedSources: INVENTORY_COLLECTION_SOURCES.indexOf(request.source), totalSources: 10 };
        const response = await transport(request); check(); return response;
      };
      const collection = await deps.collect({ context: current.context, read, signal: controller.signal }); check();
      if (heartbeatPending) await heartbeatPending;
      if (!await beat()) throw new Error("INVENTORY_COLLECTION_LEASE_LOST");
      check(); completeAttempted = true;
      // A rejected/lost commit acknowledgement is not a reason to overwrite the
      // durable state with failure. The UI resolves the original UUID later.
      await deps.repository.complete({ jobId: current.jobId, leaseToken: current.leaseToken, ...collection });
    } catch (error) {
      if (!claim) { deps.report("tick_failed"); return; }
      if (completeAttempted) { deps.report("result_unknown"); return; }
      const reasonCode = stopped ? "worker_stopped" : !deps.enabled() ? "collection_disabled"
        : error instanceof InventoryCollectionTransportError ? error.reasonCode : abort?.signal.aborted ? "lease_or_authority_lost" : "collection_failed";
      try { await deps.repository.fail({ jobId: claim.jobId, leaseToken: claim.leaseToken, reasonCode }); }
      catch { deps.report("failure_unknown"); }
    } finally {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      if (heartbeatPending) await heartbeatPending;
      abort = null;
    }
  }
  return {
    tick(): Promise<void> {
      if (stopped) return Promise.resolve();
      if (active) return active;
      active = execute().finally(() => { active = null; }); return active;
    },
    stop(): Promise<void> { stopped = true; abort?.abort(); return active ?? Promise.resolve(); },
  };
}

export function startInventoryCollectionWorker(role: RuntimeRole) {
  if (!shouldProcessInventoryCollections(role)) return async () => {};
  const worker = createInventoryCollectionWorker();
  const interval = setInterval(() => { void worker.tick(); }, 5000); interval.unref();
  void worker.tick();
  return async () => {
    clearInterval(interval);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([worker.stop(), new Promise<void>(resolve => { timer = setTimeout(resolve, 5000); })]); }
    finally { if (timer) clearTimeout(timer); }
  };
}
