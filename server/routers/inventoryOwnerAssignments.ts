import { TRPCError } from "@trpc/server";
import { and, desc, eq, inArray, or } from "drizzle-orm";
import { z } from "zod";
import {
  opsAsinDailySnapshots,
  opsInventoryOwnerAssignmentAudits,
  opsInventoryOwnerAssignments,
  users,
  workspaceMemberships,
} from "../../drizzle/schema";
import { MANAGER_ROLES } from "../../shared/const";
import { protectedProcedure } from "../domains/ops/workspaceProcedure";
import {
  inventoryOwnerAssignmentKey,
  normalizeInventoryOwnerAssignmentScope,
  uniqueInventoryOwnerAssignmentScopes,
} from "../domains/ops/inventoryOwnerAssignmentKeys";
import { currentOpsWorkspaceId } from "../domains/ops/workspaceContext";
import { getDb, withDbTransaction } from "../repositories/dbClient";
import { recordSecurityAuditLog } from "../services/securityGovernance";
import { router } from "../_core/trpc";

const assignmentScopeSchema = z.object({
  parentAsin: z.string().trim().min(1).max(20),
  storeName: z.string().trim().min(1).max(200),
  country: z.string().trim().min(1).max(50),
});

function assertInventoryOwnerAssignmentAdmin(ctx: { user: { role: string } }) {
  if (!(MANAGER_ROLES as readonly string[]).includes(ctx.user.role)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要运营管理员权限才能维护库存负责人。" });
  }
}

async function listEligibleUsers(db: any, workspaceId: number) {
  return db.select({ id: users.id, name: users.name, email: users.email, role: users.role })
    .from(users)
    .leftJoin(workspaceMemberships, and(
      eq(workspaceMemberships.userId, users.id),
      eq(workspaceMemberships.workspaceId, workspaceId),
      eq(workspaceMemberships.status, "active"),
    ))
    .where(and(
      eq(users.status, "active"),
      or(eq(users.defaultWorkspaceId, workspaceId), eq(workspaceMemberships.workspaceId, workspaceId)),
    ));
}

