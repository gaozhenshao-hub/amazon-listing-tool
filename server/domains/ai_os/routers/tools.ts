import { z } from "zod";
import { adminProcedure, protectedProcedure, router } from "../../../_core/trpc";
import { actorFromContext, assertResourceAction, recordSecurityAuditLog, workspaceIdFromContext } from "../../../services/securityGovernance";
import { invokeEmperorTool, listEmperorToolRuns, listEmperorTools, rotateEmperorToolSecret, seedBuiltinTools, upsertEmperorTool, upsertEmperorToolSecret } from "../services/toolGateway";
import { rawExecute } from "../routerContext";
import { prepareToolRunRecovery } from "../services/directRunRecovery";

export const emperorToolsRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "read" });
    return listEmperorTools(workspaceIdFromContext(ctx));
  }),

  listRuns: protectedProcedure
    .input(z.object({
      toolSlug: z.string().optional(),
      agentRunId: z.string().optional(),
      nodeId: z.string().optional(),
      status: z.enum(["running", "succeeded", "failed", "blocked"]).optional(),
      limit: z.number().min(1).max(200).optional(),
    }).optional())
    .query(async ({ ctx, input }) => {
      await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "read" });
      const isAdmin = (ctx.user as any).role === "admin" || (ctx.user as any).role === "super_admin";
      return listEmperorToolRuns({
        userId: ctx.user.id,
        isAdmin,
        toolSlug: input?.toolSlug,
        agentRunId: input?.agentRunId,
        nodeId: input?.nodeId,
        status: input?.status,
        limit: input?.limit,
        workspaceId: workspaceIdFromContext(ctx),
      });
    }),

  seedBuiltins: adminProcedure.mutation(async ({ ctx }) => {
    await assertResourceAction({ actor: actorFromContext(ctx), resource: "tool", action: "create" });
    const result = await seedBuiltinTools();
    await recordSecurityAuditLog({
      ctx,
      action: "tool.seed_builtins",
      resourceType: "tool",
      status: "success",
      riskLevel: "high",
      metadata: result,
    });
    return result;
  }),

  invoke: protectedProcedure
    .input(z.object({
      toolSlug: z.string(),
      params: z.any().optional(),
      runId: z.string().optional(),
      nodeId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "invoke",
        resourceId: input.toolSlug,
      });
      const workspaceId = workspaceIdFromContext(ctx);
      const result = await invokeEmperorTool({
        toolSlug: input.toolSlug,
        params: input.params,
        userId: ctx.user.id,
        userRole: (ctx.user as any).role || null,
        workspaceId,
        runId: input.runId,
        nodeId: input.nodeId,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "tool.invoke",
        resourceType: "tool",
        resourceId: input.toolSlug,
        toolSlug: input.toolSlug,
        agentRunId: input.runId || null,
        status: result.success ? "success" : "failed",
        riskLevel: result.metadata.riskLevel || "medium",
        metadata: {
          toolRunId: result.metadata.toolRunId,
          failureKind: result.metadata.failureKind,
          retryable: result.metadata.retryable,
          secretRefs: result.metadata.secretRefs,
        },
      });
      return result;
    }),

  prepareRecovery: protectedProcedure
    .input(z.object({ toolRunId: z.string().min(1).max(80) }))
    .mutation(async ({ ctx, input }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "invoke",
        resourceId: input.toolRunId,
      });
      const workspaceId = workspaceIdFromContext(ctx);
      const result = await prepareToolRunRecovery({
        toolRunId: input.toolRunId,
        userId: ctx.user.id,
        workspaceId,
      });
      await recordSecurityAuditLog({
        ctx,
        workspaceId,
        action: "tool.recovery_prepare",
        resourceType: "tool_run",
        resourceId: input.toolRunId,
        status: result.allowed ? "success" : "denied",
        riskLevel: result.allowed ? "medium" : "high",
        metadata: {
          recoveryId: result.recoveryId,
          manualExecutionRequired: result.manualExecutionRequired,
          reasonCode: result.reasonCode || null,
        },
      });
      return result;
    }),

  upsert: adminProcedure
    .input(z.object({
      slug: z.string(),
      name: z.string(),
      description: z.string().optional(),
      type: z.enum(["mcp", "api", "internal", "code"]),
      config: z.any().optional(),
      governancePolicy: z.any().optional(),
      permissionPolicy: z.any().optional(),
      rateLimitPolicy: z.any().optional(),
      circuitBreakerPolicy: z.any().optional(),
      secretRefs: z.any().optional(),
      outputPolicy: z.any().optional(),
      inputSchema: z.any().optional(),
      outputSchema: z.any().optional(),
      isActive: z.boolean().optional().default(true),
    }))
    .mutation(async ({ input, ctx }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "update",
        resourceId: input.slug,
      });
      const result = await upsertEmperorTool({
        ...input,
        workspaceId: workspaceIdFromContext(ctx),
      });
      await recordSecurityAuditLog({
        ctx,
        action: "tool.upsert",
        resourceType: "tool",
        resourceId: input.slug,
        resourceName: input.name,
        status: "success",
        riskLevel: "high",
        metadata: { type: input.type, secretRefs: input.secretRefs },
      });
      return result;
    }),

  upsertSecret: adminProcedure
    .input(z.object({
      slug: z.string().min(1).max(128),
      value: z.string().min(1),
      description: z.string().optional(),
      metadata: z.any().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "manage_secret",
        resourceId: input.slug,
      });
      const result = await upsertEmperorToolSecret({
        slug: input.slug,
        value: input.value,
        description: input.description || null,
        metadata: input.metadata,
        userId: ctx.user.id,
        workspaceId: workspaceIdFromContext(ctx),
      });
      await recordSecurityAuditLog({
        ctx,
        action: "tool_secret.upsert",
        resourceType: "tool_secret",
        resourceId: input.slug,
        status: "success",
        riskLevel: "critical",
        metadata: { ref: result.ref },
      });
      return result;
    }),

  rotateSecret: adminProcedure
    .input(z.object({ slug: z.string().min(1).max(128) }))
    .mutation(async ({ ctx, input }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "rotate_secret",
        resourceId: input.slug,
      });
      const result = await rotateEmperorToolSecret({
        slug: input.slug,
        userId: ctx.user.id,
        workspaceId: workspaceIdFromContext(ctx),
      });
      await recordSecurityAuditLog({
        ctx,
        action: "tool_secret.rotate",
        resourceType: "tool_secret",
        resourceId: input.slug,
        status: "success",
        riskLevel: "critical",
        metadata: {
          keyVersion: result.keyVersion,
          previousKeyVersion: result.previousKeyVersion,
        },
      });
      return result;
    }),

  delete: adminProcedure
    .input(z.object({ slug: z.string() }))
    .mutation(async ({ input, ctx }) => {
      await assertResourceAction({
        actor: actorFromContext(ctx),
        resource: "tool",
        action: "delete",
        resourceId: input.slug,
      });
      await rawExecute("DELETE FROM emperor_tools WHERE slug=?", [input.slug]);
      await recordSecurityAuditLog({
        ctx,
        action: "tool.delete",
        resourceType: "tool",
        resourceId: input.slug,
        status: "success",
        riskLevel: "high",
      });
      return { success: true };
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Diagnostics Router
// ─────────────────────────────────────────────────────────────────────────────
