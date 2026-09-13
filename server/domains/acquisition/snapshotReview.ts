import { createHash } from "node:crypto";
import { z } from "zod";
import { NormalizedAmazonSnapshotSchema } from "./contracts";
import { requireDb, withDbTransaction, type DbExecutor } from "../../repositories/dbClient";
import { resolveStoredObjectUrl } from "../../storage";
import {
  clearCurrentConfirmedSnapshot,
  createConfirmedSnapshot,
  createConsumerLink,
  createSnapshotRevision,
  getAcquisitionJob,
  getLatestSnapshotRevision,
  getSourceSnapshot,
  getSourceSnapshotByJob,
  listAssetCandidates,
  nextConfirmationVersion,
  nextSnapshotRevisionVersion,
  supersedeConsumerLinks,
  updateAcquisitionJob,
  updateAssetCandidateReview,
  updateSourceSnapshot,
} from "./repository";

export const SnapshotPatchSchema = z.object({
  title: z.string().trim().max(1000).nullable().optional(),
  brand: z.string().trim().max(255).nullable().optional(),
  category: z.string().trim().max(1000).nullable().optional(),
  description: z.string().trim().max(20_000).nullable().optional(),
  bulletPoints: z.array(z.string().trim().max(3000)).max(20).optional(),
  price: z.object({ value: z.string(), currency: z.string().length(3) }).nullable().optional(),
  rating: z.string().nullable().optional(),
  reviewCount: z.number().int().nonnegative().nullable().optional(),
  variantAsins: z.array(z.string().regex(/^[A-Z0-9]{10}$/)).max(200).optional(),
}).strict();

export const SnapshotAssetReviewSchema = z.array(z.object({
  assetId: z.number().int().positive(),
  reviewStatus: z.enum(["approved", "rejected"]),
})).max(300);

function sha256(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function getSnapshotReview(workspaceId: number, snapshotId: number) {
  const db = await requireDb("Amazon acquisition snapshot review");
  const snapshot = await getSourceSnapshot(db, workspaceId, snapshotId);
  if (!snapshot) return null;
  const [assets, revision] = await Promise.all([
    listAssetCandidates(db, workspaceId, snapshotId),
    getLatestSnapshotRevision(db, workspaceId, snapshotId),
  ]);
  return {
    snapshot: {
      id: snapshot.id,
      jobId: snapshot.jobId,
      marketplace: snapshot.marketplace,
      asin: snapshot.asin,
      status: snapshot.status,
      normalizedData: snapshot.normalizedData,
      fieldStatuses: snapshot.fieldStatuses,
      completeness: snapshot.completeness,
      reviewNote: snapshot.reviewNote,
      createdAt: snapshot.createdAt,
    },
    revision: revision ? { id: revision.id, version: revision.version, patch: revision.patch, reasonCode: revision.reasonCode } : null,
    assets: await Promise.all(assets.map(async asset => ({
      id: asset.id,
      role: asset.role,
      positionIndex: asset.positionIndex,
      fieldStatus: asset.fieldStatus,
      reviewStatus: asset.reviewStatus,
      width: asset.width,
      height: asset.height,
      contentType: asset.contentType,
      previewUrl: asset.storageKey ? await resolveStoredObjectUrl(asset.storageKey) : null,
      internalResearchOnly: true,
    }))),
  };
}

export async function saveSnapshotReview(input: {
  workspaceId: number;
  snapshotId: number;
  userId: number;
  patch: z.infer<typeof SnapshotPatchSchema>;
  assetReviews: z.infer<typeof SnapshotAssetReviewSchema>;
  note?: string | null;
}) {
  const patch = SnapshotPatchSchema.parse(input.patch);
  const assetReviews = SnapshotAssetReviewSchema.parse(input.assetReviews);
  return withDbTransaction("Save Amazon acquisition snapshot review", async tx => {
    const snapshot = await getSourceSnapshot(tx, input.workspaceId, input.snapshotId);
    if (!snapshot) throw new Error("snapshot not found");
    if (!["draft", "pending_review"].includes(snapshot.status)) throw new Error("snapshot is not editable");
    const assets = await listAssetCandidates(tx, input.workspaceId, input.snapshotId);
    const knownAssets = new Map(assets.map(item => [item.id, item]));
    if (assetReviews.some(item => !knownAssets.has(item.assetId))) throw new Error("asset does not belong to snapshot");
    if (assetReviews.some(item => item.reviewStatus === "approved" && !knownAssets.get(item.assetId)?.storageKey)) {
      throw new Error("asset without stored evidence cannot be approved");
    }
    const version = await nextSnapshotRevisionVersion(tx, snapshot.id);
    const revisionHash = sha256({ patch, assetReviews, version });
    const revisionId = await createSnapshotRevision(tx, {
      workspaceId: input.workspaceId,
      snapshotId: snapshot.id,
      version,
      baseContentHash: snapshot.sourceHash,
      patch,
      revisionHash,
      reasonCode: "human_review",
      note: input.note?.trim().slice(0, 2000) || null,
      createdBy: input.userId,
    });
    for (const review of assetReviews) {
      await updateAssetCandidateReview({ db: tx, workspaceId: input.workspaceId, snapshotId: snapshot.id, assetId: review.assetId, reviewStatus: review.reviewStatus, reviewedBy: input.userId });
    }
    await updateSourceSnapshot(tx, input.workspaceId, snapshot.id, { status: "pending_review", reviewNote: input.note?.trim().slice(0, 2000) || null });
    await updateAcquisitionJob(tx, input.workspaceId, snapshot.jobId, { status: "review_required" });
    return { snapshotId: snapshot.id, revisionId, version, status: "pending_review" as const };
  });
}

export function applySnapshotPatch(base: unknown, patch: unknown) {
  const baseSnapshot = NormalizedAmazonSnapshotSchema.parse(base);
  const parsedPatch = SnapshotPatchSchema.parse(patch || {});
  return NormalizedAmazonSnapshotSchema.parse({ ...baseSnapshot, ...parsedPatch });
}

export function confirmSnapshotFieldStatuses(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, evidence]) => {
    if (!evidence || typeof evidence !== "object" || Array.isArray(evidence)) return [key, evidence];
    const record = evidence as Record<string, unknown>;
    return [key, record.status === "pending_review"
      ? { ...record, status: "confirmed", noteCode: "human_confirmed" }
      : record];
  }));
}

