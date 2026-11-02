import { createHmac, timingSafeEqual } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import {
  listingBulletCandidates,
  listingCoreRevisions,
  listingReviewRevisions,
} from "../../../../drizzle/schema/listingRevisions";
import * as shared from "../routerContext";
import { getActiveListingByProject, getDb } from "../repository";
import {
  confirmListingCandidate,
  createListingCandidate,
  editListingCandidate,
  rejectListingCandidate,
} from "../services/listingCandidateReviewService";
import {
  hashCompleteListing,
  ListingCandidateSyncError,
  type LegacyListingRow,
  previewListingCandidateSync,
  syncConfirmedListingCandidate,
} from "../services/listingCandidateSyncService";
import { listingCandidateSyncDrizzleStore } from "../services/listingCandidateSyncDrizzleStore";

const {
  protectedProcedure,
  resolveProjectAccess,
  ensureWriteAccess,
  z,
  TRPCError,
} = shared;

function requireWorkspaceProject(
  project: { workspaceId?: number | null },
  workspaceId?: number | null
) {
  if (!workspaceId || project.workspaceId !== workspaceId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "请先选择候选所属的工作空间",
    });
  }
}

const candidateStructureInput = {
  subtitle: z.string().trim().max(500).optional(),
  fullText: z.string().trim().min(1).max(5_000),
  evidenceFactIds: z.array(z.number().int().positive()).min(1).max(30),
};

const previewTokenLifetimeMs = 10 * 60 * 1000;

type ListingSyncPreviewTokenPayload = {
  v: 1;
  actorId: number;
  workspaceId: number;
  projectId: number;
  candidateId: number;
  expectedCandidateRevision: number;
  listingId: number;
  sellingPointIndex: number;
  expectedListingVersion: number;
  expectedFullHash: string;
  issuedAt: number;
  expiresAt: number;
};

function previewTokenSecret(): string {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "正式 Listing 同步预览不可用：服务端确认密钥未配置",
    });
  }
  return secret;
}

function encodePreviewToken(payload: ListingSyncPreviewTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", previewTokenSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function sameSignature(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length
    && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function decodePreviewToken(token: string): ListingSyncPreviewTokenPayload {
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length > 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "必须先查看完整 Listing 同步预览" });
  }
  const expected = createHmac("sha256", previewTokenSecret())
    .update(encoded)
    .digest("base64url");
  if (!sameSignature(expected, signature)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Listing 同步预览确认令牌无效或已被篡改" });
  }
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ListingSyncPreviewTokenPayload;
    if (
      value.v !== 1 ||
      !Number.isSafeInteger(value.actorId) ||
      !Number.isSafeInteger(value.workspaceId) ||
      !Number.isSafeInteger(value.projectId) ||
      !Number.isSafeInteger(value.candidateId) ||
      !Number.isSafeInteger(value.expectedCandidateRevision) ||
      !Number.isSafeInteger(value.listingId) ||
      !Number.isInteger(value.sellingPointIndex) || value.sellingPointIndex < 0 || value.sellingPointIndex > 4 ||
      !Number.isSafeInteger(value.expectedListingVersion) ||
      typeof value.expectedFullHash !== "string" || !/^[a-f0-9]{64}$/u.test(value.expectedFullHash) ||
      !Number.isSafeInteger(value.issuedAt) || !Number.isSafeInteger(value.expiresAt) ||
      value.issuedAt > Date.now() || value.expiresAt < Date.now() ||
      value.expiresAt - value.issuedAt !== previewTokenLifetimeMs
    ) throw new Error("invalid");
    return value;
  } catch {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Listing 同步预览确认令牌无效或已过期，请重新查看完整预览" });
  }
}

function rethrowSyncError(error: unknown): never {
  if (error instanceof ListingCandidateSyncError) {
    throw new TRPCError({ code: error.code, message: error.message, cause: error });
  }
  throw error;
}

/**
 * Candidate review is exposed to authenticated operators. The formal Listing
 * sync endpoint intentionally fails closed until transactional CAS is available.
 */
