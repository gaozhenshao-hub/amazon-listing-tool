import * as shared from "../routerContext";
import { getCurrentRawFactSuggestions } from "../services/listingFactSource";
import { reviewListingRawFact } from "../services/listingFactReviewService";
import { listingFactRevisions } from "../../../../drizzle/schema/listingRevisions";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "../repository";

const { protectedProcedure, resolveProjectAccess, ensureWriteAccess, z, TRPCError } = shared;

export const listingFactReviewProcedures = {
  listReviewedFacts: protectedProcedure.input(z.object({ projectId: z.number().int().positive() })).query(async ({ ctx, input }) => {
    const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
    if (!ctx.workspaceId || project.workspaceId !== ctx.workspaceId)
      throw new TRPCError({ code: "FORBIDDEN", message: "请先选择项目所属的工作空间" });
    const database = await getDb();
    if (!database) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "事实账本暂不可用" });
    const rows = await database.select({ id: listingFactRevisions.id, attributeKey: listingFactRevisions.attributeKey,
      value: listingFactRevisions.value, sourceFileId: listingFactRevisions.sourceFileId, sourceLine: listingFactRevisions.sourceLine,
      status: listingFactRevisions.status, revision: listingFactRevisions.revision,
      reviewNote: listingFactRevisions.reviewNote, confirmedAt: listingFactRevisions.confirmedAt })
      .from(listingFactRevisions).where(and(eq(listingFactRevisions.workspaceId, ctx.workspaceId),
        eq(listingFactRevisions.projectId, input.projectId)))
      .orderBy(desc(listingFactRevisions.revision), desc(listingFactRevisions.id)).limit(1_000);
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (!latest.has(row.attributeKey)) latest.set(row.attributeKey, row);
    return [...latest.values()];
  }),
  listRawFactSuggestions: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(),
    offset: z.number().int().min(0).max(100_000).default(0),
    limit: z.number().int().min(1).max(100).default(30),
  })).query(async ({ ctx, input }) => {
    const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
    if (!project || !ctx.workspaceId || project.workspaceId !== ctx.workspaceId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "请先选择项目所属的工作空间并核对历史项目归属" });
    }
    const result = await getCurrentRawFactSuggestions(input.projectId, ctx.workspaceId);
    return { status: result.status, file: result.file, total: result.suggestions.length,
      suggestions: result.suggestions.slice(input.offset, input.offset + input.limit) };
  }),
  reviewRawFact: protectedProcedure.input(z.object({
    projectId: z.number().int().positive(), fileId: z.number().int().positive(),
    rawHash: z.string().regex(/^[a-f0-9]{64}$/u), sourceLine: z.number().int().positive(),
    sourceLineHash: z.string().regex(/^[a-f0-9]{64}$/u), expectedRevision: z.number().int().min(0),
    decision: z.enum(["confirm", "reject"]), correctedValue: z.string().trim().max(500).optional(),
    reviewNote: z.string().trim().max(2000).optional(), proofFileId: z.number().int().positive().optional(),
  })).mutation(async ({ ctx, input }) => {
    const project = await resolveProjectAccess(input.projectId, ctx.user, ctx.workspaceId ?? null);
    ensureWriteAccess(project, ctx.user);
    if (!ctx.workspaceId || project.workspaceId !== ctx.workspaceId)
      throw new TRPCError({ code: "FORBIDDEN", message: "请先选择项目所属的工作空间" });
    return reviewListingRawFact({ ...input, workspaceId: ctx.workspaceId, actorId: ctx.user.id, actorRole: ctx.user.role });
  }),
};
