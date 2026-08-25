import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../repositories";
import {
  ADMIN_ROLES,
  ALL_ROLES,
  PERMISSION_MODULES,
  PERMISSION_RESOURCE_REGISTRY,
  PERMISSION_ROUTE_REGISTRY,
  ROLE_LABELS,
  ROLE_MODULE_ACCESS,
  SECURITY_ACTION_OPERATION,
  SUB_MODULES,
  type ModulePermission,
} from "@shared/const";
import { recordSecurityAuditLog } from "../services/securityGovernance";

const ALL_MODULES = PERMISSION_MODULES;

const detailedPermissionSchema = z.object({
  moduleId: z.string(),
  operations: z.array(z.enum(['read', 'edit', 'delete'])),
  subModules: z.array(z.object({
    subModuleId: z.string(),
    operations: z.array(z.enum(['read', 'edit', 'delete'])),
  })).optional(),
});

const roleUpdateSchema = z.object({
  role: z.string().min(1),
  modules: z.array(z.string()),
  description: z.string().optional(),
  detailedPermissions: z.array(detailedPermissionSchema).optional(),
});

const batchRoleUpdateSchema = z.object({
  updates: z.array(roleUpdateSchema).min(1).max(ALL_ROLES.length),
});

function parseModulePermissions(value: string | null | undefined): ModulePermission[] | null {
  if (!value) return null;
  try { return JSON.parse(value) as ModulePermission[]; } catch { return null; }
}

function validateRoleUpdate(input: z.infer<typeof roleUpdateSchema>) {
  if (!ALL_ROLES.includes(input.role as any)) throw new TRPCError({ code: "BAD_REQUEST", message: "无效的角色标识" });
  const validModuleIds = new Set(ALL_MODULES.map(m => m.id));
  const invalidModules = input.modules.filter(m => !validModuleIds.has(m));
  if (invalidModules.length > 0) throw new TRPCError({ code: "BAD_REQUEST", message: `无效的模块ID: ${invalidModules.join(", ")}` });
  const selectedModules = new Set(input.modules);
  for (const permission of input.detailedPermissions || []) {
    if (!selectedModules.has(permission.moduleId)) throw new TRPCError({ code: "BAD_REQUEST", message: `细粒度权限不能引用未选中的模块: ${permission.moduleId}` });
    const validSubModules = new Set((SUB_MODULES[permission.moduleId] || []).map(item => item.id));
    for (const sub of permission.subModules || []) {
      if (!validSubModules.has(sub.subModuleId)) throw new TRPCError({ code: "BAD_REQUEST", message: `无效的子模块ID: ${sub.subModuleId}` });
    }
  }
}

function riskForRoleChange(input: z.infer<typeof roleUpdateSchema>, affectedMemberCount: number) {
  const operations = (input.detailedPermissions || []).flatMap(permission => [
    ...permission.operations,
    ...(permission.subModules || []).flatMap(sub => sub.operations),
  ]);
  if (input.role === "super_admin") return "critical" as const;
  if (input.modules.some(moduleId => moduleId === "admin" || moduleId === "emperor") || operations.includes("delete")) return "high" as const;
  if (affectedMemberCount > 0 || operations.includes("edit")) return "medium" as const;
  return "low" as const;
}

async function buildRolePreview(input: z.infer<typeof roleUpdateSchema>) {
  validateRoleUpdate(input);
  const [current, users] = await Promise.all([db.getRolePermission(input.role), db.getAllUsers()]);
  const beforeModules = current ? JSON.parse(current.modules) as string[] : (ROLE_MODULE_ACCESS[input.role] || []);
  const affectedMemberCount = users.filter(user => user.role === input.role && user.status === "active").length;
  const addedModules = input.modules.filter(moduleId => !beforeModules.includes(moduleId));
  const removedModules = beforeModules.filter(moduleId => !input.modules.includes(moduleId));
  const riskLevel = riskForRoleChange(input, affectedMemberCount);
  return {
    role: input.role,
    roleLabel: ROLE_LABELS[input.role] || input.role,
    addedModules,
    removedModules,
    affectedMemberCount,
    riskLevel,
    requiresExplicitConfirmation: riskLevel === "high" || riskLevel === "critical",
    before: { modules: beforeModules, detailedPermissions: parseModulePermissions(current?.detailedPermissions) },
    after: { modules: input.modules, detailedPermissions: input.detailedPermissions || null },
  };
}

