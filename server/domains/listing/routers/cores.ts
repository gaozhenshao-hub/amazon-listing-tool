import { and, desc, eq } from "drizzle-orm";
import { listingCoreRevisions } from "../../../../drizzle/schema/listingRevisions";
import * as shared from "../routerContext";
import { getDb } from "../repository";
import { reviewListingCore } from "../services/listingCoreReviewService";

const { protectedProcedure, resolveProjectAccess, ensureWriteAccess, z, TRPCError } = shared;

export const listingCoreReviewProcedures = {
  listCurrentCores: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
    if (!ctx.workspaceId || project.workspaceId !== ctx.workspaceId) throw new TRPCError({ code: "FORBIDDEN" });
    const db = await getDb();
    if (!db) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
    const rows = await db.select({ id: listingCoreRevisions.id, coreId: listingCoreRevisions.coreId,
      sellingPointIndex: listingCoreRevisions.sellingPointIndex, buyerReason: listingCoreRevisions.buyerReason,
      factRevisionIdsJson: listingCoreRevisions.factRevisionIdsJson, status: listingCoreRevisions.status,
      revision: listingCoreRevisions.revision, inputHash: listingCoreRevisions.inputHash,
      confirmedBy: listingCoreRevisions.confirmedBy, confirmedAt: listingCoreRevisions.confirmedAt,
    }).from(listingCoreRevisions).where(and(eq(listingCoreRevisions.workspaceId, ctx.workspaceId), eq(listingCoreRevisions.projectId, input.projectId)))
      .orderBy(desc(listingCoreRevisions.revision), desc(listingCoreRevisions.id)).limit(500);
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (!latest.has(row.coreId)) latest.set(row.coreId, row);
    return [...latest.values()].sort((a, b) => a.sellingPointIndex - b.sellingPointIndex);
  }),
  reviewCore: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(), coreId: z.string().uuid().optional(),
    sellingPointIndex: z.number().int().min(0).max(8), buyerReason: z.string().trim().min(1).max(500),
    factRevisionIds: z.array(z.number().int().positive()).min(1).max(30), expectedRevision: z.number().int().min(0),
    decision: z.enum(["draft", "confirm", "reject"]),
  })).mutation(async ({ ctx, input }) => {
    const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
    ensureWriteAccess(project, ctx.user);
    if (!ctx.workspaceId || project.workspaceId !== ctx.workspaceId)
      throw new TRPCError({ code: "FORBIDDEN", message: "请选择项目所属工作空间" });
    return reviewListingCore({ ...input, workspaceId: ctx.workspaceId, actorId: ctx.user.id, actorRole: ctx.user.role });
  }),
};
