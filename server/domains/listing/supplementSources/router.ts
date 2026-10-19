import { protectedProcedure, router } from "../../../_core/trpc";
import {
  listingSupplementTransportInputs as inputs,
  SupplementCapabilitiesTransportSchema,
  SupplementPreviewTransportSchema,
  SupplementSaveTransportSchema,
  SupplementOperationTransportSchema,
  SupplementHistoryTransportSchema,
  SupplementDownloadTransportSchema,
  SupplementManifestTransportSchema,
  SupplementDeleteOriginalTransportSchema,
  SupplementDeleteRecordTransportSchema,
} from "../../../../shared/listingSupplementTransport";
import { listingSupplementTransportService } from "./transportService";

/** Root registers this standalone protected collection at
 * listing.supplementSources. Importing it performs no I/O or automatic writes.
 */
export function createListingSupplementSourcesRouter(
  service: typeof listingSupplementTransportService = listingSupplementTransportService
) {
  return router({
    capabilities: protectedProcedure
      .input(inputs.capabilities)
      .output(SupplementCapabilitiesTransportSchema)
      .query(({ ctx, input }) => service.capabilities(ctx, input)),
    // POST, even though parsing is read-only: original bytes cannot go in URLs.
    preview: protectedProcedure
      .input(inputs.preview)
      .output(SupplementPreviewTransportSchema)
      .mutation(({ ctx, input }) => service.preview(ctx, input)),
    save: protectedProcedure
      .input(inputs.save)
      .output(SupplementSaveTransportSchema)
      .mutation(({ ctx, input }) => service.save(ctx, input)),
    check: protectedProcedure
      .input(inputs.check)
      .output(SupplementOperationTransportSchema)
      .query(({ ctx, input }) => service.check(ctx, input)),
    complete: protectedProcedure
      .input(inputs.complete)
      .output(SupplementOperationTransportSchema)
      .mutation(({ ctx, input }) => service.complete(ctx, input)),
    cancel: protectedProcedure
      .input(inputs.cancel)
      .output(SupplementOperationTransportSchema)
      .mutation(({ ctx, input }) => service.cancel(ctx, input)),
    history: protectedProcedure
      .input(inputs.history)
      .output(SupplementHistoryTransportSchema)
      .query(({ ctx, input }) => service.history(ctx, input)),
    download: protectedProcedure
      .input(inputs.download)
      .output(SupplementDownloadTransportSchema)
      .query(({ ctx, input }) => service.download(ctx, input)),
    manifest: protectedProcedure
      .input(inputs.manifest)
      .output(SupplementManifestTransportSchema)
      .query(({ ctx, input }) => service.manifest(ctx, input)),
    deleteOriginal: protectedProcedure
      .input(inputs.deleteOriginal)
      .output(SupplementDeleteOriginalTransportSchema)
      .mutation(({ ctx, input }) => service.deleteOriginal(ctx, input)),
    deleteRecord: protectedProcedure
      .input(inputs.deleteRecord)
      .output(SupplementDeleteRecordTransportSchema)
      .mutation(({ ctx, input }) => service.deleteRecord(ctx, input)),
  });
}
export const listingSupplementSourcesRouter =
  createListingSupplementSourcesRouter();
