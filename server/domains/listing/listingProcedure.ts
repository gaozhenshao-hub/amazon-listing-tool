import { protectedProcedure as authenticatedProcedure } from "../../_core/trpc";
import { TRPCError } from "@trpc/server";
import { actorFromContext, assertResourceAction } from "../../services/securityGovernance";

/** Module permissions complement the project-owner and revision checks in each
 * handler. A read-only account must not write through a hidden API endpoint. */
export const protectedProcedure = authenticatedProcedure.use(async ({ ctx, type, next }) => {
  if (ctx.workspaceId === undefined) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: "工作区信息不完整，请重新登录" });
  }
  if (type === "mutation") {
    await assertResourceAction({ actor: actorFromContext(ctx), resource: "project",
      action: "update", workspaceId: ctx.workspaceId }, ctx);
  }
  return next({ ctx });
});
