import {
  activeCollectionRepair,
  assertNoCollectionRepair,
  MISSING_REPAIR_KIND,
} from "./collectionRepairState";
import { TRPCError } from "@trpc/server";
import { and, eq, sql } from "drizzle-orm";
import { readFile } from "node:fs/promises";
import { z } from "zod";
import { aiJobs } from "../../../drizzle/schema/ai_os";
import {
  acquisitionAssetCandidates,
  acquisitionRawArtifacts,
  type AcquisitionAssetCandidate,
} from "../../../drizzle/schema/acquisition";
import {
  requireDb,
  withDbTransaction,
  type DbExecutor,
} from "../../repositories/dbClient";
import { parseStorageUri } from "../../storage";
import { verifiedLocalObjectPath } from "../../infrastructure/localObjectStorage";
import {
  registerAiJobHandler,
  updateAiJobProgress,
} from "../../services/aiJobRunner";
import {
  getAcquisitionJob,
  getSourceSnapshotByJob,
  listAssetCandidates,
  updateSourceSnapshot,
} from "./repository";
import {
  normalizeAmazonArtifact,
  type SourceAssetReference,
} from "./amazonNormalizer";
import {
  downloadImageAsset,
  summarizeAssetDownloads,
  type AssetDownloadResult,
} from "./assetIngestion";
import { downloadVideoAsset } from "./videoIngestion";
import { BasicAmazonImagesProvider } from "./basicAmazonProvider";
import { confirmSnapshotForDirectIngestion } from "./snapshotReview";
import { triggerConsumerPostConfirmation } from "./postConfirmation";

export { MISSING_REPAIR_KIND } from "./collectionRepairState";
export type CollectionScope = {
  workspaceId: number;
  userId: number;
  jobId: number;
};
export const assetIsMissing = (
  asset: Pick<
    AcquisitionAssetCandidate,
    "storageKey" | "thumbnailStorageKey" | "role"
  >
) =>
  !asset.storageKey || (asset.role === "video" && !asset.thumbnailStorageKey);

