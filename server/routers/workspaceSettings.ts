import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { router } from "../_core/trpc";
import { workspaceScopedProcedure } from "../domains/ai_os/workspaceScopedProcedure";
import {
  readWorkspaceSaihu,
  saveWorkspaceSaihu,
  testWorkspaceSaihu,
  saihuSettingsInput,
} from "../domains/apiConnections/workspaceSaihu";
function actor(ctx: {
  workspaceId?: number | null;
  user: { id: number; role: string };
}) {
  if (!ctx.workspaceId || !["admin", "super_admin"].includes(ctx.user.role))
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "管理员可以管理API接口配置",
    });
  return { workspaceId: ctx.workspaceId, userId: ctx.user.id };
}
export const workspaceSettingsRouter = router({
  saihu: workspaceScopedProcedure("ops_data").query(({ ctx }) =>
    readWorkspaceSaihu(actor(ctx))
  ),
  saveSaihu: workspaceScopedProcedure("ops_data", "update")
    .input(saihuSettingsInput)
    .mutation(({ ctx, input }) => saveWorkspaceSaihu(actor(ctx), input)),
  testSaihu: workspaceScopedProcedure("ops_data", "update")
    .input(
      z.object({ expectedVersion: z.string().regex(/^[a-f0-9]{64}$/) }).strict()
    )
    .mutation(({ ctx, input }) =>
      testWorkspaceSaihu(actor(ctx), input.expectedVersion)
    ),
});
