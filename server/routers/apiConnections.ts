import { TRPCError } from "@trpc/server";
import { router, protectedProcedure } from "../_core/trpc";
import { recordSecurityAuditLog } from "../services/securityGovernance";
import {
  RewrapApiConnectionInputSchema,
  SaveApiConnectionInputSchema,
  ValidateApiConnectionInputSchema,
} from "../domains/apiConnections/contracts";
import {
  listApiConnectionStates,
  rewrapApiConnectionSecrets,
  saveApiConnectionSecrets,
  validateApiConnection,
} from "../domains/apiConnections/service";

function requireSuperAdmin(ctx: { user: { role: string } | null }) {
  if (!ctx.user || ctx.user.role !== "super_admin") {
    throw new TRPCError({ code: "FORBIDDEN", message: "仅超级管理员可管理第三方API连接" });
  }
}

export const apiConnectionsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    requireSuperAdmin(ctx);
    return listApiConnectionStates();
  }),

  save: protectedProcedure.input(SaveApiConnectionInputSchema).mutation(async ({ ctx, input }) => {
    requireSuperAdmin(ctx);
    const states = await saveApiConnectionSecrets({ ...input, userId: ctx.user.id });
    await recordSecurityAuditLog({
      ctx,
      action: "api_connection.save",
      resourceType: "api_connection",
      resourceId: input.connection,
      resourceName: input.connection,
      status: "success",
      riskLevel: "critical",
      metadata: { fields: Object.keys(input.values), operation: "replace_or_add" },
    });
    return { success: true, states };
  }),

  validate: protectedProcedure.input(ValidateApiConnectionInputSchema).mutation(async ({ ctx, input }) => {
    requireSuperAdmin(ctx);
    const result = await validateApiConnection({ ...input, userId: ctx.user.id });
    await recordSecurityAuditLog({
      ctx,
      action: "api_connection.validate",
      resourceType: "api_connection",
      resourceId: input.connection,
      status: result.success ? "success" : "failed",
      riskLevel: "high",
      metadata: { validation: result.validation },
    });
    return result;
  }),

  rewrap: protectedProcedure.input(RewrapApiConnectionInputSchema).mutation(async ({ ctx, input }) => {
    requireSuperAdmin(ctx);
    const result = await rewrapApiConnectionSecrets({ ...input, userId: ctx.user.id });
    await recordSecurityAuditLog({
      ctx,
      action: "api_connection.rewrap",
      resourceType: "api_connection",
      resourceId: input.connection,
      status: "success",
      riskLevel: "critical",
      metadata: { rotatedFields: result.rotatedFields },
    });
    return result;
  }),
});