export async function readRepairableCollection(
  db: DbExecutor,
  scope: CollectionScope
) {
  const job = await getAcquisitionJob(db, scope.workspaceId, scope.jobId);
  if (
    !job ||
    job.deletedAt ||
    job.requestedBy !== scope.userId ||
    job.consumerType !== "kb_images"
  )
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "采集任务不存在或不可访问",
    });
  if (
    ["queued", "running", "canceled"].includes(job.status) ||
    job.cacheExpiredAt
  )
    throw new TRPCError({
      code: "CONFLICT",
      message: "任务正在采集或缓存已过期，请刷新采集情况",
    });
  const snapshot = await getSourceSnapshotByJob(db, scope.workspaceId, job.id);
  if (!snapshot || !["pending_review", "confirmed"].includes(snapshot.status))
    throw new TRPCError({
      code: "CONFLICT",
      message: "本任务未取得可补采的素材位置，请从采集入口重新提交 ASIN",
    });
  const assets = (await listAssetCandidates(
    db,
    scope.workspaceId,
    snapshot.id
  )) as AcquisitionAssetCandidate[];
  return { job, snapshot, assets };
}
export async function enqueueMissingAssetRepair(
  scope: CollectionScope,
  requestId: string,
  assetId?: number
) {
  return withDbTransaction(
    "queue only missing collection slots",
    async tx => {
      await tx.execute(
        sql`SELECT id FROM acquisition_jobs WHERE workspace_id=${scope.workspaceId} AND id=${scope.jobId} FOR UPDATE`
      );
      const current = await readRepairableCollection(tx, scope),
        active = await activeCollectionRepair(tx, scope);
      if (active) return { runId: active.runId, existing: true, count: 0 };
      const missing = current.assets.filter(
        asset => assetIsMissing(asset) && (!assetId || asset.id === assetId)
      );
      if (!missing.length) return { runId: null, existing: false, count: 0 };
      const runId = `kb-repair-${scope.jobId}-${requestId}`;
      const [existing] = await tx
        .select({ runId: aiJobs.runId })
        .from(aiJobs)
        .where(eq(aiJobs.runId, runId))
        .limit(1);
      if (existing) return { runId, existing: true, count: missing.length };
      await tx
        .insert(aiJobs)
        .values({
          runId,
          workspaceId: scope.workspaceId,
          userId: scope.userId,
          kind: MISSING_REPAIR_KIND,
          module: "knowledge",
          procedure: "acquisition.repairMissing",
          queueName: "amazon_acquisition",
          status: "queued",
          maxAttempts: 1,
          timeoutSeconds: 3600,
          input: {
            jobId: scope.jobId,
            snapshotId: current.snapshot.id,
            assetIds: missing.map(a => a.id),
          },
        });
      return { runId, existing: false, count: missing.length };
    },
    { required: true }
  );
}
async function originalSources(
  db: DbExecutor,
  current: Awaited<ReturnType<typeof readRepairableCollection>>
) {
  const [raw] = await db
    .select()
    .from(acquisitionRawArtifacts)
    .where(
      and(
        eq(acquisitionRawArtifacts.id, current.snapshot.rawArtifactId),
        eq(acquisitionRawArtifacts.workspaceId, current.job.workspaceId)
      )
    )
    .limit(1);
  const ref = parseStorageUri(raw?.storageKey || "");
  if (ref?.provider !== "local")
    throw new Error("原始采集记录不可用，请刷新页面后重试");
  const bytes = await readFile(await verifiedLocalObjectPath(ref.key));
  return normalizeAmazonArtifact({
    bytes,
    expectedAsin: current.job.asin,
    marketplace: "US",
  }).sourceAssets;
}
/** Never replace a slot by matching only its position: a changed Amazon page may reorder products. */
export function matchRepairSource(
  asset: AcquisitionAssetCandidate,
  sources: SourceAssetReference[]
) {
  return sources.find(
    source =>
      source.role === asset.role &&
      source.sourceUrlHash === asset.sourceUrlHash &&
      (asset.role !== "video" || source.moduleClass === asset.moduleClass)
  );
}
async function commitRepair(
  scope: CollectionScope,
  snapshotId: number,
  assetId: number,
  download:
    | Awaited<ReturnType<typeof downloadImageAsset>>
    | Awaited<ReturnType<typeof downloadVideoAsset>>,
  manual = false,
  expectedStatus?: string
) {
  return withDbTransaction(
    "save repaired source slot",
    async tx => {
      await tx.execute(
        sql`SELECT id FROM acquisition_jobs WHERE workspace_id=${scope.workspaceId} AND id=${scope.jobId} FOR UPDATE`
      );
      const current = await readRepairableCollection(tx, scope),
        asset = current.assets.find(a => a.id === assetId);
      if (
        current.snapshot.id !== snapshotId ||
        !asset ||
        !assetIsMissing(asset)
      )
        return false;
      if (manual) {
        await assertNoCollectionRepair(tx, scope);
        if (current.job.status !== expectedStatus)
          throw new Error("任务已确认入库，请刷新后重新选择缺失位置");
      }
      const { stored, attempts, failureReason, ...data } = download;
      await tx
        .update(acquisitionAssetCandidates)
        .set({
          ...data,
          contentType:
            asset.role === "video"
              ? "video/mp4"
              : "contentType" in data
                ? data.contentType
                : null,
          ...(manual
            ? { reviewedBy: scope.userId, reviewedAt: new Date() }
            : {}),
          reviewStatus: stored ? "pending" : asset.reviewStatus,
        })
        .where(
          and(
            eq(acquisitionAssetCandidates.id, assetId),
            eq(acquisitionAssetCandidates.workspaceId, scope.workspaceId),
            eq(acquisitionAssetCandidates.snapshotId, snapshotId)
          )
        );
      const completeness = (current.snapshot.completeness || {}) as Record<
        string,
        any
      >;
      const old = new Map<number, AssetDownloadResult>(
        (completeness.assetIngestion?.results || []).map(
          (r: AssetDownloadResult) => [r.assetId, r]
        )
      );
      old.set(assetId, {
        assetId,
        role: asset.role,
        stored,
        fieldStatus: data.fieldStatus,
        attempts,
        failureReason,
      });
      await updateSourceSnapshot(tx, scope.workspaceId, snapshotId, {
        completeness: {
          ...completeness,
          assetIngestion: summarizeAssetDownloads(current.assets.length, [
            ...old.values(),
          ]),
        },
      });
      return true;
    },
    { required: true }
  );
}
export async function supplementMissingCollectionVideo(
  scope: CollectionScope,
  assetId: number,
  values: {
    storageKey: string;
    thumbnailStorageKey: string;
    contentHash: string;
    sizeBytes: number;
  },
  expectedStatus: string
) {
  const current = await readRepairableCollection(
    await requireDb("manual collection video"),
    scope
  );
  if (
    !current.assets.some(
      a => a.id === assetId && a.role === "video" && assetIsMissing(a)
    )
  )
    throw new Error("该视频已补齐或不可编辑");
  const saved = await commitRepair(
    scope,
    current.snapshot.id,
    assetId,
    {
      ...values,
      stored: true,
      fieldStatus: "pending_review",
      attempts: 1,
      failureReason: null,
    },
    true,
    expectedStatus
  );
  if (!saved) throw new Error("该视频已补齐，请刷新");
  if (current.job.status === "confirmed")
    await publishLegacyRepair(scope, current.snapshot.id, [assetId]);
  return { saved: true };
}
async function publishLegacyRepair(
  scope: CollectionScope,
  snapshotId: number,
  ids: number[]
) {
  const result = await confirmSnapshotForDirectIngestion({
    workspaceId: scope.workspaceId,
    snapshotId,
    requestedBy: scope.userId,
    repairedAssetIds: ids,
  });
  await triggerConsumerPostConfirmation(result.projection);
}
export async function runMissingAssetRepair(
  scope: CollectionScope,
  input: { snapshotId: number; assetIds: number[] },
  signal: AbortSignal,
  runId?: string
) {
  const db = await requireDb("repair missing collection assets"),
    current = await readRepairableCollection(db, scope);
  if (current.snapshot.id !== input.snapshotId)
    throw new Error("采集快照已变化，本次补采已停止");
  const sources = await originalSources(db, current);
  let refreshed: SourceAssetReference[] | undefined;
  const repaired: number[] = [],
    failed: number[] = [];
  for (const id of input.assetIds) {
    signal.throwIfAborted();
    const fresh = await readRepairableCollection(db, scope),
      asset = fresh.assets.find(a => a.id === id);
    if (!asset || !assetIsMissing(asset)) continue;
    const source = matchRepairSource(asset, sources);
    if (!source) {
      failed.push(id);
      continue;
    }
    const download = async (ref: SourceAssetReference) =>
      asset.role === "video"
        ? downloadVideoAsset(
            {
              workspaceId: scope.workspaceId,
              snapshotId: input.snapshotId,
              signal,
            },
            ref,
            asset
          )
        : downloadImageAsset(
            {
              workspaceId: scope.workspaceId,
              snapshotId: input.snapshotId,
              signal,
            },
            ref
          );
    let result = await download(source);
    // Refresh the product page once only when a source URL is unavailable. Keep successes and slot identities.
    if (
      !result.stored &&
      /link_unavailable|http_error|network|download_failed/.test(
        result.failureReason || ""
      )
    ) {
      if (!refreshed) {
        refreshed = [];
        const response = await new BasicAmazonImagesProvider().fetch({
          workspaceId: scope.workspaceId,
          marketplace: "US",
          asin: current.job.asin,
          capabilities: [
            "catalog_basic",
            "image_gallery",
            "aplus",
            "brand_story",
          ],
          idempotencyKey: runId || `repair-missing-job-${scope.jobId}`,
        });
        if (response.rawArtifact)
          refreshed = normalizeAmazonArtifact({
            bytes: response.rawArtifact.bytes,
            expectedAsin: current.job.asin,
            marketplace: "US",
          }).sourceAssets;
      }
      const renewed = matchRepairSource(asset, refreshed);
      if (
        renewed &&
        (renewed.sourceUrl !== source.sourceUrl ||
          renewed.posterUrl !== source.posterUrl)
      )
        result = await download(renewed);
    }
    signal.throwIfAborted();
    if (await commitRepair(scope, input.snapshotId, id, result)) {
      (result.stored ? repaired : failed).push(id);
    }
    if (runId)
      await updateAiJobProgress(
        runId,
        Math.round(
          (90 * (repaired.length + failed.length)) / input.assetIds.length
        )
      );
  }
  if (current.job.status === "confirmed" && repaired.length)
    await publishLegacyRepair(scope, input.snapshotId, repaired);
  // A waiting collection stays waiting even if all repairs succeed. Only its owner's confirmation admits it.
  return {
    jobId: scope.jobId,
    repaired: repaired.length,
    failed: failed.length,
    awaitingConfirmation: current.job.status !== "confirmed",
  };
}
registerAiJobHandler({
  id: MISSING_REPAIR_KIND,
  match: job => job.kind === MISSING_REPAIR_KIND,
  handler: async (job, ctx) => {
    const input = z
      .object({
        jobId: z.number().int().positive(),
        snapshotId: z.number().int().positive(),
        assetIds: z.array(z.number().int().positive()).min(1).max(400),
      })
      .parse(job.input);
    if (!job.workspaceId) throw new Error("缺少工作空间");
    return runMissingAssetRepair(
      { workspaceId: job.workspaceId, userId: job.userId, jobId: input.jobId },
      input,
      ctx.signal,
      job.runId
    );
  },
});
