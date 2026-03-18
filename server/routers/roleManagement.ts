import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { protectedProcedure, router } from "../_core/trpc";
import * as db from "../db";
import { ADMIN_ROLES, ALL_ROLES, ROLE_LABELS, ROLE_MODULE_ACCESS } from "@shared/const";

const ALL_MODULES = [
  { id: "dev", label: "智能产品开发", description: "产品开发AI分析、选品调研、竞品分析" },
  { id: "listing", label: "智能Listing生成", description: "Listing文案生成、关键词管理、广告架构" },
  { id: "ops", label: "智能运营提效", description: "利润分析、库存预警、广告优化、销量预测" },
  { id: "service", label: "智能售后管理", description: "AI客服回复、退货分析、邮件模板" },
  { id: "knowledge", label: "智能知识库", description: "产品创意库、Listing文案库、图片知识库、SOP库" },
  { id: "admin", label: "系统管理", description: "用户管理、审核中心、项目分配、同步监控" },
];

export const roleManagementRouter = router({
  // List all roles with their permissions
  list: protectedProcedure.query(async ({ ctx }) => {
    if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
    }

    const dbPermissions = await db.getAllRolePermissions();
    const dbMap = new Map(dbPermissions.map(p => [p.role, p]));

    // Merge DB permissions with static role definitions
    return ALL_ROLES.map(role => {
      const dbPerm = dbMap.get(role);
      const modules = dbPerm
        ? (JSON.parse(dbPerm.modules) as string[])
        : (ROLE_MODULE_ACCESS[role] || []);
      return {
        role,
        label: ROLE_LABELS[role] || role,
        modules,
        description: dbPerm?.description || null,
        updatedAt: dbPerm?.updatedAt || null,
        isSystem: role === "super_admin",
      };
    });
  }),

  // Get all available modules
  modules: protectedProcedure.query(async ({ ctx }) => {
    if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
      throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
    }
    return ALL_MODULES;
  }),

  // Update role permissions
  update: protectedProcedure
    .input(z.object({
      role: z.string().min(1),
      modules: z.array(z.string()),
      description: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }

      // Cannot modify super_admin permissions unless you are super_admin
      if (input.role === "super_admin" && ctx.user.role !== "super_admin") {
        throw new TRPCError({ code: "FORBIDDEN", message: "无法修改超级管理员权限" });
      }

      // Validate module IDs
      const validModuleIds = ALL_MODULES.map(m => m.id);
      const invalidModules = input.modules.filter(m => !validModuleIds.includes(m));
      if (invalidModules.length > 0) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `无效的模块ID: ${invalidModules.join(", ")}` });
      }

      await db.upsertRolePermission(
        input.role,
        input.modules,
        input.description || null,
        ctx.user.id
      );

      return { success: true };
    }),

  // Batch update multiple roles
  batchUpdate: protectedProcedure
    .input(z.object({
      updates: z.array(z.object({
        role: z.string().min(1),
        modules: z.array(z.string()),
        description: z.string().optional(),
      })),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ADMIN_ROLES.includes(ctx.user.role as any)) {
        throw new TRPCError({ code: "FORBIDDEN", message: "需要管理员权限" });
      }

      for (const update of input.updates) {
        if (update.role === "super_admin" && ctx.user.role !== "super_admin") {
          continue; // Skip super_admin if not super_admin
        }
        await db.upsertRolePermission(
          update.role,
          update.modules,
          update.description || null,
          ctx.user.id
        );
      }

      return { success: true, updatedCount: input.updates.length };
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
});
