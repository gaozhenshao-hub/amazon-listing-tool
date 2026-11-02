import { createHmac, timingSafeEqual } from "node:crypto";

import * as shared from "../routerContext";
import {
  ListingCompleteRestoreError,
  listGovernedCompleteRestoreSnapshots,
  previewGovernedCompleteRestore,
  restoreGovernedCompleteSnapshot,
} from "../services/listingCompleteRestoreService";
import { listingCompleteRestoreDrizzleStore } from "../services/listingCompleteRestoreDrizzleStore";
import {
  hashCompleteListing,
  type LegacyListingRow,
} from "../services/listingCandidateSyncService";

const {
  TRPCError,
  db,
  ensureWriteAccess,
  protectedProcedure,
  resolveProjectAccess,
  z,
} = shared;

const restorePreviewTokenLifetimeMs = 10 * 60 * 1000;

type ListingRestorePreviewTokenPayload = {
  v: 1;
  actorId: number;
  workspaceId: number;
  projectId: number;
  sourceSnapshotId: number;
  listingId: number;
  expectedListingVersion: number;
  expectedFullHash: string;
  expectedSourceFullHash: string;
  issuedAt: number;
  expiresAt: number;
};

function restorePreviewTokenSecret(): string {
  const secret = process.env.JWT_SECRET || "";
  if (!secret) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "完整 Listing 快照恢复预览不可用：服务端确认密钥未配置",
    });
  }
  return secret;
}

