import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../_core/trpc";
import { requireDb } from "../../repositories/dbClient";
import { createConfiguredApifyAmazonProvider } from "./apifyProvider";
import { AmazonAcquisitionCapabilitySchema } from "./contracts";
import { AcquisitionBudgetPolicySchema } from "./policy";
import {
  getApifyProviderProfile,
  defaultApifyProviderProfileView,
  sanitizeProviderProfile,
  upsertApifyProviderProfile,
} from "./providerProfileService";
import { startAmazonAcquisitionJob } from "./acquisitionJobs";
import { listAcquisitionJobs } from "./repository";
import { ACQUISITION_CONSUMER_TYPES } from "../../../shared/acquisition";
import {
  SnapshotAssetReviewSchema,
  SnapshotPatchSchema,
  confirmSnapshot,
  getLatestSnapshotIdForJob,
  getSnapshotReview,
  rejectSnapshot,
  saveSnapshotReview,
} from "./snapshotReview";
import { triggerConsumerPostConfirmation } from "./postConfirmation";

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

  latestSnapshotForJob: protectedProcedure
    .input(z.object({ jobId: z.number().int().positive() }))
    .query(({ ctx, input }) => getLatestSnapshotIdForJob(workspaceIdOf(ctx), input.jobId)),

  review: protectedProcedure
    .input(z.object({ snapshotId: z.number().int().positive() }))
    .query(({ ctx, input }) => getSnapshotReview(workspaceIdOf(ctx), input.snapshotId)),

  saveReview: protectedProcedure
    .input(z.object({
      snapshotId: z.number().int().positive(),
      patch: SnapshotPatchSchema,
      assetReviews: SnapshotAssetReviewSchema,
      note: z.string().trim().max(2000).nullable().optional(),
    }))
    .mutation(({ ctx, input }) => saveSnapshotReview({
      ...input,
      workspaceId: workspaceIdOf(ctx),
      userId: ctx.user.id,
    })),

  confirmReview: protectedProcedure
    .input(z.object({ snapshotId: z.number().int().positive(), note: z.string().trim().max(2000).nullable().optional() }))
    .mutation(async ({ ctx, input }) => {
      const result = await confirmSnapshot({ ...input, workspaceId: workspaceIdOf(ctx), userId: ctx.user.id });
      const postConfirmation = await triggerConsumerPostConfirmation(result.projection);
      return { ...result, ...postConfirmation };
    }),

  rejectReview: protectedProcedure
    .input(z.object({ snapshotId: z.number().int().positive(), note: z.string().trim().min(1).max(2000) }))
    .mutation(({ ctx, input }) => rejectSnapshot({ ...input, workspaceId: workspaceIdOf(ctx), userId: ctx.user.id })),

  providerProfile: adminProcedure.query(async ({ ctx }) => {
    const db = await requireDb("Amazon acquisition provider profile");
    const row = await getApifyProviderProfile(db, workspaceIdOf(ctx));
    return row ? sanitizeProviderProfile(row) : defaultApifyProviderProfileView();
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
      const provider = createConfiguredApifyAmazonProvider();
      const estimate = await provider.estimate({
        ...input,
        workspaceId,
        idempotencyKey: `estimate-${workspaceId}-${input.asin}`,
      });
      return {
        providerCode: provider.providerCode,
        ...estimate,
        secretConfigured: Boolean(process.env.APIFY_API_TOKEN),
      };
    }),
});