async function loadJobForSnapshot(db: DbExecutor, workspaceId: number, jobId: number) {
  const job = await getAcquisitionJob(db, workspaceId, jobId);
  if (!job) throw new Error("acquisition job not found");
  return job;
}

export async function confirmSnapshot(input: { workspaceId: number; snapshotId: number; userId: number; note?: string | null }) {
  return withDbTransaction("Confirm Amazon acquisition snapshot", async tx => {
    const snapshot = await getSourceSnapshot(tx, input.workspaceId, input.snapshotId);
    if (!snapshot) throw new Error("snapshot not found");
    if (!["draft", "pending_review"].includes(snapshot.status)) throw new Error("snapshot cannot be confirmed");
    const assets = await listAssetCandidates(tx, input.workspaceId, snapshot.id);
    if (assets.some(asset => asset.reviewStatus === "pending")) throw new Error("all assets must be reviewed before confirmation");
    const approvedAssets = assets.filter(asset => asset.reviewStatus === "approved" && asset.storageKey);
    if (!approvedAssets.some(asset => asset.role === "main" || asset.role === "secondary")) {
      throw new Error("at least one approved gallery asset is required");
    }
    const revision = await getLatestSnapshotRevision(tx, input.workspaceId, snapshot.id);
    const confirmedData = applySnapshotPatch(snapshot.normalizedData, revision?.patch || {});
    const confirmedFieldStatuses = confirmSnapshotFieldStatuses(snapshot.fieldStatuses);
    const confirmationVersion = await nextConfirmationVersion(tx, snapshot.id);
    const contentHash = sha256({ confirmedData, approvedAssetIds: approvedAssets.map(asset => asset.id) });
    await clearCurrentConfirmedSnapshot(tx, input.workspaceId, snapshot.marketplace, snapshot.asin);
    const confirmedSnapshotId = await createConfirmedSnapshot(tx, {
      workspaceId: input.workspaceId,
      snapshotId: snapshot.id,
      revisionId: revision?.id ?? null,
      marketplace: snapshot.marketplace,
      asin: snapshot.asin,
      confirmationVersion,
      contentHash,
      confirmedData,
      fieldStatuses: confirmedFieldStatuses,
      confirmedAssetIds: approvedAssets.map(asset => asset.id),
      isCurrent: 1,
      confirmedBy: input.userId,
    });
    const job = await loadJobForSnapshot(tx, input.workspaceId, snapshot.jobId);
    const capabilities = Array.isArray(job.requestedCapabilities) ? job.requestedCapabilities.map(String) : [];
    for (const capability of capabilities) {
      await supersedeConsumerLinks({ db: tx, workspaceId: input.workspaceId, consumerType: job.consumerType, consumerRef: job.consumerRef, capabilityScope: capability });
      await createConsumerLink(tx, {
        workspaceId: input.workspaceId,
        confirmedSnapshotId,
        consumerType: job.consumerType,
        consumerRef: job.consumerRef,
        capabilityScope: capability,
        projectionVersion: "amazon_snapshot_projection_v1",
        status: "active",
        createdBy: input.userId,
      });
    }
    await updateSourceSnapshot(tx, input.workspaceId, snapshot.id, {
      status: "confirmed",
      reviewedBy: input.userId,
      reviewedAt: new Date(),
      reviewNote: input.note?.trim().slice(0, 2000) || snapshot.reviewNote,
    });
    await updateAcquisitionJob(tx, input.workspaceId, job.id, { status: "confirmed", completedAt: new Date() });
    return { snapshotId: snapshot.id, confirmedSnapshotId, confirmationVersion, confirmedAssetCount: approvedAssets.length };
  });
}

export async function rejectSnapshot(input: { workspaceId: number; snapshotId: number; userId: number; note: string }) {
  return withDbTransaction("Reject Amazon acquisition snapshot", async tx => {
    const snapshot = await getSourceSnapshot(tx, input.workspaceId, input.snapshotId);
    if (!snapshot) throw new Error("snapshot not found");
    if (!["draft", "pending_review"].includes(snapshot.status)) throw new Error("snapshot cannot be rejected");
    await updateSourceSnapshot(tx, input.workspaceId, snapshot.id, {
      status: "rejected",
      reviewedBy: input.userId,
      reviewedAt: new Date(),
      reviewNote: input.note.trim().slice(0, 2000),
    });
    await updateAcquisitionJob(tx, input.workspaceId, snapshot.jobId, { status: "failed", completedAt: new Date() });
    return { snapshotId: snapshot.id, status: "rejected" as const };
  });
}

export async function getLatestSnapshotIdForJob(workspaceId: number, jobId: number) {
  const db = await requireDb("Amazon acquisition job snapshot");
  const snapshot = await getSourceSnapshotByJob(db, workspaceId, jobId);
  return snapshot?.id ?? null;
}