export const listingCandidateReviewProcedures = {
  listCandidates: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        coreRevisionId: z.number().int().positive().optional(),
        includeHistory: z.boolean().default(false),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(
        input.projectId,
        ctx.user,
        ctx.workspaceId ?? null
      );
      requireWorkspaceProject(project, ctx.workspaceId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "候选账本暂不可用",
        });
      const clauses = [
        eq(listingBulletCandidates.workspaceId, ctx.workspaceId!),
        eq(listingBulletCandidates.projectId, input.projectId),
      ];
      if (input.coreRevisionId)
        clauses.push(
          eq(listingBulletCandidates.coreRevisionId, input.coreRevisionId)
        );
      const rows = await db
        .select({
          id: listingBulletCandidates.id,
          candidateKey: listingBulletCandidates.candidateKey,
          candidateRevision: listingBulletCandidates.candidateRevision,
          parentCandidateId: listingBulletCandidates.parentCandidateId,
          coreRevisionId: listingBulletCandidates.coreRevisionId,
          jobId: listingBulletCandidates.jobId,
          skillRunId: listingBulletCandidates.skillRunId,
          promptVersion: listingBulletCandidates.promptVersion,
          actualModel: listingBulletCandidates.actualModel,
          subtitle: listingBulletCandidates.subtitle,
          fullText: listingBulletCandidates.fullText,
          evidenceFactIdsJson: listingBulletCandidates.evidenceFactIdsJson,
          gateResultJson: listingBulletCandidates.gateResultJson,
          status: listingBulletCandidates.status,
          contentHash: listingBulletCandidates.contentHash,
          createdBy: listingBulletCandidates.createdBy,
          staleAt: listingBulletCandidates.staleAt,
          createdAt: listingBulletCandidates.createdAt,
          updatedAt: listingBulletCandidates.updatedAt,
        })
        .from(listingBulletCandidates)
        .where(and(...clauses))
        .orderBy(
          desc(listingBulletCandidates.createdAt),
          desc(listingBulletCandidates.id)
        )
        .limit(input.limit);
      if (input.includeHistory) return rows;
      const current = new Map<string, (typeof rows)[number]>();
      for (const row of rows)
        if (!current.has(row.candidateKey)) current.set(row.candidateKey, row);
      return [...current.values()];
    }),

  listCandidateReviews: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        candidateId: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(500).default(100),
      })
    )
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(
        input.projectId,
        ctx.user,
        ctx.workspaceId ?? null
      );
      requireWorkspaceProject(project, ctx.workspaceId);
      const db = await getDb();
      if (!db)
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "审阅账本暂不可用",
        });
      const clauses = [
        eq(listingReviewRevisions.workspaceId, ctx.workspaceId!),
        eq(listingReviewRevisions.projectId, input.projectId),
      ];
      if (input.candidateId)
        clauses.push(eq(listingReviewRevisions.candidateId, input.candidateId));
      return db
        .select({
          id: listingReviewRevisions.id,
          listingId: listingReviewRevisions.listingId,
          candidateId: listingReviewRevisions.candidateId,
          reviewRevision: listingReviewRevisions.reviewRevision,
          decision: listingReviewRevisions.decision,
          beforeHash: listingReviewRevisions.beforeHash,
          afterHash: listingReviewRevisions.afterHash,
          expectedRevision: listingReviewRevisions.expectedRevision,
          resultingCandidateId: listingReviewRevisions.resultingCandidateId,
          reason: listingReviewRevisions.reason,
          actorId: listingReviewRevisions.actorId,
          createdAt: listingReviewRevisions.createdAt,
        })
        .from(listingReviewRevisions)
        .where(and(...clauses))
        .orderBy(
          desc(listingReviewRevisions.createdAt),
          desc(listingReviewRevisions.id)
        )
        .limit(input.limit);
    }),

  createHumanCandidate: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        coreRevisionId: z.number().int().positive(),
        coreInputHash: z.string().regex(/^[a-f0-9]{64}$/u),
        ...candidateStructureInput,
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(
        input.projectId,
        ctx.user,
        ctx.workspaceId ?? null
      );
      ensureWriteAccess(project, ctx.user);
      requireWorkspaceProject(project, ctx.workspaceId);
      return createListingCandidate({
        ...input,
        workspaceId: ctx.workspaceId!,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
        source: "human",
        // Browser clients cannot invent a successful AI gate result. Human drafts
        // remain auditable and still require current core/fact validation on confirm.
        gateResult: {
          status: "needs_review",
          gateVersion: "human-review-v1",
          submittedBy: "human",
        },
      });
    }),

  editCandidate: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        candidateId: z.number().int().positive(),
        expectedCandidateRevision: z.number().int().positive(),
        ...candidateStructureInput,
        reason: z.string().trim().max(2_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(
        input.projectId,
        ctx.user,
        ctx.workspaceId ?? null
      );
      ensureWriteAccess(project, ctx.user);
      requireWorkspaceProject(project, ctx.workspaceId);
      return editListingCandidate({
        ...input,
        workspaceId: ctx.workspaceId!,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
      });
    }),

  rejectCandidate: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        candidateId: z.number().int().positive(),
        expectedCandidateRevision: z.number().int().positive(),
        reason: z.string().trim().max(2_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(
        input.projectId,
        ctx.user,
        ctx.workspaceId ?? null
      );
      ensureWriteAccess(project, ctx.user);
      requireWorkspaceProject(project, ctx.workspaceId);
      return rejectListingCandidate({
        ...input,
        workspaceId: ctx.workspaceId!,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
      });
    }),

  confirmCandidate: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        candidateId: z.number().int().positive(),
        expectedCandidateRevision: z.number().int().positive(),
        reason: z.string().trim().max(2_000).optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(
        input.projectId,
        ctx.user,
        ctx.workspaceId ?? null
      );
      ensureWriteAccess(project, ctx.user);
      requireWorkspaceProject(project, ctx.workspaceId);
      return confirmListingCandidate({
        ...input,
        workspaceId: ctx.workspaceId!,
        actorId: ctx.user.id,
        actorRole: ctx.user.role,
      });
    }),

  /**
   * Reads and locks every governed dependency, then returns the complete
   * before/after Listing payload plus a short-lived actor-bound CAS token. This
   * query is the only way to mint a token accepted by the final write endpoint.
   */
  previewConfirmedListingSync: protectedProcedure
    .input(
      z.object({
        projectId: z.number().int().positive(),
        candidateId: z.number().int().positive(),
        expectedCandidateRevision: z.number().int().positive(),
      })
    )
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(
        input.projectId,
        ctx.user,
        ctx.workspaceId ?? null
      );
      ensureWriteAccess(project, ctx.user);
      requireWorkspaceProject(project, ctx.workspaceId);
      const listing = await getActiveListingByProject(input.projectId) as LegacyListingRow | null;
      if (!listing || listing.projectId !== input.projectId) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前项目没有可同步的活动正式 Listing" });
      }
      const db = await getDb();
      if (!db) {
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "正式 Listing 同步账本暂不可用" });
      }
      const [candidateCore] = await db
        .select({ sellingPointIndex: listingCoreRevisions.sellingPointIndex })
        .from(listingBulletCandidates)
        .innerJoin(
          listingCoreRevisions,
          eq(listingBulletCandidates.coreRevisionId, listingCoreRevisions.id)
        )
        .where(and(
          eq(listingBulletCandidates.id, input.candidateId),
          eq(listingBulletCandidates.workspaceId, ctx.workspaceId!),
          eq(listingBulletCandidates.projectId, input.projectId),
          eq(listingCoreRevisions.workspaceId, ctx.workspaceId!),
          eq(listingCoreRevisions.projectId, input.projectId),
        ))
        .limit(1);
      if (!candidateCore || !Number.isInteger(candidateCore.sellingPointIndex)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "候选不存在或不属于当前工作空间项目" });
      }
      try {
        const expectedFullHash = hashCompleteListing(listing);
        const preview = await previewListingCandidateSync(listingCandidateSyncDrizzleStore, {
          workspaceId: ctx.workspaceId!,
          projectId: input.projectId,
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
          candidateId: input.candidateId,
          expectedCandidateRevision: input.expectedCandidateRevision,
          listingId: listing.id,
          sellingPointIndex: candidateCore.sellingPointIndex,
          expectedListingVersion: listing.version,
          expectedFullHash,
        });
        const issuedAt = Date.now();
        const previewToken = encodePreviewToken({
          v: 1,
          actorId: ctx.user.id,
          workspaceId: ctx.workspaceId!,
          projectId: input.projectId,
          candidateId: input.candidateId,
          expectedCandidateRevision: input.expectedCandidateRevision,
          listingId: listing.id,
          sellingPointIndex: preview.sellingPointIndex,
          expectedListingVersion: listing.version,
          expectedFullHash,
          issuedAt,
          expiresAt: issuedAt + previewTokenLifetimeMs,
        });
        return { preview, previewToken, expiresAt: issuedAt + previewTokenLifetimeMs };
      } catch (error) {
        rethrowSyncError(error);
      }
    }),

  /**
   * The only endpoint that can write a formal Listing. It requires the signed
   * complete-preview token and revalidates workspace/project write access before
   * running the complete CAS/snapshot/Artifact/legacy-version transaction.
   */
  syncConfirmedToListing: protectedProcedure
    .input(z.object({ previewToken: z.string().min(1).max(4_096) }))
    .mutation(async ({ ctx, input }) => {
      const token = decodePreviewToken(input.previewToken);
      if (token.actorId !== ctx.user.id || token.workspaceId !== ctx.workspaceId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Listing 同步预览令牌不属于当前用户或工作空间" });
      }
      const project = await resolveProjectAccess(token.projectId, ctx.user, ctx.workspaceId ?? null);
      ensureWriteAccess(project, ctx.user);
      requireWorkspaceProject(project, ctx.workspaceId);
      try {
        return await syncConfirmedListingCandidate(listingCandidateSyncDrizzleStore, {
          workspaceId: token.workspaceId,
          projectId: token.projectId,
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
          candidateId: token.candidateId,
          expectedCandidateRevision: token.expectedCandidateRevision,
          listingId: token.listingId,
          sellingPointIndex: token.sellingPointIndex,
          expectedListingVersion: token.expectedListingVersion,
          expectedFullHash: token.expectedFullHash,
        });
      } catch (error) {
        rethrowSyncError(error);
      }
    }),
};
