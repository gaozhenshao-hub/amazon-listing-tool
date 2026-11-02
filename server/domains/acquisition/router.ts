import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { acquisitionConfirmedSnapshots } from "../../../drizzle/schema/acquisition";
import { adminProcedure, protectedProcedure, router } from "../../_core/trpc";
import { requireDb } from "../../repositories/dbClient";
import { createConfiguredApifyAmazonProvider } from "./apifyProvider";
import { isApiConnectionSecretConfigured } from "../apiConnections/service";
import { AmazonAcquisitionCapabilitySchema } from "./contracts";
import { AcquisitionBudgetPolicySchema } from "./policy";
import {
  getApifyProviderProfile,
  defaultApifyProviderProfileView,
  sanitizeProviderProfile,
  upsertApifyProviderProfile,
} from "./providerProfileService";
import { startAmazonAcquisitionJob } from "./acquisitionJobs";
import { getAcquisitionJob, getSourceSnapshotByJob, listAcquisitionJobs, listAssetCandidates } from "./repository";
import { confirmSnapshotForDirectIngestion } from "./snapshotReview";
import { ACQUISITION_CONSUMER_TYPES } from "../../../shared/acquisition";
import { assessConfirmedSnapshotCoverage, IMAGE_ACQUISITION_CAPABILITIES } from "./capabilityCoverage";

function workspaceIdOf(ctx: { workspaceId?: number | null }): number {
  if (!ctx.workspaceId || ctx.workspaceId <= 0) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "当前工作空间不可用" });
  }
  return ctx.workspaceId;
}

const profileInput = AcquisitionBudgetPolicySchema.safeExtend({
  displayName: z.string().trim().min(1).max(128),
  actorName: z.literal("junglee/Amazon-crawler"),
  status: z.enum(["qualification_pending", "active", "paused", "rejected"]),
  capabilities: z.array(AmazonAcquisitionCapabilitySchema).min(2),
});

export const amazonAcquisitionRouter = router({
  createJob: protectedProcedure
    .input(z.object({
      consumerType: z.enum(ACQUISITION_CONSUMER_TYPES),
      consumerRef: z.string().trim().min(1).max(128),
      marketplace: z.literal("US"),
      asin: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{10}$/),
      capabilities: z.array(AmazonAcquisitionCapabilitySchema).min(1),
      cachePolicy: z.enum(["prefer_cache", "refresh", "cache_only"]).default("prefer_cache"),
      maxChargeUsd: z.number().positive().max(100),
    }))
    .mutation(async ({ ctx, input }) => startAmazonAcquisitionJob({
      ...input,
      workspaceId: workspaceIdOf(ctx),
      requestedBy: ctx.user.id,
    })),

  listJobs: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(50) }).optional())
    .query(async ({ ctx, input }) => {
      const db = await requireDb("Amazon acquisition jobs");
      return listAcquisitionJobs(db, workspaceIdOf(ctx), input?.limit ?? 50);
    }),

  jobCoverage: protectedProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await requireDb("Amazon acquisition coverage");
      const job = await getAcquisitionJob(db, workspaceId, input.jobId);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "采集任务不存在" });
      if (job.status !== "confirmed") return { status: job.status, isCurrent: false, coverage: [] };
      const source = job.cacheHitSnapshotId ? null : await getSourceSnapshotByJob(db, workspaceId, job.id);
      const confirmed = await db.select().from(acquisitionConfirmedSnapshots).where(and(
        eq(acquisitionConfirmedSnapshots.workspaceId, workspaceId),
        job.cacheHitSnapshotId
          ? eq(acquisitionConfirmedSnapshots.id, job.cacheHitSnapshotId)
          : eq(acquisitionConfirmedSnapshots.snapshotId, source?.id ?? -1),
      )).orderBy(desc(acquisitionConfirmedSnapshots.id)).limit(1);
      const snapshot = confirmed[0];
      if (!snapshot || snapshot.marketplace !== job.marketplace || snapshot.asin !== job.asin) {
        return { status: job.status, isCurrent: false, coverage: [] };
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

  ingestLegacyPartialJob: protectedProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .mutation(async ({ ctx, input }) => {
      const workspaceId = workspaceIdOf(ctx);
      const db = await requireDb("legacy Amazon acquisition ingestion");
      const job = await getAcquisitionJob(db, workspaceId, input.jobId);
      if (!job || job.status !== "review_required") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该任务不是可迁移的历史采集任务" });
      }
      const snapshot = await getSourceSnapshotByJob(db, workspaceId, job.id);
      if (!snapshot || snapshot.status !== "pending_review") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "该历史任务没有可直接入库的快照" });
      }
      return confirmSnapshotForDirectIngestion({ workspaceId, snapshotId: snapshot.id, requestedBy: ctx.user.id });
    }),

  providerProfile: adminProcedure.query(async ({ ctx }) => {
    const db = await requireDb("Amazon acquisition provider profile");
    const row = await getApifyProviderProfile(db, workspaceIdOf(ctx));
    return row ? await sanitizeProviderProfile(row) : await defaultApifyProviderProfileView();
  }),

  saveProviderProfile: adminProcedure
    .input(profileInput)
    .mutation(async ({ ctx, input }) => {
      if (ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "仅超级管理员可修改采集Provider配置" });
      }
      const db = await requireDb("Amazon acquisition provider profile");
      return upsertApifyProviderProfile({
        db,
        workspaceId: workspaceIdOf(ctx),
        userId: ctx.user.id,
        profile: input,
      });
    }),

  estimate: adminProcedure
    .input(z.object({
      marketplace: z.literal("US"),
      asin: z.string().regex(/^[A-Z0-9]{10}$/),
      capabilities: z.array(AmazonAcquisitionCapabilitySchema).min(1),
      maxChargeUsd: z.number().positive().max(100),
    }))
    .query(async ({ ctx, input }) => {
      const workspaceId = workspaceIdOf(ctx);
      const provider = await createConfiguredApifyAmazonProvider();
      const estimate = await provider.estimate({
        ...input,
        workspaceId,
        idempotencyKey: `estimate-${workspaceId}-${input.asin}`,
      });
      return {
        providerCode: provider.providerCode,
        ...estimate,
        secretConfigured: await isApiConnectionSecretConfigured("apify", "api_token"),
      };
    }),
});
