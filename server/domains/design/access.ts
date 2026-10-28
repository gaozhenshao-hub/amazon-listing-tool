import { TRPCError } from "@trpc/server";
import {
  ROLE_MODULE_ACCESS,
  type PermissionOperation,
} from "../../../shared/const";
import { getRolePermission } from "../../repositories/auth/authRepository";
import { execute, type Scope } from "./repository";

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
