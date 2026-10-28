import { assertNoCollectionRepair } from "./collectionRepairState";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import sharp, { type Metadata } from "sharp";
import {
  acquisitionAssetCandidates,
  type AcquisitionAssetCandidate,
} from "../../../drizzle/schema/acquisition";
import {
  requireDb,
  withDbTransaction,
  type DbExecutor,
} from "../../repositories/dbClient";
import { storagePut } from "../../storage";
import { detectImageMeta } from "./assetIngestion";
import {
  getAcquisitionJob,
  getSourceSnapshotByJob,
  listAssetCandidates,
} from "./repository";
import { confirmSnapshotForDirectIngestion } from "./snapshotReview";
import { triggerConsumerPostConfirmation } from "./postConfirmation";

type Scope = { workspaceId: number; userId: number; jobId: number };
export async function readPendingKnowledgeImages(
  db: DbExecutor,
  scope: Scope,
  allowConfirmed = false
) {
  const job = await getAcquisitionJob(db, scope.workspaceId, scope.jobId);
  if (
    !job ||
    job.deletedAt ||
    job.consumerType !== "kb_images" ||
    job.requestedBy !== scope.userId
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "采集任务不存在或不可访问",
    });
  const snapshot = await getSourceSnapshotByJob(db, scope.workspaceId, job.id);
  if (
    !snapshot ||
    !(
      (job.status === "review_required" &&
        snapshot.status === "pending_review") ||
      (allowConfirmed &&
        job.status === "confirmed" &&
        snapshot.status === "confirmed")
    ) ||
    job.cacheExpiredAt
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "任务状态已变化，请刷新采集情况",
    });
  await assertNoCollectionRepair(db, scope);
  return {
    job,
    snapshot,
    assets: (await listAssetCandidates(
      db,
      scope.workspaceId,
      snapshot.id
    )) as AcquisitionAssetCandidate[],
  };
}

/** Replace a missing source slot, preserving its module/role/hash; never append an unrelated KB image. */
export async function supplementPendingKnowledgeImage(
  scope: Scope,
  assetId: number,
  base64: string
) {
  const db = await requireDb("supplement missing collection image");
  const before = await readPendingKnowledgeImages(db, scope, true);
  const target = before.assets.find(
    asset => asset.id === assetId && asset.role !== "video" && !asset.storageKey
  );
  if (!target)
    throw new TRPCError({
      code: "CONFLICT",
      message: "这张图片已补齐或不存在，请刷新",
    });
  if (
    !base64 ||
    base64.length > 11_184_812 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "请选择 8MB 以内的图片",
    });
  const bytes = Buffer.from(base64, "base64");
  const meta = detectImageMeta(bytes, null);
  if (
    !meta ||
    bytes.length > 8 * 1024 * 1024 ||
    bytes.toString("base64") !== base64
  )
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "图片格式无效，请使用 JPG、PNG、WebP 或 GIF",
    });
  let decoded: Metadata, thumb: Buffer;
  try {
    decoded = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata();
    if (!decoded.width || !decoded.height) throw new Error("dimensions");
    thumb = await sharp(bytes, { limitInputPixels: 40_000_000 })
      .rotate()
      .resize({
        width: 480,
        height: 480,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: 72 })
      .toBuffer();
  } catch {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "图片无法解码或尺寸过大，请重新导出后上传",
    });
  }
  const hash = createHash("sha256").update(bytes).digest("hex");
  const key = `acquisition/${scope.workspaceId}/snapshots/${before.snapshot.id}/manual/${assetId}-${hash}.${meta.extension}`;
  // This short transaction shares the same job lock as admission. It cannot publish while an upload is in flight.
  const result = await withDbTransaction(
    "supplement pending knowledge image",
    async tx => {
      await tx.execute(
        sql`SELECT id FROM acquisition_jobs WHERE workspace_id=${scope.workspaceId} AND id=${scope.jobId} FOR UPDATE`
      );
      const current = await readPendingKnowledgeImages(tx, scope, true);
      const asset = current.assets.find(item => item.id === assetId);
      if (
        current.snapshot.id !== before.snapshot.id ||
        current.job.status !== before.job.status ||
        !asset ||
        asset.storageKey
      )
        throw new TRPCError({
          code: "CONFLICT",
          message: "图片已被补齐，请刷新后查看",
        });
      const stored = await storagePut(key, bytes, meta.contentType);
      const preview = await storagePut(
        `${key}.thumb.webp`,
        thumb,
        "image/webp"
      );
      await tx
        .update(acquisitionAssetCandidates)
        .set({
          storageKey: stored.storageUri,
          thumbnailStorageKey: preview.storageUri,
          contentHash: hash,
          contentType: meta.contentType,
          sizeBytes: bytes.length,
          width: decoded.width,
          height: decoded.height,
          fieldStatus: "pending_review",
          reviewStatus: "pending",
          reviewedBy: scope.userId,
          reviewedAt: new Date(),
        })
        .where(
          and(
            eq(acquisitionAssetCandidates.id, assetId),
            eq(acquisitionAssetCandidates.workspaceId, scope.workspaceId),
            eq(acquisitionAssetCandidates.snapshotId, current.snapshot.id)
          )
        );
      return { saved: true };
    },
    { required: true }
  );
  if (before.job.status === "confirmed") {
    const confirmed = await confirmSnapshotForDirectIngestion({
      workspaceId: scope.workspaceId,
      snapshotId: before.snapshot.id,
      requestedBy: scope.userId,
      repairedAssetIds: [assetId],
    });
    await triggerConsumerPostConfirmation(confirmed.projection);
  }
  return result;
}

export async function confirmPendingKnowledgeImages(scope: Scope) {
  const current = await readPendingKnowledgeImages(
    await requireDb("confirm supplemented collection"),
    scope
  );
  const result = await confirmSnapshotForDirectIngestion({
    workspaceId: scope.workspaceId,
    snapshotId: current.snapshot.id,
    requestedBy: scope.userId,
    expectedPendingJobId: scope.jobId,
  });
  const tagging = await triggerConsumerPostConfirmation(result.projection);
  return { ...result, ...tagging };
}