function encodeRestorePreviewToken(payload: ListingRestorePreviewTokenPayload): string {
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const signature = createHmac("sha256", restorePreviewTokenSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${signature}`;
}

function sameSignature(expected: string, received: string): boolean {
  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(received);
  return expectedBuffer.length === receivedBuffer.length && timingSafeEqual(expectedBuffer, receivedBuffer);
}

function decodeRestorePreviewToken(token: string): ListingRestorePreviewTokenPayload {
  const [encoded, signature, ...extra] = token.split(".");
  if (!encoded || !signature || extra.length > 0) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "必须先查看完整快照恢复预览" });
  }
  const expected = createHmac("sha256", restorePreviewTokenSecret())
    .update(encoded)
    .digest("base64url");
  if (!sameSignature(expected, signature)) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "完整快照恢复确认令牌无效或已被篡改" });
  }
  try {
    const value = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ListingRestorePreviewTokenPayload;
    const validHash = (hash: unknown) => typeof hash === "string" && /^[a-f0-9]{64}$/u.test(hash);
    if (
      value.v !== 1 ||
      !Number.isSafeInteger(value.actorId) ||
      !Number.isSafeInteger(value.workspaceId) ||
      !Number.isSafeInteger(value.projectId) ||
      !Number.isSafeInteger(value.sourceSnapshotId) ||
      !Number.isSafeInteger(value.listingId) ||
      !Number.isSafeInteger(value.expectedListingVersion) ||
      !validHash(value.expectedFullHash) ||
      !validHash(value.expectedSourceFullHash) ||
      !Number.isSafeInteger(value.issuedAt) ||
      !Number.isSafeInteger(value.expiresAt) ||
      value.issuedAt > Date.now() ||
      value.expiresAt < Date.now() ||
      value.expiresAt - value.issuedAt !== restorePreviewTokenLifetimeMs
    ) throw new Error("invalid");
    return value;
  } catch {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "完整快照恢复确认令牌无效或已过期，请重新查看预览",
    });
  }
}

function requireGovernedRestoreWorkspace(
  project: { workspaceId?: number | null },
  workspaceId?: number | null,
) {
  if (!workspaceId || project.workspaceId !== workspaceId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "请先选择完整快照所属的工作空间",
    });
  }
}

function rethrowRestoreError(error: unknown): never {
  if (error instanceof ListingCompleteRestoreError) {
    throw new TRPCError({ code: error.code, message: error.message, cause: error });
  }
  throw error;
}

export const listingVersionProcedures = {


  // ─── Version History Procedures ───

  // Get version history for a project
  getVersionHistory: protectedProcedure
    .input(z.object({ projectId: z.number() }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      ensureListingWorkspaceAccess(project, ctx.workspaceId);
      return db.getListingVersionsByProject(input.projectId);
    }),


  // Rollback to a specific version
  rollbackToVersion: protectedProcedure
    .input(z.object({
      versionId: z.number(),
      projectId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Legacy rows carry only a partial snapshot and this path has no
      // compare-and-swap guard. It must not restore bullet content until the
      // governed full-Listing snapshot rollback is available.
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "旧版本回滚已停用：该版本不是受治理的完整快照且不支持 CAS。请迁移/使用已审核的完整 Listing 快照回滚流程",
      });
    }),

  /**
   * Snapshot selection intentionally enumerates only 0204 approved full payloads.
   * `listingVersions` is left to getVersionHistory for read-only historical view.
   */
  listGovernedCompleteRestoreSnapshots: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      limit: z.number().int().min(1).max(500).default(100),
    }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      ensureWriteAccess(project, ctx.user);
      requireGovernedRestoreWorkspace(project, ctx.workspaceId);
      try {
        return await listGovernedCompleteRestoreSnapshots(listingCompleteRestoreDrizzleStore, {
          workspaceId: ctx.workspaceId!,
          projectId: input.projectId,
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
          limit: input.limit,
        });
      } catch (error) {
        rethrowRestoreError(error);
      }
    }),

  /**
   * The human-review preview reads both complete payloads and mints an actor- and
   * workspace-bound HMAC token. No restore occurs in this query.
   */
  previewGovernedCompleteRestore: protectedProcedure
    .input(z.object({
      projectId: z.number().int().positive(),
      sourceSnapshotId: z.number().int().positive(),
    }))
    .query(async ({ ctx, input }) => {
      const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
      ensureWriteAccess(project, ctx.user);
      requireGovernedRestoreWorkspace(project, ctx.workspaceId);
      const listing = await db.getActiveListingByProject(input.projectId) as LegacyListingRow | null;
      if (!listing || listing.projectId !== input.projectId) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前项目没有可恢复的活动正式 Listing" });
      }
      try {
        const expectedFullHash = hashCompleteListing(listing);
        // The server locks and verifies the selected source before returning its
        // full payload. No source hash is accepted from the browser at preview.
        const preview = await previewGovernedCompleteRestore(listingCompleteRestoreDrizzleStore, {
          workspaceId: ctx.workspaceId!,
          projectId: input.projectId,
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
          sourceSnapshotId: input.sourceSnapshotId,
          listingId: listing.id,
          expectedListingVersion: listing.version,
          expectedFullHash,
        });
        const expectedSourceFullHash = preview.sourceSnapshot.fullHash;
        const issuedAt = Date.now();
        const restoreToken = encodeRestorePreviewToken({
          v: 1,
          actorId: ctx.user.id,
          workspaceId: ctx.workspaceId!,
          projectId: input.projectId,
          sourceSnapshotId: input.sourceSnapshotId,
          listingId: listing.id,
          expectedListingVersion: listing.version,
          expectedFullHash,
          expectedSourceFullHash,
          issuedAt,
          expiresAt: issuedAt + restorePreviewTokenLifetimeMs,
        });
        return { preview, restoreToken, expiresAt: issuedAt + restorePreviewTokenLifetimeMs };
      } catch (error) {
        rethrowRestoreError(error);
      }
    }),

  /**
   * The sole full-snapshot write endpoint. No client-supplied payload, source
   * hash, version, or Listing ID is accepted outside the signed preview token.
   */
  restoreGovernedCompleteSnapshot: protectedProcedure
    .input(z.object({ restoreToken: z.string().min(1).max(4_096) }))
    .mutation(async ({ ctx, input }) => {
      const token = decodeRestorePreviewToken(input.restoreToken);
      if (token.actorId !== ctx.user.id || token.workspaceId !== ctx.workspaceId) {
        throw new TRPCError({ code: "FORBIDDEN", message: "完整快照恢复令牌不属于当前用户或工作空间" });
      }
      const project = await resolveProjectAccess(token.projectId, ctx.user, ctx.workspaceId ?? null);
      ensureWriteAccess(project, ctx.user);
      requireGovernedRestoreWorkspace(project, ctx.workspaceId);
      try {
        return await restoreGovernedCompleteSnapshot(listingCompleteRestoreDrizzleStore, {
          workspaceId: token.workspaceId,
          projectId: token.projectId,
          actorId: ctx.user.id,
          actorRole: ctx.user.role,
          sourceSnapshotId: token.sourceSnapshotId,
          listingId: token.listingId,
          expectedListingVersion: token.expectedListingVersion,
          expectedFullHash: token.expectedFullHash,
          expectedSourceFullHash: token.expectedSourceFullHash,
        });
      } catch (error) {
        rethrowRestoreError(error);
      }
    }),
};

function ensureListingWorkspaceAccess(
  project: { workspaceId?: number | null },
  workspaceId?: number | null,
) {
  // Match project repository workspace scoping: an unscoped legacy project is
  // visible in every workspace, while a workspace-bound project must match.
  if (workspaceId === undefined) return;
  if (workspaceId === null) {
    if (project.workspaceId != null) throw new Error("Project not found");
    return;
  }
  if (project.workspaceId != null && project.workspaceId !== workspaceId) {
    throw new Error("Project not found");
  }
}
