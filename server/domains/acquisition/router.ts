import { enqueueMissingAssetRepair } from "./missingAssetRepair";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq, isNull } from "drizzle-orm";
import { acquisitionConfirmedSnapshots } from "../../../drizzle/schema/acquisition";
import { protectedProcedure, router } from "../../_core/trpc";
import { requireDb } from "../../repositories/dbClient";
import { AmazonAcquisitionCapabilitySchema } from "./contracts";
import { startAmazonAcquisitionJob } from "./acquisitionJobs";
import { getAcquisitionJob, getSourceSnapshotByJob, listAcquisitionJobs, listAssetCandidates } from "./repository";
import { supplementPendingKnowledgeImage, confirmPendingKnowledgeImages } from "./pendingKnowledgeImages";
import { ACQUISITION_CONSUMER_TYPES } from "../../../shared/acquisition";
import { assessConfirmedSnapshotCoverage, IMAGE_ACQUISITION_CAPABILITIES } from "./capabilityCoverage";
import { AcquisitionReviewReadInputSchema, AcquisitionReviewReadResultSchema, AcquisitionReviewSaveInputSchema,
  AcquisitionReviewConfirmInputSchema, AcquisitionReviewRejectInputSchema, AcquisitionReviewRecoverInputSchema,
  AcquisitionReviewWriteResultSchema, AcquisitionReviewImageInputSchema, AcquisitionReviewImageRecoverInputSchema } from "../../../shared/acquisitionReview";
import { AcquisitionReviewLocationInputSchema, AcquisitionReviewLocationResultSchema } from "../../../shared/acquisitionReviewLocation";
import { manualSnapshotReviewLocation } from "./manualSnapshotReviewLocation";
import { configuredManualSnapshotImages, configuredManualSnapshotReview } from "./manualSnapshotReviewRuntime";
import { readKnowledgeAcquisitionDetails } from "./jobDetails";
import { workspaceScopedProcedure } from "../ai_os/workspaceScopedProcedure";
import { deleteAcquisitionRecord, recollectAcquisitionRecord } from "./jobActions";

function workspaceIdOf(ctx: { workspaceId?: number | null }): number {
  if (!ctx.workspaceId || ctx.workspaceId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "当前工作空间不可用" });
  }
  return ctx.workspaceId;
}


import { KnowledgeCollectionInputSchema } from "../../../shared/knowledgeCollection";
import { startKnowledgeCollectionBatch } from "./knowledgeCollectionBatch";

