import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../../_core/trpc";
import { readQualityDashboard } from "./qualityDashboardService";

/**
 * Integration prototype: the parent task may mount this router under `quality`
 * in server/routers.ts. It has no mutation procedures and no client-provided
 * workspace identifier; scope comes only from authenticated context.
 */
export const qualityDashboardRouter = router({
  dashboard: protectedProcedure.query(async ({ ctx }) => {
    if (!ctx.workspaceId) {
      throw new TRPCError({ code: "FORBIDDEN", message: "请先选择项目所属的工作空间" });
    }

    return readQualityDashboard({ workspaceId: ctx.workspaceId });
  }),
});
