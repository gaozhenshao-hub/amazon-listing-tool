import { TRPCError } from "@trpc/server";
import { protectedProcedure as baseProtectedProcedure } from "../../_core/trpc";
import {
  actorFromContext,
  assertResourceAction,
  recordSecurityAuditLog,
  workspaceIdFromContext,
  type SecurityAction,
} from "../../services/securityGovernance";
import { runWithOpsWorkspace } from "./workspaceContext";

function inferOpsSecurityAction(path: string, type: string): SecurityAction {
  if (type === "query") return "read";
  const normalized = path.toLowerCase();
  if (normalized.includes("sync")) return "sync";
  if (normalized.includes("import") || normalized.includes("upload") || normalized.includes("parse")) return "import";
  if (normalized.includes("export")) return "export";
  if (normalized.includes("delete") || normalized.includes("remove")) return "delete";
  return "update";
}

export const protectedProcedure = baseProtectedProcedure.use(async ({ ctx, next, path, type }) => {
  const action = inferOpsSecurityAction(path, type);
  const workspaceId = workspaceIdFromContext(ctx);
  if (!workspaceId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "当前用户尚未绑定工作空间，无法访问运营数据",
    });
  }
  await assertResourceAction({
    actor: actorFromContext(ctx),
    resource: "ops_data",
    action,
    workspaceId,
  });
  try {
    const result = await runWithOpsWorkspace(workspaceId, () => next({ ctx: { ...ctx, workspaceId } }));
    if (type === "mutation") {
      void recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: `ops_data.${action}`,
        resourceType: "ops_data",
        status: "success",
        riskLevel: ["delete", "sync", "import"].includes(action) ? "high" : "medium",
        metadata: { path },
      });
    }
    return result;
  } catch (error) {
    if (type === "mutation") {
      void recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: `ops_data.${action}`,
        resourceType: "ops_data",
        status: "failed",
        riskLevel: ["delete", "sync", "import"].includes(action) ? "high" : "medium",
        reason: error instanceof Error ? error.message : String(error),
        metadata: { path },
      });
    }
    throw error;
  }
});