export const amazonAcquisitionRouter = router({
  collectKnowledge: workspaceScopedProcedure("knowledge").input(KnowledgeCollectionInputSchema)
    .mutation(({ ctx, input }) => startKnowledgeCollectionBatch({ ...input, workspaceId: workspaceIdOf(ctx), requestedBy: ctx.user.id })),
  jobDetails: workspaceScopedProcedure("knowledge").input(z.object({ jobId: z.number().int().positive() }))
    .query(({ ctx, input }) => readKnowledgeAcquisitionDetails(workspaceIdOf(ctx), ctx.user.id, input.jobId)),
  deleteJob: protectedProcedure.input(z.object({ jobId: z.number().int().positive() }))
    .mutation(({ ctx, input }) => deleteAcquisitionRecord({ workspaceId: workspaceIdOf(ctx), userId: ctx.user.id, role: ctx.user.role }, input.jobId)),
  recollectJob: workspaceScopedProcedure("knowledge").input(z.object({ jobId: z.number().int().positive(), requestId: z.string().uuid() }))
    .mutation(({ ctx, input }) => recollectAcquisitionRecord({ workspaceId: workspaceIdOf(ctx), userId: ctx.user.id, role: ctx.user.role }, input.jobId, input.requestId)),
  reviewJob: protectedProcedure.input(AcquisitionReviewLocationInputSchema).output(AcquisitionReviewLocationResultSchema)
    .query(({ ctx, input }) => manualSnapshotReviewLocation.read(ctx, input)),
  review: protectedProcedure.input(AcquisitionReviewReadInputSchema).output(AcquisitionReviewReadResultSchema)
    .query(({ ctx, input }) => configuredManualSnapshotReview.read(ctx, input)),
  saveReview: protectedProcedure.input(AcquisitionReviewSaveInputSchema).output(AcquisitionReviewWriteResultSchema)
    .mutation(({ ctx, input }) => configuredManualSnapshotReview.execute(ctx, input)),
  confirmReview: protectedProcedure.input(AcquisitionReviewConfirmInputSchema).output(AcquisitionReviewWriteResultSchema)
    .mutation(({ ctx, input }) => configuredManualSnapshotReview.execute(ctx, input)),
  rejectReview: protectedProcedure.input(AcquisitionReviewRejectInputSchema).output(AcquisitionReviewWriteResultSchema)
    .mutation(({ ctx, input }) => configuredManualSnapshotReview.execute(ctx, input)),
  recoverReview: protectedProcedure.input(AcquisitionReviewRecoverInputSchema).output(AcquisitionReviewWriteResultSchema)
    .mutation(({ ctx, input }) => configuredManualSnapshotReview.recover(ctx, input)),
  recoverReviewImage: protectedProcedure.input(AcquisitionReviewImageInputSchema).output(AcquisitionReviewWriteResultSchema)
    .mutation(({ ctx, input }) => configuredManualSnapshotImages.upload(ctx, input)),
  recoverReviewImageOperation: protectedProcedure.input(AcquisitionReviewImageRecoverInputSchema).output(AcquisitionReviewWriteResultSchema)
    .mutation(({ ctx, input }) => configuredManualSnapshotImages.recover(ctx, input)),

  createJob: protectedProcedure
    .input(z.object({
      consumerType: z.enum(ACQUISITION_CONSUMER_TYPES),
      consumerRef: z.string().trim().min(1).max(128),
      marketplace: z.literal("US"),
      asin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/),
      capabilities: z.array(AmazonAcquisitionCapabilitySchema).min(1),
      cachePolicy: z.enum(["prefer_cache", "refresh", "cache_only"]).default("prefer_cache"),
    }))
    .mutation(async ({ ctx, input }) => startAmazonAcquisitionJob({
      ...input,
      workspaceId: workspaceIdOf(ctx),
      requestedBy: ctx.user.id,
    })),

  listJobs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50), scope: z.enum(["knowledge", "competitor"]).optional(), projectId: z.number().int().positive().optional() }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb("Amazon acquisition jobs");
      return listAcquisitionJobs(db, workspaceIdOf(ctx), input?.limit ?? 50, ctx.user.id, input?.scope, input?.projectId);
    }),

  jobCoverage: protectedProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await requireDb("Amazon acquisition coverage");
      const job = await getAcquisitionJob(db, workspaceId, input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "采集任务不存在" });
      if (job.status !== "confirmed") return { status: job.status, isCurrent: false, cacheExpired: false, coverage: [] };
      const source = job.cacheHitSnapshotId ? null : await getSourceSnapshotByJob(db, workspaceId, job.id);
      const confirmed = await db.select().from(acquisitionConfirmedSnapshots).where(and(
        eq(acquisitionConfirmedSnapshots.workspaceId, workspaceId),
        // Optional private manual revisions do not replace the original
        // direct-ingestion coverage or enter the workspace-wide cache.
        isNull(acquisitionConfirmedSnapshots.revisionId),
        job.cacheHitSnapshotId
          ? eq(acquisitionConfirmedSnapshots.id, job.cacheHitSnapshotId)
          : eq(acquisitionConfirmedSnapshots.snapshotId, source?.id ?? -1),
      )).orderBy(desc(acquisitionConfirmedSnapshots.id)).limit(1);
      const snapshot = confirmed[0];
      if (!snapshot || snapshot.marketplace !== job.marketplace || snapshot.asin !== job.asin) {
        return { status: job.status, isCurrent: false, cacheExpired: Boolean(job.cacheExpiredAt), coverage: [] };
      }
      const requested = z.array(AmazonAcquisitionCapabilitySchema).safeParse(job.requestedCapabilities);
      if (!requested.success) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "采集能力记录格式异常" });
      const assets = await listAssetCandidates(db, workspaceId, snapshot.snapshotId);
      const coverage = assessConfirmedSnapshotCoverage({
        fieldStatuses: snapshot.fieldStatuses,
        confirmedAssetIds: snapshot.confirmedAssetIds,
        assets,
      }, requested.data);
      const requestedSet = new Set(requested.data);
      return {
        status: job.status,
        isCurrent: snapshot.isCurrent === 1,
        cacheExpired: Boolean(job.cacheExpiredAt),
        coverage: [
          ...coverage.map(item => ({
            capability: item.capability,
            state: item.state,
            storedCount: item.safelyStoredAssetIds.length,
            failedCount: item.failedAssetIds.length,
          })),
          ...IMAGE_ACQUISITION_CAPABILITIES.filter(capability => !requestedSet.has(capability))
            .map(capability => ({ capability, state: "not_requested" as const, storedCount: 0, failedCount: 0 })),
        ],
      };
    }),

  retryMissingAsset: workspaceScopedProcedure("knowledge").input(z.object({jobId:z.number().int().positive(),assetId:z.number().int().positive(),requestId:z.string().uuid()}))
    .mutation(({ctx,input})=>enqueueMissingAssetRepair({workspaceId:workspaceIdOf(ctx),userId:ctx.user.id,jobId:input.jobId},input.requestId,input.assetId)),
  supplementMissingImage: workspaceScopedProcedure("knowledge")
    .input(z.object({jobId:z.number().int().positive(),assetId:z.number().int().positive(),base64:z.string().max(11_184_812)}))
    .mutation(({ctx,input}) => supplementPendingKnowledgeImage({workspaceId:workspaceIdOf(ctx),userId:ctx.user.id,jobId:input.jobId},input.assetId,input.base64)),
  confirmCompletedCollection: workspaceScopedProcedure("knowledge").input(z.object({jobId:z.number().int().positive()}))
    .mutation(({ctx,input}) => confirmPendingKnowledgeImages({workspaceId:workspaceIdOf(ctx),userId:ctx.user.id,jobId:input.jobId})),
});
