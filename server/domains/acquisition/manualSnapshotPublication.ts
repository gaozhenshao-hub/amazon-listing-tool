import { acquisitionReviewCanonical, acquisitionReviewHash } from "../../../shared/acquisitionReview";
import { replayManualSnapshotRevision } from "./manualSnapshotRevision";
import type { ManualSnapshotPublishContext, ManualSnapshotReviewExecutor } from "./manualSnapshotRevision";

export type ManualSnapshotPublication = Readonly<ManualSnapshotPublishContext & { contentHash: string; sourceHash: string }>;
const active = new WeakMap<ManualSnapshotReviewExecutor, Map<number, ManualSnapshotPublication>>();
function freeze<T>(value: T): T {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value;
}
/** A short-lived server proof, not a substitute for current target ownership or
 * policy. Only the review repository issues it after its actual SQL readback;
 * consumers cannot mint it from browser DTOs, raw fields or a revision ID. */
export function issueManualSnapshotPublication(context: ManualSnapshotPublishContext): () => void {
  if (!context.tx || typeof context.tx.execute !== "function" || !Number.isSafeInteger(context.confirmedSnapshotId) || context.confirmedSnapshotId <= 0) throw new Error("ACQUISITION_REVIEW_PUBLICATION_INVALID");
  const replay = replayManualSnapshotRevision({ snapshot: context.snapshot, assets: context.allAssets, revision: context.revision });
  if (replay.revision.status !== "confirmed" || acquisitionReviewHash(replay.revision) !== acquisitionReviewHash(context.envelope)
    || acquisitionReviewHash(replay.effectiveData) !== acquisitionReviewHash(context.effectiveData)
    || acquisitionReviewHash(replay.selectedAssets) !== acquisitionReviewHash(context.assets)) throw new Error("ACQUISITION_REVIEW_PUBLICATION_INVALID");
  const { tx, ...body } = context;
  const cloned = freeze(JSON.parse(acquisitionReviewCanonical(body))) as Omit<ManualSnapshotPublishContext, "tx">;
  const proof = Object.freeze({ ...cloned, tx,
    contentHash: acquisitionReviewHash({ confirmedData: replay.effectiveData, approvedAssetIds: replay.selectedAssets.map(asset => asset.id), revisionHash: context.revision.revisionHash }),
    sourceHash: acquisitionReviewHash({ effectiveData: replay.effectiveData, revision: replay.revision, selectedAssets: replay.selectedAssets }),
  });
  const records = active.get(tx) ?? new Map<number, ManualSnapshotPublication>();
  if (records.has(context.confirmedSnapshotId)) throw new Error("ACQUISITION_REVIEW_PUBLICATION_ALREADY_ACTIVE");
  records.set(context.confirmedSnapshotId, proof); active.set(tx, records);
  return () => { if (records.get(context.confirmedSnapshotId) === proof) records.delete(context.confirmedSnapshotId); if (!records.size) active.delete(tx); };
}
export function getManualSnapshotPublication(tx: ManualSnapshotReviewExecutor, confirmedSnapshotId: number): ManualSnapshotPublication | null {
  return active.get(tx)?.get(confirmedSnapshotId) ?? null;
}