export const roleManagementRouter = router({
  // List all roles with their permissions (including detailed permissions)
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
    }

    const dbPermissions = await db.getAllRolePermissions();
    const dbMap = new Map(dbPermissions.map(p => [p.role, p]));

    return ALL_ROLES.map(role => {
      const dbPerm = dbMap.get(role);
      const modules = dbPerm
        ? (JSON.parse(dbPerm.modules) as string[])
        : (ROLE_MODULE_ACCESS[role] || []);
      let detailedPermissions: ModulePermission[] | null = null;
      if (dbPerm?.detailedPermissions) {
        try { detailedPermissions = JSON.parse(dbPerm.detailedPermissions); } catch {}
      }
      return {
        role,
        label: ROLE_LABELS[role] || role,
        modules,
        detailedPermissions,
        description: dbPerm?.description || null,
        updatedAt: dbPerm?.updatedAt || null,
        isSystem: role === "super_admin",
      };
    });
  }),

  // Get all available modules with sub-modules
  modules: protectedProcedure.query(async ({ ctx }) => {
    if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
    }
    return ALL_MODULES.map(m => ({
      ...m,
      subModules: SUB_MODULES[m.id] || [],
    }));
  }),

  governanceSnapshot: protectedProcedure.query(async ({ ctx }) => {
    if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
    }
    const [users, rolePermissions] = await Promise.all([db.getAllUsers(), db.getAllRolePermissions()]);
    return {
      singleCompanyMode: true,
      roleMembers: ALL_ROLES.map((role) => ({
        role,
        activeMemberCount: users.filter(user => user.role === role && user.status === "active").length,
        inactiveMemberCount: users.filter(user => user.role === role && user.status !== "active").length,
      })),
      members: users.map(user => ({ id: user.id, name: user.name, role: user.role, department: user.department, jobTitle: user.jobTitle, status: user.status })),
      routes: Object.entries(PERMISSION_ROUTE_REGISTRY).map(([path, rule]) => ({ path, ...rule })),
      resources: Object.entries(PERMISSION_RESOURCE_REGISTRY).map(([resource, mapping]) => ({ resource, ...mapping })),
      actionOperationMap: SECURITY_ACTION_OPERATION,
      customizedRoleCount: rolePermissions.filter(permission => Boolean(permission.detailedPermissions)).length,
    };
  }),

  previewUpdate: protectedProcedure
    .input(roleUpdateSchema)
    .query(async ({ ctx, input }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }
      if (input.role === "super_admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "无法预览超级管理员权限变更" });
      }
      return buildRolePreview(input);
    }),

  // Update role permissions (with optional fine-grained control)
  update: protectedProcedure
    .input(roleUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }

      if (input.role === "super_admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "无法修改超级管理员权限" });
      }

      const preview = await buildRolePreview(input);

      await db.upsertRolePermission(
        input.role,
        input.modules,
        input.description || null,
        ctx.user.id,
        input.detailedPermissions || null
      );

      await recordSecurityAuditLog({
        ctx,
        action: "role_permission.update",
        resourceType: "role_permission",
        resourceId: input.role,
        resourceName: preview.roleLabel,
        status: "success",
        riskLevel: preview.riskLevel,
        reason: "管理员更新角色模板",
        beforeSnapshot: preview.before,
        afterSnapshot: preview.after,
        metadata: {
          affectedMemberCount: preview.affectedMemberCount,
          addedModules: preview.addedModules,
          removedModules: preview.removedModules,
          singleCompanyMode: true,
        },
      });

      return { success: true, preview };
    }),

  // Batch update multiple roles
  batchUpdate: protectedProcedure
    .input(batchRoleUpdateSchema)
    .mutation(async ({ ctx, input }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }

      const previews = await Promise.all(input.updates.map(async (update) => {
        if (update.role === "super_admin" && ctx.user.role !== "super_admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "无法批量更新超级管理员权限" });
        }
        return buildRolePreview(update);
      }));
      for (const [index, update] of input.updates.entries()) {
        const preview = previews[index];
        await db.upsertRolePermission(
          update.role,
          update.modules,
          update.description || null,
          ctx.user.id,
          update.detailedPermissions || null,
        );
        await recordSecurityAuditLog({
          ctx,
          action: "role_permission.batch_update",
          resourceType: "role_permission",
          resourceId: update.role,
          resourceName: preview.roleLabel,
          status: "success",
          riskLevel: preview.riskLevel,
          reason: "管理员批量更新角色模板",
          beforeSnapshot: preview.before,
          afterSnapshot: preview.after,
          metadata: { affectedMemberCount: preview.affectedMemberCount, addedModules: preview.addedModules, removedModules: preview.removedModules, batchSize: previews.length, singleCompanyMode: true },
        });
      }

      return { success: true, updatedCount: previews.length, previews };
    }),

  batchPreview: protectedProcedure
    .input(batchRoleUpdateSchema)
    .query(async ({ ctx, input }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }
      const previews = await Promise.all(input.updates.map(async (update) => {
        if (update.role === "super_admin" && ctx.user.role !== "super_admin") {
          throw new TRPCError({ code: "FORBIDDEN", message: "无法预览超级管理员批量权限变更" });
        }
        return buildRolePreview(update);
      }));
      const riskWeight = { low: 1, medium: 2, high: 3, critical: 4 } as const;
      const highestRisk = previews.reduce((current, preview) => riskWeight[preview.riskLevel] > riskWeight[current] ? preview.riskLevel : current, "low" as keyof typeof riskWeight);
      return {
        previews,
        totalAffectedMemberCount: previews.reduce((total, preview) => total + preview.affectedMemberCount, 0),
        highestRisk,
        requiresExplicitConfirmation: previews.some(preview => preview.requiresExplicitConfirmation),
      };
    }),

  // Get dynamic role module access (replaces static ROLE_MODULE_ACCESS)
  getModuleAccess: protectedProcedure.query(async () => {
    const dbPermissions = await db.getAllRolePermissions();
    const result: Record<string, string[]> = { ...ROLE_MODULE_ACCESS };

    for (const perm of dbPermissions) {
      try {
        result[perm.role] = JSON.parse(perm.modules);
      } catch {
        // Keep static fallback
      }
    }

    return result;
  }),

  // Get detailed permissions for a specific role
  getDetailedPermissions: protectedProcedure
    .input(z.object({ role: z.string() }))
    .query(async ({ ctx, input }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }
      const perm = await db.getRolePermission(input.role);
      if (!perm?.detailedPermissions) return null;
      try {
        return JSON.parse(perm.detailedPermissions) as ModulePermission[];
      } catch {
        return null;
      }
    }),

  // Get current user's own permissions (no admin check needed)
  myPermissions: protectedProcedure.query(async ({ ctx }) => {
    const role = ctx.user.role;
    // Super admin has full access
    if (role === 'super_admin') {
      return {
        role,
        modules: ALL_MODULES.map(m => m.id),
        detailedPermissions: null as ModulePermission[] | null,
      };
    }
    const perm = await db.getRolePermission(role);
    const modules = perm
      ? (JSON.parse(perm.modules) as string[])
      : (ROLE_MODULE_ACCESS[role] || []);
    let detailedPermissions: ModulePermission[] | null = null;
    if (perm?.detailedPermissions) {
      try { detailedPermissions = JSON.parse(perm.detailedPermissions); } catch {}
    }
    return { role, modules, detailedPermissions };
  }),
});
