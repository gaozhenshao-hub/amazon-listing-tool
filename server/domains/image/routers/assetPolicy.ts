import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../../../_core/trpc";
import { IMAGE_ASSET_ALLOWED_USES } from "../../../../drizzle/schema/imageAssetPolicies";
import {
  imageAssetPolicyService,
  type AssetLicenseEvidence,
  type ImageAssetAllowedUse,
  type ImageAssetSource,
} from "../services/imageAssetPolicyService";
import { imageAssetTrustLedgerService } from "../services/imageAssetTrustLedgerService";

const allowedUseSchema = z.enum(IMAGE_ASSET_ALLOWED_USES);
const sourceSchema = z.object({
  sourceSnapshotId: z.number().int().positive().nullable().optional(),
  sourceRole: z.enum(["main", "secondary", "aplus", "brand_story", "video", "unknown"]),
  sourceModule: z.string().trim().max(128).nullable().optional(),
  sourcePosition: z.number().int().min(0).max(100_000),
});
const evidenceSchema = z.object({
  proofRecordId: z.string().trim().min(1).max(128),
  proofType: z.string().trim().min(1).max(128),
  grantSummary: z.string().trim().min(1).max(2_000),
});

function currentWorkspaceId(workspaceId: number | null | undefined): number {
  if (!workspaceId || !Number.isInteger(workspaceId) || workspaceId <= 0) {
    throw new TRPCError({ code: "FORBIDDEN", message: "请先选择当前工作空间" });
  }
  return workspaceId;
}

function actor(ctx: { workspaceId?: number | null; user: { id: number; role: string } }) {
  return {
    workspaceId: currentWorkspaceId(ctx.workspaceId),
    actorId: ctx.user.id,
    actorRole: ctx.user.role,
  };
}

function requireReviewAdmin(role: string) {
  if (!['admin', 'super_admin'].includes(role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅管理员可查看或处理许可证明审核队列" });
  }
}

/**
 * Isolated Phase-C route. Parent integration must spread `imageAssetPolicyProcedures`
 * into the image router only after it wires a server-side receipt metadata resolver
 * and license-evidence verifier; the default service intentionally fails closed.
 */
export function createImageAssetPolicyProcedures(policyService = imageAssetPolicyService) {
  return {
  listAssetPolicies: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(({ ctx, input }) => {
      requireReviewAdmin(ctx.user.role);
      return policyService.listCurrentPolicies({ ...actor(ctx), projectId: input.projectId });
    }),

  listLicenseEvidenceForReview: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(({ ctx, input }) => {
      requireReviewAdmin(ctx.user.role);
      return imageAssetTrustLedgerService.listLicenseEvidenceForReview({ ...actor(ctx), projectId: input.projectId });
    }),

  listMyLicenseEvidence: protectedProcedure
    .input(z.object({ projectId: z.number().int().positive() }))
    .query(async ({ ctx, input }) => {
      const records = await imageAssetTrustLedgerService.listMyLicenseEvidence({
        ...actor(ctx),
        projectId: input.projectId,
      });
      // Defense in depth: browser responses are allow-listed, rather than
      // trusting a service implementation or mock never to append internals.
      return records.map(record => ({
        evidenceRecordId: record.evidenceRecordId,
        version: record.version,
        status: record.status,
        reviewedAt: record.reviewedAt ?? null,
        expiresAt: record.expiresAt ?? null,
        proofType: record.proofType,
        grantSummary: record.grantSummary,
      }));
    }),

  reviewLicenseEvidence: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      evidenceRecordId: z.string().trim().regex(/^license_[0-9a-f-]{36}$/i),
      expectedVersion: z.number().int().positive(),
      decision: z.enum(["verify", "reject", "revoke"]),
      reviewNote: z.string().trim().max(1_024).optional(),
    }))
    .mutation(({ ctx, input }) => {
      requireReviewAdmin(ctx.user.role);
      return imageAssetTrustLedgerService.reviewLicenseEvidence({ ...actor(ctx), ...input });
    }),

  createLicenseEvidencePreview: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      evidenceRecordId: z.string().trim().regex(/^license_[0-9a-f-]{36}$/i),
      expectedVersion: z.number().int().positive(),
    }))
    .query(({ ctx, input }) => {
      requireReviewAdmin(ctx.user.role);
      return imageAssetTrustLedgerService.createLicenseEvidencePreview({ ...actor(ctx), ...input });
    }),

  registerReceiptAsset: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      expectedRevision: z.number().int().min(0),
      originKind: z.enum(["own_product", "designer_upload"]),
      receiptReference: z.string().url().max(8_192),
      requestedUses: z.array(allowedUseSchema).min(1).max(7),
      licenseEvidence: evidenceSchema,
      source: sourceSchema,
    }))
    .mutation(({ ctx, input }) => policyService.registerReceiptAsset({
      ...actor(ctx),
      ...input,
      requestedUses: input.requestedUses as ImageAssetAllowedUse[],
      licenseEvidence: input.licenseEvidence as AssetLicenseEvidence,
      source: input.source as ImageAssetSource,
    })),

  reviewAssetPolicy: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      assetId: z.string().trim().min(1).max(80),
      expectedRevision: z.number().int().min(1),
      decision: z.enum(["approve", "reject", "revoke"]),
      allowedUses: z.array(allowedUseSchema).min(1).max(7).optional(),
      licenseEvidence: evidenceSchema.optional(),
      reviewNote: z.string().trim().max(1_024).optional(),
    }))
    .mutation(({ ctx, input }) => {
      requireReviewAdmin(ctx.user.role);
      return policyService.reviewAssetPolicy({
        ...actor(ctx),
        ...input,
        allowedUses: input.allowedUses as ImageAssetAllowedUse[] | undefined,
        licenseEvidence: input.licenseEvidence as AssetLicenseEvidence | undefined,
      });
    }),

  /** This is the consumer-side gate for Step 4/5 integration, not an asset download API. */
  requireApprovedAssetUse: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      assetId: z.string().trim().min(1).max(80),
      allowedUse: allowedUseSchema,
      expectedRevision: z.number().int().min(1),
    }))
    .query(async ({ ctx, input }) => {
      const approved = await policyService.requireCurrentApprovedAssetUse({
          ...actor(ctx),
          ...input,
          allowedUse: input.allowedUse as ImageAssetAllowedUse,
        });
      return { assetId: approved.assetId, originKind: approved.originKind,
        allowedUses: approved.allowedUses, reviewState: approved.reviewState,
        revision: approved.revision,
        reviewedAt: approved.reviewedAt, hasLicenseEvidence: approved.hasLicenseEvidence };
    }),
  };
};

export const imageAssetPolicyProcedures = createImageAssetPolicyProcedures();
export const imageAssetPolicyRouter = router(imageAssetPolicyProcedures);
