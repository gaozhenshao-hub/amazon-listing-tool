import { TRPCError } from "@trpc/server";
import { protectedProcedure } from "../../_core/trpc";
import {
  actorFromContext,
  assertResourceAction,
  workspaceIdFromContext,
} from "../../services/securityGovernance";
import { runWithOpsWorkspace } from "./workspaceContext";
import { MEETING_ROLES } from "../../../shared/meetingNotes";

// Meeting authoring uses task permissions, never grants ERP import/update access.
export const meetingProcedure = protectedProcedure.use(
  async ({ ctx, next, type }) => {
    const workspaceId = workspaceIdFromContext(ctx);
    if (!workspaceId || !MEETING_ROLES.includes(ctx.user.role))
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "请使用运营账号访问会议记录",
      });
    await assertResourceAction(
      {
        actor: actorFromContext(ctx),
        resource: "ops_data",
        action: "read",
        workspaceId,
      },
      ctx
    );
    await assertResourceAction(
      {
        actor: actorFromContext(ctx),
        resource: "ops_task",
        action: type === "query" ? "read" : "create",
        workspaceId,
      },
      ctx
    );
    return runWithOpsWorkspace(
      {
        workspaceId,
        tenantId: `workspace-${workspaceId}`,
        userId: ctx.user.id,
      },
      () => next({ ctx: { ...ctx, workspaceId } })
    );
  }
);
