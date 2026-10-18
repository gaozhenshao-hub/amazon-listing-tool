import { protectedProcedure } from "../../../_core/trpc";
import { ListingAuxiliaryPreviewInputSchema, ListingAuxiliaryPreviewResultSchema, ListingAuxiliaryStartInputSchema, ListingAuxiliaryOperationInputSchema,
  ListingAuxiliaryViewSchema, ListingAuxiliaryApplyInputSchema, ListingAuxiliaryApplyOperationInputSchema, ListingAuxiliaryApplyReceiptSchema,
  ListingAuxiliaryHistoryInputSchema, ListingAuxiliaryHistoryResultSchema } from "../../../../shared/listingAuxiliaryWorkflow";
import { listingAuxiliaryService } from "../services/listingAuxiliaryService";
export const listingAuxiliaryProcedures = {
  auxiliaryPreview: protectedProcedure.input(ListingAuxiliaryPreviewInputSchema).output(ListingAuxiliaryPreviewResultSchema).query(({ ctx, input }) => listingAuxiliaryService.preview(ctx, input)),
  auxiliaryStart: protectedProcedure.input(ListingAuxiliaryStartInputSchema).output(ListingAuxiliaryViewSchema).mutation(({ ctx, input }) => listingAuxiliaryService.start(ctx, input)),
  auxiliaryCheck: protectedProcedure.input(ListingAuxiliaryOperationInputSchema).output(ListingAuxiliaryViewSchema).query(({ ctx, input }) => listingAuxiliaryService.check(ctx, input)),
  auxiliaryCancel: protectedProcedure.input(ListingAuxiliaryOperationInputSchema).output(ListingAuxiliaryViewSchema).mutation(({ ctx, input }) => listingAuxiliaryService.cancel(ctx, input)),
  auxiliaryApply: protectedProcedure.input(ListingAuxiliaryApplyInputSchema).output(ListingAuxiliaryApplyReceiptSchema).mutation(({ ctx, input }) => listingAuxiliaryService.apply(ctx, input)),
  auxiliaryApplyCheck: protectedProcedure.input(ListingAuxiliaryApplyOperationInputSchema).output(ListingAuxiliaryApplyReceiptSchema).query(({ ctx, input }) => listingAuxiliaryService.applyCheck(ctx, input)),
  auxiliaryApplyCancel: protectedProcedure.input(ListingAuxiliaryApplyOperationInputSchema).output(ListingAuxiliaryApplyReceiptSchema).mutation(({ ctx, input }) => listingAuxiliaryService.applyCancel(ctx, input)),
  auxiliaryHistory: protectedProcedure.input(ListingAuxiliaryHistoryInputSchema).output(ListingAuxiliaryHistoryResultSchema).query(({ ctx, input }) => listingAuxiliaryService.history(ctx, input)),
};