export const inventoryOwnerAssignmentsRouter = router({
  listEligibleUsers: protectedProcedure.query(async ({ ctx }) => {
    assertInventoryOwnerAssignmentAdmin(ctx);
    const db = await getDb();
    if (!db) throw new Error("数据库不可用");
    const workspaceId = ctx.user.defaultWorkspaceId ?? currentOpsWorkspaceId();
    return listEligibleUsers(db, workspaceId);
  }),

  listRules: protectedProcedure.query(async ({ ctx }) => {
    assertInventoryOwnerAssignmentAdmin(ctx);
    const workspaceId = ctx.user.defaultWorkspaceId ?? currentOpsWorkspaceId();
    return withDbTransaction("list inventory owner rules", async (db) => db.select()
      .from(opsInventoryOwnerAssignments)
      .where(and(eq(opsInventoryOwnerAssignments.workspaceId, workspaceId), eq(opsInventoryOwnerAssignments.isActive, 1)))
      .orderBy(desc(opsInventoryOwnerAssignments.updatedAt)));
  }),

  assignBatch: protectedProcedure.input(z.object({
    assigneeUserId: z.number().int().positive(),
    targets: z.array(assignmentScopeSchema).min(1).max(500),
    reason: z.string().trim().max(500).optional(),
  })).mutation(async ({ ctx, input }) => {
    assertInventoryOwnerAssignmentAdmin(ctx);
    const workspaceId = ctx.user.defaultWorkspaceId ?? currentOpsWorkspaceId();
    const targets = uniqueInventoryOwnerAssignmentScopes(input.targets);
    const result = await withDbTransaction("assign inventory owners", async (db) => {
      const eligibleUsers = await listEligibleUsers(db, workspaceId);
      const assignee = eligibleUsers.find((user: { id: number }) => user.id === input.assigneeUserId);
      if (!assignee?.name) throw new TRPCError({ code: "BAD_REQUEST", message: "负责人必须是当前工作空间中的正常账号。" });

      const latestSnapshots = await db.select({
        parentAsin: opsAsinDailySnapshots.parentAsin,
        storeName: opsAsinDailySnapshots.storeName,
        country: opsAsinDailySnapshots.country,
      }).from(opsAsinDailySnapshots).where(eq(opsAsinDailySnapshots.workspaceId, workspaceId));
      const availableKeys = new Set(latestSnapshots.map((row: any) => inventoryOwnerAssignmentKey(row)));
      const invalidScopes = targets.filter((target) => !availableKeys.has(inventoryOwnerAssignmentKey(target)));
      if (invalidScopes.length) {
        throw new TRPCError({ code: "BAD_REQUEST", message: `${invalidScopes.length}个分配目标已不在当前库存工作空间内，未写入任何规则。` });
      }

      const existingRules = await db.select().from(opsInventoryOwnerAssignments)
        .where(and(eq(opsInventoryOwnerAssignments.workspaceId, workspaceId), eq(opsInventoryOwnerAssignments.isActive, 1)));
      const existingByKey = new Map(existingRules.map((rule: any) => [inventoryOwnerAssignmentKey(rule), rule]));
      let created = 0;
      let replaced = 0;
      let unchanged = 0;

      for (const target of targets) {
        const existing = existingByKey.get(inventoryOwnerAssignmentKey(target));
        if (existing?.assigneeUserId === assignee.id && existing.assigneeName === assignee.name) {
          unchanged += 1;
          continue;
        }
        if (existing) {
          await db.update(opsInventoryOwnerAssignments).set({
            assigneeUserId: assignee.id,
            assigneeName: assignee.name,
            isActive: 1,
            updatedByUserId: ctx.user.id,
          }).where(and(eq(opsInventoryOwnerAssignments.id, existing.id), eq(opsInventoryOwnerAssignments.workspaceId, workspaceId)));
          await db.insert(opsInventoryOwnerAssignmentAudits).values({
            workspaceId,
            assignmentId: existing.id,
            action: "replaced",
            previousAssigneeUserId: existing.assigneeUserId,
            previousAssigneeName: existing.assigneeName,
            nextAssigneeUserId: assignee.id,
            nextAssigneeName: assignee.name,
            reason: input.reason || null,
            changedByUserId: ctx.user.id,
          });
          replaced += 1;
          continue;
        }
        const [createdRule] = await db.insert(opsInventoryOwnerAssignments).values({
          workspaceId,
          ...target,
          assigneeUserId: assignee.id,
          assigneeName: assignee.name,
          isActive: 1,
          createdByUserId: ctx.user.id,
          updatedByUserId: ctx.user.id,
        }).$returningId();
        await db.insert(opsInventoryOwnerAssignmentAudits).values({
          workspaceId,
          assignmentId: createdRule.id,
          action: "created",
          nextAssigneeUserId: assignee.id,
          nextAssigneeName: assignee.name,
          reason: input.reason || null,
          changedByUserId: ctx.user.id,
        });
        created += 1;
      }
      return { created, replaced, unchanged, assigneeName: assignee.name, targets };
    });
    await recordSecurityAuditLog({
      ctx,
      workspaceId,
      action: "inventory_owner_assignment.assign_batch",
      resourceType: "ops_inventory_owner_assignment",
      resourceId: result.targets.map(inventoryOwnerAssignmentKey).join(",").slice(0, 128),
      resourceName: `库存负责人批量分配：${result.assigneeName}`,
      riskLevel: "medium",
      metadata: { created: result.created, replaced: result.replaced, unchanged: result.unchanged, targetCount: result.targets.length },
    });
    return result;
  }),

  revoke: protectedProcedure.input(z.object({ id: z.number().int().positive(), reason: z.string().trim().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      assertInventoryOwnerAssignmentAdmin(ctx);
      const workspaceId = ctx.user.defaultWorkspaceId ?? currentOpsWorkspaceId();
      const result = await withDbTransaction("revoke inventory owner rule", async (db) => {
        const [existing] = await db.select().from(opsInventoryOwnerAssignments).where(and(
          eq(opsInventoryOwnerAssignments.id, input.id),
          eq(opsInventoryOwnerAssignments.workspaceId, workspaceId),
          eq(opsInventoryOwnerAssignments.isActive, 1),
        )).limit(1);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND", message: "未找到可撤销的库存负责人规则。" });
        await db.update(opsInventoryOwnerAssignments).set({ isActive: 0, updatedByUserId: ctx.user.id })
          .where(and(eq(opsInventoryOwnerAssignments.id, existing.id), eq(opsInventoryOwnerAssignments.workspaceId, workspaceId)));
        await db.insert(opsInventoryOwnerAssignmentAudits).values({
          workspaceId,
          assignmentId: existing.id,
          action: "revoked",
          previousAssigneeUserId: existing.assigneeUserId,
          previousAssigneeName: existing.assigneeName,
          reason: input.reason || null,
          changedByUserId: ctx.user.id,
        });
        return existing;
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "inventory_owner_assignment.revoke",
        resourceType: "ops_inventory_owner_assignment",
        resourceId: result.id,
        resourceName: `${result.parentAsin} · ${result.storeName} · ${result.country}`,
        riskLevel: "medium",
        beforeSnapshot: { assigneeUserId: result.assigneeUserId, assigneeName: result.assigneeName, isActive: 1 },
        afterSnapshot: { isActive: 0 },
      });
      return { revoked: true };
    }),
});
