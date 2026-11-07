import {
  competitorVideoAnalysisSchema,
  videoSourceFingerprint,
} from "../../../shared/competitorVideoAnalysis";
import { createHash } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { workspaces } from "../../../drizzle/schema/auth";
import {
  acquisitionConfirmedSnapshots,
  acquisitionAssetCandidates,
  type AcquisitionAssetCandidate,
} from "../../../drizzle/schema/acquisition";
import { kbImages } from "../../../drizzle/schema/image";
import { kbVideos } from "../../../drizzle/schema/knowledge";
import {
  withDbTransaction,
  type DbExecutor,
} from "../../repositories/dbClient";
import {
  brandBackgroundHashes,
  savedImageTranslation,
  RichContentPresentationSchema,
  type ImageTranslation,
} from "../../../shared/richContentPresentation";
import { enqueueStandaloneTags } from "../knowledge/standaloneImages";
import { enqueueVideoTags } from "../knowledge/videoTagging";
import { enqueuePretranslation } from "../knowledge/pretranslationJob";
import { videoObjectAllowed } from "../knowledge/videoLibrary";

const isImage = (a: { role: string }) =>
  ["main", "secondary", "aplus", "brand_story"].includes(a.role);
export function selectConfirmedCompetitorAsset(
  input: { kind: "image" | "video"; hash: string },
  approvedIds: unknown,
  assets: AcquisitionAssetCandidate[]
) {
  const approved = new Set(Array.isArray(approvedIds) ? approvedIds : []);
  const asset = assets.find(
    a =>
      a.sourceUrlHash === input.hash &&
      approved.has(a.id) &&
      a.reviewStatus === "approved" &&
      a.storageKey &&
      (input.kind === "video"
        ? a.role === "video" && a.thumbnailStorageKey
        : isImage(a))
  );
  if (!asset)
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "该素材尚未完整保存，或采集资料已更新，请刷新后重试",
    });
  return asset;
}
/** The route verifies the owned project. This function only accepts its current confirmed snapshot. */
export async function importCompetitorAsset(input: {
  workspaceId: number;
  userId: number;
  role?: string;
  asin: string;
  snapshotId: number;
  kind: "image" | "video";
  hash: string;
  title?: string | null;
  presentation?: unknown;
  videoAnalysis?: unknown;
  videoProcessing?: unknown;
}) {
  const result = await withDbTransaction(
    "Import one independent competitor asset",
    tx => importConfirmedCompetitorAsset(input, tx),
    { required: true }
  );
  let taggingStatus: string | null = null;
  if (!result.background) {
    if (result.needsTags)
      try {
        if (result.kind === "video") await enqueueVideoTags(input, result.id);
        else await enqueueStandaloneTags(input, result.id);
        taggingStatus = "queued";
      } catch {
        taggingStatus = "failed_to_queue";
      }
    if (result.kind === "image")
      try {
        await enqueuePretranslation({ ...input, kind: "image", id: result.id });
      } catch {
        console.warn(
          "[Knowledge] Imported image translation could not be queued"
        );
      }
  }
  return {
    ...result,
    taggingStatus,
    imageSetId: null,
    imageId: result.kind === "image" ? result.id : null,
    videoId: result.kind === "video" ? result.id : null,
  };
}

