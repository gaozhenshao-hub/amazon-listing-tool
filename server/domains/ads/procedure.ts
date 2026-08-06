import { protectedProcedure as baseProtectedProcedure } from "../../_core/trpc";
import { recordSecurityAuditLog } from "../../services/securityGovernance";

export const protectedProcedure = baseProtectedProcedure.use(async ({ ctx, next, path, type }) => {
  try {
    const result = await next();
    if (type === "mutation") {
      void recordSecurityAuditLog({
        ctx,
        workspaceId: ctx.workspaceId,
        action: "ads.invoke",
        resourceType: "ops_data",
        status: "success",
        riskLevel: "medium",
        metadata: { path },
      });
    }
    return result;
  } catch (error) {
    if (type === "mutation") {
      void recordSecurityAuditLog({
        ctx,
        workspaceId: ctx.workspaceId,
        action: "ads.invoke",
        resourceType: "ops_data",
        status: "failed",
        riskLevel: "medium",
        reason: error instanceof Error ? error.message : String(error),
        metadata: { path },
      });
    }
    throw error;
  }
});
