import { protectedProcedure } from "../../../_core/trpc";
import { ListingConfiguredPreviewInputSchema, ListingConfiguredPreviewResultSchema, ListingConfiguredStartInputSchema, ListingConfiguredOperationInputSchema,
  ListingConfiguredViewSchema, ListingConfiguredApplyInputSchema, ListingConfiguredApplyOperationInputSchema, ListingConfiguredApplyReceiptSchema,
  ListingConfiguredHistoryInputSchema, ListingConfiguredHistoryResultSchema } from "../../../../shared/listingConfiguredWorkflow";
import { listingConfiguredService } from "../services/listingConfiguredService";
export const listingConfiguredProcedures = {
  configuredPreview: protectedProcedure.input(ListingConfiguredPreviewInputSchema).output(ListingConfiguredPreviewResultSchema).query(({ ctx, input }) => listingConfiguredService.preview(ctx, input)),
  configuredStart: protectedProcedure.input(ListingConfiguredStartInputSchema).output(ListingConfiguredViewSchema).mutation(({ ctx, input }) => listingConfiguredService.start(ctx, input)),
  configuredCheck: protectedProcedure.input(ListingConfiguredOperationInputSchema).output(ListingConfiguredViewSchema).query(({ ctx, input }) => listingConfiguredService.check(ctx, input)),
  configuredCancel: protectedProcedure.input(ListingConfiguredOperationInputSchema).output(ListingConfiguredViewSchema).mutation(({ ctx, input }) => listingConfiguredService.cancel(ctx, input)),
  configuredApply: protectedProcedure.input(ListingConfiguredApplyInputSchema).output(ListingConfiguredApplyReceiptSchema).mutation(({ ctx, input }) => listingConfiguredService.apply(ctx, input)),
  configuredApplyCheck: protectedProcedure.input(ListingConfiguredApplyOperationInputSchema).output(ListingConfiguredApplyReceiptSchema).query(({ ctx, input }) => listingConfiguredService.applyCheck(ctx, input)),
  configuredApplyCancel: protectedProcedure.input(ListingConfiguredApplyOperationInputSchema).output(ListingConfiguredApplyReceiptSchema).mutation(({ ctx, input }) => listingConfiguredService.applyCancel(ctx, input)),
  configuredHistory: protectedProcedure.input(ListingConfiguredHistoryInputSchema).output(ListingConfiguredHistoryResultSchema).query(({ ctx, input }) => listingConfiguredService.history(ctx, input)),
};
