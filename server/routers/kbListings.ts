import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { resourceConflictError } from "@shared/_core/errors";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import * as kbDb from "../kbDb";
import { startAmazonAcquisitionJob } from "../domains/acquisition/acquisitionJobs";
import { KbImageImportAsinSchema, parseAmazonUsAsins } from "../domains/acquisition/kbImagesAcquisition";
import {
  KB_LISTING_ACQUISITION_CAPABILITIES,
  kbListingConsumerRef,
} from "../domains/acquisition/legacyConsumerContracts";

const protectedProcedure = workspaceScopedProcedure("knowledge");
const MAX_ACQUISITION_USD = 0.1;

async function createListingAcquisition(input: { workspaceId: number; userId: number; asin: string }) {
  const duplicate = await kbDb.findListingCopywritingByAsin(input.asin, input.workspaceId);
  if (duplicate && duplicate.status !== "archived") {
    throw resourceConflictError(`ASIN ${input.asin} 已存在于 Listing 知识库中`, {
      existingId: duplicate.id,
      resource: "kb_listing",
      asin: input.asin,
    });
  }
  const id = duplicate
    ? duplicate.id
    : Number(await kbDb.createListingCopywriting({
      userId: input.userId,
      workspaceId: input.workspaceId,
      asin: input.asin,
      status: "crawling",
    }));
  if (duplicate) await kbDb.updateListingCopywriting(id, input.userId, input.workspaceId, { status: "crawling" });
  try {
    const job = await startAmazonAcquisitionJob({
      workspaceId: input.workspaceId,
      requestedBy: input.userId,
      consumerType: "kb_listing",
      consumerRef: kbListingConsumerRef(id),
      marketplace: "US",
      asin: input.asin,
      capabilities: [...KB_LISTING_ACQUISITION_CAPABILITIES],
      cachePolicy: "prefer_cache",
      maxChargeUsd: MAX_ACQUISITION_USD,
    });
    return { id, asin: input.asin, ...job, reviewRequired: job.status !== "confirmed" };
  } catch (error) {
    await kbDb.updateListingCopywriting(id, input.userId, input.workspaceId, { status: "archived" });
    throw error;
  }
}

export const kbListingsRouter = router({
  list: protectedProcedure
    .input(z.object({ scope: z.enum(["mine", "shared", "all"]).optional() }).optional())
    .query(({ ctx, input }) => kbDb.listListingCopywriting(ctx.user.id, ctx.workspaceId!, input?.scope ?? "mine")),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(({ ctx, input }) => kbDb.getListingCopywriting(input.id, ctx.user.id, ctx.workspaceId!)),

  importByAsin: protectedProcedure
    .input(z.object({ asin: z.string().min(1) }))
    .mutation(({ ctx, input }) => createListingAcquisition({
      workspaceId: ctx.workspaceId!,
      userId: ctx.user.id,
      asin: KbImageImportAsinSchema.parse(input.asin),
    })),

  batchImportAsins: protectedProcedure
    .input(z.object({ asins: z.array(z.string()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const asins = [...new Set(input.asins.map(value => KbImageImportAsinSchema.parse(value)))];
      const items: Array<Awaited<ReturnType<typeof createListingAcquisition>>> = [];
      const skippedItems: Array<{ asin: string; existingId: number }> = [];
      for (const asin of asins) {
        const duplicate = await kbDb.findListingCopywritingByAsin(asin, ctx.workspaceId!);
        if (duplicate && duplicate.status !== "archived") {
          skippedItems.push({ asin, existingId: duplicate.id });
          continue;
        }
        items.push(await createListingAcquisition({ workspaceId: ctx.workspaceId!, userId: ctx.user.id, asin }));
      }
      return { imported: items.length, skipped: skippedItems.length, items, skippedItems };
    }),

  importByLink: protectedProcedure
    .input(z.object({ url: z.string().trim().min(1).max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      const asins = parseAmazonUsAsins(input.url);
      if (asins.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入一个Amazon美国站商品链接" });
      return createListingAcquisition({ workspaceId: ctx.workspaceId!, userId: ctx.user.id, asin: asins[0] });
    }),

  confirmAnalysis: protectedProcedure
    .input(z.object({ id: z.number(), editedAnalysis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = { status: "confirmed" as const, confirmedAt: new Date() };
      if (input.editedAnalysis) update.userEditedAnalysis = input.editedAnalysis;
      await kbDb.updateListingCopywriting(input.id, ctx.user.id, ctx.workspaceId!, update);
      return { success: true };
    }),

  updateTags: protectedProcedure
    .input(z.object({ id: z.number(), tags: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateListingCopywriting(input.id, ctx.user.id, ctx.workspaceId!, { tags: input.tags });
      return { success: true };
    }),

  updateScore: protectedProcedure
    .input(z.object({ id: z.number(), score: z.number().min(1).max(100) }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateListingCopywriting(input.id, ctx.user.id, ctx.workspaceId!, { overallScore: input.score });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.deleteListingCopywriting(input.id, ctx.user.id, ctx.workspaceId!);
      return { success: true };
    }),
});
