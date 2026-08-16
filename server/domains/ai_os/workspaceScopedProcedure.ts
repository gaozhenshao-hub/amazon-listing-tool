import { TRPCError } from "@trpc/server";
import { protectedProcedure as baseProtectedProcedure } from "../../_core/trpc";
import {
  actorFromContext,
  assertResourceAction,
  recordSecurityAuditLog,
  workspaceIdFromContext,
  type SecurityAction,
} from "../../services/securityGovernance";
import type { SecurityResource } from "@shared/const";

function inferAction(path: string, type: "query" | "mutation" | "subscription"): SecurityAction {
  if (type === "query") return "read";
  const operation = path.split(".").at(-1)?.toLowerCase() || "";
  if (/delete|remove/.test(operation)) return "delete";
  if (/create|add/.test(operation)) return "create";
  if (/upload/.test(operation)) return "upload";
  if (/import/.test(operation)) return "import";
  if (/export|download/.test(operation)) return "export";
  if (/confirm|approve|lock|unlock/.test(operation)) return "confirm";
  if (/run|generate|analy[sz]e|retry|invoke/.test(operation)) return "run";
  if (/cancel/.test(operation)) return "cancel";
  return "update";
}

/**
 * 平台公共的工作空间边界与动作授权过程。领域路由仍可在此基础上
 * 增加项目/文件等资源级检查，但不能省略工作空间与审计约束。
 */
export function workspaceScopedProcedure(resource: SecurityResource) {
  return baseProtectedProcedure.use(async ({ ctx, next, path, type }) => {
    const workspaceId = workspaceIdFromContext(ctx);
    if (!workspaceId) {
      throw new TRPCError({ code: "PRECONDITION_FAILED", message: "当前用户尚未绑定工作空间，无法访问该资源" });
    }
    const action = inferAction(path, type);
    await assertResourceAction({ actor: actorFromContext(ctx), resource, action, workspaceId });
    try {
      const result = await next({ ctx: { ...ctx, workspaceId } });
      if (type === "mutation") {
        void recordSecurityAuditLog({
          ctx, workspaceId, action: `${resource}.${action}`, resourceType: resource,
          status: "success", riskLevel: ["delete", "import", "upload", "confirm"].includes(action) ? "high" : "medium",
          metadata: { path },
        });
      }
      return result;
    } catch (error) {
      if (type === "mutation") {
        void recordSecurityAuditLog({
          ctx, workspaceId, action: `${resource}.${action}`, resourceType: resource,
          status: "failed", riskLevel: ["delete", "import", "upload", "confirm"].includes(action) ? "high" : "medium",
          reason: error instanceof Error ? error.message : String(error), metadata: { path },
        });
      }
      throw error;
    }
  });
}
