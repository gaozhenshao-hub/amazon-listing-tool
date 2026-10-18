import type { ImageTaggingOperationInput, ImageTaggingSourceImage } from "../../../shared/imageTagging";
import { imageTaggingRuntime, type ImageTaggingPreparedStage } from "./imageTaggingRuntime";
import { ImageTaggingRuntimeError } from "./imageTaggingRuntime";
import { ImageTaggingDispatchReceiptSchema, type ImageTaggingEvidence, type ImageTaggingSavedConfiguration } from "./imageTaggingRuntimeContract";
import { ImageTaggingRepositoryError, type ImageTaggingExecutor, type ImageTaggingLease,
  type createImageTaggingRepository } from "./imageTaggingRepository";

type Repository = ReturnType<typeof createImageTaggingRepository>;
type Identity = ImageTaggingLease["identity"];
export type ImageTaggingImageReader = (image: ImageTaggingSourceImage, identity: Identity, signal?: AbortSignal) => Promise<{
  evidence: ImageTaggingEvidence; originalBytes: Uint8Array;
}>;
export type ImageTaggingConfigurationReader = (tx: ImageTaggingExecutor, identity: Identity) => Promise<ImageTaggingSavedConfiguration>;
type Input = { operation: ImageTaggingOperationInput; identity: Identity; workerId: string; signal: AbortSignal };
function reason(error: unknown): string {
  return error instanceof ImageTaggingRepositoryError || error instanceof ImageTaggingRuntimeError ? error.code : "PROCESSING_FAILED";
}

/** Dedicated single-call processor. The durable repository owns every paid
 * dispatch fence; process memory is never a retry permission. Source bytes are
 * loaded outside transactions. Registry preparation is DB-only inside a fresh
 * tx, followed by another source/config/runtime check immediately before its
 * dispatch checkpoint ACK. No model fallback, repair or automatic re-fee. */
export function createImageTaggingExecution(dependencies: {
  repository: Repository; readImage: ImageTaggingImageReader; loadConfiguration: ImageTaggingConfigurationReader;
  runtime?: Pick<typeof imageTaggingRuntime, "prepareStage" | "executeStage">;
  enabled?: () => boolean; report?: (state: "processing_failed" | "outcome_unknown") => void;
}) {
  const repository = dependencies.repository, runtime = dependencies.runtime ?? imageTaggingRuntime,
    enabled = dependencies.enabled ?? (() => process.env.ENABLE_IMAGE_TAGGING_WRITES === "true" && process.env.ENABLE_IMAGE_TAGGING_WORKER === "true"),
    report = dependencies.report ?? (state => console.warn("[ImageTagging]", { state }));
  return async (input: Input): Promise<void> => {
    if (!enabled() || input.signal.aborted) return;
    const controller = new AbortController(), abort = () => controller.abort();
    input.signal.addEventListener("abort", abort, { once: true });
    let lease: ImageTaggingLease | null = null, heartbeat: Promise<void> | null = null;
    let timer: ReturnType<typeof setInterval> | undefined, imageId: number | null = null, resultCommitAttempted = false;
    const active = () => { if (!enabled() || input.signal.aborted) controller.abort(); controller.signal.throwIfAborted(); };
    async function beat() {
      if (heartbeat) return heartbeat;
      heartbeat = (async () => { try { active(); await repository.heartbeat(lease!); } catch { controller.abort(); } finally { heartbeat = null; } })();
      return heartbeat;
    }
    try {
      active();
      lease = await repository.claim(input.identity, input.operation, input.workerId);
      // Expired dispatched work becomes durable unknown here. A new processor
      // never receives a lease with permission to repeat that image's model.
      if (!lease) return;
      timer = setInterval(() => { void beat(); }, 30_000); timer.unref();
      for (let remaining = 300; remaining > 0; remaining--) {
        active(); if (heartbeat) await heartbeat; active();
        if (!timer) { timer = setInterval(() => { void beat(); }, 30_000); timer.unref(); }
        const run = await repository.readLease(lease), stage = run.stages.find(item => item.state === "pending");
        if (!stage) return;
        imageId = stage.imageId;
        const image = run.source.images.find(item => item.id === imageId);
        if (!image) throw new ImageTaggingRepositoryError("SOURCE_BINDING_INVALID");
        const loaded = await dependencies.readImage(image, input.identity, controller.signal); active();
        const prepared: ImageTaggingPreparedStage = await repository.prepareStage(lease, async (tx, current, source) => {
          active();
          const configuration = await dependencies.loadConfiguration(tx, input.identity);
          return runtime.prepareStage({ executor: tx, identity: input.identity, operationId: input.operation.operationId, configuration,
            sourceHash: source.sourceHash, imageCount: current.runtimeSnapshot.imageCount, runtimeSnapshot: current.runtimeSnapshot,
            evidence: loaded.evidence, originalBytes: loaded.originalBytes });
        });
        active();
        let dispatchAcknowledged = false;
        const result = await runtime.executeStage(prepared, { signal: controller.signal, beforeDispatch: async (receipt, verifyFresh) => {
          active();
          await repository.dispatch(lease!, { imageId: stage.imageId, evidence: loaded.evidence, prepared, receipt: ImageTaggingDispatchReceiptSchema.parse(receipt) }, async (tx, current, source, evidence) => {
            active();
            const configuration = await dependencies.loadConfiguration(tx, input.identity);
            await verifyFresh(tx, configuration, source.sourceHash, evidence); active();
            if (current.runtimeSnapshot.snapshotHash !== prepared.snapshotHash) throw new ImageTaggingRepositoryError("RUNTIME_CHANGED");
          });
          dispatchAcknowledged = true; active();
        } });
        // A stop/gate change can prevent the next dispatch, but cannot discard
        // a paid reply. Quiesce heartbeat before its one local result commit.
        if (timer) { clearInterval(timer); timer = undefined; }
        if (heartbeat) await heartbeat;
        if (!dispatchAcknowledged || result.bindingHash !== prepared.bindingHash || result.contextHash !== prepared.contextHash
          || result.snapshotHash !== prepared.snapshotHash || result.evidenceHash !== prepared.evidenceHash
          || result.providerRequestHash !== prepared.providerRequestHash) throw new ImageTaggingRepositoryError("RESULT_RECEIPT_INVALID");
        // A lost candidate ACK must not be changed into failure/cancellation;
        // original-UUID check observes its exact committed or unknown state.
        resultCommitAttempted = true;
        const persisted = await repository.candidate(lease, { ...result, imageId: stage.imageId });
        resultCommitAttempted = false;
        if (persisted.state !== "running") return;
      }
      throw new ImageTaggingRepositoryError("IMAGE_LIMIT");
    } catch (error) {
      if (!lease || resultCommitAttempted) { report(resultCommitAttempted ? "outcome_unknown" : "processing_failed"); return; }
      try { await repository.failure(lease, imageId, reason(error)); }
      catch { report("outcome_unknown"); }
    } finally {
      if (timer) clearInterval(timer);
      if (heartbeat) await heartbeat;
      input.signal.removeEventListener("abort", abort);
    }
  };
}
