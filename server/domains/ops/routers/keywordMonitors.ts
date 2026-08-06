import { protectedProcedure } from "../workspaceProcedure";
import { opsWorkService as service } from "../workManagement/service";
import {
  addKeywordMonitorInput,
  addKeywordSnapshotInput,
  idInput,
  productIdInput,
} from "../workManagement/schema";

export const opsKeywordMonitorProcedures = {
  getKeywordMonitors: protectedProcedure.input(productIdInput).query(({ input }) => service.listKeywordMonitors(input.productId)),
  addKeywordMonitor: protectedProcedure.input(addKeywordMonitorInput).mutation(({ ctx, input }) => service.addKeywordMonitor(ctx.user.id, input)),
  removeKeywordMonitor: protectedProcedure.input(idInput).mutation(({ input }) => service.removeKeywordMonitor(input.id)),
  addKeywordSnapshot: protectedProcedure.input(addKeywordSnapshotInput).mutation(({ input }) => service.addKeywordSnapshot(input)),
};
