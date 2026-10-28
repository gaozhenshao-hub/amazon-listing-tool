import { activeCollectionRepair } from "./collectionRepairState";
import { TRPCError } from "@trpc/server";
import { and, eq, isNull } from "drizzle-orm";
import { acquisitionAssetCandidates, acquisitionConfirmedSnapshots } from "../../../drizzle/schema/acquisition";
import { kbImageSets } from "../../../drizzle/schema/image";
import { requireDb } from "../../repositories/dbClient";
import { resolveStoredObjectUrl } from "../../storage";
import { getAcquisitionJob, getSourceSnapshot, getSourceSnapshotByJob, listAssetCandidates } from "./repository";
import { readAutomaticTaggingStatus } from "../knowledge/automaticTaggingStatus";
import { collectionFailureText } from "../../../shared/collectionFailure";

import { collectionDisplayAsin, knowledgeCollectionVersion } from "../../../shared/knowledgeCollection";

const object = (value: unknown): Record<string, any> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};

/** A small, read-only view for the collection screen; never return storage keys or raw artifacts. */
export async function readKnowledgeAcquisitionDetails(workspaceId: number, userId: number, jobId: number) {
  const db = await requireDb("image collection details");
  const job = await getAcquisitionJob(db, workspaceId, jobId);
  if (!job || job.deletedAt || job.consumerType !== "kb_images" || job.requestedBy !== userId) {
    throw new TRPCError({ code: "NOT_FOUND", message: "采集任务不存在或不可访问" });
  }
  let source = await getSourceSnapshotByJob(db, workspaceId, job.id);
  if (!source && job.cacheHitSnapshotId) {
    const [confirmed] = await db.select().from(acquisitionConfirmedSnapshots).where(and(
      eq(acquisitionConfirmedSnapshots.id, job.cacheHitSnapshotId), eq(acquisitionConfirmedSnapshots.workspaceId, workspaceId),
      eq(acquisitionConfirmedSnapshots.asin, job.asin), eq(acquisitionConfirmedSnapshots.marketplace, job.marketplace),
      isNull(acquisitionConfirmedSnapshots.revisionId),
    )).limit(1);
    if (confirmed) source = await getSourceSnapshot(db, workspaceId, confirmed.snapshotId);
  }
  const candidates: Array<typeof acquisitionAssetCandidates.$inferSelect> = source ? await listAssetCandidates(db, workspaceId, source.id) : [];
  const downloads = object(object(source?.completeness).assetIngestion);
  const results = new Map<number, Record<string, any>>((Array.isArray(downloads.results) ? downloads.results : []).map((row: any) => [row.assetId, object(row)]));
  const normalized = object(source?.normalizedData);
  const cacheExpired = Boolean(job.cacheExpiredAt);
  const assets = await Promise.all(candidates.map(async asset => {
    const result = results.get(asset.id);
    return { id: asset.id, role: asset.role, position: asset.positionIndex, label: asset.role === "video" ? asset.moduleType || "视频" : null,
      status: asset.storageKey && (asset.role !== "video" || asset.thumbnailStorageKey) ? "saved" as const : "failed" as const,
      manuallySupplemented: Boolean(asset.reviewedBy && asset.storageKey && !result?.stored),
      attempts: typeof result?.attempts === "number" ? result.attempts : null,
      failureReason: collectionFailureText(result?.failureReason),
      previewUrl: !cacheExpired && (asset.thumbnailStorageKey || (asset.role!=="video" && asset.storageKey)) ? await resolveStoredObjectUrl((asset.thumbnailStorageKey || asset.storageKey)!).catch(() => null) : null,
    };
  }));
  const total = typeof downloads.total === "number" ? downloads.total : Array.isArray(normalized.assets) ? normalized.assets.length : assets.length;
  const [imageSet] = await db.select({ id: kbImageSets.id, userId: kbImageSets.userId }).from(kbImageSets).where(and(
    eq(kbImageSets.workspaceId, workspaceId), isNull(kbImageSets.recycleId), job.ingestedSetId
      ? eq(kbImageSets.id, job.ingestedSetId)
      : eq(kbImageSets.asin, collectionDisplayAsin(job.asin, knowledgeCollectionVersion(job.consumerRef))),
  )).limit(1);
  return { jobId: job.id, asin: collectionDisplayAsin(job.asin, knowledgeCollectionVersion(job.consumerRef)), sourceAsin: job.asin, status: job.status, requestedAt: job.requestedAt, completedAt: job.completedAt,
    cacheExpiredAt: job.cacheExpiredAt ?? null,
    title: typeof normalized.title === "string" ? normalized.title : null,
    imageSetId: job.status === "confirmed" ? imageSet?.id ?? null : null,
    repair: await activeCollectionRepair(db,{workspaceId,userId,jobId}),
    acceptedMissing:job.acceptedMissing,
    canConfirm: job.status === "review_required" && source?.status === "pending_review" && assets.length > 0,
    tagging: job.status === "confirmed" && imageSet?.userId === userId ? await readAutomaticTaggingStatus(workspaceId, userId, imageSet.id) : null,
    canSupplement: !cacheExpired && !["queued", "running"].includes(job.status) && (!imageSet || imageSet.userId === userId),
    total, completed: assets.length, stored: assets.filter(asset => asset.status === "saved").length,
    failed: assets.filter(asset => asset.status === "failed").length,
    missingMainVideos: assets.filter(asset => asset.role === "video" && asset.status === "failed" && asset.label?.replaceAll(" ", "") === "主图视频").length,
    missingAplusVideos: assets.filter(asset => asset.role === "video" && asset.status === "failed" && asset.label?.replaceAll(" ", "") === "A+视频").length,
    retried: assets.filter(asset => (asset.attempts ?? 0) > 1).length,
    recovered: assets.filter(asset => (asset.attempts ?? 0) > 1 && asset.status === "saved" && !asset.manuallySupplemented).length,
    assets: cacheExpired ? [] : assets,
  };
}
