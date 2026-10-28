import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { acquisitionJobs } from "../../../drizzle/schema/acquisition";
import { ADMIN_ROLES } from "../../../shared/const";
import { knowledgeSourceAsin } from "../../../shared/knowledgeCollection";
import { requireDb, withDbTransaction } from "../../repositories/dbClient";
import { assertNoCollectionRepair } from "./collectionRepairState";
import { getAcquisitionJob } from "./repository";
import { enqueueMissingAssetRepair } from "./missingAssetRepair";

type Actor = { workspaceId: number; userId: number; role: string };
async function actionableJob(actor: Actor, jobId: number) {
  const db = await requireDb("Acquisition record action");
  const job = await getAcquisitionJob(db, actor.workspaceId, jobId);
  if (!job || job.deletedAt || job.requestedBy !== actor.userId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "采集记录不存在或不可访问",
    });
  }
  if (["queued", "running"].includes(job.status)) {
    throw new TRPCError({
      code: "CONFLICT",
      message: "任务正在采集中，请完成后再操作",
    });
  }
  return { db, job };
}

export async function deleteAcquisitionRecord(actor: Actor, jobId: number) {
  const { job } = await actionableJob(actor, jobId);
  if (
    job.consumerType === "kb_images" &&
    !(ADMIN_ROLES as readonly string[]).includes(actor.role)
  ) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "仅管理员可删除采集记录",
    });
  }
  // Only hide the history row. Snapshots, images, videos and tags remain intact.
  return withDbTransaction(
    "hide completed acquisition record",
    async db => {
      await db.execute(
        sql`SELECT id FROM acquisition_jobs WHERE workspace_id=${actor.workspaceId} AND id=${jobId} FOR UPDATE`
      );
      await assertNoCollectionRepair(db, { ...actor, jobId });
      const [result] = await db
        .update(acquisitionJobs)
        .set({ deletedAt: new Date(), deletedBy: actor.userId })
        .where(
          and(
            eq(acquisitionJobs.id, jobId),
            eq(acquisitionJobs.workspaceId, actor.workspaceId),
            eq(acquisitionJobs.requestedBy, actor.userId),
            isNull(acquisitionJobs.deletedAt),
            inArray(acquisitionJobs.status, [
              "review_required",
              "confirmed",
              "failed",
              "canceled",
            ])
          )
        );
      if (!result.affectedRows)
        throw new TRPCError({
          code: "CONFLICT",
          message: "采集记录已变化，请刷新后重试",
        });
      return { deleted: true };
    },
    { required: true }
  );
}

export async function recollectAcquisitionRecord(
  actor: Actor,
  jobId: number,
  requestId: string
) {
  const { job } = await actionableJob(actor, jobId);
  const asin = knowledgeSourceAsin(job.asin);
  if (job.consumerType !== "kb_images" || !asin) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "该记录不支持图片知识库重新采集",
    });
  }
  return enqueueMissingAssetRepair({ ...actor, jobId }, requestId);
}
