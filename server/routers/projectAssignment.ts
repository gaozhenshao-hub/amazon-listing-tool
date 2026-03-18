import { z } from "zod";
import { protectedProcedure, adminProcedure, managerProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  projectAssignments,
  users,
  devProjects,
  devProductProfiles,
  projects,
} from "../../drizzle/schema";

// ═══════════════════════════════════════════════════════════════
// Project Assignment Router
// ═══════════════════════════════════════════════════════════════
export const projectAssignmentRouter = router({
  // ─── Assign project to users (admin/manager) ───
  assign: managerProcedure
    .input(z.object({
      projectId: z.number(),
      projectType: z.enum(["dev_project", "listing_project"]),
      userIds: z.array(z.number()).min(1).max(50),
      permission: z.enum(["read", "write"]).default("read"),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Verify project exists
      if (input.projectType === "dev_project") {
        const proj = await db.select({ id: devProjects.id })
          .from(devProjects)
          .where(eq(devProjects.id, input.projectId))
          .limit(1);
        if (!proj.length) throw new Error("产品开发项目不存在");
      } else {
        const proj = await db.select({ id: projects.id })
          .from(projects)
          .where(eq(projects.id, input.projectId))
          .limit(1);
        if (!proj.length) throw new Error("Listing项目不存在");
      }

      let successCount = 0;
      const errors: string[] = [];

      for (const userId of input.userIds) {
        try {
          // Check if assignment already exists
          const existing = await db.select().from(projectAssignments).where(
            and(
              eq(projectAssignments.projectId, input.projectId),
              eq(projectAssignments.projectType, input.projectType),
              eq(projectAssignments.assignedUserId, userId)
            )
          );

          if (existing.length > 0) {
            // Update permission
            await db.update(projectAssignments).set({
              permission: input.permission,
              assignedBy: ctx.user.id,
            }).where(eq(projectAssignments.id, existing[0].id));
          } else {
            await db.insert(projectAssignments).values({
              projectId: input.projectId,
              projectType: input.projectType,
              assignedUserId: userId,
              assignedBy: ctx.user.id,
              permission: input.permission,
            });
          }
          successCount++;
        } catch (e: any) {
          errors.push(`用户#${userId}: ${e.message}`);
        }
      }

      return { successCount, errorCount: errors.length, errors };
    }),

  // ─── Revoke assignment (admin/manager) ───
  revoke: managerProcedure
    .input(z.object({
      assignmentId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.delete(projectAssignments).where(eq(projectAssignments.id, input.assignmentId));
      return { success: true };
    }),

  // ─── Batch revoke assignments ───
  batchRevoke: managerProcedure
    .input(z.object({
      assignmentIds: z.array(z.number()).min(1),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.delete(projectAssignments).where(
        inArray(projectAssignments.id, input.assignmentIds)
      );
      return { success: true, count: input.assignmentIds.length };
    }),

  // ─── Update permission (admin/manager) ───
  updatePermission: managerProcedure
    .input(z.object({
      assignmentId: z.number(),
      permission: z.enum(["read", "write"]),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.update(projectAssignments).set({
        permission: input.permission,
      }).where(eq(projectAssignments.id, input.assignmentId));
      return { success: true };
    }),

  // ─── List all assignments for a project (admin/manager) ───
  listByProject: managerProcedure
    .input(z.object({
      projectId: z.number(),
      projectType: z.enum(["dev_project", "listing_project"]),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const assignments = await db.select().from(projectAssignments).where(
        and(
          eq(projectAssignments.projectId, input.projectId),
          eq(projectAssignments.projectType, input.projectType)
        )
      ).orderBy(desc(projectAssignments.createdAt));

      // Enrich with user names
      const userIds = Array.from(new Set([
        ...assignments.map(a => a.assignedUserId),
        ...assignments.map(a => a.assignedBy),
      ]));

      let userMap: Record<number, { name: string; role: string }> = {};
      if (userIds.length > 0) {
        const userRows = await db.select({
          id: users.id,
          name: users.name,
          role: users.role,
        }).from(users).where(inArray(users.id, userIds));
        userMap = Object.fromEntries(userRows.map(u => [u.id, { name: u.name || "未知", role: u.role }]));
      }

      return assignments.map(a => ({
        ...a,
        assignedUserName: userMap[a.assignedUserId]?.name || "未知",
        assignedUserRole: userMap[a.assignedUserId]?.role || "unknown",
        assignerName: userMap[a.assignedBy]?.name || "未知",
      }));
    }),

  // ─── List all assignments (admin view) ───
  listAll: managerProcedure
    .input(z.object({
      projectType: z.enum(["dev_project", "listing_project"]).optional(),
      userId: z.number().optional(),
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 20;
      const offset = (page - 1) * pageSize;

      const conditions: any[] = [];
      if (input?.projectType) {
        conditions.push(eq(projectAssignments.projectType, input.projectType));
      }
      if (input?.userId) {
        conditions.push(eq(projectAssignments.assignedUserId, input.userId));
      }

      const allAssignments = conditions.length > 0
        ? await db.select().from(projectAssignments).where(and(...conditions)).orderBy(desc(projectAssignments.createdAt))
        : await db.select().from(projectAssignments).orderBy(desc(projectAssignments.createdAt));

      // Enrich with project names and user names
      const devProjectIds = Array.from(new Set(
        allAssignments.filter(a => a.projectType === "dev_project").map(a => a.projectId)
      ));
      const listingProjectIds = Array.from(new Set(
        allAssignments.filter(a => a.projectType === "listing_project").map(a => a.projectId)
      ));
      const userIds = Array.from(new Set([
        ...allAssignments.map(a => a.assignedUserId),
        ...allAssignments.map(a => a.assignedBy),
      ]));

      let devProjectMap: Record<number, string> = {};
      if (devProjectIds.length > 0) {
        const devRows = await db.select({ id: devProjects.id, name: devProjects.name })
          .from(devProjects)
          .where(inArray(devProjects.id, devProjectIds));
        devProjectMap = Object.fromEntries(devRows.map(r => [r.id, r.name]));
      }

      let listingProjectMap: Record<number, string> = {};
      if (listingProjectIds.length > 0) {
        const listingRows = await db.select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(inArray(projects.id, listingProjectIds));
        listingProjectMap = Object.fromEntries(listingRows.map(r => [r.id, r.name]));
      }

      let userMap: Record<number, string> = {};
      if (userIds.length > 0) {
        const userRows = await db.select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, userIds));
        userMap = Object.fromEntries(userRows.map(u => [u.id, u.name || "未知"]));
      }

      const total = allAssignments.length;
      const items = allAssignments.slice(offset, offset + pageSize).map(a => ({
        ...a,
        projectName: a.projectType === "dev_project"
          ? (devProjectMap[a.projectId] || `项目#${a.projectId}`)
          : (listingProjectMap[a.projectId] || `项目#${a.projectId}`),
        assignedUserName: userMap[a.assignedUserId] || "未知",
        assignerName: userMap[a.assignedBy] || "未知",
      }));

      return { items, total, page, pageSize };
    }),

  // ─── My assigned projects (for current user) ───
  myAssignments: protectedProcedure
    .input(z.object({
      projectType: z.enum(["dev_project", "listing_project"]).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const conditions: any[] = [
        eq(projectAssignments.assignedUserId, ctx.user.id),
      ];
      if (input?.projectType) {
        conditions.push(eq(projectAssignments.projectType, input.projectType));
      }

      const assignments = await db.select().from(projectAssignments)
        .where(and(...conditions))
        .orderBy(desc(projectAssignments.createdAt));

      // Enrich with project names
      const devProjectIds = Array.from(new Set(
        assignments.filter(a => a.projectType === "dev_project").map(a => a.projectId)
      ));
      const listingProjectIds = Array.from(new Set(
        assignments.filter(a => a.projectType === "listing_project").map(a => a.projectId)
      ));

      let devProjectMap: Record<number, { name: string; targetMarket: string | null }> = {};
      if (devProjectIds.length > 0) {
        const devRows = await db.select({
          id: devProjects.id,
          name: devProjects.name,
          targetMarket: devProjects.targetMarket,
        }).from(devProjects).where(inArray(devProjects.id, devProjectIds));
        devProjectMap = Object.fromEntries(devRows.map(r => [r.id, { name: r.name, targetMarket: r.targetMarket }]));
      }

      let listingProjectMap: Record<number, { name: string }> = {};
      if (listingProjectIds.length > 0) {
        const listingRows = await db.select({
          id: projects.id,
          name: projects.name,
        }).from(projects).where(inArray(projects.id, listingProjectIds));
        listingProjectMap = Object.fromEntries(listingRows.map(r => [r.id, { name: r.name }]));
      }

      return assignments.map(a => ({
        ...a,
        projectName: a.projectType === "dev_project"
          ? (devProjectMap[a.projectId]?.name || `项目#${a.projectId}`)
          : (listingProjectMap[a.projectId]?.name || `项目#${a.projectId}`),
        targetMarket: a.projectType === "dev_project"
          ? (devProjectMap[a.projectId]?.targetMarket || null)
          : null,
      }));
    }),

  // ─── Get product profile from dev_project (cross-module reference) ───
  getDevProjectProfile: protectedProcedure
    .input(z.object({
      devProjectId: z.number(),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      // Check if user has assignment or is admin
      const isAdmin = ["super_admin", "admin", "ops_manager"].includes(ctx.user.role);
      if (!isAdmin) {
        const assignment = await db.select().from(projectAssignments).where(
          and(
            eq(projectAssignments.projectId, input.devProjectId),
            eq(projectAssignments.projectType, "dev_project"),
            eq(projectAssignments.assignedUserId, ctx.user.id)
          )
        ).limit(1);
        if (!assignment.length) throw new Error("您没有该项目的访问权限");
      }

      // Get project info
      const project = await db.select().from(devProjects)
        .where(eq(devProjects.id, input.devProjectId))
        .limit(1);
      if (!project.length) throw new Error("项目不存在");

      // Get product profile
      const profile = await db.select().from(devProductProfiles)
        .where(eq(devProductProfiles.projectId, input.devProjectId))
        .limit(1);

      return {
        project: project[0],
        profile: profile[0] || null,
      };
    }),

  // ─── List available dev projects for import (in listing module) ───
  listImportableDevProjects: protectedProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    const isAdmin = ["super_admin", "admin", "ops_manager"].includes(ctx.user.role);

    if (isAdmin) {
      // Admin can see all dev projects
      const allProjects = await db.select({
        id: devProjects.id,
        name: devProjects.name,
        targetMarket: devProjects.targetMarket,
        status: devProjects.status,
      }).from(devProjects).orderBy(desc(devProjects.updatedAt));
      return allProjects;
    }

    // Regular user: only see assigned dev projects
    const assignments = await db.select().from(projectAssignments).where(
      and(
        eq(projectAssignments.assignedUserId, ctx.user.id),
        eq(projectAssignments.projectType, "dev_project")
      )
    );

    if (!assignments.length) return [];

    const projectIds = assignments.map(a => a.projectId);
    const assignedProjects = await db.select({
      id: devProjects.id,
      name: devProjects.name,
      targetMarket: devProjects.targetMarket,
      status: devProjects.status,
    }).from(devProjects)
      .where(inArray(devProjects.id, projectIds))
      .orderBy(desc(devProjects.updatedAt));

    return assignedProjects;
  }),

  // ─── List available projects for assignment (admin dropdown) ───
  listAvailableProjects: managerProcedure
    .input(z.object({
      projectType: z.enum(["dev_project", "listing_project"]),
    }))
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      if (input.projectType === "dev_project") {
        return db.select({
          id: devProjects.id,
          name: devProjects.name,
          targetMarket: devProjects.targetMarket,
        }).from(devProjects).orderBy(desc(devProjects.updatedAt));
      } else {
        return db.select({
          id: projects.id,
          name: projects.name,
        }).from(projects).orderBy(desc(projects.updatedAt));
      }
    }),

  // ─── List available users for assignment (admin dropdown) ───
  listAvailableUsers: managerProcedure.query(async ({ ctx }) => {
    const db = await getDb();
    if (!db) throw new Error("Database not available");

    return db.select({
      id: users.id,
      name: users.name,
      email: users.email,
      role: users.role,
      department: users.department,
    }).from(users)
      .where(eq(users.status, "active"))
      .orderBy(users.name);
  }),
});
