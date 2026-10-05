import { createHash } from "node:crypto";
import { z } from "zod";
import { NormalizedAmazonSnapshotSchema } from "./contracts";
import { withDbTransaction, type DbExecutor } from "../../repositories/dbClient";
import type { AcquisitionAssetCandidate } from "../../../drizzle/schema/acquisition";
import {
  clearCurrentConfirmedSnapshot,
  createConfirmedSnapshot,
  getAcquisitionJob,
  getSourceSnapshot,
  listAssetCandidates,
  nextConfirmationVersion,
  updateAcquisitionJob,
  updateAssetCandidateReview,
  updateSourceSnapshot,
} from "./repository";
import { activateConfirmedSnapshotForConsumer } from "./consumerActivation";
import { readAcquisitionSnapshotJsonField } from "./snapshotJson";

export { readAcquisitionSnapshotJsonField as readSnapshotJsonField } from "./snapshotJson";

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Marks provider-returned values as system-confirmed, without claiming human review. */
export function confirmSnapshotFieldStatuses(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, evidence]) => {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [key, evidence];
    const record = evidence as Record<string, unknown>;
    return [key, record.status === "pending_review"
      ? { ...record, status: "confirmed", noteCode: "system_direct_ingestion" }
      : record];
  }));
}

function requestedImageGallery(capabilities: unknown) {
  return z.array(z.string()).parse(capabilities).includes("image_gallery");
}

export function isRecoverableDirectIngestionSnapshot(snapshot: { status: string; reviewNote?: string | null }) {
  return ["draft", "pending_review"].includes(snapshot.status)
    || (snapshot.status === "rejected" && snapshot.reviewNote?.startsWith("system_direct_ingestion_blocked:") === true);
}

/**
 * Admission remains fail-closed for unsafe assets, but a successful gallery may
 * be partially ingested when at least one usable image was safely stored. Missing
 * assets remain explicit evidence gaps for later manual supplementation or refresh.
 */
export function directIngestionBlockReason(input: {
  requestedCapabilities: unknown;
  assets: AcquisitionAssetCandidate[];
}) {
  if (requestedImageGallery(input.requestedCapabilities)) {
    const hasGallery = input.assets.some(asset => (
      Boolean(asset.storageKey) && asset.fieldStatus === "pending_review"
        && (asset.role === "main" || asset.role === "secondary")
    ));
    if (!hasGallery) return "采集结果未包含可用主图或副图";
  }
  return null;
}

async function loadJobForSnapshot(db: DbExecutor, workspaceId: number, jobId: number) {
  const job = await getAcquisitionJob(db, workspaceId, jobId);
  if (!job) throw new Error("acquisition job not found");
  return job;
}

/**
 * The only Amazon Snapshot admission path. It retains the immutable raw
 * artifact, hash, evidence, and consumer link, but does not expose any
 * manual snapshot-review action. A failed precondition causes no projection.
 */
export async function confirmSnapshotForDirectIngestion(input: {
  workspaceId: number;
  snapshotId: number;
  requestedBy: number;
}) {
  return withDbTransaction("Directly ingest Amazon acquisition snapshot", async tx => {
    const snapshot = await getSourceSnapshot(tx, input.workspaceId, input.snapshotId);
    if (!snapshot) throw new Error("snapshot not found");
    if (!isRecoverableDirectIngestionSnapshot(snapshot)) throw new Error("snapshot cannot be directly ingested");
    const job = await loadJobForSnapshot(tx, input.workspaceId, snapshot.jobId);
    const assets = await listAssetCandidates(tx, input.workspaceId, snapshot.id) as AcquisitionAssetCandidate[];
    const reason = directIngestionBlockReason({ requestedCapabilities: job.requestedCapabilities, assets });
    if (reason) throw new Error(`直接录入已安全关闭：${reason}`);

    const approvedAssets = assets.filter(asset => Boolean(asset.storageKey) && asset.fieldStatus === "pending_review");
    for (const asset of approvedAssets) {
      await updateAssetCandidateReview({
        db: tx,
        workspaceId: input.workspaceId,
        snapshotId: snapshot.id,
        assetId: asset.id,
        reviewStatus: "approved",
        reviewedBy: input.requestedBy,
      });
    }
    const confirmedData = NormalizedAmazonSnapshotSchema.parse(
      readAcquisitionSnapshotJsonField(snapshot, "normalizedData", "normalized_data"),
    );
    const confirmedFieldStatuses = confirmSnapshotFieldStatuses(
      readAcquisitionSnapshotJsonField(snapshot, "fieldStatuses", "field_statuses") ?? confirmedData.fieldEvidence,
    );
    const confirmationVersion = await nextConfirmationVersion(tx, snapshot.id);
    const contentHash = sha256({ confirmedData, approvedAssetIds: approvedAssets.map(asset => asset.id) });
    await clearCurrentConfirmedSnapshot(tx, input.workspaceId, snapshot.marketplace, snapshot.asin);
    const confirmedSnapshotId = await createConfirmedSnapshot(tx, {
      workspaceId: input.workspaceId,
      snapshotId: snapshot.id,
      revisionId: null,
      marketplace: snapshot.marketplace,
      asin: snapshot.asin,
      confirmationVersion,
      contentHash,
      confirmedData,
      fieldStatuses: confirmedFieldStatuses,
      confirmedAssetIds: approvedAssets.map(asset => asset.id),
      isCurrent: 1,
      confirmedBy: input.requestedBy,
    });
    const projection = await activateConfirmedSnapshotForConsumer({
      db: tx,
      workspaceId: input.workspaceId,
      confirmedSnapshotId,
      job,
      activatedBy: input.requestedBy,
    });
    const missingAssetCount = assets.length - approvedAssets.length;
    await updateSourceSnapshot(tx, input.workspaceId, snapshot.id, {
      status: "confirmed",
      reviewedBy: input.requestedBy,
      reviewedAt: new Date(),
      reviewNote: missingAssetCount > 0
        ? `system_partial_direct_ingestion: ${approvedAssets.length} safely stored, ${missingAssetCount} unavailable; manual upload or governed refresh may supplement missing assets`
        : "system_direct_ingestion: provider completed, normalized data passed, and every returned asset was safely stored",
    });
    await updateAcquisitionJob(tx, input.workspaceId, job.id, { status: "confirmed", completedAt: new Date() });
    return {
      snapshotId: snapshot.id,
      confirmedSnapshotId,
      confirmationVersion,
      confirmedAssetCount: approvedAssets.length,
      missingAssetCount,
      partialIngestion: missingAssetCount > 0,
      projection,
      directIngestion: true as const,
    };
  });
}
