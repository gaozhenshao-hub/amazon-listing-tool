import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { workspaces } from "../../../drizzle/schema/auth";
import {
  acquisitionConfirmedSnapshots,
  acquisitionAssetCandidates,
  acquisitionJobs,
} from "../../../drizzle/schema/acquisition";
import { kbImageSets, kbImages } from "../../../drizzle/schema/image";
import {
  imageLibraryLayout,
  presentationForImages,
} from "../../../shared/knowledgeImagePresentation";
import {
  withDbTransaction,
  type DbExecutor,
} from "../../repositories/dbClient";
import { activateConfirmedSnapshotForConsumer } from "./consumerActivation";
import { triggerConsumerPostConfirmation } from "./postConfirmation";
import { KB_IMAGE_IMPORT_CAPABILITIES } from "./kbImagesAcquisition";
import {
  knowledgeCollectionRef,
  knowledgeStoredVersion,
} from "../../../shared/knowledgeCollection";

/** Copy an already confirmed competitor snapshot only after an explicit user action. */
export async function importCompetitorToKnowledge(input: {
  workspaceId: number;
  userId: number;
  asin: string;
  snapshotId: number;
  presentation?: unknown;
}) {
  const projection = await withDbTransaction(
    "Import competitor into knowledge",
    tx => importConfirmedCompetitorImageSet(input, tx),
    { required: true }
  );
  const result = await triggerConsumerPostConfirmation(projection);
  return {
    imageSetId: projection.imageSetId,
    taggingStatus: result.analysisJobStatus,
  };
}

/** Same validated image-set projection, without queue side effects. Caller verifies the owned project. */
export async function importConfirmedCompetitorImageSet(
  input: Parameters<typeof importCompetitorToKnowledge>[0],
  tx: DbExecutor
) {
  // Same workspace lock as normal knowledge collection: prevents concurrent duplicate imports.
  const [workspace] = await tx
    .select({ id: workspaces.id })
    .from(workspaces)
    .where(eq(workspaces.id, input.workspaceId))
    .for("update");
  if (!workspace)
    throw new TRPCError({ code: "NOT_FOUND", message: "当前工作区不可用" });
  const existing: Array<{
    id: number;
    asin: string;
    version: number;
    recycleId: string | null;
  }> = await tx
    .select({
      id: kbImageSets.id,
      asin: kbImageSets.asin,
      version: kbImageSets.collectionVersion,
      recycleId: kbImageSets.recycleId,
    })
    .from(kbImageSets)
    .where(
      and(
        eq(kbImageSets.workspaceId, input.workspaceId),
        sql`(UPPER(TRIM(${kbImageSets.sourceAsin}))=${input.asin} OR RIGHT(UPPER(TRIM(${kbImageSets.asin})),10)=${input.asin})`
      )
    );
  if (existing.some(set => !set.recycleId))
    throw new TRPCError({
      code: "CONFLICT",
      message: "该 ASIN 已存在于图片知识库中",
    });
  // Recycled copies remain recoverable; a later explicit import gets a new version.
  const version = existing.length
    ? Math.max(
        ...existing.map(set => knowledgeStoredVersion(set.asin, set.version))
      ) + 1
    : 1;
  const [pending] = await tx
    .select({ id: acquisitionJobs.id })
    .from(acquisitionJobs)
    .where(
      and(
        eq(acquisitionJobs.workspaceId, input.workspaceId),
        eq(acquisitionJobs.consumerType, "kb_images"),
        eq(acquisitionJobs.asin, input.asin),
        isNull(acquisitionJobs.deletedAt),
        inArray(acquisitionJobs.status, [
          "queued",
          "running",
          "review_required",
        ])
      )
    )
    .limit(1);
  if (pending)
    throw new TRPCError({
      code: "CONFLICT",
      message: "该 ASIN 正在采集或等待补录，请在采集页面查看",
    });
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
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "竞品采集资料已变化，请重新采集后再加入知识库",
    });
  }
  const approved = Array.isArray(snapshot.confirmedAssetIds)
    ? snapshot.confirmedAssetIds
    : [];
  const assets = await tx
    .select({
      id: acquisitionAssetCandidates.id,
      role: acquisitionAssetCandidates.role,
      storageKey: acquisitionAssetCandidates.storageKey,
      sourceUrlHash: acquisitionAssetCandidates.sourceUrlHash,
      contentHash: acquisitionAssetCandidates.contentHash,
    })
    .from(acquisitionAssetCandidates)
    .where(
      and(
        eq(acquisitionAssetCandidates.snapshotId, snapshot.snapshotId),
        eq(acquisitionAssetCandidates.workspaceId, input.workspaceId)
      )
    );
  const fields = snapshot.fieldStatuses as Record<
    string,
    { status?: string }
  > | null;
  if (
    fields?.imageGallery?.status !== "confirmed" ||
    !assets.some(
      (item: { id: number; role: string; storageKey: string | null }) =>
        item.role === "main" && approved.includes(item.id) && item.storageKey
    )
  ) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "竞品主图尚未完整保存，请先检查采集结果",
    });
  }
  const result = await activateConfirmedSnapshotForConsumer({
    db: tx,
    workspaceId: input.workspaceId,
    confirmedSnapshotId: input.snapshotId,
    activatedBy: input.userId,
    job: {
      requestedBy: input.userId,
      consumerType: "kb_images",
      consumerRef: knowledgeCollectionRef(input.asin, version),
      requestedCapabilities: [...KB_IMAGE_IMPORT_CAPABILITIES],
    },
    imagesOnly: true,
  });
  if (!result || result.consumerType !== "kb_images")
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "未能加入知识库，请稍后重试",
    });
  if (input.presentation) {
    const eligible = assets.filter(
      (a: { id: number; role: string; storageKey: string | null }) =>
        approved.includes(a.id) && a.storageKey && a.role !== "video"
    );
    const layout = imageLibraryLayout(
        (snapshot.confirmedData as { sourceLayout?: unknown })?.sourceLayout
      ),
      presentation = presentationForImages(
        input.presentation,
        layout,
        new Set(eligible.map((a: { sourceUrlHash: string }) => a.sourceUrlHash))
      );
    if (presentation) {
      presentation.images = presentation.images.filter(i =>
        eligible.some(
          (a: { sourceUrlHash: string; contentHash: string | null }) =>
            a.sourceUrlHash === i.sourceHash &&
            (!a.contentHash || a.contentHash === i.contentHash)
        )
      );
      await tx
        .update(kbImageSets)
        .set({ contentPresentation: presentation })
        .where(
          and(
            eq(kbImageSets.id, result.imageSetId),
            eq(kbImageSets.workspaceId, input.workspaceId)
          )
        );
      for (const translated of presentation.images)
        await tx
          .update(kbImages)
          .set({ imageTranslation: translated })
          .where(
            and(
              eq(kbImages.imageSetId, result.imageSetId),
              eq(kbImages.sourceUrlHash, translated.sourceHash),
              isNull(kbImages.recycleId)
            )
          );
    }
  }
  return result;
}