/** Transactional import shared by normal execution and rollback-only verification. Caller must verify the owned project. */
export async function importConfirmedCompetitorAsset(
  input: Parameters<typeof importCompetitorAsset>[0],
  tx: DbExecutor
) {
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .for("update");
  if (!workspace)
    throw new TRPCError({ code: "NOT_FOUND", message: "当前工作区不可用" });
  const [snapshot] = await tx
    .select()
    .from(acquisitionConfirmedSnapshots)
    .where(
      and(
        eq(acquisitionConfirmedSnapshots.id, input.snapshotId),
        eq(acquisitionConfirmedSnapshots.workspaceId, input.workspaceId)
      )
    )
    .limit(1);
  if (
    !snapshot ||
    snapshot.asin !== input.asin ||
    snapshot.marketplace !== "US" ||
    snapshot.isCurrent !== 1 ||
    snapshot.revisionId !== null
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "竞品资料已更新，请刷新后再入库",
    });
  const assets: AcquisitionAssetCandidate[] = await tx
    .select()
    .from(acquisitionAssetCandidates)
    .where(
      and(
        eq(acquisitionAssetCandidates.snapshotId, snapshot.snapshotId),
        eq(acquisitionAssetCandidates.workspaceId, input.workspaceId)
      )
    );
  const asset = selectConfirmedCompetitorAsset(
      input,
      snapshot.confirmedAssetIds,
      assets
    ),
    identity =
      asset.contentHash ||
      createHash("sha256").update(asset.storageKey!).digest("hex");
  if (input.kind === "image") {
    const [existing] = await tx
      .select()
      .from(kbImages)
      .where(
        and(
          eq(kbImages.workspaceId, input.workspaceId),
          eq(kbImages.userId, input.userId),
          eq(kbImages.uploadHash, identity),
          isNull(kbImages.imageSetId)
        )
      )
      .limit(1);
    if (existing?.recycleId)
      throw new TRPCError({
        code: "CONFLICT",
        message: "这张图片在回收站中，请先恢复后再使用",
      });
    if (existing)
      return {
        kind: "image" as const,
        id: existing.id,
        duplicate: true,
        background: existing.imageTranslation?.status === "excluded_background",
        needsTags:
          ["pending", "failed"].includes(existing.labelStatus) &&
          !existing.tagsConfirmed &&
          !existing.analysisConfirmed,
      };
    const data = snapshot.confirmedData as { sourceLayout?: unknown },
      background = brandBackgroundHashes(data?.sourceLayout).has(
        asset.sourceUrlHash
      ),
      prepared = RichContentPresentationSchema.safeParse(input.presentation);
    const found = prepared.success
      ? savedImageTranslation(
          prepared.data.images.find(i => i.sourceHash === asset.sourceUrlHash),
          asset.sourceUrlHash
        )
      : undefined;
    const translation: ImageTranslation | null = background
      ? {
          version: 1,
          sourceHash: asset.sourceUrlHash,
          status: "excluded_background",
          regions: [],
          notes: "",
        }
      : found && (!asset.contentHash || found.contentHash === asset.contentHash)
        ? found
        : null;
    const [created] = await tx
      .insert(kbImages)
      .values({
        imageSetId: null,
        userId: input.userId,
        workspaceId: input.workspaceId,
        uploadTitle: (input.title || "竞品图片").slice(0, 512),
        uploadHash: identity,
        visibility: "team",
        sourceUrlHash: asset.sourceUrlHash,
        imageUrl: asset.storageKey!,
        thumbnailUrl: asset.thumbnailStorageKey,
        imagePosition: asset.role as
          | "main"
          | "secondary"
          | "aplus"
          | "brand_story",
        imageTranslation: translation,
        aplusModuleType: background ? "品牌背景" : asset.moduleType,
        labelStatus: background ? "complete" : "pending",
      })
      .$returningId();
    return {
      kind: "image" as const,
      id: Number(created.id),
      duplicate: false,
      background,
      needsTags: !background,
    };
  }
  if (
    !videoObjectAllowed(asset.storageKey, {
      workspaceId: input.workspaceId,
      userId: input.userId,
    }) ||
    !videoObjectAllowed(
      asset.thumbnailStorageKey,
      { workspaceId: input.workspaceId, userId: input.userId },
      true
    )
  )
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "视频原件尚未完整保存",
    });
  const sourceKey = `independent:${input.userId}:${identity}`;
  const [existing] = await tx
    .select()
    .from(kbVideos)
    .where(
      and(
        eq(kbVideos.workspaceId, input.workspaceId),
        eq(kbVideos.userId, input.userId),
        eq(kbVideos.sourceKey, sourceKey),
        isNull(kbVideos.imageSetId)
      )
    )
    .limit(1);
  if (existing?.recycleId)
    throw new TRPCError({
      code: "CONFLICT",
      message: "这个视频在回收站中，请先恢复后再使用",
    });
  if (existing)
    return {
      kind: "video" as const,
      id: existing.id,
      duplicate: true,
      background: false,
      needsTags: ["unlabeled", "failed"].includes(existing.labelStatus),
    };
  const data = snapshot.confirmedData as {
      videos?: Array<{
        hash: string;
        title: string;
        duration: number | null;
        role: "main" | "aplus";
      }>;
    },
    reference = data?.videos?.find(v => v.hash === asset.sourceUrlHash);
  const supplied = competitorVideoAnalysisSchema.safeParse(input.videoAnalysis);
  const videoAnalysis =
    supplied.success &&
    supplied.data.hash === asset.sourceUrlHash &&
    [
      videoSourceFingerprint(
        asset.sourceUrlHash,
        asset.storageKey!,
        asset.contentHash
      ),
      videoSourceFingerprint(asset.sourceUrlHash, asset.storageKey!),
    ].includes(supplied.data.sourceHash)
      ? supplied.data
      : undefined;
  const checkpoint =
    input.videoProcessing && typeof input.videoProcessing === "object"
      ? (input.videoProcessing as any)
      : null;
  const processing = videoAnalysis
    ? {
        competitorPresentation: videoAnalysis,
        ...(checkpoint?.speechState === "complete" &&
        typeof checkpoint.transcript === "string" &&
        Array.isArray(checkpoint.sentences)
          ? {
              speechState: "complete",
              transcript: checkpoint.transcript,
              sentences: checkpoint.sentences,
            }
          : {}),
      }
    : undefined;
  const [created] = await tx
    .insert(kbVideos)
    .values({
      userId: input.userId,
      workspaceId: input.workspaceId,
      imageSetId: null,
      asin: null,
      moduleId: null,
      sourceKey,
      sourceHash: asset.sourceUrlHash,
      videoUrl: asset.storageKey!,
      thumbnailUrl: asset.thumbnailStorageKey,
      videoTitle: (reference?.title || input.title || "竞品视频").slice(0, 512),
      duration: reference?.duration ? Math.ceil(reference.duration) : null,
      videoRole: reference?.role || null,
      status: "confirmed",
      visibility: "team",
      originInstanceId: "knowledge_video_v1",
      labelStatus: "unlabeled",
      ...(processing ? { processing } : {}),
    })
    .$returningId();
  return {
    kind: "video" as const,
    id: Number(created.id),
    duplicate: false,
    background: false,
    needsTags: true,
  };
}
