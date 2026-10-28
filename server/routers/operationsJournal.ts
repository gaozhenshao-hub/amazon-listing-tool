import { z } from "zod";
import { protectedProcedure, router } from "../_core/trpc";
import { JournalReadSchema, JournalSaveSchema } from "../../shared/operationsJournal";
import { operationsJournalRepository as journal } from "../domains/ops/operationsJournal";
export const operationsJournalRouter = router({
  options: protectedProcedure.input(z.object({ expectedWorkspaceId: z.number().int().positive() }).strict()).query(({ ctx, input }) => journal.options(ctx, input.expectedWorkspaceId)),
  read: protectedProcedure.input(JournalReadSchema).query(({ ctx, input }) => journal.read(ctx, input)),
  save: protectedProcedure.input(JournalSaveSchema).mutation(({ ctx, input }) => journal.save(ctx, input)),
});
