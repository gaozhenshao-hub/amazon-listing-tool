import { protectedProcedure, router } from "../_core/trpc";
import {
  OperationsBoardEditionStateInputSchema, OperationsBoardEditionStateResultSchema,
  OperationsBoardEditionReadInputSchema, OperationsBoardEditionReadResultSchema,
  OperationsBoardEditionHistoryInputSchema, OperationsBoardEditionHistoryResultSchema,
  OperationsBoardEditionPreviewInputSchema, OperationsBoardEditionPreviewResultSchema,
  OperationsBoardEditionExecuteInputSchema, OperationsBoardEditionSaveNoteInputSchema,
  OperationsBoardEditionRecoverInputSchema, OperationsBoardEditionWriteResultSchema,
} from "../../shared/operationsBoardEdition";
import {
  OperationsBoardPartnersOptionsInputSchema, OperationsBoardPartnersOptionsResultSchema,
  OperationsBoardPartnersExecuteInputSchema, OperationsBoardPartnersRecoverInputSchema, OperationsBoardPartnersWriteResultSchema,
} from "../../shared/operationsBoardPartners";
import { operationsBoardRepository } from "../domains/ops/operationsBoardRepository";
import { operationsBoardPartnerRepository } from "../domains/ops/operationsBoardPartnerRepository";

/** Dedicated optional workflow; no replacement of the existing live board or
 * legacy import routes. Recovery is a mutation because cancel persists a fence. */
export const operationsBoardRouter = router({
  state: protectedProcedure.input(OperationsBoardEditionStateInputSchema).output(OperationsBoardEditionStateResultSchema)
    .query(({ ctx, input }) => operationsBoardRepository.state(ctx, input)),
  read: protectedProcedure.input(OperationsBoardEditionReadInputSchema).output(OperationsBoardEditionReadResultSchema)
    .query(({ ctx, input }) => operationsBoardRepository.read(ctx, input)),
  history: protectedProcedure.input(OperationsBoardEditionHistoryInputSchema).output(OperationsBoardEditionHistoryResultSchema)
    .query(({ ctx, input }) => operationsBoardRepository.history(ctx, input)),
  preview: protectedProcedure.input(OperationsBoardEditionPreviewInputSchema).output(OperationsBoardEditionPreviewResultSchema)
    .query(({ ctx, input }) => operationsBoardRepository.preview(ctx, input)),
  execute: protectedProcedure.input(OperationsBoardEditionExecuteInputSchema).output(OperationsBoardEditionWriteResultSchema)
    .mutation(({ ctx, input }) => operationsBoardRepository.execute(ctx, input)),
  saveNote: protectedProcedure.input(OperationsBoardEditionSaveNoteInputSchema).output(OperationsBoardEditionWriteResultSchema)
    .mutation(({ ctx, input }) => operationsBoardRepository.saveNote(ctx, input)),
  recover: protectedProcedure.input(OperationsBoardEditionRecoverInputSchema).output(OperationsBoardEditionWriteResultSchema)
    .mutation(({ ctx, input }) => operationsBoardRepository.recover(ctx, input)),
  partnerOptions: protectedProcedure.input(OperationsBoardPartnersOptionsInputSchema).output(OperationsBoardPartnersOptionsResultSchema)
    .query(({ ctx, input }) => operationsBoardPartnerRepository.options(ctx, input)),
  setPartner: protectedProcedure.input(OperationsBoardPartnersExecuteInputSchema).output(OperationsBoardPartnersWriteResultSchema)
    .mutation(({ ctx, input }) => operationsBoardPartnerRepository.execute(ctx, input)),
  recoverPartner: protectedProcedure.input(OperationsBoardPartnersRecoverInputSchema).output(OperationsBoardPartnersWriteResultSchema)
    .mutation(({ ctx, input }) => operationsBoardPartnerRepository.recover(ctx, input)),
});
