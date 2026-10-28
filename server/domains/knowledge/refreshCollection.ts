import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { aiJobs } from "../../../drizzle/schema/ai_os";
import { requireDb } from "../../repositories/dbClient";
import { createAcquisitionJob } from "../acquisition/repository";
import { getBasicImagesProfile } from "../acquisition/basicProviderProfile";
import { KB_IMAGE_IMPORT_CAPABILITIES } from "../acquisition/kbImagesAcquisition";
import {
  queryRows,
  canAccess,
  notFound,
  type AssetScope,
} from "./assetTargets";

export async function refreshCollection(scope: AssetScope, id: number) {
  return (await requireDb()).transaction(async tx => {
    const [set] = await queryRows<{
      userId: number;
      visibility: string;
      status: string;
      sourceAsin: string | null;
      asin: string;
      collectionVersion: number;
    }>(
      tx,
      sql`SELECT * FROM kb_image_sets WHERE id=${id} AND workspaceId=${scope.workspaceId} AND recycleId IS NULL FOR UPDATE`
    );
    if (!set || !canAccess(scope, set, true)) throw notFound();
    const asin = (set.sourceAsin || set.asin).replace(/^新\d*/, "");
    if (!/^[A-Z0-9]{10}$/.test(asin))
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "这套资料没有有效的原始 ASIN，无法重新采集",
      });
    const [active] = await queryRows<{ id: number; consumerRef: string }>(
      tx,
      sql`SELECT id,consumer_ref AS consumerRef FROM acquisition_jobs WHERE workspace_id=${scope.workspaceId} AND consumer_type='kb_images' AND asin=${asin} AND deleted_at IS NULL AND status IN ('queued','running','review_required') LIMIT 1`
    );
    if (active) {
      if (!active.consumerRef.startsWith(`kb-refresh:${id}:`))
        throw new TRPCError({
          code: "CONFLICT",
          message: "这个 ASIN 已有采集任务，请完成或取消该任务后再重新采集",
        });
      return { jobId: active.id, existing: true };
    }
    const profile = await getBasicImagesProfile(tx, scope.workspaceId);
    if (!profile)
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "请先配置系统图片采集",
      });
    const request = randomUUID();
    const jobId = await createAcquisitionJob(tx, {
      workspaceId: scope.workspaceId,
      requestedBy: scope.userId,
      providerProfileId: profile.id,
      consumerType: "kb_images",
      consumerRef: `kb-refresh:${id}:${asin}:${request}`,
      marketplace: "US",
      asin,
      requestedCapabilities: [...KB_IMAGE_IMPORT_CAPABILITIES],
      idempotencyKey: `kb-refresh:${id}:${request}`,
      status: "queued",
      cachePolicy: "refresh",
      maxChargeUsd: "0.0000",
    });
    await tx
      .insert(aiJobs)
      .values({
        workspaceId: scope.workspaceId,
        userId: scope.userId,
        runId: `kb-refresh:${request}`,
        kind: "amazon.acquisition.knowledge_batch",
        module: "amazonAcquisition",
        procedure: "knowledgeAssets.refreshCollection",
        status: "queued",
        queueName: "amazon_acquisition",
        maxAttempts: 3,
        timeoutSeconds: 7200,
        input: {
          receipt: {
            items: [
              {
                jobId,
                asin,
                displayAsin: set.asin,
                version: set.collectionVersion,
                status: "queued",
                cacheHitSnapshotId: null,
              },
            ],
            skippedItems: [],
          },
        },
      });
    return { jobId, existing: false };
  });
}
