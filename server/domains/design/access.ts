import { TRPCError } from "@trpc/server";
import {
  ROLE_MODULE_ACCESS,
  type PermissionOperation,
} from "../../../shared/const";
import { getRolePermission } from "../../repositories/auth/authRepository";
import { execute, type Scope } from "./repository";
import { getProjectById } from "../../repositories";
import { assertResourceAction } from "../../services/securityGovernance";

/** Listing operators use their project permission, without gaining access to the
 * independent design module or to another user's private assets. */
export async function authorizeListingDesign(
  user: any,
  projectId: number,
  operation: PermissionOperation
): Promise<Scope> {
  if (!user || user.status !== "active")
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  const workspaceId = Number(user.defaultWorkspaceId);
  if (!workspaceId || !(await getProjectById(projectId, user.id, workspaceId)))
    throw new TRPCError({ code: "NOT_FOUND", message: "项目不可访问" });
  await assertResourceAction({
    actor: user,
    resource: "project",
    action: operation === "read" ? "read" : "update",
    workspaceId,
    projectId,
  });
  return { workspaceId, userId: Number(user.id) };
}
export async function authorizeDesignConversation(
  user: any,
  operation: PermissionOperation,
  id: string
): Promise<Scope> {
  if (user?.status === "active") {
    const workspaceId = Number(user.defaultWorkspaceId);
    const rows = await execute(
      "SELECT kind FROM design_conversations WHERE id=? AND workspaceId=? AND userId=? AND deletedAt IS NULL",
      [id, workspaceId, user.id]
    );
    if (rows[0]?.kind === "listing") {
      const linked = await execute(
        "SELECT project_id FROM listing_image_productions WHERE workspace_id=? AND user_id=? AND JSON_SEARCH(data,'one',?,NULL,'$.stages.*.conversationId','$.archives[*].conversationId') IS NOT NULL LIMIT 1",
        [workspaceId, user.id, id]
      );
      if (!linked[0])
        throw new TRPCError({ code: "NOT_FOUND", message: "制作对话不可访问" });
      return authorizeListingDesign(
        user,
        Number(linked[0].project_id),
        operation
      );
    }
  }
  return authorizeDesign(user, operation);
}
export async function authorizeDesignGeneration(
  user: any,
  operation: PermissionOperation,
  id: string
): Promise<Scope> {
  if (user?.status === "active") {
    const rows = await execute(
      "SELECT conversationId FROM design_generations WHERE id=? AND workspaceId=? AND userId=? AND deletedAt IS NULL",
      [id, Number(user.defaultWorkspaceId), user.id]
    );
    if (rows[0])
      return authorizeDesignConversation(
        user,
        operation,
        String(rows[0].conversationId)
      );
  }
  return authorizeDesign(user, operation);
}

export function designRoleAllows(
  role: string,
  permission:
    | { modules: string; detailedPermissions?: string | null }
    | null
    | undefined,
  operation: PermissionOperation,
  subModuleId = "design_images"
) {
  if (role === "super_admin") return true;
  try {
    const modules = permission
      ? JSON.parse(permission.modules)
      : ROLE_MODULE_ACCESS[role] || [];
    if (!modules.includes("design")) return false;
    const details = permission?.detailedPermissions
      ? JSON.parse(permission.detailedPermissions)
      : [];
    const module = details.find((p: any) => p.moduleId === "design");
    const sub = module?.subModules?.find(
      (p: any) => p.subModuleId === subModuleId
    );
    return (
      !module ||
      (sub?.operations || module.operations || []).includes(operation)
    );
  } catch {
    return false;
  }
}
export async function authorizeDesign(
  user: any,
  operation: PermissionOperation,
  subModuleId = "design_images"
): Promise<Scope> {
  if (!user || user.status !== "active")
    throw new TRPCError({ code: "UNAUTHORIZED", message: "请先登录" });
  if (
    !designRoleAllows(
      user.role,
      await getRolePermission(user.role),
      operation,
      subModuleId
    )
  )
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "没有美工板块的操作权限",
    });
  const workspaceId = Number(user.defaultWorkspaceId);
  if (
    !workspaceId ||
    !(
      await execute(
        "SELECT id FROM workspace_memberships WHERE workspaceId=? AND userId=? AND status='active' LIMIT 1",
        [workspaceId, user.id]
      )
    ).length
  )
    throw new TRPCError({ code: "FORBIDDEN", message: "请先加入有效工作空间" });
  return { workspaceId, userId: Number(user.id) };
}
