import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { resourceConflictError } from "@shared/_core/errors";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import * as kbDb from "../kbDb";
import { resolveStoredObjectUrl } from "../storage";
import { startAmazonAcquisitionJob } from "../domains/acquisition/acquisitionJobs";
import { KbImageImportAsinSchema, parseAmazonUsAsins } from "../domains/acquisition/kbImagesAcquisition";
import {
  KB_PRODUCT_ACQUISITION_CAPABILITIES,
  kbProductConsumerRef,
} from "../domains/acquisition/legacyConsumerContracts";

const protectedProcedure = workspaceScopedProcedure("knowledge");
const MAX_ACQUISITION_USD = 0.1;

async function resolveProductImageUrls<T extends { imageUrls?: string | null }>(item: T | null) {
  if (!item?.imageUrls) return item;
  try {
    const refs = JSON.parse(item.imageUrls);
    if (!Array.isArray(refs)) return item;
    const imageUrls = await Promise.all(refs.map((ref: unknown) => typeof ref === "string" ? resolveStoredObjectUrl(ref) : Promise.resolve("")));
    return { ...item, imageUrls: JSON.stringify(imageUrls.filter(Boolean)) };
  } catch {
    return item;
  }
}

async function createProductAcquisition(input: { workspaceId: number; userId: number; asin: string; productUrl?: string }) {
  const duplicate = await kbDb.findProductInnovationByAsin(input.asin, input.workspaceId);
  if (duplicate && duplicate.status !== "archived") {
    throw resourceConflictError(`ASIN ${input.asin} 已存在于产品知识库中`, {
      existingId: duplicate.id,
      resource: "kb_product",
      asin: input.asin,
    });
  }
  const id = duplicate
    ? duplicate.id
    : Number(await kbDb.createProductInnovation({
      userId: input.userId,
      workspaceId: input.workspaceId,
      asin: input.asin,
      productUrl: input.productUrl ?? `https://www.amazon.com/dp/${input.asin}`,
      status: "crawling",
    }));
  if (duplicate) await kbDb.updateProductInnovation(id, input.userId, input.workspaceId, { status: "crawling" });
  try {
    const job = await startAmazonAcquisitionJob({
      workspaceId: input.workspaceId,
      requestedBy: input.userId,
      consumerType: "kb_product",
      consumerRef: kbProductConsumerRef(id),
      marketplace: "US",
      asin: input.asin,
      capabilities: [...KB_PRODUCT_ACQUISITION_CAPABILITIES],
      cachePolicy: "prefer_cache",
      maxChargeUsd: MAX_ACQUISITION_USD,
    });
    return { id, asin: input.asin, ...job, reviewRequired: job.status !== "confirmed" };
  } catch (error) {
    await kbDb.updateProductInnovation(id, input.userId, input.workspaceId, { status: "archived" });
    throw error;
  }
}

export const kbProductsRouter = router({
  list: protectedProcedure
    .input(z.object({ scope: z.enum(["mine", "shared", "all"]).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const rows = await kbDb.listProductInnovations(ctx.user.id, ctx.workspaceId!, input?.scope ?? "mine");
      return Promise.all(rows.map(row => resolveProductImageUrls(row)));
    }),

  getById: protectedProcedure
    .input(z.object({ id: z.number() }))
    .query(async ({ ctx, input }) => resolveProductImageUrls(await kbDb.getProductInnovation(input.id, ctx.user.id, ctx.workspaceId!))),

  importByAsin: protectedProcedure
    .input(z.object({ asin: z.string().min(1) }))
    .mutation(({ ctx, input }) => createProductAcquisition({
      workspaceId: ctx.workspaceId!,
      userId: ctx.user.id,
      asin: KbImageImportAsinSchema.parse(input.asin),
    })),

  batchImportAsins: protectedProcedure
    .input(z.object({ asins: z.array(z.string()).min(1).max(50) }))
    .mutation(async ({ ctx, input }) => {
      const asins = [...new Set(input.asins.map(value => KbImageImportAsinSchema.parse(value)))];
      const items: Array<Awaited<ReturnType<typeof createProductAcquisition>>> = [];
      const skippedItems: Array<{ asin: string; existingId: number }> = [];
      for (const asin of asins) {
        const duplicate = await kbDb.findProductInnovationByAsin(asin, ctx.workspaceId!);
        if (duplicate && duplicate.status !== "archived") {
          skippedItems.push({ asin, existingId: duplicate.id });
          continue;
        }
        items.push(await createProductAcquisition({ workspaceId: ctx.workspaceId!, userId: ctx.user.id, asin }));
      }
      return { imported: items.length, skipped: skippedItems.length, items, skippedItems };
    }),

  importByLink: protectedProcedure
    .input(z.object({ url: z.string().trim().min(1).max(20_000) }))
    .mutation(async ({ ctx, input }) => {
      const asins = parseAmazonUsAsins(input.url);
      if (asins.length !== 1) throw new TRPCError({ code: "BAD_REQUEST", message: "请输入一个Amazon美国站商品链接" });
      return createProductAcquisition({ workspaceId: ctx.workspaceId!, userId: ctx.user.id, asin: asins[0], productUrl: input.url });
    }),

  confirmAnalysis: protectedProcedure
    .input(z.object({ id: z.number(), editedAnalysis: z.string().optional() }))
    .mutation(async ({ ctx, input }) => {
      const update: Record<string, unknown> = { status: "confirmed" as const, confirmedAt: new Date() };
      if (input.editedAnalysis) update.userEditedAnalysis = input.editedAnalysis;
      await kbDb.updateProductInnovation(input.id, ctx.user.id, ctx.workspaceId!, update);
      return { success: true };
    }),

  updateTags: protectedProcedure
    .input(z.object({ id: z.number(), tags: z.string() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateProductInnovation(input.id, ctx.user.id, ctx.workspaceId!, { tags: input.tags });
      return { success: true };
    }),

  updateScore: protectedProcedure
    .input(z.object({ id: z.number(), score: z.number().min(1).max(10) }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.updateProductInnovation(input.id, ctx.user.id, ctx.workspaceId!, { overallScore: input.score });
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.number() }))
    .mutation(async ({ ctx, input }) => {
      await kbDb.deleteProductInnovation(input.id, ctx.user.id, ctx.workspaceId!);
      return { success: true };
    }),
});
