import { z } from "zod";
import { protectedProcedure, managerProcedure, adminProcedure, router } from "../_core/trpc";
import { getDb } from "../db";
import { eq, and, desc, sql, inArray, or, isNull, gte } from "drizzle-orm";
import {
  kbOperationSkills,
  sopAccessGrants,
  users,
} from "../../drizzle/schema";

// ═══════════════════════════════════════════════════════════════
// SOP Access Control Router
// ═══════════════════════════════════════════════════════════════
export const sopAccessRouter = router({
  // ─── List SOPs visible to current user ───
  listAccessible: protectedProcedure
    .input(z.object({
      page: z.number().min(1).default(1),
      pageSize: z.number().min(1).max(100).default(20),
      category: z.string().optional(),
      search: z.string().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");
      const page = input?.page ?? 1;
      const pageSize = input?.pageSize ?? 20;
      const offset = (page - 1) * pageSize;
      const userRole = ctx.user.role;
      const userId = ctx.user.id;

      // Admin/manager can see all approved SOPs
      const isAdmin = ["super_admin", "admin", "ops_manager"].includes(userRole);

      // Build conditions
      const conditions: any[] = [
        eq(kbOperationSkills.reviewStatus, "approved"),
      ];

      // Non-admin users: filter by visibility
      if (!isAdmin) {
        // Can see: public SOPs, team SOPs, or SOPs with explicit access grant
        const grantRows = await db.select({ id: sopAccessGrants.id })
          .from(sopAccessGrants)
          .where(
            and(
              eq(sopAccessGrants.userId, userId),
              or(
                isNull(sopAccessGrants.expiresAt),
                gte(sopAccessGrants.expiresAt, new Date())
              )
            )
          );

        // User can see: public, team, or own content, or has explicit grant
        conditions.push(
          or(
            eq(kbOperationSkills.visibility, "public"),
            eq(kbOperationSkills.visibility, "team"),
            eq(kbOperationSkills.userId, userId),
          )
        );
      }

      if (input?.category) {
        conditions.push(
          sql`${kbOperationSkills.title} LIKE ${'%' + input.category + '%'}`
        );
      }

      if (input?.search) {
        conditions.push(
          sql`${kbOperationSkills.title} LIKE ${'%' + input.search + '%'}`
        );
      }

      const allRows = await db.select()
        .from(kbOperationSkills)
        .where(and(...conditions))
        .orderBy(desc(kbOperationSkills.updatedAt));

      const total = allRows.length;
      const items = allRows.slice(offset, offset + pageSize);

      return { items, total, page, pageSize };
    }),

  // ─── Grant SOP access to users (admin/manager) ───
  grantAccess: managerProcedure
    .input(z.object({
      userIds: z.array(z.number()).min(1),
      skillLevel: z.enum(["intermediate", "advanced"]),
      expiresAt: z.string().optional(), // ISO date string
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      let successCount = 0;
      for (const userId of input.userIds) {
        // Check if grant already exists
        const existing = await db.select().from(sopAccessGrants).where(
          and(
            eq(sopAccessGrants.userId, userId),
            eq(sopAccessGrants.skillLevel, input.skillLevel)
          )
        );

        if (existing.length > 0) {
          // Update existing grant
          await db.update(sopAccessGrants).set({
            grantedBy: ctx.user.id,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          }).where(eq(sopAccessGrants.id, existing[0].id));
        } else {
          await db.insert(sopAccessGrants).values({
            userId,
            skillLevel: input.skillLevel,
            grantedBy: ctx.user.id,
            expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
          });
        }
        successCount++;
      }

      return { successCount };
    }),

  // ─── Revoke SOP access (admin/manager) ───
  revokeAccess: managerProcedure
    .input(z.object({
      grantId: z.number(),
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      await db.delete(sopAccessGrants).where(eq(sopAccessGrants.id, input.grantId));
      return { success: true };
    }),

  // ─── List all SOP access grants (admin/manager) ───
  listGrants: managerProcedure
    .input(z.object({
      userId: z.number().optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const conditions: any[] = [];
      if (input?.userId) {
        conditions.push(eq(sopAccessGrants.userId, input.userId));
      }

      const grants = conditions.length > 0
        ? await db.select().from(sopAccessGrants).where(and(...conditions)).orderBy(desc(sopAccessGrants.createdAt))
        : await db.select().from(sopAccessGrants).orderBy(desc(sopAccessGrants.createdAt));

      // Enrich with user names
      const userIds = Array.from(new Set(grants.map(g => g.userId)));
      const granterIds = Array.from(new Set(grants.map(g => g.grantedBy)));
      const allIds = Array.from(new Set([...userIds, ...granterIds]));

      let userMap: Record<number, string> = {};
      if (allIds.length > 0) {
        const userRows = await db.select({ id: users.id, name: users.name })
          .from(users)
          .where(inArray(users.id, allIds));
        userMap = Object.fromEntries(userRows.map(u => [u.id, u.name || "未知"]));
      }

      return grants.map(g => ({
        ...g,
        userName: userMap[g.userId] || "未知",
        granterName: userMap[g.grantedBy] || "未知",
      }));
    }),

  // ─── Update SOP visibility (owner or admin) ───
  updateSkillVisibility: protectedProcedure
    .input(z.object({
      id: z.number(),
      visibility: z.enum(["private", "team", "public"]),
      accessLevel: z.enum(["public", "team", "restricted"]).optional(),
      allowedRoles: z.string().optional(), // JSON array of roles
    }))
    .mutation(async ({ ctx, input }) => {
      const db = await getDb();
      if (!db) throw new Error("Database not available");

      const rows = await db.select().from(kbOperationSkills).where(eq(kbOperationSkills.id, input.id));
      if (!rows.length) throw new Error("SOP不存在");

      const item = rows[0];
      const isOwner = item.userId === ctx.user.id;
      const isAdmin = ["super_admin", "admin", "ops_manager"].includes(ctx.user.role);
      if (!isOwner && !isAdmin) throw new Error("无权修改");

      const updateData: any = { visibility: input.visibility };
      if (input.accessLevel) updateData.accessLevel = input.accessLevel;
      if (input.allowedRoles !== undefined) updateData.allowedRoles = input.allowedRoles;

      await db.update(kbOperationSkills).set(updateData).where(eq(kbOperationSkills.id, input.id));
      return { success: true };
    }),
});
