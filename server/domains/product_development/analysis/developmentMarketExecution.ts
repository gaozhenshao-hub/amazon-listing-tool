import type { DevelopmentMarketIdentity, DevelopmentMarketOperation } from "../../../../shared/developmentMarket";
import { ConfiguredBusinessDispatchReceiptSchema } from "../../ai_os/services/configuredBusinessRuntimeContract";
import { createDevelopmentMarketRepository, type DevelopmentMarketLease } from "./developmentMarketRepository";
import { developmentMarketRuntime } from "./developmentMarketRuntime";
import { developmentMarketEnabled, loadDevelopmentMarketConfiguration, developmentMarketReason } from "./developmentMarketService";
import { developmentMarketSourceContext } from "./developmentMarketSource";
import { DevelopmentMarketError } from "./developmentMarketCore";

/** A durable dispatch ACK, not an in-memory flag, authorizes the sole paid
 * call. Restarted dispatched work is unknown and is never automatically run. */
export function createDevelopmentMarketExecution(dependencies: {
  repository: ReturnType<typeof createDevelopmentMarketRepository>;
  runtime?: Pick<typeof developmentMarketRuntime, "prepareStage" | "executeStage">;
  loadConfiguration?: typeof loadDevelopmentMarketConfiguration; enabled?: () => boolean;
  report?: (state: "processing_failed" | "outcome_unknown") => void;
}) {
  const repository = dependencies.repository, runtime = dependencies.runtime ?? developmentMarketRuntime,
    configuration = dependencies.loadConfiguration ?? loadDevelopmentMarketConfiguration, enabled = dependencies.enabled ?? developmentMarketEnabled,
    report = dependencies.report ?? (state => console.warn("[DevelopmentMarket]", { state }));
  return async (input: { identity: DevelopmentMarketIdentity; operation: DevelopmentMarketOperation; workerId: string; signal: AbortSignal }) => {
    if (!enabled() || input.signal.aborted) return;
    const controller = new AbortController(), abort = () => controller.abort(); input.signal.addEventListener("abort", abort, { once: true });
    let lease: DevelopmentMarketLease | null = null, timer: ReturnType<typeof setInterval> | undefined, heartbeat: Promise<void> | null = null,
      resultCommitAttempted = false;
    const active = () => { if (!enabled() || input.signal.aborted) controller.abort(); controller.signal.throwIfAborted(); };
    const beat = async () => {
      if (heartbeat) return heartbeat;
      heartbeat = (async () => { try { active(); await repository.heartbeat(lease!); } catch { controller.abort(); } finally { heartbeat = null; } })();
      return heartbeat;
    };
    try {
      active(); lease = await repository.claim(input.identity, input.operation, input.workerId); if (!lease) return;
      timer = setInterval(() => { void beat(); }, 30_000); timer.unref();
      const prepared = await repository.prepareStage(lease, async (tx, run, source) => {
        active(); return runtime.prepareStage({ executor: tx, identity: input.identity, operationId: input.operation.operationId,
          configuration: await configuration(tx, input.identity), source, sourceHash: source.sourceHash,
          sourceContext: developmentMarketSourceContext(source), runtimeSnapshot: run.runtimeSnapshot });
      });
      active(); let acknowledged = false;
      const result = await runtime.executeStage(prepared, { signal: controller.signal, beforeDispatch: async (receipt, verifyFresh) => {
        active();
        await repository.dispatch(lease!, { receipt: ConfiguredBusinessDispatchReceiptSchema.parse(receipt), snapshotHash: prepared.snapshotHash,
          contextHash: prepared.contextHash, providerRequestHash: prepared.providerRequestHash, bindingHash: prepared.bindingHash }, async (tx, run, source) => {
          active(); await verifyFresh(tx, await configuration(tx, input.identity), source.sourceHash, developmentMarketSourceContext(source)); active();
          if (run.runtimeSnapshot.snapshotHash !== prepared.snapshotHash) throw new DevelopmentMarketError("RUNTIME_CHANGED");
        });
        acknowledged = true; active();
      } });
      // Stop/gate changes prevent a new call, never discard a paid valid reply.
      if (timer) { clearInterval(timer); timer = undefined; } if (heartbeat) await heartbeat;
      if (!acknowledged || result.contextHash !== prepared.contextHash || result.snapshotHash !== prepared.snapshotHash
        || result.providerRequestHash !== prepared.providerRequestHash || result.bindingHash !== prepared.bindingHash) throw new DevelopmentMarketError("RESULT_RECEIPT_INVALID");
      resultCommitAttempted = true; await repository.candidate(lease, result);
    } catch (error) {
      if (!lease || resultCommitAttempted) { report(resultCommitAttempted ? "outcome_unknown" : "processing_failed"); return; }
      try { await repository.failure(lease, developmentMarketReason(error)); } catch { report("outcome_unknown"); }
    } finally { if (timer) clearInterval(timer); if (heartbeat) await heartbeat; input.signal.removeEventListener("abort", abort); }
  };
}
